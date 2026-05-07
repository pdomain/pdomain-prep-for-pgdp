"""/api/gpu/jobs/* — submit, poll, cancel, SSE-stream batch jobs."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sse_starlette.sse import EventSourceResponse

from ...adapters.auth import UserContext
from ...adapters.database import IDatabase
from ...core.job_events import JobEventBroker
from ...core.models import Job, JobStatus, JobType
from ..dependencies import get_database, get_job_events, get_user
from .schemas import BatchJobRequest, BatchJobResponse, RetryJobRequest

router = APIRouter(tags=["gpu"])


@router.post("/jobs", response_model=BatchJobResponse, status_code=202, operation_id="submit_batch_job")
async def submit_batch_job(
    body: BatchJobRequest,
    user: UserContext = Depends(get_user),
    db: IDatabase = Depends(get_database),
) -> BatchJobResponse:
    project = await db.get_project(body.project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    from ...settings import Settings

    settings = Settings()  # tolerable: cheap; bootstrap holds the canonical instance
    interval = settings.dispatch_interval_seconds
    dispatch_mode = "scheduled" if interval > 0 else "immediate"
    next_dispatch = datetime.now(UTC) + timedelta(seconds=interval) if interval > 0 else None

    payload: dict = {}
    if body.page_idxs:
        payload["page_idxs"] = body.page_idxs

    job = Job(
        id=uuid.uuid4().hex,
        project_id=body.project_id,
        owner_id=user.user_id,
        type=JobType[body.job_type],
        status=JobStatus.scheduled if interval > 0 else JobStatus.queued,
        next_dispatch_at=next_dispatch,
        payload=payload,
    )
    await db.put_job(job)
    return BatchJobResponse(
        job_id=job.id,
        status=job.status,
        estimated_pages=len(body.page_idxs) if body.page_idxs else 0,
        dispatch_mode=dispatch_mode,
        next_dispatch_at=next_dispatch,
    )


@router.get("/jobs/{job_id}", response_model=Job, operation_id="get_gpu_job")
async def get_job(
    job_id: str,
    user: UserContext = Depends(get_user),
    db: IDatabase = Depends(get_database),
) -> Job:
    job = await db.get_job(job_id)
    if job is None or job.owner_id != user.user_id:
        raise HTTPException(404, "job not found")
    return job


@router.delete("/jobs/{job_id}", status_code=204, operation_id="cancel_gpu_job")
async def cancel_job(
    job_id: str,
    user: UserContext = Depends(get_user),
    db: IDatabase = Depends(get_database),
) -> None:
    job = await db.get_job(job_id)
    if job is None or job.owner_id != user.user_id:
        raise HTTPException(404, "job not found")
    if job.status not in {JobStatus.complete, JobStatus.error, JobStatus.cancelled}:
        job.status = JobStatus.cancelled
        await db.put_job(job)


@router.post(
    "/jobs/{job_id}/retry", response_model=BatchJobResponse, status_code=202, operation_id="retry_gpu_job"
)
async def retry_job(
    job_id: str,
    body: RetryJobRequest | None = None,
    user: UserContext = Depends(get_user),
    db: IDatabase = Depends(get_database),
) -> BatchJobResponse:
    """Create a fresh copy of a failed/cancelled job in `queued` status.

    Same project_id and type — fresh id and timestamps. The original job
    stays in the database so the user can compare. The new job's payload
    starts as a copy of the original's; if `body.payload_override` is
    provided (P3 #16), its keys are shallow-merged over the original
    payload (override keys replace, others are preserved). Pass `None` /
    omit the body to retry verbatim.
    """
    job = await db.get_job(job_id)
    if job is None or job.owner_id != user.user_id:
        raise HTTPException(404, "job not found")
    if job.status not in {JobStatus.error, JobStatus.cancelled}:
        raise HTTPException(409, f"only error/cancelled jobs are retryable; this is {job.status.value}")

    from ...settings import Settings

    settings = Settings()
    interval = settings.dispatch_interval_seconds
    dispatch_mode = "scheduled" if interval > 0 else "immediate"
    next_dispatch = datetime.now(UTC) + timedelta(seconds=interval) if interval > 0 else None

    # Shallow-merge `payload_override` over a copy of the original payload.
    # `dict(job.payload)` keeps the original job's row immutable.
    new_payload = dict(job.payload)
    if body is not None and body.payload_override:
        new_payload.update(body.payload_override)

    new_job = Job(
        id=uuid.uuid4().hex,
        project_id=job.project_id,
        owner_id=user.user_id,
        type=job.type,
        status=JobStatus.scheduled if interval > 0 else JobStatus.queued,
        next_dispatch_at=next_dispatch,
        payload=new_payload,
    )
    await db.put_job(new_job)
    page_idxs = new_job.payload.get("page_idxs") or []
    return BatchJobResponse(
        job_id=new_job.id,
        status=new_job.status,
        estimated_pages=len(page_idxs),
        dispatch_mode=dispatch_mode,
        next_dispatch_at=next_dispatch,
    )


@router.get("/jobs/{job_id}/events", operation_id="stream_gpu_job_events")
async def job_events(
    job_id: str,
    user: UserContext = Depends(get_user),
    db: IDatabase = Depends(get_database),
    events: JobEventBroker = Depends(get_job_events),
):
    """SSE — push status transitions until the job is terminal.

    Subscribes to the in-process `JobEventBroker` and forwards events as
    `text/event-stream` frames. First frame is the current snapshot from
    the database so a late subscriber sees state immediately; subsequent
    frames come from the broker (zero-poll).
    """
    job = await db.get_job(job_id)
    if job is None or job.owner_id != user.user_id:
        raise HTTPException(404, "job not found")

    async def stream():
        # Initial snapshot.
        snapshot = {
            "type": "progress",
            "status": job.status.value,
            "current": job.progress.current,
            "total": job.progress.total,
            "current_page": job.progress.current_page,
            "message": job.progress.message,
        }
        yield {
            "event": "snapshot" if job.status == JobStatus.running else job.status.value,
            "data": json.dumps(snapshot),
        }

        if job.status in {JobStatus.complete, JobStatus.error, JobStatus.cancelled}:
            return

        async for ev in events.subscribe(job_id):
            yield {
                "event": ev.get("status", "progress"),
                "data": json.dumps(ev),
            }
            if ev.get("status") in {"complete", "error", "cancelled"}:
                return

    return EventSourceResponse(stream())
