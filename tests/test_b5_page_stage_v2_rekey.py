"""B5 page-stage v2 re-key — §1.1 of api-v2-deltas.md.

Behaviors tested:
- GET /pages/{idx0}/stages returns exactly 16 v2 page-scoped stage IDs (not 22 v1).
- GET /pages/{idx0}/stages returns them in V2_PAGE_STAGE_IDS order (topological).
- POST /pages/{idx0}/stages/{v2_stage_id}/run accepts v2 stage IDs.
- POST /pages/{idx0}/stages/{v1_stage_id}/run → 422 for stage IDs not in v2.
- POST /pages/{idx0}/stages/{stage_id}/run accepts StageRunRequest body form.
- GET /pages/{idx0}/stages/{v2_stage_id}/artifact accepts v2 stage IDs.
- GET /pages/{idx0}/stages/{v1_only_stage_id}/artifact → 422 for v1-only IDs.
- GET /pages/{idx0}/stages/{v2_stage_id}/thumbnail accepts v2 stage IDs.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    V2_PAGE_STAGE_IDS,
    PageProcessingStatus,
    PageRecord,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.settings import Settings
from tests.fixtures.seed_pages import seed_pages_in_store

# A stage ID from v1 that does NOT exist in v2 (e.g. ingest_source, morph_fill).
_V1_ONLY_STAGE_ID = "ingest_source"
# A v2 stage that is a stage with known-placeholder impl (no artifact to serve).
_V2_PLACEHOLDER_STAGE = "wordcheck"


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


# ─── list_page_stages returns v2 IDs ────────────────────────────────────────


def test_list_page_stages_returns_16_v2_stage_ids(tmp_path):
    """GET /pages/{idx0}/stages returns exactly the 16 v2 page-scoped stage IDs."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/proj1/pages/0/stages")
    assert r.status_code == 200
    rows = r.json()
    returned_ids = [row["stage_id"] for row in rows]
    assert set(returned_ids) == set(V2_PAGE_STAGE_IDS)
    assert len(returned_ids) == len(V2_PAGE_STAGE_IDS)


def test_list_page_stages_v2_order(tmp_path):
    """GET /pages/{idx0}/stages returns stages in V2_PAGE_STAGE_IDS topological order."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/proj1/pages/0/stages")
    assert r.status_code == 200
    rows = r.json()
    returned_ids = [row["stage_id"] for row in rows]
    # All returned IDs must be from V2_PAGE_STAGE_IDS in the correct order.
    expected_order = [sid for sid in V2_PAGE_STAGE_IDS if sid in set(returned_ids)]
    assert returned_ids == expected_order


def test_list_page_stages_v2_no_v1_only_ids(tmp_path):
    """GET /pages/{idx0}/stages does NOT include v1-only IDs like ingest_source."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/proj1/pages/0/stages")
    assert r.status_code == 200
    rows = r.json()
    returned_ids = {row["stage_id"] for row in rows}
    assert _V1_ONLY_STAGE_ID not in returned_ids


# ─── run_page_stage accepts v2 stage IDs ────────────────────────────────────


def test_run_page_stage_v2_id_accepted(tmp_path):
    """POST .../stages/{v2_stage_id}/run is accepted (not 422)."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    # grayscale is a v2 stage with a real impl — dep (source) not met → 409 expected
    with TestClient(app) as client:
        r = client.post("/api/data/projects/proj1/pages/0/stages/grayscale/run")
    # 409 = deps not met (not 422 = unknown stage), so the stage_id was accepted
    assert r.status_code in {200, 409, 500, 501}


def test_run_page_stage_v1_only_id_rejected(tmp_path):
    """POST .../stages/{v1_only_stage_id}/run → 422 (v1 ID not valid in v2)."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(f"/api/data/projects/proj1/pages/0/stages/{_V1_ONLY_STAGE_ID}/run")
    assert r.status_code == 422


def test_run_page_stage_accepts_body_form(tmp_path):
    """POST .../run accepts StageRunRequest body (force, async fields)."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        # Send body with force=True; body accepted means not 422 from body validation.
        r = client.post(
            "/api/data/projects/proj1/pages/0/stages/grayscale/run",
            json={"force": True, "async": False},
        )
    # 409 = deps not met, body was parsed without error
    assert r.status_code in {200, 409, 500, 501}


def test_run_page_stage_accepts_async_body(tmp_path):
    """POST .../run with async=True (body) returns 202 Job (same as query param)."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            "/api/data/projects/proj1/pages/0/stages/grayscale/run",
            json={"async": True},
        )
    assert r.status_code == 202
    body = r.json()
    assert "id" in body
    assert "status" in body


# ─── artifact / thumbnail routes use v2 stage IDs ───────────────────────────


def test_get_page_stage_artifact_v2_id_accepted(tmp_path):
    """GET .../artifact for v2 stage ID is accepted (not 422)."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/proj1/pages/0/stages/grayscale/artifact")
    # 404 = no clean artifact yet — the stage_id was recognised
    assert r.status_code in {200, 404}


def test_get_page_stage_artifact_v1_only_id_rejected(tmp_path):
    """GET .../artifact for v1-only stage ID → 422."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get(f"/api/data/projects/proj1/pages/0/stages/{_V1_ONLY_STAGE_ID}/artifact")
    assert r.status_code == 422


def test_get_page_stage_thumbnail_v2_id_accepted(tmp_path):
    """GET .../thumbnail for v2 stage ID is accepted (not 422)."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get("/api/data/projects/proj1/pages/0/stages/grayscale/thumbnail")
    assert r.status_code in {200, 404}


def test_get_page_stage_thumbnail_v1_only_id_rejected(tmp_path):
    """GET .../thumbnail for v1-only stage ID → 422."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get(f"/api/data/projects/proj1/pages/0/stages/{_V1_ONLY_STAGE_ID}/thumbnail")
    assert r.status_code == 422
