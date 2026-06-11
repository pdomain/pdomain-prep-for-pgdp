"""Auth + 404 paths on `GET /api/gpu/jobs/{id}/events`.

The happy-path SSE delivery is tested in `test_job_events_sse.py`; this
file fills the not-found / not-yours branches that exist for `/jobs/{id}`
and `/jobs/{id}/events` but aren't otherwise covered.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    Job,
    JobStatus,
    JobType,
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.settings import Settings


def _settings(tmp_path) -> Settings:
    return Settings(
        host="127.0.0.1",
        port=8765,
        data_root=tmp_path / "data",
        config_dir=tmp_path / "config",
        storage_backend="filesystem",
        database_url=f"sqlite:///{(tmp_path / 's.db').as_posix()}",
        gpu_backend="cpu",
        dispatch_interval_seconds=0,
        auth_mode="none",
    )


def _seed_other_user_job(settings: Settings, job_id: str) -> None:
    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id="je1",
                owner_id="someone-else",
                name="t",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=0,
                proof_page_count=0,
                config=ProjectConfig(book_name="t", source_uri=""),
                pipeline_state=PipelineState(),
                storage_prefix="projects/je1/",
            )
        )
        await db.put_job(
            Job(
                id=job_id,
                project_id="je1",
                owner_id="someone-else",
                type=JobType.run_project_stage,
                status=JobStatus.running,
            )
        )
        await db.close()

    asyncio.run(go())


def test_get_job_404_for_unknown_job(tmp_path) -> None:
    settings = _settings(tmp_path)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/gpu/jobs/no-such-job")
        assert r.status_code == 404


def test_get_job_404_for_other_users_job(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed_other_user_job(settings, "stranger-job")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/gpu/jobs/stranger-job")
        assert r.status_code == 404


def test_events_route_404_for_unknown_job(tmp_path) -> None:
    settings = _settings(tmp_path)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/gpu/jobs/no-such-job/events")
        assert r.status_code == 404


def test_events_route_404_for_other_users_job(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed_other_user_job(settings, "stranger-job-2")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/gpu/jobs/stranger-job-2/events")
        assert r.status_code == 404
