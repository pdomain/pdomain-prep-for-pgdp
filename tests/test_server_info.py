"""Tests for `GET /api/server-info` — bound URL/host/port discovery (§L1 step 3).

Belt-and-suspenders for the local-mode UX: the console print is fine for a
fresh session but a user who closes their terminal can't recover the URL.
The running SPA queries this endpoint on mount and renders the result.

Contract:
- Returns `{url, port, host}` reflecting what `Settings` actually holds —
  not a configured-default that's been overridden.
- Read-only, no auth (mirrors `/healthz`'s rationale: surfaced by the SPA
  before any login flow can reasonably gate it).
- Excluded from the OpenAPI schema (it's an ops affordance, not part of
  the public API contract — same reasoning as `/healthz`).
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


def test_server_info_returns_bound_host_port_url(tmp_path) -> None:
    app = build_app(_settings(tmp_path, host="127.0.0.1", port=8765))
    with TestClient(app) as client:
        r = client.get("/api/server-info")
        assert r.status_code == 200
        body = r.json()
        assert body == {
            "host": "127.0.0.1",
            "port": 8765,
            "url": "http://127.0.0.1:8765",
        }


def test_server_info_reflects_runtime_overrides(tmp_path) -> None:
    """The endpoint reads `Settings` live, so a process started on a
    different port via env passthrough surfaces THAT port, not the
    configured default."""
    app = build_app(_settings(tmp_path, host="0.0.0.0", port=9099))
    with TestClient(app) as client:
        body = client.get("/api/server-info").json()
        assert body["host"] == "0.0.0.0"
        assert body["port"] == 9099
        assert body["url"] == "http://0.0.0.0:9099"


def test_server_info_is_unauthenticated_in_apikey_mode(tmp_path) -> None:
    """SPA fetches this BEFORE login flows; gating it would make it
    useless. Mirrors `/healthz`'s rationale."""
    app = build_app(_settings(tmp_path, auth_mode="apikey", api_key="secret-xyz"))
    with TestClient(app) as client:
        r = client.get("/api/server-info")
        assert r.status_code == 200
        assert r.json()["port"] == 8765


def test_server_info_excluded_from_openapi_schema(tmp_path) -> None:
    """Ops affordance, not part of the public API contract."""
    app = build_app(_settings(tmp_path))
    with TestClient(app) as client:
        schema = client.get("/openapi.json").json()
        assert "/api/server-info" not in schema.get("paths", {})
