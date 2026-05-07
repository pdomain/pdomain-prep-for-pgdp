"""/api/data/jobs/* — read-only job index. Jobs are CREATED by /api/gpu/*."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from ...adapters.auth import UserContext
from ...adapters.database import IDatabase
from ...core.models import Job
from ..dependencies import get_database, get_user

router = APIRouter(tags=["jobs"])


@router.get("/jobs", response_model=list[Job], operation_id="list_recent_jobs")
async def list_recent_jobs(
    user: UserContext = Depends(get_user),
    db: IDatabase = Depends(get_database),
    limit: int = Query(50, ge=1, le=500),
    project_id: str | None = Query(None),
) -> list[Job]:
    jobs = await db.list_recent_jobs(user.user_id, limit)
    if project_id:
        jobs = [j for j in jobs if j.project_id == project_id]
    return jobs


@router.get("/jobs/{job_id}", response_model=Job, operation_id="get_job")
async def get_job(
    job_id: str,
    user: UserContext = Depends(get_user),
    db: IDatabase = Depends(get_database),
) -> Job:
    job = await db.get_job(job_id)
    if job is None or job.owner_id != user.user_id:
        raise HTTPException(404, "job not found")
    return job
