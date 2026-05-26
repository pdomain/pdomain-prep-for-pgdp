"""In-memory pub/sub broker for job progress events.

Replaces the polling loop in `/api/gpu/jobs/{id}/events` with push-based
delivery. The runner publishes status transitions; the SSE handler
subscribes per-request and translates events into `text/event-stream`
frames.

In multi-process or multi-instance deployments this would live in Redis
(or a SQS fan-out, etc.); for the single FastAPI process this is enough.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


class _Sentinel:
    """Marker pushed by `close()` so subscribers know the channel ended."""


_CLOSED = _Sentinel()


class JobEventBroker:
    """Per-job_id fan-out without buffering.

    Events published before any subscriber is listening are dropped. New
    subscribers see only events that arrive after `subscribe()` returns.
    """

    def __init__(self) -> None:
        self._queues: dict[str, list[asyncio.Queue[Any]]] = defaultdict(list)
        self._lock = asyncio.Lock()

    async def publish(self, job_id: str, event: dict[str, Any]) -> None:
        async with self._lock:
            queues = list(self._queues.get(job_id, ()))
        for q in queues:
            await q.put(event)

    async def close(self, job_id: str) -> None:
        """Tell every active subscriber for `job_id` that the channel is ending."""
        async with self._lock:
            queues = self._queues.pop(job_id, [])
        for q in queues:
            await q.put(_CLOSED)

    async def subscribe(self, job_id: str) -> AsyncIterator[dict[str, Any]]:
        q: asyncio.Queue[Any] = asyncio.Queue()
        async with self._lock:
            self._queues[job_id].append(q)
        try:
            while True:
                event = await q.get()
                if event is _CLOSED:
                    return
                yield event
        finally:
            async with self._lock:
                if q in self._queues.get(job_id, ()):
                    self._queues[job_id].remove(q)
                if not self._queues.get(job_id):
                    self._queues.pop(job_id, None)
