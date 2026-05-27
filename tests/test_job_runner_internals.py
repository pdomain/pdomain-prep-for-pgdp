"""Lock in `core.job_runner.InProcessJobRunner` defensive paths.

Locks in:
  - `_on_dispatcher_flush` is a no-op when job_id is empty (anonymous
    dispatcher submissions),
  - `_on_dispatcher_flush` is a no-op when the referenced job has been
    purged (e.g. project deleted between submit and flush),
  - `run_forever` exits cleanly when `stop()` is called, even if no
    poll iteration ever runs (smoke test for the stop event).
  - `run_forever` survives a one-off exception thrown by `run_pending`
    and continues the next iteration.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import pytest
from pdomain_ops.gpu import BatchJobResult

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
from pdomain_prep_for_pgdp.core.job_runner import InProcessJobRunner
from pdomain_prep_for_pgdp.core.models import (
    Job,
    JobStatus,
    JobType,
    PipelineState,
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


@pytest.mark.asyncio
async def test_on_dispatcher_flush_ignores_empty_job_id(
    db: SqliteDatabase, storage: FilesystemStorage
) -> None:
    runner = InProcessJobRunner(database=db, storage=storage)
    # Should NOT raise — no_op when job_id is "".
    await runner._on_dispatcher_flush(
        "",
        [BatchJobResult(job_type="run_page_stage", project_id="x", idx0=0, ok=True)],
    )


@pytest.mark.asyncio
async def test_on_dispatcher_flush_ignores_missing_job(
    db: SqliteDatabase, storage: FilesystemStorage
) -> None:
    """If the job row was purged before the flush callback runs, we don't crash."""
    runner = InProcessJobRunner(database=db, storage=storage)
    await runner._on_dispatcher_flush(
        "ghost-job-id",
        [BatchJobResult(job_type="run_page_stage", project_id="x", idx0=0, ok=True)],
    )


@pytest.mark.asyncio
async def test_on_dispatcher_flush_marks_job_error_when_all_failed(
    db: SqliteDatabase, storage: FilesystemStorage
) -> None:
    """All-failed batch → JobStatus.error and the first error message wins."""
    now = datetime.now(UTC)
    project = Project(
        id="dp1",
        owner_id="default",
        name="t",
        created_at=now,
        updated_at=now,
        status=ProjectStatus.processing,
        page_count=2,
        proof_page_count=2,
        config=ProjectConfig(book_name="t", source_uri=""),
        pipeline_state=PipelineState(),
        storage_prefix="projects/dp1/",
    )
    await db.put_project(project)
    job = Job(
        id="j-flush",
        project_id="dp1",
        owner_id="default",
        type=JobType.build_package,
        status=JobStatus.scheduled,
    )
    await db.put_job(job)

    runner = InProcessJobRunner(database=db, storage=storage)
    await runner._on_dispatcher_flush(
        "j-flush",
        [
            BatchJobResult(job_type="build_package", project_id="dp1", idx0=0, ok=False, error="boom"),
            BatchJobResult(job_type="build_package", project_id="dp1", idx0=1, ok=False, error="boom2"),
        ],
    )

    refreshed = await db.get_job("j-flush")
    assert refreshed is not None
    assert refreshed.status == JobStatus.error
    assert refreshed.error_message == "boom"
    assert refreshed.progress.current == 0
    assert refreshed.progress.total == 2


@pytest.mark.asyncio
async def test_run_forever_exits_when_stop_set(db: SqliteDatabase, storage: FilesystemStorage) -> None:
    runner = InProcessJobRunner(database=db, storage=storage, poll_interval=10)
    task = asyncio.create_task(runner.run_forever())
    # Give it one tick to enter the loop, then ask it to stop.
    await asyncio.sleep(0.05)
    runner.stop()
    # Should return promptly because the stop wait is now satisfied.
    await asyncio.wait_for(task, timeout=2.0)


@pytest.mark.asyncio
async def test_run_forever_swallows_run_pending_exception(
    db: SqliteDatabase, storage: FilesystemStorage, monkeypatch
) -> None:
    """A buggy iteration shouldn't kill the runner — log and continue."""
    runner = InProcessJobRunner(database=db, storage=storage, poll_interval=0.05)

    calls = {"n": 0}

    async def boom(*, max_jobs: int = 8) -> int:
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("boom in run_pending")
        return 0

    monkeypatch.setattr(runner, "run_pending", boom)
    task = asyncio.create_task(runner.run_forever())
    # Wait long enough for at least 2 iterations.
    await asyncio.sleep(0.2)
    runner.stop()
    await asyncio.wait_for(task, timeout=2.0)
    assert calls["n"] >= 2  # exception was swallowed and we kept going


@pytest.mark.asyncio
async def test_run_forever_circuit_breaker_trips_after_max_failures(
    db: SqliteDatabase, storage: FilesystemStorage, monkeypatch
) -> None:
    """After _CIRCUIT_BREAKER_MAX consecutive run_pending failures, run_forever must raise."""

    runner = InProcessJobRunner(database=db, storage=storage, poll_interval=0.01)

    async def always_boom(*, max_jobs: int = 8) -> int:
        raise RuntimeError("persistent DB failure")

    monkeypatch.setattr(runner, "run_pending", always_boom)

    with pytest.raises(RuntimeError, match="circuit breaker"):
        await asyncio.wait_for(runner.run_forever(), timeout=5.0)


@pytest.mark.asyncio
async def test_run_forever_circuit_breaker_resets_on_success(
    db: SqliteDatabase, storage: FilesystemStorage, monkeypatch
) -> None:
    """A successful iteration resets the consecutive-failure counter."""
    from pdomain_prep_for_pgdp.core.job_runner import _CIRCUIT_BREAKER_MAX

    runner = InProcessJobRunner(database=db, storage=storage, poll_interval=0.01)

    calls: list[int] = []

    async def sometimes_boom(*, max_jobs: int = 8) -> int:
        n = len(calls)
        calls.append(n)
        # Fail for first (MAX-1) calls, then succeed, then stop.
        if n < _CIRCUIT_BREAKER_MAX - 1:
            raise RuntimeError("transient failure")
        if n == _CIRCUIT_BREAKER_MAX - 1:
            return 0  # success resets counter
        # After the reset, stop the loop so the test finishes.
        runner.stop()
        return 0

    monkeypatch.setattr(runner, "run_pending", sometimes_boom)

    # Should NOT raise: failures never reach MAX consecutively.
    await asyncio.wait_for(runner.run_forever(), timeout=5.0)
