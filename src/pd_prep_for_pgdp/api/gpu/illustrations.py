"""/api/gpu/suggest-* + extract-illustration — interactive layout helpers (spec 05)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from pd_prep_for_pgdp.api.dependencies import get_gpu_backend

if TYPE_CHECKING:
    from pd_prep_for_pgdp.adapters.gpu import GPUBackend
    from pd_prep_for_pgdp.core.models import IllustrationRegion, PageSplit

router = APIRouter(tags=["gpu"])


class SuggestSplitsRequest(BaseModel):
    project_id: str
    idx0: int


class SuggestSplitsResponse(BaseModel):
    splits: list[PageSplit] = []


class SuggestIllustrationsRequest(BaseModel):
    project_id: str
    idx0: int


class SuggestIllustrationsResponse(BaseModel):
    regions: list[IllustrationRegion] = []


class ExtractIllustrationRequest(BaseModel):
    project_id: str
    idx0: int
    region_index: int
    output_format: Literal["jpg", "png"] = "jpg"


class ExtractIllustrationResponse(BaseModel):
    image_key: str
    image_url: str


@router.post("/suggest-splits", response_model=SuggestSplitsResponse, operation_id="suggest_splits")
async def suggest_splits(
    body: SuggestSplitsRequest,
    gpu: GPUBackend = Depends(get_gpu_backend),
) -> SuggestSplitsResponse:
    # Wired in a later iteration once the splitter heuristic / layout model lands.
    return SuggestSplitsResponse()


@router.post(
    "/suggest-illustrations",
    response_model=SuggestIllustrationsResponse,
    operation_id="suggest_illustrations",
)
async def suggest_illustrations(
    body: SuggestIllustrationsRequest,
    gpu: GPUBackend = Depends(get_gpu_backend),
) -> SuggestIllustrationsResponse:
    return SuggestIllustrationsResponse()


@router.post(
    "/extract-illustration", response_model=ExtractIllustrationResponse, operation_id="extract_illustration"
)
async def extract_illustration(
    body: ExtractIllustrationRequest,
    gpu: GPUBackend = Depends(get_gpu_backend),
) -> ExtractIllustrationResponse:
    raise NotImplementedError("core.illustrations.extract_illustration not yet wired")
