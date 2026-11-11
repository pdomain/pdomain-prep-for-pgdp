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
  Illustration crops named by ``stages/illustrations/crops.json`` are
  included in an ``images/`` directory as ``<prefix>_<NN:02d>.<ext>``.
  When that manifest is absent, the legacy ``stages/extract_illustrations/``
  directory is used instead. An empty manifest packs no crops.
  A cover page listed in ``cover_page_ids`` is also stored as ``cover.png``.
  When ``optimize_png`` is true, proofing PNGs go through oxipng level 4.

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

from pdomain_prep_for_pgdp.core.packaging import _optimize_png
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


_CROP_SUFFIXES = frozenset({".png", ".jpg", ".jpeg"})

# The zip format cannot store a time before 1980-01-01.
_ZIP_EPOCH = (1980, 1, 1, 0, 0, 0)


def _zip_date_time(built_at: str) -> tuple[int, int, int, int, int, int]:
    """Entry time for every zip member, taken from ``built_at`` in UTC.

    A value with no zone is read as UTC. Times before 1980 are clamped,
    because the zip format cannot store them.
    """
    stamp = datetime.fromisoformat(built_at)
    if stamp.tzinfo is not None:
        stamp = stamp.astimezone(UTC)
    date_time = (stamp.year, stamp.month, stamp.day, stamp.hour, stamp.minute, stamp.second)
    return max(date_time, _ZIP_EPOCH)


def _zip_entry(name: str, date_time: tuple[int, int, int, int, int, int]) -> zipfile.ZipInfo:
    """A file entry with a fixed time, deflated, mode 0600 as ``writestr`` would set."""
    info = zipfile.ZipInfo(filename=name, date_time=date_time)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o600 << 16
    return info


def _crop_image_files(stage_dir: Path) -> list[Path]:
    """Image files in one stage directory, sorted. JSON sidecars are skipped."""
    if not stage_dir.is_dir():
        return []
    return sorted(
        path for path in stage_dir.iterdir() if path.is_file() and path.suffix.lower() in _CROP_SUFFIXES
    )


def _image_files_named_by_crops_manifest(stage_dir: Path) -> list[Path] | None:
    """Files named by ``crops.json``, or None when that manifest is absent.

    An empty or unreadable manifest returns an empty list so a leftover
    image, or the legacy extract directory, is not packed in its place.
    """
    manifest_path = stage_dir / "crops.json"
    if not manifest_path.is_file():
        return None
    try:
        payload: object = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return []
    if not isinstance(payload, dict):
        return []
    crops = payload.get("crops")
    if not isinstance(crops, list):
        return []
    named: list[Path] = []
    for item in crops:
        if not isinstance(item, dict):
            continue
        filename = item.get("file")
        if (
            not isinstance(filename, str)
            or filename == ""
            or "/" in filename
            or "\\" in filename
            or filename in {".", ".."}
        ):
            continue
        path = stage_dir / filename
        if path.is_file() and path.suffix.lower() in _CROP_SUFFIXES:
            named.append(path)
    return named


def _collect_illustration_crops(
    page_base: Path,
    prefix: str,
) -> list[tuple[str, bytes]]:
    """Scan illustration crop images for the submission zip.

    When ``stages/illustrations/crops.json`` exists, pack only the image
    files it names. Otherwise read the legacy ``stages/extract_illustrations/``
    directory. Crop files are named ``images/<prefix>_<NN:02d>.<ext>``.
    """
    named = _image_files_named_by_crops_manifest(page_base / "illustrations")
    image_files = _crop_image_files(page_base / "extract_illustrations") if named is None else named
    if not image_files:
        return []

    crops: list[tuple[str, bytes]] = []
    for idx, crop_path in enumerate(image_files, start=1):
        ext = crop_path.suffix.lstrip(".")
        zip_name = f"images/{prefix}_{idx:02d}.{ext}"
        crops.append((zip_name, crop_path.read_bytes()))
    return crops


def _png_optimize_enabled(cfg: object) -> bool:
    """Read ``optimize_png`` from stage cfg. A missing flag defaults to True."""
    if cfg is None:
        return True
    flag = getattr(cfg, "optimize_png", True)
    return flag if isinstance(flag, bool) else True


def _cover_page_ids_from_store(data_root: Path, project_id: str) -> frozenset[str]:
    """Return cover page ids, or empty when the project has no event store.

    ``build_page_service`` creates ``.pd-pages/`` when the directory is
    missing, so this returns before that call when ``events.db`` is absent.
    """
    events_db = data_root / "projects" / project_id / ".pd-pages" / "events.db"
    if not events_db.is_file():
        return frozenset()

    from pdomain_prep_for_pgdp.core.models import PageType
    from pdomain_prep_for_pgdp.core.page_service_helpers import list_page_records
    from pdomain_prep_for_pgdp.core.page_store_factory import build_page_service

    service = build_page_service(data_root, project_id)
    try:
        records = list_page_records(service, project_id)
    finally:
        closer = getattr(service.app, "close", None)
        if callable(closer):
            closer()
    return frozenset(
        f"{page.idx0:04d}" for page in records if page.page_type == PageType.cover and not page.ignore
    )


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
    cover_page_ids: frozenset[str] | None = None,
    optimize_png: bool = False,
) -> bytes:
    """Build the PGDP submission zip from on-disk artifacts.

    Reads per page:
      - canvas_map/output.png     (proofing image)
      - text_review/output.txt    (reviewed text)
      - illustrations/ or extract_illustrations/  (illustration crops, if any)

    Writes into ZIP:
      - <prefix>.png   (proofing image, named via page_prefixes or page_id)
      - <prefix>.txt   (reviewed text, named via page_prefixes or page_id)
      - images/<prefix>_<NN>.ext  (illustration crops, when present)
      - cover.png      (alias of the first cover page's proofing PNG)
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
        cover_page_ids: Page ids whose proofing PNG is also written as
            ``cover.png``. The first match in ``page_ids`` wins. None and
            an empty set write no cover alias.
        optimize_png: When True, run oxipng level 4 on each proofing PNG.
            A failed page keeps its original bytes and increments
            ``oxipng_skipped_pages`` in the manifest. Default False so
            callers that do not opt in keep the bytes they wrote on disk.
        built_at: ISO-format UTC timestamp for the pgdp.json manifest and
            the time of every zip entry (converted to UTC, clamped to
            1980 or later). Pass a fixed value (e.g. the stage-run event
            timestamp) to get a deterministic archive. When None, uses
            datetime.now(UTC), so the archive is not reproducible.

    Returns zip bytes.

    Determinism: same page artifacts + same page_prefixes + same built_at
    → byte-identical archive + identical sha256. The caller is responsible
    for supplying a stable ``built_at`` when determinism is required.
    """
    if built_at is None:
        built_at = datetime.now(UTC).isoformat()
    entry_time = _zip_date_time(built_at)

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
    cover_ids = cover_page_ids if cover_page_ids is not None else frozenset()
    skip_counter: list[int] = [0]
    cover_prefix: str | None = None

    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for page_id in effective_page_ids:
            page_base = data_root / "projects" / project_id / "pages" / page_id / "stages"
            prefix = page_prefixes[page_id] if page_prefixes and page_id in page_prefixes else page_id

            # Proofing image. Cover alias uses the same bytes as the page PNG.
            img_path = page_base / "canvas_map" / "output.png"
            img_bytes: bytes | None = None
            if img_path.is_file():
                img_bytes = img_path.read_bytes()
                if optimize_png:
                    img_bytes = _optimize_png(img_bytes, skip_counter=skip_counter)
                zf.writestr(_zip_entry(f"{prefix}.png", entry_time), img_bytes)
                page_count += 1
                if page_id in cover_ids and cover_prefix is None:
                    zf.writestr(_zip_entry("cover.png", entry_time), img_bytes)
                    cover_prefix = prefix

            # Reviewed text
            txt_path = page_base / "text_review" / "output.txt"
            if txt_path.exists():
                zf.writestr(_zip_entry(f"{prefix}.txt", entry_time), txt_path.read_bytes())

            # Illustration crops under images/
            crops = _collect_illustration_crops(page_base, prefix)
            for zip_name, data in crops:
                zf.writestr(_zip_entry(zip_name, entry_time), data)
                illustration_count += 1

            page_manifest.append(
                {
                    "page_id": page_id,
                    "prefix": prefix,
                    "has_image": img_bytes is not None,
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
        if cover_prefix is not None:
            manifest["cover_prefix"] = cover_prefix
        if optimize_png:
            manifest["oxipng_skipped_pages"] = skip_counter[0]
        zf.writestr(_zip_entry("pgdp.json", entry_time), json.dumps(manifest, indent=2))

    return buf.getvalue()


# ────────────────────────────────────────────────────────────────────────────
# v2 stage callable — registered in V2_STAGE_IMPL
# ────────────────────────────────────────────────────────────────────────────


def build_package_v2_cpu(
    project_id: str,
    page_ids: list[str],
    data_root: Path,
    *,
    book_name: str = "",
    page_prefixes: dict[str, str] | None = None,
    skip_ids: frozenset[str] | None = None,
    built_at: str | None = None,
    cfg: Any = None,
    cover_page_ids: frozenset[str] | None = None,
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
    # Load the naming manifest when page_prefixes are not explicitly supplied.
    # This is the live execution path: page_order must be clean.
    if page_prefixes is None:
        manifest = load_naming_manifest(data_root, project_id)
        page_prefixes = manifest.page_prefixes()
        if skip_ids is None:
            skip_ids = manifest.skip_set()

    resolved_covers = (
        cover_page_ids if cover_page_ids is not None else _cover_page_ids_from_store(data_root, project_id)
    )
    return build_submission_zip(
        project_id=project_id,
        page_ids=page_ids,
        data_root=data_root,
        book_name=book_name,
        page_prefixes=page_prefixes,
        skip_ids=skip_ids,
        built_at=built_at,
        cover_page_ids=resolved_covers,
        optimize_png=_png_optimize_enabled(cfg),
    )
