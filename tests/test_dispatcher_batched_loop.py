"""Lock in the `run_forever` loop of `BatchDispatcher`.

The flush call is wrapped in a try/except so a transient backend
failure (network blip, GPU container restarting) doesn't kill the
dispatcher. Locks in:
  - run_forever swallows a flush exception and runs the next iteration,
  - run_forever can be cancelled cleanly between iterations.
"""

from __future__ import annotations

import asyncio
import contextlib

import pytest
from pdomain_ops.gpu import BatchJobItem, BatchJobResult, GPUBackend

from pdomain_prep_for_pgdp.dispatcher.batched import BatchDispatcher


class _OkBackend(GPUBackend):
    name = "ok"

    async def process_page(self, req):  # pragma: no cover
        raise NotImplementedError

    async def run_ocr(self, req):  # pragma: no cover
        raise NotImplementedError

    async def run_batch(self, items: list[BatchJobItem]) -> list[BatchJobResult]:
        return []


@pytest.mark.asyncio
async def test_run_forever_swallows_flush_exception() -> None:
    """A flush() raising mid-loop must not kill the run_forever task —
    it should log and continue to the next interval."""
    d = BatchDispatcher(_OkBackend(), interval_seconds=0)

    calls: dict[str, int] = {"n": 0}
    original_flush = d.flush

    async def flaky_flush() -> list[BatchJobResult]:
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("first flush boom")
        return await original_flush()

    d.flush = flaky_flush  # type: ignore[method-assign]

    task = asyncio.create_task(d.run_forever())
    # interval=0 means flush spins fast; let it run a few iterations.
    await asyncio.sleep(0.05)
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task

    # First call raised; subsequent calls must have happened anyway.
    assert calls["n"] >= 2, f"only {calls['n']} flush calls — exception killed loop"


@pytest.mark.asyncio
async def test_run_forever_is_cancellable() -> None:
    d = BatchDispatcher(_OkBackend(), interval_seconds=10)
    task = asyncio.create_task(d.run_forever())
    await asyncio.sleep(0.01)
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
