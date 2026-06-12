"""Verify the runner emits semantic event types: `progress` while running,
`complete`/`error`/`cancelled` at terminal transitions.

Locks in the contract that SSE consumers can switch on `type` instead of
parsing the `status` field.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import pytest

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
from pdomain_prep_for_pgdp.core.job_events import JobEventBroker
from pdomain_prep_for_pgdp.core.job_runner import InProcessJobRunner
from pdomain_prep_for_pgdp.core.models import (
    Job,
    JobStatus,
    JobType,
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
        storage_prefix=f"projects/{project_id}/",
    )


@pytest.mark.asyncio
async def test_runner_emits_progress_then_complete(
    db: SqliteDatabase, storage: FilesystemStorage, tmp_path
) -> None:
    """Use an empty source — unzip succeeds with 0 pages — and assert the
    sequence of event `type`s the broker received.
    """
    project = _project()
    await db.put_project(project)

    # Empty zip so ingest finishes immediately without errors.
    import io
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w"):
        pass  # empty zip
    src_key = f"projects/{project.id}/source.zip"
    await storage.put_bytes(src_key, buf.getvalue())

    job = Job(
        id="je1",
        project_id=project.id,
        owner_id="default",
        type=JobType.unzip,
        status=JobStatus.queued,
    )
    job.progress.message = src_key
    await db.put_job(job)

    events = JobEventBroker()
    received: list[dict] = []

    async def listen() -> None:
        async for ev in events.subscribe("je1"):
            received.append(ev)

    listener = asyncio.create_task(listen())
    await asyncio.sleep(0.01)

    runner = InProcessJobRunner(database=db, storage=storage, events=events, data_root=tmp_path / "data")
    await runner.run_pending(max_jobs=1)

    # Wait briefly for the broker to drain.
    await asyncio.wait_for(listener, timeout=1.0)

    types = [ev["type"] for ev in received]
    assert "progress" in types, f"expected at least one progress event; got {types}"
    assert types[-1] == "complete", f"last event should be 'complete'; got {types}"


@pytest.mark.asyncio
async def test_runner_emits_error_event_on_failure(db: SqliteDatabase, storage: FilesystemStorage) -> None:
    """A handler that throws produces an `error`-typed event."""
    from pdomain_prep_for_pgdp.core import job_runner as jr

    project = _project()
    await db.put_project(project)

    async def boom(runner, job):
        raise RuntimeError("boom from handler")

    original = jr._HANDLERS.get(JobType.unzip)
    jr._HANDLERS[JobType.unzip] = boom
    try:
        await db.put_job(
            Job(
                id="je2",
                project_id=project.id,
                owner_id="default",
                type=JobType.unzip,
                status=JobStatus.queued,
            )
        )

        events = JobEventBroker()
        received: list[dict] = []

        async def listen() -> None:
            async for ev in events.subscribe("je2"):
                received.append(ev)

        listener = asyncio.create_task(listen())
        await asyncio.sleep(0.01)

        runner = jr.InProcessJobRunner(database=db, storage=storage, events=events)
        await runner.run_pending(max_jobs=1)

        await asyncio.wait_for(listener, timeout=1.0)
        types = [ev["type"] for ev in received]
        assert types[-1] == "error", f"last event should be 'error'; got {types}"
        assert any("boom" in (ev.get("error") or "") for ev in received)
    finally:
        if original is not None:
            jr._HANDLERS[JobType.unzip] = original
