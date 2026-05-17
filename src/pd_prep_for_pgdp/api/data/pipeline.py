"""/api/data/pipeline/* — static pipeline metadata (field-to-stage map)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from pd_prep_for_pgdp.core.models import PAGE_STAGE_IDS
from pd_prep_for_pgdp.core.pipeline.stage_runner import STAGE_CONFIG_FIELDS

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
    if stage_id not in PAGE_STAGE_IDS:
        raise HTTPException(422, f"unknown stage_id: {stage_id!r}")
    fields = sorted(STAGE_CONFIG_FIELDS.get(stage_id, frozenset()))
    return StageFieldsResponse(stage_id=stage_id, fields=fields)
