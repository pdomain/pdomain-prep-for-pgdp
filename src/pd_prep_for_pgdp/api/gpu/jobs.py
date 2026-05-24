"""/api/gpu/jobs/* — poll, cancel, SSE-stream jobs."""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import cast

from fastapi import APIRouter, HTTPException
from sse_starlette.sse import EventSourceResponse

from pd_prep_for_pgdp.api.dependencies import DatabaseDep, JobEventsDep, UserDep
from pd_prep_for_pgdp.core.models import Job, JobStatus

from .schemas import BatchJobResponse, RetryJobRequest

router = APIRouter(tags=["gpu"])

# Per-job-type allowlist of keys that are safe to override on retry.
# Keys NOT in this set are rejected with 400. Identity fields (project_id,
# owner_id, data_root) and page-identity fields (page_id, stage_id) are
# intentionally absent from all allowlists — they must never be overrideable.
# Unknown job types default to frozenset() (new types start locked down).
_RETRY_SAFE_KEYS: dict[str, frozenset[str]] = {
    "unzip": frozenset(),
    "thumbnails": frozenset(),
    "build_package": frozenset(),
    "run_page_stage": frozenset({"device"}),
    "project_run_dirty": frozenset(),
    "project_run_stage_all_pages": frozenset(),
}


@router.get("/jobs", response_model=list[Job], operation_id="list_gpu_jobs")
async def list_jobs(
    user: UserDep,
    db: DatabaseDep,
    limit: int = 50,
) -> list[Job]:
    """List the most recent jobs for the current user (newest first)."""
    return await db.list_recent_jobs(user.user_id, limit=limit)


@router.get("/jobs/{job_id}", response_model=Job, operation_id="get_gpu_job")
async def get_job(
    job_id: str,
    user: UserDep,
    db: DatabaseDep,
) -> Job:
    job = await db.get_job(job_id)
    if job is None or job.owner_id != user.user_id:
        raise HTTPException(404, "job not found")
    return job


@router.delete("/jobs/{job_id}", status_code=204, operation_id="cancel_gpu_job")
async def cancel_job(
    job_id: str,
    user: UserDep,
    db: DatabaseDep,
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
    user: UserDep,
    db: DatabaseDep,
    body: RetryJobRequest | None = None,
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

    from pd_prep_for_pgdp.settings import Settings

    settings = Settings()
    interval = settings.dispatch_interval_seconds
    dispatch_mode = "scheduled" if interval > 0 else "immediate"
    next_dispatch = datetime.now(UTC) + timedelta(seconds=interval) if interval > 0 else None

    # Issue #126 — enforce per-job-type key allowlist before merging overrides.
    # Any key not in _RETRY_SAFE_KEYS for this job type is rejected with 400.
    # Identity/path fields (project_id, data_root, owner_id, page_id, stage_id)
    # are intentionally absent from all allowlists.
    if body is not None and body.payload_override:
        safe_keys = _RETRY_SAFE_KEYS.get(job.type.value, frozenset())
        rejected = sorted(set(body.payload_override) - safe_keys)
        if rejected:
            raise HTTPException(400, f"payload keys not overridable for {job.type.value}: {rejected}")

    # Issue #126 — ownership check: the original job's project must belong
    # to the requesting user. In auth_mode=none both sides are "default" so
    # the check trivially passes. Uses job.project_id (DB row), NOT payload.
    if job.project_id:
        project = await db.get_project(job.project_id)
        if project is None or project.owner_id != user.user_id:
            raise HTTPException(403, "not authorised to retry this job")

    # Shallow-merge `payload_override` over a copy of the original payload.
    # `dict(job.payload)` keeps the original job's row immutable.
    new_payload = dict(job.payload)
    if body is not None and body.payload_override:
        safe_keys = _RETRY_SAFE_KEYS.get(job.type.value, frozenset())
        new_payload.update({k: body.payload_override[k] for k in safe_keys if k in body.payload_override})

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
    page_idxs_raw = new_job.payload.get("page_idxs")
    page_idxs = cast(list[object], page_idxs_raw) if isinstance(page_idxs_raw, list) else []
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
    user: UserDep,
    db: DatabaseDep,
    events: JobEventsDep,
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

    async def stream() -> AsyncIterator[dict[str, str]]:
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
            event = cast(dict[str, object], ev)
            yield {
                "event": str(event.get("status", "progress")),
                "data": json.dumps(event),
            }
            if event.get("status") in {"complete", "error", "cancelled"}:
                return

    return EventSourceResponse(stream())
