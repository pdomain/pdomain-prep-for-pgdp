"""Tests-first for `DELETE /api/gpu/jobs/{id}` (cancel_job).

Locks in:
  - cancelling a `queued` job flips status to `cancelled`,
  - cancelling a `running` job flips status to `cancelled`,
  - cancelling a `complete`/`error`/`cancelled` job is a no-op (idempotent),
  - cancelling a missing job returns 404,
  - cancelling another user's job returns 404 (not 403, to avoid leaking
    existence — same shape the get_job route already uses).
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.core.models import (
    Job,
    JobStatus,
    JobType,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.settings import Settings


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


def _seed(settings: Settings, *, job_id: str, status: JobStatus, owner_id: str = "default") -> None:
    async def go() -> None:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id="c1",
                owner_id=owner_id,
                name="t",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=0,
                proof_page_count=0,
                config=ProjectConfig(book_name="t", source_uri=""),
                storage_prefix="projects/c1/",
            )
        )
        await db.put_job(
            Job(
                id=job_id,
                project_id="c1",
                owner_id=owner_id,
                type=JobType.run_project_stage,
                status=status,
            )
        )
        await db.close()

    asyncio.run(go())


# `queued` is intentionally omitted: the in-process job runner started by
# the lifespan picks queued jobs up immediately and flips them to running,
# racing the DELETE. The route itself accepts cancellation from any
# non-terminal status, which `running` + `scheduled` cover.
@pytest.mark.parametrize("from_status", [JobStatus.running, JobStatus.scheduled])
def test_cancel_live_job_flips_to_cancelled(tmp_path, from_status: JobStatus) -> None:
    settings = _settings(tmp_path)
    _seed(settings, job_id="live", status=from_status)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.delete("/api/gpu/jobs/live")
        assert r.status_code == 204

        body = client.get("/api/data/jobs/live").json()
        assert body["status"] == "cancelled"


@pytest.mark.parametrize("terminal", [JobStatus.complete, JobStatus.error, JobStatus.cancelled])
def test_cancel_terminal_job_is_noop(tmp_path, terminal: JobStatus) -> None:
    settings = _settings(tmp_path)
    _seed(settings, job_id="t1", status=terminal)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.delete("/api/gpu/jobs/t1")
        # 204 either way — terminal jobs aren't an error to "cancel".
        assert r.status_code == 204
        # Status must NOT change.
        body = client.get("/api/data/jobs/t1").json()
        assert body["status"] == terminal.value


def test_cancel_missing_job_404(tmp_path) -> None:
    settings = _settings(tmp_path)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.delete("/api/gpu/jobs/no-such-job")
        assert r.status_code == 404


def test_cancel_other_users_job_404(tmp_path) -> None:
    """Owner mismatch returns 404, NOT 403 — same as get_job, to avoid leaking
    job-id existence to non-owners."""
    settings = _settings(tmp_path)
    _seed(settings, job_id="not-yours", status=JobStatus.queued, owner_id="someone-else")
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.delete("/api/gpu/jobs/not-yours")
        assert r.status_code == 404
        # Original job intact.
