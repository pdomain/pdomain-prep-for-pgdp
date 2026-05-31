"""Tests for PGDP_GPU_BACKEND → PDOMAIN_GPU_BACKEND env-var alias.

§7 Phase 1.7 renames the GPU backend selector to the cross-cut PD_*
prefix; the old name keeps working for one release cycle and emits a
DeprecationWarning.
"""

from __future__ import annotations

import warnings
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import pytest

from pdomain_prep_for_pgdp.settings import Settings


def test_default_doctr_cache_dir_uses_pdomain_prefix(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("HOME", "/tmp/example-home")
    assert Settings().doctr_cache_dir == Path("/tmp/example-home/.cache/pdomain-ml-models")


def test_new_env_var_pdomain_gpu_backend_is_read(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("PGDP_GPU_BACKEND", raising=False)
    monkeypatch.setenv("PDOMAIN_GPU_BACKEND", "cpu")
    s = Settings()
    assert s.gpu_backend == "cpu"


def test_legacy_env_var_pgdp_gpu_backend_still_works(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("PDOMAIN_GPU_BACKEND", raising=False)
    monkeypatch.setenv("PGDP_GPU_BACKEND", "cpu")
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        s = Settings()
    assert s.gpu_backend == "cpu"
    deprecations = [w for w in caught if issubclass(w.category, DeprecationWarning)]
    assert any("PGDP_GPU_BACKEND" in str(w.message) for w in deprecations), (
        f"expected DeprecationWarning naming PGDP_GPU_BACKEND, got: {[str(w.message) for w in deprecations]}"
    )


def test_new_env_var_wins_when_both_set(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("PDOMAIN_GPU_BACKEND", "cpu")
    monkeypatch.setenv("PGDP_GPU_BACKEND", "modal")
    s = Settings()
    assert s.gpu_backend == "cpu"


def test_no_warning_when_only_new_var_set(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("PGDP_GPU_BACKEND", raising=False)
    monkeypatch.setenv("PDOMAIN_GPU_BACKEND", "cpu")
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        Settings()
    deprecations = [w for w in caught if issubclass(w.category, DeprecationWarning)]
    assert not deprecations, f"unexpected DeprecationWarning(s): {deprecations}"


def test_no_warning_when_neither_var_set(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("PDOMAIN_GPU_BACKEND", raising=False)
    monkeypatch.delenv("PGDP_GPU_BACKEND", raising=False)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        Settings()
    deprecations = [w for w in caught if issubclass(w.category, DeprecationWarning)]
    assert not deprecations
