"""Tests for `core/device_resolution.py::resolve_job_device()`.

OCR (and every other GPU-capable stage) always ran on cpu: the job-enqueue
routes never resolved the user's compute-device preference into the job
payload. `resolve_job_device()` wraps pdomain-ops' `resolve_effective_device()`
so every enqueue site can thread the actual preference through.

`PD_SUITE_DATA_DIR` is isolated per test by the autouse
`isolate_suite_data_dir` fixture in `tests/conftest.py`.
"""

from __future__ import annotations

import pytest
from pdomain_ops.suite.prefs import LocalFilePrefs
from pdomain_ops.suite.types import CommonUIPrefs

from pdomain_prep_for_pgdp.core.device_resolution import resolve_job_device

_APP_ID = "pdomain-prep-for-pgdp"


def test_resolve_job_device_uses_app_level_override() -> None:
    prefs = LocalFilePrefs()
    prefs.write_app(_APP_ID, {"compute_device": "cuda"})

    assert resolve_job_device() == "cuda"


def test_resolve_job_device_falls_back_to_suite_default() -> None:
    prefs = LocalFilePrefs()
    prefs.write_common(CommonUIPrefs(compute_device_default="mps"))

    assert resolve_job_device() == "mps"


def test_resolve_job_device_falls_back_to_pick_device(monkeypatch: pytest.MonkeyPatch) -> None:
    """No app override and no suite default falls through to
    `resolve_effective_device()`'s own `pick_device()` call, driven
    deterministically here via `PDOMAIN_GPU_BACKEND`."""
    monkeypatch.setenv("PDOMAIN_GPU_BACKEND", "cpu")

    assert resolve_job_device() == "cpu"
