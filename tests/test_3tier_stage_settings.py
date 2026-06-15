"""3-tier stage settings tests.

Tests:
1. Resolution precedence: page beats project beats all beats registry
2. Sparse page override: page override with only some fields set only overrides those fields
3. Per-page override round-trips through store API
4. Project default unaffected by a page override
5. App 'all' default read/write via AppWideStageSettings; resolves when no project/page set
6. AppWideStageSettings persistently stored and readable across instances
7. get_effective_3tier_with_sources returns correct tier labels per field
8. API routes: per-page GET/PUT/DELETE tier
9. API routes: app-wide GET/PUT/DELETE
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

# ── Pure unit tests (no web) ──────────────────────────────────────────────────


def test_resolve_effective_3tier_page_beats_all(tmp_path) -> None:
    """Page tier beats project, all, and registry."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import resolve_effective_3tier

    reg = {"a": 1, "b": 2}
    page = {"a": 99}
    project = {"a": 50, "b": 50}
    all_ = {"a": 30, "b": 30}

    result = resolve_effective_3tier(page, project, all_, reg)
    assert result == {"a": 99, "b": 50}  # a from page, b from project


def test_resolve_effective_3tier_project_beats_all(tmp_path) -> None:
    """Project tier beats all and registry."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import resolve_effective_3tier

    reg = {"a": 1, "b": 2}
    project = {"b": 50}
    all_ = {"a": 30, "b": 30}

    result = resolve_effective_3tier(None, project, all_, reg)
    assert result == {"a": 30, "b": 50}  # a from all, b from project


def test_resolve_effective_3tier_all_beats_registry(tmp_path) -> None:
    """All tier beats registry default."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import resolve_effective_3tier

    reg = {"a": 1, "b": 2}
    all_ = {"a": 99}

    result = resolve_effective_3tier(None, None, all_, reg)
    assert result == {"a": 99, "b": 2}  # a from all, b from registry


def test_resolve_effective_3tier_registry_only(tmp_path) -> None:
    """When no tiers set, registry default is returned."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import resolve_effective_3tier

    reg = {"a": 1, "b": 2}
    result = resolve_effective_3tier(None, None, None, reg)
    assert result == {"a": 1, "b": 2}


def test_sparse_page_override_does_not_override_unset_fields(tmp_path) -> None:
    """A page override with only some fields set only overrides those fields."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import resolve_effective_3tier

    reg = {"a": 1, "b": 2, "c": 3}
    page = {"b": 99}  # only b is set in page override
    project = {"a": 50}

    result = resolve_effective_3tier(page, project, None, reg)
    assert result["a"] == 50  # from project
    assert result["b"] == 99  # from page
    assert result["c"] == 3  # from registry


def test_resolve_effective_with_sources_labels(tmp_path) -> None:
    """resolve_effective_with_sources returns correct tier labels."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import resolve_effective_with_sources

    reg = {"a": 1, "b": 2, "c": 3, "d": 4}
    page = {"a": 10}
    project = {"b": 20}
    all_ = {"c": 30}

    effective, sources = resolve_effective_with_sources(page, project, all_, reg)
    assert effective == {"a": 10, "b": 20, "c": 30, "d": 4}
    assert sources == {"a": "page", "b": "project", "c": "all", "d": "registry"}


def test_store_save_page_override_and_read_back(tmp_path) -> None:
    """save_page_override persists and get_page_override reads it back."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import StageSettingsStore

    store = StageSettingsStore(tmp_path / "settings.db")
    store.save_page_override("proj1", "denoise", "0003", {"min_component_area": 99})
    result = store.get_page_override("proj1", "denoise", "0003")
    assert result == {"min_component_area": 99}


def test_store_get_effective_3tier_page_wins(tmp_path) -> None:
    """get_effective_3tier returns page values when page override is set."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import (
        AppWideStageSettings,
        StageSettingsStore,
    )

    store = StageSettingsStore(tmp_path / "settings.db")
    aw = AppWideStageSettings(tmp_path)
    reg = {"min_component_area": 6, "median_kernel_size": 0}

    store.save_as_default("proj1", "denoise", {"min_component_area": 20})
    aw.put("denoise", {"min_component_area": 10})
    store.save_page_override("proj1", "denoise", "0000", {"min_component_area": 99})

    result = store.get_effective_3tier("proj1", "denoise", "0000", registry_default=reg, app_wide=aw)
    assert result["min_component_area"] == 99  # page wins
    assert result["median_kernel_size"] == 0  # falls to registry (not set in any tier)


def test_store_get_effective_3tier_project_unaffected_by_page(tmp_path) -> None:
    """Project default is NOT affected by a page override."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import StageSettingsStore

    store = StageSettingsStore(tmp_path / "settings.db")
    reg = {"min_component_area": 6, "median_kernel_size": 0}

    store.save_as_default("proj1", "denoise", {"min_component_area": 20, "median_kernel_size": 1})
    store.save_page_override("proj1", "denoise", "0005", {"min_component_area": 99})

    # Project default should be unchanged
    proj_default = store.get_project_default("proj1", "denoise")
    assert proj_default == {"min_component_area": 20, "median_kernel_size": 1}

    # Page 5 has override
    result_p5 = store.get_effective_3tier("proj1", "denoise", "0005", registry_default=reg)
    assert result_p5["min_component_area"] == 99

    # Page 0 has no override — gets project default
    result_p0 = store.get_effective_3tier("proj1", "denoise", "0000", registry_default=reg)
    assert result_p0["min_component_area"] == 20


def test_app_wide_settings_persist_and_reload(tmp_path) -> None:
    """AppWideStageSettings persists across instances."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import AppWideStageSettings

    aw1 = AppWideStageSettings(tmp_path)
    aw1.put("grayscale", {"mode": "bt709", "gamma": 2.2})

    aw2 = AppWideStageSettings(tmp_path)
    stored = aw2.get("grayscale")
    assert stored == {"mode": "bt709", "gamma": 2.2}


def test_app_wide_settings_delete(tmp_path) -> None:
    """AppWideStageSettings.delete removes the stage settings."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import AppWideStageSettings

    aw = AppWideStageSettings(tmp_path)
    aw.put("denoise", {"min_component_area": 99})
    aw.delete("denoise")
    assert aw.get("denoise") is None


def test_app_wide_all_tier_resolves_when_no_project_page(tmp_path) -> None:
    """When no project/page tier, all-tier beats registry."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import (
        AppWideStageSettings,
        StageSettingsStore,
    )

    store = StageSettingsStore(tmp_path / "settings.db")
    aw = AppWideStageSettings(tmp_path)
    reg = {"min_component_area": 6, "median_kernel_size": 0}
    aw.put("denoise", {"min_component_area": 42})

    result = store.get_effective_3tier("proj1", "denoise", None, registry_default=reg, app_wide=aw)
    assert result["min_component_area"] == 42
    assert result["median_kernel_size"] == 0  # from registry


def test_delete_page_override_reverts_to_project(tmp_path) -> None:
    """delete_page_override causes page to fall through to project default."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import StageSettingsStore

    store = StageSettingsStore(tmp_path / "settings.db")
    reg = {"min_component_area": 6}

    store.save_as_default("proj1", "denoise", {"min_component_area": 20})
    store.save_page_override("proj1", "denoise", "0001", {"min_component_area": 99})

    # Confirm override
    assert (
        store.get_effective_3tier("proj1", "denoise", "0001", registry_default=reg)["min_component_area"]
        == 99
    )

    # Delete page override
    store.delete_page_override("proj1", "denoise", "0001")

    # Now falls back to project
    assert (
        store.get_effective_3tier("proj1", "denoise", "0001", registry_default=reg)["min_component_area"]
        == 20
    )


# ── API route tests ───────────────────────────────────────────────────────────


def _settings_for_test(tmp_path) -> Settings:
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


def _seed_project(settings: Settings, project_id: str = "proj1") -> None:
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
                registry_version=2,
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
                prefix="001",
                source_stem="page",
                processing_status=PageProcessingStatus.pending,
            )
        ],
    )


def test_api_page_tier_get_returns_empty_when_not_set(tmp_path) -> None:
    """GET .../settings/page returns {} when no page override is saved."""
    settings = _settings_for_test(tmp_path)
    _seed_project(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        resp = client.get("/api/data/projects/proj1/pages/0/stages/denoise/settings/page")
    assert resp.status_code == 200
    assert resp.json() == {}


def test_api_page_tier_put_and_get(tmp_path) -> None:
    """PUT .../settings/page saves page override; GET reads it back."""
    settings = _settings_for_test(tmp_path)
    _seed_project(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        # PUT page override (only min_component_area)
        resp = client.put(
            "/api/data/projects/proj1/pages/0/stages/denoise/settings/page",
            json={"min_component_area": 99},
        )
        assert resp.status_code == 200
        assert resp.json() == {"min_component_area": 99}

        # GET reads it back
        resp = client.get("/api/data/projects/proj1/pages/0/stages/denoise/settings/page")
        assert resp.status_code == 200
        assert resp.json() == {"min_component_area": 99}


def test_api_page_tier_delete_clears_override(tmp_path) -> None:
    """DELETE .../settings/page removes the page override."""
    settings = _settings_for_test(tmp_path)
    _seed_project(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        client.put(
            "/api/data/projects/proj1/pages/0/stages/denoise/settings/page",
            json={"min_component_area": 99},
        )
        resp = client.delete("/api/data/projects/proj1/pages/0/stages/denoise/settings/page")
        assert resp.status_code == 200

        resp = client.get("/api/data/projects/proj1/pages/0/stages/denoise/settings/page")
        assert resp.json() == {}


def test_api_resolved_returns_effective_and_sources(tmp_path) -> None:
    """GET .../settings/resolved returns effective + sources dict."""
    settings = _settings_for_test(tmp_path)
    _seed_project(settings)
    app = build_app(settings)
    with TestClient(app) as client:
        # Set a page override for min_component_area only
        client.put(
            "/api/data/projects/proj1/pages/0/stages/denoise/settings/page",
            json={"min_component_area": 77},
        )

        resp = client.get("/api/data/projects/proj1/pages/0/stages/denoise/settings/resolved")
        assert resp.status_code == 200
        data = resp.json()
        assert "effective" in data
        assert "sources" in data
        assert data["effective"]["min_component_area"] == 77
        assert data["sources"]["min_component_area"] == "page"
        assert data["sources"]["median_kernel_size"] == "registry"


def test_api_app_wide_get_and_put(tmp_path) -> None:
    """GET/PUT /settings/stages/{stage_id} reads/writes app-wide tier."""
    settings = _settings_for_test(tmp_path)
    app = build_app(settings)
    with TestClient(app) as client:
        # PUT app-wide
        resp = client.put("/api/data/settings/stages/denoise", json={"min_component_area": 42})
        assert resp.status_code == 200
        assert resp.json()["min_component_area"] == 42

        # GET reads it back
        resp = client.get("/api/data/settings/stages/denoise")
        assert resp.status_code == 200
        assert resp.json()["min_component_area"] == 42


def test_api_app_wide_delete(tmp_path) -> None:
    """DELETE /settings/stages/{stage_id} clears app-wide settings."""
    settings = _settings_for_test(tmp_path)
    app = build_app(settings)
    with TestClient(app) as client:
        client.put("/api/data/settings/stages/denoise", json={"min_component_area": 42})
        resp = client.delete("/api/data/settings/stages/denoise")
        assert resp.status_code == 200

        # After delete, GET returns registry default (min_component_area=6)
        resp = client.get("/api/data/settings/stages/denoise")
        assert resp.status_code == 200
        assert resp.json()["min_component_area"] == 6  # registry default


def test_api_app_wide_get_all_stages(tmp_path) -> None:
    """GET /settings/stages returns dict of all set app-wide stages."""
    settings = _settings_for_test(tmp_path)
    app = build_app(settings)
    with TestClient(app) as client:
        client.put("/api/data/settings/stages/denoise", json={"min_component_area": 42})
        client.put("/api/data/settings/stages/grayscale", json={"gamma": 2.2})

        resp = client.get("/api/data/settings/stages")
    assert resp.status_code == 200
    data = resp.json()
    assert "denoise" in data
    assert data["denoise"]["min_component_area"] == 42
    assert "grayscale" in data
    assert data["grayscale"]["gamma"] == 2.2


def test_api_app_wide_unknown_stage_422(tmp_path) -> None:
    """PUT /settings/stages/{bad_stage} returns 422."""
    settings = _settings_for_test(tmp_path)
    app = build_app(settings)
    with TestClient(app) as client:
        resp = client.put("/api/data/settings/stages/not_a_stage", json={"foo": 1})
    assert resp.status_code == 422


# ── Task 3.1: app-wide tier via pdomain-ops prefs ────────────────────────────


def test_app_wide_uses_prefs_not_json_file(tmp_path) -> None:
    """AppWideStageSettings writes through pdomain-ops LocalFilePrefs, not a JSON file.

    Proves:
    - Writing an app-wide setting stores it in the prefs file (ui-prefs.json),
      retrievable via LocalFilePrefs.read().apps["stage_settings.{stage_id}"].
    - No stage_settings_all.json file is created.
    - A second AppWideStageSettings instance reading from the same prefs root
      returns the value (persistence across instances).
    """
    from pdomain_ops.suite.prefs import LocalFilePrefs

    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import AppWideStageSettings

    prefs_root = tmp_path / "ui-prefs.json"

    aw = AppWideStageSettings(tmp_path, prefs_root=prefs_root)
    aw.put("grayscale", {"converter": "luma_bt709"})

    # 1. The legacy JSON file must NOT be created.
    legacy_json = tmp_path / "stage_settings_all.json"
    assert not legacy_json.exists(), "stage_settings_all.json must not be created; use prefs instead"

    # 2. The value must be readable via LocalFilePrefs at the same root.
    lf = LocalFilePrefs(root=prefs_root)
    apps = lf.read().apps
    assert "stage_settings.grayscale" in apps, (
        f"expected 'stage_settings.grayscale' key in prefs apps; got keys: {list(apps.keys())}"
    )
    assert apps["stage_settings.grayscale"] == {"converter": "luma_bt709"}

    # 3. A new AppWideStageSettings at the same root reads the value back.
    aw2 = AppWideStageSettings(tmp_path, prefs_root=prefs_root)
    stored = aw2.get("grayscale")
    assert stored == {"converter": "luma_bt709"}


def test_app_wide_prefs_migration_from_legacy_json(tmp_path) -> None:
    """On first read, if prefs key is absent but legacy JSON exists, the value is returned.

    The migration fallback reads from stage_settings_all.json when:
    - The prefs key is absent, AND
    - The legacy JSON file exists.
    This preserves existing app-wide settings across the prefs migration.
    """
    import json

    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import AppWideStageSettings

    prefs_root = tmp_path / "ui-prefs.json"
    legacy_json = tmp_path / "stage_settings_all.json"

    # Write a legacy JSON file as if it pre-existed.
    legacy_json.write_text(json.dumps({"denoise": {"min_component_area": 77}}))

    # No prefs file exists yet — AppWideStageSettings must fall back to the legacy JSON.
    aw = AppWideStageSettings(tmp_path, prefs_root=prefs_root)
    result = aw.get("denoise")
    assert result == {"min_component_area": 77}, f"expected fallback to legacy JSON, got: {result!r}"


def test_app_wide_prefs_delete_removes_prefs_key(tmp_path) -> None:
    """delete() removes the stage key from prefs; subsequent get() returns None."""
    from pdomain_ops.suite.prefs import LocalFilePrefs

    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import AppWideStageSettings

    prefs_root = tmp_path / "ui-prefs.json"

    aw = AppWideStageSettings(tmp_path, prefs_root=prefs_root)
    aw.put("denoise", {"min_component_area": 55})
    aw.delete("denoise")
    assert aw.get("denoise") is None

    # Verify the key is gone from the raw prefs file too.
    lf = LocalFilePrefs(root=prefs_root)
    apps = lf.read().apps
    assert "stage_settings.denoise" not in apps
