"""CDN routes for filesystem-mode storage.

In filesystem mode, ``presign_put`` / ``presign_get`` return ``/cdn/<key>``
URLs.  This module provides the corresponding FastAPI routes so the frontend
can upload and download assets without S3.

In S3 mode this router isn't installed; presigned URLs go directly to S3.

Auth behaviour (issue #124 — Option B mode-split):
  - ``auth_mode=none``:    PUT requires auth (no-op — NoneAuth always succeeds).
                           GET served by a static ``StaticFiles`` mount (single
                           user; no real risk).
  - ``auth_mode=apikey``
    / ``auth_mode=jwt``:   PUT and GET both require a valid session.  GET also
                           checks project ownership so one authenticated user
                           cannot read another user's project data.
"""

from __future__ import annotations

import mimetypes
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from pd_prep_for_pgdp.settings import Settings

from .dependencies import UserDep, get_database, get_settings, get_storage

if TYPE_CHECKING:
    from pd_prep_for_pgdp.adapters.auth.base import UserContext
    from pd_prep_for_pgdp.adapters.database import IDatabase
    from pd_prep_for_pgdp.adapters.storage import IStorage

_write_router = APIRouter()
_read_router = APIRouter()

# Keep `router` as an alias pointing at the write router so existing callers
# of ``install_cdn_upload(app)`` and direct ``cdn_put`` imports continue to
# work without change.
router = _write_router

# Default limits used when the handler is called directly in tests
# without a real FastAPI request context. Production code always receives a
# Settings injected by get_settings via Depends.
_DEFAULT_SETTINGS = Settings()


# ── Shared helpers ────────────────────────────────────────────────────────────


def _validate_cdn_key(key: str) -> None:
    """Raise HTTP 400 for path traversal or absolute-path keys.

    Rejects any key that contains a ``..`` path segment or starts with
    ``/``.  Both checks are needed: ``..`` prevents directory traversal;
    the leading-``/`` check prevents absolute-path injections that bypass
    the storage adapter's containment check on some platforms.
    """
    if ".." in key.split("/") or key.startswith("/"):
        raise HTTPException(status_code=400, detail="invalid key")


def _content_type_for_key(key: str) -> str:
    """Guess MIME type from the key's extension; fall back to octet-stream."""
    mime, _ = mimetypes.guess_type(key)
    return mime or "application/octet-stream"


async def _check_project_ownership(key: str, user: UserContext, db: IDatabase) -> None:
    """Raise HTTP 403/404 when the requesting user does not own the project.

    Keys with the prefix ``projects/{project_id}/…`` are project-scoped.
    For all other key prefixes (shared assets, etc.) the check is skipped.

    Raises:
        HTTPException(404): the project does not exist.
        HTTPException(403): the project exists but belongs to a different user.
    """
    parts = key.split("/")
    if len(parts) < 2 or parts[0] != "projects":
        # Not a project-scoped key — no ownership check required.
        return
    project_id = parts[1]
    project = await db.get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    if project.owner_id != user.user_id:
        raise HTTPException(status_code=403, detail="forbidden")


def _check_upload_size(request: Request, max_bytes: int) -> None:
    """Raise HTTP 413 if the request body is known to exceed `max_bytes`.

    Checks the ``content-length`` header first (fast path — no body read yet).
    The post-read body-length check in the caller covers clients that omit the
    header or send an underreported length.
    """
    content_length = request.headers.get("content-length")
    if content_length is not None and int(content_length) > max_bytes:
        raise HTTPException(status_code=413, detail="upload too large")


# ── Routes ────────────────────────────────────────────────────────────────────


@_write_router.put("/cdn/{key:path}", status_code=204, operation_id="upload_cdn_asset")
async def cdn_put(
    key: str,
    request: Request,
    user: UserDep,
    storage: IStorage = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Write ``key`` (under the data root) using bytes from the request body.

    Requires a valid authenticated session in all auth modes (in
    ``auth_mode=none`` NoneAuth always succeeds, so the dependency is a
    no-op for single-user local installs).

    Path traversal (``..``, absolute paths) is rejected.
    Bodies exceeding ``settings.max_cdn_upload_bytes`` are rejected with 413.
    """
    _validate_cdn_key(key)
    # When called directly in unit tests, `settings` may be a Depends object.
    # Fall back to the module-level default in that case.
    resolved: Settings = settings if isinstance(settings, Settings) else _DEFAULT_SETTINGS
    max_bytes: int = resolved.max_cdn_upload_bytes
    _check_upload_size(request, max_bytes)
    body = await request.body()
    if len(body) > max_bytes:
        raise HTTPException(status_code=413, detail="upload too large")
    content_type = request.headers.get("content-type", "application/octet-stream")
    try:
        await storage.put_bytes(key, body, content_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return Response(status_code=204)


@_read_router.get("/cdn/{key:path}", operation_id="download_cdn_asset")
async def cdn_get(
    key: str,
    user: UserDep,
    storage: IStorage = Depends(get_storage),
    db: IDatabase = Depends(get_database),
) -> Response:
    """Authenticated CDN read for multi-user modes (``auth_mode != none``).

    Checks that the requesting user owns the project referenced by the key
    (for keys under ``projects/{project_id}/``).  Keys with other prefixes
    (shared assets) are served without an ownership check.

    Returns the raw bytes with a content-type guessed from the key extension.
    """
    _validate_cdn_key(key)
    await _check_project_ownership(key, user, db)
    try:
        data = await storage.get_bytes(key)
    except (FileNotFoundError, OSError) as exc:
        raise HTTPException(status_code=404, detail="not found") from exc
    return Response(content=data, media_type=_content_type_for_key(key))


# ── Bootstrap helpers ─────────────────────────────────────────────────────────


def install_cdn_upload(app) -> None:  # type: ignore[no-untyped-def]
    """Install the PUT /cdn/* handler. Call BEFORE mounting the StaticFiles read path.

    .. deprecated::
        Use :func:`install_cdn_routes` instead; this shim is kept so callers
        that haven't been updated yet continue to work.
    """
    app.include_router(_write_router)


def install_cdn_routes(app, auth_mode: str) -> None:  # type: ignore[no-untyped-def]
    """Install CDN routes with mode-appropriate read handling (issue #124).

    In ``auth_mode=none`` (single-user local install):
      - Registers only the ``PUT /cdn/{key}`` route (NoneAuth is a no-op, so
        the ``Depends(get_user)`` guard always succeeds for the single user).
      - The caller is responsible for mounting a ``StaticFiles`` read path at
        ``/cdn`` *after* this call so ``GET /cdn/<key>`` is served without
        credentials (browser-friendly for local image viewing).

    In ``auth_mode=apikey`` / ``auth_mode=jwt`` (multi-user):
      - Registers both ``PUT /cdn/{key}`` and ``GET /cdn/{key}`` FastAPI
        routes that enforce authentication and project-ownership checks.
      - The caller must NOT mount a ``StaticFiles`` overlay for ``/cdn``
        (it would shadow the ownership-checking GET route).

    Always call this BEFORE mounting the SPA ``StaticFiles`` bundle.
    """
    app.include_router(_write_router)
    if auth_mode != "none":
        app.include_router(_read_router)
