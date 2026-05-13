"""/api/data/pipeline/* — static pipeline metadata (field-to-stage map)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ...core.models import PAGE_STAGE_IDS
from ...core.pipeline.stage_runner import STAGE_CONFIG_FIELDS

router = APIRouter(tags=["pipeline"])


class StageFieldsResponse(BaseModel):
    stage_id: str
    fields: list[str]


@router.get(
    "/pipeline/stages/{stage_id}/fields",
    response_model=StageFieldsResponse,
    operation_id="get_stage_fields",
)
async def get_stage_fields(stage_id: str) -> StageFieldsResponse:
    """Return the sorted list of PageConfigOverrides field names that stage reads.

    Backed by STAGE_CONFIG_FIELDS in stage_runner.py — the same map that
    cascade_dirty_for_config_change uses. Stages not in the map read no
    per-page config fields; they return an empty list.

    Status codes:
    - 200: known stage_id; body has sorted fields list (may be empty).
    - 422: unknown stage_id (not in PAGE_STAGE_IDS).
    """
    if stage_id not in PAGE_STAGE_IDS:
        raise HTTPException(422, f"unknown stage_id: {stage_id!r}")
    fields = sorted(STAGE_CONFIG_FIELDS.get(stage_id, frozenset()))
    return StageFieldsResponse(stage_id=stage_id, fields=fields)
