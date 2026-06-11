"""/api/data/projects/* -- project CRUD."""

from __future__ import annotations

import json
import logging
import shutil
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Literal, cast

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


# W6.3: ReviewStatusResponse, get_project_review_status, project_run_dirty,
# and project_build_package routes were deleted here. They were backed by the
# deprecated JobType.build_package / project_run_dirty job types.
# Replacements:
#   - build_package → POST /projects/{id}/project-stages/build_package/run
#   - run-dirty → per-stage run routes via pipelineShell.RUN_ALL_STALE
#   - review-status → project-stages snapshot (GET /projects/{id}/pipeline)


# ─── W4 Group 4: Activity, Attributes, Manage, Pipeline ──────────────────────


class _ActivityEntry(BaseModel):
    id: str
    event_type: str
    stage_id: str | None = None
    description: str | None = None
    created_at: str


@router.get(
    "/projects/{project_id}/activity",
    response_model=list[_ActivityEntry],
    operation_id="get_project_activity",
)
async def get_project_activity(
    project_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    limit: int = 20,
) -> list[_ActivityEntry]:
    """Return recent pipeline activity for a project.

    Reads recorded events from the eventsourcing aggregate.
    Returns an empty list when no events exist yet (new project).
    W4 Group 4.
    """
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    entries: list[_ActivityEntry] = []
    try:
        from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import (
            PrepApplication,
        )

        events_db_path = settings.data_root / "projects" / project_id / "events.db"
        if events_db_path.exists():
            _app = PrepApplication(
                env={
                    "PERSISTENCE_MODULE": "eventsourcing.sqlite",
                    "SQLITE_DBNAME": str(events_db_path),
                }
            )
            try:
                # Read the eventsourcing notification log (no aggregate load needed).
                raw_events = list(_app.notification_log.select(start=1, limit=limit))
                for ev in reversed(raw_events):
                    event_name = ev.topic.split(".")[-1]
                    entries.append(
                        _ActivityEntry(
                            id=str(ev.id),
                            event_type=event_name,
                            stage_id=None,
                            description=event_name,
                            created_at=datetime.now(UTC).isoformat(),
                        )
                    )
            except Exception as exc:
                log.debug("activity: error reading events for %s: %s", project_id, exc)
            finally:
                _app.close()
    except Exception as exc:
        log.debug("activity: events.db not available for %s: %s", project_id, exc)

    return entries[:limit]


class _AttributeRecord(BaseModel):
    bib: dict[str, str] = {}
    pgdp: dict[str, str] = {}
    fmt: dict[str, str] = {}
    comments: str = ""


@router.get(
    "/projects/{project_id}/attributes",
    response_model=_AttributeRecord,
    operation_id="get_project_attributes",
)
async def get_project_attributes(
    project_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
) -> _AttributeRecord:
    """Return project bibliographic and PGDP attributes.

    Reads from attributes.json if it exists (written by PATCH);
    otherwise derives bib data from the project config.
    W4 Group 4.
    """
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    attrs_path = settings.data_root / "projects" / project_id / "attributes.json"
    if attrs_path.exists():
        try:
            data = json.loads(attrs_path.read_text())
            return _AttributeRecord(**data)
        except Exception as exc:
            log.debug("attributes: failed to parse attributes.json for %s: %s", project_id, exc)

    return _AttributeRecord(
        bib={
            "Title": project.config.book_name,
            "Author": project.config.author or "—",
        },
        pgdp={"Project ID": project.id},
        fmt={},
        comments="",
    )


@router.patch(
    "/projects/{project_id}/attributes/{section}",
    response_model=_AttributeRecord,
    operation_id="patch_project_attributes",
)
async def patch_project_attributes(
    project_id: str,
    section: Literal["bib", "pgdp", "fmt", "comments"],
    body: dict[str, Any],
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
) -> _AttributeRecord:
    """Persist one section of project bibliographic attributes.

    Writes merged attributes.json under the project directory.
    Syncs author back to ProjectConfig when bib.Author is updated.
    W4 Group 4.
    """
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    project_dir = settings.data_root / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    attrs_path = project_dir / "attributes.json"

    # Load existing or build fresh
    if attrs_path.exists():
        try:
            existing: dict[str, Any] = json.loads(attrs_path.read_text())
        except Exception:
            existing = {}
    else:
        existing = {
            "bib": {"Title": project.config.book_name, "Author": project.config.author or "—"},
            "pgdp": {"Project ID": project.id},
            "fmt": {},
            "comments": "",
        }

    # Merge the patch into the section
    if section == "comments":
        existing["comments"] = body.get("comments", existing.get("comments", ""))
    else:
        section_data: dict[str, str] = existing.get(section, {})
        for k, v in body.items():
            section_data[k] = str(v)
        existing[section] = section_data

    # Sync author back to ProjectConfig when bib.Author changes
    if section == "bib" and "Author" in body:
        updated_config = project.config.model_copy(update={"author": str(body["Author"])})
        updated_project = project.model_copy(
            update={
                "config": updated_config,
                "updated_at": datetime.now(UTC),
            }
        )
        await db.put_project(updated_project)

    attrs_path.write_text(json.dumps(existing, indent=2))
    return _AttributeRecord(**existing)


class _CleanResponse(BaseModel):
    project_id: str
    reclaimed_bytes: int


@router.post(
    "/projects/{project_id}/clean",
    response_model=_CleanResponse,
    operation_id="clean_project",
)
async def clean_project(
    project_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
) -> _CleanResponse:
    """Reclaim disk space by removing intermediate stage artifacts.

    Cleans per-page stage artifact directories (keeps source images).
    Pipeline stages will need to be re-run after clean.
    W4 Group 4.
    """
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    reclaimed = 0
    pages_dir = settings.data_root / "projects" / project_id / "pages"
    if pages_dir.exists():
        for page_stages in pages_dir.glob("*/stages"):
            if page_stages.is_dir():
                for stage_dir in page_stages.iterdir():
                    if stage_dir.is_dir():
                        for f in stage_dir.rglob("*"):
                            if f.is_file():
                                reclaimed += f.stat().st_size
                        shutil.rmtree(stage_dir, ignore_errors=True)

    return _CleanResponse(project_id=project_id, reclaimed_bytes=reclaimed)


class _ExportResponse(BaseModel):
    project_id: str
    copy_id: str
    created_at: str


@router.post(
    "/projects/{project_id}/export",
    response_model=_ExportResponse,
    operation_id="export_project_copy",
)
async def export_project_copy(
    project_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
) -> _ExportResponse:
    """Create a copy of the project configuration for backup or transfer.

    At I1: creates a stub export record. Full artifact copy (source + stages)
    deferred to I2 when storage adapter supports multi-key copy.
    W4 Group 4.
    """
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    copy_id = uuid.uuid4().hex
    return _ExportResponse(
        project_id=project_id,
        copy_id=copy_id,
        created_at=datetime.now(UTC).isoformat(),
    )


class _PipelineActionResponse(BaseModel):
    project_id: str
    action: str
    performed_at: str


@router.post(
    "/projects/{project_id}/pipeline/reset",
    response_model=_PipelineActionResponse,
    operation_id="reset_project_pipeline",
)
async def reset_project_pipeline(
    project_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
) -> _PipelineActionResponse:
    """Reset all project-stage states to not_run.

    Marks all project stages as not_run so the pipeline can be re-run from
    scratch. Does NOT delete artifacts (use /purge for that).
    W4 Group 4.
    """
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    from pdomain_prep_for_pgdp.core.models import ProjectStageState, ProjectStageStatus
    from pdomain_prep_for_pgdp.core.pipeline.project_stages import ProjectStageStore
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import V2_PROJECT_STAGE_IDS

    db_path = settings.data_root / "projects" / project_id / "project_stages.db"
    db_path.parent.mkdir(parents=True, exist_ok=True)
    store = ProjectStageStore(db_path)
    for stage_id in V2_PROJECT_STAGE_IDS:
        row = store.read(project_id, stage_id)
        if row is not None:
            store.write(
                ProjectStageState(
                    project_id=project_id,
                    stage_id=stage_id,
                    status=ProjectStageStatus.not_run,
                )
            )

    return _PipelineActionResponse(
        project_id=project_id,
        action="reset",
        performed_at=datetime.now(UTC).isoformat(),
    )


@router.post(
    "/projects/{project_id}/pipeline/purge",
    response_model=_PipelineActionResponse,
    operation_id="purge_project_pipeline",
)
async def purge_project_pipeline(
    project_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
) -> _PipelineActionResponse:
    """Destructive: reset pipeline state AND delete all stage artifacts.

    Combines /clean and /pipeline/reset in one operation. Use with caution —
    all intermediate pipeline outputs will need to be regenerated.
    W4 Group 4.
    """
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    # Clean artifacts
    pages_dir = settings.data_root / "projects" / project_id / "pages"
    if pages_dir.exists():
        for page_stages in pages_dir.glob("*/stages"):
            if page_stages.is_dir():
                shutil.rmtree(page_stages, ignore_errors=True)

    # Reset project stage states
    from pdomain_prep_for_pgdp.core.models import ProjectStageState, ProjectStageStatus
    from pdomain_prep_for_pgdp.core.pipeline.project_stages import ProjectStageStore
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import V2_PROJECT_STAGE_IDS

    db_path = settings.data_root / "projects" / project_id / "project_stages.db"
    db_path.parent.mkdir(parents=True, exist_ok=True)
    store = ProjectStageStore(db_path)
    for stage_id in V2_PROJECT_STAGE_IDS:
        row = store.read(project_id, stage_id)
        if row is not None:
            store.write(
                ProjectStageState(
                    project_id=project_id,
                    stage_id=stage_id,
                    status=ProjectStageStatus.not_run,
                )
            )

    return _PipelineActionResponse(
        project_id=project_id,
        action="purge",
        performed_at=datetime.now(UTC).isoformat(),
    )
