"""GPUBackend Protocol and request/response shapes.

Mirrors spec 04. The same Protocol is implemented in-process (`local`/`cpu`),
out-of-process (`modal`), and over HTTP (`shared_container`).
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any, Literal, Protocol

from pydantic import Field

from ...core.models import ApiModel, OcrWord, PageConfigOverrides

# ─── Wire shapes (also reused by /api/gpu route schemas) ─────────────────────


class ProcessPageRequest(ApiModel):
    project_id: str
    idx0: int
    config_overrides: PageConfigOverrides
    output_context: Literal["workbench", "commit"] = "workbench"


class ProcessPageResponse(ApiModel):
    processed_image_key: str
    processed_image_url: str
    dimensions: tuple[int, int]
    processing_time_ms: int
    backend: Literal["local", "cpu", "mps", "modal", "shared_container"]
    cold_start_ms: int = 0


class OcrPageRequest(ApiModel):
    project_id: str
    idx0: int
    split_suffix: str | None = None
    engine: Literal["doctr", "tesseract"] | None = None
    model_key: str | None = None
    batch_mode: bool = False


class OcrPageResponse(ApiModel):
    text: str
    words: list[OcrWord] = Field(default_factory=list)
    text_key: str


class BatchJobItem(ApiModel):
    job_type: str
    project_id: str
    idx0: int
    payload: dict[str, Any] = Field(default_factory=dict)


class BatchJobResult(ApiModel):
    job_type: str
    project_id: str
    idx0: int
    ok: bool
    error: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


# ─── Protocol ────────────────────────────────────────────────────────────────


# Optional per-item progress callback for `run_batch`. Backends that can
# stream per-item completion (CPU, eventually CUDA) call this after every
# `BatchJobItem` settles; backends that only learn the outcome at the end
# (Modal `.remote.aio()`, single-shot HTTP) accept and ignore it.
#
# Signature: cb(current, total, result) — `current` is the count of items
# settled so far (1..total), `result` is the just-finished BatchJobResult.
BatchProgressCb = Callable[[int, int, "BatchJobResult"], Awaitable[None]]


class GPUBackend(Protocol):
    name: Literal["local", "cpu", "mps", "modal", "shared_container"]

    async def process_page(self, req: ProcessPageRequest) -> ProcessPageResponse: ...

    async def run_ocr(self, req: OcrPageRequest) -> OcrPageResponse: ...

    async def run_batch(
        self,
        items: list[BatchJobItem],
        *,
        progress_cb: BatchProgressCb | None = None,
    ) -> list[BatchJobResult]: ...
