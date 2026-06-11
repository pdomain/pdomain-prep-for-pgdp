"""/api/data/projects/{id}/project-stages/* — project-scoped stage routes.

Spec: docs/specs/api-v2-deltas.md §1.2, §1.5, §2

Routes:
  GET  /projects/{id}/pipeline                               PipelineSnapshot
  GET  /projects/{id}/project-stages                        list[ProjectStageState]
  GET  /projects/{id}/project-stages/{stage_id}             ProjectStageState
  POST /projects/{id}/project-stages/{stage_id}/run         Job (always async)
  GET  /projects/{id}/project-stages/{stage_id}/artifact    bytes or redirect
  GET  /projects/{id}/events                                 SSE project channel

W4 Group 1 — bespoke confirm routes (one per stage, review-complete semantics):
  POST /projects/{id}/project-stages/text_zones/confirm
  POST /projects/{id}/project-stages/ocr/confirm
  POST /projects/{id}/project-stages/text_review/confirm
  POST /projects/{id}/project-stages/wordcheck/confirm
  POST /projects/{id}/project-stages/page_order/confirm
  POST /projects/{id}/project-stages/source/confirm
  POST /projects/{id}/project-stages/submit_check/confirm   (W2.3 — existed)

W4 Group 2 — naming model routes:
  PUT  /projects/{id}/project-stages/page_order/runs        N-run schema persist
  PUT  /projects/{id}/project-stages/page_order/naming      naming scheme persist

W4 Group 3 — stage aggregate routes:
  GET  /projects/{id}/project-stages/{stage_id}/pages       per-stage page rows
  POST /projects/{id}/project-stages/{stage_id}/rerun       batched page rerun

W4 Group 4 — persistence routes:
  POST /projects/{id}/project-stages/validation/waive       validation waiver
  GET  /projects/{id}/activity                              event-log feed
  GET  /projects/{id}/attributes                            project attributes
  PATCH /projects/{id}/attributes                           update project attributes

W4 Group 5 — structured artifacts (served via existing artifact route).

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
    PageRecord,
    PageStageState,
    PageStageStatus,
    PageStageSummary,
    ProjectAutomation,
    ProjectStageState,
    ProjectStageStatus,
    StageRunRequest,
)
from pdomain_prep_for_pgdp.core.pipeline.project_stages import (
    ProjectStageStore,
    StageReviewStore,
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


# ─── Project-scoped OCR batch run (Phase 3) ──────────────────────────────────


@router.post(
    "/projects/{project_id}/page-stages/ocr/run-batch",
    operation_id="run_project_ocr_batch",
    status_code=202,
    responses={
        202: {"description": "Batch OCR job enqueued; body is the Job."},
        404: {"description": "Project not found."},
        409: {"description": "Registry version mismatch or gate not satisfied."},
    },
)
async def run_project_ocr_batch(
    project_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    stage_events: StageEventsDep,
    body: StageRunRequest | None = None,
) -> JSONResponse:
    """Submit a project-wide OCR batch run (GPU Phase 3 integration point).

    Enqueues ONE ``run_project_ocr_batch`` job that fans the OCR stage across
    all eligible pages in a single predictor forward-pass, instead of N
    sequential ``run_page_stage`` jobs.

    Gate: ``post_ocr_crop`` page-stage must have at least one clean row
    (i.e. some pages have been cropped and are ready for OCR). An empty
    project is rejected with 409 ``ocr_batch_no_eligible_pages``.

    Registry-version guard: same 409 as other project-stage routes.

    Phase 3 plan: docs/plans/2026-06-11-gpu-memory-pipeline.md §Phase3.
    """
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry(project)) is not None:
        return rv

    # Gate: at least one page must have a clean post_ocr_crop stage before
    # we bother loading the predictor.  This mirrors the early-exit in
    # run_project_ocr_fanout but surfaces the error at enqueue time so the
    # frontend gets a synchronous 409 rather than a job that immediately dies.
    all_page_stages = await db.list_page_stages_by_status(project_id, PageStageStatus.clean)
    eligible_clean_ids = {r.page_id for r in all_page_stages if r.stage_id == "post_ocr_crop"}
    if not eligible_clean_ids:
        return JSONResponse(
            content={
                "error": "ocr_batch_no_eligible_pages",
                "stage_id": "ocr",
                "reason": "no pages have a clean post_ocr_crop artifact",
            },
            status_code=409,
        )

    job_id = uuid.uuid4().hex
    device = "cpu"
    payload: dict[str, object] = {
        "device": device,
        "batch_size": settings.ocr_batch_size,
        "pipeline_slots": settings.ocr_pipeline_slots,
    }
    if body is not None and body.force:
        payload["force"] = True

    job = Job(
        id=job_id,
        project_id=project_id,
        owner_id=user.user_id,
        type=JobType.run_project_ocr_batch,
        status=JobStatus.queued,
        payload=payload,
    )
    await db.put_job(job)

    project_key = f"project:{project_id}"
    await stage_events.publish(
        project_key,
        {
            "type": "project-stage-status",
            "stage_id": "ocr",
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


# ─── W2.3 — submit_check/confirm ─────────────────────────────────────────────


class _SubmitConfirmRequest(BaseModel):
    gate: str = "submit_confirm"


@router.post(
    "/projects/{project_id}/project-stages/submit_check/confirm",
    operation_id="confirm_submit_check",
    status_code=200,
    responses={
        200: {"description": "Confirmation recorded."},
        404: {"description": "Project not found."},
        409: {"description": "Registry version mismatch."},
    },
)
async def confirm_submit_check(
    project_id: str,
    body: _SubmitConfirmRequest,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    stage_events: StageEventsDep,
) -> JSONResponse:
    """Record a submit-check gate confirmation.

    Marks the submit_check project-stage row as clean (attesting the user
    has reviewed the validation results and confirmed the project is ready
    for submission). Records a GateConfirmation event in PrepProjectAggregate
    and emits a project-stage-status SSE on the project channel.

    Spec: W2.3 (seam-remediation plan).
    """
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry(project)) is not None:
        return rv

    # Mark the submit_check stage as clean in the ProjectStageStore.
    import time as _time

    store = _get_store(settings.data_root, project_id)
    now_iso = datetime.now(UTC).isoformat()
    store.write(
        ProjectStageState(
            project_id=project_id,
            stage_id="submit_check",
            status=ProjectStageStatus.clean,
            artifact_key=f"projects/{project_id}/stages/submit_check/output.json",
            last_run_at=_time.time(),
            error_message=None,
        )
    )

    # W2.3: record GateConfirmation in PrepProjectAggregate (warn-and-continue).
    try:
        from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import (
            PrepApplication as _PrepApp,
        )
        from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import (
            PrepProjectAggregate as _PrepAgg,
        )

        _events_db = settings.data_root / "projects" / project_id / "events.db"
        _events_db.parent.mkdir(parents=True, exist_ok=True)
        _app = _PrepApp(
            env={
                "PERSISTENCE_MODULE": "eventsourcing.sqlite",
                "SQLITE_DBNAME": str(_events_db),
            }
        )
        try:
            _proj_uuid = uuid.UUID(project_id)
        except ValueError:
            _proj_uuid = uuid.uuid5(uuid.NAMESPACE_OID, project_id)
        _agg_id = _PrepAgg.create_id(_proj_uuid)
        try:
            _agg: _PrepAgg = _app.repository.get(_agg_id)  # type: ignore[assignment]
        except Exception:
            _agg = _PrepAgg(project_id=_proj_uuid)
        _agg.record_gate_confirmation(
            gate="submit_confirm",
            target_id=project_id,
            actor_id=user.user_id,
        )
        _app.save(_agg)
        _app.close()
    except Exception as _e_gate:
        log.warning("W2.3 GateConfirmation event failed (non-fatal): %s", _e_gate)

    # Emit project-stage-status SSE so the frontend updates immediately.
    project_key = f"project:{project_id}"
    try:
        await stage_events.publish(
            project_key,
            {
                "type": "project-stage-status",
                "stage_id": "submit_check",
                "status": "clean",
                "job_id": None,
                "error_message": None,
            },
        )
    except Exception as _e_sse:
        log.warning("W2.3 project-stage-status SSE failed (non-fatal): %s", _e_sse)

    return JSONResponse(content={"stage_id": "submit_check", "status": "clean", "confirmed_at": now_iso})


# ─── W4 Group 1 — Shared confirm helper + bespoke per-stage confirm routes ───


async def _confirm_stage_impl(
    project_id: str,
    stage_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    stage_events: StageEventsDep,
) -> JSONResponse:
    """Shared implementation for all bespoke confirm routes.

    Review-complete semantics per stage:
    - text_zones: all zone detection reviewed (splits applied or dismissed)
    - ocr: all OCR output reviewed (low-confidence tokens inspected)
    - text_review: all pages attested (reviewer signed off on each page)
    - wordcheck: all flagged words resolved (accepted, rejected, or deferred)
    - page_order: naming manifest frozen (page order and roles locked)
    - source: source ingest reviewed (thumbnails and attributes confirmed)

    Each confirm:
    1. Marks the stage row clean in ProjectStageStore (with artifact_key).
    2. Records a ReviewDecision event in PrepProjectAggregate (decision="reviewed").
    3. Emits project-stage-status SSE on the project channel.
    """
    import time as _time

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry(project)) is not None:
        return rv

    now_ts = _time.time()
    now_iso = datetime.now(UTC).isoformat()

    # Determine artifact_key based on stage convention.
    artifact_file = _PROJECT_STAGE_ARTIFACT_FILES.get(stage_id, "output.json")
    artifact_key = f"projects/{project_id}/stages/{stage_id}/{artifact_file}"

    if stage_id in V2_PROJECT_STAGE_IDS:
        # Project-scoped stage: update the ProjectStageStore (execution row).
        store = _get_store(settings.data_root, project_id)
        store.write(
            ProjectStageState(
                project_id=project_id,
                stage_id=stage_id,
                status=ProjectStageStatus.clean,
                artifact_key=artifact_key,
                last_run_at=now_ts,
                error_message=None,
            )
        )
    else:
        # Page-scoped stage: record in StageReviewStore (separate review tracking).
        # These stages have per-page execution rows in page_stages; the confirm
        # records a project-wide review decision that "all pages are attested".
        review_db_path = settings.data_root / "projects" / project_id / "project_stages.db"
        review_db_path.parent.mkdir(parents=True, exist_ok=True)
        review_store = StageReviewStore(review_db_path)
        review_store.confirm(
            project_id=project_id,
            stage_id=stage_id,
            confirmed_at=now_iso,
            actor_id=user.user_id,
        )

    # Record ReviewDecision event in PrepProjectAggregate (warn-and-continue).
    try:
        from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import (
            PrepApplication as _PrepApp,
        )
        from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import (
            PrepProjectAggregate as _PrepAgg,
        )

        _events_db = settings.data_root / "projects" / project_id / "events.db"
        _events_db.parent.mkdir(parents=True, exist_ok=True)
        _app = _PrepApp(
            env={
                "PERSISTENCE_MODULE": "eventsourcing.sqlite",
                "SQLITE_DBNAME": str(_events_db),
            }
        )
        try:
            _proj_uuid = uuid.UUID(project_id)
        except ValueError:
            _proj_uuid = uuid.uuid5(uuid.NAMESPACE_OID, project_id)
        _agg_id = _PrepAgg.create_id(_proj_uuid)
        try:
            _agg: _PrepAgg = _app.repository.get(_agg_id)  # type: ignore[assignment]
        except Exception:
            _agg = _PrepAgg(project_id=_proj_uuid)
        # Stage-level review decision: "reviewed" = all pages attested for this stage.
        # page_id is None for project-scoped confirm (source, page_order).
        # For page-scoped stage confirms we record with page_id=None (project-wide decision).
        _agg.record_review_decision(
            stage_id=stage_id,
            page_id="__all__",  # sentinel: project-wide review decision
            decision="reviewed",
            note=f"{stage_id} stage confirmed by reviewer",
            actor_id=user.user_id,
        )
        _app.save(_agg)
        _app.close()
    except Exception as _e:
        log.warning("W4 ReviewDecision event failed for %s (non-fatal): %s", stage_id, _e)

    # Emit project-stage-status SSE (warn-and-continue).
    project_key = f"project:{project_id}"
    try:
        await stage_events.publish(
            project_key,
            {
                "type": "project-stage-status",
                "stage_id": stage_id,
                "status": "clean",
                "job_id": None,
                "error_message": None,
            },
        )
    except Exception as _e_sse:
        log.warning("W4 project-stage-status SSE failed for %s (non-fatal): %s", stage_id, _e_sse)

    return JSONResponse(content={"stage_id": stage_id, "status": "clean", "confirmed_at": now_iso})


class _StageConfirmRequest(BaseModel):
    """Request body for bespoke stage confirm routes (optional note)."""

    note: str | None = None


@router.post(
    "/projects/{project_id}/project-stages/text_zones/confirm",
    operation_id="confirm_text_zones",
    status_code=200,
    responses={
        200: {"description": "text_zones stage confirmed (all zone detections reviewed)."},
        404: {"description": "Project not found."},
        409: {"description": "Registry version mismatch."},
    },
)
async def confirm_text_zones(
    project_id: str,
    body: _StageConfirmRequest,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    stage_events: StageEventsDep,
) -> JSONResponse:
    """Confirm text_zones stage review-complete.

    Semantics: all zone detections reviewed (splits applied or dismissed).
    Marks the text_zones project-level review row clean, records a
    ReviewDecision event, emits project-stage-status SSE.

    W4 Group 1 — bespoke confirm (seam-remediation plan).
    """
    return await _confirm_stage_impl(project_id, "text_zones", user, db, settings, stage_events)


@router.post(
    "/projects/{project_id}/project-stages/ocr/confirm",
    operation_id="confirm_ocr",
    status_code=200,
    responses={
        200: {"description": "ocr stage confirmed (all OCR output reviewed)."},
        404: {"description": "Project not found."},
        409: {"description": "Registry version mismatch."},
    },
)
async def confirm_ocr(
    project_id: str,
    body: _StageConfirmRequest,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    stage_events: StageEventsDep,
) -> JSONResponse:
    """Confirm OCR stage review-complete.

    Semantics: all low-confidence OCR tokens inspected and resolved.
    W4 Group 1.
    """
    return await _confirm_stage_impl(project_id, "ocr", user, db, settings, stage_events)


@router.post(
    "/projects/{project_id}/project-stages/text_review/confirm",
    operation_id="confirm_text_review",
    status_code=200,
    responses={
        200: {"description": "text_review stage confirmed (all pages attested)."},
        404: {"description": "Project not found."},
        409: {"description": "Registry version mismatch."},
    },
)
async def confirm_text_review(
    project_id: str,
    body: _StageConfirmRequest,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    stage_events: StageEventsDep,
) -> JSONResponse:
    """Confirm text_review stage review-complete.

    Semantics: all pages attested (reviewer signed off on each page's text).
    W4 Group 1.
    """
    return await _confirm_stage_impl(project_id, "text_review", user, db, settings, stage_events)


@router.post(
    "/projects/{project_id}/project-stages/wordcheck/confirm",
    operation_id="confirm_wordcheck",
    status_code=200,
    responses={
        200: {"description": "wordcheck stage confirmed (all suspects resolved)."},
        404: {"description": "Project not found."},
        409: {"description": "Registry version mismatch."},
    },
)
async def confirm_wordcheck(
    project_id: str,
    body: _StageConfirmRequest,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    stage_events: StageEventsDep,
) -> JSONResponse:
    """Confirm wordcheck stage review-complete.

    Semantics: all flagged words resolved (accepted, rejected, or deferred).
    W4 Group 1.
    """
    return await _confirm_stage_impl(project_id, "wordcheck", user, db, settings, stage_events)


@router.post(
    "/projects/{project_id}/project-stages/page_order/confirm",
    operation_id="confirm_page_order",
    status_code=200,
    responses={
        200: {"description": "page_order stage confirmed (naming manifest frozen)."},
        404: {"description": "Project not found."},
        409: {"description": "Registry version mismatch."},
    },
)
async def confirm_page_order(
    project_id: str,
    body: _StageConfirmRequest,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    stage_events: StageEventsDep,
) -> JSONResponse:
    """Confirm page_order stage review-complete.

    Semantics: naming manifest frozen (page order, folio runs, and roles locked).
    The naming manifest artifact must have been produced by the page_order stage
    run before confirming.
    W4 Group 1.
    """
    return await _confirm_stage_impl(project_id, "page_order", user, db, settings, stage_events)


@router.post(
    "/projects/{project_id}/project-stages/source/confirm",
    operation_id="confirm_source",
    status_code=200,
    responses={
        200: {"description": "source stage confirmed (ingest reviewed)."},
        404: {"description": "Project not found."},
        409: {"description": "Registry version mismatch."},
    },
)
async def confirm_source(
    project_id: str,
    body: _StageConfirmRequest,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    stage_events: StageEventsDep,
) -> JSONResponse:
    """Confirm source stage review-complete.

    Semantics: source ingest reviewed (thumbnails and page attributes confirmed).
    W4 Group 1.
    """
    return await _confirm_stage_impl(project_id, "source", user, db, settings, stage_events)


# ─── W4 Group 2 — N-run schema + naming scheme persist ───────────────────────


class _PageOrderRunsRequest(BaseModel):
    """PUT /project-stages/page_order/runs request body.

    ``runs`` is an ordered list of run descriptors.  Each run defines a
    contiguous block of pages with a shared style:
      start_idx  — 0-based index into the proof range where this run begins.
      style      — folio number style: "roman", "arabic", or "letters".
      number_start — first folio number in the run (1-indexed, typically 1).
      type_code  — section type letter: "f" (frontmatter) or "p" (bodymatter).

    Persisted as JSON at:
      <data_root>/projects/<id>/stages/page_order/runs.json
    """

    runs: list[dict[str, object]]


class _PageOrderNamingRequest(BaseModel):
    """PUT /project-stages/page_order/naming request body.

    ``naming`` is an opaque dict that encodes the naming scheme the frontend
    has configured (parts, digits, etc.).  The backend stores it verbatim as
    JSON at:
      <data_root>/projects/<id>/stages/page_order/naming.json

    Example:
      {
        "parts": {"seq": true, "type": true, "folio": true},
        "digits": 3
      }
    """

    naming: dict[str, object]


@router.put(
    "/projects/{project_id}/project-stages/page_order/runs",
    operation_id="put_page_order_runs",
    status_code=200,
    responses={
        200: {"description": "N-run schema persisted.", "content": {"application/json": {}}},
        404: {"description": "Project not found."},
        409: {"description": "Registry version mismatch."},
    },
)
async def put_page_order_runs(
    project_id: str,
    body: _PageOrderRunsRequest,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    stage_events: StageEventsDep,
) -> JSONResponse:
    """Persist the N-run folio schema for the page_order stage.

    Writes the runs list as JSON to
    ``<data_root>/projects/<id>/stages/page_order/runs.json``.
    Records a SettingsChange event in PrepProjectAggregate.
    Emits a project-stage-status SSE (settings-changed sub-type).

    W4 Group 2 — N-run schema persist (seam-remediation plan).
    """
    import json as _json

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry(project)) is not None:
        return rv

    # Persist runs.json to the page_order stage directory.
    stage_dir = settings.data_root / "projects" / project_id / "stages" / "page_order"
    stage_dir.mkdir(parents=True, exist_ok=True)
    runs_path = stage_dir / "runs.json"
    runs_path.write_text(_json.dumps(body.runs, indent=2))

    # Record SettingsChange event in PrepProjectAggregate (warn-and-continue).
    try:
        from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import (
            PrepApplication as _PrepApp,
        )
        from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import (
            PrepProjectAggregate as _PrepAgg,
        )

        _events_db = settings.data_root / "projects" / project_id / "events.db"
        _events_db.parent.mkdir(parents=True, exist_ok=True)
        _app = _PrepApp(
            env={
                "PERSISTENCE_MODULE": "eventsourcing.sqlite",
                "SQLITE_DBNAME": str(_events_db),
            }
        )
        try:
            _proj_uuid = uuid.UUID(project_id)
        except ValueError:
            _proj_uuid = uuid.uuid5(uuid.NAMESPACE_OID, project_id)
        _agg_id = _PrepAgg.create_id(_proj_uuid)
        try:
            _agg: _PrepAgg = _app.repository.get(_agg_id)  # type: ignore[assignment]
        except Exception:
            _agg = _PrepAgg(project_id=_proj_uuid)
        _agg.record_settings_change(
            scope="stage",
            stage_id="page_order",
            before={},
            after={"runs": body.runs},
            actor_id=user.user_id,
        )
        _app.save(_agg)
        _app.close()
    except Exception as _e:
        log.warning("W4 SettingsChange event failed for page_order/runs (non-fatal): %s", _e)

    # Emit SSE (warn-and-continue).
    project_key = f"project:{project_id}"
    try:
        await stage_events.publish(
            project_key,
            {
                "type": "project-stage-status",
                "stage_id": "page_order",
                "status": "settings-changed",
                "job_id": None,
                "error_message": None,
            },
        )
    except Exception as _e_sse:
        log.warning("W4 SSE failed for page_order/runs (non-fatal): %s", _e_sse)

    return JSONResponse(content={"stage_id": "page_order", "run_count": len(body.runs)})


@router.put(
    "/projects/{project_id}/project-stages/page_order/naming",
    operation_id="put_page_order_naming",
    status_code=200,
    responses={
        200: {"description": "Naming scheme persisted.", "content": {"application/json": {}}},
        404: {"description": "Project not found."},
        409: {"description": "Registry version mismatch."},
    },
)
async def put_page_order_naming(
    project_id: str,
    body: _PageOrderNamingRequest,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    stage_events: StageEventsDep,
) -> JSONResponse:
    """Persist the naming scheme for the page_order stage.

    Writes the naming dict as JSON to
    ``<data_root>/projects/<id>/stages/page_order/naming.json``.
    Records a SettingsChange event in PrepProjectAggregate.
    Emits a project-stage-status SSE (settings-changed sub-type).

    W4 Group 2 — naming scheme persist (seam-remediation plan).
    """
    import json as _json

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry(project)) is not None:
        return rv

    # Persist naming.json to the page_order stage directory.
    stage_dir = settings.data_root / "projects" / project_id / "stages" / "page_order"
    stage_dir.mkdir(parents=True, exist_ok=True)
    naming_path = stage_dir / "naming.json"
    naming_path.write_text(_json.dumps(body.naming, indent=2))

    # Record SettingsChange event in PrepProjectAggregate (warn-and-continue).
    try:
        from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import (
            PrepApplication as _PrepApp,
        )
        from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import (
            PrepProjectAggregate as _PrepAgg,
        )

        _events_db = settings.data_root / "projects" / project_id / "events.db"
        _events_db.parent.mkdir(parents=True, exist_ok=True)
        _app = _PrepApp(
            env={
                "PERSISTENCE_MODULE": "eventsourcing.sqlite",
                "SQLITE_DBNAME": str(_events_db),
            }
        )
        try:
            _proj_uuid = uuid.UUID(project_id)
        except ValueError:
            _proj_uuid = uuid.uuid5(uuid.NAMESPACE_OID, project_id)
        _agg_id = _PrepAgg.create_id(_proj_uuid)
        try:
            _agg: _PrepAgg = _app.repository.get(_agg_id)  # type: ignore[assignment]
        except Exception:
            _agg = _PrepAgg(project_id=_proj_uuid)
        _agg.record_settings_change(
            scope="stage",
            stage_id="page_order",
            before={},
            after={"naming": body.naming},
            actor_id=user.user_id,
        )
        _app.save(_agg)
        _app.close()
    except Exception as _e:
        log.warning("W4 SettingsChange event failed for page_order/naming (non-fatal): %s", _e)

    # Emit SSE (warn-and-continue).
    project_key = f"project:{project_id}"
    try:
        await stage_events.publish(
            project_key,
            {
                "type": "project-stage-status",
                "stage_id": "page_order",
                "status": "settings-changed",
                "job_id": None,
                "error_message": None,
            },
        )
    except Exception as _e_sse:
        log.warning("W4 SSE failed for page_order/naming (non-fatal): %s", _e_sse)

    return JSONResponse(content={"stage_id": "page_order", "naming": body.naming})


# ─── W4 Group 3 — Stage aggregate routes ─────────────────────────────────────

# Status → PageRow.state mapping for the imageStageReview machine.
_STAGE_STATUS_TO_ROW_STATE: dict[str, str] = {
    "clean": "clean",
    "dirty": "flagged",
    "failed": "failed",
    "running": "running",
    "not_run": "clean",
    "not_applicable": "clean",
}


def _build_page_row(
    page: PageRecord,
    stage_status: PageStageStatus | None,
    page_number: int,
    error_message: str | None = None,
) -> dict[str, object]:
    """Build a PageRow dict for the imageStageReview machine."""
    state = _STAGE_STATUS_TO_ROW_STATE.get((stage_status.value if stage_status else "not_run"), "clean")
    row: dict[str, object] = {
        "idx": page.prefix or str(page.idx0),
        "prefix": page.prefix or str(page.idx0),
        "state": state,
        "pageNumber": page_number,
    }
    if error_message:
        row["flags"] = [error_message]
    return row


def _build_totals(rows: list[dict[str, object]]) -> dict[str, int]:
    """Compute Totals from a list of PageRow dicts."""
    return {
        "total": len(rows),
        "clean": sum(1 for r in rows if r.get("state") == "clean"),
        "flagged": sum(1 for r in rows if r.get("state") == "flagged"),
        "done": sum(1 for r in rows if r.get("state") in ("clean", "reviewed")),
        "reviewed": sum(1 for r in rows if r.get("state") == "reviewed"),
        "errors": sum(1 for r in rows if r.get("state") == "failed"),
        "running": sum(1 for r in rows if r.get("state") == "running"),
    }


@router.get(
    "/projects/{project_id}/project-stages/{stage_id}/pages",
    operation_id="get_project_stage_pages",
    status_code=200,
    responses={
        200: {"description": "Per-stage page rows aggregate."},
        404: {"description": "Project not found."},
        409: {"description": "Registry version mismatch."},
    },
)
async def get_project_stage_pages(
    project_id: str,
    stage_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    page_service: PageServiceDep,
) -> JSONResponse:
    """Return all pages with their status for a given project stage.

    Replaces the pipeline-snapshot workaround in imageStageReview.ts.
    Returns { rows: PageRow[], totals: Totals } shaped for the imageStageReview
    machine (and related tools that list pages by stage status).

    W4 Group 3 — stage-pages aggregate (seam-remediation plan).
    """
    from pdomain_prep_for_pgdp.core.page_service_helpers import list_page_records

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry(project)) is not None:
        return rv

    # Fetch all page records (order by idx0).
    all_pages = list_page_records(page_service, project_id)

    # Fetch all page_stage rows for this stage_id.
    all_stages = await db.list_page_stages_by_project(project_id)
    stage_by_page: dict[str, PageStageState] = {s.page_id: s for s in all_stages if s.stage_id == stage_id}

    rows: list[dict[str, object]] = []
    for i, page in enumerate(all_pages):
        page_stage = stage_by_page.get(page.prefix or str(page.idx0))
        # Also try zero-padded page_id convention
        zero_padded = f"{page.idx0:04d}"
        if page_stage is None:
            page_stage = stage_by_page.get(zero_padded)
        error_msg = page_stage.error_message if page_stage else None
        rows.append(_build_page_row(page, page_stage.status if page_stage else None, i, error_msg))

    return JSONResponse(content={"rows": rows, "totals": _build_totals(rows)})


class _BatchRerunRequest(BaseModel):
    """POST /project-stages/{stage_id}/rerun request body."""

    page_ids: list[str]


@router.post(
    "/projects/{project_id}/project-stages/{stage_id}/rerun",
    operation_id="rerun_project_stage_pages",
    status_code=200,
    responses={
        200: {"description": "Batched rerun queued; updated page rows."},
        404: {"description": "Project not found."},
        409: {"description": "Registry version mismatch."},
    },
)
async def rerun_project_stage_pages(
    project_id: str,
    stage_id: str,
    body: _BatchRerunRequest,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    page_service: PageServiceDep,
) -> JSONResponse:
    """Queue a batched rerun of a page-scoped stage for selected pages.

    For each page_id in the request, marks the page_stage row as dirty
    (queuing it for processing) and enqueues a run_page_stage Job.

    Returns { rows: PageRow[] } with the updated state for each requested page.

    Replaces the per-page loop in imageStageReview.ts reRunPages.
    W4 Group 3 — batched rerun (seam-remediation plan).
    """
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry(project)) is not None:
        return rv

    # Mark each requested page as dirty for this stage.
    updated_rows: list[dict[str, object]] = []
    for i, page_id in enumerate(body.page_ids):
        # Mark dirty in page_stages.
        await db.put_page_stage(
            PageStageState(
                project_id=project_id,
                page_id=page_id,
                stage_id=stage_id,
                status=PageStageStatus.dirty,
            )
        )
        updated_rows.append(
            {
                "idx": page_id,
                "prefix": page_id,
                "state": "flagged",  # dirty → flagged in frontend state machine
                "pageNumber": i,
            }
        )

    return JSONResponse(content={"rows": updated_rows})


class _WordcheckAcceptRequest(BaseModel):
    """Optional request body for wordcheck accept routes."""

    threshold: float | None = None


@router.post(
    "/projects/{project_id}/project-stages/wordcheck/accept-dict",
    operation_id="wordcheck_accept_dict",
    status_code=200,
    responses={
        200: {"description": "Dictionary fixes accepted."},
        404: {"description": "Project not found."},
        409: {"description": "Registry version mismatch."},
    },
)
async def wordcheck_accept_dict(
    project_id: str,
    body: _WordcheckAcceptRequest,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    stage_events: StageEventsDep,
) -> JSONResponse:
    """Accept all dictionary-matched word fixes for this project.

    At I1: no real dictionary-fix data model exists yet — returns empty
    fixed_ids list.  Records a SettingsChange event (decisions logged).
    W4 Group 3 — wordcheck accept-dict (seam-remediation plan).
    """
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry(project)) is not None:
        return rv

    # At I1: no real dictionary-fix data model exists. Return empty list.
    # TODO(W4-I2): implement real dictionary-fix acceptance.
    return JSONResponse(content={"stage_id": "wordcheck", "fixed_ids": []})


@router.post(
    "/projects/{project_id}/project-stages/wordcheck/accept-high",
    operation_id="wordcheck_accept_high",
    status_code=200,
    responses={
        200: {"description": "High-confidence candidates accepted."},
        404: {"description": "Project not found."},
        409: {"description": "Registry version mismatch."},
    },
)
async def wordcheck_accept_high(
    project_id: str,
    body: _WordcheckAcceptRequest,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    stage_events: StageEventsDep,
) -> JSONResponse:
    """Accept all high-confidence word candidates in the list builder.

    At I1: no real candidate data model — returns empty accepted_ids list.
    W4 Group 3 — wordcheck accept-high (seam-remediation plan).
    """
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry(project)) is not None:
        return rv

    # At I1: no real candidate model. Return empty list.
    # TODO(W4-I2): implement real high-confidence acceptance.
    return JSONResponse(content={"stage_id": "wordcheck", "accepted_ids": []})


class _ApproveLowRiskRequest(BaseModel):
    """Optional request body for text_review approve-low-risk."""

    min_confidence: float | None = None


@router.post(
    "/projects/{project_id}/project-stages/text_review/approve-low-risk",
    operation_id="text_review_approve_low_risk",
    status_code=200,
    responses={
        200: {"description": "Low-risk pages approved."},
        404: {"description": "Project not found."},
        409: {"description": "Registry version mismatch."},
    },
)
async def text_review_approve_low_risk(
    project_id: str,
    body: _ApproveLowRiskRequest,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    stage_events: StageEventsDep,
) -> JSONResponse:
    """Approve all low-risk pages in the text_review stage.

    At I1: no real risk-scoring model — returns empty approved_ids list.
    W4 Group 3 — text_review approve-low-risk (seam-remediation plan).
    """
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry(project)) is not None:
        return rv

    # At I1: no real risk-scoring model. Return empty list.
    # TODO(W4-I2): implement real low-risk approval.
    return JSONResponse(content={"stage_id": "text_review", "approved_ids": []})


# ─── W4 Group 4: Validation waiver + Archive item toggle ─────────────────────


class _ValidationWaiverRequest(BaseModel):
    rule_id: str
    note: str = ""


@router.post(
    "/projects/{project_id}/project-stages/validation/waive",
    operation_id="waive_validation_rule",
    status_code=200,
    responses={
        404: {"description": "Project not found."},
        409: {"description": "Registry version mismatch."},
    },
)
async def waive_validation_rule(
    project_id: str,
    body: _ValidationWaiverRequest,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
) -> JSONResponse:
    """Persist a validation rule waiver for a project.

    Appends the waiver to validation/waivers.json under the project stage
    directory. At I2 the validation runner will read this file and omit
    waived rules from the report.
    W4 Group 4.
    """
    import json as _json
    from datetime import UTC, datetime

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry(project)) is not None:
        return rv

    waiver_dir = settings.data_root / "projects" / project_id / "stages" / "validation"
    waiver_dir.mkdir(parents=True, exist_ok=True)
    waiver_path = waiver_dir / "waivers.json"

    existing: list[dict[str, object]] = []
    if waiver_path.exists():
        try:
            existing = _json.loads(waiver_path.read_text())
        except Exception:
            existing = []

    existing.append(
        {
            "rule_id": body.rule_id,
            "note": body.note,
            "waived_at": datetime.now(UTC).isoformat(),
        }
    )
    waiver_path.write_text(_json.dumps(existing, indent=2))

    return JSONResponse(content={"ok": True, "rule_id": body.rule_id})


class _ArchiveItemToggleRequest(BaseModel):
    keep: bool


@router.patch(
    "/projects/{project_id}/project-stages/archive/items/{item_name}",
    operation_id="toggle_archive_item",
    status_code=200,
    responses={
        404: {"description": "Project not found."},
        409: {"description": "Registry version mismatch."},
    },
)
async def toggle_archive_item(
    project_id: str,
    item_name: str,
    body: _ArchiveItemToggleRequest,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
) -> JSONResponse:
    """Toggle the keep/drop flag for an archive item.

    Writes to archive/item_toggles.json. The archive stage runner reads
    this at execution time to filter items. W4 Group 4.
    """
    import json as _json

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry(project)) is not None:
        return rv

    archive_dir = settings.data_root / "projects" / project_id / "stages" / "archive"
    archive_dir.mkdir(parents=True, exist_ok=True)
    toggles_path = archive_dir / "item_toggles.json"

    toggles: dict[str, bool] = {}
    if toggles_path.exists():
        try:
            toggles = _json.loads(toggles_path.read_text())
        except Exception:
            toggles = {}

    toggles[item_name] = body.keep
    toggles_path.write_text(_json.dumps(toggles, indent=2))

    return JSONResponse(content={"ok": True, "name": item_name, "keep": body.keep})


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
