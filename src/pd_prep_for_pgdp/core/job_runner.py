"""In-process job runner.

Polls the `jobs` table, executes queued jobs in order, transitions their
status as they progress. Runs in the FastAPI lifespan task. The Modal /
shared-container backends override the runner with their own dispatch path;
local + self-hosted modes use this one.

Job types -> handler:
  - ingest                       -> core.ingest.ingest_source
  - batch_process_pages          -> dispatcher.submit (one BatchJobItem per page)
  - batch_ocr                    -> dispatcher.submit
  - batch_text_postprocess       -> CPU postprocess across pages
  - batch_extract_illustrations  -> CPU illustration extraction
  - build_package                -> core.packaging.build_package

This iteration wires `ingest`. Other types fall through to a "not yet wired"
error message; their tests slot in alongside.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

from ..adapters.database import IDatabase
from ..adapters.gpu import BatchJobItem, BatchJobResult, GPUBackend
from ..adapters.storage import IStorage
from ..dispatcher.base import IDispatcher
from ..dispatcher.batched import BatchDispatcher
from .illustrations import extract_illustration, regions_for_page
from .ingest import ingest_source
from .job_events import JobEventBroker
from .models import Job, JobStatus, JobType, PageRecord
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
    ) -> None:
        self._db = database
        self._storage = storage
        self._gpu = gpu
        self._dispatcher = dispatcher
        self._events = events
        self._poll = poll_interval
        self._max_concurrency = max(1, max_concurrency)
        # Jobs that handed themselves off to the dispatcher; _run_one should
        # NOT mark them complete on the way out — the dispatcher's completion
        # callback owns that transition.
        self._scheduled_jobs: set[str] = set()

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

    async def _on_dispatcher_flush(
        self, job_id: str, results: list[BatchJobResult]
    ) -> None:
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
        first_err = next(
            (r.error for r in results if not r.ok and r.error), None
        )
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
        """Loop until cancelled. Yields between iterations."""
        while True:
            try:
                await self.run_pending(max_jobs=8)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("InProcessJobRunner.run_pending iteration failed")
            await asyncio.sleep(self._poll)

    async def run_pending(self, *, max_jobs: int = 8) -> int:
        """Pick up at most `max_jobs` queued jobs and execute them.

        Up to `self._max_concurrency` jobs run in parallel; the rest queue
        behind them. Returns the count of jobs that started in this call
        (settles only once they all complete).
        """
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

        # Re-read so we preserve progress writes the handler made via _update_progress.
        latest = await self._db.get_job(job.id) or job
        await self._mark_complete(latest)

    async def _mark_complete(self, job: Job) -> None:
        updated = job.model_copy(
            update={
                "status": JobStatus.complete,
                "completed_at": datetime.now(UTC),
            }
        )
        await self._db.put_job(updated)
        await self._emit(updated)

    async def _mark_failed(self, job: Job, message: str) -> None:
        updated = job.model_copy(
            update={
                "status": JobStatus.error,
                "completed_at": datetime.now(UTC),
                "error_message": message,
            }
        )
        await self._db.put_job(updated)
        await self._emit(updated)

    async def _update_progress(
        self, job: Job, *, current: int, total: int, message: str = ""
    ) -> Job:
        progress = job.progress.model_copy(
            update={"current": current, "total": total, "message": message or job.progress.message}
        )
        updated = job.model_copy(update={"progress": progress})
        await self._db.put_job(updated)
        await self._emit(updated)
        return updated


# ─── Handlers ───────────────────────────────────────────────────────────────


async def _handle_ingest(runner: InProcessJobRunner, job: Job) -> None:
    """Run Step 0/1/2 for the job's project.

    The source key + source type are encoded in `job.progress.message` for
    now. A future iteration adds typed payload columns to the jobs table.
    """
    project = await runner._db.get_project(job.project_id)
    if project is None:
        raise FileNotFoundError(f"project {job.project_id} not found")

    source_key = job.progress.message
    if not source_key:
        raise ValueError("ingest job missing source_key in progress.message")

    source_type = "zip" if source_key.endswith(".zip") else "local_folder"

    async def _report(current: int, total: int, stem: str) -> None:
        await runner._update_progress(
            job, current=current, total=total, message=f"ingesting {stem}"
        )

    result = await ingest_source(
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
        message=f"ingested {result.page_count} pages, {len(result.errors)} errors",
    )


async def _handle_build_package(runner: InProcessJobRunner, job: Job) -> None:
    project = await runner._db.get_project(job.project_id)
    if project is None:
        raise FileNotFoundError(f"project {job.project_id} not found")
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
            await runner._storage.put_bytes(
                text_key, cleaned.encode("utf-8"), "text/plain"
            )
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
            key = (
                f"projects/{job.project_id}/hi_res/"
                f"{page.prefix}_{region.index:02d}.{ext}"
            )
            await runner._storage.put_bytes(key, crop, content_type)
            total += 1
    await runner._update_progress(
        job,
        current=total,
        total=total,
        message=f"extracted {total} illustrations, {len(errors)} errors",
    )


async def _handle_batch_process_pages(
    runner: InProcessJobRunner, job: Job
) -> None:
    await _run_batch_pages(runner, job, job_type="batch_process_pages")


async def _handle_batch_ocr(runner: InProcessJobRunner, job: Job) -> None:
    await _run_batch_pages(runner, job, job_type="batch_ocr")


async def _run_batch_pages(
    runner: InProcessJobRunner, job: Job, *, job_type: str
) -> None:
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
        await runner._update_progress(
            job, current=0, total=len(items), message=f"queued {len(items)} items"
        )
        await runner._db.put_job(
            job.model_copy(update={"status": JobStatus.scheduled})
        )
        # Skip _mark_complete in _run_one — the dispatcher owns this job now.
        runner._scheduled_jobs.add(job.id)
        return

    # Local / self-hosted: run inline.
    results = await runner._gpu.run_batch(items)
    ok_count = sum(1 for r in results if r.ok)
    err_count = len(results) - ok_count
    await runner._update_progress(
        job,
        current=ok_count,
        total=len(items),
        message=f"ok={ok_count} err={err_count}",
    )
    if err_count:
        first_err = next((r.error for r in results if not r.ok and r.error), "batch had errors")
        job.error_message = first_err
        await runner._db.put_job(job)


_HANDLERS = {
    JobType.ingest: _handle_ingest,
    JobType.build_package: _handle_build_package,
    JobType.batch_text_postprocess: _handle_text_postprocess,
    JobType.batch_extract_illustrations: _handle_extract_illustrations,
    JobType.batch_process_pages: _handle_batch_process_pages,
    JobType.batch_ocr: _handle_batch_ocr,
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
