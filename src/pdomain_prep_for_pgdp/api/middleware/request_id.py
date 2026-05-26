"""Request-ID middleware for log correlation (roadmap §18).

Reads the configured header (default `X-Request-ID`) from the incoming
request — orchestrators / load balancers / Sentry typically set this so
a single user-facing request can be traced through every service it
touches. If the header is absent we mint a fresh `uuid4()` so log lines
are still correlated within this app.

The id is published on a `ContextVar` (`logging_config.request_id_var`)
for the duration of the request — every `logging.getLogger().info(...)`
call below this middleware in the stack picks it up via
`RequestIdFilter`. The id is also echoed back on the response header so
clients (and end-to-end tests) can capture it.

Design choice: this is a pure ASGI middleware, not a FastAPI dependency.
A dependency would only stamp routes that explicitly opt in; we want
*every* log line — including ones from `lifespan`, exception handlers,
and the SPA fallback — to have the id.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from starlette.middleware.base import BaseHTTPMiddleware

from pdomain_prep_for_pgdp.core.logging_config import request_id_var

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from starlette.requests import Request
    from starlette.responses import Response


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Stamp every request with a correlation id.

    Args:
        header_name: HTTP header to read & echo. Lower-cased on read
            (Starlette's headers are case-insensitive); echoed in the
            canonical case the caller passes in.
    """

    def __init__(self, app, header_name: str = "X-Request-ID") -> None:
        super().__init__(app)
        self.header_name = header_name

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        incoming = request.headers.get(self.header_name)
        rid = incoming or uuid.uuid4().hex
        token = request_id_var.set(rid)
        try:
            response = await call_next(request)
        finally:
            request_id_var.reset(token)
        response.headers[self.header_name] = rid
        return response
