"""Tests for `bootstrap._build_suite_app()` / `_migrate_unknown_app_prefs()`.

Without a `suite_app=`, `mount_routes()` mounts `/api/suite/device` and
`/api/suite/update` under `app_id="unknown"` — any compute-device preference
a user set landed in `apps["unknown"]` instead of the real app's section.
Locks in:
  - `_build_suite_app()` reads the bundled `pdomain-suite.json` fragment and
    returns an `InstalledApp` with the real `app_id`, `sys.executable` as
    `binary`, and the installed package version.
  - `_migrate_unknown_app_prefs()` copies a stray `compute_device` from
    `apps["unknown"]` to the real app_id's section (when the real section
    doesn't already have one) and clears it from "unknown".
  - `build_app()` mounts suite routes under the real app_id end to end.
"""

from __future__ import annotations

import sys
from typing import TYPE_CHECKING

import pytest
from fastapi.testclient import TestClient
from pdomain_ops.suite.prefs import LocalFilePrefs

from pdomain_prep_for_pgdp.bootstrap import (
    _build_suite_app,
    _migrate_unknown_app_prefs,
    build_app,
)
from pdomain_prep_for_pgdp.settings import Settings

if TYPE_CHECKING:
    from pathlib import Path

_APP_ID = "pdomain-prep-for-pgdp"


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
        "auth_mode": "none",
    }
    base.update(kw)
    return Settings(**base)


def test_build_suite_app_uses_real_app_id_and_this_interpreter() -> None:
    suite_app = _build_suite_app()
    assert suite_app.app_id == _APP_ID
    assert suite_app.package == _APP_ID
    assert suite_app.binary == sys.executable
    assert suite_app.version  # non-empty; exact value depends on install


def test_migrate_moves_stray_compute_device_to_real_app_id(tmp_path: Path) -> None:
    prefs = LocalFilePrefs(root=tmp_path / "ui-prefs.json")
    prefs.write_app("unknown", {"compute_device": "cuda"})

    _migrate_unknown_app_prefs(prefs, _APP_ID)

    snapshot = prefs.read()
    assert snapshot.apps[_APP_ID]["compute_device"] == "cuda"
    assert "compute_device" not in snapshot.apps["unknown"]


def test_migrate_does_not_clobber_existing_real_app_value(tmp_path: Path) -> None:
    prefs = LocalFilePrefs(root=tmp_path / "ui-prefs.json")
    prefs.write_app("unknown", {"compute_device": "cuda"})
    prefs.write_app(_APP_ID, {"compute_device": "mps"})

    _migrate_unknown_app_prefs(prefs, _APP_ID)

    snapshot = prefs.read()
    assert snapshot.apps[_APP_ID]["compute_device"] == "mps"
    assert snapshot.apps["unknown"]["compute_device"] == "cuda"


def test_migrate_is_noop_when_no_unknown_section(tmp_path: Path) -> None:
    prefs = LocalFilePrefs(root=tmp_path / "ui-prefs.json")

    _migrate_unknown_app_prefs(prefs, _APP_ID)  # must not raise

    snapshot = prefs.read()
    assert snapshot.apps == {}


def test_build_app_mounts_suite_routes_under_real_app_id(tmp_path: Path) -> None:
    app = build_app(_settings(tmp_path))
    assert app.state.suite_app.app_id == _APP_ID
    with TestClient(app) as client:
        r = client.get("/api/suite/device")
        assert r.status_code == 200


def test_build_app_migrates_stray_unknown_device_pref(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    suite_dir = tmp_path / "suite_data"
    monkeypatch.setenv("PD_SUITE_DATA_DIR", str(suite_dir))

    prefs = LocalFilePrefs(root=suite_dir / "ui-prefs.json")
    prefs.write_app("unknown", {"compute_device": "cuda"})

    build_app(_settings(tmp_path))

    snapshot = prefs.read()
    assert snapshot.apps[_APP_ID]["compute_device"] == "cuda"
    assert "compute_device" not in snapshot.apps["unknown"]
