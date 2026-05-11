"""Lock in `dispatcher.immediate.ImmediateDispatcher` behaviour.

- `submit` runs the backend's `run_batch` synchronously and stashes results,
- `flush` drains the buffer and resets it,
- parallel submits serialize behind the lock (no result interleaving lost).
"""

from __future__ import annotations

import asyncio
import contextlib

import pytest

from pd_prep_for_pgdp.adapters.gpu.base import BatchJobItem, BatchJobResult, GPUBackend
from pd_prep_for_pgdp.dispatcher.immediate import ImmediateDispatcher


class _FakeBackend(GPUBackend):
    name = "fake"

    def __init__(self) -> None:
        self.calls: list[list[BatchJobItem]] = []

    async def process_page(self, req):  # pragma: no cover - unused
        raise NotImplementedError

    async def run_ocr(self, req):  # pragma: no cover - unused
        raise NotImplementedError

    async def run_batch(self, items: list[BatchJobItem]) -> list[BatchJobResult]:
        self.calls.append(list(items))
        return [
            BatchJobResult(
                job_type=it.job_type,
                project_id=it.project_id,
                idx0=it.idx0,
                ok=True,
                payload={"echo": it.idx0},
            )
            for it in items
        ]


def _item(idx0: int, jt: str = "batch_process_pages") -> BatchJobItem:
    return BatchJobItem(job_type=jt, project_id="p", idx0=idx0, payload={})


@pytest.mark.asyncio
async def test_submit_runs_backend_and_buffers_results() -> None:
    backend = _FakeBackend()
    d = ImmediateDispatcher(backend)
    await d.submit(_item(0))
    await d.submit(_item(1))

    assert [c[0].idx0 for c in backend.calls] == [0, 1]
    drained = await d.flush()
    assert [r.idx0 for r in drained] == [0, 1]
    assert all(r.ok for r in drained)


@pytest.mark.asyncio
async def test_flush_resets_the_buffer() -> None:
    d = ImmediateDispatcher(_FakeBackend())
    await d.submit(_item(0))
    first = await d.flush()
    second = await d.flush()
    assert len(first) == 1
    assert second == []


@pytest.mark.asyncio
async def test_concurrent_submits_serialize() -> None:
    """Parallel submits must run one-at-a-time (lock); no items dropped."""
    d = ImmediateDispatcher(_FakeBackend())
    await asyncio.gather(*(d.submit(_item(i)) for i in range(5)))
    out = await d.flush()
    assert sorted(r.idx0 for r in out) == [0, 1, 2, 3, 4]


@pytest.mark.asyncio
async def test_run_forever_is_idle_and_cancellable() -> None:
    d = ImmediateDispatcher(_FakeBackend())
    task = asyncio.create_task(d.run_forever())
    await asyncio.sleep(0.05)
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
