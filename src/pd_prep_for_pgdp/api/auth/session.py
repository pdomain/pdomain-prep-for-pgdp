"""POST /api/auth/session — apikey-mode login/logout via httpOnly session cookie.

Only mounted when auth_mode == "apikey".  In none/jwt mode the routes are
absent (the router is not installed) so callers get 404 or 405 rather than a
misleading success response.
"""

from __future__ import annotations

import hmac as _hmac

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from .session_cookie import _COOKIE_NAME, make_cookie_value

router = APIRouter(tags=["auth"])


class SessionRequest(BaseModel):
    api_key: str


@router.post("/session", operation_id="create_session")
async def create_session(body: SessionRequest, request: Request, response: Response) -> dict[str, bool]:
    """Verify the submitted API key and issue an httpOnly session cookie.

    The upstream bearer (PGDP_API_KEY) is never sent to the browser — it
    stays on the server and is used only for comparing here and attaching
    to outbound calls.  The session cookie is a signed opaque token.
    """
    from pd_prep_for_pgdp.settings import Settings

    settings: Settings = request.app.state.settings
    expected = settings.api_key or ""
    if not expected or not _hmac.compare_digest(body.api_key, expected):
        raise HTTPException(status_code=401, detail="invalid api key")

    value = make_cookie_value(settings.session_secret)
    response.set_cookie(
        key=_COOKIE_NAME,
        value=value,
        httponly=True,
        samesite="strict",
        secure=False,  # False in dev (HTTP); TODO: set True in prod via config
    )
    return {"authenticated": True}


@router.post("/session/logout", operation_id="delete_session")
async def delete_session(response: Response) -> dict[str, bool]:
    """Clear the session cookie."""
    response.delete_cookie(
        key=_COOKIE_NAME,
        httponly=True,
        samesite="strict",
    )
    return {"authenticated": False}
