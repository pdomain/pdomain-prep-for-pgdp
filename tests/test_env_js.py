"""Tests for the /env.js runtime shim (spec 09 §"Frontend bundling")."""

from __future__ import annotations

import httpx
import pytest

from pd_prep_for_pgdp.bootstrap import build_app
from pd_prep_for_pgdp.settings import Settings


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


# TestClient uses an anyio blocking portal in a separate thread; on machines
# with cupy/CUDA loaded this races with C-extension teardown and segfaults.
# httpx.AsyncClient + ASGITransport runs in the existing pytest-asyncio event
# loop and avoids the threading portal entirely.


@pytest.mark.anyio
async def test_env_js_served_in_none_auth_mode(tmp_path) -> None:
    app = build_app(_settings(tmp_path))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/env.js")
    assert r.status_code == 200
    assert "application/javascript" in r.headers.get("content-type", "")
    body = r.text
    assert "window.__ENV__" in body
    assert "API_BASE" in body
    assert "API_TOKEN" not in body


@pytest.mark.anyio
async def test_env_js_does_not_leak_bearer_in_apikey_mode(tmp_path) -> None:
    """Security: /env.js must never expose the server API key to unauthenticated browsers.

    The bearer secret is for server-to-server calls only.  Any visitor — including
    cross-origin pages via <script src="/env.js"> — can read this endpoint, so
    embedding the secret here means anyone can impersonate the server.

    Fix: strip API_TOKEN from the runtime-config payload.  The frontend must obtain
    authentication through a separate, authenticated flow (e.g. server-side session
    cookie) rather than reading the raw bearer from window.__ENV__.

    Auth-flow gap: with this fix, apikey mode's frontend is left without a way to
    attach the bearer.  The correct resolution is a server-side proxy: the browser
    presents a per-session credential (cookie / OIDC token), and the backend
    attaches the upstream bearer server-side.  Until that proxy is wired up,
    apikey mode is effectively read-only from a browser client.
    """
    sentinel = "super-secret-sentinel-xyzzy"
    app = build_app(_settings(tmp_path, auth_mode="apikey", api_key=sentinel))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/env.js")
    assert r.status_code == 200
    # The sentinel must NOT appear anywhere in the response body.
    assert sentinel not in r.text, f"/env.js leaked the API key. Response body: {r.text!r}"
    # AUTH_MODE should still be present so the SPA knows it needs auth.
    assert '"apikey"' in r.text


@pytest.mark.anyio
async def test_env_js_handles_jwt_mode_without_static_token(tmp_path) -> None:
    """In JWT mode the SPA gets the token from its own login flow, not env.js."""
    app = build_app(
        _settings(
            tmp_path,
            auth_mode="jwt",
            jwt_issuer="https://issuer.example",
            jwt_audience="pgdp-prep",
        )
    )
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/env.js")
    assert r.status_code == 200
    body = r.text
    assert "jwt" in body
    assert "secret-token" not in body
