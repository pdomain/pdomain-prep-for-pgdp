"""/api/data/projects/* -- project CRUD."""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Literal, cast

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from pdomain_prep_for_pgdp.api.dependencies import (
    DatabaseDep,
    PageServiceDep,
    SettingsDep,
    StorageDep,
    UserDep,
)
from pdomain_prep_for_pgdp.core.ingest import extract_zip_image_thumbnail, peek_zip_image_names
from pdomain_prep_for_pgdp.core.models import (
    Job,
    JobStatus,
    JobType,
    PageStageStatus,
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)

if TYPE_CHECKING:
    from pathlib import Path

    from pdomain_prep_for_pgdp.adapters.auth import UserContext
    from pdomain_prep_for_pgdp.adapters.database import IDatabase

log = logging.getLogger(__name__)

# M4 spec §Disk-cost banner: rough multiplier from source-zip bytes to full-DAG bytes.
# Empirically: 22 stages, most are image-typed at ~0.5x source per stage,
# plus JSON/text stages at negligible size -> order-of-magnitude guidance.
FULL_DAG_RATIO = 12


def _compute_stage_artifacts_bytes(data_root: Path, project_id: str) -> int:
    """Walk pages/*/stages/ under the project directory and sum file sizes.

    Returns 0 when the directory doesn't exist yet (fresh project or no stages run).
    Never raises -- missing or inaccessible paths return 0 so the banner stays hidden.
    """
    project_dir = data_root / "projects" / project_id / "pages"
    if not project_dir.is_dir():
        return 0
    total = 0
    _first_disk_scan_error_logged = False
    for page_dir in project_dir.iterdir():
        stages_dir = page_dir / "stages"
        if not stages_dir.is_dir():
            continue
        for f in stages_dir.rglob("*"):
            if f.is_file():
                try:
                    total += f.stat().st_size
                except OSError as exc:
                    if not _first_disk_scan_error_logged:
                        log.warning("disk cost scan: stat failed for %s: %s", f, exc)
                        _first_disk_scan_error_logged = True
    return total


def _compute_source_zip_bytes(data_root: Path, project_id: str) -> int:
    """Return file size of the project's source.zip, or 0 if absent."""
    p = data_root / "projects" / project_id / "source.zip"
    try:
        return p.stat().st_size if p.is_file() else 0
    except OSError:
        return 0


router = APIRouter(tags=["projects"])


class CreateProjectRequest(BaseModel):
    name: str
    source_type: Literal["zip", "s3_folder", "local_folder"]
    source_uri: str | None = None


class CreateProjectResponse(BaseModel):
    project: Project
    upload_url: str | None = None
    upload_key: str | None = None


class UpdateConfigRequest(BaseModel):
    project_config: dict[str, object]
    name: str | None = None
    """Optional rename. Lifts both `Project.name` and `ProjectConfig.book_name`."""


class UpdateConfigResponse(BaseModel):
    project_config: ProjectConfig
    updated_at: datetime


class SourcePreviewResponse(BaseModel):
    """Cheap-to-compute preview of an uploaded source zip (P2 #8).

    Lets the SPA render a thumbnail strip / sanity-check the upload before
    triggering ingest. Backed by `peek_zip_image_names`, which only reads
    the zip's central directory -- no per-entry decompression.
    """

    filenames: list[str]
    total_image_count: int


@router.post("/projects", response_model=CreateProjectResponse, operation_id="create_project")
async def create_project(
    body: CreateProjectRequest,
    user: UserDep,
    db: DatabaseDep,
    storage: StorageDep,
) -> CreateProjectResponse:
    project_id = uuid.uuid4().hex
    now = datetime.now(UTC)

    config = ProjectConfig(
        book_name=body.name,
        source_uri=body.source_uri or "",
    )
    project = Project(
        id=project_id,
        owner_id=user.user_id,
        name=body.name,
        created_at=now,
        updated_at=now,
        status=ProjectStatus.ingesting,
        page_count=0,
        proof_page_count=0,
        config=config,
        pipeline_state=PipelineState(),
        storage_prefix=f"projects/{project_id}/",
    )
    await db.put_project(project)

    upload_url: str | None = None
    upload_key: str | None = None
    if body.source_type == "zip":
        upload_key = f"projects/{project_id}/source.zip"
        upload_url = await storage.presign_put(upload_key, "application/zip")

    return CreateProjectResponse(project=project, upload_url=upload_url, upload_key=upload_key)


@router.get("/projects", response_model=list[Project], operation_id="list_projects")
async def list_projects(
    user: UserDep,
    db: DatabaseDep,
    include_archived: bool = False,
) -> list[Project]:
    return await db.list_projects(user.user_id, include_archived=include_archived)


@router.get("/projects/{project_id}", response_model=Project, operation_id="get_project")
async def get_project(
    project_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
) -> Project:
    project = await db.get_project(project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    if project.owner_id != user.user_id:
        raise HTTPException(403, "not authorised")
    # Compute disk-cost fields on-demand (M4 spec §Disk-cost banner).
    # These are read-only annotations -- never persisted to the DB.
    return project.model_copy(
        update={
            "stage_artifacts_bytes": _compute_stage_artifacts_bytes(settings.data_root, project_id),
            "source_zip_bytes": _compute_source_zip_bytes(settings.data_root, project_id),
        }
    )


@router.patch(
    "/projects/{project_id}/config",
    response_model=UpdateConfigResponse,
    operation_id="update_project_config",
)
async def update_project_config(
    project_id: str,
    body: UpdateConfigRequest,
    user: UserDep,
    db: DatabaseDep,
    page_service: PageServiceDep,
) -> UpdateConfigResponse:
    project = await db.get_project(project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    if project.owner_id != user.user_id:
        raise HTTPException(403, "not authorised")
    merged = cast(dict[str, object], project.config.model_dump())
    merged.update(body.project_config)
    # `name` is normally a top-level Project field, but conceptually it's the
    # same data as `book_name`. Keep them in sync -- whichever the caller sends
    # wins, with explicit `name` taking priority over `project_config.book_name`.
    book_name = merged.get("book_name")
    new_name = body.name or (book_name if isinstance(book_name, str) else None)
    if new_name:
        merged["book_name"] = new_name
    project.config = ProjectConfig.model_validate(merged)
    if new_name:
        project.name = new_name
    project.updated_at = datetime.now(UTC)
    await db.put_project(project)
    # Re-derive prefixes whenever ranges change. Cheap (in-memory walk).
    from pdomain_prep_for_pgdp.core.assign_prefixes import assign_prefixes

    _ = await assign_prefixes(project=project, page_service=page_service)
    return UpdateConfigResponse(
        project_config=project.config,
        updated_at=project.updated_at,
    )


@router.delete("/projects/{project_id}", status_code=204, operation_id="delete_project")
async def delete_project(
    project_id: str,
    user: UserDep,
    db: DatabaseDep,
) -> None:
    project = await db.get_project(project_id)
    if project is None:
        return
    if project.owner_id != user.user_id:
        raise HTTPException(403, "not authorised")
    await db.delete_project(project_id)


async def _set_archived(
    project_id: str,
    *,
    archived: bool,
    user: UserContext,
    db: IDatabase,
) -> Project:
    project = await db.get_project(project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    if project.owner_id != user.user_id:
        raise HTTPException(403, "not authorised")
    if project.archived != archived:
        project.archived = archived
        project.updated_at = datetime.now(UTC)
        await db.put_project(project)
    return project


@router.post("/projects/{project_id}/archive", response_model=Project, operation_id="archive_project")
async def archive_project(
    project_id: str,
    user: UserDep,
    db: DatabaseDep,
) -> Project:
    """Soft-delete: hide the project from default listings without removing data.

    Idempotent -- archiving an already-archived project is a no-op (still 200).
    """
    return await _set_archived(project_id, archived=True, user=user, db=db)


@router.get(
    "/projects/{project_id}/source-preview",
    response_model=SourcePreviewResponse,
    operation_id="get_source_preview",
)
async def source_preview(
    project_id: str,
    user: UserDep,
    db: DatabaseDep,
    storage: StorageDep,
    limit: int = 20,
) -> SourcePreviewResponse:
    """Return image filenames + total count from the project's `source.zip`.

    404s for unknown / wrong-owner projects (mirrors `assets.py`'s collapse
    of 403 -> 404 to avoid leaking existence) and for the case where the
    presigned upload URL was issued but the PUT never landed.
    """
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")
    source_key = f"{project.storage_prefix}source.zip"
    if not await storage.exists(source_key):
        raise HTTPException(404, "source zip not uploaded")
    raw = await storage.get_bytes(source_key)
    filenames, total = peek_zip_image_names(raw, limit=limit)
    return SourcePreviewResponse(filenames=filenames, total_image_count=total)


@router.get(
    "/projects/{project_id}/source-preview/{filename}/thumbnail",
    responses={
        200: {"content": {"image/jpeg": {}}, "description": "JPEG thumbnail bytes"},
        404: {"description": "Project, source.zip, or named entry not found"},
    },
    response_class=Response,
    operation_id="get_source_preview_thumbnail",
)
async def source_preview_thumbnail(
    project_id: str,
    filename: str,
    user: UserDep,
    db: DatabaseDep,
    storage: StorageDep,
) -> Response:
    """Return a JPEG thumbnail for one image entry inside the project's source.zip."""
    from pdomain_prep_for_pgdp.core.ingest import ZipImageEntryNotFound

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")
    source_key = f"{project.storage_prefix}source.zip"
    if not await storage.exists(source_key):
        raise HTTPException(404, "source zip not uploaded")
    raw = await storage.get_bytes(source_key)
    try:
        jpeg = extract_zip_image_thumbnail(raw, filename)
    except ZipImageEntryNotFound:
        raise HTTPException(404, "image entry not found in source zip") from None
    return Response(content=jpeg, media_type="image/jpeg")


@router.post("/projects/{project_id}/unarchive", response_model=Project, operation_id="unarchive_project")
async def unarchive_project(
    project_id: str,
    user: UserDep,
    db: DatabaseDep,
) -> Project:
    """Restore a soft-deleted project. Idempotent."""
    return await _set_archived(project_id, archived=False, user=user, db=db)


class ReviewStatusResponse(BaseModel):
    unreviewed_count: int
    """Number of non-ignored proof pages without a clean text_review stage row."""
    awaiting_review_job_id: str | None
    """Job id of the parked build_package job, or null if none exists."""


@router.get(
    "/projects/{project_id}/review-status",
    response_model=ReviewStatusResponse,
    operation_id="get_project_review_status",
)
async def get_project_review_status(
    project_id: str,
    user: UserDep,
    db: DatabaseDep,
    page_service: PageServiceDep,
) -> ReviewStatusResponse:
    """Return unreviewed page count + awaiting_review job for a project."""
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    from pdomain_prep_for_pgdp.core.page_service_helpers import list_page_records

    pages = list_page_records(page_service, project_id)
    proof_pages = [p for p in pages if not p.ignore]
    proof_page_ids = {f"{p.idx0:04d}" for p in proof_pages}

    clean_stages = await db.list_page_stages_by_status(project_id, PageStageStatus.clean)
    reviewed_ids = {s.page_id for s in clean_stages if s.stage_id == "text_review"}
    unreviewed_count = len(proof_page_ids - reviewed_ids)

    awaiting_review_job_id: str | None = None
    jobs = await db.list_recent_jobs(user.user_id, 200)
    for job in jobs:
        if (
            job.project_id == project_id
            and job.type == JobType.build_package
            and job.status == JobStatus.awaiting_review
        ):
            awaiting_review_job_id = job.id
            break

    return ReviewStatusResponse(
        unreviewed_count=unreviewed_count,
        awaiting_review_job_id=awaiting_review_job_id,
    )


class JobSubmitResponse(BaseModel):
    """Minimal response for project-level job submission routes."""

    job_id: str
    status: str


@router.post(
    "/projects/{project_id}/run-dirty",
    response_model=JobSubmitResponse,
    status_code=202,
    operation_id="project_run_dirty",
)
async def project_run_dirty(
    project_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    stage_filter: str | None = None,
) -> JobSubmitResponse:
    """Submit a project_run_dirty job."""
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    payload: dict[str, str] = {"data_root": str(settings.data_root)}
    if stage_filter is not None:
        payload["stage_filter"] = stage_filter

    job = Job(
        id=uuid.uuid4().hex,
        project_id=project_id,
        owner_id=user.user_id,
        type=JobType.project_run_dirty,
        status=JobStatus.queued,
        payload=payload,
    )
    await db.put_job(job)
    return JobSubmitResponse(job_id=job.id, status=job.status.value)


@router.post(
    "/projects/{project_id}/build-package",
    response_model=JobSubmitResponse,
    status_code=202,
    operation_id="project_build_package",
)
async def project_build_package(
    project_id: str,
    user: UserDep,
    db: DatabaseDep,
) -> JobSubmitResponse:
    """Submit a build_package job for the project."""
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    job = Job(
        id=uuid.uuid4().hex,
        project_id=project_id,
        owner_id=user.user_id,
        type=JobType.build_package,
        status=JobStatus.queued,
    )
    await db.put_job(job)
    return JobSubmitResponse(job_id=job.id, status=job.status.value)
