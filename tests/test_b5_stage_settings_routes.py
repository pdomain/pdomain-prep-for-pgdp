"""B5 Group 4 — Stage settings routes (api-v2-deltas §1.8).

Behaviors tested:
- GET .../stages/{stage_id}/settings → 200 returns effective settings dict
- PUT .../stages/{stage_id}/settings → 200 saves override, returns new effective
- POST .../settings/save-as-default → 200 saves as default, returns new effective
- POST .../settings/revert → 200 reverts override to default/registry
- POST .../settings/reset → 200 resets to registry default
- 422 for unknown v1 stage_id
- 409 for v1 project
- 404 for unknown project
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

# Use a v2 stage with known registry-default settings (denoise has min_component_area).
_STAGE_ID = "denoise"
# A v1-only stage ID that should be rejected.
_V1_ONLY = "ingest_source"


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


# ─── GET effective settings ──────────────────────────────────────────────────


def test_get_stage_settings_returns_dict(tmp_path):
    """GET .../settings returns a dict (effective settings)."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get(f"/api/data/projects/proj1/pages/0/stages/{_STAGE_ID}/settings")
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body, dict)


def test_get_stage_settings_404_unknown_project(tmp_path):
    """GET .../settings on unknown project → 404."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get(f"/api/data/projects/no-such/pages/0/stages/{_STAGE_ID}/settings")
    assert r.status_code == 404


def test_get_stage_settings_422_v1_stage_id(tmp_path):
    """GET .../settings with v1-only stage_id → 422."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get(f"/api/data/projects/proj1/pages/0/stages/{_V1_ONLY}/settings")
    assert r.status_code == 422


def test_get_stage_settings_409_v1_project(tmp_path):
    """GET .../settings on v1 project → 409 registry_version_mismatch."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1", registry_version=1)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get(f"/api/data/projects/proj1/pages/0/stages/{_STAGE_ID}/settings")
    assert r.status_code == 409
    assert r.json()["error"] == "registry_version_mismatch"


# ─── PUT override ────────────────────────────────────────────────────────────


def test_put_stage_settings_saves_override(tmp_path):
    """PUT .../settings saves the override and returns the new effective settings."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    override = {"min_component_area": 99}
    with TestClient(app) as client:
        r = client.put(
            f"/api/data/projects/proj1/pages/0/stages/{_STAGE_ID}/settings",
            json=override,
        )
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body, dict)
    # The returned effective settings must reflect the override.
    assert body.get("min_component_area") == 99


def test_put_stage_settings_override_reflected_on_get(tmp_path):
    """After PUT, GET returns the override as effective settings."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    override = {"min_component_area": 42}
    with TestClient(app) as client:
        client.put(
            f"/api/data/projects/proj1/pages/0/stages/{_STAGE_ID}/settings",
            json=override,
        )
        r = client.get(f"/api/data/projects/proj1/pages/0/stages/{_STAGE_ID}/settings")
    assert r.status_code == 200
    assert r.json().get("min_component_area") == 42


# ─── POST save-as-default ────────────────────────────────────────────────────


def test_post_save_as_default(tmp_path):
    """POST .../save-as-default saves as default, returns new effective."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    default_settings = {"min_component_area": 15}
    with TestClient(app) as client:
        r = client.post(
            f"/api/data/projects/proj1/pages/0/stages/{_STAGE_ID}/settings/save-as-default",
            json=default_settings,
        )
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body, dict)
    assert body.get("min_component_area") == 15


# ─── POST revert ─────────────────────────────────────────────────────────────


def test_post_revert_removes_override(tmp_path):
    """POST .../revert removes the override, reverts to default/registry."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    override = {"min_component_area": 777}
    with TestClient(app) as client:
        # Save an override.
        client.put(
            f"/api/data/projects/proj1/pages/0/stages/{_STAGE_ID}/settings",
            json=override,
        )
        # Verify override is applied.
        r_before = client.get(f"/api/data/projects/proj1/pages/0/stages/{_STAGE_ID}/settings")
        assert r_before.json().get("min_component_area") == 777

        # Revert.
        r_revert = client.post(f"/api/data/projects/proj1/pages/0/stages/{_STAGE_ID}/settings/revert")
    assert r_revert.status_code == 200
    body = r_revert.json()
    assert isinstance(body, dict)
    # After revert, override value must be gone.
    assert body.get("min_component_area") != 777


# ─── POST reset ──────────────────────────────────────────────────────────────


def test_post_reset_removes_both_tiers(tmp_path):
    """POST .../reset removes both override and default, reverts to registry."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        # Save a default.
        client.post(
            f"/api/data/projects/proj1/pages/0/stages/{_STAGE_ID}/settings/save-as-default",
            json={"min_component_area": 55},
        )
        # Save an override.
        client.put(
            f"/api/data/projects/proj1/pages/0/stages/{_STAGE_ID}/settings",
            json={"min_component_area": 99},
        )
        # Reset.
        r_reset = client.post(f"/api/data/projects/proj1/pages/0/stages/{_STAGE_ID}/settings/reset")
    assert r_reset.status_code == 200
    body = r_reset.json()
    assert isinstance(body, dict)
    # After reset, custom values must be gone.
    assert body.get("min_component_area") not in {55, 99}


# ─── 422 for v1 stage IDs ────────────────────────────────────────────────────


def test_put_stage_settings_422_v1_stage_id(tmp_path):
    """PUT with v1-only stage_id → 422."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.put(
            f"/api/data/projects/proj1/pages/0/stages/{_V1_ONLY}/settings",
            json={},
        )
    assert r.status_code == 422


# ─── Project-scoped stage settings (source) ──────────────────────────────────


# Use "source" as the canonical project-scoped stage for settings tests.
_SOURCE_STAGE_ID = "source"


def test_get_source_stage_settings_returns_dict(tmp_path):
    """GET .../stages/source/settings returns a dict (no page required)."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.get(f"/api/data/projects/proj1/pages/0/stages/{_SOURCE_STAGE_ID}/settings")
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body, dict)


def test_source_stage_save_as_default_and_get_roundtrip(tmp_path):
    """POST .../source/settings/save-as-default persists; GET returns saved value."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    saved = {"thumbQuality": "High", "workers": 6}
    with TestClient(app) as client:
        r_save = client.post(
            f"/api/data/projects/proj1/pages/0/stages/{_SOURCE_STAGE_ID}/settings/save-as-default",
            json=saved,
        )
        assert r_save.status_code == 200
        # Effective settings must reflect the saved default.
        r_get = client.get(f"/api/data/projects/proj1/pages/0/stages/{_SOURCE_STAGE_ID}/settings")
    assert r_get.status_code == 200
    body = r_get.json()
    assert body.get("thumbQuality") == "High"
    assert body.get("workers") == 6


def test_source_stage_settings_no_page_required(tmp_path):
    """source settings routes work even when no page records exist in the project."""
    settings = _settings(tmp_path)
    # Seed a project without seeding any pages.
    import asyncio
    from datetime import UTC, datetime

    from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
    from pdomain_prep_for_pgdp.core.models import (
        Project,
        ProjectConfig,
        ProjectStatus,
    )

    async def seed_project_only() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id="proj-nopage",
                owner_id="default",
                name="no-page-proj",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=0,
                proof_page_count=0,
                config=ProjectConfig(book_name="no-page-proj", source_uri=""),
                storage_prefix="projects/proj-nopage/",
                registry_version=2,
            )
        )
        await db.close()

    asyncio.run(seed_project_only())
    app = build_app(settings)
    with TestClient(app) as client:
        # GET should succeed even with no pages (idx0 is ignored for project stages).
        r = client.get(f"/api/data/projects/proj-nopage/pages/0/stages/{_SOURCE_STAGE_ID}/settings")
    assert r.status_code == 200
    assert isinstance(r.json(), dict)


def test_source_stage_settings_revert(tmp_path):
    """POST .../source/settings/revert removes the override."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        # Save a default, then put an override.
        client.post(
            f"/api/data/projects/proj1/pages/0/stages/{_SOURCE_STAGE_ID}/settings/save-as-default",
            json={"thumbQuality": "Standard"},
        )
        client.put(
            f"/api/data/projects/proj1/pages/0/stages/{_SOURCE_STAGE_ID}/settings",
            json={"thumbQuality": "High"},
        )
        # Revert removes the override; should fall back to saved default.
        r_revert = client.post(f"/api/data/projects/proj1/pages/0/stages/{_SOURCE_STAGE_ID}/settings/revert")
    assert r_revert.status_code == 200
    body = r_revert.json()
    # After revert, override is gone; saved default is "Standard".
    assert body.get("thumbQuality") == "Standard"


def test_source_stage_settings_reset(tmp_path):
    """POST .../source/settings/reset removes both override and saved default."""
    settings = _settings(tmp_path)
    _seed_project(settings, "proj1")
    app = build_app(settings)
    with TestClient(app) as client:
        client.post(
            f"/api/data/projects/proj1/pages/0/stages/{_SOURCE_STAGE_ID}/settings/save-as-default",
            json={"workers": 8},
        )
        r_reset = client.post(f"/api/data/projects/proj1/pages/0/stages/{_SOURCE_STAGE_ID}/settings/reset")
    assert r_reset.status_code == 200
    body = r_reset.json()
    # After reset, no custom value remains.
    assert body.get("workers") is None
