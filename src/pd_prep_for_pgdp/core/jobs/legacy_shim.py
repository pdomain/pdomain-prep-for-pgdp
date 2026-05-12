"""Legacy batch_* → STAGE_IMPL translation shim.

Routes batch job types through run_stage / STAGE_IMPL instead of the
GPU backend's process_page / run_ocr monoliths. Deletion tracked in M6 (#15).
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING

from ..pipeline.stage_runner import run_stage

if TYPE_CHECKING:
    from ...core.models import Job
    from ..job_runner import InProcessJobRunner

log = logging.getLogger(__name__)

# Maps each legacy batch job type to the ordered stage_ids it executes.
# Imported by job_runner handlers and referenced in audits/tests.
BATCH_JOB_TO_STAGES: dict[str, list[str]] = {
    "batch_process_pages": [
        "decode_source",
        "initial_crop",
        "manual_deskew_pre",
        "grayscale",
        "threshold",
        "invert",
        "find_content_edges",
        "crop_to_content",
        "auto_deskew",
        "morph_fill",
        "rescale",
        "canvas_map",
    ],
    "batch_ocr": ["ocr_crop", "ocr"],
    "batch_text_postprocess": ["text_postprocess"],
    "batch_extract_illustrations": ["auto_detect_illustrations"],
}


async def run_legacy_batch_pages(
    runner: InProcessJobRunner,
    job: Job,
    *,
    stage_ids: list[str],
    data_root: Path,
) -> tuple[int, int]:
    """Run stage_ids on every applicable page via run_stage / STAGE_IMPL.

    Returns (ok_count, err_count). Per-page failures are logged but do not
    abort the rest of the batch.
    """
    requested_idxs = job.payload.get("page_idxs")
    if requested_idxs:
        idxs = sorted(int(i) for i in requested_idxs)
    else:
        all_pages, _, _ = await runner._db.list_pages(job.project_id, None, 1_000_000)
        idxs = sorted(p.idx0 for p in all_pages if not p.ignore)

    total = len(idxs)
    ok_count = 0
    err_count = 0

    for n, idx0 in enumerate(idxs):
        page_id = f"{idx0:04d}"
        page = await runner._db.get_page(job.project_id, idx0)
        page_source_key = page.source_key if page is not None else None

        page_ok = True
        for stage_id in stage_ids:
            try:
                await run_stage(
                    data_root=data_root,
                    database=runner._db,
                    project_id=job.project_id,
                    page_id=page_id,
                    stage_id=stage_id,
                    device="cpu",
                    storage=runner._storage,
                    page_source_key=page_source_key,
                )
            except Exception:
                log.exception("legacy shim: stage %r failed on page %s", stage_id, page_id)
                page_ok = False
                break

        if page_ok:
            ok_count += 1
        else:
            err_count += 1

        await runner._update_progress(
            job,
            current=n + 1,
            total=total,
            message=f"ok={ok_count} err={err_count}",
        )

    return ok_count, err_count
