"""In-process job runner.

Polls the `jobs` table, executes queued jobs in order, transitions their
status as they progress. Runs in the FastAPI lifespan task. The Modal /
shared-container backends override the runner with their own dispatch path;
local + self-hosted modes use this one.

Job types -> handler:
  - unzip                          -> core.ingest.unzip_source (chains a thumbnails job)
  - thumbnails                     -> core.ingest.generate_thumbnails
  - build_package                  -> core.packaging.build_package
  - run_page_stage                 -> core.pipeline.stage_runner.run_stage (async route)
  - project_run_dirty              -> fan-out: run every dirty stage on every page (M5)
  - project_run_stage_all_pages    -> run one stage on every dirty page (M5)
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Protocol, cast

from pd_prep_for_pgdp.dispatcher.batched import BatchDispatcher

from .ingest import generate_thumbnails, unzip_source
from .models import Job, JobStatus, JobType, PageStageStatus
from .packaging import build_package

if TYPE_CHECKING:
    from pathlib import Path

    from pd_prep_for_pgdp.adapters.database import IDatabase
    from pd_prep_for_pgdp.adapters.storage import IStorage
    from pd_prep_for_pgdp.dispatcher.base import IDispatcher
    from pd_prep_for_pgdp.dispatcher.batched import CompletionCallback

    from .job_events import JobEventBroker

    class GPUBackend(Protocol): ...

    class _FlushResult(Protocol):
        ok: bool
        error: str | None


log = logging.getLogger(__name__)

# After this many consecutive poll-iteration failures, run_forever raises instead
# of silently swallowing the error.  A transient blip resets the counter to 0.
_CIRCUIT_BREAKER_MAX = 5


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
        self._db: IDatabase = database
        self._storage: IStorage = storage
        self._gpu: GPUBackend | None = gpu
        self._data_root: Path | None = data_root
        self._dispatcher: IDispatcher | None = dispatcher
        self._events: JobEventBroker | None = events
        self._poll: float = poll_interval
        self._max_concurrency: int = max(1, max_concurrency)
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
        self._stop: asyncio.Event = asyncio.Event()

        # When a BatchDispatcher is provided, register a completion callback so
        # jobs whose items finish a flush are marked complete (or failed).
        if isinstance(dispatcher, BatchDispatcher):
            dispatcher.add_completion_callback(cast("CompletionCallback", self._on_dispatcher_flush))

    @property
    def db(self) -> IDatabase:
        return self._db

    @property
    def storage(self) -> IStorage:
        return self._storage

    def park_job(self, job_id: str) -> None:
        _ = self._parked_jobs.add(job_id)

    async def emit(self, job: Job) -> None:
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

    async def _on_dispatcher_flush(self, job_id: str, results: list[object]) -> None:
        if not job_id:
            return
        job = await self._db.get_job(job_id)
        if job is None:
            return
        typed_results = [cast("_FlushResult", r) for r in results]
        ok = sum(1 for r in typed_results if r.ok)
        err = len(results) - ok
        progress = job.progress.model_copy(
            update={
                "current": ok,
                "total": len(results),
                "message": f"ok={ok} err={err}",
            }
        )
        first_err = next((r.error for r in typed_results if not r.ok and r.error), None)
        updated = job.model_copy(
            update={
                "status": JobStatus.error if err and not ok else JobStatus.complete,
                "completed_at": datetime.now(UTC),
                "progress": progress,
                "error_message": first_err if err else job.error_message,
            }
        )
        await self._db.put_job(updated)
        await self.emit(updated)

    async def run_forever(self) -> None:
        """Loop until `stop()` is called or the task is cancelled.

        Polls the queue, sleeps `poll_interval`, repeats. Exits between
        iterations so we never tear down with a worker thread mid-SQLite
        call (that's a hard segfault when the connection is closed under it).

        Circuit breaker: after `_CIRCUIT_BREAKER_MAX` *consecutive* poll
        failures the loop re-raises instead of spinning forever as a silent
        no-op.  A single successful iteration resets the counter to zero.
        """
        consecutive_failures = 0
        while not self._stop.is_set():
            try:
                await self.run_pending(max_jobs=8)
                consecutive_failures = 0
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.exception("InProcessJobRunner.run_pending iteration failed")
                consecutive_failures += 1
                if consecutive_failures >= _CIRCUIT_BREAKER_MAX:
                    raise RuntimeError(
                        f"InProcessJobRunner circuit breaker tripped after {consecutive_failures} consecutive failures"
                    ) from exc
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

        _ = await asyncio.gather(*(_bounded(j) for j in slated))
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
        await self.emit(job)

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
            _ = self._scheduled_jobs.discard(job.id)
            return

        # If the handler parked the job in awaiting_review, skip complete —
        # the resume check will re-queue it when all pages are reviewed.
        if job.id in self._parked_jobs:
            _ = self._parked_jobs.discard(job.id)
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
            await self.emit(latest)
            return
        updated = job.model_copy(
            update={
                "status": JobStatus.complete,
                "completed_at": datetime.now(UTC),
            }
        )
        await self._db.put_job(updated)
        await self.emit(updated)

    async def _mark_failed(self, job: Job, message: str) -> None:
        latest = await self._db.get_job(job.id)
        if latest is not None and latest.status == JobStatus.cancelled:
            await self.emit(latest)
            return
        updated = job.model_copy(
            update={
                "status": JobStatus.error,
                "completed_at": datetime.now(UTC),
                "error_message": message,
            }
        )
        await self._db.put_job(updated)
        await self.emit(updated)

    async def update_progress(self, job: Job, *, current: int, total: int, message: str = "") -> Job:
        progress = job.progress.model_copy(
            update={"current": current, "total": total, "message": message or job.progress.message}
        )
        updated = job.model_copy(update={"progress": progress})
        await self._db.put_job(updated)
        await self.emit(updated)
        return updated


# ─── Handlers ───────────────────────────────────────────────────────────────


async def _handle_unzip(runner: InProcessJobRunner, job: Job) -> None:
    """Step 0: extract the zip / list the source folder, write PageRecords.

    The source key is encoded in `job.progress.message`. On success this
    handler enqueues a `thumbnails` job for the same project so the user
    sees the second stage as a separate progress bar.
    """
    project = await runner.db.get_project(job.project_id)
    if project is None:
        raise FileNotFoundError(f"project {job.project_id} not found")

    source_key = job.progress.message
    if not source_key:
        raise ValueError("unzip job missing source_key in progress.message")

    source_type = "zip" if source_key.endswith(".zip") else "local_folder"

    async def _report(current: int, total: int, stem: str) -> None:
        _ = await runner.update_progress(job, current=current, total=total, message=f"unzipping {stem}")

    result = await unzip_source(
        project=project,
        source_type=source_type,
        source_key=source_key,
        storage=runner.storage,
        database=runner.db,
        progress_cb=_report,
    )
    _ = await runner.update_progress(
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
        await runner.db.put_job(thumb_job)


async def _handle_thumbnails(runner: InProcessJobRunner, job: Job) -> None:
    """Step 2: generate thumbnails for every page that doesn't have one.

    Runs the entire batch in a single threadpool dispatch so cv2 stays warm
    — addresses the slowness the user observed on CPU when each page paid
    its own context-switch + library-init overhead.
    """
    project = await runner.db.get_project(job.project_id)
    if project is None:
        raise FileNotFoundError(f"project {job.project_id} not found")

    async def _report(current: int, total: int, stem: str) -> None:
        _ = await runner.update_progress(job, current=current, total=total, message=f"thumbnail {stem}")

    result = await generate_thumbnails(
        project=project,
        storage=runner.storage,
        database=runner.db,
        progress_cb=_report,
    )
    _ = await runner.update_progress(
        job,
        current=result.page_count,
        total=result.page_count,
        message=f"thumbnailed {result.page_count} pages, {len(result.errors)} errors",
    )


async def _handle_build_package(runner: InProcessJobRunner, job: Job) -> None:
    project = await runner.db.get_project(job.project_id)
    if project is None:
        raise FileNotFoundError(f"project {job.project_id} not found")

    if not await _all_pages_reviewed(runner.db, job.project_id):
        parked = job.model_copy(update={"status": JobStatus.awaiting_review})
        await runner.db.put_job(parked)
        await runner.emit(parked)
        runner.park_job(job.id)
        return

    pages, _, _ = await runner.db.list_pages(job.project_id, None, 1_000_000)
    result = await build_package(project=project, pages=pages, storage=runner.storage)
    _ = await runner.update_progress(
        job,
        current=result.page_count,
        total=result.page_count,
        message=f"package={result.package_key} bytes={result.bytes_written}",
    )


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
    page_id = str(payload["page_id"])
    stage_id = str(payload["stage_id"])
    device = str(payload.get("device", "cpu"))
    # data_root is not stashed on the runner; the route records it in the
    # payload so the handler is self-contained.
    data_root = Path(payload["data_root"])

    project = await runner.db.get_project(project_id)
    if project is None:
        raise FileNotFoundError(f"project {project_id!r} not found")
    # page_source_key: look it up from the DB rather than embedding in payload.
    # idx0 is derivable from page_id (zero-padded int).
    idx0 = int(page_id)
    page = await runner.db.get_page(project_id, idx0)
    page_source_key = page.source_key if page is not None else None

    await run_stage(
        data_root=data_root,
        database=runner.db,
        project_id=project_id,
        page_id=page_id,
        stage_id=stage_id,
        device=device,
        storage=runner.storage,
        page_source_key=page_source_key,
    )
    _ = await runner.update_progress(
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

    stage_filter = str(job.payload["stage_filter"]) if "stage_filter" in job.payload else None
    data_root = Path(str(job.payload.get("data_root", ".")))
    device = str(job.payload.get("device", "cpu"))

    project = await runner.db.get_project(job.project_id)
    if project is None:
        raise FileNotFoundError(f"project {job.project_id!r} not found")

    pages, _, _ = await runner.db.list_pages(job.project_id, None, 1_000_000)

    # Collect pages that have at least one dirty/not-run stage (honouring filter).
    dirty_statuses = {PageStageStatus.dirty, PageStageStatus.not_run}
    pages_with_work: list[tuple[str, list[str], str | None]] = []

    for page in pages:
        if page.ignore:
            continue
        page_id = f"{page.idx0:04d}"
        rows = await runner.db.list_page_stages_for_page(job.project_id, page_id)
        stage_ids = [
            r.stage_id
            for r in rows
            if r.status in dirty_statuses and (stage_filter is None or r.stage_id == stage_filter)
        ]
        if stage_ids:
            pages_with_work.append((page_id, stage_ids, page.source_key))

    total = len(pages_with_work)
    job = await runner.update_progress(job, current=0, total=total, message=f"dispatching {total} pages")

    parent_errors: list[str] = []

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
        await runner.db.put_job(child)

        # Run dirty stages in canonical DAG order.
        ordered = [sid for sid in PAGE_STAGE_IDS if sid in stage_ids]
        page_errors: list[str] = []
        for stage_id in ordered:
            try:
                await run_stage(
                    data_root=data_root,
                    database=runner.db,
                    project_id=job.project_id,
                    page_id=page_id,
                    stage_id=stage_id,
                    device=device,
                    storage=runner.storage,
                    page_source_key=page_source_key,
                )
            except Exception as exc:
                log.warning(
                    "page %s stage %s failed in project_run_dirty: %s",
                    page_id,
                    stage_id,
                    exc,
                    exc_info=True,
                )
                page_errors.append(f"{page_id}/{stage_id}: {exc!r}")

        child_ok = len(page_errors) == 0
        child_done = child.model_copy(
            update={
                "status": JobStatus.complete if child_ok else JobStatus.error,
                "completed_at": datetime.now(UTC),
                "error_message": "; ".join(page_errors) if page_errors else None,
            }
        )
        await runner.db.put_job(child_done)

        if not child_ok:
            parent_errors.append(f"page {i}/{total}: {'; '.join(page_errors)}")

        job = await runner.update_progress(
            job,
            current=i,
            total=total,
            message=f"completed {i}/{total} pages",
        )

    if parent_errors:
        raise RuntimeError(
            f"{len(parent_errors)}/{total} pages had failures: "
            + "; ".join(parent_errors[:5])
            + ("..." if len(parent_errors) > 5 else "")
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
    stage_id = str(job.payload["stage_id"])
    delegated = job.model_copy(update={"payload": {**job.payload, "stage_filter": stage_id}})
    await _handle_project_run_dirty(runner, delegated)


_HANDLERS = {
    JobType.unzip: _handle_unzip,
    JobType.thumbnails: _handle_thumbnails,
    JobType.build_package: _handle_build_package,
    JobType.run_page_stage: _handle_run_page_stage,
    JobType.project_run_dirty: _handle_project_run_dirty,
    JobType.project_run_stage_all_pages: _handle_project_run_stage_all_pages,
}


# ─── Helpers ────────────────────────────────────────────────────────────────


async def _distinct_owner_ids(db: IDatabase) -> list[str]:
    """Return the distinct owner_ids the runner should poll for pending jobs.

    Delegates to ``IDatabase.list_distinct_owner_ids()``, which returns
    ``["default"]`` for single-user local installs and a real DB query
    for multi-tenant adapters.
    """
    return list(await db.list_distinct_owner_ids())


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
