"""GET /env.js — runtime config shim for the SPA.

Spec 09 says `window.__ENV__` is generated at startup based on runtime env
vars. Rather than rewriting `index.html` we serve a tiny JS file the SPA
loads before its bundle. Cheap to regenerate, never cached.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

from fastapi import APIRouter, Request, Response

if TYPE_CHECKING:
    from pdomain_prep_for_pgdp.settings import Settings

router = APIRouter()


def _build_env(settings: Settings) -> dict[str, str]:
    env: dict[str, str] = {
        "API_BASE": "",
        "AUTH_MODE": settings.auth_mode,
    }
    # NOTE: API_TOKEN / bearer secrets are intentionally NEVER emitted here.
    #
    # /env.js is served unauthenticated and readable by any browser visitor,
    # including cross-origin pages via <script src="/env.js">.  Embedding the
    # server-side bearer would expose it to the whole internet (issue #125).
    #
    # Auth-flow gap: apikey mode's SPA currently has no way to attach the
    # bearer after this fix.  The correct resolution is a server-side proxy:
    # the browser presents a per-session credential (httpOnly SameSite cookie
    # or OIDC token) and the backend attaches the upstream bearer server-side.
    # Until that proxy is implemented, browser clients in apikey mode will
    # receive 401s from protected endpoints.  This is the correct security
    # posture — unauthenticated exposure is worse than a degraded browser UX.
    if settings.auth_mode == "jwt":
        if settings.jwt_issuer:
            env["JWT_ISSUER"] = settings.jwt_issuer
        if settings.jwt_audience:
            env["JWT_AUDIENCE"] = settings.jwt_audience
    return env


@router.get("/env.js", include_in_schema=False)
async def env_js(request: Request) -> Response:
    settings: Settings = request.app.state.settings
    env = _build_env(settings)
    body = f"window.__ENV__ = {json.dumps(env)};\n"
    return Response(
        content=body,
        media_type="application/javascript; charset=utf-8",
        headers={"Cache-Control": "no-store"},
    )


def install_env_js(app) -> None:  # type: ignore[no-untyped-def]
    """Register `/env.js`. Mount BEFORE the static SPA so the route wins."""
    app.include_router(router)
