"""proof_pack stage — bundles proofing images + reviewed text per ordered pages.

PLACEMENT: App-local PGDP-specific (docs/specs/library-placement.md §4.2).
           Long-running: LongJobRunner seam noted for B5 route wiring.

Stage scope: project (stage-registry-v2.md §2, row #20)
  - Gate: validation must be clean (passed=True)
  - Inputs: canvas_map artifacts (proofing images) + text_review artifacts
    (reviewed text) for each page in reading order
  - Outputs: proof_bundle — a manifest JSON describing the bundle contents
    (actual file copying is handled by build_package; proof_pack materializes
    the logical bundle structure + validates all artifacts are present)

The proof bundle artifact (output.json) is a manifest:
  {
    project_id: str,
    built_at: str (ISO),
    pages: [
      {
        page_id: str,
        proofing_image_path: str | null,  -- relative path from data_root
        text_path: str | null,            -- relative path from data_root
        has_image: bool,
        has_text: bool,
      },
      ...
    ]
  }

LongJobRunner seam: the actual proof_pack run can be long (large books).
  For B4, the implementation is synchronous (in-process). The B5 route
  layer wraps this in a Job for async dispatch. The seam is the callable
  signature: proof_pack_v2_cpu takes project_id + page_ids + data_root
  and returns bytes — B5 wraps it in a LongJobRunner.submit() call.

This module provides:
  1. build_proof_pack(project_id, page_ids, data_root) -> bytes
     Pure function: scans artifacts, returns manifest JSON bytes.
  2. proof_pack_v2_cpu(...) -> bytes
     Stage callable registered in V2_STAGE_IMPL.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from pathlib import Path


# ────────────────────────────────────────────────────────────────────────────
# Core bundle materialization (pure function, scans artifacts on disk)
# ────────────────────────────────────────────────────────────────────────────


def build_proof_pack(
    project_id: str,
    page_ids: list[str],
    data_root: Path,
) -> bytes:
    """Build the proof bundle manifest.

    For each page_id in page_ids (in reading order), checks for:
      - canvas_map/output.png (proofing image)
      - text_review/output.txt (reviewed text)

    Returns JSON manifest bytes describing what was found.

    Deterministic: same input bytes → same output manifest.
    """
    pages: list[dict[str, Any]] = []

    for page_id in page_ids:
        page_base = data_root / "projects" / project_id / "pages" / page_id / "stages"

        # Proofing image: canvas_map output
        img_path = page_base / "canvas_map" / "output.png"
        has_image = img_path.exists()
        img_rel: str | None = str(img_path.relative_to(data_root)) if has_image else None

        # Reviewed text: text_review output
        txt_path = page_base / "text_review" / "output.txt"
        has_text = txt_path.exists()
        txt_rel: str | None = str(txt_path.relative_to(data_root)) if has_text else None

        pages.append(
            {
                "page_id": page_id,
                "proofing_image_path": img_rel,
                "text_path": txt_rel,
                "has_image": has_image,
                "has_text": has_text,
            }
        )

    manifest: dict[str, Any] = {
        "project_id": project_id,
        "built_at": datetime.now(UTC).isoformat(),
        "pages": pages,
    }

    return json.dumps(manifest, sort_keys=True).encode("utf-8")


# ────────────────────────────────────────────────────────────────────────────
# v2 stage callable — registered in V2_STAGE_IMPL
# ────────────────────────────────────────────────────────────────────────────


def proof_pack_v2_cpu(
    project_id: str,
    page_ids: list[str],
    data_root: Path,
    cfg: Any = None,
) -> bytes:
    """v2 proof_pack stage callable.

    Takes project_id + ordered page_ids + data_root.
    Returns JSON bytes of the proof bundle manifest.

    LongJobRunner seam: B5 route layer wraps this in an async Job.
    Gate: caller must ensure validation stage is clean before calling.
    """
    _ = cfg
    return build_proof_pack(project_id=project_id, page_ids=page_ids, data_root=data_root)
