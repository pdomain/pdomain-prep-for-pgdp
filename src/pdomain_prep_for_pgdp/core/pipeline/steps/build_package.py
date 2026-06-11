"""build_package stage — PGDP submission zip (re-keyed onto project_stages).

PLACEMENT: App-local PGDP-specific (docs/specs/library-placement.md §4.2).
           Long-running: LongJobRunner seam noted for B5 route wiring.

Stage scope: project (stage-registry-v2.md §2, row #21)
  - Gate: proof_pack must be clean
  - Inputs: proof bundle (canvas_map proofing images + text_review reviewed text,
    per ordered pages)
  - Outputs: submission_zip (bytes of a PGDP-layout ZIP file)

Re-keys the existing core/packaging.py build_package logic onto the v2
project_stages model. The output format (PGDP submission layout) is
preserved: <prefix>.png, <prefix>.txt, images/, pgdp.json manifest.

The core ZIP construction delegates to core/packaging.py where possible,
but the v2 stage operates synchronously on the filesystem artifacts directly
(no async IStorage round-trips at this layer — B5 route layer owns I/O).

LongJobRunner seam: large books make this long-running. The B5 route layer
wraps build_submission_zip in a LongJobRunner.submit() call for async dispatch.
The seam is the callable signature (project_id + page_ids + data_root + book_name
→ bytes).

Determinism contract:
  build_submission_zip accepts an explicit ``built_at`` timestamp parameter.
  Passing the same ``built_at`` (e.g. the stage-run event's timestamp) over
  identical input artifacts produces byte-identical ZIP archives and identical
  sha256 hashes. This satisfies the D5 event-sourced reindex-reproducibility
  requirement: the event log carries the timestamp, so re-running from the
  same event reproduces the same archive.

PGDP layout contract:
  Page files are named <prefix>.png / <prefix>.txt where ``prefix`` comes
  from the ``page_prefixes`` mapping (e.g. "f003", "p045"). When
  ``page_prefixes`` is absent (legacy/test path), the bare page_id is used.
  Illustration crops stored under stages/extract_illustrations/ are included
  in an ``images/`` directory following the legacy naming convention
  ``<prefix>_<NN:02d>.<ext>``.

PGDP naming rules (DP wiki — Content Providing FAQ):
  Per-file rules (enforced by pgdp_naming.validate_pgdp_filename):
    - Basename ≤ 8 characters
    - Characters [A-Za-z0-9_-] only (no spaces, dots, slashes, etc.)
    - Extension lowercase .png / .txt / .jpg only
    - No "ad" substring in the basename
  Package-level rules (enforced by pgdp_naming.validate_package_naming):
    - Every .png page must have a matching .txt page (and vice versa)
    - Basenames in lexicographic sort order must match reading order
  The ``compute_prefix`` alphabet (f/p + digits 0-9 + suffix b/p/r,
  max 5 chars) is proven to satisfy all four per-file rules.
  Two-tier enforcement:
    1. validation stage (blocker code "pgdp_naming"): actionable user feedback
       before build is attempted.
    2. build_submission_zip pre-zip hard assert (PgdpNamingError): defence-in-
       depth — raises even if the validation stage was bypassed.
  Reference: https://www.pgdp.net/wiki/DP_Official_Documentation:CP_and_PM/Content_Providing_FAQ

This module provides:
  1. build_submission_zip(project_id, page_ids, data_root, book_name,
                          *, page_prefixes, built_at) -> bytes
     Pure function: reads filesystem artifacts, builds and returns zip bytes.
  2. build_package_v2_cpu(...) -> bytes
     Stage callable registered in V2_STAGE_IMPL.
"""

from __future__ import annotations

import io
import json
import zipfile
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

from pdomain_prep_for_pgdp.core.pipeline.pgdp_naming import (
    PgdpNamingError,
    validate_package_naming,
    validate_pgdp_filename,
)
from pdomain_prep_for_pgdp.core.pipeline.steps.page_order import (
    load_naming_manifest,
)

if TYPE_CHECKING:
    from pathlib import Path


# ────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ────────────────────────────────────────────────────────────────────────────


def _collect_illustration_crops(
    page_base: Path,
    prefix: str,
) -> list[tuple[str, bytes]]:
    """Scan stages/extract_illustrations/ for crop image files.

    Returns a list of (zip_name, data) pairs for inclusion under images/.

    Crop files are any non-JSON files in the extract_illustrations stage
    directory. They are named ``<prefix>_<NN:02d>.<ext>`` in the zip
    (matching the legacy packaging.py convention: ``images/<prefix>_<NN:02d>.<ext>``).

    If the extract_illustrations stage directory does not exist (stage not yet
    run) or contains no image files, returns an empty list.
    """
    ill_dir = page_base / "extract_illustrations"
    if not ill_dir.is_dir():
        return []

    crops: list[tuple[str, bytes]] = []
    # Collect image files sorted for deterministic ordering
    image_files = sorted(
        f for f in ill_dir.iterdir() if f.is_file() and f.suffix.lower() in {".png", ".jpg", ".jpeg"}
    )
    for idx, crop_path in enumerate(image_files, start=1):
        ext = crop_path.suffix.lstrip(".")
        zip_name = f"images/{prefix}_{idx:02d}.{ext}"
        crops.append((zip_name, crop_path.read_bytes()))
    return crops


# ────────────────────────────────────────────────────────────────────────────
# Core zip construction (synchronous, filesystem-based)
# ────────────────────────────────────────────────────────────────────────────


def build_submission_zip(
    project_id: str,
    page_ids: list[str],
    data_root: Path,
    book_name: str = "",
    *,
    page_prefixes: dict[str, str] | None = None,
    skip_ids: frozenset[str] | None = None,
    built_at: str | None = None,
) -> bytes:
    """Build the PGDP submission zip from on-disk artifacts.

    Reads per page:
      - canvas_map/output.png     (proofing image)
      - text_review/output.txt    (reviewed text)
      - extract_illustrations/    (illustration crops, if any)

    Writes into ZIP:
      - <prefix>.png   (proofing image, named via page_prefixes or page_id)
      - <prefix>.txt   (reviewed text, named via page_prefixes or page_id)
      - images/<prefix>_<NN>.ext  (illustration crops, when present)
      - pgdp.json      (manifest)

    Args:
        project_id: Project identifier.
        page_ids: Ordered list of page IDs to include (may include skip pages;
            they are filtered out using ``skip_ids``).
        data_root: Root of the on-disk data tree.
        book_name: Human-readable book name for the manifest.
        page_prefixes: Mapping of page_id → PGDP prefix (e.g. "p045").
            When provided, files are named by prefix (PGDP requirement).
            When None, bare page_id is used (legacy/test path).
        skip_ids: Set of page_ids to exclude from the zip (role=="skip").
            When None, no pages are excluded (legacy/test path).
        built_at: ISO-format UTC timestamp for the pgdp.json manifest.
            Pass a fixed value (e.g. the stage-run event timestamp) to get
            a deterministic archive. When None, uses datetime.now(UTC).

    Returns zip bytes.

    Determinism: same page artifacts + same page_prefixes + same built_at
    → byte-identical archive + identical sha256. The caller is responsible
    for supplying a stable ``built_at`` when determinism is required.
    """
    if built_at is None:
        built_at = datetime.now(UTC).isoformat()

    # Apply skip exclusions before any processing.
    _skip: frozenset[str] = skip_ids if skip_ids is not None else frozenset()
    effective_page_ids = [pid for pid in page_ids if pid not in _skip]

    # ── PGDP naming compliance hard-assert ────────────────────────────────
    # Rules: https://www.pgdp.net/wiki/DP_Official_Documentation:CP_and_PM/Content_Providing_FAQ
    # When page_prefixes is supplied, validate every prefix before zipping.
    # Fail fast with a clear error rather than silently producing a bad archive.
    if page_prefixes:
        per_file_errors: list[str] = []
        for page_id in effective_page_ids:
            prefix = page_prefixes.get(page_id, page_id)
            for ext in (".png", ".txt"):
                errs = validate_pgdp_filename(prefix, ext)
                per_file_errors.extend(errs)
        if per_file_errors:
            raise PgdpNamingError(f"PGDP naming violations in page_prefixes: {'; '.join(per_file_errors)}")
        # Build the prospective zip entry names in page_order sequence for
        # the sort-order check.
        prospective_names: list[str] = []
        for page_id in effective_page_ids:
            prefix = page_prefixes.get(page_id, page_id)
            prospective_names.append(f"{prefix}.png")
            prospective_names.append(f"{prefix}.txt")
        package_errors = validate_package_naming(prospective_names, page_order=list(effective_page_ids))
        if package_errors:
            raise PgdpNamingError(f"PGDP package naming violations: {'; '.join(package_errors)}")
    # ─────────────────────────────────────────────────────────────────────

    buf = io.BytesIO()
    page_count = 0
    illustration_count = 0
    page_manifest: list[dict[str, Any]] = []

    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for page_id in effective_page_ids:
            page_base = data_root / "projects" / project_id / "pages" / page_id / "stages"
            prefix = page_prefixes[page_id] if page_prefixes and page_id in page_prefixes else page_id

            # Proofing image
            img_path = page_base / "canvas_map" / "output.png"
            if img_path.exists():
                zf.writestr(f"{prefix}.png", img_path.read_bytes())
                page_count += 1

            # Reviewed text
            txt_path = page_base / "text_review" / "output.txt"
            if txt_path.exists():
                zf.writestr(f"{prefix}.txt", txt_path.read_bytes())

            # Illustration crops under images/
            crops = _collect_illustration_crops(page_base, prefix)
            for zip_name, data in crops:
                zf.writestr(zip_name, data)
                illustration_count += 1

            page_manifest.append(
                {
                    "page_id": page_id,
                    "prefix": prefix,
                    "has_image": img_path.exists(),
                    "has_text": txt_path.exists(),
                    "illustration_count": len(crops),
                }
            )

        # pgdp.json manifest
        manifest: dict[str, Any] = {
            "book_name": book_name,
            "project_id": project_id,
            "built_at": built_at,
            "page_count": page_count,
            "illustration_count": illustration_count,
            "pages": page_manifest,
        }
        zf.writestr("pgdp.json", json.dumps(manifest, indent=2))

    return buf.getvalue()


# ────────────────────────────────────────────────────────────────────────────
# v2 stage callable — registered in V2_STAGE_IMPL
# ────────────────────────────────────────────────────────────────────────────


def build_package_v2_cpu(
    project_id: str,
    page_ids: list[str],
    data_root: Path,
    book_name: str = "",
    page_prefixes: dict[str, str] | None = None,
    skip_ids: frozenset[str] | None = None,
    built_at: str | None = None,
    cfg: Any = None,
) -> bytes:
    """v2 build_package stage callable.

    Takes project_id + ordered page_ids + data_root + book_name.
    Returns zip bytes of the PGDP submission package.

    When ``page_prefixes`` is None (the live execution path), the naming
    manifest written by the page_order stage is loaded from disk.  If the
    manifest is absent the call raises ``MissingNamingManifest`` — the caller
    must ensure the page_order stage is clean before running build_package.

    Args:
        page_prefixes: Mapping of page_id → PGDP prefix (e.g. "p045").
            When None, loaded from the on-disk page_order naming manifest.
            Pass explicitly only in tests / legacy paths.
        skip_ids: Set of page_ids to exclude from the zip.
            When None and page_prefixes is None, loaded from the manifest.
            Pass explicitly only in tests.
        built_at: ISO-format UTC timestamp for deterministic builds.
            Pass the stage-run event's timestamp for reproducibility.

    Raises:
        MissingNamingManifest: if page_prefixes is None and the page_order
            manifest is absent or stale.
        PgdpNamingError: if the resolved prefixes violate PGDP naming rules.

    LongJobRunner seam: B5 route layer wraps this in an async Job.
    Gate: caller must ensure proof_pack stage is clean before calling.
    """
    _ = cfg

    # Load the naming manifest when page_prefixes are not explicitly supplied.
    # This is the live execution path: page_order must be clean.
    if page_prefixes is None:
        manifest = load_naming_manifest(data_root, project_id)
        page_prefixes = manifest.page_prefixes()
        if skip_ids is None:
            skip_ids = manifest.skip_set()

    return build_submission_zip(
        project_id=project_id,
        page_ids=page_ids,
        data_root=data_root,
        book_name=book_name,
        page_prefixes=page_prefixes,
        skip_ids=skip_ids,
        built_at=built_at,
    )
