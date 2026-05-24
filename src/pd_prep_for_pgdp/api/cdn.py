"""PUT /cdn/{key:path} — closes the gap between filesystem-mode
`presign_put` (which returns `/cdn/<key>` URLs) and FastAPI's read-only
StaticFiles mount.

In S3 mode this router isn't installed; presigned PUTs go directly to S3.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from pd_prep_for_pgdp.settings import Settings

from .dependencies import get_settings, get_storage

if TYPE_CHECKING:
    from pd_prep_for_pgdp.adapters.storage import IStorage

router = APIRouter()

# Default limits used when the handler is called directly in tests
# without a real FastAPI request context. Production code always receives a
# Settings injected by get_settings via Depends.
_DEFAULT_SETTINGS = Settings()


def _check_upload_size(request: Request, max_bytes: int) -> None:
    """Raise HTTP 413 if the request body is known to exceed `max_bytes`.

    Checks the ``content-length`` header first (fast path — no body read yet).
    The post-read body-length check in the caller covers clients that omit the
    header or send an underreported length.
    """
    content_length = request.headers.get("content-length")
    if content_length is not None and int(content_length) > max_bytes:
        raise HTTPException(status_code=413, detail="upload too large")


@router.put("/cdn/{key:path}", status_code=204, operation_id="upload_cdn_asset")
async def cdn_put(
    key: str,
    request: Request,
    storage: IStorage = Depends(get_storage),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Write `key` (under the data root) using bytes from the request body.

    Path traversal (`..`, absolute paths) is rejected by the storage adapter.
    Rejects bodies exceeding ``settings.max_cdn_upload_bytes`` with HTTP 413.
    """
    if ".." in key.split("/") or key.startswith("/"):
        raise HTTPException(status_code=400, detail="invalid key")
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


def install_cdn_upload(app) -> None:  # type: ignore[no-untyped-def]
    """Install the PUT /cdn/* handler. Call BEFORE mounting the StaticFiles read path."""
    app.include_router(router)
