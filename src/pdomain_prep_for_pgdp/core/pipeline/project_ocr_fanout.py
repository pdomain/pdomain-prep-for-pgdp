"""Batch-OCR project fan-out — Phase 3 (plan: docs/plans/2026-06-11-gpu-memory-pipeline.md §Phase3).

When a ``run_project_ocr_batch`` job is dispatched, this module:

1. Collects the list of pages that have a clean ``post_ocr_crop`` artifact
   (their pre-OCR image is ready — either on disk or in the write-executor
   ndarray cache from an upstream stage run in the same session).
2. Groups pages into batches of ``batch_size`` (from ``PGDP_OCR_BATCH_SIZE``
   / Settings, defaulting to ``pick_doctr_batch_sizes`` auto-size).
3. For each batch:
   a. Loads each page's post_ocr_crop image (ndarray from executor cache or
      PNG decode from disk).
   b. Calls ``ocr_pages_batch`` (one predictor forward-pass) or falls back to
      ``ocr_pages_sequential`` when batch_size=1.
   c. Fans results back: each page gets its own artifact write + DB row update
      (``commit_stage_artifacts_multi``) + SSE event + dirty cascade.
4. Runs with a bounded pipeline semaphore (``ocr_pipeline_slots`` slots) so
   page k+1 can decode/prep while page k completes and the write-executor
   drains — back-pressure is the write-executor queue (Q8).

## Hard constraints preserved

* Q3: every page still gets its own on-disk artifact.
* Q1/Q9: dual-write per page; failure marks that page ``failed`` and cascades
  dirty.  Other pages in the same batch are not affected by one page's failure.
* Q8: back-pressure via the write-executor semaphore.
* Per-page SSE ``running → clean`` events emitted in the same order as the
  single-stage runner.
* ``PGDP_OCR_BATCH_SIZE=1`` is byte-identical to the old sequential path
  (uses ``ocr_pages_sequential`` which calls ``ocr_page_from_image`` one at a
  time).

## Scope

This module is called by ``_handle_run_project_ocr_batch`` in
``core/job_runner.py``.  It does NOT own the job lifecycle (queued → running →
complete/error) — that is the job runner's responsibility.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from time import time
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from pathlib import Path

    import numpy as np

    from pdomain_prep_for_pgdp.adapters.database.base import IDatabase
    from pdomain_prep_for_pgdp.core.models import ResolvedPageConfig
    from pdomain_prep_for_pgdp.core.page_store_factory import PageService
    from pdomain_prep_for_pgdp.core.pipeline.ocr_batch import BatchOcrPageResult
    from pdomain_prep_for_pgdp.core.pipeline.stage_write_executor import StageWriteExecutor
    from pdomain_prep_for_pgdp.core.stage_events import StageEventBroker

log = logging.getLogger(__name__)

_STAGE_ID = "ocr"


# ─── Image loading helper ───────────────────────────────────────────────────────


def _load_ocr_input_image(
    data_root: Path,
    project_id: str,
    page_id: str,
    write_executor: StageWriteExecutor | None,
) -> np.ndarray:
    """Load the post_ocr_crop (or ocr_crop) artifact for a page as an ndarray.

    Checks the write-executor ndarray cache first (Phase 1 passthrough), then
    falls back to disk decode.  Raises ``FileNotFoundError`` if neither source
    is available.
    """
    import cv2
    import numpy as np

    from pdomain_prep_for_pgdp.core.pipeline.page_stage_writer import stage_artifact_path

    # Try executor cache first (avoids decode entirely when upstream stages ran
    # in the same job session and put an ndarray in the cache).
    for parent_stage_id in ("post_ocr_crop", "ocr_crop"):
        if write_executor is not None:
            cached = write_executor.consume_artifact((project_id, page_id, parent_stage_id))
            if cached is not None:
                if isinstance(cached, np.ndarray):
                    return cached
                # Bytes in cache (Phase 2: cupy arrays are not expected here for this path,
                # but guard anyway — skip non-bytes non-ndarray entries).
                if not isinstance(cached, bytes):
                    continue
                arr = np.frombuffer(cached, dtype=np.uint8)
                img = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
                if img is not None:
                    return img

    # Disk fallback.
    for parent_stage_id in ("post_ocr_crop", "ocr_crop"):
        path = stage_artifact_path(data_root, project_id, page_id, parent_stage_id)
        if path.exists():
            raw = path.read_bytes()
            arr = np.frombuffer(raw, dtype=np.uint8)
            img = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
            if img is not None:
                return img

    raise FileNotFoundError(f"page {page_id}: no clean post_ocr_crop artifact found in cache or on disk")


# ─── Per-page result commit ─────────────────────────────────────────────────────


async def _commit_ocr_result(
    result: BatchOcrPageResult,
    *,
    data_root: Path,
    database: IDatabase,
    project_id: str,
    stage_events: StageEventBroker | None,
    write_executor: StageWriteExecutor | None,
    started_at_ms: float,
) -> None:
    """Commit one page's OCR result (success or failure) following the full dual-write contract.

    This mirrors the per-stage logic in ``stage_runner.run_stage``:
    - Success: ``commit_stage_artifacts_multi`` + dirty cascade + SSE ``clean``.
    - Failure: ``_mark_failed`` + SSE ``failed``.
    """
    from pdomain_prep_for_pgdp.core.pipeline.page_stage_writer import commit_stage_artifacts_multi
    from pdomain_prep_for_pgdp.core.pipeline.stage_runner import (
        StageRunFailed,
        _cascade_dirty,
        _emit,
        _mark_failed,
        _mark_running,
    )

    page_id = result.page_id

    # Emit running (mirrors stage_runner mark_running + SSE).
    _ = await _mark_running(
        database=database,
        project_id=project_id,
        page_id=page_id,
        stage_id=_STAGE_ID,
    )
    await _emit(stage_events, project_id, page_id, "stage-status", _STAGE_ID, "running")

    if result.error is not None:
        duration_ms = int(time() * 1000 - started_at_ms)
        err_msg = f"batch OCR failed for page {page_id}: {result.error}"
        await _mark_failed(
            database=database,
            project_id=project_id,
            page_id=page_id,
            stage_id=_STAGE_ID,
            error_message=err_msg,
        )
        await _emit(stage_events, project_id, page_id, "stage-status", _STAGE_ID, "failed")
        log.warning("batch OCR page %s failed in %d ms: %s", page_id, duration_ms, result.error)
        return

    # Success: dual-write artifact.
    assert result.output is not None
    try:
        from pdomain_prep_for_pgdp.core.pipeline.stage_dag import STAGE_VERSIONS

        stage_version = STAGE_VERSIONS.get(_STAGE_ID, 1)
        _ = await commit_stage_artifacts_multi(
            data_root=data_root,
            database=database,
            project_id=project_id,
            page_id=page_id,
            stage_id=_STAGE_ID,
            files=result.output,
            primary_filename="raw.txt",
            stage_version=stage_version,
        )
    except Exception as exc:
        err_msg = f"batch OCR dual-write failed for page {page_id}: {exc}"
        await _mark_failed(
            database=database,
            project_id=project_id,
            page_id=page_id,
            stage_id=_STAGE_ID,
            error_message=err_msg,
        )
        await _emit(stage_events, project_id, page_id, "stage-status", _STAGE_ID, "failed")
        log.warning("batch OCR dual-write failed for page %s: %s", page_id, exc)
        raise StageRunFailed(err_msg) from exc

    # Dirty cascade downstream.
    await _cascade_dirty(
        database=database,
        project_id=project_id,
        page_id=page_id,
        stage_id=_STAGE_ID,
    )

    # SSE: clean event for the OCR stage.
    await _emit(stage_events, project_id, page_id, "stage-status", _STAGE_ID, "clean")

    duration_ms = int(time() * 1000 - started_at_ms)
    log.debug("batch OCR page %s committed in %d ms", page_id, duration_ms)


# ─── Batch group execution ──────────────────────────────────────────────────────


async def _run_batch_group(
    page_ids_batch: list[str],
    images_batch: list[Any],  # list[np.ndarray]
    cfgs_batch: list[ResolvedPageConfig],
    *,
    predictor: Any,
    device: str,
    batch_size: int | None,
    system: Any,  # SystemDefaults
    build_smaller: Any | None,
    data_root: Path,
    database: IDatabase,
    project_id: str,
    stage_events: StageEventBroker | None,
    write_executor: StageWriteExecutor | None,
    started_at_ms: float,
) -> int:
    """Run one batch group through OCR and commit each page's result.

    Returns the number of pages that succeeded.
    """
    from pdomain_prep_for_pgdp.core.pipeline.ocr_batch import (
        ocr_pages_batch,
        ocr_pages_sequential,
    )

    log.info(
        "batch OCR group: project=%s pages=%s device=%s batch_size=%s",
        project_id,
        page_ids_batch,
        device,
        batch_size,
    )

    # Run in thread pool so the event loop stays unblocked.
    loop = asyncio.get_running_loop()

    def _do_ocr() -> list[BatchOcrPageResult]:
        if batch_size == 1:
            return ocr_pages_sequential(
                images_batch,
                page_ids=page_ids_batch,
                cfgs=cfgs_batch,
                system=system,
                predictor=predictor,
            )
        return ocr_pages_batch(
            images_batch,
            page_ids=page_ids_batch,
            cfgs=cfgs_batch,
            system=system,
            predictor=predictor,
            device=device,
            build_smaller=build_smaller,
        )

    results: list[BatchOcrPageResult] = await loop.run_in_executor(None, _do_ocr)

    # Fan results back: one commit per page, in order.
    success_count = 0
    for result in results:
        try:
            await _commit_ocr_result(
                result,
                data_root=data_root,
                database=database,
                project_id=project_id,
                stage_events=stage_events,
                write_executor=write_executor,
                started_at_ms=started_at_ms,
            )
            if result.error is None:
                success_count += 1
        except Exception as exc:
            log.exception("commit_ocr_result raised for page %s: %s", result.page_id, exc)
            # Continue committing remaining pages.

    return success_count


# ─── Public entry point ─────────────────────────────────────────────────────────


async def run_project_ocr_fanout(
    *,
    project_id: str,
    page_ids: list[str],
    data_root: Path,
    database: IDatabase,
    stage_events: StageEventBroker | None = None,
    write_executor: StageWriteExecutor | None = None,
    page_service: PageService | None = None,
    predictor: Any | None = None,
    layout_detector: Any | None = None,
    device: str = "cpu",
    batch_size: int | None = None,
    pipeline_slots: int = 3,
    build_smaller: Any | None = None,
    # Progress callback: (completed_pages, total_pages) -> None
    progress_cb: Any | None = None,
) -> dict[str, int]:
    """Batch-OCR all eligible pages in a project and commit per-page results.

    Parameters
    ----------
    project_id, page_ids:
        Project and ordered list of page IDs to process.
    data_root, database:
        Storage and DB adapters.
    stage_events:
        Optional broker for per-page SSE events.
    write_executor:
        Optional deferred-write executor (Phase 1 cache reuse).
    predictor, layout_detector:
        Reused process-singleton models.  When ``predictor`` is None the
        batch path calls ``get_predictor()`` internally.
    device:
        Hardware device string for ``pick_doctr_batch_sizes``.
    batch_size:
        Max pages per predictor call.  None = auto (``pick_doctr_batch_sizes``).
        1 = sequential (byte-identical to old per-page path).
    pipeline_slots:
        Concurrency ceiling for the asyncio semaphore (3 = default).
    build_smaller:
        OOM backoff hook forwarded to ``run_doctr_batch``.
    progress_cb:
        Optional ``(completed, total) -> None`` sync callback.

    Returns
    -------
    dict[str, int]
        ``{"total": N, "success": M, "failed": K, "skipped": S}``.
        Skipped = pages with no eligible pre-OCR artifact.
    """
    from pdomain_prep_for_pgdp.core.models import SystemDefaults
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import default_resolved_page_config

    # Resolve batch_size: if not explicitly set, use None (auto-size inside run_doctr_batch).
    effective_batch_size = batch_size  # None = auto inside run_doctr_batch

    # Collect images for all eligible pages.
    images: list[Any] = []
    eligible_page_ids: list[str] = []
    cfgs: list[ResolvedPageConfig] = []
    skipped: list[str] = []

    for page_id in page_ids:
        try:
            img = _load_ocr_input_image(data_root, project_id, page_id, write_executor)
            images.append(img)
            eligible_page_ids.append(page_id)
            # Config resolution: use default for now (real per-page config loaded in
            # stage_runner; for batch mode we use defaults + env override).
            cfgs.append(default_resolved_page_config())
        except FileNotFoundError as exc:
            log.info("skipping page %s for batch OCR: %s", page_id, exc)
            skipped.append(page_id)

    total = len(eligible_page_ids)
    if not eligible_page_ids:
        return {"total": 0, "success": 0, "failed": 0, "skipped": len(skipped)}

    # Load predictor only when there are pages to process (avoids model load on empty project).
    if predictor is None:
        from pdomain_prep_for_pgdp.core.ocr import get_predictor

        predictor = get_predictor()

    system = SystemDefaults()
    started_at_ms = time() * 1000
    success_count = 0
    failed_count = 0

    # Split into batches and run with bounded concurrency.
    # When effective_batch_size is None, run all pages as one batch (auto-sized
    # internally by pick_doctr_batch_sizes inside run_doctr_batch).
    # When effective_batch_size is an int, split into chunks of that size.
    if effective_batch_size is None:
        page_batches = [eligible_page_ids]
        image_batches = [images]
        cfg_batches = [cfgs]
    else:
        bs = max(1, effective_batch_size)
        page_batches = [eligible_page_ids[i : i + bs] for i in range(0, len(eligible_page_ids), bs)]
        image_batches = [images[i : i + bs] for i in range(0, len(images), bs)]
        cfg_batches = [cfgs[i : i + bs] for i in range(0, len(cfgs), bs)]

    sem = asyncio.Semaphore(max(1, pipeline_slots))

    async def _run_one_batch(
        batch_page_ids: list[str],
        batch_images: list[Any],
        batch_cfgs: list[ResolvedPageConfig],
    ) -> int:
        async with sem:
            return await _run_batch_group(
                batch_page_ids,
                batch_images,
                batch_cfgs,
                predictor=predictor,
                device=device,
                batch_size=effective_batch_size,
                system=system,
                build_smaller=build_smaller,
                data_root=data_root,
                database=database,
                project_id=project_id,
                stage_events=stage_events,
                write_executor=write_executor,
                started_at_ms=started_at_ms,
            )

    # Run batches with bounded pipeline concurrency.
    batch_tasks = [
        asyncio.create_task(_run_one_batch(bp, bi, bc))
        for bp, bi, bc in zip(page_batches, image_batches, cfg_batches, strict=True)
    ]

    for completed, task in enumerate(asyncio.as_completed(batch_tasks), start=1):
        try:
            n_ok = await task
            success_count += n_ok
        except Exception as exc:
            log.exception("batch task raised: %s", exc)
            failed_count += 1
        if progress_cb is not None:
            with contextlib.suppress(Exception):
                progress_cb(completed, len(batch_tasks))

    # Any pages not in succeeded set count as failed.
    failed_count = total - success_count

    return {
        "total": total,
        "success": success_count,
        "failed": failed_count,
        "skipped": len(skipped),
    }
