"""Tests for `Settings.job_handler_timeout_seconds` + `InProcessJobRunner`'s
timeout-bounded handler dispatch.

`_run_one()` used to await the handler with no bound — a hung handler wedged
the job forever and held a concurrency slot. `job_handler_timeout_seconds`
(env `PGDP_JOB_HANDLER_TIMEOUT_SECONDS`) bounds the wait; on timeout the job
is marked failed and the slot is released.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import pytest

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
from pdomain_prep_for_pgdp.core import job_runner as _jr
from pdomain_prep_for_pgdp.core.job_runner import InProcessJobRunner
from pdomain_prep_for_pgdp.core.models import (
    Job,
    JobStatus,
    JobType,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.settings import Settings

if TYPE_CHECKING:
    from pathlib import Path

# ─── Settings ───────────────────────────────────────────────────────────────


def test_settings_job_handler_timeout_defaults_to_900(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("PGDP_JOB_HANDLER_TIMEOUT_SECONDS", raising=False)
    assert Settings().job_handler_timeout_seconds == 900.0


def test_settings_job_handler_timeout_env_var(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PGDP_JOB_HANDLER_TIMEOUT_SECONDS", "5")
    assert Settings().job_handler_timeout_seconds == 5.0


def test_settings_job_handler_timeout_none_disables() -> None:
    assert Settings(job_handler_timeout_seconds=None).job_handler_timeout_seconds is None


# ─── InProcessJobRunner ─────────────────────────────────────────────────────


@pytest.fixture
async def db(tmp_path: Path) -> SqliteDatabase:
    d = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await d.initialize()
    return d


@pytest.fixture
def storage(tmp_path: Path) -> FilesystemStorage:
    return FilesystemStorage(root=tmp_path / "data")


async def _seed_job(db: SqliteDatabase, job_id: str, project_id: str = "tproj") -> Job:
    now = datetime.now(UTC)
    await db.put_project(
        Project(
            id=project_id,
            owner_id="default",
            name=project_id,
            created_at=now,
            updated_at=now,
            status=ProjectStatus.processing,
            page_count=1,
            proof_page_count=1,
            config=ProjectConfig(book_name=project_id, source_uri=""),
            storage_prefix=f"projects/{project_id}/",
        )
    )
    job = Job(
        id=job_id,
        project_id=project_id,
        owner_id="default",
        type=JobType.run_project_stage,
        status=JobStatus.queued,
    )
    await db.put_job(job)
    return job


@pytest.mark.asyncio
async def test_run_one_marks_job_failed_on_handler_timeout(
    db: SqliteDatabase,
    storage: FilesystemStorage,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A handler that never returns is bounded by job_handler_timeout_seconds
    -- the job is marked failed instead of wedging forever."""

    async def _hangs_forever(runner: InProcessJobRunner, job: Job) -> None:
        del runner, job
        await asyncio.sleep(3600)

    monkeypatch.setitem(_jr._HANDLERS, JobType.run_project_stage, _hangs_forever)

    runner = InProcessJobRunner(
        database=db,
        storage=storage,
        data_root=tmp_path / "data",
        job_handler_timeout_seconds=0.05,
    )
    job = await _seed_job(db, "j-timeout")

    await runner._run_one(job)

    refreshed = await db.get_job("j-timeout")
    assert refreshed is not None
    assert refreshed.status == JobStatus.error
    assert "timed out" in (refreshed.error_message or "").lower()


@pytest.mark.asyncio
async def test_run_one_returns_promptly_after_timeout(
    db: SqliteDatabase,
    storage: FilesystemStorage,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """_run_one itself returns promptly on timeout -- run_pending's semaphore
    slot is released even though the underlying handler coroutine is still
    (conceptually) hung."""

    async def _hangs_forever(runner: InProcessJobRunner, job: Job) -> None:
        del runner, job
        await asyncio.sleep(3600)

    monkeypatch.setitem(_jr._HANDLERS, JobType.run_project_stage, _hangs_forever)

    runner = InProcessJobRunner(
        database=db,
        storage=storage,
        data_root=tmp_path / "data",
        job_handler_timeout_seconds=0.05,
    )
    job = await _seed_job(db, "j-timeout2")

    # Must not hang -- the outer wait_for is just a test-level safety net.
    await asyncio.wait_for(runner._run_one(job), timeout=2.0)


@pytest.mark.asyncio
async def test_run_one_disables_timeout_when_none(
    db: SqliteDatabase,
    storage: FilesystemStorage,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """job_handler_timeout_seconds=None -- unbounded wait (pre-fix behaviour);
    a fast handler still completes and marks the job complete as before."""
    calls = {"n": 0}

    async def _fast(runner: InProcessJobRunner, job: Job) -> None:
        del runner, job
        calls["n"] += 1

    monkeypatch.setitem(_jr._HANDLERS, JobType.run_project_stage, _fast)

    runner = InProcessJobRunner(
        database=db,
        storage=storage,
        data_root=tmp_path / "data",
        job_handler_timeout_seconds=None,
    )
    job = await _seed_job(db, "j-unbounded")

    await runner._run_one(job)

    assert calls["n"] == 1
    refreshed = await db.get_job("j-unbounded")
    assert refreshed is not None
    assert refreshed.status == JobStatus.complete
