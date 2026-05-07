"""POST /api/gpu/run-ocr-page — single-page or single-split OCR (synchronous)."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ...adapters.gpu import GPUBackend, OcrPageRequest, OcrPageResponse
from ..dependencies import get_gpu_backend

router = APIRouter(tags=["gpu"])


@router.post("/run-ocr-page", response_model=OcrPageResponse, operation_id="run_ocr_page")
async def run_ocr_page(
    body: OcrPageRequest,
    gpu: GPUBackend = Depends(get_gpu_backend),
) -> OcrPageResponse:
    return await gpu.run_ocr(body)
