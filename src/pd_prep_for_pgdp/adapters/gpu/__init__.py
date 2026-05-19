"""Deprecated — GPU dispatch primitives now live in pd_ocr_ops.gpu.

This shim re-exports for one release cycle. Update imports to
``from pd_ocr_ops.gpu import ...`` to eliminate this transitional layer.
dispatcher/* files are the remaining consumers; they will be migrated in
Tasks 4+5.
"""

from __future__ import annotations

from pd_ocr_ops.gpu import (
    BatchJobItem,
    BatchJobResult,
    GPUBackend,
    OcrPageRequest,
    OcrPageResponse,
    ProcessPageRequest,
    ProcessPageResponse,
)

__all__ = [
    "BatchJobItem",
    "BatchJobResult",
    "GPUBackend",
    "OcrPageRequest",
    "OcrPageResponse",
    "ProcessPageRequest",
    "ProcessPageResponse",
]
