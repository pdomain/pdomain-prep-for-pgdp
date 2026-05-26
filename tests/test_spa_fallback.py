"""Regression: client-side router paths must serve index.html.

The SPA uses React Router with paths like `/projects/<id>` and `/jobs`.
On a fresh page load (browser refresh, or Playwright `page.goto(...)`),
the server gets a GET for that path. Without a fallback, StaticFiles 404s
and the user sees the FastAPI error page instead of the app.

Lock in:
  - GET /projects/<id> returns the SPA index.html (HTML, 200),
  - GET /jobs returns the SPA index.html (HTML, 200),
  - GET /assets/<file> still resolves to a real bundled asset,
  - GET /api/data/projects still hits the API (does NOT serve index.html).
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.bootstrap import build_app
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


def _spa_built() -> bool:
    static = Path(__file__).resolve().parents[1] / "src" / "pdomain_prep_for_pgdp" / "static"
    return static.is_dir() and (static / "index.html").is_file()


pytestmark = pytest.mark.skipif(
    not _spa_built(),
    reason="SPA bundle not built — run `make frontend-build` to enable.",
)


def test_spa_fallback_serves_index_for_router_path(tmp_path) -> None:
    app = build_app(_settings(tmp_path))
    with TestClient(app) as client:
        for path in ("/projects/abc-123", "/jobs", "/projects/x/pages/0"):
            r = client.get(path)
            assert r.status_code == 200, path
            assert "text/html" in r.headers["content-type"], path
            # index.html has the Vite-injected /assets/index-*.js script tag.
            assert '<div id="root"' in r.text or "/assets/" in r.text


def test_static_assets_still_resolve(tmp_path) -> None:
    app = build_app(_settings(tmp_path))
    with TestClient(app) as client:
        # Pull the asset URL out of index.html so we don't hardcode the hash.
        idx = client.get("/").text
        # Find the first /assets/index-*.js or .css path.
        import re

        m = re.search(r"/assets/[A-Za-z0-9_.\-]+\.(?:js|css)", idx)
        assert m, idx[:500]
        asset_path = m.group(0)
        r = client.get(asset_path)
        assert r.status_code == 200
        assert "text/html" not in r.headers.get("content-type", "")


def test_api_routes_not_shadowed(tmp_path) -> None:
    app = build_app(_settings(tmp_path))
    with TestClient(app) as client:
        r = client.get("/api/data/projects")
        # Should be JSON 200 (auth_mode=none), NOT HTML index.html.
        assert r.status_code == 200
        assert "application/json" in r.headers["content-type"]
