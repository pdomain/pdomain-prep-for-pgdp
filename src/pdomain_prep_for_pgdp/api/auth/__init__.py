"""/api/auth/* — identity routes (none / apikey / jwt verify)."""

from fastapi import APIRouter

from .me import router as me_router


def install_auth_routes(app, auth_mode: str = "none") -> None:  # type: ignore[no-untyped-def]
    root = APIRouter(prefix="/api/auth")
    root.include_router(me_router)
    if auth_mode == "apikey":
        from .session import router as session_router

        root.include_router(session_router)
    app.include_router(root)
