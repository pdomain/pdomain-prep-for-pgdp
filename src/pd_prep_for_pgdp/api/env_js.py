"""GET /env.js — runtime config shim for the SPA.

Spec 09 says `window.__ENV__` is generated at startup based on runtime env
vars. Rather than rewriting `index.html` we serve a tiny JS file the SPA
loads before its bundle. Cheap to regenerate, never cached.
"""

from __future__ import annotations

import json

from fastapi import APIRouter, Request, Response

from ..settings import Settings

router = APIRouter()


def _build_env(settings: Settings) -> dict[str, str]:
    env: dict[str, str] = {
        "API_BASE": "",
        "AUTH_MODE": settings.auth_mode,
    }
    # Self-hosted apikey mode: ship the token to the SPA so authenticated
    # XHR / SSE requests work without a separate login flow.
    if settings.auth_mode == "apikey" and settings.api_key:
        env["API_TOKEN"] = settings.api_key
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
