"""TDD: project_run_dirty + project_run_stage_all_pages job types (issue #67).

Acceptance:
  1. Posting project_run_dirty for N pages produces 1 parent + N child rows.
  2. JobsPage progress bar ticks from 0 to N (page count) as pages complete.
  3. Re-running already-complete project (no dirty stages) → 0 pages, no error.
  4. Filtered project_run_dirty("threshold") only runs threshold dirties.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
from pdomain_prep_for_pgdp.core.models import (
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
from tests.fixtures.seed_pages import seed_page_in_store


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
        prefix=f"p{idx0:04d}",
        source_stem=f"page_{idx0:04d}",
    )


@pytest.fixture
async def db(tmp_path) -> SqliteDatabase:
    d = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await d.initialize()
    return d


@pytest.fixture
def storage(tmp_path) -> FilesystemStorage:
    return FilesystemStorage(root=tmp_path / "data")


@pytest.mark.asyncio
async def test_project_run_dirty_parent_and_child_rows(
    db: SqliteDatabase, storage: FilesystemStorage, tmp_path
) -> None:
    """Acceptance 1 + 2: 1 parent job + N child rows; progress ticks 0 → N."""
    from pdomain_prep_for_pgdp.core.job_runner import InProcessJobRunner

    project = _project("proj1")
    await db.put_project(project)

    # Create 3 pages, each with a dirty stage row.
    for i in range(3):
        seed_page_in_store(tmp_path / "data", "proj1", _page("proj1", i))
        await db.put_page_stage(
            PageStageState(
                project_id="proj1",
                page_id=f"{i:04d}",
                stage_id="grayscale",
                status=PageStageStatus.dirty,
                stage_version=1,
            )
        )

    parent_job = Job(
        id="parent-1",
        project_id="proj1",
        owner_id="default",
        type=JobType.project_run_dirty,
        status=JobStatus.queued,
        payload={"data_root": str(tmp_path)},
    )
    await db.put_job(parent_job)

    runner = InProcessJobRunner(database=db, storage=storage, data_root=tmp_path / "data")

    with patch(
        "pdomain_prep_for_pgdp.core.pipeline.stage_runner.run_stage",
        new_callable=AsyncMock,
    ):
        await runner.run_pending(max_jobs=1)

    parent = await db.get_job("parent-1")
    assert parent is not None
    assert parent.status == JobStatus.complete
    assert parent.progress.total == 3
    assert parent.progress.current == 3

    all_jobs = await db.list_recent_jobs("default", 100)
    children = [j for j in all_jobs if j.payload.get("parent_job_id") == "parent-1"]
    assert len(children) == 3


@pytest.mark.asyncio
async def test_project_run_dirty_no_dirty_stages(
    db: SqliteDatabase, storage: FilesystemStorage, tmp_path
) -> None:
    """Acceptance 3: project with all-clean stages → 0 pages affected, no error."""
    from pdomain_prep_for_pgdp.core.job_runner import InProcessJobRunner

    project = _project("proj2")
    await db.put_project(project)

    # 2 pages, stages explicitly clean.
    for i in range(2):
        seed_page_in_store(tmp_path / "data", "proj2", _page("proj2", i))
        await db.put_page_stage(
            PageStageState(
                project_id="proj2",
                page_id=f"{i:04d}",
                stage_id="grayscale",
                status=PageStageStatus.clean,
                stage_version=1,
            )
        )

    parent_job = Job(
        id="parent-2",
        project_id="proj2",
        owner_id="default",
        type=JobType.project_run_dirty,
        status=JobStatus.queued,
        payload={"data_root": str(tmp_path)},
    )
    await db.put_job(parent_job)

    runner = InProcessJobRunner(database=db, storage=storage, data_root=tmp_path / "data")
    await runner.run_pending(max_jobs=1)

    parent = await db.get_job("parent-2")
    assert parent is not None
    assert parent.status == JobStatus.complete
    assert parent.progress.total == 0
    assert parent.progress.current == 0

    all_jobs = await db.list_recent_jobs("default", 100)
    children = [j for j in all_jobs if j.payload.get("parent_job_id") == "parent-2"]
    assert len(children) == 0


@pytest.mark.asyncio
async def test_project_run_dirty_stage_filter(
    db: SqliteDatabase, storage: FilesystemStorage, tmp_path
) -> None:
    """Acceptance 4: stage_filter restricts both page selection and stage execution."""
    from pdomain_prep_for_pgdp.core.job_runner import InProcessJobRunner

    project = _project("proj3")
    await db.put_project(project)

    # Page 0: dirty "threshold" AND dirty "grayscale".
    seed_page_in_store(tmp_path / "data", "proj3", _page("proj3", 0))
    for stage_id in ("threshold", "grayscale"):
        await db.put_page_stage(
            PageStageState(
                project_id="proj3",
                page_id="0000",
                stage_id=stage_id,
                status=PageStageStatus.dirty,
                stage_version=1,
            )
        )

    # Page 1: dirty "grayscale" only — no dirty "threshold".
    seed_page_in_store(tmp_path / "data", "proj3", _page("proj3", 1))
    await db.put_page_stage(
        PageStageState(
            project_id="proj3",
            page_id="0001",
            stage_id="grayscale",
            status=PageStageStatus.dirty,
            stage_version=1,
        )
    )

    parent_job = Job(
        id="parent-3",
        project_id="proj3",
        owner_id="default",
        type=JobType.project_run_dirty,
        status=JobStatus.queued,
        payload={"data_root": str(tmp_path), "stage_filter": "threshold"},
    )
    await db.put_job(parent_job)

    runner = InProcessJobRunner(database=db, storage=storage, data_root=tmp_path / "data")

    with patch(
        "pdomain_prep_for_pgdp.core.pipeline.stage_runner.run_stage",
        new_callable=AsyncMock,
    ) as mock_run:
        await runner.run_pending(max_jobs=1)

    parent = await db.get_job("parent-3")
    assert parent is not None
    assert parent.status == JobStatus.complete
    # Only page 0 has a dirty "threshold" stage.
    assert parent.progress.total == 1
    assert parent.progress.current == 1

    all_jobs = await db.list_recent_jobs("default", 100)
    children = [j for j in all_jobs if j.payload.get("parent_job_id") == "parent-3"]
    assert len(children) == 1

    # run_stage called exactly once (only "threshold" on page 0).
    assert mock_run.call_count == 1
    call_kwargs = mock_run.call_args.kwargs
    assert call_kwargs["stage_id"] == "threshold"
    assert call_kwargs["page_id"] == "0000"


@pytest.mark.asyncio
async def test_project_run_stage_all_pages(db: SqliteDatabase, storage: FilesystemStorage, tmp_path) -> None:
    """project_run_stage_all_pages runs one stage on every page that needs it."""
    from pdomain_prep_for_pgdp.core.job_runner import InProcessJobRunner

    project = _project("proj4")
    await db.put_project(project)

    # 2 pages, both with dirty "grayscale".
    for i in range(2):
        seed_page_in_store(tmp_path / "data", "proj4", _page("proj4", i))
        await db.put_page_stage(
            PageStageState(
                project_id="proj4",
                page_id=f"{i:04d}",
                stage_id="grayscale",
                status=PageStageStatus.dirty,
                stage_version=1,
            )
        )

    parent_job = Job(
        id="parent-4",
        project_id="proj4",
        owner_id="default",
        type=JobType.project_run_stage_all_pages,
        status=JobStatus.queued,
        payload={"data_root": str(tmp_path), "stage_id": "grayscale"},
    )
    await db.put_job(parent_job)

    runner = InProcessJobRunner(database=db, storage=storage, data_root=tmp_path / "data")

    with patch(
        "pdomain_prep_for_pgdp.core.pipeline.stage_runner.run_stage",
        new_callable=AsyncMock,
    ) as mock_run:
        await runner.run_pending(max_jobs=1)

    parent = await db.get_job("parent-4")
    assert parent is not None
    assert parent.status == JobStatus.complete
    assert parent.progress.total == 2
    assert parent.progress.current == 2

    all_jobs = await db.list_recent_jobs("default", 100)
    children = [j for j in all_jobs if j.payload.get("parent_job_id") == "parent-4"]
    assert len(children) == 2

    # run_stage called twice — once per page, for "grayscale".
    assert mock_run.call_count == 2
    called_stages = {c.kwargs["stage_id"] for c in mock_run.call_args_list}
    assert called_stages == {"grayscale"}


@pytest.mark.asyncio
async def test_project_run_dirty_stage_failure_surfaces_error(
    db: SqliteDatabase, storage: FilesystemStorage, tmp_path
) -> None:
    """Acceptance: when run_stage raises, child job lands in error and
    parent job's error_message records the failure (not silently complete)."""
    from pdomain_prep_for_pgdp.core.job_runner import InProcessJobRunner

    project = _project("proj5")
    await db.put_project(project)

    # 2 pages, both with a dirty "grayscale" stage.
    for i in range(2):
        seed_page_in_store(tmp_path / "data", "proj5", _page("proj5", i))
        await db.put_page_stage(
            PageStageState(
                project_id="proj5",
                page_id=f"{i:04d}",
                stage_id="grayscale",
                status=PageStageStatus.dirty,
                stage_version=1,
            )
        )

    parent_job = Job(
        id="parent-5",
        project_id="proj5",
        owner_id="default",
        type=JobType.project_run_dirty,
        status=JobStatus.queued,
        payload={"data_root": str(tmp_path)},
    )
    await db.put_job(parent_job)

    runner = InProcessJobRunner(database=db, storage=storage, data_root=tmp_path / "data")

    # Raise on every call so every page/stage fails.
    with patch(
        "pdomain_prep_for_pgdp.core.pipeline.stage_runner.run_stage",
        new_callable=AsyncMock,
        side_effect=RuntimeError("simulated stage failure"),
    ):
        await runner.run_pending(max_jobs=1)

    parent = await db.get_job("parent-5")
    assert parent is not None
    # Parent must NOT be complete — it had failing pages.
    assert parent.status != JobStatus.complete
    # error_message must be set and mention failures.
    assert parent.error_message is not None
    assert "pages had failures" in parent.error_message

    # Every child must be in error state.
    all_jobs = await db.list_recent_jobs("default", 100)
    children = [j for j in all_jobs if j.payload.get("parent_job_id") == "parent-5"]
    assert len(children) == 2
    for child in children:
        assert child.status == JobStatus.error
        assert child.error_message is not None
