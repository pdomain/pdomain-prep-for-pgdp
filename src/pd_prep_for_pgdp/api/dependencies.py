"""Shared FastAPI dependencies: storage / database / auth / dispatcher / GPU.

`bootstrap.build_app()` instantiates each adapter once and stashes it on
`app.state`. Routes resolve them through the helpers in this module so unit
tests can override individual dependencies via FastAPI's standard mechanism.
"""

from __future__ import annotations

import logging
from typing import Annotated, Protocol, cast

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from pd_prep_for_pgdp.adapters.auth import IAuth, UserContext
from pd_prep_for_pgdp.adapters.database import IDatabase
from pd_prep_for_pgdp.adapters.storage import IStorage
from pd_prep_for_pgdp.api.auth.session_cookie import COOKIE_NAME, verify_cookie_value
from pd_prep_for_pgdp.core.job_events import JobEventBroker
from pd_prep_for_pgdp.core.job_runner import InProcessJobRunner
from pd_prep_for_pgdp.core.stage_events import StageEventBroker
from pd_prep_for_pgdp.dispatcher import IDispatcher
from pd_prep_for_pgdp.settings import Settings


class GPUBackend(Protocol):
    name: str


log = logging.getLogger(__name__)

_security = HTTPBearer(auto_error=False)


class AppState(Protocol):
    storage: IStorage
    database: IDatabase
    auth: IAuth
    gpu_backend: GPUBackend
    dispatcher: IDispatcher
    job_events: JobEventBroker
    stage_events: StageEventBroker
    settings: Settings
    job_runner: InProcessJobRunner


class _AppWithState(Protocol):
    state: AppState


def get_app_state(request: Request) -> AppState:
    app = cast(_AppWithState, request.app)
    return app.state


def get_storage(request: Request) -> IStorage:
    return get_app_state(request).storage


def get_database(request: Request) -> IDatabase:
    return get_app_state(request).database


def get_auth(request: Request) -> IAuth:
    return get_app_state(request).auth


def get_gpu_backend(request: Request) -> GPUBackend:
    return get_app_state(request).gpu_backend


def get_dispatcher(request: Request) -> IDispatcher:
    return get_app_state(request).dispatcher


def get_job_events(request: Request) -> JobEventBroker:
    return get_app_state(request).job_events


def get_stage_events(request: Request) -> StageEventBroker:
    return get_app_state(request).stage_events


def get_settings(request: Request) -> Settings:
    """Read-only access to the Settings instance for routes that need
    `data_root` (the on-disk artifact root) — e.g. the per-page stage runner."""
    return get_app_state(request).settings


def get_job_runner(request: Request) -> InProcessJobRunner:
    """The InProcessJobRunner — used by the async stage-run route to enqueue
    a Job and hand off execution to the background poll loop."""
    return get_app_state(request).job_runner


SecurityDep = Annotated[HTTPAuthorizationCredentials | None, Depends(_security)]
AuthDep = Annotated[IAuth, Depends(get_auth)]


async def get_user(
    request: Request,
    creds: SecurityDep,
    auth: AuthDep,
) -> UserContext:
    # In apikey mode: check session cookie first, then fall back to Bearer.
    # This lets browser clients use the httpOnly cookie (no JS-visible secret)
    # while non-browser callers (scripts/CI) continue to work with Bearer.
    settings = cast(Settings, request.app.state.settings)
    if settings.auth_mode == "apikey":
        cookie_val = request.cookies.get(COOKIE_NAME)
        if cookie_val and verify_cookie_value(cookie_val, settings.session_secret):
            from pd_prep_for_pgdp.adapters.auth.base import UserContext

            return UserContext()
    try:
        return await auth.verify(creds.credentials if creds else None)
    except HTTPException:
        raise
    except (ConnectionError, TimeoutError, OSError) as e:
        raise HTTPException(status_code=503, detail="auth service unavailable") from e
    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"malformed credential: {e}") from e
    except Exception as e:
        log.exception("unexpected error in auth dependency")
        raise HTTPException(status_code=500, detail="unexpected authentication error") from e


UserDep = Annotated[UserContext, Depends(get_user)]
DatabaseDep = Annotated[IDatabase, Depends(get_database)]
StorageDep = Annotated[IStorage, Depends(get_storage)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
GPUBackendDep = Annotated[GPUBackend, Depends(get_gpu_backend)]
JobEventsDep = Annotated[JobEventBroker, Depends(get_job_events)]
StageEventsDep = Annotated[StageEventBroker, Depends(get_stage_events)]
