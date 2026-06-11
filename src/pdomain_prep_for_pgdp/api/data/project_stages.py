"""/api/data/projects/{id}/project-stages/* — project-scoped stage routes.

Spec: docs/specs/api-v2-deltas.md §1.2, §1.5, §2

Routes:
  GET  /projects/{id}/pipeline                               PipelineSnapshot
  GET  /projects/{id}/project-stages                        list[ProjectStageState]
  GET  /projects/{id}/project-stages/{stage_id}             ProjectStageState
  POST /projects/{id}/project-stages/{stage_id}/run         Job (always async)
  GET  /projects/{id}/project-stages/{stage_id}/artifact    bytes or redirect
  GET  /projects/{id}/events                                 SSE project channel

All project-stage routes enforce the registry-version 409 guard.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from pdomain_prep_for_pgdp.api.dependencies import (
    DatabaseDep,
    PageServiceDep,
    SettingsDep,
    StageEventsDep,
    UserDep,
)
from pdomain_prep_for_pgdp.core.models import (
    V2_PAGE_STAGE_IDS,
    V2_PROJECT_STAGE_IDS,
    Job,
    JobStatus,
    JobType,
    PageStageStatus,
    PageStageSummary,
    ProjectAutomation,
    ProjectStageState,
    ProjectStageStatus,
    StageRunRequest,
)
from pdomain_prep_for_pgdp.core.pipeline.project_stages import (
    ProjectStageStore,
)
from pdomain_prep_for_pgdp.core.pipeline.registry_version import (
    RegistryVersionMismatchError,
    check_registry_version,
)
from pdomain_prep_for_pgdp.core.pipeline.stage_registry import (
    V2_STAGE_IMPL,
)
from pdomain_prep_for_pgdp.core.pipeline.stage_registry import (
    StageNotImplemented as StageNotImplementedError,
)

if TYPE_CHECKING:
    from pdomain_prep_for_pgdp.core.models import Project

log = logging.getLogger(__name__)

router = APIRouter(tags=["project-stages"])

# ─── Internal helpers ─────────────────────────────────────────────────────────


def _project_stage_db_path(data_root: Path, project_id: str) -> Path:
    """Path to the project_stages SQLite DB for a project."""
    return data_root / "projects" / project_id / "project_stages.db"


def _get_store(data_root: Path, project_id: str) -> ProjectStageStore:
    path = _project_stage_db_path(data_root, project_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    return ProjectStageStore(path)


def _lazy_init_project_stages(
    store: ProjectStageStore,
    project_id: str,
) -> list[ProjectStageState]:
    """Return all 8 project-stage rows, initialising not-run rows on first access."""
    existing = store.list_for_project(project_id)
    existing_ids = {s.stage_id for s in existing}
    missing_ids = [sid for sid in V2_PROJECT_STAGE_IDS if sid not in existing_ids]
    if missing_ids:
        for sid in missing_ids:
            state = ProjectStageState(project_id=project_id, stage_id=sid)
            store.write(state)
        existing = store.list_for_project(project_id)
    # Order by V2_PROJECT_STAGE_IDS canonical order.
    by_id = {s.stage_id: s for s in existing}
    return [by_id[sid] for sid in V2_PROJECT_STAGE_IDS if sid in by_id]


def _registry_mismatch_response(exc: RegistryVersionMismatchError) -> JSONResponse:
    """Return the structured 409 response for registry version mismatch.

    The error handler wraps HTTPException.detail as {error: http_409, message: ...},
    so we return a JSONResponse directly to preserve the exact contract shape:
    {error: registry_version_mismatch, project_version: N, server_version: 2}.
    """
    return JSONResponse(status_code=409, content=exc.as_dict())


def _check_registry(project: Project) -> JSONResponse | None:
    """Return 409 JSONResponse if the project is on a legacy registry version, else None."""
    try:
        check_registry_version(project)
        return None
    except RegistryVersionMismatchError as exc:
        return _registry_mismatch_response(exc)


# ─── PipelineSnapshot route ───────────────────────────────────────────────────


class PipelineSnapshot(BaseModel):
    """Response for GET /projects/{id}/pipeline.

    api-v2-deltas.md §1.5 — single fetch to hydrate pipelineShell.
    """

    project: object  # Project model (dict-serialised)
    page_stages_summary: list[PageStageSummary]
    project_stages: list[ProjectStageState]
    automation: ProjectAutomation


async def _build_page_stages_summary(
    db: DatabaseDep,
    project_id: str,
) -> list[PageStageSummary]:
    """Compute per-stage aggregates across all pages.

    stale_count resolution (B5, recorded in api-v2-deltas.md §1.5):
    Per-stage count of pages where that stage is dirty.
    This is the most useful interpretation for pipelineShell.
    """
    # Fetch all page_stage rows for this project.
    all_rows = await db.list_page_stages_by_project(project_id)

    # Group by stage_id.
    by_stage: dict[str, list[PageStageStatus]] = {}
    for row in all_rows:
        by_stage.setdefault(row.stage_id, []).append(row.status)

    _status_rank = {
        PageStageStatus.failed: 5,
        PageStageStatus.dirty: 4,
        PageStageStatus.running: 3,
        PageStageStatus.clean: 1,
        PageStageStatus.not_applicable: 0,
        PageStageStatus.not_run: 0,
    }

    summaries: list[PageStageSummary] = []
    for stage_id in V2_PAGE_STAGE_IDS:
        statuses = by_stage.get(stage_id, [])
        if not statuses:
            worst = PageStageStatus.not_run.value
            stale_count = 0
            flagged_count = 0
        else:
            worst = max(statuses, key=lambda s: _status_rank.get(s, 0))
            stale_count = sum(1 for s in statuses if s == PageStageStatus.dirty)
            # flagged_count is reserved for future use (no flagged value in PageStageStatus yet).
            flagged_count = 0
            worst = worst.value
        summaries.append(
            PageStageSummary(
                stage_id=stage_id,
                worst_status=worst,
                stale_count=stale_count,
                flagged_count=flagged_count,
            )
        )
    return summaries


@router.get(
    "/projects/{project_id}/pipeline",
    operation_id="get_pipeline_snapshot",
)
async def get_pipeline_snapshot(
    project_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    page_service: PageServiceDep,
) -> JSONResponse:
    """GET /projects/{id}/pipeline — single fetch to hydrate pipelineShell.

    Returns PipelineSnapshot: project + page_stages_summary + project_stages
    + automation. Enforces registry-version 409 guard.

    api-v2-deltas.md §1.5.
    """
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry(project)) is not None:
        return rv

    store = _get_store(settings.data_root, project_id)
    project_stages = _lazy_init_project_stages(store, project_id)
    page_stages_summary = await _build_page_stages_summary(db, project_id)
    automation = ProjectAutomation()

    snapshot = {
        "project": project.model_dump(mode="json"),
        "page_stages_summary": [s.model_dump(mode="json") for s in page_stages_summary],
        "project_stages": [s.model_dump(mode="json") for s in project_stages],
        "automation": automation.model_dump(mode="json"),
    }
    return JSONResponse(content=snapshot)


# ─── Project-stage list and get ───────────────────────────────────────────────


@router.get(
    "/projects/{project_id}/project-stages",
    operation_id="list_project_stages",
)
async def list_project_stages(
    project_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
) -> JSONResponse:
    """Return all 8 project-scoped stage rows. Lazy-init on first access.

    api-v2-deltas.md §1.2.
    """
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry(project)) is not None:
        return rv

    store = _get_store(settings.data_root, project_id)
    rows = _lazy_init_project_stages(store, project_id)
    return JSONResponse(content=[r.model_dump(mode="json") for r in rows])


@router.get(
    "/projects/{project_id}/project-stages/{stage_id}",
    operation_id="get_project_stage",
)
async def get_project_stage(
    project_id: str,
    stage_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
) -> JSONResponse:
    """Return one project-stage row. 404 if not found.

    api-v2-deltas.md §1.2.
    """
    if stage_id not in V2_PROJECT_STAGE_IDS:
        raise HTTPException(422, f"unknown project stage_id: {stage_id!r}")

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry(project)) is not None:
        return rv

    store = _get_store(settings.data_root, project_id)
    row = store.read(project_id, stage_id)
    if row is None:
        # Lazy-init this stage.
        row = ProjectStageState(project_id=project_id, stage_id=stage_id)
        store.write(row)
    return JSONResponse(content=row.model_dump(mode="json"))


# ─── Project-stage run ────────────────────────────────────────────────────────


@router.post(
    "/projects/{project_id}/project-stages/{stage_id}/run",
    operation_id="run_project_stage",
    status_code=202,
)
async def run_project_stage(
    project_id: str,
    stage_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    stage_events: StageEventsDep,
    body: StageRunRequest | None = None,
) -> JSONResponse:
    """Submit a project-stage run. Always async (returns Job, HTTP 202).

    W0.1: enqueues JobType.run_project_stage (not run_page_stage with scope='project').
    W0.4: gate enforcement — if any project-scoped dep is not clean, returns 409
          with {error: 'stage_gate_blocked', stage_id, reason}.

    The handler (_handle_run_project_stage in job_runner.py) calls V2_STAGE_IMPL
    in a thread pool and dual-writes the artifact + ProjectStageStore row.

    api-v2-deltas.md §1.2.
    """
    from pdomain_prep_for_pgdp.core.pipeline.project_stages import check_stage_gate

    if stage_id not in V2_PROJECT_STAGE_IDS:
        raise HTTPException(422, f"unknown project stage_id: {stage_id!r}")

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry(project)) is not None:
        return rv

    store = _get_store(settings.data_root, project_id)

    row = store.read(project_id, stage_id)
    if row is None:
        row = ProjectStageState(project_id=project_id, stage_id=stage_id)
        store.write(row)

    # ── W0.4: gate enforcement ────────────────────────────────────────────────
    # Lazy-init all stage rows so check_stage_gate finds all deps.
    _lazy_init_project_stages(store, project_id)

    gate_ok, gate_reason = check_stage_gate(project_id, stage_id, store)
    if not gate_ok:
        return JSONResponse(
            content={
                "error": "stage_gate_blocked",
                "stage_id": stage_id,
                "reason": gate_reason or "upstream dep not clean",
            },
            status_code=409,
        )

    # ── Check if stage has a real implementation ──────────────────────────────
    impl_entry = V2_STAGE_IMPL.get(stage_id, {})
    impl_callable = impl_entry.get("cpu")
    is_placeholder = impl_callable is None
    if impl_callable is not None:
        try:
            # Probe with no args — project-stage impls raise StageNotImplemented
            # or TypeError; either signals it's a real impl (TypeError = wrong args = real).
            impl_callable()  # type: ignore[call-arg]
        except StageNotImplementedError:
            is_placeholder = True
        except Exception:
            # Other exceptions: TypeError on wrong args = impl is real.
            is_placeholder = False

    job_id = uuid.uuid4().hex
    now = datetime.now(UTC).timestamp()

    if is_placeholder:
        # Placeholder stage: immediately surface as failed with informational message.
        failed_row = row.model_copy(
            update={
                "status": ProjectStageStatus.failed,
                "error_message": f"stage '{stage_id}' not yet implemented",
                "last_run_at": now,
                "job_id": job_id,
            }
        )
        store.write(failed_row)
        project_key = f"project:{project_id}"
        await stage_events.publish(
            project_key,
            {
                "type": "project-stage-status",
                "stage_id": stage_id,
                "status": ProjectStageStatus.failed.value,
                "job_id": job_id,
                "error_message": failed_row.error_message,
            },
        )
        job = Job(
            id=job_id,
            project_id=project_id,
            owner_id=user.user_id,
            type=JobType.run_project_stage,  # W0.1: correct job type
            status=JobStatus.error,
            payload={
                "stage_id": stage_id,
                "error": f"stage '{stage_id}' not yet implemented",
            },
        )
        await db.put_job(job)
        return JSONResponse(content=job.model_dump(mode="json"), status_code=202)

    # ── Implemented stage: enqueue JobType.run_project_stage (W0.1) ──────────
    job = Job(
        id=job_id,
        project_id=project_id,
        owner_id=user.user_id,
        type=JobType.run_project_stage,  # W0.1: was run_page_stage — now correct
        status=JobStatus.queued,
        payload={
            "stage_id": stage_id,
        },
    )
    await db.put_job(job)

    # Push SSE status update: queued (handler will update to running).
    project_key = f"project:{project_id}"
    await stage_events.publish(
        project_key,
        {
            "type": "project-stage-status",
            "stage_id": stage_id,
            "status": "queued",
            "job_id": job_id,
            "error_message": None,
        },
    )

    return JSONResponse(content=job.model_dump(mode="json"), status_code=202)


# ─── Project-stage artifact fetch ────────────────────────────────────────────

# Content-type map per project-stage artifact type (api-v2-deltas.md §1.4).
_PROJECT_STAGE_CONTENT_TYPES: dict[str, str] = {
    "source": "application/json",
    "page_order": "application/json",
    "validation": "application/json",
    "proof_pack": "application/octet-stream",  # redirect in practice
    "build_package": "application/zip",
    "zip": "application/zip",
    "submit_check": "application/json",
    "archive": "application/json",
}

_PROJECT_STAGE_ARTIFACT_FILES: dict[str, str] = {
    "source": "output.json",
    "page_order": "output.json",
    "validation": "output.json",
    "proof_pack": "output.json",
    "build_package": "output.zip",
    "zip": "output.zip",
    "submit_check": "output.json",
    "archive": "output.json",
}


@router.get(
    "/projects/{project_id}/project-stages/{stage_id}/artifact",
    operation_id="get_project_stage_artifact",
    responses={
        200: {"description": "Stage artifact bytes; Content-Type per stage."},
        404: {"description": "Project not found, stage not clean, or artifact missing."},
        422: {"description": "Unknown stage_id."},
    },
)
async def get_project_stage_artifact(
    project_id: str,
    stage_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
):
    """Return artifact bytes for a clean project-scoped stage.

    api-v2-deltas.md §1.4. Redirect (302) for proof_pack/build_package/zip
    is not yet implemented (B4 not landed); returns 404 for those stages
    until their artifacts exist on disk.
    """
    from fastapi.responses import Response

    if stage_id not in V2_PROJECT_STAGE_IDS:
        raise HTTPException(422, f"unknown project stage_id: {stage_id!r}")

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry(project)) is not None:
        return rv

    store = _get_store(settings.data_root, project_id)
    row = store.read(project_id, stage_id)
    if row is None or row.status != ProjectStageStatus.clean:
        raise HTTPException(404, "no clean artifact for this project stage")

    artifact_file = _PROJECT_STAGE_ARTIFACT_FILES.get(stage_id, "output.json")
    artifact_path = settings.data_root / "projects" / project_id / "stages" / stage_id / artifact_file
    if not artifact_path.exists():
        raise HTTPException(404, "project stage artifact missing on disk")

    content_type = _PROJECT_STAGE_CONTENT_TYPES.get(stage_id, "application/octet-stream")
    return Response(content=artifact_path.read_bytes(), media_type=content_type)


# ─── Project-level SSE channel ────────────────────────────────────────────────


@router.get(
    "/projects/{project_id}/events",
    operation_id="stream_project_stage_events",
)
async def stream_project_stage_events(
    project_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    stage_events: StageEventsDep,
) -> Response:
    """SSE — project-level event channel.

    On connect: emits a `project-snapshot` frame with all 8 project-stage rows.
    Subsequent frames are incremental events published to `project:{project_id}`:
      - project-stage-status  (stage status transition)
      - project-stage-progress  (long-running stage progress ticks)
      - page-reorder  (page order mutation)
      - validation-updated  (validation stage run completes)

    Spec: docs/specs/api-v2-deltas.md §2.
    """
    import json as _json
    from collections.abc import AsyncIterator

    from sse_starlette.sse import EventSourceResponse

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry(project)) is not None:
        return rv

    store = _get_store(settings.data_root, project_id)
    project_stages = _lazy_init_project_stages(store, project_id)
    project_key = f"project:{project_id}"

    async def _stream() -> AsyncIterator[dict[str, str]]:
        snapshot = {
            "type": "project-snapshot",
            "project_stages": [s.model_dump(mode="json") for s in project_stages],
        }
        yield {"event": "project-snapshot", "data": _json.dumps(snapshot)}

        async for ev in stage_events.subscribe(project_key):
            yield {"event": str(ev.get("type", "project-stage-status")), "data": _json.dumps(ev)}

    return EventSourceResponse(_stream())  # type: ignore[return-value]
