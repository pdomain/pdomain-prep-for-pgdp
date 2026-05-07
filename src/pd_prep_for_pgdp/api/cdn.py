"""PUT /cdn/{key:path} — closes the gap between filesystem-mode
`presign_put` (which returns `/cdn/<key>` URLs) and FastAPI's read-only
StaticFiles mount.

In S3 mode this router isn't installed; presigned PUTs go directly to S3.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from ..adapters.storage import IStorage
from .dependencies import get_storage

router = APIRouter()


@router.put("/cdn/{key:path}", status_code=204, operation_id="upload_cdn_asset")
async def cdn_put(
    key: str,
    request: Request,
    storage: IStorage = Depends(get_storage),
) -> Response:
    """Write `key` (under the data root) using bytes from the request body.

    Path traversal (`..`, absolute paths) is rejected by the storage adapter.
    """
    if ".." in key.split("/") or key.startswith("/"):
        raise HTTPException(status_code=400, detail="invalid key")
    body = await request.body()
    content_type = request.headers.get("content-type", "application/octet-stream")
    try:
        await storage.put_bytes(key, body, content_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return Response(status_code=204)


def install_cdn_upload(app) -> None:  # type: ignore[no-untyped-def]
    """Install the PUT /cdn/* handler. Call BEFORE mounting the StaticFiles read path."""
    app.include_router(router)
