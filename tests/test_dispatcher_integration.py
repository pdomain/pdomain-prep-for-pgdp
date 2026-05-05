"""Tests-first for managed-mode dispatcher integration.

Behavior under test (`dispatch_interval_seconds > 0`):
  - `batch_process_pages` / `batch_ocr` jobs SUBMIT items to the
    `BatchDispatcher` instead of calling `gpu.run_batch` directly.
  - Job status becomes `scheduled` (already enforced at submit_batch_job
    time) and stays scheduled until the dispatcher flushes.
  - Calling `dispatcher.flush()` consumes the queued items, runs them via
    the GPU backend, and marks the job `complete`.
  - Per-item failures from the backend are recorded as `error_message` on
    the job; the rest of the items still complete.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from pd_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pd_prep_for_pgdp.adapters.gpu.base import (
    BatchJobItem,
    BatchJobResult,
)
from pd_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
from pd_prep_for_pgdp.core.models import (
    Job,
    JobStatus,
    JobType,
    PageRecord,
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pd_prep_for_pgdp.dispatcher.batched import BatchDispatcher


def _project(project_id: str = "p1") -> Project:
    now = datetime.now(UTC)
    return Project(
        id=project_id,
        owner_id="default",
        name="t",
        created_at=now,
        updated_at=now,
        status=ProjectStatus.processing,
        page_count=3,
        proof_page_count=3,
        config=ProjectConfig(
            book_name="t", source_uri="", proof_start_idx0=0, proof_end_idx0=2
        ),
        pipeline_state=PipelineState(),
        storage_prefix=f"projects/{project_id}/",
    )


class FakeBackend:
    name = "modal"

    def __init__(self) -> None:
        self.calls: list[list[BatchJobItem]] = []

    async def process_page(self, req):  # pragma: no cover
        raise NotImplementedError

    async def run_ocr(self, req):  # pragma: no cover
        raise NotImplementedError

    async def run_batch(self, items):
        self.calls.append(list(items))
        return [
            BatchJobResult(
                job_type=item.job_type,
                project_id=item.project_id,
                idx0=item.idx0,
                ok=True,
            )
            for item in items
        ]


@pytest.fixture
async def db(tmp_path) -> SqliteDatabase:
    d = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await d.initialize()
    return d


@pytest.fixture
def storage(tmp_path) -> FilesystemStorage:
    return FilesystemStorage(root=tmp_path / "data")


@pytest.mark.asyncio
async def test_managed_mode_enqueues_into_dispatcher_instead_of_running(
    db: SqliteDatabase, storage: FilesystemStorage
) -> None:
    """When the runner has a dispatcher, batch handlers must enqueue, not run."""
    from pd_prep_for_pgdp.core.job_runner import InProcessJobRunner

    project = _project()
    await db.put_project(project)
    await db.put_pages(
        [
            PageRecord(
                project_id=project.id, idx0=i, prefix=f"p{i:03d}", source_stem=f"s_{i}"
            )
            for i in range(3)
        ]
    )

    backend = FakeBackend()
    # Use a long interval so the auto-flush doesn't fire during the test.
    dispatcher = BatchDispatcher(backend, interval_seconds=600)  # type: ignore[arg-type]

    job = Job(
        id="bp-managed",
        project_id=project.id,
        owner_id="default",
        type=JobType.batch_process_pages,
        status=JobStatus.queued,
        payload={"page_idxs": [0, 1, 2]},
    )
    await db.put_job(job)

    runner = InProcessJobRunner(
        database=db, storage=storage, gpu=backend, dispatcher=dispatcher  # type: ignore[arg-type]
    )
    await runner.run_pending(max_jobs=1)

    # Backend was NOT called yet — items are queued.
    assert backend.calls == []

    # Job is in the scheduled state (not complete yet).
    refreshed = await db.get_job("bp-managed")
    assert refreshed is not None
    assert refreshed.status == JobStatus.scheduled

    # Manual flush: backend gets all three items in one call, job completes.
    await dispatcher.flush()
    assert len(backend.calls) == 1
    assert sorted(item.idx0 for item in backend.calls[0]) == [0, 1, 2]

    refreshed = await db.get_job("bp-managed")
    assert refreshed is not None
    assert refreshed.status == JobStatus.complete


@pytest.mark.asyncio
async def test_immediate_mode_still_runs_inline(
    db: SqliteDatabase, storage: FilesystemStorage
) -> None:
    """Without a dispatcher, the runner falls back to the inline path."""
    from pd_prep_for_pgdp.core.job_runner import InProcessJobRunner

    project = _project()
    await db.put_project(project)
    await db.put_pages(
        [PageRecord(project_id=project.id, idx0=0, prefix="p001", source_stem="s")]
    )

    backend = FakeBackend()
    job = Job(
        id="bp-immediate",
        project_id=project.id,
        owner_id="default",
        type=JobType.batch_process_pages,
        status=JobStatus.queued,
        payload={"page_idxs": [0]},
    )
    await db.put_job(job)

    runner = InProcessJobRunner(database=db, storage=storage, gpu=backend)  # type: ignore[arg-type]
    await runner.run_pending(max_jobs=1)

    # Backend ran inline.
    assert len(backend.calls) == 1
    refreshed = await db.get_job("bp-immediate")
    assert refreshed is not None
    assert refreshed.status == JobStatus.complete
