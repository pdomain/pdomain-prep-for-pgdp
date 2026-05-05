"""Tests-first for `batch_process_pages` and `batch_ocr` job runner handlers.

Locks in:
  - `Job.payload["page_idxs"]` selects which pages get processed,
  - empty `page_idxs` defaults to "all proof-range pages",
  - dispatcher receives one BatchJobItem per page,
  - results from the dispatcher (returned via run_batch) are recorded onto the job.
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
            book_name="t",
            source_uri="",
            proof_start_idx0=0,
            proof_end_idx0=2,
        ),
        pipeline_state=PipelineState(),
        storage_prefix=f"projects/{project_id}/",
    )


class FakeBackend:
    name = "cpu"

    def __init__(self) -> None:
        self.received: list[list[BatchJobItem]] = []

    async def process_page(self, req):  # pragma: no cover - not used here
        raise NotImplementedError

    async def run_ocr(self, req):  # pragma: no cover - not used here
        raise NotImplementedError

    async def run_batch(self, items: list[BatchJobItem]) -> list[BatchJobResult]:
        self.received.append(list(items))
        return [
            BatchJobResult(
                job_type=item.job_type,
                project_id=item.project_id,
                idx0=item.idx0,
                ok=True,
                payload={"echo": True},
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
async def test_batch_process_pages_dispatches_one_item_per_page(
    db: SqliteDatabase, storage: FilesystemStorage
) -> None:
    from pd_prep_for_pgdp.core.job_runner import InProcessJobRunner

    project = _project()
    await db.put_project(project)
    pages = [
        PageRecord(
            project_id=project.id, idx0=i, prefix=f"p{i:03d}", source_stem=f"src_{i}"
        )
        for i in range(3)
    ]
    await db.put_pages(pages)

    backend = FakeBackend()
    job = Job(
        id="bp1",
        project_id=project.id,
        owner_id="default",
        type=JobType.batch_process_pages,
        status=JobStatus.queued,
        payload={"page_idxs": [0, 2]},
    )
    await db.put_job(job)

    runner = InProcessJobRunner(database=db, storage=storage, gpu=backend)  # type: ignore[arg-type]
    await runner.run_pending(max_jobs=1)

    refreshed = await db.get_job("bp1")
    assert refreshed is not None
    assert refreshed.status == JobStatus.complete
    assert refreshed.progress.total == 2
    assert refreshed.progress.current == 2

    # Backend got exactly the two requested pages.
    assert len(backend.received) == 1
    item_idxs = sorted(item.idx0 for item in backend.received[0])
    assert item_idxs == [0, 2]
    assert {item.job_type for item in backend.received[0]} == {"batch_process_pages"}


@pytest.mark.asyncio
async def test_batch_process_pages_defaults_to_full_proof_range(
    db: SqliteDatabase, storage: FilesystemStorage
) -> None:
    from pd_prep_for_pgdp.core.job_runner import InProcessJobRunner

    project = _project()
    await db.put_project(project)
    pages = [
        PageRecord(
            project_id=project.id, idx0=i, prefix=f"p{i:03d}", source_stem=f"src_{i}"
        )
        for i in range(3)
    ]
    await db.put_pages(pages)

    backend = FakeBackend()
    job = Job(
        id="bp2",
        project_id=project.id,
        owner_id="default",
        type=JobType.batch_process_pages,
        status=JobStatus.queued,
        payload={},  # no page_idxs => process all
    )
    await db.put_job(job)

    runner = InProcessJobRunner(database=db, storage=storage, gpu=backend)  # type: ignore[arg-type]
    await runner.run_pending(max_jobs=1)

    refreshed = await db.get_job("bp2")
    assert refreshed is not None
    assert refreshed.progress.total == 3
    assert sorted(item.idx0 for item in backend.received[0]) == [0, 1, 2]


@pytest.mark.asyncio
async def test_batch_ocr_dispatches_one_item_per_page(
    db: SqliteDatabase, storage: FilesystemStorage
) -> None:
    from pd_prep_for_pgdp.core.job_runner import InProcessJobRunner

    project = _project()
    await db.put_project(project)
    pages = [
        PageRecord(project_id=project.id, idx0=i, prefix=f"p{i:03d}", source_stem=f"s_{i}")
        for i in range(3)
    ]
    await db.put_pages(pages)

    backend = FakeBackend()
    job = Job(
        id="bo1",
        project_id=project.id,
        owner_id="default",
        type=JobType.batch_ocr,
        status=JobStatus.queued,
        payload={"page_idxs": [1]},
    )
    await db.put_job(job)

    runner = InProcessJobRunner(database=db, storage=storage, gpu=backend)  # type: ignore[arg-type]
    await runner.run_pending(max_jobs=1)

    refreshed = await db.get_job("bo1")
    assert refreshed is not None
    assert refreshed.status == JobStatus.complete
    assert {item.job_type for item in backend.received[0]} == {"batch_ocr"}
    assert [item.idx0 for item in backend.received[0]] == [1]
