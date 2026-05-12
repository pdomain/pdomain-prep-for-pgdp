"""Tests for the awaiting_review job state on build_package jobs.

Acceptance bullets (issue #69):
  1. build_package parks in awaiting_review when any page has unreviewed text_review.
  2. Auto-resumes to complete after all pages are reviewed (~1 poll cycle).
  3. Parked job survives a server restart; new runner resumes on next clean write.
  4. Re-unreviewing a page while parked keeps the job parked (count goes back up).
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from pd_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pd_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
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


def _project(project_id: str = "p1") -> Project:
    now = datetime.now(UTC)
    return Project(
        id=project_id,
        owner_id="default",
        name="t",
        created_at=now,
        updated_at=now,
        status=ProjectStatus.ingesting,
        page_count=0,
        proof_page_count=0,
        config=ProjectConfig(book_name="t", source_uri=""),
        pipeline_state=PipelineState(),
        storage_prefix=f"projects/{project_id}/",
    )


def _page(project_id: str, idx0: int) -> PageRecord:
    return PageRecord(
        project_id=project_id,
        idx0=idx0,
        prefix=f"f{idx0:03d}",
        source_stem=f"page_{idx0:03d}",
    )


def _build_job(project_id: str = "p1", job_id: str = "j1") -> Job:
    return Job(
        id=job_id,
        project_id=project_id,
        owner_id="default",
        type=JobType.build_package,
        status=JobStatus.queued,
    )


def _stage(project_id: str, page_id: str, status: PageStageStatus) -> PageStageState:
    return PageStageState(
        project_id=project_id,
        page_id=page_id,
        stage_id="text_review",
        status=status,
    )


@pytest.fixture
async def db(tmp_path) -> SqliteDatabase:
    d = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await d.initialize()
    return d


@pytest.fixture
def storage(tmp_path) -> FilesystemStorage:
    return FilesystemStorage(root=tmp_path / "data")


async def test_awaiting_review_status_value() -> None:
    assert JobStatus.awaiting_review == "awaiting_review"
    assert JobStatus.awaiting_review.value == "awaiting_review"


async def test_build_package_parks_when_page_unreviewed(
    db: SqliteDatabase, storage: FilesystemStorage
) -> None:
    from pd_prep_for_pgdp.core.job_runner import InProcessJobRunner

    project = _project()
    await db.put_project(project)
    await db.put_page(_page(project.id, 0))
    await db.put_page_stage(_stage(project.id, "0000", PageStageStatus.not_run))

    job = _build_job(project.id)
    await db.put_job(job)

    runner = InProcessJobRunner(database=db, storage=storage)
    await runner.run_pending(max_jobs=1)

    refreshed = await db.get_job("j1")
    assert refreshed is not None
    assert refreshed.status == JobStatus.awaiting_review
    assert not await storage.exists(f"for_zip/{project.id}.zip")


async def test_build_package_parks_when_page_has_no_review_row(
    db: SqliteDatabase, storage: FilesystemStorage
) -> None:
    """A page with no text_review row at all counts as unreviewed."""
    from pd_prep_for_pgdp.core.job_runner import InProcessJobRunner

    project = _project()
    await db.put_project(project)
    await db.put_page(_page(project.id, 0))
    # No text_review stage row inserted at all

    job = _build_job(project.id)
    await db.put_job(job)

    runner = InProcessJobRunner(database=db, storage=storage)
    await runner.run_pending(max_jobs=1)

    refreshed = await db.get_job("j1")
    assert refreshed is not None
    assert refreshed.status == JobStatus.awaiting_review


async def test_build_package_proceeds_when_all_pages_reviewed(
    db: SqliteDatabase, storage: FilesystemStorage
) -> None:
    from pd_prep_for_pgdp.core.job_runner import InProcessJobRunner

    project = _project()
    await db.put_project(project)
    await db.put_page(_page(project.id, 0))
    await db.put_page_stage(_stage(project.id, "0000", PageStageStatus.clean))

    job = _build_job(project.id)
    await db.put_job(job)

    runner = InProcessJobRunner(database=db, storage=storage)
    await runner.run_pending(max_jobs=1)

    refreshed = await db.get_job("j1")
    assert refreshed is not None
    assert refreshed.status == JobStatus.complete


async def test_build_package_proceeds_with_no_pages(db: SqliteDatabase, storage: FilesystemStorage) -> None:
    """Project with zero pages has nothing to review — should proceed."""
    from pd_prep_for_pgdp.core.job_runner import InProcessJobRunner

    project = _project()
    await db.put_project(project)

    job = _build_job(project.id)
    await db.put_job(job)

    runner = InProcessJobRunner(database=db, storage=storage)
    await runner.run_pending(max_jobs=1)

    refreshed = await db.get_job("j1")
    assert refreshed is not None
    assert refreshed.status == JobStatus.complete


async def test_awaiting_review_auto_resumes_after_all_reviewed(
    db: SqliteDatabase, storage: FilesystemStorage
) -> None:
    from pd_prep_for_pgdp.core.job_runner import InProcessJobRunner

    project = _project()
    await db.put_project(project)
    await db.put_page(_page(project.id, 0))
    await db.put_page_stage(_stage(project.id, "0000", PageStageStatus.not_run))

    job = _build_job(project.id)
    await db.put_job(job)

    runner = InProcessJobRunner(database=db, storage=storage)
    await runner.run_pending(max_jobs=1)
    assert (await db.get_job("j1")).status == JobStatus.awaiting_review

    # Reviewer marks the page clean
    await db.put_page_stage(_stage(project.id, "0000", PageStageStatus.clean))

    # Next poll cycle auto-resumes and completes
    await runner.run_pending(max_jobs=1)
    refreshed = await db.get_job("j1")
    assert refreshed.status == JobStatus.complete


async def test_awaiting_review_persists_across_restart(
    db: SqliteDatabase, storage: FilesystemStorage
) -> None:
    from pd_prep_for_pgdp.core.job_runner import InProcessJobRunner

    project = _project()
    await db.put_project(project)
    await db.put_page(_page(project.id, 0))
    await db.put_page_stage(_stage(project.id, "0000", PageStageStatus.not_run))

    job = _build_job(project.id)
    await db.put_job(job)

    runner1 = InProcessJobRunner(database=db, storage=storage)
    await runner1.run_pending(max_jobs=1)
    assert (await db.get_job("j1")).status == JobStatus.awaiting_review

    # Mark the page reviewed
    await db.put_page_stage(_stage(project.id, "0000", PageStageStatus.clean))

    # Simulate server restart: new runner, no in-memory state
    runner2 = InProcessJobRunner(database=db, storage=storage)
    await runner2.run_pending(max_jobs=1)

    refreshed = await db.get_job("j1")
    assert refreshed.status == JobStatus.complete


async def test_partial_review_keeps_job_parked(db: SqliteDatabase, storage: FilesystemStorage) -> None:
    """Two pages: reviewing one is not enough; job stays parked until both clean."""
    from pd_prep_for_pgdp.core.job_runner import InProcessJobRunner

    project = _project()
    await db.put_project(project)
    await db.put_pages([_page(project.id, 0), _page(project.id, 1)])
    await db.put_page_stage(_stage(project.id, "0000", PageStageStatus.not_run))
    await db.put_page_stage(_stage(project.id, "0001", PageStageStatus.not_run))

    job = _build_job(project.id)
    await db.put_job(job)

    runner = InProcessJobRunner(database=db, storage=storage)
    await runner.run_pending(max_jobs=1)
    assert (await db.get_job("j1")).status == JobStatus.awaiting_review

    # Review only page 0
    await db.put_page_stage(_stage(project.id, "0000", PageStageStatus.clean))
    await runner.run_pending(max_jobs=1)
    assert (await db.get_job("j1")).status == JobStatus.awaiting_review

    # Review page 1 too
    await db.put_page_stage(_stage(project.id, "0001", PageStageStatus.clean))
    await runner.run_pending(max_jobs=1)
    assert (await db.get_job("j1")).status == JobStatus.complete


async def test_ignored_page_not_counted_for_review(db: SqliteDatabase, storage: FilesystemStorage) -> None:
    """Ignored pages don't need text_review; only non-ignored pages gate the job."""
    from pd_prep_for_pgdp.core.job_runner import InProcessJobRunner

    project = _project()
    await db.put_project(project)

    # One normal page (reviewed), one ignored page (unreviewed)
    normal = _page(project.id, 0)
    ignored = PageRecord(
        project_id=project.id,
        idx0=1,
        prefix="f001",
        source_stem="page_001",
        ignore=True,
    )
    await db.put_pages([normal, ignored])
    await db.put_page_stage(_stage(project.id, "0000", PageStageStatus.clean))
    # page 0001 has no review row (ignored, so shouldn't matter)

    job = _build_job(project.id)
    await db.put_job(job)

    runner = InProcessJobRunner(database=db, storage=storage)
    await runner.run_pending(max_jobs=1)

    refreshed = await db.get_job("j1")
    assert refreshed.status == JobStatus.complete
