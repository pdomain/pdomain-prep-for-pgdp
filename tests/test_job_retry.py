"""Tests-first for `POST /api/gpu/jobs/{id}/retry`.

Locks in:
  - retrying an `error`-status job creates a NEW job with the same type +
    payload + project_id, status `queued`,
  - retrying a `complete` job is rejected (409),
  - retrying a missing job returns 404,
  - the response shape matches `BatchJobResponse` so the caller can poll the
    new job_id directly.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from pd_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pd_prep_for_pgdp.bootstrap import build_app
from pd_prep_for_pgdp.core.models import (
    Job,
    JobStatus,
    JobType,
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pd_prep_for_pgdp.settings import Settings


def _settings(tmp_path) -> Settings:
    return Settings(
        host="127.0.0.1",
        port=8765,
        data_root=tmp_path / "data",
        config_dir=tmp_path / "config",
        storage_backend="filesystem",
        database_url=f"sqlite:///{(tmp_path / 's.db').as_posix()}",
        gpu_backend="cpu",
        dispatch_interval_seconds=0,
        auth_mode="none",
    )


def _seed_project_and_job(settings: Settings, status: JobStatus) -> str:
    async def go() -> str:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id="r1",
                owner_id="default",
                name="t",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=2,
                proof_page_count=2,
                config=ProjectConfig(book_name="t", source_uri=""),
                pipeline_state=PipelineState(),
                storage_prefix="projects/r1/",
            )
        )
        job_id = "old-job"
        await db.put_job(
            Job(
                id=job_id,
                project_id="r1",
                owner_id="default",
                type=JobType.batch_process_pages,
                status=status,
                payload={"page_idxs": [0, 1]},
                error_message="cv2 raised an error" if status == JobStatus.error else None,
            )
        )
        await db.close()
        return job_id

    return asyncio.run(go())


def test_retry_creates_new_queued_job_with_same_payload(tmp_path) -> None:
    settings = _settings(tmp_path)
    old_id = _seed_project_and_job(settings, JobStatus.error)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(f"/api/gpu/jobs/{old_id}/retry")
        assert r.status_code == 202, r.text
        body = r.json()
        new_id = body["job_id"]
        assert new_id and new_id != old_id

        new_job = client.get(f"/api/data/jobs/{new_id}").json()
        assert new_job["status"] in ("queued", "scheduled")
        assert new_job["type"] == "batch_process_pages"
        assert new_job["payload"] == {"page_idxs": [0, 1]}
        assert new_job["project_id"] == "r1"
        assert new_job["error_message"] is None


def test_retry_rejects_terminal_complete(tmp_path) -> None:
    settings = _settings(tmp_path)
    old_id = _seed_project_and_job(settings, JobStatus.complete)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(f"/api/gpu/jobs/{old_id}/retry")
        assert r.status_code == 409


def test_retry_unknown_job_404(tmp_path) -> None:
    settings = _settings(tmp_path)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post("/api/gpu/jobs/no-such-job/retry")
        assert r.status_code == 404
