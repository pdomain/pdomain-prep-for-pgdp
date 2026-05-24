"""Defence-in-depth: _handle_unzip must reject cross-project source_key.

Issue #127 slice 2.

Even if a job was enqueued via a path that bypasses the API route (e.g. a
direct DB write, a migration script, or a test helper), the runner handler
itself must validate that the source_key is scoped to the job's project before
calling storage. This prevents a job record from being used as a
cross-project data-exfiltration primitive if the API-layer check were
somehow bypassed.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from pd_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pd_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
from pd_prep_for_pgdp.core.job_runner import InProcessJobRunner
from pd_prep_for_pgdp.core.models import (
    Job,
    JobProgress,
    JobStatus,
    JobType,
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


@pytest.fixture
async def db(tmp_path) -> SqliteDatabase:
    d = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await d.initialize()
    return d


@pytest.fixture
def storage(tmp_path) -> FilesystemStorage:
    return FilesystemStorage(root=tmp_path / "data")


@pytest.mark.asyncio
async def test_handle_unzip_rejects_cross_project_source_key(
    db: SqliteDatabase, storage: FilesystemStorage
) -> None:
    """_handle_unzip must raise ValueError before touching storage when the
    source_key escapes the job's project prefix.

    The runner records the error as JobStatus.error; storage is never read.
    """
    project = _project("victim-project")
    await db.put_project(project)

    job = Job(
        id="j-cross",
        project_id="victim-project",
        owner_id="default",
        type=JobType.unzip,
        status=JobStatus.queued,
        created_at=datetime.now(UTC),
        # Attacker submits another project's source key directly into the DB.
        progress=JobProgress(message="projects/attacker-project/uploads/stolen.zip"),
    )
    await db.put_job(job)

    runner = InProcessJobRunner(database=db, storage=storage, poll_interval=0)
    await runner.run_pending(max_jobs=1)

    # The runner records the ValueError as a job error rather than crashing.
    refreshed = await db.get_job("j-cross")
    assert refreshed is not None
    assert refreshed.status == JobStatus.error
    # Before the fix, the error comes from a storage read failure (FileNotFoundError);
    # after the fix, it must come from the prefix check before touching storage.
    assert refreshed.error_message
    assert "escapes project prefix" in refreshed.error_message


@pytest.mark.asyncio
async def test_handle_unzip_accepts_own_project_source_key(
    db: SqliteDatabase, storage: FilesystemStorage
) -> None:
    """A job whose source_key is properly scoped to its project must not be
    rejected by the defence-in-depth check.

    The job will eventually fail because the zip doesn't actually exist in
    storage (FileNotFoundError from storage.get_bytes), but that failure must
    happen AFTER the prefix check passes — i.e. error_message must reflect a
    storage/IO error, not a prefix-validation error.
    """
    project = _project("own-project")
    await db.put_project(project)

    job = Job(
        id="j-own",
        project_id="own-project",
        owner_id="default",
        type=JobType.unzip,
        status=JobStatus.queued,
        created_at=datetime.now(UTC),
        progress=JobProgress(message="projects/own-project/uploads/book.zip"),
    )
    await db.put_job(job)

    runner = InProcessJobRunner(database=db, storage=storage, poll_interval=0)
    await runner.run_pending(max_jobs=1)

    refreshed = await db.get_job("j-own")
    assert refreshed is not None
    # Job fails (zip not present), but NOT because of a prefix-validation error.
    assert refreshed.status == JobStatus.error
    assert refreshed.error_message
    # The error must not mention "escapes project prefix" — that would mean the
    # defence-in-depth check rejected a valid key.
    assert "escapes project prefix" not in refreshed.error_message
