"""Session cookie and CORS defaults tighten once the server leaves loopback."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.settings import Settings

if TYPE_CHECKING:
    from pathlib import Path

_API_KEY = "test-api-key"
_ORIGIN = "https://proof.example"


def _settings(tmp_path: Path, **overrides: object) -> Settings:
    values: dict[str, object] = {
        "host": "127.0.0.1",
        "data_root": tmp_path / "data",
        "config_dir": tmp_path / "config",
        "storage_backend": "filesystem",
        "database_url": f"sqlite:///{(tmp_path / 's.db').as_posix()}",
        "gpu_backend": "cpu",
        "dispatch_interval_seconds": 0,
        "auth_mode": "apikey",
        "api_key": _API_KEY,
        "session_secret": "test-secret",
    }
    return Settings.model_validate(values | overrides)


@pytest.mark.parametrize("host", ["127.0.0.1", "localhost", "::1"])
def test_loopback_host_keeps_the_local_defaults(tmp_path: Path, host: str) -> None:
    settings = _settings(tmp_path, host=host)

    assert settings.effective_session_cookie_secure is False
    assert settings.effective_cors_allow_origins == ["*"]


@pytest.mark.parametrize("host", ["0.0.0.0", "192.168.1.20", "proof.example"])
def test_other_hosts_get_secure_cookies_and_no_cors_origins(tmp_path: Path, host: str) -> None:
    settings = _settings(tmp_path, host=host)

    assert settings.effective_session_cookie_secure is True
    assert settings.effective_cors_allow_origins == []


def test_explicit_settings_win_over_the_host_defaults(tmp_path: Path) -> None:
    settings = _settings(
        tmp_path, host="192.168.1.20", session_cookie_secure=False, cors_allow_origins=[_ORIGIN]
    )

    assert settings.effective_session_cookie_secure is False
    assert settings.effective_cors_allow_origins == [_ORIGIN]


def test_cors_origins_are_read_from_the_environment(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PGDP_CORS_ALLOW_ORIGINS", f'["{_ORIGIN}"]')

    assert Settings(data_root=tmp_path).effective_cors_allow_origins == [_ORIGIN]


def _set_cookie_headers(settings: Settings) -> tuple[str, str]:
    with TestClient(build_app(settings)) as client:
        login = client.post("/api/auth/session", json={"api_key": _API_KEY})
        logout = client.post("/api/auth/session/logout")
    assert login.status_code == 200
    return login.headers["set-cookie"], logout.headers["set-cookie"]


def test_cookie_is_not_secure_on_loopback(tmp_path: Path) -> None:
    login, logout = _set_cookie_headers(_settings(tmp_path))

    assert "secure" not in login.lower()
    assert "secure" not in logout.lower()


def test_cookie_is_secure_off_loopback(tmp_path: Path) -> None:
    login, logout = _set_cookie_headers(_settings(tmp_path, host="192.168.1.20"))

    assert "secure" in login.lower()
    assert "secure" in logout.lower()


def _allow_origin(settings: Settings) -> str | None:
    with TestClient(build_app(settings)) as client:
        return client.get("/healthz", headers={"Origin": _ORIGIN}).headers.get("access-control-allow-origin")


def test_cors_allows_any_origin_on_loopback(tmp_path: Path) -> None:
    assert _allow_origin(_settings(tmp_path)) == "*"


def test_cors_sends_no_origin_header_off_loopback(tmp_path: Path) -> None:
    assert _allow_origin(_settings(tmp_path, host="192.168.1.20")) is None


def test_cors_allows_only_listed_origins(tmp_path: Path) -> None:
    settings = _settings(tmp_path, host="192.168.1.20", cors_allow_origins=[_ORIGIN])

    assert _allow_origin(settings) == _ORIGIN


def test_startup_warns_when_the_host_default_forces_secure_cookies(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    _ = build_app(_settings(tmp_path, host="192.168.1.20"))

    assert "PGDP_SESSION_COOKIE_SECURE" in caplog.text


@pytest.mark.parametrize(
    "overrides",
    [
        {"host": "127.0.0.1"},
        {"host": "192.168.1.20", "session_cookie_secure": True},
        {"host": "192.168.1.20", "auth_mode": "none"},
    ],
)
def test_startup_stays_quiet_otherwise(
    tmp_path: Path, caplog: pytest.LogCaptureFixture, overrides: dict[str, object]
) -> None:
    _ = build_app(_settings(tmp_path, **overrides))

    assert "PGDP_SESSION_COOKIE_SECURE" not in caplog.text
