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

# ─── CuPy availability guard ─────────────────────────────────────────────────
# The executor must not crash at import time on CPU-only installs.  Each
# function that touches a device array checks _CUPY_AVAILABLE at call time.

try:
    import cupy as _cp  # pyright: ignore[reportMissingImports]

    _CUPY_AVAILABLE: bool = True
except ImportError:
    _cp = None  # type: ignore[assignment]
    _CUPY_AVAILABLE = False  # pyright: ignore[reportConstantRedefinition]


def _is_device_array(arr: object) -> bool:
    """Return True when arr is a CuPy ndarray (GPU-resident)."""
    return _CUPY_AVAILABLE and _cp is not None and isinstance(arr, _cp.ndarray)


def _download_device_array(arr: object) -> np.ndarray:
    """Download a CuPy ndarray to a numpy ndarray (CPU)."""
    assert _cp is not None, "CuPy unavailable — should not call _download_device_array"
    return _cp.asnumpy(arr)  # type: ignore[return-value]


def _ndarray_byte_size(arr: np.ndarray) -> int:
    """Return the memory footprint of an ndarray in bytes."""
    return int(arr.nbytes)


def _device_array_byte_size(arr: object) -> int:
    """Return the memory footprint of a CuPy ndarray in bytes."""
    if _CUPY_AVAILABLE and _cp is not None and isinstance(arr, _cp.ndarray):
        return int(arr.nbytes)  # pyright: ignore[reportAttributeAccessIssue]
    return 0


def _encode_ndarray_to_png(arr: np.ndarray) -> bytes:
    """Encode a *CPU* ndarray to PNG bytes (used in background write thread)."""
    import cv2

    ok, buf = cv2.imencode(".png", arr)
    if not ok:
        raise RuntimeError("cv2.imencode failed in background write thread")
    return bytes(buf.tobytes())


# ─── Internal: in-memory artifact with consumer reference count ──────────────


@final
class _PendingArtifact:
    """Artifact (bytes, numpy.ndarray, or cupy.ndarray) with consumer ref count.

    Thread-safe: ``consume()`` is called from stage runners (potentially
    concurrent) and ``exhausted`` is read under the same lock.

    Phase 1: ``data`` may be ``bytes`` or ``numpy.ndarray``.  When the caller
    passes an ndarray, it is stored without encoding; ``consume()`` returns the
    ndarray directly so downstream stages avoid ``cv2.imdecode``.  The
    background write thread calls ``encode_for_write()`` immediately before the
    disk write.

    Phase 2 extension: ``data`` may also be a ``cupy.ndarray`` (GPU-resident
    array).  ``consume()`` returns it directly to downstream stages that run on
    GPU.  ``encode_for_write()`` downloads to numpy first (``cupy.asnumpy``),
    then PNG-encodes on the write thread.  Eviction (budget overflow) also
    downloads the CuPy array before replacing it with bytes.
    """

    __slots__ = ("_count", "_lock", "data")

    def __init__(self, data: bytes | np.ndarray | object, num_consumers: int) -> None:
        self.data: bytes | np.ndarray | object = data
        self._count: int = num_consumers
        self._lock: threading.Lock = threading.Lock()

    def consume(self) -> bytes | np.ndarray | object:
        """Decrement consumer count and return data.

        The caller is responsible for dropping its own reference when
        ``exhausted`` is True after this call.  Returns the raw data —
        bytes, numpy ndarray, or cupy ndarray.
        """
        with self._lock:
            self._count -= 1
            return self.data

    def encode_for_write(self) -> bytes:
        """Return bytes suitable for disk write.

        When ``data`` is already bytes, returns it unchanged (zero-copy).
        When ``data`` is a numpy ndarray, encodes to PNG bytes.
        When ``data`` is a cupy ndarray (Phase 2), downloads first then encodes.
        Intended for the background write thread only.
        """
        if isinstance(self.data, (bytes, bytearray)):
            return bytes(self.data)
        if _is_device_array(self.data):
            # Phase 2: download GPU array before PNG-encoding.
            cpu_arr = _download_device_array(self.data)
            return _encode_ndarray_to_png(cpu_arr)
        assert isinstance(self.data, np.ndarray), "data must be bytes, np.ndarray, or cupy.ndarray"
        return _encode_ndarray_to_png(self.data)

    @property
    def is_ndarray(self) -> bool:
        """True for both numpy and cupy ndarrays."""
        return isinstance(self.data, np.ndarray) or _is_device_array(self.data)

    @property
    def ndarray_bytes(self) -> int:
        """Memory footprint in bytes (0 for bytes-type entries).

        For cupy ndarrays, reports the GPU memory footprint.
        """
        if isinstance(self.data, np.ndarray):
            return _ndarray_byte_size(self.data)
        if _is_device_array(self.data):
            return _device_array_byte_size(self.data)
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

        For numpy ndarrays: encodes to PNG bytes and replaces in-place.
        For cupy ndarrays (Phase 2): downloads to numpy first, then encodes.

        The write for the evicted entry was already submitted before eviction,
        so the write thread still gets the encoded bytes.  We just need to free
        the (GPU/CPU) ndarray memory.
        """
        if not self._ndarray_order:
            return

        used = self._current_ndarray_budget_used()
        while used + new_entry_bytes > self.cache_budget_bytes and self._ndarray_order:
            oldest_key = self._ndarray_order.pop(0)
            pending = self._cache.get(oldest_key)
            if pending is not None and pending.is_ndarray:
                # Replace the ndarray with encoded bytes in-place so the
                # background write thread still gets valid data.
                try:
                    arr = pending.data
                    if _is_device_array(arr):
                        # Phase 2: download GPU array before encoding.
                        cpu_arr = _download_device_array(arr)
                        encoded = _encode_ndarray_to_png(cpu_arr)
                    else:
                        assert isinstance(arr, np.ndarray), "is_ndarray guard: must be np.ndarray"
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
        data: bytes | np.ndarray | object,
        num_consumers: int,
    ) -> None:
        """Register an in-memory artifact for downstream stage consumption.

        ``data`` may be ``bytes`` (existing path), a ``numpy.ndarray``
        (Phase 1: no-encode hot path), or a ``cupy.ndarray`` (Phase 2:
        GPU-resident array).  When an ndarray or device array is supplied it
        is stored without encoding; the background write thread downloads (if
        needed) and encodes it just before the disk write.

        ``num_consumers`` is the number of direct DAG children that will call
        :meth:`consume_artifact` for this key. When the count reaches zero the
        entry is evicted so the memory can be GC'd.

        If ``num_consumers`` is 0 or negative the call is a no-op (terminal
        stages have no consumers).
        """
        if num_consumers <= 0:
            return
        with self._cache_lock:
            if isinstance(data, np.ndarray):
                new_bytes = _ndarray_byte_size(data)
            elif _is_device_array(data):
                new_bytes = _device_array_byte_size(data)
            else:
                new_bytes = 0
            if new_bytes > 0:
                self._evict_oldest_ndarray_if_over_budget(new_bytes)
            self._cache[key] = _PendingArtifact(data, num_consumers)
            if isinstance(data, np.ndarray) or _is_device_array(data):
                self._ndarray_order.append(key)

    def consume_artifact(self, key: _ArtifactKey) -> bytes | np.ndarray | object | None:
        """Return cached artifact (bytes, numpy ndarray, or cupy ndarray), decrement consumer count.

        Returns ``None`` if the key is not in the cache (either never stored,
        already evicted, or the file is on disk). Evicts the entry when the
        last consumer reads it (drop-on-last-consumer).

        Phase 1: numpy ndarray returned directly (caller skips cv2.imdecode).
        Phase 2: cupy ndarray returned directly (caller skips GPU upload).
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

        Phase 1: numpy ndarrays are PNG-encoded here in the write thread.
        Phase 2: cupy ndarrays are downloaded (cupy.asnumpy) then PNG-encoded.
        Returns None if the key is not in the cache.
        """
        with self._cache_lock:
            pending = self._cache.get(key)
            if pending is None:
                return None
            if pending.is_ndarray:
                self._increment_encode_count()
                arr = pending.data
                if _is_device_array(arr):
                    # Phase 2: download GPU array first.
                    cpu_arr = _download_device_array(arr)
                    return _encode_ndarray_to_png(cpu_arr)
                assert isinstance(arr, np.ndarray), "not device array, must be np.ndarray"
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
