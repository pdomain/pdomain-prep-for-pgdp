"""Test the /api/auth/me endpoint.

Returns the resolved UserContext (just `user_id` for now). The frontend's
AuthBadge uses this to display the right identity in apikey mode (where the
JWT-sub trick doesn't apply).

Locks in:
  - in `none` auth mode → user_id=="default", no token required,
  - in `apikey` mode without a token → 401,
  - in `apikey` mode with the right token → user_id=="default".
"""

from __future__ import annotations

from fastapi.testclient import TestClient

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


def test_me_in_none_mode_returns_default(tmp_path) -> None:
    app = build_app(_settings(tmp_path))
    with TestClient(app) as client:
        r = client.get("/api/auth/me")
        assert r.status_code == 200
        assert r.json() == {"user_id": "default"}


def test_me_in_apikey_mode_without_token_is_401(tmp_path) -> None:
    app = build_app(_settings(tmp_path, auth_mode="apikey", api_key="secret"))
    with TestClient(app) as client:
        r = client.get("/api/auth/me")
        assert r.status_code == 401


def test_me_in_apikey_mode_with_token_works(tmp_path) -> None:
    app = build_app(_settings(tmp_path, auth_mode="apikey", api_key="secret"))
    with TestClient(app) as client:
        r = client.get(
            "/api/auth/me",
            headers={"Authorization": "Bearer secret"},
        )
        assert r.status_code == 200
        assert r.json() == {"user_id": "default"}
