"""Tests for `api.dependencies` helpers.

Locks in:
  - `get_storage` / `get_database` / `get_auth` / `get_gpu_backend` /
    `get_dispatcher` / `get_job_events` all return the instances stashed
    on `app.state`,
  - `get_user` re-raises HTTPException untouched (preserves detail
    from the auth adapter),
  - `get_user` maps ConnectionError/TimeoutError/OSError → 503,
  - `get_user` maps ValueError → 422,
  - `get_user` maps unexpected exceptions → 500.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from pd_prep_for_pgdp.api.dependencies import (
    get_auth,
    get_database,
    get_dispatcher,
    get_gpu_backend,
    get_job_events,
    get_job_runner,
    get_settings,
    get_stage_events,
    get_storage,
    get_user,
)


class _Sentinels:
    """Tiny stand-in for `app.state` with sentinel objects per dependency."""

    storage = object()
    database = object()
    auth = object()
    gpu_backend = object()
    dispatcher = object()
    job_events = object()
    stage_events = object()
    settings = object()
    job_runner = object()


class _FakeRequest:
    def __init__(self) -> None:
        self.app = type("_app", (), {"state": _Sentinels})()


def test_get_storage_returns_app_state_storage() -> None:
    assert get_storage(_FakeRequest()) is _Sentinels.storage  # type: ignore[arg-type]


def test_get_database_returns_app_state_database() -> None:
    assert get_database(_FakeRequest()) is _Sentinels.database  # type: ignore[arg-type]


def test_get_auth_returns_app_state_auth() -> None:
    assert get_auth(_FakeRequest()) is _Sentinels.auth  # type: ignore[arg-type]


def test_get_gpu_backend_returns_app_state_gpu_backend() -> None:
    assert get_gpu_backend(_FakeRequest()) is _Sentinels.gpu_backend  # type: ignore[arg-type]


def test_get_dispatcher_returns_app_state_dispatcher() -> None:
    assert get_dispatcher(_FakeRequest()) is _Sentinels.dispatcher  # type: ignore[arg-type]


def test_get_job_events_returns_app_state_job_events() -> None:
    assert get_job_events(_FakeRequest()) is _Sentinels.job_events  # type: ignore[arg-type]


def test_get_stage_events_returns_app_state_stage_events() -> None:
    assert get_stage_events(_FakeRequest()) is _Sentinels.stage_events  # type: ignore[arg-type]


def test_get_settings_returns_app_state_settings() -> None:
    assert get_settings(_FakeRequest()) is _Sentinels.settings  # type: ignore[arg-type]


def test_get_job_runner_returns_app_state_job_runner() -> None:
    assert get_job_runner(_FakeRequest()) is _Sentinels.job_runner  # type: ignore[arg-type]


# ── get_user ────────────────────────────────────────────────────────────────


class _RaisingAuth:
    """Auth that raises a non-HTTPException — `get_user` should map to 500."""

    async def verify(self, _creds):
        raise RuntimeError("auth subsystem on fire")


class _HTTPAuth:
    """Auth that raises HTTPException — `get_user` re-raises unchanged."""

    async def verify(self, _creds):
        raise HTTPException(status_code=403, detail="custom-detail")


class _ConnectionErrorAuth:
    async def verify(self, _creds):
        raise ConnectionError("TCP connection refused")


class _ValueErrorAuth:
    async def verify(self, _creds):
        raise ValueError("bad jwt segment")


@pytest.mark.asyncio
async def test_get_user_wraps_unknown_exception_as_500() -> None:
    with pytest.raises(HTTPException) as exc:
        await get_user(creds=None, auth=_RaisingAuth())  # type: ignore[arg-type]
    assert exc.value.status_code == 500
    assert "unexpected authentication error" in str(exc.value.detail)


@pytest.mark.asyncio
async def test_get_user_passes_through_http_exception() -> None:
    """A 403 from the auth adapter must reach the client untouched
    (not get re-wrapped)."""
    with pytest.raises(HTTPException) as exc:
        await get_user(creds=None, auth=_HTTPAuth())  # type: ignore[arg-type]
    assert exc.value.status_code == 403
    assert exc.value.detail == "custom-detail"


@pytest.mark.asyncio
async def test_connection_error_in_auth_dependency_returns_503() -> None:
    """ConnectionError (and TimeoutError/OSError) from an auth adapter must
    become 503 Service Unavailable, not 500."""
    with pytest.raises(HTTPException) as exc:
        await get_user(creds=None, auth=_ConnectionErrorAuth())  # type: ignore[arg-type]
    assert exc.value.status_code == 503
    assert exc.value.detail == "auth service unavailable"


@pytest.mark.asyncio
async def test_value_error_in_auth_dependency_returns_422() -> None:
    """ValueError from an auth adapter (malformed token format) must become
    422 Unprocessable Entity."""
    with pytest.raises(HTTPException) as exc:
        await get_user(creds=None, auth=_ValueErrorAuth())  # type: ignore[arg-type]
    assert exc.value.status_code == 422
    assert "malformed credential" in str(exc.value.detail)
