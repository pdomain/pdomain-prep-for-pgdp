"""Uniform error response shape per spec 07."""

from __future__ import annotations

import logging
import traceback
from typing import TYPE_CHECKING, Any

from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

if TYPE_CHECKING:
    from fastapi import FastAPI, Request

log = logging.getLogger(__name__)


class ApiError(BaseModel):
    error: str
    message: str
    details: Any = None


def install_error_handlers(app: FastAPI, *, debug: bool = False) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def _http_exc(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=ApiError(
                error=f"http_{exc.status_code}",
                message=str(exc.detail),
            ).model_dump(),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_exc(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=400,
            content=ApiError(
                error="validation_error",
                message="request body failed validation",
                details=exc.errors(),
            ).model_dump(),
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        # `exc_info=exc` rather than `log.exception(...)`: this is a FastAPI
        # exception handler, not an `except` block, so `log.exception`'s implicit
        # `sys.exc_info()` lookup depends on the caller's frame state. Passing the
        # bound exception logs this traceback and nothing else. (ruff LOG004)
        log.error("unhandled exception in %s %s", request.method, request.url.path, exc_info=exc)
        details = traceback.format_exc().splitlines()[-3:] if debug else None
        return JSONResponse(
            status_code=500,
            content=ApiError(
                error="internal_error",
                message=str(exc) or exc.__class__.__name__,
                details=details,
            ).model_dump(),
        )
