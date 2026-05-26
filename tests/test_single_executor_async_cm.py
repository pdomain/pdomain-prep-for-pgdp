"""Lock in `core.queue.single_executor.SingleExecutor` async-CM ergonomics.

Most call sites use `executor.run_drain_loop()` directly via build_app,
but the `async with SingleExecutor() as ex:` form is also supported
(used by ad-hoc scripts + future test harnesses). Locks in:
  - entering starts the drain loop,
  - submitting work resolves through the worker thread,
  - exiting cancels the drain loop and shuts down the threadpool.
"""

from __future__ import annotations

import asyncio

import pytest

from pdomain_prep_for_pgdp.core.queue.single_executor import Priority, SingleExecutor


@pytest.mark.asyncio
async def test_async_context_manager_runs_submitted_work() -> None:
    async with SingleExecutor(batch_window_s=0.01) as ex:
        # Submit a trivial CPU op; assert we get the result.
        fut = ex.submit(Priority.INTERACTIVE, lambda: 7 + 35)
        assert await asyncio.wait_for(fut, timeout=2.0) == 42

        # Errors propagate to the future.
        bad = ex.submit(Priority.INTERACTIVE, lambda: (_ for _ in ()).throw(ValueError("nope")))
        with pytest.raises(ValueError, match="nope"):
            await asyncio.wait_for(bad, timeout=2.0)


@pytest.mark.asyncio
async def test_aexit_cancels_drain_loop_cleanly() -> None:
    """The __aexit__ should cancel the drain loop without raising and
    shut down the thread pool. After exit, no more work can be done — but
    we don't assert that, just that exit doesn't deadlock or raise."""
    ex = SingleExecutor(batch_window_s=0.01)
    await ex.__aenter__()
    # Make sure the drain loop has run at least once.
    fut = ex.submit(Priority.INTERACTIVE, lambda: "ok")
    assert await asyncio.wait_for(fut, timeout=2.0) == "ok"
    # __aexit__ should return cleanly and not block.
    await asyncio.wait_for(ex.__aexit__(None, None, None), timeout=2.0)
