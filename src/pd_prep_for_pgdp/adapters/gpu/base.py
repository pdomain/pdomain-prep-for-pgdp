"""GPUBackend Protocol and request/response shapes.

Mirrors spec 04. The same Protocol is implemented in-process (`local`/`cpu`),
out-of-process (`modal`), and over HTTP (`shared_container`).
"""

from __future__ import annotations

from typing import Any, Literal, Protocol

from pydantic import BaseModel, Field

from ...core.models import OcrWord, PageConfigOverrides

# ─── Wire shapes (also reused by /api/gpu route schemas) ─────────────────────


class ProcessPageRequest(BaseModel):
    project_id: str
    idx0: int
    config_overrides: PageConfigOverrides
    output_context: Literal["workbench", "commit"] = "workbench"


class ProcessPageResponse(BaseModel):
    processed_image_key: str
    processed_image_url: str
    dimensions: tuple[int, int]
    processing_time_ms: int
    backend: Literal["local", "cpu", "mps", "modal", "shared_container"]
    cold_start_ms: int = 0


class OcrPageRequest(BaseModel):
    project_id: str
    idx0: int
    split_suffix: str | None = None
    engine: Literal["doctr", "tesseract"] | None = None
    model_key: str | None = None
    batch_mode: bool = False


class OcrPageResponse(BaseModel):
    text: str
    words: list[OcrWord] = Field(default_factory=list)
    text_key: str


class BatchJobItem(BaseModel):
    job_type: str
    project_id: str
    idx0: int
    payload: dict[str, Any] = Field(default_factory=dict)


class BatchJobResult(BaseModel):
    job_type: str
    project_id: str
    idx0: int
    ok: bool
    error: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


# ─── Protocol ────────────────────────────────────────────────────────────────


class GPUBackend(Protocol):
    name: Literal["local", "cpu", "mps", "modal", "shared_container"]

    async def process_page(self, req: ProcessPageRequest) -> ProcessPageResponse: ...

    async def run_ocr(self, req: OcrPageRequest) -> OcrPageResponse: ...

    async def run_batch(self, items: list[BatchJobItem]) -> list[BatchJobResult]: ...
