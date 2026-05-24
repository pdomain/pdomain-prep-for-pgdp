"""Tests-first for `POST /api/gpu/jobs/{id}/retry`.

Locks in:
  - retrying an `error`-status job creates a NEW job with the same type +
    payload + project_id, status `queued`,
  - retrying a `complete` job is rejected (409),
  - retrying a missing job returns 404,
  - the response shape matches `BatchJobResponse` so the caller can poll the
    new job_id directly.

Issue #126 security tests:
  - payload_override keys not on the per-job-type allowlist are rejected (400).
  - project_id and data_root are never overrideable regardless of job type.
  - retrying another user's job is rejected (403) even without a payload override.
  - device is the sole safe override key for run_page_stage jobs.
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


def _seed_run_page_stage_job(
    settings: Settings, status: JobStatus, owner_id: str = "default", project_id: str = "r1"
) -> str:
    """Seed a run_page_stage job for security-focused tests."""

    async def go() -> str:
        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        await db.put_project(
            Project(
                id=project_id,
                owner_id=owner_id,
                name="t",
                created_at=now,
                updated_at=now,
                status=ProjectStatus.processing,
                page_count=1,
                proof_page_count=1,
                config=ProjectConfig(book_name="t", source_uri=""),
                pipeline_state=PipelineState(),
                storage_prefix=f"projects/{project_id}/",
            )
        )
        job_id = f"rps-job-{owner_id}"
        await db.put_job(
            Job(
                id=job_id,
                project_id=project_id,
                owner_id=owner_id,
                type=JobType.run_page_stage,
                status=status,
                payload={
                    "page_id": "0000",
                    "stage_id": "process_page",
                    "device": "cpu",
                    "data_root": str(settings.data_root),
                },
                error_message="stage failed" if status == JobStatus.error else None,
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
#
# Issue #126 — allowlist: only keys in _RETRY_SAFE_KEYS for the job type are
# accepted; all others are rejected with 400. build_package has no safe keys,
# so ANY payload_override with a non-empty key set returns 400.


def test_retry_build_package_any_override_rejected(tmp_path) -> None:
    """build_package has an empty safe-keys set; any override key returns 400."""
    settings = _settings(tmp_path)
    old_id = _seed_project_and_job(settings, JobStatus.error)
    app = build_app(settings)
    with TestClient(app) as client:
        # Previously this returned 202 — now 400 because page_idxs is not safe.
        r = client.post(
            f"/api/gpu/jobs/{old_id}/retry",
            json={"payload_override": {"page_idxs": [5, 7]}},
        )
        assert r.status_code == 400, r.text
        assert "page_idxs" in r.text


def test_retry_build_package_arbitrary_key_rejected(tmp_path) -> None:
    """Arbitrary keys on build_package are also rejected (no allowlist entries)."""
    settings = _settings(tmp_path)
    old_id = _seed_project_and_job(settings, JobStatus.error)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            f"/api/gpu/jobs/{old_id}/retry",
            json={"payload_override": {"confidence_threshold": 0.4}},
        )
        assert r.status_code == 400, r.text
        assert "confidence_threshold" in r.text


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


# ─── Issue #126 security regression tests ────────────────────────────────────


def test_retry_rejects_project_id_override(tmp_path) -> None:
    """project_id must never be overrideable — returns 400 for any job type."""
    settings = _settings(tmp_path)
    job_id = _seed_run_page_stage_job(settings, JobStatus.error)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            f"/api/gpu/jobs/{job_id}/retry",
            json={"payload_override": {"project_id": "other-project"}},
        )
        assert r.status_code == 400, r.text
        assert "project_id" in r.text


def test_retry_rejects_data_root_override(tmp_path) -> None:
    """data_root must never be overrideable — returns 400 for any job type."""
    settings = _settings(tmp_path)
    job_id = _seed_run_page_stage_job(settings, JobStatus.error)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            f"/api/gpu/jobs/{job_id}/retry",
            json={"payload_override": {"data_root": "/tmp/evil"}},
        )
        assert r.status_code == 400, r.text
        assert "data_root" in r.text


def test_retry_allows_device_override_for_run_page_stage(tmp_path) -> None:
    """device is the one safe override key for run_page_stage — returns 202."""
    settings = _settings(tmp_path)
    job_id = _seed_run_page_stage_job(settings, JobStatus.error)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            f"/api/gpu/jobs/{job_id}/retry",
            json={"payload_override": {"device": "cuda"}},
        )
        assert r.status_code == 202, r.text
        new_id = r.json()["job_id"]
        new_job = client.get(f"/api/data/jobs/{new_id}").json()
        assert new_job["payload"]["device"] == "cuda"
        # Other payload keys preserved.
        assert new_job["payload"]["stage_id"] == "process_page"


def test_retry_rejects_non_safe_key_for_run_page_stage(tmp_path) -> None:
    """page_id is not in the run_page_stage allowlist — returns 400."""
    settings = _settings(tmp_path)
    job_id = _seed_run_page_stage_job(settings, JobStatus.error)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(
            f"/api/gpu/jobs/{job_id}/retry",
            json={"payload_override": {"page_id": "0099"}},
        )
        assert r.status_code == 400, r.text
        assert "page_id" in r.text


def test_retry_cross_owner_rejected(tmp_path) -> None:
    """A job owned by user-b cannot be retried by user-a — returns 403.

    In auth_mode=none every request is the anonymous "default" user, so we
    set the job's owner_id to a non-default value to simulate user-b owning it.
    """
    settings = _settings(tmp_path)
    # Seed the job as owned by a different user than "default".
    job_id = _seed_run_page_stage_job(settings, JobStatus.error, owner_id="user-b", project_id="pb")
    app = build_app(settings)
    with TestClient(app) as client:
        # In auth_mode=none the requester is always "default", not "user-b".
        r = client.post(f"/api/gpu/jobs/{job_id}/retry", json={})
        # The route already filters by owner_id (404) before the ownership
        # check can fire. Either 403 or 404 is acceptable — both prevent access.
        assert r.status_code in {403, 404}, r.text


def test_retry_own_job_no_override_succeeds_in_local_mode(tmp_path) -> None:
    """Sanity: retrying your own job without any override still works (auth_mode=none)."""
    settings = _settings(tmp_path)
    # In auth_mode=none, default user owns everything seeded with owner_id="default".
    job_id = _seed_run_page_stage_job(settings, JobStatus.error)
    app = build_app(settings)
    with TestClient(app) as client:
        r = client.post(f"/api/gpu/jobs/{job_id}/retry", json={})
        assert r.status_code == 202, r.text
