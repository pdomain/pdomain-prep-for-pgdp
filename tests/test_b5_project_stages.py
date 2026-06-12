"""B5 Group 2 — Project-stage routes.

Behaviors tested:
- GET /projects/{id}/project-stages → 200 list (all V2_PROJECT_STAGE_IDS, lazy-init)
- GET /projects/{id}/project-stages/{stage_id} → 200 row shape
- GET /projects/{id}/project-stages/{stage_id} → 422 for unknown stage_id
- POST /projects/{id}/project-stages/{stage_id}/run → 202 with Job shape
- POST run on placeholder stage → Job with status=error + stage row failed
- POST run on unknown stage_id → 422
- 409 registry-version guard on list, get, and run routes
- GET /projects/{id}/project-stages/{stage_id}/artifact → 404 when not clean
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    V2_PROJECT_STAGE_IDS,
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


# ─── List / Get project-stage routes ─────────────────────────────────────────


def test_list_project_stages_returns_all_v2_ids(tmp_path):
    """GET /project-stages returns exactly the V2_PROJECT_STAGE_IDS set."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/proj1/project-stages")
    assert r.status_code == 200
    stage_ids = {s["stage_id"] for s in r.json()}
    assert stage_ids == set(V2_PROJECT_STAGE_IDS)


def test_list_project_stages_row_shape(tmp_path):
    """Each row has stage_id, status, and project_id."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/proj1/project-stages")
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) > 0
    first = rows[0]
    assert "stage_id" in first
    assert "status" in first
    assert "project_id" in first


def test_get_project_stage_200(tmp_path):
    """GET /project-stages/{stage_id} returns one row for a known stage."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    stage_id = V2_PROJECT_STAGE_IDS[0]
    with TestClient(app) as client:
        r = client.get(f"/api/data/projects/proj1/project-stages/{stage_id}")
    assert r.status_code == 200
    body = r.json()
    assert body["stage_id"] == stage_id
    assert body["project_id"] == "proj1"


def test_get_project_stage_422_unknown(tmp_path):
    """GET /project-stages/bogus → 422."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/proj1/project-stages/no-such-stage")
    assert r.status_code == 422


def test_list_project_stages_409_v1(tmp_path):
    """List route returns 409 for a v1 project."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1", registry_version=1)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/proj1/project-stages")
    assert r.status_code == 409
    body = r.json()
    assert body["error"] == "registry_version_mismatch"


def test_get_project_stage_409_v1(tmp_path):
    """Get route returns 409 for a v1 project."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1", registry_version=1)
    app = build_app(settings)
    stage_id = V2_PROJECT_STAGE_IDS[0]
    with TestClient(app) as client:
        r = client.get(f"/api/data/projects/proj1/project-stages/{stage_id}")
    assert r.status_code == 409


# ─── Run route ───────────────────────────────────────────────────────────────


def test_run_project_stage_202_job_shape(tmp_path):
    """POST /run returns 202 with a Job body."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    stage_id = V2_PROJECT_STAGE_IDS[0]
    with TestClient(app) as client:
        r = client.post(f"/api/data/projects/proj1/project-stages/{stage_id}/run")
    assert r.status_code == 202
    body = r.json()
    assert "id" in body
    assert "status" in body
    assert "type" in body


def test_run_project_stage_placeholder_returns_error_status(tmp_path, monkeypatch):
    """POST /run on an unimplemented stage sets job status=error, stage row failed.

    All 24 stages are implemented as of B4, so this simulates a placeholder by
    monkeypatching one stage's impl to raise StageNotImplemented — the route
    must surface a clean error state, never a 500.
    """
    from pdomain_prep_for_pgdp.core.models import ProjectStageState, ProjectStageStatus
    from pdomain_prep_for_pgdp.core.pipeline import stage_registry
    from pdomain_prep_for_pgdp.core.pipeline.project_stages import ProjectStageStore

    def _placeholder(*args: object, **kwargs: object) -> bytes:
        raise stage_registry.StageNotImplemented("validation: simulated placeholder")

    monkeypatch.setitem(stage_registry.V2_STAGE_IMPL["validation"], "cpu", _placeholder)
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")

    # W0.4: validation requires page_order (project-scoped) to be clean.
    # Seed the project stage store so the gate passes.
    db_path = settings.data_root / "projects" / "proj1" / "project_stages.db"
    db_path.parent.mkdir(parents=True, exist_ok=True)
    store = ProjectStageStore(db_path)
    store.write(ProjectStageState(project_id="proj1", stage_id="page_order", status=ProjectStageStatus.clean))

    app = build_app(settings)
    stage_id = "validation"
    with TestClient(app) as client:
        r = client.post(f"/api/data/projects/proj1/project-stages/{stage_id}/run")
    assert r.status_code == 202
    body = r.json()
    # Placeholder: job.status must be "error" (not "queued")
    assert body["status"] == "error"

    # Stage row should now be "failed".
    with TestClient(build_app(settings)) as client2:
        r2 = client2.get(f"/api/data/projects/proj1/project-stages/{stage_id}")
    assert r2.status_code == 200
    assert r2.json()["status"] == "failed"


def test_run_project_stage_422_unknown(tmp_path):
    """POST /run on unknown stage_id → 422."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post("/api/data/projects/proj1/project-stages/bogus-stage/run")
    assert r.status_code == 422


def test_run_project_stage_409_v1(tmp_path):
    """POST /run on v1 project → 409 registry_version_mismatch."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1", registry_version=1)
    app = build_app(settings)
    stage_id = V2_PROJECT_STAGE_IDS[0]
    with TestClient(app) as client:
        r = client.post(f"/api/data/projects/proj1/project-stages/{stage_id}/run")
    assert r.status_code == 409
    body = r.json()
    assert body["error"] == "registry_version_mismatch"


# ─── Artifact route ───────────────────────────────────────────────────────────


def test_get_project_stage_artifact_404_not_clean(tmp_path):
    """GET /artifact returns 404 when stage is not clean."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    stage_id = V2_PROJECT_STAGE_IDS[0]
    with TestClient(app) as client:
        r = client.get(f"/api/data/projects/proj1/project-stages/{stage_id}/artifact")
    assert r.status_code == 404
