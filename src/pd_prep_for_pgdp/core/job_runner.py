"""In-process job runner.

Polls the `jobs` table, executes queued jobs in order, transitions their
status as they progress. Runs in the FastAPI lifespan task. The Modal /
shared-container backends override the runner with their own dispatch path;
local + self-hosted modes use this one.

Job types -> handler:
  - unzip                        -> core.ingest.unzip_source (chains a thumbnails job)
  - thumbnails                   -> core.ingest.generate_thumbnails
  - batch_process_pages          -> dispatcher.submit (one BatchJobItem per page)
  - batch_ocr                    -> dispatcher.submit
  - batch_text_postprocess       -> CPU postprocess across pages
  - batch_extract_illustrations  -> CPU illustration extraction
  - build_package                -> core.packaging.build_package
  - run_page_stage               -> core.pipeline.stage_runner.run_stage (async route)
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime
from pathlib import Path

from ..adapters.database import IDatabase
from ..adapters.gpu import BatchJobItem, BatchJobResult, GPUBackend
from ..adapters.storage import IStorage
from ..dispatcher.base import IDispatcher
from ..dispatcher.batched import BatchDispatcher
from .illustrations import extract_illustration, regions_for_page
from .ingest import generate_thumbnails, unzip_source
from .job_events import JobEventBroker
from .models import Job, JobStatus, JobType, PageRecord, PageStageStatus
from .packaging import build_package
from .text_postprocess import postprocess_text

log = logging.getLogger(__name__)


class InProcessJobRunner:
    def __init__(
        self,
        *,
        database: IDatabase,
        storage: IStorage,
        gpu: GPUBackend | None = None,
        dispatcher: IDispatcher | None = None,
        events: JobEventBroker | None = None,
        poll_interval: float = 1.0,
        max_concurrency: int = 1,
        data_root: Path | None = None,
    ) -> None:
        self._db = database
        self._storage = storage
        self._gpu = gpu
        self._data_root = data_root
        self._dispatcher = dispatcher
        self._events = events
        self._poll = poll_interval
        self._max_concurrency = max(1, max_concurrency)
        # Jobs that handed themselves off to the dispatcher; _run_one should
        # NOT mark them complete on the way out — the dispatcher's completion
        # callback owns that transition.
        self._scheduled_jobs: set[str] = set()
        # Jobs that parked themselves in awaiting_review; _run_one should NOT
        # mark them complete — the resume check re-queues them when ready.
        self._parked_jobs: set[str] = set()
        # Cooperative stop: setting this causes `run_forever` to exit between
        # poll iterations rather than mid-DB-call. The lifespan teardown sets
        # it BEFORE awaiting the runner task to avoid a SQLite-level segfault
        # where the worker thread holds a cursor while close() runs.
        self._stop = asyncio.Event()

        # When a BatchDispatcher is provided, register a completion callback so
        # jobs whose items finish a flush are marked complete (or failed).
        if isinstance(dispatcher, BatchDispatcher):
            dispatcher.add_completion_callback(self._on_dispatcher_flush)

    async def _emit(self, job: Job) -> None:
        """Push a status snapshot onto the event broker, if one is wired."""
        if self._events is None:
            return
        # Semantic event type: "progress" while running, the terminal status
        # name otherwise. SSE consumers can switch on `type` rather than
        # parsing `status`.
        terminal = {"complete", "error", "cancelled"}
        ev_type = job.status.value if job.status.value in terminal else "progress"
        await self._events.publish(
            job.id,
            {
                "type": ev_type,
                "status": job.status.value,
                "current": job.progress.current,
                "total": job.progress.total,
                "current_page": job.progress.current_page,
                "message": job.progress.message,
                "error": job.error_message,
            },
        )
        if job.status.value in terminal:
            await self._events.close(job.id)

    async def _on_dispatcher_flush(self, job_id: str, results: list[BatchJobResult]) -> None:
        if not job_id:
            return
        job = await self._db.get_job(job_id)
        if job is None:
            return
        ok = sum(1 for r in results if r.ok)
        err = len(results) - ok
        progress = job.progress.model_copy(
            update={
                "current": ok,
                "total": len(results),
                "message": f"ok={ok} err={err}",
            }
        )
        first_err = next((r.error for r in results if not r.ok and r.error), None)
        updated = job.model_copy(
            update={
                "status": JobStatus.error if err and not ok else JobStatus.complete,
                "completed_at": datetime.now(UTC),
                "progress": progress,
                "error_message": first_err if err else job.error_message,
            }
        )
        await self._db.put_job(updated)
        await self._emit(updated)

    async def run_forever(self) -> None:
        """Loop until `stop()` is called or the task is cancelled.

        Polls the queue, sleeps `poll_interval`, repeats. Exits between
        iterations so we never tear down with a worker thread mid-SQLite
        call (that's a hard segfault when the connection is closed under it).
        """
        while not self._stop.is_set():
            try:
                await self.run_pending(max_jobs=8)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("InProcessJobRunner.run_pending iteration failed")
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self._poll)
                return
            except TimeoutError:
                continue

    def stop(self) -> None:
        """Signal `run_forever` to exit at the next safe point."""
        self._stop.set()

    async def run_pending(self, *, max_jobs: int = 8) -> int:
        """Pick up at most `max_jobs` queued jobs and execute them.

        Up to `self._max_concurrency` jobs run in parallel; the rest queue
        behind them. Returns the count of jobs that started in this call
        (settles only once they all complete).
        """
        await self._check_awaiting_review()
        jobs = await self._find_queued()
        if not jobs:
            return 0

        slated = jobs[:max_jobs]
        if self._max_concurrency <= 1:
            for job in slated:
                await self._run_one(job)
            return len(slated)

        sem = asyncio.Semaphore(self._max_concurrency)

        async def _bounded(job: Job) -> None:
            async with sem:
                await self._run_one(job)

        await asyncio.gather(*(_bounded(j) for j in slated))
        return len(slated)

    async def _check_awaiting_review(self) -> None:
        """Re-queue any parked build_package jobs whose pages are all reviewed."""
        for owner_id in await _distinct_owner_ids(self._db):
            for job in await self._db.list_recent_jobs(owner_id, 200):
                if job.status != JobStatus.awaiting_review:
                    continue
                if job.type != JobType.build_package:
                    continue
                if await _all_pages_reviewed(self._db, job.project_id):
                    requeued = job.model_copy(update={"status": JobStatus.queued})
                    await self._db.put_job(requeued)
                    log.info("re-queued awaiting_review job %s (all pages reviewed)", job.id)

    async def _find_queued(self) -> list[Job]:
        # The current SqliteDatabase only exposes recent-jobs by owner_id; we
        # walk that and filter to QUEUED. Multi-tenant schedulers should add a
        # dedicated index, but this is fine for local + small self-hosted.
        out: list[Job] = []
        # We iterate every owner_id we've ever recorded a job for. SQLite is
        # cheap; a dedicated query would be cleaner once Postgres lands.
        for owner_id in await _distinct_owner_ids(self._db):
            for job in await self._db.list_recent_jobs(owner_id, 200):
                if job.status == JobStatus.queued:
                    out.append(job)
        return out

    async def _run_one(self, job: Job) -> None:
        log.info("running job %s (%s)", job.id, job.type.value)
        job = job.model_copy(
            update={
                "status": JobStatus.running,
                "started_at": datetime.now(UTC),
            }
        )
        await self._db.put_job(job)
        await self._emit(job)

        try:
            handler = _HANDLERS.get(job.type)
            if handler is None:
                raise NotImplementedError(f"no handler for job type {job.type.value}")
            await handler(self, job)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.exception("job %s failed", job.id)
            await self._mark_failed(job, str(e))
            return

        # If the handler handed the job off to the dispatcher, skip the
        # complete transition — the dispatcher's completion callback owns it.
        if job.id in self._scheduled_jobs:
            self._scheduled_jobs.discard(job.id)
            return

        # If the handler parked the job in awaiting_review, skip complete —
        # the resume check will re-queue it when all pages are reviewed.
        if job.id in self._parked_jobs:
            self._parked_jobs.discard(job.id)
            return

        # Re-read so we preserve progress writes the handler made via _update_progress.
        latest = await self._db.get_job(job.id) or job
        await self._mark_complete(latest)

    async def _mark_complete(self, job: Job) -> None:
        # If the user cancelled this job mid-execution, don't overwrite the
        # cancelled status with `complete`. Best-effort guard — the SQLite
        # adapter doesn't have CAS, so a tight race could still slip through.
        latest = await self._db.get_job(job.id)
        if latest is not None and latest.status == JobStatus.cancelled:
            await self._emit(latest)
            return
        updated = job.model_copy(
            update={
                "status": JobStatus.complete,
                "completed_at": datetime.now(UTC),
            }
        )
        await self._db.put_job(updated)
        await self._emit(updated)

    async def _mark_failed(self, job: Job, message: str) -> None:
        latest = await self._db.get_job(job.id)
        if latest is not None and latest.status == JobStatus.cancelled:
            await self._emit(latest)
            return
        updated = job.model_copy(
            update={
                "status": JobStatus.error,
                "completed_at": datetime.now(UTC),
                "error_message": message,
            }
        )
        await self._db.put_job(updated)
        await self._emit(updated)

    async def _update_progress(self, job: Job, *, current: int, total: int, message: str = "") -> Job:
        progress = job.progress.model_copy(
            update={"current": current, "total": total, "message": message or job.progress.message}
        )
        updated = job.model_copy(update={"progress": progress})
        await self._db.put_job(updated)
        await self._emit(updated)
        return updated


# ─── Handlers ───────────────────────────────────────────────────────────────


async def _handle_unzip(runner: InProcessJobRunner, job: Job) -> None:
    """Step 0: extract the zip / list the source folder, write PageRecords.

    The source key is encoded in `job.progress.message`. On success this
    handler enqueues a `thumbnails` job for the same project so the user
    sees the second stage as a separate progress bar.
    """
    project = await runner._db.get_project(job.project_id)
    if project is None:
        raise FileNotFoundError(f"project {job.project_id} not found")

    source_key = job.progress.message
    if not source_key:
        raise ValueError("unzip job missing source_key in progress.message")

    source_type = "zip" if source_key.endswith(".zip") else "local_folder"

    async def _report(current: int, total: int, stem: str) -> None:
        await runner._update_progress(job, current=current, total=total, message=f"unzipping {stem}")

    result = await unzip_source(
        project=project,
        source_type=source_type,
        source_key=source_key,
        storage=runner._storage,
        database=runner._db,
        progress_cb=_report,
    )
    await runner._update_progress(
        job,
        current=result.page_count,
        total=result.page_count,
        message=f"unzipped {result.page_count} pages, {len(result.errors)} errors",
    )

    # Chain Step 2 — thumbnails. Same project, fresh queued job. The user
    # sees both jobs in the JobsPage and can watch them in sequence.
    if result.page_count > 0:
        thumb_job = Job(
            id=uuid.uuid4().hex,
            project_id=job.project_id,
            owner_id=job.owner_id,
            type=JobType.thumbnails,
            status=JobStatus.queued,
        )
        await runner._db.put_job(thumb_job)


async def _handle_thumbnails(runner: InProcessJobRunner, job: Job) -> None:
    """Step 2: generate thumbnails for every page that doesn't have one.

    Runs the entire batch in a single threadpool dispatch so cv2 stays warm
    — addresses the slowness the user observed on CPU when each page paid
    its own context-switch + library-init overhead.
    """
    project = await runner._db.get_project(job.project_id)
    if project is None:
        raise FileNotFoundError(f"project {job.project_id} not found")

    async def _report(current: int, total: int, stem: str) -> None:
        await runner._update_progress(job, current=current, total=total, message=f"thumbnail {stem}")

    result = await generate_thumbnails(
        project=project,
        storage=runner._storage,
        database=runner._db,
        progress_cb=_report,
    )
    await runner._update_progress(
        job,
        current=result.page_count,
        total=result.page_count,
        message=f"thumbnailed {result.page_count} pages, {len(result.errors)} errors",
    )


async def _handle_build_package(runner: InProcessJobRunner, job: Job) -> None:
    project = await runner._db.get_project(job.project_id)
    if project is None:
        raise FileNotFoundError(f"project {job.project_id} not found")

    if not await _all_pages_reviewed(runner._db, job.project_id):
        parked = job.model_copy(update={"status": JobStatus.awaiting_review})
        await runner._db.put_job(parked)
        await runner._emit(parked)
        runner._parked_jobs.add(job.id)
        return

    pages, _, _ = await runner._db.list_pages(job.project_id, None, 1_000_000)
    result = await build_package(project=project, pages=pages, storage=runner._storage)
    await runner._update_progress(
        job,
        current=result.page_count,
        total=result.page_count,
        message=f"package={result.package_key} bytes={result.bytes_written}",
    )


async def _handle_text_postprocess(runner: InProcessJobRunner, job: Job) -> None:
    """Run Step 8 across every page that has an OCR text file on storage.

    Reads, postprocesses, writes back. Idempotent.
    """
    project = await runner._db.get_project(job.project_id)
    if project is None:
        raise FileNotFoundError(f"project {job.project_id} not found")
    system = await runner._db.get_system_defaults(project.owner_id)

    pages, _, _ = await runner._db.list_pages(job.project_id, None, 1_000_000)
    total = 0
    for page in pages:
        if page.ignore:
            continue
        for output in page.outputs or [_synth_whole_page_output(page)]:
            text_key = (
                output.ocr_text_key
                or f"projects/{job.project_id}/ocr_text/{page.source_stem}_{output.full_prefix}.txt"
            )
            if not await runner._storage.exists(text_key):
                continue
            raw = await runner._storage.get_bytes(text_key)
            cleaned = postprocess_text(
                raw.decode("utf-8", errors="replace"),
                system=system,
                project=project.config,
            )
            await runner._storage.put_bytes(text_key, cleaned.encode("utf-8"), "text/plain")
            total += 1
    await runner._update_progress(
        job, current=total, total=total, message=f"postprocessed {total} text files"
    )


async def _handle_extract_illustrations(runner: InProcessJobRunner, job: Job) -> None:
    """Spec 4.5 — write `hi_res/<prefix>_<NN>.<ext>` for every region on every page."""
    pages, _, _ = await runner._db.list_pages(job.project_id, None, 1_000_000)
    total = 0
    errors: list[str] = []
    for page in pages:
        regions = regions_for_page(page, system=await _system_for(runner, job))
        if not regions:
            continue
        if not page.source_key or not await runner._storage.exists(page.source_key):
            errors.append(f"{page.source_stem}: source missing")
            continue
        src_bytes = await runner._storage.get_bytes(page.source_key)
        for region in regions:
            try:
                crop = extract_illustration(source_image_bytes=src_bytes, region=region)
            except Exception as e:
                errors.append(f"{page.prefix}_{region.index:02d}: {e}")
                continue
            ext = region.output_format
            content_type = "image/jpeg" if ext == "jpg" else "image/png"
            key = f"projects/{job.project_id}/hi_res/{page.prefix}_{region.index:02d}.{ext}"
            await runner._storage.put_bytes(key, crop, content_type)
            total += 1
    await runner._update_progress(
        job,
        current=total,
        total=total,
        message=f"extracted {total} illustrations, {len(errors)} errors",
    )


async def _handle_batch_process_pages(runner: InProcessJobRunner, job: Job) -> None:
    if runner._data_root is not None:
        from .jobs.legacy_shim import BATCH_JOB_TO_STAGES, run_legacy_batch_pages

        await run_legacy_batch_pages(
            runner,
            job,
            stage_ids=BATCH_JOB_TO_STAGES["batch_process_pages"],
            data_root=runner._data_root,
        )
        return
    await _run_batch_pages(runner, job, job_type="batch_process_pages")


async def _handle_batch_ocr(runner: InProcessJobRunner, job: Job) -> None:
    if runner._data_root is not None:
        from .jobs.legacy_shim import BATCH_JOB_TO_STAGES, run_legacy_batch_pages

        await run_legacy_batch_pages(
            runner,
            job,
            stage_ids=BATCH_JOB_TO_STAGES["batch_ocr"],
            data_root=runner._data_root,
        )
        return
    await _run_batch_pages(runner, job, job_type="batch_ocr")


async def _run_batch_pages(runner: InProcessJobRunner, job: Job, *, job_type: str) -> None:
    """Shared body for `batch_process_pages` and `batch_ocr`.

    Builds one BatchJobItem per page, hands them to the GPU backend, and
    records progress on the job row. Per-page failures don't abort the batch.
    """
    if runner._gpu is None:
        raise RuntimeError(
            f"{job_type} requires a GPU backend; pass gpu= when constructing InProcessJobRunner"
        )

    project = await runner._db.get_project(job.project_id)
    if project is None:
        raise FileNotFoundError(f"project {job.project_id} not found")

    requested_idxs = job.payload.get("page_idxs")
    if requested_idxs:
        idxs = sorted(int(i) for i in requested_idxs)
    else:
        # All proof-range, non-ignored pages.
        all_pages, _, _ = await runner._db.list_pages(job.project_id, None, 1_000_000)
        idxs = sorted(p.idx0 for p in all_pages if not p.ignore)

    items = [
        BatchJobItem(
            job_type=job_type,
            project_id=job.project_id,
            idx0=idx,
            payload=dict(job.payload),
        )
        for idx in idxs
    ]
    if not items:
        await runner._update_progress(job, current=0, total=0, message="no pages to process")
        return

    # Managed mode: enqueue into the BatchDispatcher and mark scheduled.
    # The dispatcher's completion callback will mark the job complete on flush.
    if isinstance(runner._dispatcher, BatchDispatcher):
        for item in items:
            await runner._dispatcher.submit(item, job_id=job.id)
        await runner._update_progress(job, current=0, total=len(items), message=f"queued {len(items)} items")
        await runner._db.put_job(job.model_copy(update={"status": JobStatus.scheduled}))
        # Skip _mark_complete in _run_one — the dispatcher owns this job now.
        runner._scheduled_jobs.add(job.id)
        return

    # Local / self-hosted: run inline.
    # Per-item progress: emit a "page N of M" event after each item so the
    # workbench / RunPipelinePanel can show real-time progress instead of a
    # single `running -> complete` flip. `current_page` carries the just-
    # finished idx0 so the SPA can highlight the active row.
    ok_running = 0
    err_running = 0

    async def _report(current: int, total: int, result: BatchJobResult) -> None:
        nonlocal ok_running, err_running
        if result.ok:
            ok_running += 1
        else:
            err_running += 1
        progress = job.progress.model_copy(
            update={
                "current": current,
                "total": total,
                "current_page": result.idx0,
                "message": f"ok={ok_running} err={err_running}",
            }
        )
        snapshot = job.model_copy(update={"progress": progress})
        await runner._db.put_job(snapshot)
        await runner._emit(snapshot)

    results = await runner._gpu.run_batch(items, progress_cb=_report)
    ok_count = sum(1 for r in results if r.ok)
    err_count = len(results) - ok_count
    # `_update_progress` returns the new pydantic copy. Use IT as the basis
    # for the error-message write, otherwise we'd overwrite the just-written
    # progress with the stale local `job` reference.
    latest = await runner._update_progress(
        job,
        current=ok_count,
        total=len(items),
        message=f"ok={ok_count} err={err_count}",
    )
    if err_count:
        first_err = next((r.error for r in results if not r.ok and r.error), "batch had errors")
        latest = latest.model_copy(update={"error_message": first_err})
        await runner._db.put_job(latest)


async def _handle_run_page_stage(runner: InProcessJobRunner, job: Job) -> None:
    """Run a single per-page stage via the async route (?async=true).

    Payload keys (all required):
      - ``project_id``: the project being processed.
      - ``page_id``:    zero-padded 4-digit string (e.g. ``"0000"``).
      - ``stage_id``:   canonical stage id from ``PAGE_STAGE_IDS``.
      - ``device``:     ``"cpu"`` (default) or ``"cuda"``.

    The runner calls ``run_stage`` with the same arguments the synchronous
    route would pass, using the runner's own ``_storage`` and ``_db``
    adapters. The job transitions to ``complete`` on success or ``error``
    on ``StageRunFailed`` / ``StageDependenciesNotMet``.

    ``StageDependenciesNotMet`` is not a stage-impl failure but a caller-
    ordering error; it bubbles up as a job ``error`` with a clear message
    naming the missing parents.
    """
    from pathlib import Path

    from .pipeline.stage_runner import run_stage

    payload = job.payload
    project_id = payload.get("project_id") or job.project_id
    page_id: str = payload["page_id"]
    stage_id: str = payload["stage_id"]
    device: str = payload.get("device", "cpu")
    # data_root is not stashed on the runner; the route records it in the
    # payload so the handler is self-contained.
    data_root = Path(payload["data_root"])

    project = await runner._db.get_project(project_id)
    if project is None:
        raise FileNotFoundError(f"project {project_id!r} not found")
    # page_source_key: look it up from the DB rather than embedding in payload.
    # idx0 is derivable from page_id (zero-padded int).
    idx0 = int(page_id)
    page = await runner._db.get_page(project_id, idx0)
    page_source_key = page.source_key if page is not None else None

    await run_stage(
        data_root=data_root,
        database=runner._db,
        project_id=project_id,
        page_id=page_id,
        stage_id=stage_id,
        device=device,
        storage=runner._storage,
        page_source_key=page_source_key,
    )
    await runner._update_progress(
        job,
        current=1,
        total=1,
        message=f"stage {stage_id!r} completed",
    )


async def _handle_project_run_dirty(runner: InProcessJobRunner, job: Job) -> None:
    """Fan-out: run every dirty/not-run stage on every page (M5 §Decision #1).

    Payload keys:
      - ``data_root``: filesystem root for stage artifacts (required).
      - ``stage_filter``: optional stage_id — restricts both page selection
        and stage execution to this one stage.
      - ``device``: ``"cpu"`` (default) or ``"cuda"``.

    Creates one child job row per page-with-work; runs stages inline and
    marks children complete/error.  Parent progress: current = pages done,
    total = pages with dirty stages.
    """
    from pathlib import Path

    from .models import PAGE_STAGE_IDS, PageStageStatus
    from .pipeline.stage_runner import run_stage

    stage_filter: str | None = job.payload.get("stage_filter")
    data_root = Path(job.payload.get("data_root", "."))
    device: str = job.payload.get("device", "cpu")

    project = await runner._db.get_project(job.project_id)
    if project is None:
        raise FileNotFoundError(f"project {job.project_id!r} not found")

    pages, _, _ = await runner._db.list_pages(job.project_id, None, 1_000_000)

    # Collect pages that have at least one dirty/not-run stage (honouring filter).
    dirty_statuses = {PageStageStatus.dirty, PageStageStatus.not_run}
    pages_with_work: list[tuple[str, list[str], str | None]] = []

    for page in pages:
        if page.ignore:
            continue
        page_id = f"{page.idx0:04d}"
        rows = await runner._db.list_page_stages_for_page(job.project_id, page_id)
        stage_ids = [
            r.stage_id
            for r in rows
            if r.status in dirty_statuses and (stage_filter is None or r.stage_id == stage_filter)
        ]
        if stage_ids:
            pages_with_work.append((page_id, stage_ids, page.source_key))

    total = len(pages_with_work)
    job = await runner._update_progress(job, current=0, total=total, message=f"dispatching {total} pages")

    for i, (page_id, stage_ids, page_source_key) in enumerate(pages_with_work, start=1):
        child = Job(
            id=uuid.uuid4().hex,
            project_id=job.project_id,
            owner_id=job.owner_id,
            type=JobType.run_page_stage,
            status=JobStatus.running,
            started_at=datetime.now(UTC),
            payload={
                "parent_job_id": job.id,
                "page_id": page_id,
                "stage_ids": stage_ids,
                "data_root": str(data_root),
            },
        )
        await runner._db.put_job(child)

        # Run dirty stages in canonical DAG order.
        ordered = [sid for sid in PAGE_STAGE_IDS if sid in stage_ids]
        child_ok = True
        for stage_id in ordered:
            try:
                await run_stage(
                    data_root=data_root,
                    database=runner._db,
                    project_id=job.project_id,
                    page_id=page_id,
                    stage_id=stage_id,
                    device=device,
                    storage=runner._storage,
                    page_source_key=page_source_key,
                )
            except Exception:
                log.warning("page %s stage %s failed in project_run_dirty", page_id, stage_id)
                child_ok = False

        child_done = child.model_copy(
            update={
                "status": JobStatus.complete if child_ok else JobStatus.error,
                "completed_at": datetime.now(UTC),
            }
        )
        await runner._db.put_job(child_done)

        job = await runner._update_progress(
            job,
            current=i,
            total=total,
            message=f"completed {i}/{total} pages",
        )


async def _handle_project_run_stage_all_pages(runner: InProcessJobRunner, job: Job) -> None:
    """Run one specific stage on every page that needs it (M5 §Decision #1).

    Payload keys:
      - ``data_root``: filesystem root for stage artifacts (required).
      - ``stage_id``: the stage to run on all dirty pages (required).
      - ``device``: ``"cpu"`` (default) or ``"cuda"``.

    Delegates to ``_handle_project_run_dirty`` with ``stage_filter`` set to
    the requested ``stage_id``.
    """
    stage_id: str = job.payload["stage_id"]
    delegated = job.model_copy(update={"payload": {**job.payload, "stage_filter": stage_id}})
    await _handle_project_run_dirty(runner, delegated)


_HANDLERS = {
    JobType.unzip: _handle_unzip,
    JobType.thumbnails: _handle_thumbnails,
    JobType.build_package: _handle_build_package,
    JobType.batch_text_postprocess: _handle_text_postprocess,
    JobType.batch_extract_illustrations: _handle_extract_illustrations,
    JobType.batch_process_pages: _handle_batch_process_pages,
    JobType.batch_ocr: _handle_batch_ocr,
    JobType.run_page_stage: _handle_run_page_stage,
    JobType.project_run_dirty: _handle_project_run_dirty,
    JobType.project_run_stage_all_pages: _handle_project_run_stage_all_pages,
}


# ─── Small helpers for handlers ─────────────────────────────────────────────


def _synth_whole_page_output(page: PageRecord):
    """Pages with no recorded outputs (pre-OCR) still need a stable text key."""
    from .models import PageOutput

    return PageOutput(
        full_prefix=page.prefix or page.source_stem,
        split_suffix=None,
        reading_order=0,
    )


async def _system_for(runner: InProcessJobRunner, job: Job):
    project = await runner._db.get_project(job.project_id)
    owner_id = project.owner_id if project else "default"
    return await runner._db.get_system_defaults(owner_id)


# ─── Helpers ────────────────────────────────────────────────────────────────


async def _distinct_owner_ids(db: IDatabase) -> list[str]:
    """Best-effort enumeration of owner_ids the runner should poll.

    Returns `["default"]` when no introspection hook exists. Postgres
    adapter can override with a real query later.
    """
    fn = getattr(db, "list_distinct_owner_ids", None)
    if callable(fn):
        return list(await fn())
    return ["default"]


async def _all_pages_reviewed(db: IDatabase, project_id: str) -> bool:
    """True when every non-ignored page has a clean text_review stage row."""
    pages, _, _ = await db.list_pages(project_id, None, 1_000_000)
    proof_pages = [p for p in pages if not p.ignore]
    if not proof_pages:
        return True
    proof_page_ids = {f"{p.idx0:04d}" for p in proof_pages}
    clean_stages = await db.list_page_stages_by_status(project_id, PageStageStatus.clean)
    reviewed_ids = {s.page_id for s in clean_stages if s.stage_id == "text_review"}
    return proof_page_ids <= reviewed_ids
