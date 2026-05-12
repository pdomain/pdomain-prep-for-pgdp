"""Bounded deferred-write executor for stage artifacts (Q8/Q9).

Spec: `docs/specs/pipeline-task-model.md`
§"Memory-resident execution model > Deferred disk writes" (locked 2026-05-07).

Design:

- A ``ThreadPoolExecutor`` (pool_size workers) does the actual disk writes.
- A ``threading.BoundedSemaphore`` (queue_cap) limits total outstanding tasks
  (running + queued). When at capacity, :meth:`submit_write` blocks the
  caller — intentional back-pressure (Q8). The alternative is unbounded RAM
  growth from an unbounded in-flight write set.
- An in-memory artifact cache holds stage output bytes keyed by
  ``(project_id, page_id, stage_id)`` until all direct DAG consumers have
  read them (drop-on-last-consumer). This lets downstream stages advance on
  the in-memory copy without waiting for the disk write to complete.
- Write failures are surfaced via an async ``on_failure`` callback scheduled
  on the caller's event loop via :func:`asyncio.run_coroutine_threadsafe`.
  The callback marks the stage ``failed`` and propagates dirty to descendants
  (Q9 -- fail loudly).

Configuration:

- ``pool_size``: thread count. Default ``min(cpu_count, 4)``.
- ``queue_cap``: semaphore capacity. Default ``4 x pool_size``.
- Env-var overrides: ``PGDP_STAGE_WRITE_POOL_SIZE`` /
  ``PGDP_STAGE_WRITE_QUEUE_CAP`` (honoured by :meth:`from_settings`).
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
from collections.abc import Callable, Coroutine
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ...settings import Settings

log = logging.getLogger(__name__)

_ArtifactKey = tuple[str, str, str]  # (project_id, page_id, stage_id)


# ─── Internal: in-memory artifact with consumer reference count ──────────────


class _PendingArtifact:
    """Artifact bytes with a mutable consumer reference count.

    Thread-safe: ``consume()`` is called from stage runners (potentially
    concurrent) and ``exhausted`` is read under the same lock.
    """

    __slots__ = ("_count", "_lock", "data")

    def __init__(self, data: bytes, num_consumers: int) -> None:
        self.data: bytes = data
        self._count: int = num_consumers
        self._lock: threading.Lock = threading.Lock()

    def consume(self) -> bytes:
        """Decrement consumer count and return data.

        The caller is responsible for dropping its own reference when
        ``exhausted`` is True after this call.
        """
        with self._lock:
            self._count -= 1
            return self.data

    @property
    def exhausted(self) -> bool:
        with self._lock:
            return self._count <= 0


# ─── Public async wrapper for the sync file write ────────────────────────────


async def _write_artifact_file_async(path: Path, data: bytes) -> None:
    """Async wrapper around the sync file-write helper.

    Runs inside ``asyncio.run()`` in the executor thread. No actual async I/O
    — the wrapper exists so the executor's coroutine interface is uniform.
    """
    from .page_stage_writer import write_artifact_file_sync

    write_artifact_file_sync(path, data)


# ─── StageWriteExecutor ───────────────────────────────────────────────────────


class StageWriteExecutor:
    """Bounded deferred-write executor.

    Parameters
    ----------
    pool_size : int
        Number of background writer threads.
    queue_cap : int
        Maximum outstanding write tasks (running + queued). When full,
        :meth:`submit_write` blocks the caller (back-pressure, Q8).
    """

    def __init__(self, pool_size: int, queue_cap: int) -> None:
        self.pool_size: int = pool_size
        self.queue_cap: int = queue_cap
        self._pool: ThreadPoolExecutor = ThreadPoolExecutor(
            max_workers=pool_size,
            thread_name_prefix="stage-write",
        )
        self._semaphore: threading.BoundedSemaphore = threading.BoundedSemaphore(queue_cap)
        self._cache: dict[_ArtifactKey, _PendingArtifact] = {}
        self._cache_lock: threading.Lock = threading.Lock()

    # ─── Factory ─────────────────────────────────────────────────────────────

    @classmethod
    def from_settings(cls, settings: Settings) -> StageWriteExecutor:
        """Construct from a :class:`~pd_prep_for_pgdp.settings.Settings` instance.

        Env-var overrides (``PGDP_STAGE_WRITE_POOL_SIZE``,
        ``PGDP_STAGE_WRITE_QUEUE_CAP``) are applied via ``Settings`` fields;
        omitting them falls back to ``min(cpu_count, 4)`` and ``4 x pool_size``.
        """
        pool_size = settings.stage_write_pool_size or min(os.cpu_count() or 1, 4)
        queue_cap = settings.stage_write_queue_cap or (4 * pool_size)
        return cls(pool_size=pool_size, queue_cap=queue_cap)

    # ─── Artifact cache (drop-on-last-consumer) ───────────────────────────────

    def put_artifact(self, key: _ArtifactKey, data: bytes, num_consumers: int) -> None:
        """Register in-memory artifact bytes for downstream stage consumption.

        ``num_consumers`` is the number of direct DAG children that will call
        :meth:`consume_artifact` for this key. When the count reaches zero the
        entry is evicted so the bytes can be GC'd.

        If ``num_consumers`` is 0 or negative the call is a no-op (terminal
        stages have no consumers).
        """
        if num_consumers <= 0:
            return
        with self._cache_lock:
            self._cache[key] = _PendingArtifact(data, num_consumers)

    def consume_artifact(self, key: _ArtifactKey) -> bytes | None:
        """Return cached artifact bytes, decrement consumer count.

        Returns ``None`` if the key is not in the cache (either never stored,
        already evicted, or the file is on disk). Evicts the entry when the
        last consumer reads it (drop-on-last-consumer).
        """
        with self._cache_lock:
            pending = self._cache.get(key)
            if pending is None:
                return None
            data = pending.consume()
            if pending.exhausted:
                del self._cache[key]
            return data

    # ─── Write submission ─────────────────────────────────────────────────────

    def submit_write(
        self,
        coro_factory: Callable[[], Coroutine[Any, Any, Any]],
        *,
        on_failure: Callable[[Exception], Coroutine[Any, Any, None]],
        loop: asyncio.AbstractEventLoop,
    ) -> None:
        """Block if queue full; submit write coroutine to the thread pool.

        Parameters
        ----------
        coro_factory
            Zero-argument callable that returns the write coroutine. Called
            inside the worker thread (coroutines must not be reused across
            calls to ``asyncio.run``).
        on_failure
            Async callback invoked on ``loop`` when the write raises. Intended
            to mark the stage ``failed`` and cascade dirty (Q9).
        loop
            The running asyncio event loop. Failure callbacks are posted to it
            via :func:`asyncio.run_coroutine_threadsafe`.
        """
        self._semaphore.acquire()  # blocks = intentional back-pressure (Q8)
        self._pool.submit(self._run_write, coro_factory, on_failure, loop)

    def _run_write(
        self,
        coro_factory: Callable[[], Coroutine[Any, Any, Any]],
        on_failure: Callable[[Exception], Coroutine[Any, Any, None]],
        loop: asyncio.AbstractEventLoop,
    ) -> None:
        try:
            asyncio.run(coro_factory())
        except Exception as exc:
            log.error("deferred stage write failed: %s", exc, exc_info=True)
            asyncio.run_coroutine_threadsafe(on_failure(exc), loop)
        finally:
            self._semaphore.release()

    # ─── Lifecycle ────────────────────────────────────────────────────────────

    def shutdown(self, wait: bool = True) -> None:
        """Shutdown the thread pool, optionally waiting for in-flight writes."""
        self._pool.shutdown(wait=wait)

    def __enter__(self) -> StageWriteExecutor:
        return self

    def __exit__(self, *_: object) -> None:
        self.shutdown()
