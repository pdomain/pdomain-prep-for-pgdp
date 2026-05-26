"""/api/data/projects/{id}/assets/* — presigned upload + download URLs."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from pdomain_prep_for_pgdp.api.dependencies import get_database, get_storage, get_user

if TYPE_CHECKING:
    from pdomain_prep_for_pgdp.adapters.auth import UserContext
    from pdomain_prep_for_pgdp.adapters.database import IDatabase
    from pdomain_prep_for_pgdp.adapters.storage import IStorage

router = APIRouter(tags=["assets"])


class UploadUrlRequest(BaseModel):
    key: str
    content_type: str


class UploadUrlResponse(BaseModel):
    upload_url: str
    expires_in: int = 3600


class DownloadUrlResponse(BaseModel):
    download_url: str
    expires_in: int = 3600


@router.post(
    "/projects/{project_id}/assets/upload-url",
    response_model=UploadUrlResponse,
    operation_id="get_asset_upload_url",
)
async def get_upload_url(
    project_id: str,
    body: UploadUrlRequest,
    user: UserContext = Depends(get_user),
    db: IDatabase = Depends(get_database),
    storage: IStorage = Depends(get_storage),
) -> UploadUrlResponse:
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")
    if not body.key.startswith(project.storage_prefix):
        raise HTTPException(400, "key must be within project storage prefix")
    url = await storage.presign_put(body.key, body.content_type)
    return UploadUrlResponse(upload_url=url)


@router.get(
    "/projects/{project_id}/assets/download-url",
    response_model=DownloadUrlResponse,
    operation_id="get_asset_download_url",
)
async def get_download_url(
    project_id: str,
    key: str,
    user: UserContext = Depends(get_user),
    db: IDatabase = Depends(get_database),
    storage: IStorage = Depends(get_storage),
) -> DownloadUrlResponse:
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")
    if not key.startswith(project.storage_prefix):
        raise HTTPException(400, "key must be within project storage prefix")
    url = await storage.presign_get(key)
    return DownloadUrlResponse(download_url=url)
