"""A cancelled job stays cancelled whatever the runner writes afterwards."""

from __future__ import annotations

import io
import zipfile
from datetime import UTC, datetime
from typing import override

import numpy as np
import pytest
from pdomain_ops.gpu import BatchJobResult

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
from pdomain_prep_for_pgdp.core import job_runner as jr
from pdomain_prep_for_pgdp.core.job_events import JobEventBroker
from pdomain_prep_for_pgdp.core.job_runner import InProcessJobRunner
from pdomain_prep_for_pgdp.core.models import (
    Job,
    JobStatus,
    JobType,
    Project,
    ProjectConfig,
    ProjectStatus,
)


@pytest.fixture
async def db(tmp_path) -> SqliteDatabase:
    d = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await d.initialize()
    return d


@pytest.fixture
def storage(tmp_path) -> FilesystemStorage:
    return FilesystemStorage(root=tmp_path / "data")


def _project(project_id: str = "cp1") -> Project:
    now = datetime.now(UTC)
    return Project(
        id=project_id,
        owner_id="default",
        name="t",
        created_at=now,
        updated_at=now,
        status=ProjectStatus.processing,
        page_count=0,
        proof_page_count=0,
        config=ProjectConfig(book_name="t", source_uri=""),
        storage_prefix=f"projects/{project_id}/",
    )


@pytest.mark.asyncio
async def test_mark_complete_skips_already_cancelled_job(db, storage, tmp_path) -> None:
    """Simulate: user cancels DURING handler execution, then handler returns
    successfully. `_mark_complete` should leave the cancelled status alone."""
    runner = InProcessJobRunner(database=db, storage=storage, data_root=tmp_path / "data")
    job = Job(
        id="j-cmp",
        project_id="cp1",
        owner_id="default",
        type=JobType.run_project_stage,
        status=JobStatus.running,
    )
    await db.put_project(_project())
    await db.put_job(job)

    # User clicks Cancel mid-handler; the route writes status=cancelled.
    cancelled = job.model_copy(update={"status": JobStatus.cancelled})
    await db.put_job(cancelled)

    # Now the handler returns; runner tries to mark complete.
    await runner._mark_complete(job)

    refreshed = await db.get_job("j-cmp")
    assert refreshed is not None
    assert refreshed.status == JobStatus.cancelled


@pytest.mark.asyncio
async def test_mark_failed_skips_already_cancelled_job(db, storage, tmp_path) -> None:
    """Same idea: a handler that raises after a cancel should not overwrite
    cancelled status with error."""
    runner = InProcessJobRunner(database=db, storage=storage, data_root=tmp_path / "data")
    job = Job(
        id="j-fail",
        project_id="cp1",
        owner_id="default",
        type=JobType.run_project_stage,
        status=JobStatus.running,
    )
    await db.put_project(_project())
    await db.put_job(job)

    cancelled = job.model_copy(update={"status": JobStatus.cancelled})
    await db.put_job(cancelled)

    await runner._mark_failed(job, "handler raised after cancel")

    refreshed = await db.get_job("j-fail")
    assert refreshed is not None
    assert refreshed.status == JobStatus.cancelled
    # No error_message overlay either.
    assert refreshed.error_message is None


def _png() -> bytes:
    cv2 = pytest.importorskip("cv2")
    ok, buf = cv2.imencode(".png", np.full((50, 50, 3), 200, dtype=np.uint8))
    assert ok
    return bytes(buf.tobytes())


def _zip(names: list[str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in names:
            zf.writestr(name, _png())
    return buf.getvalue()


def _job(job_id: str, status: JobStatus, job_type: JobType = JobType.unzip) -> Job:
    return Job(id=job_id, project_id="p1", owner_id="default", type=job_type, status=status)


class _CancelOnFirstPageProgress(JobEventBroker):
    """Writes the cancel the way the route does, right after the first per-page report."""

    def __init__(self, db: SqliteDatabase, job_id: str) -> None:
        super().__init__()
        self._db: SqliteDatabase = db
        self._job_id: str = job_id
        self.cancelled: bool = False

    @override
    async def publish(self, job_id: str, event: dict[str, object]) -> None:
        await super().publish(job_id, event)
        if job_id != self._job_id or self.cancelled or event.get("current") != 1:
            return
        stored = await self._db.get_job(job_id)
        assert stored is not None
        stored.status = JobStatus.cancelled
        await self._db.put_job(stored)
        self.cancelled = True


@pytest.mark.asyncio
async def test_cancel_during_unzip_stays_cancelled_and_queues_no_thumbnails(
    db: SqliteDatabase, storage: FilesystemStorage, tmp_path
) -> None:
    await db.put_project(_project("p1"))
    source_key = "projects/p1/source.zip"
    await storage.put_bytes(source_key, _zip(["p1.png", "p2.png", "p3.png"]))
    job = _job("unzip-job", JobStatus.queued)
    job.progress.message = source_key
    await db.put_job(job)
    events = _CancelOnFirstPageProgress(db, job.id)
    runner = InProcessJobRunner(database=db, storage=storage, events=events, data_root=tmp_path / "data")

    _ = await runner.run_pending(max_jobs=1)

    assert events.cancelled
    stored = await db.get_job(job.id)
    assert stored is not None
    assert stored.status == JobStatus.cancelled
    assert stored.completed_at is None
    jobs = await db.list_recent_jobs("default", 10)
    assert [j.type for j in jobs if j.type == JobType.thumbnails] == []


@pytest.mark.asyncio
async def test_update_progress_returns_the_cancelled_row_and_keeps_it(
    db: SqliteDatabase, storage: FilesystemStorage, tmp_path
) -> None:
    stale = _job("j1", JobStatus.running)
    await db.put_job(stale)
    await db.put_job(stale.model_copy(update={"status": JobStatus.cancelled}))
    runner = InProcessJobRunner(database=db, storage=storage, data_root=tmp_path / "data")

    returned = await runner.update_progress(stale, current=1, total=2, message="late")

    assert returned.status == JobStatus.cancelled
    stored = await db.get_job("j1")
    assert stored is not None
    assert stored.status == JobStatus.cancelled


@pytest.mark.asyncio
async def test_job_cancelled_while_waiting_in_a_batch_never_runs(
    db: SqliteDatabase, storage: FilesystemStorage, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[str] = []

    async def handler(_runner: InProcessJobRunner, job: Job) -> None:
        calls.append(job.id)

    monkeypatch.setitem(jr._HANDLERS, JobType.unzip, handler)
    selected = _job("j2", JobStatus.queued)
    await db.put_job(selected.model_copy(update={"status": JobStatus.cancelled}))
    runner = InProcessJobRunner(database=db, storage=storage, data_root=tmp_path / "data")

    await runner._run_one(selected)

    assert calls == []
    stored = await db.get_job("j2")
    assert stored is not None
    assert stored.status == JobStatus.cancelled
    assert stored.started_at is None


@pytest.mark.asyncio
async def test_dispatcher_flush_does_not_overwrite_cancel(
    db: SqliteDatabase, storage: FilesystemStorage, tmp_path
) -> None:
    await db.put_job(_job("j3", JobStatus.cancelled))
    runner = InProcessJobRunner(database=db, storage=storage, data_root=tmp_path / "data")

    await runner._on_dispatcher_flush(
        "j3", [BatchJobResult(job_type="ocr", project_id="p1", idx0=0, ok=True)]
    )

    stored = await db.get_job("j3")
    assert stored is not None
    assert stored.status == JobStatus.cancelled


@pytest.mark.asyncio
async def test_update_job_unless_cancelled_refuses_only_cancelled_rows(db: SqliteDatabase) -> None:
    job = _job("j4", JobStatus.running)
    await db.put_job(job)

    assert await db.update_job_unless_cancelled(job.model_copy(update={"error_message": "x"})) is True
    stored = await db.get_job("j4")
    assert stored is not None
    assert stored.error_message == "x"

    await db.put_job(job.model_copy(update={"status": JobStatus.cancelled}))
    assert await db.update_job_unless_cancelled(job) is False
    stored = await db.get_job("j4")
    assert stored is not None
    assert stored.status == JobStatus.cancelled


@pytest.mark.asyncio
async def test_update_job_unless_cancelled_does_not_create_a_deleted_job(db: SqliteDatabase) -> None:
    assert await db.update_job_unless_cancelled(_job("gone", JobStatus.running)) is False
    assert await db.get_job("gone") is None
