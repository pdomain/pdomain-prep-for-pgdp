"""Tests-first for the in-process job runner.

The runner picks up `queued` jobs from `IDatabase` and executes them. Locks in:
  - polls and transitions: queued -> running -> complete,
  - records errors as `error` status with a message,
  - unzip jobs invoke `core.ingest.unzip_source` correctly and chain a
    follow-up `thumbnails` job when pages were created,
  - pages are written when unzip completes.
"""

from __future__ import annotations

import asyncio
import contextlib
import io
import zipfile
from datetime import UTC, datetime

import numpy as np
import pytest

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
from pdomain_prep_for_pgdp.core.models import (
    Job,
    JobStatus,
    JobType,
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)


def _png(h: int, w: int) -> bytes:
    cv2 = pytest.importorskip("cv2")
    img = np.full((h, w, 3), 200, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


def _make_zip(entries: list[tuple[str, bytes]]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries:
            zf.writestr(name, data)
    return buf.getvalue()


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
async def test_runner_executes_queued_unzip_job(db: SqliteDatabase, storage: FilesystemStorage) -> None:
    from pdomain_prep_for_pgdp.core.job_runner import InProcessJobRunner

    project = _project()
    await db.put_project(project)
    src_key = f"projects/{project.id}/source.zip"
    await storage.put_bytes(src_key, _make_zip([("a.png", _png(50, 50)), ("b.png", _png(50, 50))]))

    job = Job(
        id="j1",
        project_id=project.id,
        owner_id="default",
        type=JobType.unzip,
        status=JobStatus.queued,
    )
    job.progress.message = src_key  # encode source_key into the job for now
    await db.put_job(job)

    runner = InProcessJobRunner(database=db, storage=storage, poll_interval=0.05)
    # Unzip handler enqueues a thumbnails job; let the runner pick that up too.
    await runner.run_pending(max_jobs=4)

    refreshed = await db.get_job("j1")
    assert refreshed is not None
    assert refreshed.status == JobStatus.complete
    assert refreshed.completed_at is not None
    assert refreshed.progress.total == 2
    assert refreshed.progress.current == 2

    _, _, total = await db.list_pages(project.id, None, 100)
    assert total == 2

    # Unzip should have queued a follow-up thumbnails job for the project.
    follow_ups = await db.list_recent_jobs("default", 10)
    thumb_jobs = [j for j in follow_ups if j.type == JobType.thumbnails]
    assert len(thumb_jobs) == 1
    assert thumb_jobs[0].project_id == project.id


@pytest.mark.asyncio
async def test_runner_records_error_on_failure(db: SqliteDatabase, storage: FilesystemStorage) -> None:
    from pdomain_prep_for_pgdp.core.job_runner import InProcessJobRunner

    project = _project()
    await db.put_project(project)

    # Source zip never uploaded → storage.get_bytes will fail.
    job = Job(
        id="j2",
        project_id=project.id,
        owner_id="default",
        type=JobType.unzip,
        status=JobStatus.queued,
    )
    job.progress.message = f"projects/{project.id}/missing.zip"
    await db.put_job(job)

    runner = InProcessJobRunner(database=db, storage=storage, poll_interval=0.05)
    await runner.run_pending(max_jobs=1)

    refreshed = await db.get_job("j2")
    assert refreshed is not None
    assert refreshed.status == JobStatus.error
    assert refreshed.error_message  # non-empty


@pytest.mark.asyncio
async def test_runner_skips_non_queued_jobs(db: SqliteDatabase, storage: FilesystemStorage) -> None:
    from pdomain_prep_for_pgdp.core.job_runner import InProcessJobRunner

    project = _project()
    await db.put_project(project)
    job = Job(
        id="j3",
        project_id=project.id,
        owner_id="default",
        type=JobType.unzip,
        status=JobStatus.complete,
    )
    await db.put_job(job)

    runner = InProcessJobRunner(database=db, storage=storage, poll_interval=0.05)
    n = await runner.run_pending(max_jobs=1)
    assert n == 0


@pytest.mark.asyncio
async def test_runner_loop_can_be_cancelled(db: SqliteDatabase, storage: FilesystemStorage) -> None:
    from pdomain_prep_for_pgdp.core.job_runner import InProcessJobRunner

    runner = InProcessJobRunner(database=db, storage=storage, poll_interval=0.05)
    task = asyncio.create_task(runner.run_forever())
    await asyncio.sleep(0.15)
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
    # No assertion beyond "did not deadlock".


# ─── Issue #126 Slice 2: handler hardening ────────────────────────────────────


@pytest.mark.asyncio
async def test_handle_run_page_stage_uses_job_project_id_not_payload(
    db: SqliteDatabase, storage: FilesystemStorage, tmp_path
) -> None:
    """_handle_run_page_stage must use job.project_id (DB row) even if
    payload contains a different project_id.  This is defence-in-depth:
    the retry route's allowlist already blocks project_id overrides, but
    the handler must be self-hardened too.

    We verify by seeding project 'real-project', constructing a run_page_stage
    job whose payload carries project_id='evil-project', and confirming the
    handler raises an error about 'evil-project' NOT being found — which means
    it used job.project_id ('real-project') and ignored payload['project_id'].
    Actually, the hardened handler ignores payload['project_id'] entirely and
    uses job.project_id directly, so the run_stage call uses the correct
    project. We confirm no mis-routing by checking the job used real-project.
    """
    from unittest.mock import patch

    from pdomain_prep_for_pgdp.core.job_runner import InProcessJobRunner

    project = _project("real-project")
    await db.put_project(project)

    job = Job(
        id="j-hardened",
        project_id="real-project",  # authoritative project binding
        owner_id="default",
        type=JobType.run_page_stage,
        status=JobStatus.queued,
        payload={
            "project_id": "evil-project",  # attacker-injected — must be ignored
            "page_id": "0000",
            "stage_id": "process_page",
            "device": "cpu",
            "data_root": "/attacker/path",  # must also be ignored
        },
    )
    await db.put_job(job)

    calls: list[dict[str, object]] = []

    async def fake_run_stage(**kwargs: object) -> None:
        calls.append(dict(kwargs))

    runner = InProcessJobRunner(
        database=db,
        storage=storage,
        data_root=tmp_path / "runner-data",
        poll_interval=0.05,
    )

    with patch("pdomain_prep_for_pgdp.core.pipeline.stage_runner.run_stage", new=fake_run_stage):
        await runner.run_pending(max_jobs=1)

    # The handler must have called run_stage with the runner's data_root,
    # not /attacker/path from the payload.
    assert len(calls) == 1, f"run_stage call count mismatch: {calls}"
    call = calls[0]
    # project_id must be 'real-project' (job.project_id), not 'evil-project'.
    assert call["project_id"] == "real-project", f"wrong project_id: {call['project_id']!r}"
    # data_root must be the runner's data_root, not the payload's.

    assert call["data_root"] == tmp_path / "runner-data", f"wrong data_root: {call['data_root']!r}"


@pytest.mark.asyncio
async def test_run_page_stage_handler_data_root_from_runner_not_payload(
    db: SqliteDatabase, storage: FilesystemStorage, tmp_path
) -> None:
    """Even when payload has no data_root key at all, the handler must use
    runner._data_root without raising a KeyError.
    """
    from unittest.mock import patch

    from pdomain_prep_for_pgdp.core.job_runner import InProcessJobRunner

    project = _project("p2")
    await db.put_project(project)

    job = Job(
        id="j-no-data-root",
        project_id="p2",
        owner_id="default",
        type=JobType.run_page_stage,
        status=JobStatus.queued,
        payload={
            # data_root intentionally absent — handler must not KeyError
            "page_id": "0000",
            "stage_id": "process_page",
            "device": "cpu",
        },
    )
    await db.put_job(job)

    calls: list[dict[str, object]] = []

    async def fake_run_stage(**kwargs: object) -> None:
        calls.append(dict(kwargs))

    runner = InProcessJobRunner(
        database=db,
        storage=storage,
        data_root=tmp_path / "safe-data",
        poll_interval=0.05,
    )

    with patch("pdomain_prep_for_pgdp.core.pipeline.stage_runner.run_stage", new=fake_run_stage):
        await runner.run_pending(max_jobs=1)

    assert len(calls) == 1

    assert calls[0]["data_root"] == tmp_path / "safe-data"
