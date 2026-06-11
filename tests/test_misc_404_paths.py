"""Small 404 paths that fall outside the dedicated route test files.

- `GET /api/data/jobs/{id}` 404 for unknown / other-user job
  (api/data/jobs.py:36),
- `POST /api/gpu/ingest` 404 for unknown / other-user project
  (api/gpu/ingest.py:32).
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


def _seed_other_user_job(settings: Settings) -> None:
    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id="x1",
                owner_id="someone-else",
                name="t",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=0,
                proof_page_count=0,
                config=ProjectConfig(book_name="t", source_uri=""),
                pipeline_state=PipelineState(),
                storage_prefix="projects/x1/",
            )
        )
        await db.put_job(
            Job(
                id="stranger-job",
                project_id="x1",
                owner_id="someone-else",
                type=JobType.run_project_stage,
                status=JobStatus.queued,
            )
        )
        await db.close()

    asyncio.run(go())


def test_data_get_job_404_for_unknown(tmp_path) -> None:
    settings = _settings(tmp_path)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/jobs/no-such-job")
        assert r.status_code == 404


def test_data_get_job_404_for_other_user(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed_other_user_job(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/jobs/stranger-job")
        assert r.status_code == 404


def test_gpu_ingest_404_for_unknown_project(tmp_path) -> None:
    settings = _settings(tmp_path)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            "/api/gpu/ingest",
            json={"project_id": "no-such", "source_key": "x.zip", "source_type": "zip"},
        )
        assert r.status_code == 404


def test_gpu_ingest_404_for_other_user_project(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed_other_user_job(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            "/api/gpu/ingest",
            json={"project_id": "x1", "source_key": "x.zip", "source_type": "zip"},
        )
        assert r.status_code == 404
