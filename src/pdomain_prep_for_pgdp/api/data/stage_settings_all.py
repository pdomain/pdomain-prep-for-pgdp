"""App-wide (all-tier) stage settings routes.

GET  /settings/stages/{stage_id}       — get app-wide defaults for a stage
PUT  /settings/stages/{stage_id}       — set app-wide defaults for a stage
DELETE /settings/stages/{stage_id}     — clear app-wide defaults for a stage
GET  /settings/stages                  — get all app-wide defaults (all stages)
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from pdomain_prep_for_pgdp.api.dependencies import SettingsDep, UserDep
from pdomain_prep_for_pgdp.core.models import V2_PAGE_STAGE_IDS, V2_PROJECT_STAGE_IDS

if TYPE_CHECKING:
    pass

log = logging.getLogger(__name__)

router = APIRouter(tags=["stage_settings_all"])


def _app_wide(settings_dep):  # type: ignore[no-untyped-def]
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import AppWideStageSettings

    return AppWideStageSettings(settings_dep.data_root)


def _registry_default(stage_id: str) -> dict[str, object]:
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import STAGE_SETTINGS_DEFAULTS

    return dict(STAGE_SETTINGS_DEFAULTS.get(stage_id, {}))


@router.get(
    "/settings/stages",
    operation_id="get_all_stage_settings_all",
    response_model=None,
)
async def get_all_stage_settings_all(
    user: UserDep,
    settings: SettingsDep,
) -> JSONResponse:
    """Return all app-wide stage settings (all tier), keyed by stage_id."""
    aw = _app_wide(settings)
    return JSONResponse(content=aw.all_stages())


@router.get(
    "/settings/stages/{stage_id}",
    operation_id="get_stage_settings_all",
    response_model=None,
)
async def get_stage_settings_all(
    stage_id: str,
    user: UserDep,
    settings: SettingsDep,
) -> JSONResponse:
    """Return the app-wide (all-tier) settings for a stage.

    Returns the stage's stored app-wide settings if set, else the registry
    default (so the response is always a usable dict, not null/404).
    """
    if stage_id not in V2_PAGE_STAGE_IDS and stage_id not in V2_PROJECT_STAGE_IDS:
        raise HTTPException(422, f"unknown stage_id: {stage_id!r}")

    aw = _app_wide(settings)
    stored = aw.get(stage_id)
    reg = _registry_default(stage_id)
    # Return stored if set; else registry default as a baseline.
    return JSONResponse(content=stored if stored is not None else reg)


@router.put(
    "/settings/stages/{stage_id}",
    operation_id="put_stage_settings_all",
    response_model=None,
)
async def put_stage_settings_all(
    stage_id: str,
    user: UserDep,
    settings: SettingsDep,
    body: dict[str, object],
) -> JSONResponse:
    """Set the app-wide (all-tier) defaults for a stage.

    These apply to all projects that have no project-level or page-level
    override for this stage's fields. Persists via
    data_root/stage_settings_all.json (not the event store).
    """
    if stage_id not in V2_PAGE_STAGE_IDS and stage_id not in V2_PROJECT_STAGE_IDS:
        raise HTTPException(422, f"unknown stage_id: {stage_id!r}")

    aw = _app_wide(settings)
    aw.put(stage_id, body)
    return JSONResponse(content=aw.get(stage_id) or {})


@router.delete(
    "/settings/stages/{stage_id}",
    operation_id="delete_stage_settings_all",
    response_model=None,
)
async def delete_stage_settings_all(
    stage_id: str,
    user: UserDep,
    settings: SettingsDep,
) -> JSONResponse:
    """Remove the app-wide (all-tier) defaults for a stage.

    After deletion, the registry default applies for all projects without a
    project-level or page-level override for this stage.
    """
    if stage_id not in V2_PAGE_STAGE_IDS and stage_id not in V2_PROJECT_STAGE_IDS:
        raise HTTPException(422, f"unknown stage_id: {stage_id!r}")

    aw = _app_wide(settings)
    aw.delete(stage_id)
    return JSONResponse(content={})
