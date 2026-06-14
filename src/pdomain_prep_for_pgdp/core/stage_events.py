"""In-memory pub/sub broker for per-page stage-status events.

Mirrors `core.job_events.JobEventBroker` but keyed by a composite
page key so the SSE handler at
`GET /api/data/projects/{id}/pages/{idx0}/events` can subscribe per page.

Use `stage_events_key(project_id, page_id)` to build the per-page key.

Use `project_page_stage_events_key(project_id)` to build the project-wide
page-stage key — subscribed by
`GET /api/data/projects/{id}/page-stages/events`. Every page-stage event is
published to **both** keys so a single project-level subscriber can receive
completions for all pages without opening N connections.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    StageEvent = dict[str, object]
else:
    StageEvent = dict[str, object]


def stage_events_key(project_id: str, page_id: str) -> str:
    """Per-page broker key: ``{project_id}:{page_id}``."""
    return f"{project_id}:{page_id}"


def project_page_stage_events_key(project_id: str) -> str:
    """Project-wide page-stage broker key: ``page-stages:{project_id}``.

    Used by the project-level page-stage SSE endpoint so a single
    EventSource subscription receives events for *all* pages in the project.
    """
    return f"page-stages:{project_id}"


class _Sentinel:
    """Marker pushed by `close()` so subscribers know the channel ended."""


_CLOSED = _Sentinel()


class StageEventBroker:
    """Per-page fan-out pub/sub without buffering.

    Events published before any subscriber is listening are dropped. New
    subscribers see only events that arrive after `subscribe()` returns.
    """

    def __init__(self) -> None:
        self._queues: dict[str, list[asyncio.Queue[StageEvent | _Sentinel]]] = defaultdict(list)
        self._lock = asyncio.Lock()

    async def publish(self, key: str, event: StageEvent) -> None:
        async with self._lock:
            queues = list(self._queues.get(key, ()))
        for q in queues:
            await q.put(event)

    async def close(self, key: str) -> None:
        """Signal every active subscriber for `key` that the channel is ending."""
        async with self._lock:
            queues = self._queues.pop(key, [])
        for q in queues:
            await q.put(_CLOSED)

    async def subscribe(self, key: str) -> AsyncIterator[StageEvent]:
        q: asyncio.Queue[StageEvent | _Sentinel] = asyncio.Queue()
        async with self._lock:
            self._queues[key].append(q)
        try:
            while True:
                event = await q.get()
                if event is _CLOSED:
                    return
                if not isinstance(event, dict):
                    continue
                yield event
        finally:
            async with self._lock:
                if q in self._queues.get(key, ()):
                    self._queues[key].remove(q)
                if not self._queues.get(key):
                    self._queues.pop(key, None)
