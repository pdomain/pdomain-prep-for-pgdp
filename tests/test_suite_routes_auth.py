"""Auth guard on mutating /api/suite/* routes.

pdomain-ops' `mount_routes()` wraps its included sub-router in an opaque
`_IncludedRouter` in this repo's FastAPI version, so `PUT
/api/suite/prefs/common`, `PUT /api/suite/prefs/apps/{app_id}`, and `POST
/api/suite/launch` never show up as `APIRoute` instances in `app.routes` —
a route-object-attaching fix would silently miss them. This test exercises
every mutating suite path through a real `TestClient` request so the guard
is proven at the HTTP boundary, not by inspecting route wiring.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.settings import Settings

if TYPE_CHECKING:
    from pathlib import Path

_API_KEY = "secret-xyz"


def _settings(tmp_path: Path, **kw: object) -> Settings:
    base: dict[str, object] = {
        "host": "127.0.0.1",
        "port": 8765,
        "data_root": tmp_path / "data",
        "config_dir": tmp_path / "config",
        "storage_backend": "filesystem",
        "database_url": f"sqlite:///{(tmp_path / 's.db').as_posix()}",
        "gpu_backend": "cpu",
        "dispatch_interval_seconds": 0,
        "auth_mode": "apikey",
        "api_key": _API_KEY,
    }
    base.update(kw)
    return Settings(**base)


@pytest.fixture(autouse=True)
def _stub_suite_side_effects(monkeypatch: pytest.MonkeyPatch) -> None:
    """Stub the launch/update handlers' real subprocess+network side effects.

    `POST /api/suite/launch` spawns a real OS process and polls its
    `/healthz`; `POST /api/suite/update` shells out to `uv tool upgrade`.
    Neither side effect is relevant to proving the auth guard — stub both
    so the authenticated-success assertions stay hermetic.
    """
    from pdomain_ops.suite import update_routes
    from pdomain_ops.suite.registry import LocalTomlSuiteRegistry
    from pdomain_ops.suite.sibling_spawn import LaunchResultOpened, LocalSpawnLauncher
    from pdomain_ops.suite.types import InstalledApp

    fixture_app = InstalledApp(
        app_id="fixture-app",
        package="fixture-app",
        version="0.0.1",
        binary="/usr/bin/true",
        default_port=9999,
        icon="icon.png",
        display_name="Fixture App",
    )

    def _list_installed(self: LocalTomlSuiteRegistry) -> list[InstalledApp]:
        return [fixture_app]

    async def _launch(
        self: LocalSpawnLauncher, app: InstalledApp, *, windowed: bool = False
    ) -> LaunchResultOpened:
        del app, windowed
        return LaunchResultOpened(url="http://localhost:9999", spawned=False, pid=None)

    monkeypatch.setattr(LocalTomlSuiteRegistry, "list_installed", _list_installed)
    monkeypatch.setattr(LocalSpawnLauncher, "launch", _launch)
    monkeypatch.setattr(update_routes, "apply_upgrade", lambda dist_name: None)


_MUTATING_CASES = [
    pytest.param(
        "PUT",
        "/api/suite/device",
        {"scope": "app", "device": "cpu"},
        None,
        200,
        id="device",
    ),
    pytest.param(
        "PUT",
        "/api/suite/prefs/common",
        {"theme": "dark", "density": "normal", "font_scale": 1.0},
        None,
        204,
        id="prefs-common",
    ),
    pytest.param(
        "PUT",
        "/api/suite/prefs/apps/pdomain-prep-for-pgdp",
        {"compute_device": "cpu"},
        None,
        204,
        id="prefs-app",
    ),
    pytest.param(
        "POST",
        "/api/suite/launch",
        None,
        {"app_id": "fixture-app"},
        200,
        id="launch",
    ),
    pytest.param("POST", "/api/suite/update", None, None, 200, id="update"),
]


@pytest.mark.parametrize(("method", "path", "json_body", "params", "authed_status"), _MUTATING_CASES)
def test_mutating_suite_route_requires_auth(
    tmp_path: Path,
    method: str,
    path: str,
    json_body: dict[str, object] | None,
    params: dict[str, str] | None,
    authed_status: int,
) -> None:
    app = build_app(_settings(tmp_path))
    with TestClient(app) as client:
        unauthed = client.request(method, path, json=json_body, params=params)
        assert unauthed.status_code == 401

        authed = client.request(
            method,
            path,
            json=json_body,
            params=params,
            headers={"Authorization": f"Bearer {_API_KEY}"},
        )
        assert authed.status_code == authed_status


def test_suite_installed_stays_open_without_token(tmp_path: Path) -> None:
    app = build_app(_settings(tmp_path))
    with TestClient(app) as client:
        r = client.get("/api/suite/installed")
        assert r.status_code == 200
