"""Shared FastAPI dependencies: storage / database / auth / dispatcher / GPU.

`bootstrap.build_app()` instantiates each adapter once and stashes it on
`app.state`. Routes resolve them through the helpers in this module so unit
tests can override individual dependencies via FastAPI's standard mechanism.
"""

from __future__ import annotations

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from ..adapters.auth import IAuth, UserContext
from ..adapters.database import IDatabase
from ..adapters.gpu import GPUBackend
from ..adapters.storage import IStorage
from ..dispatcher import IDispatcher
from ..settings import Settings

_security = HTTPBearer(auto_error=False)


def get_storage(request: Request) -> IStorage:
    return request.app.state.storage  # type: ignore[no-any-return]


def get_database(request: Request) -> IDatabase:
    return request.app.state.database  # type: ignore[no-any-return]


def get_auth(request: Request) -> IAuth:
    return request.app.state.auth  # type: ignore[no-any-return]


def get_gpu_backend(request: Request) -> GPUBackend:
    return request.app.state.gpu_backend  # type: ignore[no-any-return]


def get_dispatcher(request: Request) -> IDispatcher:
    return request.app.state.dispatcher  # type: ignore[no-any-return]


def get_job_events(request: Request):  # type: ignore[no-untyped-def]
    return request.app.state.job_events


def get_settings(request: Request) -> Settings:
    """Read-only access to the Settings instance for routes that need
    `data_root` (the on-disk artifact root) — e.g. the per-page stage runner."""
    return request.app.state.settings  # type: ignore[no-any-return]


async def get_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_security),
    auth: IAuth = Depends(get_auth),
) -> UserContext:
    try:
        return await auth.verify(creds.credentials if creds else None)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
