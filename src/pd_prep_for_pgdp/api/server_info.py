"""GET /api/server-info — bound host/port/URL discovery (§L1 step 3).

Local-mode belt-and-suspenders. The console prints "Listening on …" once
at start, but a user who closes that terminal can't recover the URL. The
SPA queries this on mount and surfaces the bound URL somewhere persistent
(footer, About panel, copy-to-clipboard).

The bound port is decided in `__main__.py` BEFORE `uvicorn.run` (see
`_pick_port`), so for the running app to know it, `__main__.py` writes
`PGDP_PORT` (and `PGDP_HOST`) to the process env before handoff. The
child workers then pick those up via `Settings`, and this endpoint
reads from `Settings` directly.

Read-only, unauthenticated by design — the SPA fetches before any login
flow could reasonably gate it. Mirrors `/healthz`'s rationale.
Excluded from the OpenAPI schema (it's an ops affordance, not part of
the public API contract).
"""

from __future__ import annotations

from fastapi import APIRouter, FastAPI, Request
from pydantic import BaseModel

from pd_prep_for_pgdp.api.dependencies import get_app_state

router = APIRouter()


class ServerInfoResponse(BaseModel):
    host: str
    port: int
    url: str


@router.get("/api/server-info", include_in_schema=False)
async def server_info(request: Request) -> ServerInfoResponse:
    settings = get_app_state(request).settings
    host = settings.host
    port = settings.port
    return ServerInfoResponse(host=host, port=port, url=f"http://{host}:{port}")


def install_server_info(app: FastAPI) -> None:
    """Register `GET /api/server-info`. Call before the SPA mount so the
    catch-all `/{full_path}` fallback doesn't shadow it."""
    app.include_router(router)
