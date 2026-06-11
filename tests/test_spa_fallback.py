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


# Applied per-test (NOT module-level) so the always-runs contract test
# below is never skipped in unbuilt checkouts/worktrees.
_requires_built_spa = pytest.mark.skipif(
    not _spa_built(),
    reason="SPA bundle not built — run `make frontend-build` to enable.",
)


@_requires_built_spa
def test_spa_fallback_serves_index_for_router_path(tmp_path) -> None:
    app = build_app(_settings(tmp_path))
    with TestClient(app) as client:
        for path in ("/projects/abc-123", "/jobs", "/projects/x/pages/0"):
            r = client.get(path)
            assert r.status_code == 200, path
            assert "text/html" in r.headers["content-type"], path
            # index.html has the Vite-injected /assets/index-*.js script tag.
            assert '<div id="root"' in r.text or "/assets/" in r.text


@_requires_built_spa
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


@_requires_built_spa
def test_api_routes_not_shadowed(tmp_path) -> None:
    app = build_app(_settings(tmp_path))
    with TestClient(app) as client:
        r = client.get("/api/data/projects")
        # Should be JSON 200 (auth_mode=none), NOT HTML index.html.
        assert r.status_code == 200
        assert "application/json" in r.headers["content-type"]


def test_unknown_api_path_is_404_json_not_index(tmp_path, monkeypatch) -> None:
    """An unknown /api/* path must 404 as JSON — never serve index.html.

    Runs with a fake built frontend (monkeypatch + tmp_path) so it never
    skips: the bug it locks out only manifests when a bundle is present
    (the SPA fallback used to serve index.html for any unknown path,
    masking deleted/renamed API routes as 200 text/html).
    """
    from importlib import resources as _resources

    from pdomain_prep_for_pgdp import bootstrap as _bootstrap

    fake_static = tmp_path / "static"
    fake_static.mkdir()
    (fake_static / "index.html").write_text('<div id="root"></div>')

    class _FakePkg:
        def joinpath(self, name: str):
            assert name == "static"
            return fake_static

    monkeypatch.setattr(_bootstrap, "resources", _resources, raising=True)
    monkeypatch.setattr(_bootstrap.resources, "files", lambda _pkg: _FakePkg(), raising=True)

    app = build_app(_settings(tmp_path))
    with TestClient(app, raise_server_exceptions=False) as client:
        # SPA still serves router paths.
        ok = client.get("/projects/abc-123")
        assert ok.status_code == 200
        assert "text/html" in ok.headers["content-type"]
        # Unknown API paths are 404 JSON, never the SPA index.
        for path in (
            "/api/data/projects/p1/review-status",
            "/api/data/projects/p1/no-such-route",
            "/api/nope",
        ):
            r = client.get(path)
            assert r.status_code == 404, path
            assert "text/html" not in r.headers.get("content-type", ""), path
