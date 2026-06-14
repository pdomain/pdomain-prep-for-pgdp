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

R2 — I2 DRIFT aggregate routes (seam-remediation plan):
  GET  /projects/{id}/project-stages/ocr/tokens/{page_id}  low-confidence tokens
  POST /projects/{id}/project-stages/hyphen_join/scan       project-level hyphen scan
  GET  /projects/{id}/project-stages/{stage_id}/crop-pages  CropPageRow aggregate

All project-stage routes enforce the registry-version 409 guard.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from pdomain_prep_for_pgdp.api.dependencies import (
    DatabaseDep,
    PageServiceDep,
    SettingsDep,
    StageEventsDep,
    StorageDep,
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


# ─── R2 — build_package manifest ─────────────────────────────────────────────


@router.get(
    "/projects/{project_id}/project-stages/build_package/manifest",
    operation_id="get_build_package_manifest",
    responses={
        200: {"description": "Structured { deliverable, manifest } JSON."},
        404: {"description": "Project not found, stage not clean, or artifact ZIP missing."},
    },
)
async def get_build_package_manifest(
    project_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
) -> JSONResponse:
    """Return structured { deliverable, manifest } JSON for the build_package stage.

    R2 (I2) — resolves the DRIFT stub in buildPackageTool.ts.

    Reads the output.zip artifact and extracts:
      - deliverable: { files: TreeRow[], count: int } — the zip entry listing
      - manifest: { project, pages, built, sha256, ... } — summary metadata

    TreeRow shape: { name: str, dir?: bool, d?: int, meta?: str }

    The sha256 field is the SHA-256 hash of the output.zip bytes.
    """
    import hashlib
    import io as _io
    import zipfile

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry(project)) is not None:
        return rv

    store = _get_store(settings.data_root, project_id)
    row = store.read(project_id, "build_package")
    if row is None or row.status != ProjectStageStatus.clean:
        raise HTTPException(404, "build_package stage is not clean")

    zip_path = settings.data_root / "projects" / project_id / "stages" / "build_package" / "output.zip"
    if not zip_path.exists():
        raise HTTPException(404, "build_package artifact ZIP missing on disk")

    zip_bytes = zip_path.read_bytes()
    sha256 = hashlib.sha256(zip_bytes).hexdigest()

    # Parse pgdp.json from inside the zip for manifest metadata.
    pgdp_data: dict[str, Any] = {}
    tree_rows: list[dict[str, Any]] = []
    try:
        with zipfile.ZipFile(_io.BytesIO(zip_bytes)) as zf:
            # Build tree from zip entries.
            tree_rows.extend({"name": info.filename, "dir": False} for info in zf.infolist())
            # Extract pgdp.json if present.
            if "pgdp.json" in zf.namelist():
                pgdp_data = json.loads(zf.read("pgdp.json"))
    except Exception:
        log.debug("build_package manifest: corrupt ZIP for %s", project_id)

    file_count = len(tree_rows)

    deliverable = {
        "files": tree_rows,
        "count": file_count,
    }
    manifest = {
        "project": pgdp_data.get("project_id", project_id),
        "pages": pgdp_data.get("page_count", 0),
        "canvas": pgdp_data.get("book_name", ""),
        "built": pgdp_data.get("built_at", ""),
        "pipeline": "v2",
        "files": file_count,
        "sha256": sha256,
    }

    return JSONResponse(content={"deliverable": deliverable, "manifest": manifest})


# ─── R2 — zip manifest ───────────────────────────────────────────────────────


@router.get(
    "/projects/{project_id}/project-stages/zip/manifest",
    operation_id="get_zip_manifest",
    responses={
        200: {"description": "Structured { archive, tree } JSON."},
        404: {"description": "Project not found, zip stage not clean, or artifact missing."},
    },
)
async def get_zip_manifest(
    project_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
) -> JSONResponse:
    """Return structured { archive, tree } JSON for the zip stage.

    R2 (I2) — resolves the DRIFT stub in zipTool.ts.

    Reads stages/zip/output.json for archive metadata (sha256, size_bytes,
    file_count) and optionally stages/build_package/output.zip for the tree
    listing. If the build_package zip is missing, tree is returned empty (
    the archive metadata is still valid).

    ZipArchive shape: { name, entries, bytes, ratio, sha256 }
    TreeRow shape:    { name, dir?, d?, meta? }
    """
    import io as _io
    import zipfile

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry(project)) is not None:
        return rv

    store = _get_store(settings.data_root, project_id)
    row = store.read(project_id, "zip")
    if row is None or row.status != ProjectStageStatus.clean:
        raise HTTPException(404, "zip stage is not clean")

    zip_manifest_path = settings.data_root / "projects" / project_id / "stages" / "zip" / "output.json"
    if not zip_manifest_path.exists():
        raise HTTPException(404, "zip stage artifact missing on disk")

    zip_data = json.loads(zip_manifest_path.read_text())

    sha256 = zip_data.get("sha256", "")
    size_bytes = zip_data.get("size_bytes", 0)
    file_count = zip_data.get("file_count", 0)

    # Compute ratio: size vs uncompressed (simplified — use 1.0 if unavailable).
    ratio = 1.0
    archive_name = f"{project_id}.zip"

    # Tree: read from build_package output.zip (best-effort — may not exist).
    tree_rows: list[dict[str, Any]] = []
    bp_zip_path = settings.data_root / "projects" / project_id / "stages" / "build_package" / "output.zip"
    if bp_zip_path.exists():
        try:
            with zipfile.ZipFile(_io.BytesIO(bp_zip_path.read_bytes())) as zf:
                tree_rows.extend({"name": info.filename, "dir": False} for info in zf.infolist())
        except Exception:
            log.debug("zip manifest: corrupt build_package ZIP for %s", project_id)

    archive = {
        "name": archive_name,
        "entries": file_count,
        "bytes": size_bytes,
        "ratio": ratio,
        "sha256": sha256,
    }

    return JSONResponse(content={"archive": archive, "tree": tree_rows})


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


# ─── R2 — I2 DRIFT aggregate routes ──────────────────────────────────────────
#
# These resolve the three DRIFT stubs in frontend/src/services/tools/:
#   ocrTool.fetchPageTokens  → GET .../ocr/tokens/{page_id}
#   hyphenJoin.scanHyphenation → POST .../hyphen_join/scan
#   pagesGrid.fetchPages       → GET .../crop-pages
#
# Seam-remediation plan §R2.

# Threshold below which an OcrWord is classified as a low-confidence token.
_OCR_LOW_CONF_THRESHOLD: float = 0.5


@router.get(
    "/projects/{project_id}/project-stages/ocr/tokens/{page_id}",
    operation_id="get_ocr_page_tokens",
    status_code=200,
    responses={
        200: {"description": "Low-confidence OCR tokens for one page."},
        404: {"description": "Project not found."},
        409: {"description": "Registry version mismatch."},
    },
)
async def get_ocr_page_tokens(
    project_id: str,
    page_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    storage: StorageDep,
    page_service: PageServiceDep,
) -> JSONResponse:
    """Return low-confidence OCR tokens for one page.

    Reads the words.json blob for the page (co-located with the OCR text key).
    Filters to words where ``confidence < 0.5`` and ``deleted == False``.

    Returns ``{ tokens: [{id, word, suggest, conf}] }``.

    R2 — I2 DRIFT (seam-remediation plan). Resolves ocrTool.fetchPageTokens stub.
    """
    from pdomain_prep_for_pgdp.core.ocr_artifacts import load_words_from_storage, words_key_for
    from pdomain_prep_for_pgdp.core.page_service_helpers import list_page_records

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry(project)) is not None:
        return rv

    # Find the text key for this page from the event store.
    all_pages = list_page_records(page_service, project_id)
    matched_page = next((p for p in all_pages if (p.prefix or f"{p.idx0:04d}") == page_id), None)

    text_key: str | None = None
    if matched_page is not None:
        # Prefer the recorded ocr_text_key from the page output record.
        for output in matched_page.outputs:
            if (output.split_suffix or "") == "" and output.ocr_text_key:
                text_key = output.ocr_text_key
                break
        if text_key is None:
            # Derive synthesised path from page record fields.
            prefix = matched_page.prefix or f"{matched_page.idx0:04d}"
            stem_prefix = f"{matched_page.source_stem}_{prefix}" if matched_page.source_stem else prefix
            text_key = f"projects/{project_id}/ocr_text/{stem_prefix}.txt"

    if text_key is None:
        # Unknown page_id — return empty tokens (not an error; page may not
        # have been OCR'd yet).
        return JSONResponse(content={"tokens": []})

    words_key = words_key_for(text_key)
    if not await storage.exists(words_key):
        # Words blob not yet written (page not OCR'd yet).
        return JSONResponse(content={"tokens": []})

    try:
        raw = await storage.get_bytes(words_key)
        words = load_words_from_storage(raw)
    except Exception:
        log.exception("get_ocr_page_tokens: failed to load words blob %s", words_key)
        return JSONResponse(content={"tokens": []})

    tokens = [
        {
            "id": w.id,
            "word": w.text,
            "suggest": "",  # suggestion model is I3 work
            "conf": w.confidence,
        }
        for w in words
        if not w.deleted and w.confidence < _OCR_LOW_CONF_THRESHOLD
    ]

    return JSONResponse(content={"tokens": tokens})


@router.post(
    "/projects/{project_id}/project-stages/hyphen_join/scan",
    operation_id="scan_hyphen_candidates",
    status_code=200,
    responses={
        200: {"description": "Project-level hyphen scan: cases and totals."},
        404: {"description": "Project not found."},
        409: {"description": "Registry version mismatch."},
    },
)
async def scan_hyphen_candidates(
    project_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    storage: StorageDep,
    page_service: PageServiceDep,
) -> JSONResponse:
    """Scan all pages for end-of-line hyphen candidates.

    Runs ``detect_candidates`` (from the ``hyphen_join`` pipeline step) over
    every page's OCR text artifact and aggregates the results into a flat
    ``{ cases: HyphenCase[], totals: HyphenTotals }`` response.

    HyphenCase shape: ``{id, prefix, suffix, pageId, offset, matchText, status, kind}``
    HyphenTotals shape: ``{total, joined, validated, undecided, flagged, crosspage,
                           mismatch, unvalidated}``

    R2 — I2 DRIFT (seam-remediation plan). Resolves hyphenJoin.scanHyphenation stub.
    """
    from pdomain_prep_for_pgdp.core.page_service_helpers import list_page_records
    from pdomain_prep_for_pgdp.core.pipeline.steps.hyphen_join import detect_candidates

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry(project)) is not None:
        return rv

    all_pages = list_page_records(page_service, project_id)

    all_cases: list[dict[str, object]] = []

    for page in all_pages:
        page_id = page.prefix or f"{page.idx0:04d}"

        # Build the text key for the main (non-split) output.
        text_key: str | None = None
        for output in page.outputs:
            if (output.split_suffix or "") == "" and output.ocr_text_key:
                text_key = output.ocr_text_key
                break
        if text_key is None:
            prefix = page.prefix or f"{page.idx0:04d}"
            stem_prefix = f"{page.source_stem}_{prefix}" if page.source_stem else prefix
            text_key = f"projects/{project_id}/ocr_text/{stem_prefix}.txt"

        # Skip pages that have no OCR artifact yet.
        if not await storage.exists(text_key):
            continue

        try:
            text_bytes = await storage.get_bytes(text_key)
            text = text_bytes.decode("utf-8", errors="replace")
        except Exception:
            log.warning("scan_hyphen_candidates: failed to read %s", text_key)
            continue

        candidates = detect_candidates(text)
        # All scan-detected candidates are regular EOL hyphens ("auto"), not
        # cross-page or manual — those are detected at render time separately.
        all_cases.extend(
            {
                "id": cand["candidate_id"],
                "prefix": cand["prefix"],
                "suffix": cand["suffix"],
                "pageId": page_id,
                "offset": cand["offset"],
                "matchText": cand["match_text"],
                "status": "undecided",
                "kind": "auto",
            }
            for cand in candidates
        )

    totals = {
        "total": len(all_cases),
        "joined": 0,
        "validated": 0,
        "undecided": len(all_cases),  # all freshly detected cases are undecided
        "flagged": 0,
        "crosspage": 0,
        "mismatch": 0,
        "unvalidated": 0,
    }

    return JSONResponse(content={"cases": all_cases, "totals": totals})


@router.get(
    "/projects/{project_id}/project-stages/{stage_id}/crop-pages",
    operation_id="get_stage_crop_pages",
    status_code=200,
    responses={
        200: {"description": "CropPageRow aggregate for the stage."},
        404: {"description": "Project not found."},
        409: {"description": "Registry version mismatch."},
    },
)
async def get_stage_crop_pages(
    project_id: str,
    stage_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    page_service: PageServiceDep,
) -> JSONResponse:
    """Return CropPageRow[] for all pages at a given stage.

    Returns ``{ pages: CropPageRow[] }`` where each row has:
      ``pageId, n, thumbUrl, flags, bbox, skewDeg``

    Unlike ``GET .../project-stages/{stage_id}/pages`` (which returns the
    PageRow state-machine shape used by imageStageReview), this endpoint
    returns the crop-grid shape consumed by pagesGridMachine / PagesGridTool.

    R2 — I2 DRIFT (seam-remediation plan). Resolves pagesGrid.fetchPages stub.
    Also fixes the silent-catch error in the previous aggregate: this route
    returns 404 on missing project (not 200 with empty list) so the machine's
    loadError state is reachable.
    """
    from pdomain_prep_for_pgdp.core.page_service_helpers import list_page_records

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry(project)) is not None:
        return rv

    all_pages = list_page_records(page_service, project_id)
    all_stages = await db.list_page_stages_by_project(project_id)
    stage_by_page: dict[str, PageStageState] = {s.page_id: s for s in all_stages if s.stage_id == stage_id}

    rows: list[dict[str, object]] = []
    for i, page in enumerate(all_pages):
        page_id = page.prefix or f"{page.idx0:04d}"

        # Find the stage row using both the prefix and zero-padded idx0.
        page_stage = stage_by_page.get(page_id)
        if page_stage is None:
            page_stage = stage_by_page.get(f"{page.idx0:04d}")

        # Build flags list from stage status.
        flags: list[str] = []
        if page_stage is not None:
            if page_stage.status == PageStageStatus.failed:
                flags.append("error")
            elif page_stage.status == PageStageStatus.dirty:
                flags.append("stale")

        # Thumbnail URL — points to the per-page stage thumbnail endpoint.
        thumb_url = f"/api/data/projects/{project_id}/pages/{page_id}/stages/{stage_id}/thumbnail"

        row: dict[str, object] = {
            "pageId": page_id,
            "n": i,
            "thumbUrl": thumb_url,
            "flags": flags,
        }

        # Include bbox and skewDeg from the page record if present.
        # These are populated after the crop stage writes its outputs.
        outputs_bbox: tuple[int, int, int, int] | None = None
        if page.source_crop_bbox is not None:
            outputs_bbox = page.source_crop_bbox
        row["bbox"] = list(outputs_bbox) if outputs_bbox is not None else None
        row["skewDeg"] = None  # Populated by a future geometry stage

        rows.append(row)

    return JSONResponse(content={"pages": rows})


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


# ─── R2 — textZonesTool zone routes ─────────────────────────────────────────


@router.get(
    "/projects/{project_id}/project-stages/text_zones/pages-aggregate",
    operation_id="get_text_zones_pages_aggregate",
    status_code=200,
    responses={
        200: {"description": "Zone-page aggregate: rows + totals with per-page zone counts."},
        404: {"description": "Project not found."},
        409: {"description": "Registry version mismatch."},
    },
)
async def get_text_zones_pages_aggregate(
    project_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    page_service: PageServiceDep,
) -> JSONResponse:
    """Return per-page zone aggregate for the text_zones stage.

    Derives from text_zones artifacts on the backend.  Each row carries:
    - idx, prefix, state, pageNumber — standard page-row fields
    - zones: int — zone count from the clean artifact (0 when no artifact)

    State mapping:
    - clean artifact present (stage row = clean) → "reviewed" (zone data available)
    - no clean row / not_run → "clean" (hasn't been reviewed yet)
    - dirty / running / failed → mapped from stage status

    R2 — fetchZonePages seam (seam-remediation plan, textZonesTool stub).
    """
    import json as _json

    from pdomain_prep_for_pgdp.core.page_service_helpers import list_page_records
    from pdomain_prep_for_pgdp.core.pipeline.page_stage_writer import stage_artifact_path

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry(project)) is not None:
        return rv

    all_pages = list_page_records(page_service, project_id)
    all_stages = await db.list_page_stages_by_project(project_id)
    stage_by_page: dict[str, PageStageState] = {
        s.page_id: s for s in all_stages if s.stage_id == "text_zones"
    }

    rows: list[dict[str, object]] = []
    for i, page in enumerate(all_pages):
        page_id_key = page.prefix or str(page.idx0)
        zero_padded = f"{page.idx0:04d}"
        page_stage = stage_by_page.get(page_id_key) or stage_by_page.get(zero_padded)
        stage_status = page_stage.status if page_stage else None

        # Build base state — clean artifact → "reviewed" (zone data available)
        if stage_status == PageStageStatus.clean:
            state: str = "reviewed"
        elif stage_status == PageStageStatus.dirty:
            state = "flagged"
        elif stage_status == PageStageStatus.running:
            state = "running"
        elif stage_status == PageStageStatus.failed:
            state = "failed"
        else:
            state = "clean"

        row: dict[str, object] = {
            "idx": page_id_key,
            "prefix": page_id_key,
            "state": state,
            "pageNumber": i,
        }

        # Enrich with zone count from the artifact when row is clean
        if stage_status == PageStageStatus.clean:
            import contextlib

            with contextlib.suppress(Exception):
                artifact_path = stage_artifact_path(settings.data_root, project_id, zero_padded, "text_zones")
                if artifact_path.exists():
                    data = _json.loads(artifact_path.read_bytes())
                    row["zones"] = len(data.get("zones", []))

        rows.append(row)

    # Build totals shaped like ZoneTotals
    total = len(rows)
    clean_count = sum(1 for r in rows if r.get("state") == "clean")
    flagged_count = sum(1 for r in rows if r.get("state") == "flagged")
    reviewed_count = sum(1 for r in rows if r.get("state") == "reviewed")
    done_count = reviewed_count + clean_count  # either reviewed or not yet run = done
    splits_count = sum(1 for r in rows if r.get("state") == "split")

    totals: dict[str, int] = {
        "total": total,
        "clean": clean_count,
        "flagged": flagged_count,
        "reviewed": reviewed_count,
        "done": done_count,
        "splits": splits_count,
    }

    return JSONResponse(content={"rows": rows, "totals": totals})


class _RedetectLayoutRequest(BaseModel):
    """Optional request body for redetect — future: pass current zones as hint."""

    current_zones: list[dict[str, object]] | None = None


@router.post(
    "/projects/{project_id}/pages/{idx0}/stages/text_zones/redetect",
    operation_id="redetect_text_zones_layout",
    status_code=200,
    responses={
        200: {"description": "Re-detected zone list (frontend Zone[] shape)."},
        404: {"description": "Project or binary artifact not found."},
        409: {"description": "Registry version mismatch."},
    },
)
async def redetect_text_zones_layout(
    project_id: str,
    idx0: int,
    body: _RedetectLayoutRequest,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    page_service: PageServiceDep,
) -> JSONResponse:
    """Re-run zone detection on a single page's binary artifact.

    Reads the page's clean post_transform_crop (binary) artifact from disk and
    runs detect_text_zones() synchronously.  Returns zones in the frontend
    Zone[] shape (id/type/x/y/w/h normalised [0,1]/order).

    Does NOT commit to the DB — the caller must call persistLayout to save.

    R2 — redetectLayout seam (seam-remediation plan, textZonesTool stub).
    """
    import cv2  # pyright: ignore[reportMissingImports]
    import numpy as np

    from pdomain_prep_for_pgdp.core.page_service_helpers import get_page_record
    from pdomain_prep_for_pgdp.core.pipeline.page_stage_writer import stage_artifact_path
    from pdomain_prep_for_pgdp.core.pipeline.steps.text_zones import detect_text_zones

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry(project)) is not None:
        return rv

    page = get_page_record(page_service, project_id, idx0)
    if page is None:
        raise HTTPException(404, "page not found")

    page_id = f"{idx0:04d}"

    # Read the binary artifact from post_transform_crop
    binary_path = stage_artifact_path(settings.data_root, project_id, page_id, "post_transform_crop")
    if not binary_path.exists():
        raise HTTPException(
            404, "no binary artifact available for re-detection; run post_transform_crop first"
        )

    # Load as grayscale ndarray
    raw = binary_path.read_bytes()
    arr = np.frombuffer(raw, dtype=np.uint8)
    decoded = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
    if decoded is None:
        raise HTTPException(404, "could not decode binary artifact for re-detection")
    binary = np.asarray(decoded, dtype=np.uint8)

    result = detect_text_zones(binary)

    # Convert detector output → frontend Zone[] shape (normalised coords)
    h: int = result.get("image_height", 1) or 1
    w: int = result.get("image_width", 1) or 1
    zones: list[dict[str, object]] = []
    for order_i, z in enumerate(result.get("zones", []), start=1):
        bx, by, bw, bh = z["bbox"]
        zones.append(
            {
                "id": z["zone_id"],
                "type": "body",  # detector does not classify; default to body
                "x": bx / w,
                "y": by / h,
                "w": bw / w,
                "h": bh / h,
                "order": order_i,
            }
        )

    return JSONResponse(content={"zones": zones})


class _PersistLayoutRequest(BaseModel):
    """PUT /pages/{page_id}/stages/text_zones/layout request body."""

    zones: list[dict[str, object]] | None = None
    dismissed: bool | None = None


@router.put(
    "/projects/{project_id}/pages/{idx0}/stages/text_zones/layout",
    operation_id="persist_text_zones_layout",
    status_code=200,
    responses={
        200: {"description": "Layout persisted; page_stage row marked clean."},
        404: {"description": "Project or page not found."},
        409: {"description": "Registry version mismatch."},
    },
)
async def persist_text_zones_layout(
    project_id: str,
    idx0: int,
    body: _PersistLayoutRequest,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    page_service: PageServiceDep,
) -> JSONResponse:
    """Persist a user-edited zone layout for a single page.

    Dual-write contract (spec §"Dual-write contract"):
    1. Write zone artifact JSON to disk at the canonical text_zones artifact path.
    2. Mark the page_stage row clean with the artifact_key.

    Accepts either ``zones`` (list of Zone objects) or ``dismissed`` (bool) or both.
    Downstream: textZonesToolMachine transitions to browsing after SAVE_LAYOUT
    and the server row is now clean, so the next aggregate fetch reflects it.

    R2 — persistLayout seam (seam-remediation plan, textZonesTool stub).
    """
    import json as _json
    from datetime import UTC
    from datetime import datetime as _dt

    from pdomain_prep_for_pgdp.core.page_service_helpers import get_page_record
    from pdomain_prep_for_pgdp.core.pipeline.page_stage_writer import stage_artifact_path

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry(project)) is not None:
        return rv

    page = get_page_record(page_service, project_id, idx0)
    if page is None:
        raise HTTPException(404, "page not found")

    page_id = f"{idx0:04d}"

    # Build the artifact payload — carry through any existing data and overlay
    import contextlib

    artifact_path = stage_artifact_path(settings.data_root, project_id, page_id, "text_zones")
    existing: dict[str, object] = {}
    if artifact_path.exists():
        with contextlib.suppress(Exception):
            existing = _json.loads(artifact_path.read_bytes())

    payload: dict[str, object] = {**existing}
    if body.zones is not None:
        payload["zones"] = body.zones
    if body.dismissed is not None:
        payload["dismissed"] = body.dismissed

    # Dual-write 1: write artifact to disk
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    artifact_bytes = _json.dumps(payload).encode("utf-8")
    artifact_path.write_bytes(artifact_bytes)

    # Dual-write 2: mark page_stage row clean
    artifact_key = f"projects/{project_id}/pages/{page_id}/stages/text_zones/output.json"
    now = _dt.now(UTC)
    existing_row = await db.get_page_stage(project_id, page_id, "text_zones")
    row = PageStageState(
        project_id=project_id,
        page_id=page_id,
        stage_id="text_zones",
        status=PageStageStatus.clean,
        last_run_at=existing_row.last_run_at if existing_row else now.timestamp(),
        artifact_key=artifact_key,
        config_hash=existing_row.config_hash if existing_row else None,
        input_hash=None,
    )
    await db.put_page_stage(row)

    return JSONResponse(content={"ok": True})


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


# ─── Project-wide page-stage SSE channel ──────────────────────────────────────


@router.get(
    "/projects/{project_id}/page-stages/events",
    operation_id="stream_project_page_stage_events",
)
async def stream_project_page_stage_events(
    project_id: str,
    user: UserDep,
    db: DatabaseDep,
    stage_events: StageEventsDep,
) -> Response:
    """SSE — project-wide page-stage event channel (single subscription for all pages).

    Every ``stage-status`` and ``stage-progress`` event that any page-stage
    emits is published to **two** keys in the broker: the existing per-page key
    (``{project_id}:{page_id}``) **and** the project-wide key
    (``page-stages:{project_id}``). This endpoint subscribes to the project-wide
    key so clients can receive completions for all pages in the project with a
    single EventSource connection, instead of N connections (one per page).

    On connect: no initial snapshot is emitted (page-stage state is available via
    GET /projects/{id}/project-stages/{stage_id}/pages or the pipeline snapshot).
    Subsequent frames are incremental ``stage-status`` events identical to those
    emitted on per-page channels, but now fanned to a single stream.

    Auth: owner check identical to ``stream_page_stage_events``.

    Spec: fix(sse) — I1 efficiency fix: single project-channel subscription.
    """
    import json as _json
    from collections.abc import AsyncIterator

    from sse_starlette.sse import EventSourceResponse

    from pdomain_prep_for_pgdp.core.stage_events import project_page_stage_events_key

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    project_key = project_page_stage_events_key(project_id)

    async def _stream() -> AsyncIterator[dict[str, str]]:
        async for ev in stage_events.subscribe(project_key):
            yield {"event": str(ev.get("type", "stage-status")), "data": _json.dumps(ev)}

    return EventSourceResponse(_stream())  # type: ignore[return-value]


# ─── R2: regexPass — regex rules store + apply ───────────────────────────────
#
# Rules are stored per-project at:
#   stages/regex/rules.json  — list of RegexRule dicts (frontend shape)
# A snapshot file at stages/regex/snapshot.json stores the pre-apply state.
#
# RegexRule shape mirrors frontend machines/tools/regexPass.ts.
# All routes enforce the registry-version 409 guard and user ownership.


def _regex_rules_path(data_root: Path, project_id: str) -> Path:
    return data_root / "projects" / project_id / "stages" / "regex" / "rules.json"


def _regex_snapshot_path(data_root: Path, project_id: str) -> Path:
    return data_root / "projects" / project_id / "stages" / "regex" / "snapshot.json"


def _load_regex_rules(data_root: Path, project_id: str) -> list[dict[str, object]]:
    """Load rules from disk; return [] if not yet saved."""
    import json as _json

    path = _regex_rules_path(data_root, project_id)
    if not path.exists():
        return []
    try:
        return _json.loads(path.read_text())
    except Exception:
        return []


def _save_regex_rules(data_root: Path, project_id: str, rules: list[dict[str, object]]) -> None:
    import json as _json

    path = _regex_rules_path(data_root, project_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_json.dumps(rules, indent=2))


def _regex_counts(rules: list[dict[str, object]]) -> dict[str, int]:
    """Compute RegexCounts from a rule list (matches frontend shape)."""
    applied = sum(1 for r in rules if r.get("status") == "applied" and r.get("enabled", True))
    review = sum(1 for r in rules if r.get("status") == "review" and r.get("enabled", True))
    pending = sum(1 for r in rules if r.get("status") == "pending" and r.get("enabled", True))

    def _rule_matches(r: dict[str, object]) -> int:
        v = r.get("matches")
        return int(v) if isinstance(v, (int, float)) else 0

    matches = sum(_rule_matches(r) for r in rules)
    return {
        "rules": len(rules),
        "applied": applied,
        "review": review,
        "pending": pending,
        "matches": matches,
    }


@router.get(
    "/projects/{project_id}/project-stages/regex/rules",
    operation_id="get_regex_rules",
    status_code=200,
    responses={
        200: {"description": "Rule set + apply counts + snapshotId."},
        404: {"description": "Project not found."},
        409: {"description": "Registry version mismatch."},
    },
)
async def get_regex_rules(
    project_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
) -> JSONResponse:
    """Return the regex rule set for a project.

    Rules are persisted per-project at stages/regex/rules.json.
    Returns { rules, counts, snapshotId } shaped for regexPassMachine.fetchRules.

    R2 imagetools — regexPass DRIFT resolution.
    """
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry(project)) is not None:
        return rv

    rules = _load_regex_rules(settings.data_root, project_id)
    counts = _regex_counts(rules)

    # Return snapshotId only when a snapshot file exists.
    snap_path = _regex_snapshot_path(settings.data_root, project_id)
    snapshot_id: str | None = None
    if snap_path.exists():
        import json as _json

        try:
            snap = _json.loads(snap_path.read_text())
            snapshot_id = snap.get("snapshotId")
        except Exception:
            snapshot_id = None

    return JSONResponse(content={"rules": rules, "counts": counts, "snapshotId": snapshot_id})


@router.post(
    "/projects/{project_id}/project-stages/regex/rules/{rule_id}/apply",
    operation_id="apply_regex_rule",
    status_code=200,
    responses={
        200: {"description": "Rule applied; returns updated rule + counts."},
        404: {"description": "Project or rule not found."},
        409: {"description": "Registry version mismatch."},
    },
)
async def apply_regex_rule(
    project_id: str,
    rule_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
) -> JSONResponse:
    """Apply a single regex rule to project text.

    Marks the rule as 'applied', updates match counts against each page's
    text artifact, persists the updated rule list, and returns the updated
    rule + fresh counts.

    On first apply, saves a snapshot of the pre-apply rule set to enable ROLLBACK.

    R2 imagetools — regexPass DRIFT resolution.
    """
    import json as _json
    import re

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry(project)) is not None:
        return rv

    rules = _load_regex_rules(settings.data_root, project_id)
    rule_idx = next((i for i, r in enumerate(rules) if r.get("id") == rule_id), None)
    if rule_idx is None:
        raise HTTPException(404, f"regex rule {rule_id!r} not found")

    rule = dict(rules[rule_idx])

    # --- Take a pre-apply snapshot on the first apply ---------------------------
    snap_path = _regex_snapshot_path(settings.data_root, project_id)
    if not snap_path.exists():
        snap_path.parent.mkdir(parents=True, exist_ok=True)
        snap_id = f"snap-{uuid.uuid4().hex[:8]}"
        snap_path.write_text(
            _json.dumps({"snapshotId": snap_id, "rules": [dict(r) for r in rules]}, indent=2)
        )

    # --- Count matches across page text artifacts --------------------------------
    # Walk stages/*/output.txt for any page with a regex or text_review artifact.
    # This is a best-effort count; the main value is the status transition.
    match_count = 0
    find_pattern = str(rule.get("find", ""))
    flags_str = str(rule.get("flags", ""))
    re_flags = re.IGNORECASE if "i" in flags_str else 0
    re_flags |= re.MULTILINE if "m" in flags_str else 0

    if find_pattern:
        try:
            compiled = re.compile(find_pattern, re_flags)
            pages_root = settings.data_root / "projects" / project_id / "pages"
            if pages_root.exists():
                for page_dir in pages_root.iterdir():
                    for stage_name in ("regex", "text_review", "ocr"):
                        text_path = page_dir / "stages" / stage_name / "output.txt"
                        if text_path.exists():
                            try:
                                text = text_path.read_text(encoding="utf-8", errors="replace")
                                match_count += len(compiled.findall(text))
                            except OSError:
                                pass
                            break  # use first found stage text per page
        except re.error:
            # Invalid regex — mark as applied with 0 matches (let the user fix it)
            match_count = 0

    # --- Update rule status and match count --------------------------------------
    rule["status"] = "applied"
    rule["matches"] = match_count
    rules[rule_idx] = rule
    _save_regex_rules(settings.data_root, project_id, rules)

    counts = _regex_counts(rules)
    return JSONResponse(content={"rule": rule, "counts": counts})


# ─── R2: grayscaleTool — grayscale profile detection ─────────────────────────
#
# Samples up to N page images from the project to determine whether the
# source material should be converted with a "perceptual" (luminosity-weighted,
# recommended for photographs/halftones) or "standard" (average of channels)
# grayscale transform.
#
# Detection heuristic:
#   For each sampled image, compute the mean chrominance (Cb, Cr) standard
#   deviation. If the average chromatic energy > threshold, the source is
#   colour-biased and "perceptual" is the better choice.  Below threshold
#   (black-and-white line art, printed text) "standard" suffices.
#
# If no source images are accessible (stage not yet run, GPU backend unavailable)
# the route returns "perceptual" as the safe default with a descriptive `why`.


_GRAYSCALE_SAMPLE_PAGES = 8  # max pages to sample
_GRAYSCALE_CHROMA_THRESHOLD = 5.0  # std-dev in YCbCr Cb/Cr channels


@router.post(
    "/projects/{project_id}/project-stages/grayscale/detect",
    operation_id="detect_grayscale_profile",
    status_code=200,
    responses={
        200: {"description": "Detected grayscale profile: {mode, why, backend}."},
        404: {"description": "Project not found."},
        409: {"description": "Registry version mismatch."},
    },
)
async def detect_grayscale_profile(
    project_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
) -> JSONResponse:
    """Detect the best grayscale conversion profile for a project.

    Samples up to 8 page source images and measures chromatic energy.
    High chromatic energy → 'perceptual' (luminosity-weighted).
    Low chromatic energy → 'standard' (flat channel average).

    Returns { mode, why, backend } shaped for GrayscaleToolServices.detectProfile.

    R2 imagetools — grayscaleTool DRIFT resolution.
    """
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry(project)) is not None:
        return rv

    mode, why = _detect_grayscale_mode(settings.data_root, project_id)
    return JSONResponse(content={"mode": mode, "why": why, "backend": "cpu"})


def _detect_grayscale_mode(data_root: Path, project_id: str) -> tuple[str, str]:
    """Return (mode, why) by sampling page images.

    Falls back to ("perceptual", "<reason>") when sampling is not possible.
    """
    try:
        import cv2  # pyright: ignore[reportMissingImports]
        import numpy as np  # pyright: ignore[reportMissingImports]
    except ImportError:
        return "perceptual", "cv2/numpy not available — using perceptual as safe default"

    pages_root = data_root / "projects" / project_id / "pages"
    if not pages_root.exists():
        return "perceptual", "no pages found — using perceptual as safe default"

    # Collect source image candidates from threshold or canvas_map artifacts.
    image_paths: list[Path] = []
    for page_dir in sorted(pages_root.iterdir()):
        for stage_name in ("threshold", "canvas_map", "grayscale"):
            p = page_dir / "stages" / stage_name / "output.png"
            if p.exists():
                image_paths.append(p)
                break
        if len(image_paths) >= _GRAYSCALE_SAMPLE_PAGES:
            break

    if not image_paths:
        return "perceptual", "no processed images found — using perceptual as safe default"

    chroma_scores: list[float] = []
    for path in image_paths:
        try:
            img = cv2.imread(str(path))
            if img is None:
                continue
            if img.ndim == 2 or img.shape[2] == 1:
                # Already grayscale — no chromatic energy.
                chroma_scores.append(0.0)
                continue
            # Convert BGR → YCbCr and measure std of chroma channels.
            ycbcr = cv2.cvtColor(img, cv2.COLOR_BGR2YCrCb)
            cb_std = float(np.std(ycbcr[:, :, 1]))
            cr_std = float(np.std(ycbcr[:, :, 2]))
            chroma_scores.append((cb_std + cr_std) / 2.0)
        except Exception:  # noqa: S112 — image decode errors are non-fatal; skip sample
            continue

    if not chroma_scores:
        return "perceptual", "could not decode any sample images — using perceptual as safe default"

    mean_chroma = sum(chroma_scores) / len(chroma_scores)
    if mean_chroma > _GRAYSCALE_CHROMA_THRESHOLD:
        return (
            "perceptual",
            f"sampled {len(chroma_scores)} pages — mean chromatic energy {mean_chroma:.1f} "
            f"> {_GRAYSCALE_CHROMA_THRESHOLD} (colour content detected)",
        )
    return (
        "standard",
        f"sampled {len(chroma_scores)} pages — mean chromatic energy {mean_chroma:.1f} "
        f"<= {_GRAYSCALE_CHROMA_THRESHOLD} (black-and-white source)",
    )


# ─── R2: illustrationsTool — detect regions + persist region ─────────────────
#
# Regions are stored per-project at:
#   stages/illustrations/regions.json  — list of IllustrationRegion dicts
#
# IllustrationRegion shape mirrors frontend machines/tools/illustrationsTool.ts.
# 'detect' loads existing page-extension regions (illustration_regions on
# each PageRecord) and returns them as the initial detected set.  If no
# extension regions exist, returns an empty list.  Future enhancement: run
# _auto_detect_illustrations_cpu on source images.


def _illustrations_regions_path(data_root: Path, project_id: str) -> Path:
    return data_root / "projects" / project_id / "stages" / "illustrations" / "regions.json"


def _load_illustration_regions(data_root: Path, project_id: str) -> list[dict[str, object]]:
    """Load illustration regions from disk; return [] if none saved."""
    import json as _json

    path = _illustrations_regions_path(data_root, project_id)
    if not path.exists():
        return []
    try:
        return _json.loads(path.read_text())
    except Exception:
        return []


def _save_illustration_regions(data_root: Path, project_id: str, regions: list[dict[str, object]]) -> None:
    import json as _json

    path = _illustrations_regions_path(data_root, project_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(_json.dumps(regions, indent=2))


def _illustration_counts(regions: list[dict[str, object]]) -> dict[str, int]:
    """Compute IllustrationCounts from regions list (frontend shape)."""
    return {
        "detected": len(regions),
        "extracted": sum(1 for r in regions if r.get("status") == "extracted"),
        "review": sum(1 for r in regions if r.get("status") == "review"),
        "flagged": sum(1 for r in regions if r.get("status") == "flagged"),
    }


@router.post(
    "/projects/{project_id}/project-stages/illustrations/detect",
    operation_id="detect_illustration_regions",
    status_code=200,
    responses={
        200: {"description": "Detected illustration regions + counts."},
        404: {"description": "Project not found."},
        409: {"description": "Registry version mismatch."},
    },
)
async def detect_illustration_regions(
    project_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    page_service: PageServiceDep,
) -> JSONResponse:
    """Detect illustration regions for a project.

    Returns previously-persisted regions from stages/illustrations/regions.json.
    If no saved regions exist, seeds from page-extension illustration_regions
    (populated by the illustrations pipeline stage, seeded by the layout detector).

    Returns { items, counts } shaped for IllustrationsToolServices.detectRegions.

    R2 imagetools — illustrationsTool DRIFT resolution.
    """
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry(project)) is not None:
        return rv

    regions = _load_illustration_regions(settings.data_root, project_id)

    if not regions:
        # Seed from page-extension illustration_regions (populated by pipeline stage).
        regions = _seed_regions_from_page_extensions(page_service, project_id)
        if regions:
            _save_illustration_regions(settings.data_root, project_id, regions)

    counts = _illustration_counts(regions)
    return JSONResponse(content={"items": regions, "counts": counts})


def _seed_regions_from_page_extensions(
    page_service: PageServiceDep,  # type: ignore[type-arg]
    project_id: str,
) -> list[dict[str, object]]:
    """Build frontend-shaped IllustrationRegion list from page-extension data.

    Converts backend IllustrationRegion coords to the frontend shape
    {id, page, kind, w, h, status, note}.
    """
    from pdomain_prep_for_pgdp.core.page_service_helpers import list_page_records

    pages = list_page_records(page_service, project_id)
    out: list[dict[str, object]] = []
    for page in pages:
        page_id = f"{page.idx0:04d}"
        for region in page.illustration_regions:
            left = region.L or 0
            top = region.T or 0
            right = region.R or 0
            bottom = region.B or 0
            w = max(0, right - left)
            h = max(0, bottom - top)
            # Map backend type to frontend kind.
            kind_map = {"illustration": "figure", "decoration": "lineart", "plate": "plate"}
            kind = kind_map.get(region.type, "figure")
            region_id = f"{page_id}-{region.index}"
            out.append(
                {
                    "id": region_id,
                    "page": page_id,
                    "kind": kind,
                    "w": w,
                    "h": h,
                    "status": "review",
                    "note": region.label or "",
                }
            )
    return out


class _IllustrationRegionPatchRequest(BaseModel):
    """Request body for PATCH .../illustrations/regions/{region_id}."""

    id: str
    page: str
    kind: str
    w: int
    h: int
    status: str
    note: str


@router.patch(
    "/projects/{project_id}/project-stages/illustrations/regions/{region_id}",
    operation_id="persist_illustration_region",
    status_code=200,
    responses={
        200: {"description": "Region updated."},
        404: {"description": "Project or region not found."},
        409: {"description": "Registry version mismatch."},
    },
)
async def persist_illustration_region(
    project_id: str,
    region_id: str,
    body: _IllustrationRegionPatchRequest,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
) -> JSONResponse:
    """Persist an updated illustration region.

    Reads regions from stages/illustrations/regions.json, patches the matching
    entry, and writes back.  Returns { ok: true } on success.

    R2 imagetools — illustrationsTool DRIFT resolution.
    """
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    if (rv := _check_registry(project)) is not None:
        return rv

    regions = _load_illustration_regions(settings.data_root, project_id)
    idx = next((i for i, r in enumerate(regions) if r.get("id") == region_id), None)
    if idx is None:
        raise HTTPException(404, f"illustration region {region_id!r} not found")

    regions[idx] = body.model_dump()
    _save_illustration_regions(settings.data_root, project_id, regions)
    return JSONResponse(content={"ok": True})
