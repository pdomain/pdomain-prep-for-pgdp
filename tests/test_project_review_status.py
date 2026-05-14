"""Tests for GET /api/data/projects/{id}/review-status.

Returns unreviewed_count (proof pages without a clean text_review stage)
and awaiting_review_job_id (the id of any parked build_package job).
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from pd_prep_for_pgdp.bootstrap import build_app
from pd_prep_for_pgdp.core.models import (
    Job,
    JobStatus,
    JobType,
    PageRecord,
    PageStageState,
    PageStageStatus,
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


def _seed(settings: Settings, *, project_id: str = "rs1", n_pages: int = 3, n_reviewed: int = 1) -> str:
    """Seed project, pages, text_review stages, and an awaiting_review job.

    Returns the job_id of the parked build_package job.
    """

    async def go() -> str:
        from pd_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase

        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        project = Project(
            id=project_id,
            owner_id="default",
            name="t",
            created_at=now,
            updated_at=now,
            status=ProjectStatus.reviewing,
            page_count=n_pages,
            proof_page_count=n_pages,
            config=ProjectConfig(book_name="t", source_uri=""),
            pipeline_state=PipelineState(),
            storage_prefix=f"projects/{project_id}/",
        )
        await db.put_project(project)

        pages = [
            PageRecord(
                project_id=project_id,
                idx0=i,
                prefix=f"p{i + 1:03d}",
                source_stem=f"s{i}",
            )
            for i in range(n_pages)
        ]
        await db.put_pages(pages)

        # Mark n_reviewed pages as clean text_review
        for i in range(n_reviewed):
            page_id = f"{i:04d}"
            await db.put_page_stage(
                PageStageState(
                    project_id=project_id,
                    page_id=page_id,
                    stage_id="text_review",
                    status=PageStageStatus.clean,
                )
            )

        # Create a parked build_package job
        job = Job(
            id="job_awaiting",
            project_id=project_id,
            owner_id="default",
            type=JobType.build_package,
            status=JobStatus.awaiting_review,
        )
        await db.put_job(job)
        await db.close()
        return job.id

    return asyncio.run(go())


def test_review_status_returns_unreviewed_count_and_job_id(tmp_path) -> None:
    """Endpoint returns correct unreviewed_count and awaiting_review_job_id."""
    settings = _settings(tmp_path)
    job_id = _seed(settings, n_pages=3, n_reviewed=1)
    app = build_app(settings)

    with TestClient(app) as client:
        r = client.get("/api/data/projects/rs1/review-status")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["unreviewed_count"] == 2
        assert body["awaiting_review_job_id"] == job_id


def test_review_status_zero_when_all_reviewed(tmp_path) -> None:
    """unreviewed_count is 0 when all pages have clean text_review stage.

    The job runner auto-transitions the parked job to queued when all pages
    are reviewed, so awaiting_review_job_id is None at that point.
    """
    settings = _settings(tmp_path)
    _seed(settings, project_id="rs2", n_pages=2, n_reviewed=2)
    app = build_app(settings)

    with TestClient(app) as client:
        r = client.get("/api/data/projects/rs2/review-status")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["unreviewed_count"] == 0
        # Job runner re-queued the job, so no awaiting_review job remains
        assert body["awaiting_review_job_id"] is None


def test_review_status_no_parked_job(tmp_path) -> None:
    """awaiting_review_job_id is null when no awaiting_review job exists."""

    async def seed() -> None:
        from pd_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase

        db = SqliteDatabase(settings.derived_database_url)
        await db.initialize()
        now = datetime.now(UTC)
        project = Project(
            id="rs3",
            owner_id="default",
            name="t",
            created_at=now,
            updated_at=now,
            status=ProjectStatus.reviewing,
            page_count=2,
            proof_page_count=2,
            config=ProjectConfig(book_name="t", source_uri=""),
            pipeline_state=PipelineState(),
            storage_prefix="projects/rs3/",
        )
        await db.put_project(project)
        pages = [PageRecord(project_id="rs3", idx0=i, prefix=f"p{i}", source_stem=f"s{i}") for i in range(2)]
        await db.put_pages(pages)
        await db.close()

    settings = _settings(tmp_path)
    asyncio.run(seed())
    app = build_app(settings)

    with TestClient(app) as client:
        r = client.get("/api/data/projects/rs3/review-status")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["unreviewed_count"] == 2
        assert body["awaiting_review_job_id"] is None


def test_review_status_404_for_unknown_project(tmp_path) -> None:
    settings = _settings(tmp_path)
    app = build_app(settings)

    with TestClient(app) as client:
        r = client.get("/api/data/projects/no_such/review-status")
        assert r.status_code == 404
