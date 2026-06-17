"""/api/data/projects/{id}/project-stages/page_order/runs — GET/PUT.

GET  returns the persisted NumberingRunsArtifact (empty if not yet written).
PUT  validates a NumberingRunsArtifact body, persists it via numbering_store,
     records a NumberingRunsChanged event in PrepProjectAggregate, and emits
     a project-stage-status SSE.

This replaces the W4 Group 2 stub that stored an opaque list[dict].  The
same on-disk path is reused
  <data_root>/projects/<id>/stages/page_order/runs.json
but the serialisation format is now the typed NumberingRunsArtifact schema.

Spec: docs/plans/2026-06-17-page-numbering-runs.md §P1.8
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from pdomain_prep_for_pgdp.api.dependencies import (
    DatabaseDep,
    SettingsDep,
    StageEventsDep,
    UserDep,
)
from pdomain_prep_for_pgdp.core.models import NumberingRunsArtifact
from pdomain_prep_for_pgdp.core.numbering_store import load_runs, save_runs
from pdomain_prep_for_pgdp.core.pipeline.registry_version import (
    RegistryVersionMismatchError,
    check_registry_version,
    migrate_if_needed,
)

log = logging.getLogger(__name__)

router = APIRouter(tags=["page-order-runs"])


def _registry_mismatch_response(exc: RegistryVersionMismatchError) -> JSONResponse:
    return JSONResponse(status_code=409, content=exc.as_dict())


@router.get(
    "/projects/{project_id}/project-stages/page_order/runs",
    operation_id="get_page_order_runs",
    status_code=200,
    responses={
        200: {"description": "NumberingRunsArtifact; empty runs list if not yet written."},
        404: {"description": "Project not found."},
        409: {"description": "Registry version mismatch."},
    },
)
async def get_page_order_runs(
    project_id: str,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
) -> JSONResponse:
    """Return the persisted NumberingRunsArtifact for the page_order stage.

    Returns an empty artifact (version=1, runs=[]) if the project exists but
    no runs have been PUT yet.  Returns 404 if the project is not found or
    belongs to a different user.
    """
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    project = await migrate_if_needed(project, db, settings.data_root)
    try:
        check_registry_version(project)
    except RegistryVersionMismatchError as exc:
        return _registry_mismatch_response(exc)

    artifact = load_runs(settings.data_root, project_id)
    return JSONResponse(content=artifact.model_dump(mode="json"))


@router.put(
    "/projects/{project_id}/project-stages/page_order/runs",
    operation_id="put_page_order_runs",
    status_code=200,
    responses={
        200: {"description": "Runs persisted; returns {stage_id, run_count}."},
        404: {"description": "Project not found."},
        409: {"description": "Registry version mismatch."},
        422: {"description": "Invalid NumberingRunsArtifact body."},
    },
)
async def put_page_order_runs(
    project_id: str,
    body: NumberingRunsArtifact,
    user: UserDep,
    db: DatabaseDep,
    settings: SettingsDep,
    stage_events: StageEventsDep,
) -> JSONResponse:
    """Persist the typed N-run folio schema for the page_order stage.

    Validates the body as a NumberingRunsArtifact, writes it atomically to
    ``<data_root>/projects/<id>/stages/page_order/runs.json``, and records
    a NumberingRunsChanged event in PrepProjectAggregate (warn-and-continue).
    Emits a project-stage-status SSE (settings-changed sub-type).

    P1.8 — replaces the W4 Group 2 stub (same URL, richer schema).
    """
    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    project = await migrate_if_needed(project, db, settings.data_root)
    try:
        check_registry_version(project)
    except RegistryVersionMismatchError as exc:
        return _registry_mismatch_response(exc)

    # Load the current runs for the before-value in the event.
    before_artifact = load_runs(settings.data_root, project_id)
    before_runs = [r.model_dump(mode="json") for r in before_artifact.runs]

    # Persist the new artifact atomically.
    save_runs(settings.data_root, project_id, body)

    after_runs = [r.model_dump(mode="json") for r in body.runs]

    # Record NumberingRunsChanged event in PrepProjectAggregate (warn-and-continue).
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
        _agg.record_numbering_runs_changed(
            before=before_runs,
            after=after_runs,
            actor_id=user.user_id,
        )
        _app.save(_agg)
        _app.close()
    except Exception as _e:
        log.warning("P1.8 NumberingRunsChanged event failed (non-fatal): %s", _e)

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
        log.warning("P1.8 SSE failed for page_order/runs (non-fatal): %s", _e_sse)

    return JSONResponse(content={"stage_id": "page_order", "run_count": len(body.runs)})
