"""Wire shapes for /api/gpu/*. Pydantic source-of-truth for the OpenAPI client."""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel

if TYPE_CHECKING:
    from datetime import datetime

    from pd_prep_for_pgdp.core.models import JobStatus

__all__ = [
    "BatchJobResponse",
    "IngestRequest",
    "JobResponse",
    "RetryJobRequest",
]


class IngestRequest(BaseModel):
    project_id: str
    source_key: str
    source_type: Literal["zip", "s3_folder", "local_folder"]


class JobResponse(BaseModel):
    job_id: str
    status: Literal["queued", "running"] = "queued"


class BatchJobResponse(BaseModel):
    job_id: str
    status: JobStatus
    estimated_pages: int = 0
    dispatch_mode: Literal["immediate", "scheduled"] = "immediate"
    next_dispatch_at: datetime | None = None


class RetryJobRequest(BaseModel):
    """Optional body for `POST /api/gpu/jobs/{id}/retry`.

    `payload_override`, when non-null, is shallow-merged over the original
    job's payload — keys present in the override replace the corresponding
    keys; keys not present are preserved from the original. The original
    job is never mutated, so the audit trail stays intact.
    """

    payload_override: dict | None = None
