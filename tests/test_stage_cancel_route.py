"""POST /api/data/projects/{id}/stages/{stage_id}/cancel stops work for one stage."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import pytest
from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
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
    from collections.abc import Iterator
    from pathlib import Path


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        data_root=tmp_path,
        gpu_backend="cpu",
        storage_backend="filesystem",
        dispatch_interval_seconds=0,
        auth_mode="none",
    )


def _job(
    job_id: str, job_type: JobType, status: JobStatus, stage_id: str | None, project_id: str = "p1"
) -> Job:
    payload: dict[str, object] = {} if stage_id is None else {"stage_id": stage_id, "page_id": "0000"}
    return Job(
        id=job_id, project_id=project_id, owner_id="default", type=job_type, status=status, payload=payload
    )


def _seed(settings: Settings, jobs: list[Job], owner_id: str = "default") -> None:
    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id="p1",
                owner_id=owner_id,
                name="t",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=1,
                proof_page_count=1,
                config=ProjectConfig(book_name="t", source_uri=""),
                storage_prefix="projects/p1/",
            )
        )
        for job in jobs:
            await db.put_job(job)
        await db.close()

    asyncio.run(go())


def _statuses(settings: Settings) -> dict[str, JobStatus]:
    async def go() -> dict[str, JobStatus]:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        jobs = await db.list_recent_jobs("default", 100)
        await db.close()
        return {j.id: j.status for j in jobs}

    return asyncio.run(go())


@pytest.fixture
def client(tmp_path: Path) -> Iterator[tuple[TestClient, Settings]]:
    settings = _settings(tmp_path)
    with TestClient(build_app(settings)) as c:
        yield c, settings


URL = "/api/data/projects/p1/stages/{}/cancel"


def test_cancels_active_page_stage_jobs_and_nothing_else(client: tuple[TestClient, Settings]) -> None:
    c, settings = client
    _seed(
        settings,
        [
            _job("queued", JobType.run_page_stage, JobStatus.queued, "grayscale"),
            _job("running", JobType.run_page_stage, JobStatus.running, "grayscale"),
            _job("done", JobType.run_page_stage, JobStatus.complete, "grayscale"),
            _job("other-stage", JobType.run_page_stage, JobStatus.queued, "invert"),
            _job("other-project", JobType.run_page_stage, JobStatus.queued, "grayscale", project_id="p2"),
        ],
    )

    r = c.post(URL.format("grayscale"))

    assert r.status_code == 200
    assert r.json() == {"cancelled": 2}
    statuses = _statuses(settings)
    assert statuses["queued"] == JobStatus.cancelled
    assert statuses["running"] == JobStatus.cancelled
    assert statuses["done"] == JobStatus.complete
    assert statuses["other-stage"] == JobStatus.queued
    assert statuses["other-project"] == JobStatus.queued


def test_cancels_project_stage_job(client: tuple[TestClient, Settings]) -> None:
    c, settings = client
    _seed(settings, [_job("proj", JobType.run_project_stage, JobStatus.queued, "build_package")])

    assert c.post(URL.format("build_package")).json() == {"cancelled": 1}
    assert _statuses(settings)["proj"] == JobStatus.cancelled


def test_ocr_cancel_covers_the_batch_job(client: tuple[TestClient, Settings]) -> None:
    c, settings = client
    _seed(settings, [_job("batch", JobType.run_project_ocr_batch, JobStatus.queued, None)])

    assert c.post(URL.format("ocr")).json() == {"cancelled": 1}
    assert _statuses(settings)["batch"] == JobStatus.cancelled


def test_nothing_active_is_a_zero_count_not_an_error(client: tuple[TestClient, Settings]) -> None:
    c, settings = client
    _seed(settings, [])

    r = c.post(URL.format("grayscale"))

    assert r.status_code == 200
    assert r.json() == {"cancelled": 0}


def test_unknown_stage_is_422(client: tuple[TestClient, Settings]) -> None:
    c, settings = client
    _seed(settings, [])

    assert c.post(URL.format("not-a-stage")).status_code == 422


def test_unknown_project_is_404(client: tuple[TestClient, Settings]) -> None:
    c, _settings_value = client

    assert c.post("/api/data/projects/missing/stages/grayscale/cancel").status_code == 404


def test_other_owners_project_is_404(client: tuple[TestClient, Settings]) -> None:
    c, settings = client
    _seed(settings, [], owner_id="someone-else")

    assert c.post(URL.format("grayscale")).status_code == 404
