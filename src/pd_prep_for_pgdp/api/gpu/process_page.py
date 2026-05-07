"""POST /api/gpu/process-page — single-page workbench preview (synchronous)."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ...adapters.gpu import GPUBackend, ProcessPageRequest, ProcessPageResponse
from ..dependencies import get_gpu_backend

router = APIRouter(tags=["gpu"])


@router.post("/process-page", response_model=ProcessPageResponse, operation_id="process_page")
async def process_page(
    body: ProcessPageRequest,
    gpu: GPUBackend = Depends(get_gpu_backend),
) -> ProcessPageResponse:
    return await gpu.process_page(body)
