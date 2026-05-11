"""Tests-first for `core.queue.single_executor`.

Behavior under test (per spec 07 §"In-process queue"):
  - INTERACTIVE items are reordered ahead of any BATCH items collected in
    the 200ms batch-collection window.
  - The work function runs serialised on a single thread (the GPU isn't
    safe to share across threads) — verified by checking that two
    concurrent tasks don't run at the same time.
  - Submission returns a future-like awaitable that resolves with the
    work function's result.
  - Cancelling the drain loop cleanly drops pending items.
"""

from __future__ import annotations

import asyncio
import contextlib
import time
from typing import Any

import pytest


@pytest.mark.asyncio
async def test_interactive_preempts_batch_in_window() -> None:
    """Multiple BATCH items + an INTERACTIVE item submitted in the same
    window: the INTERACTIVE item should run first.
    """
    from pd_prep_for_pgdp.core.queue.single_executor import Priority, SingleExecutor

    order: list[str] = []

    def work(label: str) -> str:
        order.append(label)
        return label

    ex = SingleExecutor(batch_window_s=0.05)
    drain = asyncio.create_task(ex.run_drain_loop())

    # Submit a few BATCH items first; INTERACTIVE arrives while window is open.
    f1 = ex.submit(Priority.BATCH, work, "b1")
    f2 = ex.submit(Priority.BATCH, work, "b2")
    f3 = ex.submit(Priority.INTERACTIVE, work, "i1")
    f4 = ex.submit(Priority.BATCH, work, "b3")

    await asyncio.gather(f1, f2, f3, f4)

    assert order[0] == "i1", f"INTERACTIVE should run first; got {order}"
    drain.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await drain


@pytest.mark.asyncio
async def test_work_runs_serialised() -> None:
    """Two long-running submissions never overlap (single-thread executor)."""
    from pd_prep_for_pgdp.core.queue.single_executor import Priority, SingleExecutor

    ex = SingleExecutor(batch_window_s=0.01)
    drain = asyncio.create_task(ex.run_drain_loop())

    inflight = 0
    max_concurrent = 0

    def work(_label: str) -> str:
        nonlocal inflight, max_concurrent
        # Approximate concurrency detection: sleep + counter. Concurrent
        # execution would push max_concurrent above 1.
        inflight = inflight + 1
        max_concurrent = max(max_concurrent, inflight)
        time.sleep(0.05)
        inflight -= 1
        return "ok"

    futures = [ex.submit(Priority.BATCH, work, str(i)) for i in range(4)]
    await asyncio.gather(*futures)

    assert max_concurrent == 1, f"saw {max_concurrent} concurrent tasks; expected 1"
    drain.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await drain


@pytest.mark.asyncio
async def test_submit_returns_work_result() -> None:
    """Awaiting the future yields the work function's return value."""
    from pd_prep_for_pgdp.core.queue.single_executor import Priority, SingleExecutor

    def work(x: int, y: int) -> int:
        return x + y

    ex = SingleExecutor(batch_window_s=0.01)
    drain = asyncio.create_task(ex.run_drain_loop())

    result = await ex.submit(Priority.INTERACTIVE, work, 2, 3)
    assert result == 5

    drain.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await drain


@pytest.mark.asyncio
async def test_work_exception_propagates_to_caller() -> None:
    from pd_prep_for_pgdp.core.queue.single_executor import Priority, SingleExecutor

    def boom(_: Any) -> None:
        raise RuntimeError("expected")

    ex = SingleExecutor(batch_window_s=0.01)
    drain = asyncio.create_task(ex.run_drain_loop())

    with pytest.raises(RuntimeError, match="expected"):
        await ex.submit(Priority.BATCH, boom, "x")

    drain.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await drain


@pytest.mark.asyncio
async def test_drain_loop_cancellation_is_clean() -> None:
    from pd_prep_for_pgdp.core.queue.single_executor import SingleExecutor

    ex = SingleExecutor()
    drain = asyncio.create_task(ex.run_drain_loop())
    await asyncio.sleep(0.05)
    drain.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await drain
    # No assertion beyond "did not deadlock or raise unexpectedly".
