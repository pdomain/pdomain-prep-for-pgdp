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
                type=JobType.build_package,
                status=status,
                payload={"page_idxs": [0, 1]},
                error_message="build failed" if status == JobStatus.error else None,
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
        assert new_id
        assert new_id != old_id

        new_job = client.get(f"/api/data/jobs/{new_id}").json()
        # Accept "running" — the background runner may have picked up the job
        # between the POST and this GET (dispatch_interval_seconds=0).  The
        # key invariant is that a *new* job was created (new_id != old_id) and
        # that the new job is active (not still in the original "error" state).
        assert new_job["status"] in ("queued", "scheduled", "running")
        assert new_job["type"] == "build_package"
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


# Roadmap P3 #16 — payload_override on retry.
#
# Default retry copies payload verbatim. payload_override is a shallow
# merge: keys in the override replace keys in the original; keys not present
# in the override are preserved from the original. The original job is never
# mutated (the audit trail stays intact).


def test_retry_with_payload_override_replaces_existing_key(tmp_path) -> None:
    settings = _settings(tmp_path)
    old_id = _seed_project_and_job(settings, JobStatus.error)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            f"/api/gpu/jobs/{old_id}/retry",
            json={"payload_override": {"page_idxs": [5, 7]}},
        )
        assert r.status_code == 202, r.text
        new_id = r.json()["job_id"]
        new_job = client.get(f"/api/data/jobs/{new_id}").json()
        # Override replaced the page_idxs list.
        assert new_job["payload"]["page_idxs"] == [5, 7]
        # estimated_pages reflects the override too.
        assert r.json()["estimated_pages"] == 2

        # Original job's payload is unchanged (audit trail).
        old_job = client.get(f"/api/data/jobs/{old_id}").json()
        assert old_job["payload"] == {"page_idxs": [0, 1]}


def test_retry_with_payload_override_adds_new_key_preserves_others(tmp_path) -> None:
    settings = _settings(tmp_path)
    old_id = _seed_project_and_job(settings, JobStatus.error)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            f"/api/gpu/jobs/{old_id}/retry",
            json={"payload_override": {"confidence_threshold": 0.4}},
        )
        assert r.status_code == 202, r.text
        new_id = r.json()["job_id"]
        new_job = client.get(f"/api/data/jobs/{new_id}").json()
        # New key added.
        assert new_job["payload"]["confidence_threshold"] == 0.4
        # Original page_idxs preserved (shallow merge — keys not in override survive).
        assert new_job["payload"]["page_idxs"] == [0, 1]


def test_retry_with_empty_payload_override_is_noop(tmp_path) -> None:
    settings = _settings(tmp_path)
    old_id = _seed_project_and_job(settings, JobStatus.error)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(f"/api/gpu/jobs/{old_id}/retry", json={"payload_override": {}})
        assert r.status_code == 202, r.text
        new_id = r.json()["job_id"]
        new_job = client.get(f"/api/data/jobs/{new_id}").json()
        # Empty override == no override; payload identical to original.
        assert new_job["payload"] == {"page_idxs": [0, 1]}


def test_retry_with_null_payload_override_uses_original(tmp_path) -> None:
    settings = _settings(tmp_path)
    old_id = _seed_project_and_job(settings, JobStatus.error)
    app = build_app(settings)
    with TestClient(app) as client:
        # Explicit null is the same as omitting the body entirely.
        r = client.post(f"/api/gpu/jobs/{old_id}/retry", json={"payload_override": None})
        assert r.status_code == 202, r.text
        new_id = r.json()["job_id"]
        new_job = client.get(f"/api/data/jobs/{new_id}").json()
        assert new_job["payload"] == {"page_idxs": [0, 1]}
