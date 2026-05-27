"""Phase 2.7b: Tests for pdomain-ops suite routes mounted via mount_routes().

Verifies that the pdomain-ops suite router is mounted in pdomain-prep-for-pgdp
so the frontend AppShell SuiteSiblingsProvider can call real endpoints
instead of the GAP-4 shims.

Routes under test:
  GET  /api/suite/installed   → list installed pd-* siblings
  POST /api/suite/launch      → launch a sibling app
  GET  /api/suite/prefs       → get UI prefs
  PUT  /api/suite/prefs/common → update common UI prefs (theme/density/fontScale)
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.settings import Settings


def _settings(tmp_path, **kw) -> Settings:
    base = {
        "host": "127.0.0.1",
        "port": 8765,
        "data_root": tmp_path / "data",
        "config_dir": tmp_path / "config",
        "storage_backend": "filesystem",
        "database_url": f"sqlite:///{(tmp_path / 's.db').as_posix()}",
        "gpu_backend": "cpu",
        "dispatch_interval_seconds": 0,
        "auth_mode": "none",
    }
    base.update(kw)
    return Settings(**base)


def test_suite_installed_returns_list(tmp_path) -> None:
    """GET /api/suite/installed → 200 with a JSON array (empty when no siblings)."""
    app = build_app(_settings(tmp_path))
    with TestClient(app) as client:
        r = client.get("/api/suite/installed")
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body, list)


def test_suite_launch_unknown_app_returns_404(tmp_path) -> None:
    """POST /api/suite/launch with unknown app_id → 404 (route is wired)."""
    app = build_app(_settings(tmp_path))
    with TestClient(app) as client:
        r = client.post("/api/suite/launch", params={"app_id": "unknown-app-xyz"})
        # 404 means the route exists and correctly rejects unknown app ids.
        assert r.status_code == 404


def test_suite_prefs_returns_prefs_object(tmp_path) -> None:
    """GET /api/suite/prefs → 200 with a JSON object containing common prefs."""
    app = build_app(_settings(tmp_path))
    with TestClient(app) as client:
        r = client.get("/api/suite/prefs")
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body, dict)
        # CommonUIPrefs fields are present under 'common'.
        assert "common" in body


def test_suite_prefs_common_update(tmp_path) -> None:
    """PUT /api/suite/prefs/common → 204 (accepts a common prefs update)."""
    app = build_app(_settings(tmp_path))
    with TestClient(app) as client:
        r = client.put(
            "/api/suite/prefs/common",
            json={"theme": "dark", "density": "normal", "font_scale": 1.0},
        )
        assert r.status_code == 204


def test_suite_installed_excluded_from_openapi_schema(tmp_path) -> None:
    """/api/suite/* routes appear in the OpenAPI schema (tags: suite)."""
    app = build_app(_settings(tmp_path))
    with TestClient(app) as client:
        schema = client.get("/openapi.json").json()
        paths = schema.get("paths", {})
        assert "/api/suite/installed" in paths
        assert "/api/suite/launch" in paths
