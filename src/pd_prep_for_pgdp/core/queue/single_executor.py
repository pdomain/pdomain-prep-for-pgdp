"""Single-thread GPU executor with priority + a 200ms batch-collection window.

Mirrors spec 07 §"In-process queue":

  - One worker thread (the GPU isn't safe to share across threads).
  - INTERACTIVE items collected during a window are reordered to the front
    so workbench live-preview never gets stuck behind a 400-page batch.
  - All items in a window run on the same thread sequentially.

Used by the GPU backend so live-preview calls preempt batch passes.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from enum import IntEnum
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Callable

log = logging.getLogger(__name__)


class Priority(IntEnum):
    INTERACTIVE = 0  # workbench live preview / single-page OCR
    BATCH = 1  # batch jobs


class SingleExecutor:
    """Async-friendly priority executor backed by one worker thread.

    Submission returns an awaitable that resolves with the work function's
    result (or raises its exception). The caller is expected to start the
    drain loop once via `asyncio.create_task(ex.run_drain_loop())`.
    """

    def __init__(self, *, batch_window_s: float = 0.2) -> None:
        self._window_s: float = batch_window_s
        self._thread: ThreadPoolExecutor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="gpu-exec")
        self._counter: int = 0
        self._counter_lock: threading.Lock = threading.Lock()
        self._queue: asyncio.PriorityQueue[_WorkItem] | None = None
        self._drain_task: asyncio.Task[None] | None = None
        # Process exit was sometimes blocked by the worker thread waiting on a
        # cancelled future. Register an atexit hook so a missed __aexit__
        # doesn't pin the interpreter at shutdown.
        import atexit

        atexit.register(self._thread.shutdown, wait=False)

    async def __aenter__(self) -> SingleExecutor:
        self._drain_task = asyncio.create_task(self.run_drain_loop())
        return self

    async def __aexit__(self, *_: Any) -> None:
        if self._drain_task is not None:
            self._drain_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._drain_task
        self._thread.shutdown(wait=False)

    @property
    def queue(self) -> asyncio.PriorityQueue[_WorkItem]:
        # Lazy: the queue must be created on the asyncio loop that owns it.
        if self._queue is None:
            self._queue = asyncio.PriorityQueue()
        return self._queue

    def submit(self, priority: Priority, fn: Callable[..., Any], *args: Any) -> asyncio.Future[Any]:
        """Enqueue a work item; returns a future that resolves with the result.

        The priority + a monotonic counter ordering ensures we never tie-break
        on the work tuple itself (which would crash with non-comparable
        callables).
        """
        loop = asyncio.get_running_loop()
        fut = loop.create_future()
        with self._counter_lock:
            self._counter += 1
            seq = self._counter
        self.queue.put_nowait((int(priority), seq, fn, args, fut))
        return fut

    async def run_drain_loop(self) -> None:
        """Background task; runs for the lifetime of the process.

        Each iteration pulls the highest-priority item, then opens a
        `batch_window_s` window during which more items are collected. At
        end-of-window all items are sorted by priority + arrival order and
        dispatched sequentially to the worker thread.
        """
        loop = asyncio.get_running_loop()
        while True:
            first = await self.queue.get()
            items: list[_WorkItem] = [first]
            deadline = loop.time() + self._window_s
            while True:
                remaining = deadline - loop.time()
                if remaining <= 0:
                    break
                try:
                    items.append(await asyncio.wait_for(self.queue.get(), timeout=remaining))
                except TimeoutError:
                    break

            # Lexicographic sort already does (priority, seq) ordering.
            items.sort(key=lambda x: (x[0], x[1]))
            await self._dispatch(items, loop)

    async def _dispatch(
        self,
        items: list[_WorkItem],
        loop: asyncio.AbstractEventLoop,
    ) -> None:
        for _prio, _seq, fn, args, fut in items:
            try:
                result = await loop.run_in_executor(self._thread, fn, *args)
            except Exception as e:
                if not fut.done():
                    fut.set_exception(e)
            except BaseException:
                if not fut.done():
                    fut.cancel()
                raise
            else:
                if not fut.done():
                    fut.set_result(result)


type _WorkItem = tuple[int, int, "Callable[..., Any]", tuple[Any, ...], asyncio.Future[Any]]
