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
from typing import TYPE_CHECKING

import cv2
import numpy as np
import pytest

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.core.pipeline.stage_runner import run_stage
from pdomain_prep_for_pgdp.core.stage_events import StageEventBroker, stage_events_key
from tests.fixtures.seed_pages import seed_v2_page_source

if TYPE_CHECKING:
    from pathlib import Path


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


async def _seed_grayscale_source(
    db: SqliteDatabase,
    data_root: Path,
    project_id: str,
    page_id: str,
    payload: bytes,
) -> None:
    """Seed a v2 source blob so `grayscale` (root page stage) can run.

    v2 ``grayscale`` reads the page's own ``source_blob_hash`` from the
    BlobStore — there is no page-scoped parent artifact to seed.
    """
    seed_v2_page_source(data_root, project_id, int(page_id), payload)
    await db.init_page_stages_for_page(project_id, page_id)


@pytest.mark.asyncio
async def test_run_stage_emits_running_and_clean_events(tmp_path: Path, db: SqliteDatabase) -> None:
    """run_stage publishes stage-status events for `running` and `clean`."""
    project_id, page_id = "p1", "0000"
    payload = _checkerboard_bgr_png()
    await _seed_grayscale_source(db, tmp_path, project_id, page_id, payload)

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
    await _seed_grayscale_source(db, tmp_path, project_id, page_id, payload)

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
    await _seed_grayscale_source(db, tmp_path, project_id, page_id, payload)

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="grayscale",
    )
    from pdomain_prep_for_pgdp.core.models import PageStageStatus

    assert state.status == PageStageStatus.clean


@pytest.mark.asyncio
async def test_run_stage_clean_event_carries_last_run_at_and_idx0(tmp_path: Path, db: SqliteDatabase) -> None:
    """I1 (PAGE_PUSH bridge): the `clean` stage-status event carries last_run_at and idx0.

    These fields are forwarded by mapPageEvent() → StagePushStatus and consumed by
    subscribePageChannelForTool() to build GrayscalePage objects with lastRunAt set.
    The test is the PRODUCER test — it verifies the event payload, not just a consumer
    that receives hand-fed synthetic events.
    """
    project_id, page_id = "bridge1", "0003"
    payload = _checkerboard_bgr_png()
    await _seed_grayscale_source(db, tmp_path, project_id, page_id, payload)

    broker = StageEventBroker()
    key = stage_events_key(project_id, page_id)
    clean_events: list[dict] = []

    async def listen() -> None:
        async for ev in broker.subscribe(key):
            if (
                ev.get("type") == "stage-status"
                and ev.get("status") == "clean"
                and ev.get("stage_id") == "grayscale"
            ):
                clean_events.append(ev)
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

    assert clean_events, "no clean stage-status event received"
    ev = clean_events[0]

    # Must carry last_run_at (epoch seconds, positive float).
    assert "last_run_at" in ev, f"last_run_at missing from clean event: {ev}"
    assert isinstance(ev["last_run_at"], float), f"last_run_at should be float, got {type(ev['last_run_at'])}"
    assert ev["last_run_at"] > 0, f"last_run_at should be positive epoch, got {ev['last_run_at']}"

    # Must carry idx0 (integer parsed from page_id "0003" → 3).
    assert "idx0" in ev, f"idx0 missing from clean event: {ev}"
    assert ev["idx0"] == 3, f"idx0 should be 3 (from page_id '0003'), got {ev['idx0']}"
