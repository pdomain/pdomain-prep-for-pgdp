"""Tests for device-key normalization in get_stage_impl.

Task 2.1 — Fix the GPU dispatch-key mismatch (gpu vs cuda).

The registry stores GPU impls under the key ``"gpu"`` but the GPU dispatcher
(pick_device / StageDispatcher) produces the string ``"cuda"`` for CUDA
devices.  ``get_stage_impl`` must normalize before the dict lookup so that:

- ``"cuda"`` → ``"gpu"`` (CUDA device maps to gpu impl key)
- ``"gpu"``  → ``"gpu"`` (explicit gpu key passes through unchanged)
- ``"cpu"``  → ``"cpu"`` (cpu stays cpu)
- unknown device → ``"cpu"`` (safe fallback to CPU)
- stage with NO GPU impl + asked for cuda/gpu → falls back to ``"cpu"`` impl
  (no KeyError)
"""

from __future__ import annotations

import pytest

from pdomain_prep_for_pgdp.core.pipeline.stage_registry import (
    GPU_CAPABLE_STAGES,
    V2_STAGE_IMPL,
    get_stage_impl,
)

# ── helpers ──────────────────────────────────────────────────────────────────


def _gpu_stage() -> str:
    """Return a v2 stage that already has a GPU impl registered.

    Uses the first entry from GPU_CAPABLE_STAGES (deterministic: frozenset
    iteration order is fixed per process for small sets).  All six GPU-capable
    stages (threshold, deskew, dewarp, post_transform_crop, canvas_map,
    denoise) have both "cpu" and "gpu" keys when CuPy is available, or only
    "cpu" when CuPy is absent.
    """
    return sorted(GPU_CAPABLE_STAGES)[0]  # 'canvas_map' alphabetically


def _cpu_only_stage() -> str:
    """Return a v2 stage that has NO GPU impl (cpu-only).

    Uses ``"crop"`` — a page-scoped stage that performs image crop/rotate
    transforms in pure NumPy and is not in ``_GPU_CAPABLE_STAGE_IDS``.
    ``"grayscale"`` was used here originally, but Task 2.2 added GPU support
    for grayscale, so it would cause these assertions to fail when CuPy is
    present.  ``"crop"`` has no GPU path and never will (it's a geometric
    transform with negligible memory bandwidth).
    """
    return "crop"  # not in GPU_CAPABLE_STAGES; no GPU impl planned


# ── normalization tests (always run, independent of CuPy availability) ──────


class TestDeviceKeyNormalization:
    """get_stage_impl must normalize device strings before the dict lookup."""

    def test_cpu_device_returns_cpu_impl(self) -> None:
        """device='cpu' → cpu impl, no error."""
        stage = "grayscale"
        impl = get_stage_impl(stage, "cpu")
        # The cpu impl must be callable and be the canonical cpu function.
        assert callable(impl)
        # Spot-check: the cpu impl for grayscale is _grayscale_v2_cpu.
        assert "grayscale" in impl.__name__

    def test_unknown_device_falls_back_to_cpu(self) -> None:
        """An unrecognised device string must fall back to cpu (not KeyError)."""
        stage = "grayscale"
        impl_cpu = get_stage_impl(stage, "cpu")
        impl_unknown = get_stage_impl(stage, "mps")
        # Must not raise; must return the cpu impl.
        assert impl_unknown is impl_cpu

    def test_gpu_device_no_gpu_impl_falls_back_to_cpu(self) -> None:
        """device='gpu' on a stage with no GPU impl → cpu impl (not KeyError)."""
        stage = _cpu_only_stage()
        # Verify the stage truly has no gpu key.
        assert "gpu" not in V2_STAGE_IMPL[stage]
        impl_cpu = get_stage_impl(stage, "cpu")
        impl_gpu = get_stage_impl(stage, "gpu")
        assert impl_gpu is impl_cpu

    def test_cuda_device_no_gpu_impl_falls_back_to_cpu(self) -> None:
        """device='cuda' on a stage with no GPU impl → cpu impl (not KeyError).

        This is the core regression test: before the fix, this raised KeyError
        because the registry has no 'cuda' key (only 'gpu' or 'cpu').
        """
        stage = _cpu_only_stage()
        assert "gpu" not in V2_STAGE_IMPL[stage]
        assert "cuda" not in V2_STAGE_IMPL[stage]
        impl_cpu = get_stage_impl(stage, "cpu")
        # Must not raise KeyError.
        impl_cuda = get_stage_impl(stage, "cuda")
        assert impl_cuda is impl_cpu

    def test_cuda_maps_to_gpu_impl_when_available(self) -> None:
        """device='cuda' on a GPU-capable stage → same impl as device='gpu'.

        Skipped when CuPy is absent (gpu key not registered in that environment).
        """
        stage = _gpu_stage()
        if "gpu" not in V2_STAGE_IMPL[stage]:
            pytest.skip("CuPy unavailable — gpu key not registered; skipping cuda→gpu map test")
        impl_cuda = get_stage_impl(stage, "cuda")
        impl_gpu = get_stage_impl(stage, "gpu")
        # Both must resolve to the same gpu callable.
        assert impl_cuda is impl_gpu

    def test_gpu_device_on_gpu_capable_stage(self) -> None:
        """device='gpu' on a GPU-capable stage → gpu impl (when CuPy present)."""
        stage = _gpu_stage()
        if "gpu" not in V2_STAGE_IMPL[stage]:
            pytest.skip("CuPy unavailable — gpu key not registered")
        impl_cpu = get_stage_impl(stage, "cpu")
        impl_gpu = get_stage_impl(stage, "gpu")
        assert impl_gpu is not impl_cpu

    def test_cpu_on_gpu_capable_stage_still_returns_cpu(self) -> None:
        """device='cpu' on a GPU-capable stage → cpu impl (not gpu)."""
        stage = _gpu_stage()
        impl_cpu = get_stage_impl(stage, "cpu")
        assert callable(impl_cpu)
        assert "gpu" not in impl_cpu.__name__
