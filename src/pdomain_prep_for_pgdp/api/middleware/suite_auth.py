"""Auth guard for mutating `/api/suite/*` routes.

pdomain-ops' `mount_routes()` wraps its included sub-router in an opaque
`_IncludedRouter` in this repo's installed FastAPI version, so it never
appears in `app.routes` as an `APIRoute` — a fix that loops over
`app.routes` to attach a per-route dependency silently misses `PUT
/api/suite/prefs/common`, `PUT /api/suite/prefs/apps/{app_id}`, and `POST
/api/suite/launch`. A method+path-prefix middleware is topology-independent
and reaches every mutating suite route regardless of how it was mounted.

This middleware becomes the outermost layer in the ASGI stack (added after
CORS/RequestId), so a rejected request's 401 response bypasses those inner
middlewares — acceptable here since /api/suite/* mutations are same-origin
app-shell calls, not cross-origin API consumers relying on CORS headers on
error responses.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import HTTPException
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from pdomain_prep_for_pgdp.api.dependencies import (
    extract_bearer_token,
    get_app_state,
    resolve_user_context,
)
from pdomain_prep_for_pgdp.api.middleware.error_handler import ApiError

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from starlette.requests import Request
    from starlette.responses import Response
    from starlette.types import ASGIApp

_MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_SUITE_PREFIX = "/api/suite/"


class SuiteAuthMiddleware(BaseHTTPMiddleware):
    """Reject unauthenticated mutating requests under `/api/suite/*`.

    GETs and non-suite paths pass through untouched; `/healthz` stays open
    because it is mounted outside `/api/suite/`.
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        if request.method in _MUTATING_METHODS and request.url.path.startswith(_SUITE_PREFIX):
            auth = get_app_state(request).auth
            try:
                _ = await resolve_user_context(
                    request,
                    auth,
                    bearer_token=extract_bearer_token(request),
                )
            except HTTPException as exc:
                return JSONResponse(
                    status_code=exc.status_code,
                    content=ApiError(
                        error=f"http_{exc.status_code}",
                        message=str(exc.detail),
                    ).model_dump(),
                )
        return await call_next(request)
