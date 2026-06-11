"""In-process job runner.

Polls the `jobs` table, executes queued jobs in order, transitions their
status as they progress. Runs in the FastAPI lifespan task. The Modal /
shared-container backends override the runner with their own dispatch path;
local + self-hosted modes use this one.

Job types -> handler:
  - unzip                -> core.ingest.unzip_source (chains a thumbnails job)
  - thumbnails           -> core.ingest.generate_thumbnails
  - run_page_stage       -> core.pipeline.stage_runner.run_stage (per-page async route)
  - run_project_stage    -> _handle_run_project_stage (W0.1 — project-scoped stages)

Deleted deprecated handlers (W6.3):
  - build_package              (replaced by run_project_stage for build_package stage)
  - project_run_dirty          (replaced by per-stage run routes)
  - project_run_stage_all_pages (replaced by per-stage run routes)
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Protocol, cast

from pdomain_prep_for_pgdp.dispatcher.batched import BatchDispatcher

from .ingest import generate_thumbnails, unzip_source
from .models import Job, JobStatus, JobType, PageStageStatus
from .page_service_helpers import list_page_records
from .page_store_factory import build_page_service

if TYPE_CHECKING:
    from pathlib import Path

    from pdomain_prep_for_pgdp.adapters.database import IDatabase
    from pdomain_prep_for_pgdp.adapters.storage import IStorage
    from pdomain_prep_for_pgdp.dispatcher.base import IDispatcher
    from pdomain_prep_for_pgdp.dispatcher.batched import CompletionCallback

    from .job_events import JobEventBroker
    from .stage_events import StageEventBroker

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
        stage_events: StageEventBroker | None = None,
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
        self._stage_events: StageEventBroker | None = stage_events
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
        """Re-queue any parked run_project_stage jobs whose pages are all reviewed.

        The awaiting_review state was previously used by the deprecated
        build_package job type. With W0.1 the new run_project_stage handler
        does not park jobs — it runs the stage directly. This method is kept
        as a no-op for now so the poll loop still calls it harmlessly.
        """

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

    # Defence-in-depth: validate the key is scoped to this project even if
    # the job was enqueued without going through the API route (e.g. direct
    # DB writes, migration scripts, or tests that bypass the ingest route).
    # We inline the prefix check here rather than importing from api/ to
    # avoid a circular import (api/ imports core/ which would re-import api/).
    _expected_prefix = f"projects/{job.project_id}/"
    if not source_key.lstrip("/").startswith(_expected_prefix):
        raise ValueError(f"source_key escapes project prefix: {source_key!r}")

    source_type = "zip" if source_key.endswith(".zip") else "local_folder"

    async def _report(current: int, total: int, stem: str) -> None:
        _ = await runner.update_progress(job, current=current, total=total, message=f"unzipping {stem}")

    if runner._data_root is None:
        raise RuntimeError("_handle_unzip: runner._data_root is required for event-store page creation")
    _ps_unzip = build_page_service(runner._data_root, job.project_id)
    result = await unzip_source(
        project=project,
        source_type=source_type,
        source_key=source_key,
        storage=runner.storage,
        database=runner.db,
        progress_cb=_report,
        page_service=_ps_unzip,
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

    if runner._data_root is None:
        raise RuntimeError(
            "_handle_thumbnails: runner._data_root is required for event-store thumbnail generation"
        )
    _ps_thumb = build_page_service(runner._data_root, job.project_id)
    result = await generate_thumbnails(
        project=project,
        storage=runner.storage,
        database=runner.db,
        progress_cb=_report,
        page_service=_ps_thumb,
    )
    _ = await runner.update_progress(
        job,
        current=result.page_count,
        total=result.page_count,
        message=f"thumbnailed {result.page_count} pages, {len(result.errors)} errors",
    )


async def _handle_run_project_stage(runner: InProcessJobRunner, job: Job) -> None:
    """Run a single project-scoped stage (W0.1 — replaces deprecated build_package /
    project_run_dirty / project_run_stage_all_pages handlers).

    Payload keys:
      - ``stage_id``:  canonical project-stage id from ``V2_PROJECT_STAGE_IDS``. Required.
      - ``device``:    ``"cpu"`` (default) or ``"cuda"``.

    The handler:
    1. Reads the stage impl from V2_STAGE_IMPL (already dispatched in the route layer).
    2. Collects ordered page_ids from the page store.
    3. Records StageRunStarted in PrepProjectAggregate (W2.1 partial — project-scoped).
    4. Calls the v2 stage callable in a thread pool (W0.3 — non-blocking event loop).
    5. Writes the artifact to the project stages directory.
    6. Dual-writes: artifact → ProjectStageStore row → SSE notification.
    7. Records StageRunCompleted or StageRunFailed in PrepProjectAggregate.

    For build_package specifically the event timestamp is passed as ``built_at``
    to ensure deterministic zip output (W0.5).

    Gate enforcement: already applied at the route layer (W0.4). The handler
    trusts the job was only enqueued after the gate passed.
    """
    import asyncio
    from datetime import UTC, datetime
    from pathlib import Path

    from .models import V2_PROJECT_STAGE_IDS, ProjectStageState, ProjectStageStatus
    from .pipeline.project_stages import ProjectStageStore
    from .pipeline.stage_registry import V2_STAGE_IMPL, StageNotImplemented

    payload = job.payload
    project_id = job.project_id
    stage_id = str(payload.get("stage_id", ""))
    device = str(payload.get("device", "cpu"))

    if stage_id not in V2_PROJECT_STAGE_IDS:
        raise ValueError(f"run_project_stage: invalid stage_id {stage_id!r}")

    project = await runner.db.get_project(project_id)
    if project is None:
        raise FileNotFoundError(f"project {project_id!r} not found")

    data_root: Path = runner._data_root or Path(".")

    # ── ProjectStageStore setup ───────────────────────────────────────────────
    db_path = data_root / "projects" / project_id / "project_stages.db"
    db_path.parent.mkdir(parents=True, exist_ok=True)
    store = ProjectStageStore(db_path)
    row = store.read(project_id, stage_id)
    if row is None:
        row = ProjectStageState(project_id=project_id, stage_id=stage_id)
        store.write(row)

    # ── Page list (for stages that need page_ids) ─────────────────────────────
    _ps = build_page_service(runner._data_root, project_id) if runner._data_root else None
    page_records = list_page_records(_ps, project_id) if _ps else []
    page_ids = [f"{p.idx0:04d}" for p in page_records if not p.ignore]

    # ── Resolve the callable ───────────────────────────────────────────────────
    impl_entry = V2_STAGE_IMPL.get(stage_id, {})
    impl_callable = impl_entry.get(device) or impl_entry.get("cpu")
    if impl_callable is None:
        raise ValueError(f"run_project_stage: no impl for stage {stage_id!r}")

    # ── W2.1: record StageRunStarted ──────────────────────────────────────────
    import uuid as _uuid

    started_at_dt = datetime.now(UTC)
    started_at_iso = started_at_dt.isoformat()
    try:
        from .pipeline.prep_aggregate import PrepApplication, PrepProjectAggregate

        _agg_app = PrepApplication(
            env={
                "PERSISTENCE_MODULE": "eventsourcing.sqlite",
                "SQLITE_DBNAME": str(data_root / "projects" / project_id / "events.db"),
            }
        )
        agg_id = _uuid.UUID(project_id) if len(project_id) == 36 else None
        if agg_id is not None:
            _agg_uuid = PrepProjectAggregate.create_id(agg_id)
            try:
                agg: PrepProjectAggregate = _agg_app.repository.get(_agg_uuid)  # type: ignore[assignment]
            except Exception:
                agg = PrepProjectAggregate(project_id=agg_id)
            agg.record_stage_run_started(
                stage_id=stage_id,
                page_id=None,
                job_id=job.id,
                actor_id=job.owner_id,
            )
            _agg_app.save(agg)
    except Exception as _e:  # pragma: no cover
        log.warning("StageRunStarted event failed (non-fatal): %s", _e)

    # ── Update store: running ─────────────────────────────────────────────────
    running_row = row.model_copy(
        update={
            "status": ProjectStageStatus.running,
            "job_id": job.id,
            "last_run_at": started_at_dt.timestamp(),
        }
    )
    store.write(running_row)

    # ── W3.3: project-stage-progress — "started" tick ────────────────────────
    if runner._stage_events is not None:
        try:
            await runner._stage_events.publish(
                f"project:{project_id}",
                {
                    "type": "project-stage-progress",
                    "stage_id": stage_id,
                    "progress": 0.0,
                    "message": f"stage {stage_id!r} started",
                },
            )
        except Exception as _ep0:  # pragma: no cover
            log.warning("W3.3 progress-started SSE failed (non-fatal): %s", _ep0)

    # ── W0.3: run impl in thread pool (non-blocking) ──────────────────────────
    artifact_dir = data_root / "projects" / project_id / "stages" / stage_id
    artifact_dir.mkdir(parents=True, exist_ok=True)

    from .pipeline.project_stages import _ARTIFACT_FILES

    artifact_filename = _ARTIFACT_FILES.get(stage_id, "output.json")
    artifact_path = artifact_dir / artifact_filename

    # Build kwargs for the callable — project-scoped stages share a common signature
    # but each may accept only a subset. We pass common kwargs and let the impl ignore extras.
    call_kwargs: dict[str, object] = {
        "project_id": project_id,
        "page_ids": page_ids,
        "data_root": data_root,
        "book_name": project.config.book_name if project.config else "",
        "cfg": None,
    }
    # W0.5 — built_at: pass started_at ISO timestamp for deterministic builds.
    if stage_id in ("build_package", "zip"):
        call_kwargs["built_at"] = started_at_iso

    start_ms = started_at_dt.timestamp() * 1000
    error_message: str | None = None
    artifact_key: str | None = None

    try:
        # Run in a thread pool to avoid blocking the async event loop (W0.3).
        # result is StageArtifact (bytes | ImageArray | str | …); we write
        # bytes directly and ignore non-bytes outputs for project stages.
        result_raw: object = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: impl_callable(**call_kwargs),  # type: ignore[operator]
        )
        result_bytes = result_raw if isinstance(result_raw, bytes) else b""

        # Write artifact to disk (dual-write step 1).
        artifact_path.write_bytes(result_bytes)
        artifact_key = str(artifact_path.relative_to(data_root))

        duration_ms = int(datetime.now(UTC).timestamp() * 1000 - start_ms)

        # Dual-write step 2: update ProjectStageStore row to clean.
        clean_row = row.model_copy(
            update={
                "status": ProjectStageStatus.clean,
                "artifact_key": artifact_key,
                "job_id": job.id,
                "last_run_at": started_at_dt.timestamp(),
                "duration_ms": duration_ms,
                "error_message": None,
            }
        )
        store.write(clean_row)

        # W3.3: project-stage-progress — "done" tick.
        if runner._stage_events is not None:
            try:
                await runner._stage_events.publish(
                    f"project:{project_id}",
                    {
                        "type": "project-stage-progress",
                        "stage_id": stage_id,
                        "progress": 1.0,
                        "message": f"stage {stage_id!r} done",
                    },
                )
            except Exception as _ep1:  # pragma: no cover
                log.warning("W3.3 progress-done SSE failed (non-fatal): %s", _ep1)

        # W3.2: validation-updated SSE after validation stage completes.
        if stage_id == "validation" and runner._stage_events is not None:
            try:
                import json as _json

                _val_data: dict[str, object] = {}
                if artifact_path.exists():
                    _raw = artifact_path.read_bytes()
                    _val_data = _json.loads(_raw)
                _blockers_raw = _val_data.get("blocker_count", 0)
                _warnings_raw = _val_data.get("warning_count", 0)
                _passed_raw = _val_data.get("passed", True)
                _blockers = int(_blockers_raw) if isinstance(_blockers_raw, int) else 0
                _warnings = int(_warnings_raw) if isinstance(_warnings_raw, int) else 0
                _passed = bool(_passed_raw) if isinstance(_passed_raw, bool) else (_blockers == 0)
                await runner._stage_events.publish(
                    f"project:{project_id}",
                    {
                        "type": "validation-updated",
                        "blockers": _blockers,
                        "warnings": _warnings,
                        "status": "clean" if _passed else "failed",
                    },
                )
            except Exception as _ev:  # pragma: no cover
                log.warning("W3.2 validation-updated SSE failed (non-fatal): %s", _ev)

        # W2.1: record StageRunCompleted.
        try:
            from .pipeline.prep_aggregate import PrepApplication, PrepProjectAggregate

            _agg_app2 = PrepApplication(
                env={
                    "PERSISTENCE_MODULE": "eventsourcing.sqlite",
                    "SQLITE_DBNAME": str(data_root / "projects" / project_id / "events.db"),
                }
            )
            agg_id2 = _uuid.UUID(project_id) if len(project_id) == 36 else None
            if agg_id2 is not None:
                _agg_uuid2 = PrepProjectAggregate.create_id(agg_id2)
                try:
                    agg2: PrepProjectAggregate = _agg_app2.repository.get(_agg_uuid2)  # type: ignore[assignment]
                except Exception:
                    agg2 = PrepProjectAggregate(project_id=agg_id2)
                agg2.record_stage_run_completed(
                    stage_id=stage_id,
                    page_id=None,
                    status="clean",
                    duration_ms=duration_ms,
                    artifact_key=artifact_key,
                    actor_id=job.owner_id,
                )
                _agg_app2.save(agg2)
        except Exception as _e2:  # pragma: no cover
            log.warning("StageRunCompleted event failed (non-fatal): %s", _e2)

        _ = await runner.update_progress(
            job,
            current=1,
            total=1,
            message=f"stage {stage_id!r} completed in {duration_ms}ms",
        )

    except StageNotImplemented as exc:
        # Stage has a placeholder impl — surface as failed, not crash.
        error_message = str(exc)
        duration_ms = int(datetime.now(UTC).timestamp() * 1000 - start_ms)
        failed_row = row.model_copy(
            update={
                "status": ProjectStageStatus.failed,
                "error_message": error_message,
                "job_id": job.id,
                "last_run_at": started_at_dt.timestamp(),
                "duration_ms": duration_ms,
            }
        )
        store.write(failed_row)
        raise

    except Exception as exc:
        error_message = str(exc)
        duration_ms = int(datetime.now(UTC).timestamp() * 1000 - start_ms)
        failed_row = row.model_copy(
            update={
                "status": ProjectStageStatus.failed,
                "error_message": error_message,
                "job_id": job.id,
                "last_run_at": started_at_dt.timestamp(),
                "duration_ms": duration_ms,
            }
        )
        store.write(failed_row)

        # W3.2: validation-updated SSE on failure — frontend needs to know validation ran.
        if stage_id == "validation" and runner._stage_events is not None:
            try:
                await runner._stage_events.publish(
                    f"project:{project_id}",
                    {
                        "type": "validation-updated",
                        "blockers": 0,
                        "warnings": 0,
                        "status": "failed",
                    },
                )
            except Exception as _ev_fail:  # pragma: no cover
                log.warning("W3.2 validation-updated SSE (failure) failed (non-fatal): %s", _ev_fail)

        # W2.1: record StageRunFailed.
        try:
            from .pipeline.prep_aggregate import PrepApplication, PrepProjectAggregate

            _agg_app3 = PrepApplication(
                env={
                    "PERSISTENCE_MODULE": "eventsourcing.sqlite",
                    "SQLITE_DBNAME": str(data_root / "projects" / project_id / "events.db"),
                }
            )
            agg_id3 = _uuid.UUID(project_id) if len(project_id) == 36 else None
            if agg_id3 is not None:
                _agg_uuid3 = PrepProjectAggregate.create_id(agg_id3)
                try:
                    agg3: PrepProjectAggregate = _agg_app3.repository.get(_agg_uuid3)  # type: ignore[assignment]
                except Exception:
                    agg3 = PrepProjectAggregate(project_id=agg_id3)
                agg3.record_stage_run_failed(
                    stage_id=stage_id,
                    page_id=None,
                    error_message=error_message,
                    duration_ms=duration_ms,
                    actor_id=job.owner_id,
                )
                _agg_app3.save(agg3)
        except Exception as _e3:  # pragma: no cover
            log.warning("StageRunFailed event failed (non-fatal): %s", _e3)

        raise


async def _handle_run_page_stage(runner: InProcessJobRunner, job: Job) -> None:
    """Run a single per-page stage via the async route (?async=true).

    Payload keys:
      - ``page_id``:    zero-padded 4-digit string (e.g. ``"0000"``). Required.
      - ``stage_id``:   canonical stage id from ``V2_PAGE_STAGE_IDS``. Required.
      - ``device``:     ``"cpu"`` (default) or ``"cuda"``. Safe to override on retry.

    Identity fields (``project_id``, ``data_root``) are intentionally NOT read
    from the payload — see Issue #126. ``project_id`` comes from ``job.project_id``
    (the authoritative DB column); ``data_root`` comes from ``runner._data_root``
    (Settings-injected at construction time). This prevents payload-injection
    attacks even if the retry route's allowlist is bypassed.

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
    # Issue #126 defence-in-depth: use job.project_id (authoritative DB row),
    # NOT payload.get("project_id"). The retry route's allowlist already blocks
    # project_id overrides, but the handler must be self-hardened too.
    project_id = job.project_id
    page_id = str(payload["page_id"])
    stage_id = str(payload["stage_id"])
    device = str(payload.get("device", "cpu"))
    # Issue #126 defence-in-depth: derive data_root from runner._data_root
    # (Settings-injected at construction time via bootstrap.py), NOT from
    # payload["data_root"]. Prevents path-traversal even if the allowlist is bypassed.
    if runner._data_root is not None:
        data_root = runner._data_root
    else:
        # Fallback: runner constructed without data_root (legacy/test path).
        # Read from payload only as last resort, raising clearly if absent.
        raw = payload.get("data_root")
        if raw is None:
            raise ValueError("run_page_stage: runner has no data_root and payload is missing data_root")
        data_root = Path(str(raw))

    project = await runner.db.get_project(project_id)
    if project is None:
        raise FileNotFoundError(f"project {project_id!r} not found")
    # page_source_key: look it up from the DB rather than embedding in payload.
    # idx0 is derivable from page_id (zero-padded int).
    page_source_key = None  # source_key is not stored in event store; stage loads from BlobStore

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


_HANDLERS = {
    JobType.unzip: _handle_unzip,
    JobType.thumbnails: _handle_thumbnails,
    JobType.run_page_stage: _handle_run_page_stage,
    JobType.run_project_stage: _handle_run_project_stage,
}


# ─── Helpers ────────────────────────────────────────────────────────────────


async def _distinct_owner_ids(db: IDatabase) -> list[str]:
    """Return the distinct owner_ids the runner should poll for pending jobs.

    Delegates to ``IDatabase.list_distinct_owner_ids()``, which returns
    ``["default"]`` for single-user local installs and a real DB query
    for multi-tenant adapters.
    """
    return list(await db.list_distinct_owner_ids())


async def _all_pages_reviewed(db: IDatabase, project_id: str, data_root=None) -> bool:
    """True when every non-ignored page has a clean text_review stage row."""
    if data_root is not None:
        _ps = build_page_service(data_root, project_id)
        pages = list_page_records(_ps, project_id)
    else:
        pages = []
    proof_pages = [p for p in pages if not p.ignore]
    if not proof_pages:
        return True
    proof_page_ids = {f"{p.idx0:04d}" for p in proof_pages}
    clean_stages = await db.list_page_stages_by_status(project_id, PageStageStatus.clean)
    reviewed_ids = {s.page_id for s in clean_stages if s.stage_id == "text_review"}
    return proof_page_ids <= reviewed_ids
