"""POST /api/gpu/ingest — kick off the unzip stage of ingest.

The route only enqueues the `unzip` job; the unzip handler chains a
follow-up `thumbnails` job on success. The frontend gets one job_id back
and watches the JobsPage for both stages.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException

from ...adapters.auth import UserContext
from ...adapters.database import IDatabase
from ...core.models import Job, JobProgress, JobStatus, JobType
from ..dependencies import get_database, get_user
from .schemas import IngestRequest, JobResponse

router = APIRouter(tags=["gpu"])


@router.post("/ingest", response_model=JobResponse, status_code=202)
async def ingest(
    body: IngestRequest,
    user: UserContext = Depends(get_user),
    db: IDatabase = Depends(get_database),
) -> JobResponse:
    project = await db.get_project(body.project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    job = Job(
        id=uuid.uuid4().hex,
        project_id=body.project_id,
        owner_id=user.user_id,
        type=JobType.unzip,
        status=JobStatus.queued,
        created_at=datetime.now(UTC),
        # core/job_runner reads source_key from progress.message until a
        # typed payload column lands on the jobs table.
        progress=JobProgress(message=body.source_key),
    )
    await db.put_job(job)
    return JobResponse(job_id=job.id, status="queued")
