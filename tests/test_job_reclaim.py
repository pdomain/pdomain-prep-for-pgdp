"""Work left running by a dead process does not stay running forever."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

import pytest
from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.job_runner import InProcessJobRunner
from pdomain_prep_for_pgdp.core.models import (
    Job,
    JobStatus,
    JobType,
    PageStageState,
    PageStageStatus,
    ProjectStageState,
    ProjectStageStatus,
)
from pdomain_prep_for_pgdp.core.pipeline.project_stages import ProjectStageStore
from pdomain_prep_for_pgdp.settings import Settings

if TYPE_CHECKING:
    from pathlib import Path


def _job(job_id: str, status: JobStatus, project_id: str = "p1") -> Job:
    return Job(
        id=job_id, project_id=project_id, owner_id="default", type=JobType.run_page_stage, status=status
    )


def _page_row(stage_id: str, status: PageStageStatus) -> PageStageState:
    return PageStageState(project_id="p1", page_id="0000", stage_id=stage_id, status=status)


@pytest.fixture
async def db(tmp_path: Path) -> SqliteDatabase:
    d = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await d.initialize()
    return d


def _runner(db: SqliteDatabase, tmp_path: Path) -> InProcessJobRunner:
    data_root = tmp_path / "data"
    return InProcessJobRunner(database=db, storage=FilesystemStorage(root=data_root), data_root=data_root)


@pytest.mark.asyncio
async def test_running_job_becomes_a_failed_job_with_a_reason(db: SqliteDatabase, tmp_path: Path) -> None:
    await db.put_job(_job("stuck", JobStatus.running))

    assert await _runner(db, tmp_path).reclaim_interrupted_jobs() == 1

    stored = await db.get_job("stuck")
    assert stored is not None
    assert stored.status == JobStatus.error
    assert stored.error_message is not None
    assert "interrupted" in stored.error_message
    assert stored.completed_at is not None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status", [JobStatus.queued, JobStatus.complete, JobStatus.error, JobStatus.cancelled]
)
async def test_jobs_not_running_are_left_alone(db: SqliteDatabase, tmp_path: Path, status: JobStatus) -> None:
    await db.put_job(_job("other", status))

    assert await _runner(db, tmp_path).reclaim_interrupted_jobs() == 0

    stored = await db.get_job("other")
    assert stored is not None
    assert stored.status == status
    assert stored.error_message is None


@pytest.mark.asyncio
async def test_page_stage_rows_of_a_reclaimed_project_stop_running(
    db: SqliteDatabase, tmp_path: Path
) -> None:
    await db.put_job(_job("stuck", JobStatus.running))
    await db.put_page_stage(_page_row("grayscale", PageStageStatus.running))
    await db.put_page_stage(_page_row("invert", PageStageStatus.clean))

    _ = await _runner(db, tmp_path).reclaim_interrupted_jobs()

    failed = await db.get_page_stage("p1", "0000", "grayscale")
    assert failed is not None
    assert failed.status == PageStageStatus.failed
    assert failed.error_message is not None
    untouched = await db.get_page_stage("p1", "0000", "invert")
    assert untouched is not None
    assert untouched.status == PageStageStatus.clean


@pytest.mark.asyncio
async def test_project_stage_rows_of_a_reclaimed_project_stop_running(
    db: SqliteDatabase, tmp_path: Path
) -> None:
    await db.put_job(_job("stuck", JobStatus.running))
    store_path = tmp_path / "data" / "projects" / "p1" / "project_stages.db"
    store_path.parent.mkdir(parents=True)
    store = ProjectStageStore(store_path)
    store.write(
        ProjectStageState(project_id="p1", stage_id="zip", status=ProjectStageStatus.running, job_id="stuck")
    )
    store.write(ProjectStageState(project_id="p1", stage_id="archive", status=ProjectStageStatus.clean))

    _ = await _runner(db, tmp_path).reclaim_interrupted_jobs()

    failed = store.read("p1", "zip")
    assert failed is not None
    assert failed.status == ProjectStageStatus.failed
    assert failed.error_message is not None
    untouched = store.read("p1", "archive")
    assert untouched is not None
    assert untouched.status == ProjectStageStatus.clean


@pytest.mark.asyncio
async def test_project_without_a_stage_store_does_not_get_one(db: SqliteDatabase, tmp_path: Path) -> None:
    await db.put_job(_job("stuck", JobStatus.running))

    _ = await _runner(db, tmp_path).reclaim_interrupted_jobs()

    assert not (tmp_path / "data" / "projects" / "p1").exists()


def test_app_start_reclaims_jobs_left_by_the_previous_process(tmp_path: Path) -> None:
    settings = Settings(
        data_root=tmp_path,
        gpu_backend="cpu",
        storage_backend="filesystem",
        dispatch_interval_seconds=0,
        auth_mode="none",
    )

    async def seed() -> None:
        database = SqliteDatabase(settings.derived_database_url)
        await database.initialize()
        await database.put_job(_job("stuck", JobStatus.running))
        await database.close()

    asyncio.run(seed())

    with TestClient(build_app(settings)) as client:
        body = client.get("/api/gpu/jobs/stuck").json()

    assert body["status"] == "error"
    assert "interrupted" in body["error_message"]
