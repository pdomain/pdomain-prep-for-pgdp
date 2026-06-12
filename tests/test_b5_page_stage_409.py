"""B5 Group 3 — Registry-version 409 guard on page-stage routes.

Every page-stage route (list, run, artifact, thumbnail) returns 409 with
the structured registry_version_mismatch body for a v1 project.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    PageProcessingStatus,
    PageRecord,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.settings import Settings
from tests.fixtures.seed_pages import seed_pages_in_store


def _settings(tmp_path):
    return Settings(
        host="127.0.0.1",
        port=8765,
        data_root=tmp_path / "data",
        config_dir=tmp_path / "config",
        storage_backend="filesystem",
        database_url=f"sqlite:///{(tmp_path / 'state.db').as_posix()}",
        auth_mode="none",
        gpu_backend="cpu",
        dispatch_interval_seconds=0,
    )


def _seed_project(settings, project_id: str = "proj1", registry_version: int = 2) -> None:
    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
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
                registry_version=registry_version,
            )
        )
        await db.close()

    asyncio.run(go())
    seed_pages_in_store(
        settings,
        project_id,
        [
            PageRecord(
                project_id=project_id,
                idx0=0,
                prefix="p001",
                source_stem="src1",
                processing_status=PageProcessingStatus.pending,
            )
        ],
    )


# ─── 409 guard on page-stage routes for v1 projects ──────────────────────────


def test_list_page_stages_409_v1_project(tmp_path):
    """GET /pages/{idx0}/stages returns 409 for a v1 project."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1", registry_version=1)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/proj1/pages/0/stages")
    assert r.status_code == 409
    body = r.json()
    assert body["error"] == "registry_version_mismatch"
    assert body["project_version"] == 1
    assert body["server_version"] == 2


def test_run_page_stage_409_v1_project(tmp_path):
    """POST /pages/{idx0}/stages/{stage_id}/run returns 409 for a v1 project."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1", registry_version=1)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post("/api/data/projects/proj1/pages/0/stages/grayscale/run")
    assert r.status_code == 409
    body = r.json()
    assert body["error"] == "registry_version_mismatch"


def test_get_page_stage_artifact_409_v1_project(tmp_path):
    """GET /pages/{idx0}/stages/{stage_id}/artifact returns 409 for a v1 project."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1", registry_version=1)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/proj1/pages/0/stages/grayscale/artifact")
    assert r.status_code == 409
    body = r.json()
    assert body["error"] == "registry_version_mismatch"


def test_get_page_stage_thumbnail_409_v1_project(tmp_path):
    """GET /pages/{idx0}/stages/{stage_id}/thumbnail returns 409 for a v1 project."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1", registry_version=1)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/proj1/pages/0/stages/grayscale/thumbnail")
    assert r.status_code == 409
    body = r.json()
    assert body["error"] == "registry_version_mismatch"


# ─── V2 projects still work normally ─────────────────────────────────────────


def test_list_page_stages_v2_project_not_409(tmp_path):
    """GET /pages/{idx0}/stages returns 200 for a v2 project."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1", registry_version=2)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/proj1/pages/0/stages")
    assert r.status_code == 200
