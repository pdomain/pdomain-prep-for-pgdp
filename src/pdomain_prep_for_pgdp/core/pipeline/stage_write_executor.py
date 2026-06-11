"""Bounded deferred-write executor for stage artifacts (Q8/Q9).

Spec: `docs/specs/pipeline-task-model.md`
§"Memory-resident execution model > Deferred disk writes" (locked 2026-05-07).

Design:

- A ``ThreadPoolExecutor`` (pool_size workers) does the actual disk writes.
- A ``threading.BoundedSemaphore`` (queue_cap) limits total outstanding tasks
  (running + queued). When at capacity, :meth:`submit_write` blocks the
  caller — intentional back-pressure (Q8). The alternative is unbounded RAM
  growth from an unbounded in-flight write set.
- An in-memory artifact cache holds stage output (``bytes`` **or**
  ``numpy.ndarray``) keyed by ``(project_id, page_id, stage_id)`` until all
  direct DAG consumers have read them (drop-on-last-consumer).

  Phase 1 (plan 2026-06-11-gpu-memory-pipeline.md §Phase1):
  When the caller passes an ndarray, it is stored *without* encoding.  The
  next stage's :func:`~pdomain_prep_for_pgdp.core.pipeline.stage_runner._load_parent_artifact`
  receives the ndarray directly and skips ``cv2.imdecode`` — removing the
  hot-path encode-decode round-trip.  The actual ``cv2.imencode`` call is
  deferred to the background writer thread, immediately before the disk write.

  Memory budget (``cache_budget_bytes``): when the total size of ndarray
  entries in the cache would exceed this limit, the oldest ndarray entry is
  encoded and its cache slot dropped to keep peak RAM bounded.  Bytes entries
  are not counted toward the budget (they are already compact).

- Write failures are surfaced via an async ``on_failure`` callback scheduled
  on the caller's event loop via :func:`asyncio.run_coroutine_threadsafe`.
  The callback marks the stage ``failed`` and propagates dirty to descendants
  (Q9 -- fail loudly).

Configuration:

- ``pool_size``: thread count. Default ``min(cpu_count, 4)``.
- ``queue_cap``: semaphore capacity. Default ``4 x pool_size``.
- ``cache_budget_bytes``: ndarray cache budget. Default 512 MiB.
- Env-var overrides: ``PGDP_STAGE_WRITE_POOL_SIZE`` /
  ``PGDP_STAGE_WRITE_QUEUE_CAP`` / ``PGDP_STAGE_CACHE_MB``
  (honoured by :meth:`from_settings`).
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
from collections.abc import Callable, Coroutine
from concurrent.futures import ThreadPoolExecutor
from typing import TYPE_CHECKING, final

import numpy as np

if TYPE_CHECKING:
    from pathlib import Path

    from pdomain_prep_for_pgdp.settings import Settings

log = logging.getLogger(__name__)

_ArtifactKey = tuple[str, str, str]  # (project_id, page_id, stage_id)
type _WriteCoroutine = Coroutine[object, object, None]
type _WriteFactory = Callable[[], _WriteCoroutine]
type _FailureCallback = Callable[[Exception], _WriteCoroutine]

# Default memory budget: 512 MiB
_DEFAULT_CACHE_BUDGET_BYTES = 512 * 1024 * 1024


def _ndarray_byte_size(arr: np.ndarray) -> int:
    """Return the memory footprint of an ndarray in bytes."""
    return int(arr.nbytes)


def _encode_ndarray_to_png(arr: np.ndarray) -> bytes:
    """Encode an ndarray to PNG bytes (used in background write thread)."""
    import cv2

    ok, buf = cv2.imencode(".png", arr)
    if not ok:
        raise RuntimeError("cv2.imencode failed in background write thread")
    return bytes(buf.tobytes())


# ─── Internal: in-memory artifact with consumer reference count ──────────────


@final
class _PendingArtifact:
    """Artifact (bytes or ndarray) with a mutable consumer reference count.

    Thread-safe: ``consume()`` is called from stage runners (potentially
    concurrent) and ``exhausted`` is read under the same lock.

    Phase 1: ``data`` may be either ``bytes`` or ``numpy.ndarray``.  When the
    caller passes an ndarray, it is stored without encoding; ``consume()``
    returns the ndarray directly so downstream stages avoid ``cv2.imdecode``.
    The background write thread calls ``encode_for_write()`` immediately before
    the disk write.
    """

    __slots__ = ("_count", "_lock", "data")

    def __init__(self, data: bytes | np.ndarray, num_consumers: int) -> None:
        self.data: bytes | np.ndarray = data
        self._count: int = num_consumers
        self._lock: threading.Lock = threading.Lock()

    def consume(self) -> bytes | np.ndarray:
        """Decrement consumer count and return data.

        The caller is responsible for dropping its own reference when
        ``exhausted`` is True after this call.
        """
        with self._lock:
            self._count -= 1
            return self.data

    def encode_for_write(self) -> bytes:
        """Return bytes suitable for disk write.

        When ``data`` is already bytes, returns it unchanged (zero-copy).
        When ``data`` is an ndarray, encodes to PNG bytes in the *caller's*
        thread (intended for the background write thread only — never call
        from the hot path).
        """
        if isinstance(self.data, (bytes, bytearray)):
            return bytes(self.data)
        return _encode_ndarray_to_png(self.data)

    @property
    def is_ndarray(self) -> bool:
        return isinstance(self.data, np.ndarray)

    @property
    def ndarray_bytes(self) -> int:
        """Memory footprint in bytes (0 for bytes-type entries)."""
        if isinstance(self.data, np.ndarray):
            return _ndarray_byte_size(self.data)
        return 0

    @property
    def exhausted(self) -> bool:
        with self._lock:
            return self._count <= 0


# ─── Public async wrapper for the sync file write ────────────────────────────


async def write_artifact_file_async(
    path: Path,
    data: bytes,
    *,
    thumb_path: Path | None = None,
    thumb_bytes: bytes | None = None,
) -> None:
    """Async wrapper around the sync file-write helper.

    Runs inside ``asyncio.run()`` in the executor thread. No actual async I/O
    — the wrapper exists so the executor's coroutine interface is uniform.
    Optional ``thumb_path`` / ``thumb_bytes`` are forwarded to the sync helper
    for best-effort thumbnail persistence on the deferred-write path.
    """
    from .page_stage_writer import write_artifact_file_sync

    write_artifact_file_sync(path, data, thumb_path=thumb_path, thumb_bytes=thumb_bytes)


# ─── StageWriteExecutor ───────────────────────────────────────────────────────


class StageWriteExecutor:
    """Bounded deferred-write executor with ndarray passthrough (Phase 1).

    Parameters
    ----------
    pool_size : int
        Number of background writer threads.
    queue_cap : int
        Maximum outstanding write tasks (running + queued). When full,
        :meth:`submit_write` blocks the caller (back-pressure, Q8).
    cache_budget_bytes : int
        Maximum total bytes of ndarray entries in the in-memory cache.
        When adding a new ndarray entry would exceed this limit, the oldest
        ndarray entry is encoded and evicted before adding the new one.
        Default: 512 MiB. Bytes-type entries are exempt from the budget.
    """

    def __init__(
        self,
        pool_size: int,
        queue_cap: int,
        cache_budget_bytes: int = _DEFAULT_CACHE_BUDGET_BYTES,
        *,
        cache_budget_mb: float | None = None,
    ) -> None:
        self.pool_size: int = pool_size
        self.queue_cap: int = queue_cap
        # Allow either bytes or (convenience) MB as constructor arg.
        if cache_budget_mb is not None:
            cache_budget_bytes = int(cache_budget_mb * 1024 * 1024)
        self.cache_budget_bytes: int = cache_budget_bytes
        self._pool: ThreadPoolExecutor = ThreadPoolExecutor(
            max_workers=pool_size,
            thread_name_prefix="stage-write",
        )
        self._semaphore: threading.BoundedSemaphore = threading.BoundedSemaphore(queue_cap)
        self._cache: dict[_ArtifactKey, _PendingArtifact] = {}
        # Ordered list of ndarray keys for LRU eviction (oldest first).
        self._ndarray_order: list[_ArtifactKey] = []
        self._cache_lock: threading.Lock = threading.Lock()
        # Encode counter: incremented in the background write thread each time
        # an ndarray is encoded to PNG. Accessible for test instrumentation.
        self._encode_count: int = 0
        self._encode_count_lock: threading.Lock = threading.Lock()

    # ─── Factory ─────────────────────────────────────────────────────────────

    @classmethod
    def from_settings(cls, settings: Settings) -> StageWriteExecutor:
        """Construct from a :class:`~pdomain_prep_for_pgdp.settings.Settings` instance.

        Env-var overrides (``PGDP_STAGE_WRITE_POOL_SIZE``,
        ``PGDP_STAGE_WRITE_QUEUE_CAP``, ``PGDP_STAGE_CACHE_MB``) are applied
        via ``Settings`` fields; omitting them falls back to
        ``min(cpu_count, 4)``, ``4 x pool_size``, and 512 MiB respectively.
        """
        pool_size = settings.stage_write_pool_size or min(os.cpu_count() or 1, 4)
        queue_cap = settings.stage_write_queue_cap or (4 * pool_size)
        cache_budget_bytes = settings.stage_cache_mb * 1024 * 1024
        return cls(
            pool_size=pool_size,
            queue_cap=queue_cap,
            cache_budget_bytes=cache_budget_bytes,
        )

    # ─── Encode counter (instrumentation) ────────────────────────────────────

    @property
    def encode_count(self) -> int:
        """Number of ndarray→PNG encodes performed in the background write thread."""
        with self._encode_count_lock:
            return self._encode_count

    def _increment_encode_count(self) -> None:
        with self._encode_count_lock:
            self._encode_count += 1

    # ─── Budget management ────────────────────────────────────────────────────

    def _current_ndarray_budget_used(self) -> int:
        """Total bytes used by ndarray entries in the cache (caller holds lock)."""
        return sum(p.ndarray_bytes for p in self._cache.values() if p.is_ndarray)

    def _evict_oldest_ndarray_if_over_budget(self, new_entry_bytes: int) -> None:
        """If adding ``new_entry_bytes`` would exceed budget, encode+evict oldest
        ndarray entry.  Called while holding ``_cache_lock``.

        Encodes the evicted ndarray to PNG bytes (so the write thread can still
        use them) but drops the result — the write for that entry was already
        submitted before eviction, so we just need to free the ndarray memory.
        In practice, eviction happens when the write queue is congested; the
        evicted entry's write is in-flight or pending in the thread pool.
        """
        if not self._ndarray_order:
            return

        used = self._current_ndarray_budget_used()
        while used + new_entry_bytes > self.cache_budget_bytes and self._ndarray_order:
            oldest_key = self._ndarray_order.pop(0)
            pending = self._cache.get(oldest_key)
            if pending is not None and pending.is_ndarray:
                # Replace the ndarray with its encoded bytes in-place so the
                # background write thread (which holds no lock) still gets
                # valid data.  We encode here (under the lock) because we need
                # to guarantee the ndarray is freed immediately.
                try:
                    arr = pending.data
                    assert isinstance(arr, np.ndarray), "is_ndarray guard ensures this"
                    encoded = _encode_ndarray_to_png(arr)
                    pending.data = encoded
                    used = self._current_ndarray_budget_used()
                    log.debug(
                        "stage-cache budget eviction: encoded+evicted %s (%d bytes freed)",
                        oldest_key,
                        len(encoded),
                    )
                except Exception:
                    log.exception("stage-cache eviction encode failed for %s; evicting anyway", oldest_key)
                    # Remove from cache entirely so the write thread can't use it.
                    self._cache.pop(oldest_key, None)
                    used = self._current_ndarray_budget_used()

    # ─── Artifact cache (drop-on-last-consumer) ───────────────────────────────

    def put_artifact(
        self,
        key: _ArtifactKey,
        data: bytes | np.ndarray,
        num_consumers: int,
    ) -> None:
        """Register an in-memory artifact for downstream stage consumption.

        ``data`` may be either ``bytes`` (existing path) or a ``numpy.ndarray``
        (Phase 1: no-encode hot path). When an ndarray is supplied it is stored
        without encoding; the background write thread encodes it just before the
        disk write.

        ``num_consumers`` is the number of direct DAG children that will call
        :meth:`consume_artifact` for this key. When the count reaches zero the
        entry is evicted so the memory can be GC'd.

        If ``num_consumers`` is 0 or negative the call is a no-op (terminal
        stages have no consumers).
        """
        if num_consumers <= 0:
            return
        with self._cache_lock:
            new_bytes = _ndarray_byte_size(data) if isinstance(data, np.ndarray) else 0
            if new_bytes > 0:
                self._evict_oldest_ndarray_if_over_budget(new_bytes)
            self._cache[key] = _PendingArtifact(data, num_consumers)
            if isinstance(data, np.ndarray):
                self._ndarray_order.append(key)

    def consume_artifact(self, key: _ArtifactKey) -> bytes | np.ndarray | None:
        """Return cached artifact (bytes or ndarray), decrement consumer count.

        Returns ``None`` if the key is not in the cache (either never stored,
        already evicted, or the file is on disk). Evicts the entry when the
        last consumer reads it (drop-on-last-consumer).

        When an ndarray is returned the caller may use it directly without
        decoding, saving the ``cv2.imdecode`` call on the hot path.
        """
        with self._cache_lock:
            pending = self._cache.get(key)
            if pending is None:
                return None
            data = pending.consume()
            if pending.exhausted:
                del self._cache[key]
                # Remove from ndarray order list too (if present; may have been evicted).
                if key in self._ndarray_order:
                    self._ndarray_order.remove(key)
            return data

    def get_bytes_for_write(self, key: _ArtifactKey) -> bytes | None:
        """Return the bytes representation of a cached artifact for disk write.

        Used by the background write thread to get the artifact data without
        removing it from the cache (consume_artifact handles the consumer
        count; this is a read-only peek at the data for the write path).

        If the entry is an ndarray, encodes it to PNG here in the write thread.
        Returns None if the key is not in the cache.
        """
        with self._cache_lock:
            pending = self._cache.get(key)
            if pending is None:
                return None
            if pending.is_ndarray:
                self._increment_encode_count()
                arr = pending.data
                assert isinstance(arr, np.ndarray), "is_ndarray guard ensures this"
                return _encode_ndarray_to_png(arr)
            raw = pending.data
            assert isinstance(raw, bytes), "not is_ndarray so data is bytes"
            return bytes(raw)

    # ─── Write submission ─────────────────────────────────────────────────────

    def submit_write(
        self,
        coro_factory: _WriteFactory,
        *,
        on_failure: _FailureCallback,
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
        _ = self._semaphore.acquire()  # blocks = intentional back-pressure (Q8)
        _ = self._pool.submit(self._run_write, coro_factory, on_failure, loop)

    def _run_write(
        self,
        coro_factory: _WriteFactory,
        on_failure: _FailureCallback,
        loop: asyncio.AbstractEventLoop,
    ) -> None:
        try:
            asyncio.run(coro_factory())
        except Exception as exc:
            log.exception("deferred stage write failed: %s", exc)
            _ = asyncio.run_coroutine_threadsafe(on_failure(exc), loop)
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
