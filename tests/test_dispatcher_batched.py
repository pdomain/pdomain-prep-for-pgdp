"""Lock in `dispatcher.batched.BatchDispatcher` edge cases.

Locks in:
  - flushing an empty queue returns [],
  - submit groups items by job_id internally (verified via the completion
    callback fan-out),
  - if `backend.run_batch` raises, every item gets a per-item error result
    (so the originating job sees ok=False rather than an unhandled crash),
  - completion callbacks run for every job_id in the flush, even if one of
    them raises (failure is logged, not propagated).
"""

from __future__ import annotations

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


class _BoomBackend(GPUBackend):
    name = "boom"

    async def process_page(self, req):  # pragma: no cover
        raise NotImplementedError

    async def run_ocr(self, req):  # pragma: no cover
        raise NotImplementedError

    async def run_batch(self, items: list[BatchJobItem]) -> list[BatchJobResult]:
        raise RuntimeError("backend exploded")


def _item(idx0: int) -> BatchJobItem:
    return BatchJobItem(job_type="batch_process_pages", project_id="p", idx0=idx0, payload={})


@pytest.mark.asyncio
async def test_empty_flush_returns_empty_list() -> None:
    d = BatchDispatcher(_OkBackend(), interval_seconds=0)
    assert await d.flush() == []


@pytest.mark.asyncio
async def test_flush_dispatches_grouped_items_to_callbacks() -> None:
    """submit(item, job_id="A") and submit(..., job_id="B") result in two
    completion callbacks, one per job_id, with the right items."""
    d = BatchDispatcher(_OkBackend(), interval_seconds=0)
    seen: dict[str, list[int]] = {}

    async def on_complete(job_id: str, results: list[BatchJobResult]) -> None:
        seen[job_id] = [r.idx0 for r in results]

    d.add_completion_callback(on_complete)
    await d.submit(_item(0), job_id="A")
    await d.submit(_item(1), job_id="A")
    await d.submit(_item(2), job_id="B")
    merged = await d.flush()

    assert sorted(seen.keys()) == ["A", "B"]
    assert seen["A"] == [0, 1]
    assert seen["B"] == [2]
    assert {r.idx0 for r in merged} == {0, 1, 2}


@pytest.mark.asyncio
async def test_backend_failure_marks_every_item_failed() -> None:
    """If the backend's run_batch raises, the dispatcher must convert it into
    per-item BatchJobResult(ok=False) so the calling job sees an error
    instead of an unhandled crash."""
    d = BatchDispatcher(_BoomBackend(), interval_seconds=0)
    received: list[BatchJobResult] = []

    async def on_complete(job_id: str, results: list[BatchJobResult]) -> None:
        received.extend(results)

    d.add_completion_callback(on_complete)
    await d.submit(_item(0), job_id="J")
    await d.submit(_item(1), job_id="J")
    out = await d.flush()

    assert len(out) == 2
    for r in out:
        assert r.ok is False
        assert r.error
        assert "RuntimeError" in r.error
    assert {r.idx0 for r in received} == {0, 1}


@pytest.mark.asyncio
async def test_batch_job_result_error_type_set_on_backend_failure() -> None:
    """When backend.run_batch raises, every failed BatchJobResult must have
    error_type set to the exception class name (for structured error handling
    downstream)."""
    d = BatchDispatcher(_BoomBackend(), interval_seconds=0)
    received: list[BatchJobResult] = []

    async def on_complete(job_id: str, results: list[BatchJobResult]) -> None:
        received.extend(results)

    d.add_completion_callback(on_complete)
    await d.submit(_item(0), job_id="J")
    out = await d.flush()

    assert len(out) == 1
    r = out[0]
    assert r.ok is False
    assert r.error_type == "RuntimeError"
    assert r.error is not None
    assert "RuntimeError" in r.error


@pytest.mark.asyncio
async def test_completion_callback_errors_are_isolated() -> None:
    """One bad callback should not stop the others or break the flush."""
    d = BatchDispatcher(_OkBackend(), interval_seconds=0)
    other_ran = False

    async def boom(job_id: str, results: list[BatchJobResult]) -> None:
        raise RuntimeError("callback explosion")

    async def good(job_id: str, results: list[BatchJobResult]) -> None:
        nonlocal other_ran
        other_ran = True

    d.add_completion_callback(boom)
    d.add_completion_callback(good)
    await d.submit(_item(0), job_id="J")

    # Should NOT raise — callbacks are wrapped in a try/except.
    out = await d.flush()
    assert len(out) == 1
    assert other_ran is True
