"""Slice C — run_stage emits stage-status and stage-progress events.

Acceptance (from issue #66):
- A stage transition emits both `stage-status` (status change) and
  `stage-progress` events to the StageEventBroker.
- run_stage accepts an optional `stage_events` broker; when omitted it runs
  exactly as before (no regression).
- Events are keyed by `stage_events_key(project_id, page_id)`.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import cv2
import numpy as np
import pytest

from pd_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pd_prep_for_pgdp.core.pipeline.page_stage_writer import commit_stage_artifact
from pd_prep_for_pgdp.core.pipeline.stage_runner import run_stage
from pd_prep_for_pgdp.core.stage_events import StageEventBroker, stage_events_key


@pytest.fixture
async def db(tmp_path: Path) -> SqliteDatabase:
    d = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await d.initialize()
    return d


def _checkerboard_bgr_png() -> bytes:
    img = np.zeros((20, 20, 3), dtype=np.uint8)
    img[::2, ::2] = (200, 200, 200)
    img[1::2, 1::2] = (200, 200, 200)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


async def _seed_clean_parent(
    db: SqliteDatabase,
    data_root: Path,
    project_id: str,
    page_id: str,
    stage_id: str,
    payload: bytes,
) -> None:
    await db.init_page_stages_for_page(project_id, page_id)
    await commit_stage_artifact(
        data_root=data_root,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id=stage_id,
        artifact_bytes=payload,
    )


@pytest.mark.asyncio
async def test_run_stage_emits_running_and_clean_events(tmp_path: Path, db: SqliteDatabase) -> None:
    """run_stage publishes stage-status events for `running` and `clean`."""
    project_id, page_id = "p1", "0000"
    payload = _checkerboard_bgr_png()
    await _seed_clean_parent(db, tmp_path, project_id, page_id, "manual_deskew_pre", payload)

    broker = StageEventBroker()
    key = stage_events_key(project_id, page_id)
    received: list[dict] = []

    async def listen() -> None:
        async for ev in broker.subscribe(key):
            received.append(ev)
            if ev.get("status") == "clean" and ev.get("stage_id") == "grayscale":
                break

    listener = asyncio.create_task(listen())
    await asyncio.sleep(0.01)  # let listener settle

    await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="grayscale",
        stage_events=broker,
    )

    await asyncio.wait_for(listener, timeout=2.0)

    statuses = [e.get("status") for e in received if e.get("stage_id") == "grayscale"]
    assert "running" in statuses
    assert "clean" in statuses


@pytest.mark.asyncio
async def test_run_stage_emits_stage_progress_event(tmp_path: Path, db: SqliteDatabase) -> None:
    """run_stage emits a stage-progress event (not just stage-status)."""
    project_id, page_id = "p1", "0001"
    payload = _checkerboard_bgr_png()
    await _seed_clean_parent(db, tmp_path, project_id, page_id, "manual_deskew_pre", payload)

    broker = StageEventBroker()
    key = stage_events_key(project_id, page_id)
    received: list[dict] = []

    async def listen() -> None:
        async for ev in broker.subscribe(key):
            received.append(ev)
            if ev.get("type") in ("stage-status",) and ev.get("status") == "clean":
                break

    listener = asyncio.create_task(listen())
    await asyncio.sleep(0.01)

    await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="grayscale",
        stage_events=broker,
    )

    await asyncio.wait_for(listener, timeout=2.0)

    types = {e.get("type") for e in received}
    assert "stage-progress" in types, f"no stage-progress event in: {received}"


@pytest.mark.asyncio
async def test_run_stage_without_events_broker_is_unchanged(tmp_path: Path, db: SqliteDatabase) -> None:
    """run_stage with no stage_events broker still works (no regression)."""
    project_id, page_id = "p1", "0002"
    payload = _checkerboard_bgr_png()
    await _seed_clean_parent(db, tmp_path, project_id, page_id, "manual_deskew_pre", payload)

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="grayscale",
    )
    from pd_prep_for_pgdp.core.models import PageStageStatus

    assert state.status == PageStageStatus.clean
