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

This module provides:
  1. build_submission_zip(project_id, page_ids, data_root, book_name) -> bytes
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

if TYPE_CHECKING:
    from pathlib import Path


# ────────────────────────────────────────────────────────────────────────────
# Core zip construction (synchronous, filesystem-based)
# ────────────────────────────────────────────────────────────────────────────


def build_submission_zip(
    project_id: str,
    page_ids: list[str],
    data_root: Path,
    book_name: str = "",
) -> bytes:
    """Build the PGDP submission zip from on-disk artifacts.

    Reads:
      - canvas_map/output.png (proofing image) per page
      - text_review/output.txt (reviewed text) per page

    Writes into ZIP:
      - <page_id>.png  (proofing image)
      - <page_id>.txt  (reviewed text)
      - pgdp.json      (manifest)

    Returns zip bytes.

    PGDP submission layout: each page contributes one .png and one .txt.
    The manifest (pgdp.json) records book_name, project_id, built_at,
    and per-page metadata.
    """
    buf = io.BytesIO()
    page_count = 0
    page_manifest: list[dict[str, Any]] = []

    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for page_id in page_ids:
            page_base = data_root / "projects" / project_id / "pages" / page_id / "stages"

            # Proofing image
            img_path = page_base / "canvas_map" / "output.png"
            if img_path.exists():
                zf.writestr(f"{page_id}.png", img_path.read_bytes())
                page_count += 1

            # Reviewed text
            txt_path = page_base / "text_review" / "output.txt"
            if txt_path.exists():
                zf.writestr(f"{page_id}.txt", txt_path.read_bytes())

            page_manifest.append(
                {
                    "page_id": page_id,
                    "has_image": img_path.exists(),
                    "has_text": txt_path.exists(),
                }
            )

        # pgdp.json manifest
        manifest: dict[str, Any] = {
            "book_name": book_name,
            "project_id": project_id,
            "built_at": datetime.now(UTC).isoformat(),
            "page_count": page_count,
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
    cfg: Any = None,
) -> bytes:
    """v2 build_package stage callable.

    Takes project_id + ordered page_ids + data_root + book_name.
    Returns zip bytes of the PGDP submission package.

    LongJobRunner seam: B5 route layer wraps this in an async Job.
    Gate: caller must ensure proof_pack stage is clean before calling.
    """
    _ = cfg
    return build_submission_zip(
        project_id=project_id,
        page_ids=page_ids,
        data_root=data_root,
        book_name=book_name,
    )
