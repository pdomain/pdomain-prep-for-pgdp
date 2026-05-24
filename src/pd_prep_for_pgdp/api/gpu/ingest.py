"""POST /api/gpu/ingest — kick off the unzip stage of ingest.

The route only enqueues the `unzip` job; the unzip handler chains a
follow-up `thumbnails` job on success. The frontend gets one job_id back
and watches the JobsPage for both stages.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException

from pd_prep_for_pgdp.api.data.storage_keys import assert_project_scoped_key
from pd_prep_for_pgdp.api.dependencies import get_database, get_user
from pd_prep_for_pgdp.core.models import Job, JobProgress, JobStatus, JobType

from .schemas import IngestRequest, JobResponse

if TYPE_CHECKING:
    from pd_prep_for_pgdp.adapters.auth import UserContext
    from pd_prep_for_pgdp.adapters.database import IDatabase

router = APIRouter(tags=["gpu"])


def _validate_source_key(project_id: str, source_key: str) -> None:
    """Raise HTTPException(400) if source_key is not scoped to project_id.

    Wraps assert_project_scoped_key so that route-level validation raises the
    correct HTTP status code rather than a bare ValueError.
    """
    try:
        assert_project_scoped_key(project_id, source_key)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/ingest", response_model=JobResponse, status_code=202, operation_id="start_ingest")
async def ingest(
    body: IngestRequest,
    user: UserContext = Depends(get_user),
    db: IDatabase = Depends(get_database),
) -> JobResponse:
    project = await db.get_project(body.project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    _validate_source_key(body.project_id, body.source_key)

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
