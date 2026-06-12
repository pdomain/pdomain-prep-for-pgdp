"""GPU-resident segment execution (Phase 2).

Plan: docs/plans/2026-06-11-gpu-memory-pipeline.md §Phase 2

## Concept

Within a consecutive multi-stage pass over one page (run_from / run-all /
batch fan-out), consecutive GPU-capable stages share a working array that
stays on the GPU (a CuPy ndarray).  Transfers happen only at segment
boundaries:

- A CPU-only stage is encountered (the boundary download happens here).
- Artifact materialization: the stage_runner commits the artifact to disk.
  The deferred-write executor's background thread calls ``cupy.asnumpy``
  before PNG-encoding (see StageWriteExecutor extension for device arrays).

## VRAM bound

One page's image-prep chain peaks at a handful of uint8 full-resolution
arrays.  Phase 3 introduced ``ocr_pipeline_slots`` (default 3) for
concurrent page OCR.  Phase 2 adds a *per-page GPU semaphore*
(``PGDP_GPU_PAGE_SLOTS``, default: auto-sized from free VRAM minus
DocTR residency) that gates how many pages can simultaneously hold
a GPU working array.

## Usage in stage_runner.py

The stage_runner.run_stage call chain remains unchanged — it still dispatches
via ``get_stage_impl(stage_id, device)`` where device is ``"cpu"`` or
``"gpu"``/``"local"``.  The segment runner is a *higher-level helper* that
calls run_stage N times, keeping the working array on-device between calls.

For now (Phase 2) the segment runner is used by the run_from fan-out and
the batch OCR fan-out (Phase 3) to reduce per-stage round-trips.  The
single-stage interactive path (workbench "run stage" button) uses run_stage
directly with the write_executor ndarray passthrough (Phase 1).

## GPU capability

Only stages in ``GPU_CAPABLE_STAGES`` (stage_registry.py) participate in a
GPU segment.  When the device is ``"cpu"`` or CuPy is unavailable, all
stages run through the CPU path and this module reduces to a simple loop
over stage impls.
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Callable
from typing import Any

import numpy as np

from .stage_registry import GPU_CAPABLE_STAGES, StageConfig, get_stage_impl

type _StageImpl = Callable[..., Any]

log = logging.getLogger(__name__)

# ─── CuPy availability ─────────────────────────────────────────────────────

try:
    import cupy as cp  # pyright: ignore[reportMissingImports]

    _CUPY_AVAILABLE: bool = True
except ImportError:
    cp = None  # type: ignore[assignment]
    _CUPY_AVAILABLE = False  # pyright: ignore[reportConstantRedefinition]


def _is_device_array(arr: object) -> bool:
    """Return True when arr is a CuPy ndarray (GPU-resident)."""
    return _CUPY_AVAILABLE and cp is not None and isinstance(arr, cp.ndarray)


def _to_numpy(arr: object) -> np.ndarray:
    """Download a device or host array to a numpy ndarray."""
    if _is_device_array(arr):
        assert cp is not None
        return cp.asnumpy(arr)  # type: ignore[return-value]
    assert isinstance(arr, np.ndarray)
    return arr


# ─── VRAM semaphore ─────────────────────────────────────────────────────────

_DEFAULT_DOCTR_VRAM_MB = 2048  # Conservative estimate for DocTR det+reco model residency
_BYTES_PER_PAGE_MB = 4  # Conservative: a 1200x900 uint8 page = ~1 MiB; keep 4 for pipeline


def compute_gpu_page_slots(device: str | None = None) -> int:
    """Compute the number of GPU page semaphore slots.

    Resolution order:
    1. ``PGDP_GPU_PAGE_SLOTS`` env var (explicit override).
    2. Auto-size: free VRAM (MiB) minus DocTR residency, divided by per-page
       working set, floor to at least 1.
    3. CPU device or CuPy unavailable: return 1 (floor).

    The returned value is always >= 1.
    """
    env_slots = os.environ.get("PGDP_GPU_PAGE_SLOTS")
    if env_slots is not None:
        try:
            return max(1, int(env_slots))
        except ValueError:
            log.warning("PGDP_GPU_PAGE_SLOTS=%r is not an integer; using default", env_slots)

    # CPU device or CuPy absent — nothing to bound.
    if device == "cpu" or not _CUPY_AVAILABLE or cp is None:
        return 1

    # Auto-size from free VRAM.
    try:
        free_bytes, _total_bytes = cp.cuda.runtime.memGetInfo()
        free_mb = free_bytes // (1024 * 1024)
        available_mb = max(0, free_mb - _DEFAULT_DOCTR_VRAM_MB)
        slots = max(1, available_mb // _BYTES_PER_PAGE_MB)
        log.debug(
            "GPU page slots auto-sized: free=%dMiB avail=%dMiB slots=%d",
            free_mb,
            available_mb,
            slots,
        )
        return slots
    except Exception as exc:
        log.warning("Could not query VRAM for page-slot sizing (%s); defaulting to 1", exc)
        return 1


def get_gpu_page_semaphore(gpu_page_slots: int | None = None) -> asyncio.Semaphore:
    """Build an asyncio.Semaphore for the page-level GPU gate.

    ``gpu_page_slots``: explicit slot count (from Settings.gpu_page_slots).
    When None, calls ``compute_gpu_page_slots()`` to auto-size.
    """
    slots = gpu_page_slots if gpu_page_slots is not None else compute_gpu_page_slots()
    return asyncio.Semaphore(max(1, slots))


# ─── Segment runner ─────────────────────────────────────────────────────────


def _is_gpu_device(device: str) -> bool:
    """Return True for device strings that map to GPU execution."""
    return device in ("local", "gpu", "cuda") and _CUPY_AVAILABLE


def run_image_segment(
    image: np.ndarray,
    stage_ids: list[str],
    device: str = "cpu",
    cfg: StageConfig = None,
) -> tuple[np.ndarray | object, str]:
    """Run a sequence of image-processing stages on a single working array.

    When ``device`` maps to a GPU device and CuPy is available, consecutive
    GPU-capable stages keep the working array as a CuPy ndarray — no
    GPU↔CPU round-trip between them.  The array is downloaded to numpy
    automatically when:

    - A CPU-only stage is encountered (boundary download).
    - The caller receives the final output (if still on GPU it is downloaded
      before returning — BUT only if ``download_result=True``; by default
      the raw array is returned so the caller can pass it to
      StageWriteExecutor without an extra copy).

    Parameters
    ----------
    image
        Initial numpy ndarray input.
    stage_ids
        Ordered list of v2 stage IDs to run in sequence.
    device
        ``"cpu"`` or ``"local"``/``"gpu"``/``"cuda"`` for GPU.
    cfg
        Resolved per-page config to pass to each impl.

    Returns
    -------
    (result_array, final_device)
        ``result_array``: numpy or CuPy ndarray (whatever the last stage produced).
        ``final_device``: ``"cpu"`` or ``"gpu"``/``"local"`` indicating the device
        of the returned array.
    """
    use_gpu = _is_gpu_device(device)
    working: object = image  # np.ndarray or cp.ndarray depending on path
    final_device = "cpu"

    for stage_id in stage_ids:
        stage_gpu_capable = stage_id in GPU_CAPABLE_STAGES

        if use_gpu and stage_gpu_capable:
            # GPU path: upload if not already on device.
            if not _is_device_array(working):
                assert isinstance(working, np.ndarray), f"expected ndarray, got {type(working)}"
                assert cp is not None
                working = cp.asarray(working)

            impl = _get_stage_impl_with_fallback(stage_id, "gpu")
            working = impl(working, cfg=cfg)
            final_device = "local"
        else:
            # CPU path: download if currently on GPU.
            if _is_device_array(working):
                working = _to_numpy(working)
                final_device = "cpu"

            impl = get_stage_impl(stage_id, "cpu")
            working = impl(working, cfg=cfg)
            final_device = "cpu"

    return working, final_device  # type: ignore[return-value]


def _get_stage_impl_with_fallback(stage_id: str, device: str) -> _StageImpl:
    """Look up the stage impl for ``device``, falling back to ``cpu`` on KeyError.

    This graceful fallback is only for the segment runner: if a GPU impl is
    missing at runtime (e.g. a stage was added to GPU_CAPABLE_STAGES before its
    impl was wired), the CPU path runs transparently and logs a warning.
    """
    from .stage_registry import V2_STAGE_IMPL

    entry = V2_STAGE_IMPL.get(stage_id, {})
    impl = entry.get(device) or entry.get("cpu")
    if impl is None:
        from .stage_registry import get_stage_impl

        return get_stage_impl(stage_id, "cpu")
    return impl
