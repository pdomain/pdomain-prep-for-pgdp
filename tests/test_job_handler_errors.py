"""Lock in the missing-project + missing-source error paths for each
job-runner handler.

Each handler should raise a clear FileNotFoundError / ValueError when the
referenced project or source is missing — that surfaces to `_run_one` as
JobStatus.error with the exception message recorded.

Locks in:
  - unzip handler raises FileNotFoundError when the project is gone,
  - unzip handler raises ValueError when source_key is empty,
  - thumbnails handler raises FileNotFoundError when project is gone,
  - build_package handler raises FileNotFoundError when project is gone,
  - run_pending wraps each as JobStatus.error so the job table reflects it.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
from pdomain_prep_for_pgdp.core.job_runner import (
    InProcessJobRunner,
    _handle_build_package,
    _handle_thumbnails,
    _handle_unzip,
)
from pdomain_prep_for_pgdp.core.models import (
    Job,
    JobProgress,
    JobStatus,
    JobType,
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)


@pytest.fixture
async def db(tmp_path) -> SqliteDatabase:
    d = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await d.initialize()
    return d


@pytest.fixture
def storage(tmp_path) -> FilesystemStorage:
    return FilesystemStorage(root=tmp_path / "data")


def _job(jt: JobType, project_id: str = "missing", source_key: str = "") -> Job:
    return Job(
        id="j",
        project_id=project_id,
        owner_id="default",
        type=jt,
        status=JobStatus.queued,
        progress=JobProgress(message=source_key),
    )


@pytest.fixture
async def project_p(db: SqliteDatabase) -> str:
    """Inserts a real project so we can test the source_key=empty branch."""
    now = datetime.now(UTC)
    await db.put_project(
        Project(
            id="p1",
            owner_id="default",
            name="t",
            created_at=now,
            updated_at=now,
            status=ProjectStatus.ingesting,
            page_count=0,
            proof_page_count=0,
            config=ProjectConfig(book_name="t", source_uri=""),
            pipeline_state=PipelineState(),
            storage_prefix="projects/p1/",
        )
    )
    return "p1"


# ─── direct handler error paths ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_unzip_missing_project_raises(db, storage) -> None:
    runner = InProcessJobRunner(database=db, storage=storage)
    job = _job(JobType.unzip, project_id="ghost", source_key="x.zip")
    await db.put_job(job)
    with pytest.raises(FileNotFoundError, match="ghost"):
        await _handle_unzip(runner, job)


@pytest.mark.asyncio
async def test_unzip_missing_source_key_raises(db, storage, project_p) -> None:
    runner = InProcessJobRunner(database=db, storage=storage)
    job = _job(JobType.unzip, project_id=project_p, source_key="")
    await db.put_job(job)
    with pytest.raises(ValueError, match="missing source_key"):
        await _handle_unzip(runner, job)


@pytest.mark.asyncio
async def test_thumbnails_missing_project_raises(db, storage) -> None:
    runner = InProcessJobRunner(database=db, storage=storage)
    job = _job(JobType.thumbnails, project_id="ghost")
    await db.put_job(job)
    with pytest.raises(FileNotFoundError, match="ghost"):
        await _handle_thumbnails(runner, job)


@pytest.mark.asyncio
async def test_build_package_missing_project_raises(db, storage) -> None:
    runner = InProcessJobRunner(database=db, storage=storage)
    job = _job(JobType.build_package, project_id="ghost")
    await db.put_job(job)
    with pytest.raises(FileNotFoundError, match="ghost"):
        await _handle_build_package(runner, job)


# ─── runner integration: handler error → JobStatus.error ───────────────────


@pytest.mark.asyncio
async def test_runner_records_handler_failure_as_job_error(db, storage) -> None:
    """End-to-end: enqueue a build_package job for a missing project and
    let `run_pending` execute it. The job should land in JobStatus.error
    with the exception message persisted."""
    runner = InProcessJobRunner(database=db, storage=storage)
    job = _job(JobType.build_package, project_id="vanished")
    await db.put_job(job)

    await runner.run_pending(max_jobs=1)

    refreshed = await db.get_job("j")
    assert refreshed is not None
    assert refreshed.status == JobStatus.error
    assert "vanished" in (refreshed.error_message or "")
