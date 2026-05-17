"""Tests for `_mount_static_frontend` early-returns.

- When `frontend_dev_url` is set, the static SPA mount is skipped — the
  user runs Vite separately and the FastAPI process only serves /api/*.
- When the bundle directory exists but isn't a directory (or is missing),
  the helper logs a warning and returns; the app still works for /api/*.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from pd_prep_for_pgdp.bootstrap import build_app
from pd_prep_for_pgdp.settings import Settings


def _settings(tmp_path, **overrides) -> Settings:
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
    base.update(overrides)
    return Settings(**base)


def test_frontend_dev_url_skips_static_mount(tmp_path) -> None:
    """`frontend_dev_url=...` means the SPA is served by Vite externally;
    the FastAPI process should NOT serve `/` — root should miss the SPA
    fallback and return whatever Starlette decides for an unrouted GET."""
    settings = _settings(tmp_path, frontend_dev_url="http://localhost:5173")
    app = build_app(settings)
    with TestClient(app) as client:
        # /api/* still works (regression: dev mode mustn't break the API).
        r = client.get("/api/data/projects")
        assert r.status_code == 200

        # No SPA fallback — `/` is unmounted.
        r2 = client.get("/")
        assert r2.status_code == 404
