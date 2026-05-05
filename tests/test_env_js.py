"""Tests-first for the runtime env.js shim.

Spec 09 §"Frontend bundling" says `window.__ENV__` is generated at startup
based on runtime env vars. The frontend SPA reads it from `/env.js`.

Locks in:
  - `GET /env.js` returns a JS shim that assigns `window.__ENV__ = {...}`,
  - in `apikey` mode the API token is injected into the shim,
  - in `none` auth mode the token is omitted (or empty).
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from pd_prep_for_pgdp.bootstrap import build_app
from pd_prep_for_pgdp.settings import Settings


def _settings(tmp_path, **kw) -> Settings:
    base = dict(
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
    base.update(kw)
    return Settings(**base)


def test_env_js_served_in_none_auth_mode(tmp_path) -> None:
    app = build_app(_settings(tmp_path))
    with TestClient(app) as client:
        r = client.get("/env.js")
        assert r.status_code == 200
        assert "application/javascript" in r.headers.get("content-type", "")
        body = r.text
        assert "window.__ENV__" in body
        assert "API_BASE" in body
        # No token in none mode.
        assert "API_TOKEN" not in body or "API_TOKEN: \"\"" in body or 'API_TOKEN: ""' in body


def test_env_js_includes_api_token_in_apikey_mode(tmp_path) -> None:
    app = build_app(
        _settings(tmp_path, auth_mode="apikey", api_key="secret-token-123")
    )
    with TestClient(app) as client:
        r = client.get("/env.js")
        assert r.status_code == 200
        body = r.text
        assert "secret-token-123" in body


def test_env_js_handles_jwt_mode_without_static_token(tmp_path) -> None:
    """In JWT mode the SPA gets the token from its own login flow, not env.js."""
    app = build_app(
        _settings(
            tmp_path,
            auth_mode="jwt",
            jwt_issuer="https://issuer.example",
            jwt_audience="pgdp-prep",
        )
    )
    with TestClient(app) as client:
        r = client.get("/env.js")
        assert r.status_code == 200
        body = r.text
        # AUTH_MODE flag tells the SPA which login flow to use.
        assert "jwt" in body
        # No static token leaks.
        assert "secret-token" not in body
