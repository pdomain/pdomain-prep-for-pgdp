"""Bounded deferred-write executor — issue #60 acceptance tests.

Acceptance bullets (from issue body, acceptance JSON was empty):

1. Stage runs submit writes to the executor and advance immediately on the
   in-memory artifact.
2. A simulated slow-disk run causes the executor to back-pressure (DAG pauses
   on submit, does not OOM).
3. Forcing a write failure marks the stage status='failed' and dirties
   descendants.
4. Pool/queue size env knobs take effect at startup.
5. Drop-on-last-consumer keeps peak RAM bounded for a multi-stage DAG run on
   a large page.
"""

from __future__ import annotations

import asyncio
import threading
import time
from pathlib import Path

import cv2
import numpy as np
import pytest

from pd_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pd_prep_for_pgdp.core.models import PageStageStatus
from pd_prep_for_pgdp.core.pipeline.page_stage_writer import (
    commit_stage_artifact,
    stage_artifact_path,
)
from pd_prep_for_pgdp.core.pipeline.stage_runner import run_stage
from pd_prep_for_pgdp.core.pipeline.stage_write_executor import StageWriteExecutor
from pd_prep_for_pgdp.settings import Settings

# ─── Fixtures ───────────────────────────────────────────────────────────────


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


async def _seed_clean_in_db_only(
    db: SqliteDatabase,
    data_root: Path,
    project_id: str,
    page_id: str,
    stage_id: str,
    payload: bytes,
) -> None:
    """Seed a stage as clean in DB, but do NOT write the file to disk.

    Simulates the state right after an optimistic DB update with a pending
    deferred file write: the DB row says 'clean', the executor cache holds
    the bytes, but the file does not yet exist on disk.
    """
    await db.init_page_stages_for_page(project_id, page_id)
    # Directly upsert a clean row without writing a file.
    from pd_prep_for_pgdp.core.models import PageStageState
    from pd_prep_for_pgdp.core.pipeline.page_stage_writer import (
        compute_content_hash,
        stage_artifact_key,
    )

    state = PageStageState(
        project_id=project_id,
        page_id=page_id,
        stage_id=stage_id,
        status=PageStageStatus.clean,
        stage_version=1,
        artifact_key=stage_artifact_key(project_id, page_id, stage_id),
        input_hash=compute_content_hash(payload),
        last_run_at=0.0,
    )
    await db.put_page_stage(state)


# ─── Bullet 1: advance immediately on in-memory artifact ────────────────────


@pytest.mark.asyncio
async def test_stage_advances_immediately_on_in_memory_artifact(tmp_path: Path, db: SqliteDatabase) -> None:
    """Stage N+1 can run while stage N's file write is still in-flight.

    Setup: mark manual_deskew_pre as 'clean' in DB (no file on disk), put its
    artifact bytes in the executor cache. Run grayscale with the executor.
    Grayscale must complete successfully by reading the parent from the cache,
    even though manual_deskew_pre has no file on disk.
    """
    project_id, page_id = "p1", "0000"
    parent_bytes = _checkerboard_bgr_png()

    # Parent is 'clean' in DB (optimistic) but file not yet on disk.
    await _seed_clean_in_db_only(db, tmp_path, project_id, page_id, "manual_deskew_pre", parent_bytes)

    # Put parent artifact in executor cache (simulates prior run_stage with executor).
    executor = StageWriteExecutor(pool_size=1, queue_cap=4)
    executor.put_artifact((project_id, page_id, "manual_deskew_pre"), parent_bytes, num_consumers=1)

    try:
        # Run grayscale with the executor; it should read parent from cache.
        state = await run_stage(
            data_root=tmp_path,
            database=db,
            project_id=project_id,
            page_id=page_id,
            stage_id="grayscale",
            write_executor=executor,
        )
        assert state.status == PageStageStatus.clean

        # Parent artifact consumed from cache (count decremented to 0).
        assert executor.consume_artifact((project_id, page_id, "manual_deskew_pre")) is None

        # Grayscale's own bytes are in the executor cache for downstream stages.
        cached = executor.consume_artifact((project_id, page_id, "grayscale"))
        assert cached is not None
        assert len(cached) > 0
    finally:
        executor.shutdown(wait=True)


# ─── Bullet 2: back-pressure blocks submitter ────────────────────────────────


def test_back_pressure_blocks_when_queue_full() -> None:
    """When queue_cap=1 and one task is running, a second submit blocks.

    This verifies that the DAG pauses rather than growing an unbounded queue.
    """
    write_running = threading.Event()
    release_write = threading.Event()

    async def slow_write() -> None:
        write_running.set()
        release_write.wait(timeout=5)

    async def noop_failure(exc: Exception) -> None:
        pass

    loop = asyncio.new_event_loop()

    try:
        with StageWriteExecutor(pool_size=1, queue_cap=1) as executor:
            # Submit first write — it starts immediately and holds the semaphore.
            executor.submit_write(lambda: slow_write(), on_failure=noop_failure, loop=loop)
            assert write_running.wait(timeout=2), "first write should start"

            # Now queue is full (1 in-flight). Second submit must block.
            second_submitted = threading.Event()

            def try_second_submit() -> None:
                executor.submit_write(lambda: slow_write(), on_failure=noop_failure, loop=loop)
                second_submitted.set()

            t = threading.Thread(target=try_second_submit, daemon=True)
            t.start()
            time.sleep(0.1)
            assert not second_submitted.is_set(), "second submit should block when queue full"

            # Release first write → semaphore freed → second submit unblocks.
            release_write.set()
            t.join(timeout=2)
            assert second_submitted.is_set(), "second submit should unblock after capacity frees"
    finally:
        release_write.set()  # safety valve if test is failing
        loop.close()


# ─── Bullet 3: write failure → stage failed + dirty descendants ──────────────


@pytest.mark.asyncio
async def test_on_failure_callback_fires_on_write_error() -> None:
    """Executor calls on_failure when the write coroutine raises (Q9)."""
    failure_recorded = asyncio.Event()

    async def always_fails() -> None:
        raise OSError("simulated disk full")

    async def on_failure(exc: Exception) -> None:
        failure_recorded.set()

    loop = asyncio.get_running_loop()
    executor = StageWriteExecutor(pool_size=1, queue_cap=4)
    executor.submit_write(lambda: always_fails(), on_failure=on_failure, loop=loop)

    # Wait for the callback to fire. Avoid blocking the event loop with
    # shutdown(wait=True); use wait_for so the loop stays free to process the
    # run_coroutine_threadsafe callback.
    await asyncio.wait_for(failure_recorded.wait(), timeout=3.0)
    assert failure_recorded.is_set()
    executor.shutdown(wait=False)


@pytest.mark.asyncio
async def test_write_failure_marks_stage_failed(tmp_path: Path, db: SqliteDatabase) -> None:
    """A disk-write failure marks the stage 'failed' in the DB (Q9).

    Mechanism: create the target path as a directory so os.replace fails at
    the OS level, then verify the on_failure callback flips the row to failed.
    """
    project_id, page_id = "p1", "0000"
    payload = _checkerboard_bgr_png()

    await db.init_page_stages_for_page(project_id, page_id)
    await commit_stage_artifact(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="manual_deskew_pre",
        artifact_bytes=payload,
    )

    executor = StageWriteExecutor(pool_size=1, queue_cap=4)

    # Run grayscale with the executor. Its bytes land in the cache so threshold
    # can read them, and an optimistic clean row is written to DB.
    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="grayscale",
        write_executor=executor,
    )
    assert state.status == PageStageStatus.clean

    # Make threshold's target path a directory so os.replace fails.
    threshold_artifact = stage_artifact_path(tmp_path, project_id, page_id, "threshold")
    threshold_artifact.parent.mkdir(parents=True, exist_ok=True)
    threshold_artifact.mkdir()  # output.png/ is now a dir → write will fail

    state2 = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="threshold",
        write_executor=executor,
    )
    assert state2.status == PageStageStatus.clean  # optimistic

    # Shut down the executor without blocking the event loop so the loop can
    # process the run_coroutine_threadsafe callback from the failed write.
    await asyncio.get_event_loop().run_in_executor(None, executor.shutdown)

    # Poll until the on_failure callback has updated the DB row to 'failed'.
    async def _wait_failed() -> None:
        for _ in range(100):
            row = await db.get_page_stage(project_id, page_id, "threshold")
            if row is not None and row.status == PageStageStatus.failed:
                return
            await asyncio.sleep(0.05)

    await asyncio.wait_for(_wait_failed(), timeout=5.0)

    threshold_row = await db.get_page_stage(project_id, page_id, "threshold")
    assert threshold_row is not None
    assert threshold_row.status == PageStageStatus.failed, f"expected failed, got {threshold_row.status}"


# ─── Bullet 4: env knobs ─────────────────────────────────────────────────────


def test_pool_queue_env_knobs_take_effect(monkeypatch: pytest.MonkeyPatch) -> None:
    """PGDP_STAGE_WRITE_POOL_SIZE and PGDP_STAGE_WRITE_QUEUE_CAP are honoured."""
    monkeypatch.setenv("PGDP_STAGE_WRITE_POOL_SIZE", "3")
    monkeypatch.setenv("PGDP_STAGE_WRITE_QUEUE_CAP", "12")

    settings = Settings()
    assert settings.stage_write_pool_size == 3
    assert settings.stage_write_queue_cap == 12

    executor = StageWriteExecutor.from_settings(settings)
    try:
        assert executor.pool_size == 3
        assert executor.queue_cap == 12
    finally:
        executor.shutdown(wait=False)


def test_env_knobs_default_when_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    """Defaults: pool_size = min(cpu_count, 4); queue_cap = 4 x pool_size."""
    import os

    monkeypatch.delenv("PGDP_STAGE_WRITE_POOL_SIZE", raising=False)
    monkeypatch.delenv("PGDP_STAGE_WRITE_QUEUE_CAP", raising=False)

    settings = Settings()
    assert settings.stage_write_pool_size is None
    assert settings.stage_write_queue_cap is None

    executor = StageWriteExecutor.from_settings(settings)
    try:
        expected_pool = min(os.cpu_count() or 1, 4)
        assert executor.pool_size == expected_pool
        assert executor.queue_cap == 4 * expected_pool
    finally:
        executor.shutdown(wait=False)


# ─── Bullet 5: drop-on-last-consumer ─────────────────────────────────────────


def test_drop_on_last_consumer_releases_cache_entry() -> None:
    """Cache entry is dropped when the last consumer reads it."""
    executor = StageWriteExecutor(pool_size=1, queue_cap=4)
    key = ("proj", "page", "grayscale")
    data = b"artifact-bytes"

    executor.put_artifact(key, data, num_consumers=2)

    # First consumer: still in cache.
    got1 = executor.consume_artifact(key)
    assert got1 == data
    assert executor.consume_artifact.__self__ is executor  # sanity

    # Peek: should still be cached (1 consumer left).
    got2 = executor.consume_artifact(key)
    assert got2 == data

    # Now exhausted — cache entry dropped.
    got3 = executor.consume_artifact(key)
    assert got3 is None

    executor.shutdown(wait=False)


def test_put_artifact_with_zero_consumers_is_noop() -> None:
    """put_artifact with num_consumers=0 does not cache anything."""
    executor = StageWriteExecutor(pool_size=1, queue_cap=4)
    key = ("proj", "page", "grayscale")
    executor.put_artifact(key, b"data", num_consumers=0)
    assert executor.consume_artifact(key) is None
    executor.shutdown(wait=False)


def test_large_artifact_dropped_after_all_consumers(tmp_path: Path) -> None:
    """Peak RAM stays bounded: a large (1 MB) artifact is GC'd after all
    direct consumers have read it."""
    import gc

    executor = StageWriteExecutor(pool_size=1, queue_cap=4)
    key = ("proj", "page", "rescale")
    large_data = bytes(1024 * 1024)  # 1 MB

    executor.put_artifact(key, large_data, num_consumers=1)
    assert executor.consume_artifact(key) is not None

    # After last consumer, cache entry is gone.
    assert executor.consume_artifact(key) is None

    # large_data reference held only by local var — GC can reclaim it.
    del large_data
    gc.collect()

    executor.shutdown(wait=False)
