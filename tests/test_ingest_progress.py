"""Test that the unzip stage streams per-page progress through the JobEventBroker.

Locks in: a 3-page zip produces at least 3 progress events (one per page)
during unzip, each with `total=3` and a monotonically increasing `current`.
The terminal event for the unzip job remains `complete`. (A follow-up
thumbnails job is enqueued by the handler but is its own job_id with its
own event stream — not under test here.)
"""

from __future__ import annotations

import asyncio
import io
import zipfile
from datetime import UTC, datetime

import numpy as np
import pytest

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
from pdomain_prep_for_pgdp.core.job_events import JobEventBroker
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


def _png(h: int, w: int) -> bytes:
    cv2 = pytest.importorskip("cv2")
    img = np.full((h, w, 3), 200, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


def _zip(entries: list[tuple[str, bytes]]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for n, d in entries:
            zf.writestr(n, d)
    return buf.getvalue()


@pytest.fixture
async def db(tmp_path) -> SqliteDatabase:
    d = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await d.initialize()
    return d


@pytest.fixture
def storage(tmp_path) -> FilesystemStorage:
    return FilesystemStorage(root=tmp_path / "data")


@pytest.mark.asyncio
async def test_unzip_emits_per_page_progress_events(
    db: SqliteDatabase, storage: FilesystemStorage, tmp_path
) -> None:
    pytest.importorskip("cv2")
    now = datetime.now(UTC)
    project = Project(
        id="ip1",
        owner_id="default",
        name="t",
        created_at=now,
        updated_at=now,
        status=ProjectStatus.ingesting,
        page_count=0,
        proof_page_count=0,
        config=ProjectConfig(book_name="t", source_uri=""),
        pipeline_state=PipelineState(),
        storage_prefix="projects/ip1/",
    )
    await db.put_project(project)
    src_key = "projects/ip1/source.zip"
    await storage.put_bytes(
        src_key,
        _zip([("p1.png", _png(50, 50)), ("p2.png", _png(50, 50)), ("p3.png", _png(50, 50))]),
    )

    job = Job(
        id="ip-job",
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
        async for ev in events.subscribe("ip-job"):
            received.append(ev)

    listener = asyncio.create_task(listen())
    await asyncio.sleep(0.01)

    runner = InProcessJobRunner(database=db, storage=storage, events=events, data_root=tmp_path / "data")
    await runner.run_pending(max_jobs=1)
    await asyncio.wait_for(listener, timeout=2.0)

    progress_events = [e for e in received if e["type"] == "progress"]
    # At least one event per page (plus the running-state and final-summary
    # transitions). Each has total==3 once the per-page reporting kicks in.
    per_page = [e for e in progress_events if e.get("total") == 3]
    assert len(per_page) >= 3, f"expected ≥3 per-page progress events; got {received}"

    currents = [e["current"] for e in per_page]
    # Currents should be non-decreasing (monotonic).
    assert currents == sorted(currents), f"non-monotonic: {currents}"
    assert max(currents) == 3
    # Terminal event is `complete`.
    assert received[-1]["type"] == "complete"
