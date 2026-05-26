"""Tests for project-level action routes (M5 #11).

POST /api/data/projects/{id}/run-dirty
  - Returns 202 with job_id when project exists and user owns it.
  - Returns 404 when project not found or user mismatch.

POST /api/data/projects/{id}/build-package
  - Returns 202 with job_id when project exists and user owns it.
  - Returns 404 when project not found or user mismatch.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
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


def _seed_project(settings: Settings, project_id: str = "proj1") -> None:
    async def go() -> None:
        from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase

        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        project = Project(
            id=project_id,
            owner_id="default",
            name="test",
            created_at=now,
            updated_at=now,
            status=ProjectStatus.ingesting,
            page_count=0,
            proof_page_count=0,
            config=ProjectConfig(book_name="test", source_uri=""),
            pipeline_state=PipelineState(),
            storage_prefix=f"projects/{project_id}/",
        )
        await db.put_project(project)
        await db.close()

    asyncio.run(go())


# ─── run-dirty ─────────────────────────────────────────────────────────────


def test_run_dirty_returns_202_with_job_id(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed_project(settings, "rp1")
    app = build_app(settings)

    with TestClient(app) as client:
        r = client.post("/api/data/projects/rp1/run-dirty")
    assert r.status_code == 202, r.text
    body = r.json()
    assert "job_id" in body
    assert isinstance(body["job_id"], str)
    assert body["job_id"]


def test_run_dirty_submits_project_run_dirty_job_type(tmp_path) -> None:
    """The created job must have type project_run_dirty."""
    settings = _settings(tmp_path)
    _seed_project(settings, "rp2")
    app = build_app(settings)

    with TestClient(app) as client:
        r = client.post("/api/data/projects/rp2/run-dirty")
        assert r.status_code == 202, r.text
        job_id = r.json()["job_id"]

        # Fetch the job to confirm its type
        jobs_r = client.get("/api/gpu/jobs")
        assert jobs_r.status_code == 200
        jobs = {j["id"]: j for j in jobs_r.json()}
        assert job_id in jobs
        assert jobs[job_id]["type"] == "project_run_dirty"


def test_run_dirty_404_for_unknown_project(tmp_path) -> None:
    settings = _settings(tmp_path)
    app = build_app(settings)

    with TestClient(app) as client:
        r = client.post("/api/data/projects/no_such_project/run-dirty")
    assert r.status_code == 404


def test_run_dirty_accepts_stage_filter(tmp_path) -> None:
    """Optional stage_filter query param is stored in job payload."""
    settings = _settings(tmp_path)
    _seed_project(settings, "rp3")
    app = build_app(settings)

    with TestClient(app) as client:
        r = client.post("/api/data/projects/rp3/run-dirty?stage_filter=threshold")
        assert r.status_code == 202, r.text
        job_id = r.json()["job_id"]

        jobs_r = client.get("/api/gpu/jobs")
        jobs = {j["id"]: j for j in jobs_r.json()}
        assert jobs[job_id]["payload"]["stage_filter"] == "threshold"


# ─── build-package ─────────────────────────────────────────────────────────


def test_build_package_returns_202_with_job_id(tmp_path) -> None:
    settings = _settings(tmp_path)
    _seed_project(settings, "bp1")
    app = build_app(settings)

    with TestClient(app) as client:
        r = client.post("/api/data/projects/bp1/build-package")
    assert r.status_code == 202, r.text
    body = r.json()
    assert "job_id" in body
    assert isinstance(body["job_id"], str)
    assert body["job_id"]


def test_build_package_submits_build_package_job_type(tmp_path) -> None:
    """The created job must have type build_package."""
    settings = _settings(tmp_path)
    _seed_project(settings, "bp2")
    app = build_app(settings)

    with TestClient(app) as client:
        r = client.post("/api/data/projects/bp2/build-package")
        assert r.status_code == 202, r.text
        job_id = r.json()["job_id"]

        jobs_r = client.get("/api/gpu/jobs")
        assert jobs_r.status_code == 200
        jobs = {j["id"]: j for j in jobs_r.json()}
        assert job_id in jobs
        assert jobs[job_id]["type"] == "build_package"


def test_build_package_404_for_unknown_project(tmp_path) -> None:
    settings = _settings(tmp_path)
    app = build_app(settings)

    with TestClient(app) as client:
        r = client.post("/api/data/projects/no_such_project/build-package")
    assert r.status_code == 404
