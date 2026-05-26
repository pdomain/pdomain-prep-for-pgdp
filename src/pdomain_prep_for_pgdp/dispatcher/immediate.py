"""Immediate dispatcher — local/self-hosted modes.

Submitted batch items run on the GPU backend straight away. `run_forever()`
is a no-op since there is no scheduled flush.
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pdomain_prep_for_pgdp.adapters.gpu import BatchJobItem, BatchJobResult, GPUBackend


class ImmediateDispatcher:
    def __init__(self, backend: GPUBackend) -> None:
        self._backend = backend
        self._lock = asyncio.Lock()
        self._results: list[BatchJobResult] = []

    async def submit(self, item: BatchJobItem, *, job_id: str = "") -> None:
        async with self._lock:
            r = await self._backend.run_batch([item])
            self._results.extend(r)

    async def flush(self) -> list[BatchJobResult]:
        async with self._lock:
            out, self._results = self._results, []
            return out

    async def run_forever(self) -> None:
        # Immediate dispatcher has no scheduled work; sleep forever so callers
        # can `asyncio.create_task(dispatcher.run_forever())` uniformly.
        while True:
            await asyncio.sleep(3600)
