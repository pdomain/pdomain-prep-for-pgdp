"""Tests-first for concurrent job execution.

Today `InProcessJobRunner.run_pending` runs jobs sequentially; an unzip
of a 400-page book blocks every other job behind it. The runner should
support a concurrency knob so independent jobs (different projects, or
different non-conflicting jobs on the same project) run in parallel.

Locks in:
  - `max_concurrency=1` (default) keeps existing behavior,
  - `max_concurrency=N` runs up to N queued jobs at once,
  - jobs running concurrently don't block each other,
  - the runner waits for all spawned jobs before returning.
"""

from __future__ import annotations

import asyncio
import time
from datetime import UTC, datetime

import pytest

from pd_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pd_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
from pd_prep_for_pgdp.core.models import (
    Job,
    JobStatus,
    JobType,
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)


def _project(project_id: str = "p1") -> Project:
    now = datetime.now(UTC)
    return Project(
        id=project_id,
        owner_id="default",
        name="t",
        created_at=now,
        updated_at=now,
        status=ProjectStatus.ingesting,
        page_count=0,
        proof_page_count=0,
        config=ProjectConfig(book_name="t", source_uri=""),
        pipeline_state=PipelineState(),
        storage_prefix=f"projects/{project_id}/",
    )


@pytest.fixture
async def db(tmp_path) -> SqliteDatabase:
    d = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await d.initialize()
    return d


@pytest.fixture
def storage(tmp_path) -> FilesystemStorage:
    return FilesystemStorage(root=tmp_path / "data")


async def _make_slow_handler(duration: float) -> tuple:
    """Return (handler, start_times) — handler logs entry time."""
    starts: list[float] = []

    async def handler(runner, job):
        starts.append(time.monotonic())
        await asyncio.sleep(duration)

    return handler, starts


@pytest.mark.asyncio
async def test_default_concurrency_is_sequential(db: SqliteDatabase, storage: FilesystemStorage) -> None:
    """Without a max_concurrency override, jobs run one-at-a-time."""
    from pd_prep_for_pgdp.core import job_runner as jr

    project = _project()
    await db.put_project(project)

    handler, starts = await _make_slow_handler(0.1)
    original = jr._HANDLERS.get(JobType.unzip)
    jr._HANDLERS[JobType.unzip] = handler
    try:
        for i in range(3):
            await db.put_job(
                Job(
                    id=f"j{i}",
                    project_id=project.id,
                    owner_id="default",
                    type=JobType.unzip,
                    status=JobStatus.queued,
                )
            )

        runner = jr.InProcessJobRunner(database=db, storage=storage)
        await runner.run_pending(max_jobs=3)

        # Sequential: each start is at least 0.08s after the previous (0.1s
        # handler with a small slack for asyncio scheduling).
        assert len(starts) == 3
        gaps = [starts[i + 1] - starts[i] for i in range(2)]
        assert all(g > 0.05 for g in gaps), f"expected sequential, got {gaps}"
    finally:
        if original is not None:
            jr._HANDLERS[JobType.unzip] = original


@pytest.mark.asyncio
async def test_max_concurrency_runs_jobs_in_parallel(db: SqliteDatabase, storage: FilesystemStorage) -> None:
    """`max_concurrency=3` lets all three jobs run at once."""
    from pd_prep_for_pgdp.core import job_runner as jr

    project = _project()
    await db.put_project(project)

    handler, starts = await _make_slow_handler(0.1)
    original = jr._HANDLERS.get(JobType.unzip)
    jr._HANDLERS[JobType.unzip] = handler
    try:
        for i in range(3):
            await db.put_job(
                Job(
                    id=f"jc{i}",
                    project_id=project.id,
                    owner_id="default",
                    type=JobType.unzip,
                    status=JobStatus.queued,
                )
            )

        runner = jr.InProcessJobRunner(database=db, storage=storage, max_concurrency=3)
        t0 = time.monotonic()
        await runner.run_pending(max_jobs=3)
        elapsed = time.monotonic() - t0

        # All three started within ~50ms of each other.
        assert len(starts) == 3
        spread = max(starts) - min(starts)
        assert spread < 0.05, f"jobs didn't run in parallel; spread={spread}"
        # Wall clock ≈ one handler duration, not three.
        assert elapsed < 0.25, f"too slow: {elapsed}s"
    finally:
        if original is not None:
            jr._HANDLERS[JobType.unzip] = original


@pytest.mark.asyncio
async def test_run_pending_waits_for_all_concurrent_jobs(
    db: SqliteDatabase, storage: FilesystemStorage
) -> None:
    """`run_pending` doesn't return until every spawned job has settled."""
    from pd_prep_for_pgdp.core import job_runner as jr

    project = _project()
    await db.put_project(project)
    handler, _starts = await _make_slow_handler(0.05)
    original = jr._HANDLERS.get(JobType.unzip)
    jr._HANDLERS[JobType.unzip] = handler
    try:
        for i in range(2):
            await db.put_job(
                Job(
                    id=f"jw{i}",
                    project_id=project.id,
                    owner_id="default",
                    type=JobType.unzip,
                    status=JobStatus.queued,
                )
            )

        runner = jr.InProcessJobRunner(database=db, storage=storage, max_concurrency=2)
        await runner.run_pending(max_jobs=2)

        for i in range(2):
            j = await db.get_job(f"jw{i}")
            assert j is not None
            assert j.status == JobStatus.complete
    finally:
        if original is not None:
            jr._HANDLERS[JobType.unzip] = original
