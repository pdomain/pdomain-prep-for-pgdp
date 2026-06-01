"""Lock in: the runner won't overwrite a cancelled job with complete/error.

If a user clicks Cancel after the runner has flipped a job to running but
before it finishes, `_mark_complete` / `_mark_failed` re-fetch the row and
skip the write when status is already `cancelled`. (See the
queued-cancel race memo in memory.)

This is a best-effort guard — the SQLite adapter has no compare-and-swap,
so a tight race between the cancel write and the `_mark_*` re-read could
still slip through. The guard handles the common case where cancel
arrives during handler execution.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
from pdomain_prep_for_pgdp.core.job_runner import InProcessJobRunner
from pdomain_prep_for_pgdp.core.models import (
    Job,
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


def _project() -> Project:
    now = datetime.now(UTC)
    return Project(
        id="cp1",
        owner_id="default",
        name="t",
        created_at=now,
        updated_at=now,
        status=ProjectStatus.processing,
        page_count=0,
        proof_page_count=0,
        config=ProjectConfig(book_name="t", source_uri=""),
        pipeline_state=PipelineState(),
        storage_prefix="projects/cp1/",
    )


@pytest.mark.asyncio
async def test_mark_complete_skips_already_cancelled_job(db, storage, tmp_path) -> None:
    """Simulate: user cancels DURING handler execution, then handler returns
    successfully. `_mark_complete` should leave the cancelled status alone."""
    runner = InProcessJobRunner(database=db, storage=storage, data_root=tmp_path / "data")
    job = Job(
        id="j-cmp",
        project_id="cp1",
        owner_id="default",
        type=JobType.build_package,
        status=JobStatus.running,
    )
    await db.put_project(_project())
    await db.put_job(job)

    # User clicks Cancel mid-handler; the route writes status=cancelled.
    cancelled = job.model_copy(update={"status": JobStatus.cancelled})
    await db.put_job(cancelled)

    # Now the handler returns; runner tries to mark complete.
    await runner._mark_complete(job)

    refreshed = await db.get_job("j-cmp")
    assert refreshed is not None
    assert refreshed.status == JobStatus.cancelled


@pytest.mark.asyncio
async def test_mark_failed_skips_already_cancelled_job(db, storage, tmp_path) -> None:
    """Same idea: a handler that raises after a cancel should not overwrite
    cancelled status with error."""
    runner = InProcessJobRunner(database=db, storage=storage, data_root=tmp_path / "data")
    job = Job(
        id="j-fail",
        project_id="cp1",
        owner_id="default",
        type=JobType.build_package,
        status=JobStatus.running,
    )
    await db.put_project(_project())
    await db.put_job(job)

    cancelled = job.model_copy(update={"status": JobStatus.cancelled})
    await db.put_job(cancelled)

    await runner._mark_failed(job, "handler raised after cancel")

    refreshed = await db.get_job("j-fail")
    assert refreshed is not None
    assert refreshed.status == JobStatus.cancelled
    # No error_message overlay either.
    assert refreshed.error_message is None
