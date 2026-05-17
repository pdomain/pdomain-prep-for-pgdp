"""Batched dispatcher — managed mode.

Queues items in memory; on each interval (or on a manual `flush()`) sends them
as one Modal invocation to amortise cold starts. Interactive requests bypass
this entirely.

Each submission carries an optional `job_id` so the dispatcher can mark the
originating job complete (or write per-page errors) once the batch returns.

See spec 09 §"The Batch Dispatcher".
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from collections.abc import Awaitable, Callable

from ..adapters.gpu import BatchJobItem, BatchJobResult, GPUBackend

log = logging.getLogger(__name__)


CompletionCallback = Callable[[str, list[BatchJobResult]], Awaitable[None]]
"""Called once per (job_id, results) tuple on each flush."""


class BatchDispatcher:
    def __init__(self, backend: GPUBackend, interval_seconds: int = 300) -> None:
        self._backend = backend
        self._interval = interval_seconds
        # Pending items grouped by job_id so we can complete jobs whose items
        # all settle in this flush window.
        self._pending: dict[str, list[BatchJobItem]] = defaultdict(list)
        self._lock = asyncio.Lock()
        self._on_complete: list[CompletionCallback] = []

    def add_completion_callback(self, cb: CompletionCallback) -> None:
        self._on_complete.append(cb)

    async def submit(self, item: BatchJobItem, *, job_id: str = "") -> None:
        async with self._lock:
            self._pending[job_id].append(item)

    async def flush(self) -> list[BatchJobResult]:
        """Drain everything currently queued and dispatch as one batch.

        Returns the merged result list (across all source jobs). Per-job
        completion callbacks fire before the merged list is returned.
        """
        async with self._lock:
            if not self._pending:
                return []
            grouped, self._pending = self._pending, defaultdict(list)

        all_items: list[tuple[str, BatchJobItem]] = []
        for job_id, items in grouped.items():
            for item in items:
                all_items.append((job_id, item))

        if not all_items:
            return []

        try:
            results = await self._backend.run_batch([item for _, item in all_items])
        except Exception as exc:
            log.exception("BatchDispatcher.flush: backend.run_batch failed")
            results = [
                BatchJobResult(
                    job_type=item.job_type,
                    project_id=item.project_id,
                    idx0=item.idx0,
                    ok=False,
                    error=f"{type(exc).__name__}: {exc}",
                    error_type=type(exc).__name__,
                )
                for _, item in all_items
            ]

        # Re-group results by job_id (preserves order within each group).
        by_job: dict[str, list[BatchJobResult]] = defaultdict(list)
        for (job_id, _), result in zip(all_items, results, strict=True):
            by_job[job_id].append(result)

        for job_id, job_results in by_job.items():
            for cb in self._on_complete:
                try:
                    await cb(job_id, job_results)
                except Exception:
                    log.exception("BatchDispatcher completion callback failed for job %s", job_id)

        return list(results)

    async def run_forever(self) -> None:
        while True:
            await asyncio.sleep(self._interval)
            try:
                await self.flush()
            except Exception:
                log.exception("BatchDispatcher.run_forever: flush failed")
