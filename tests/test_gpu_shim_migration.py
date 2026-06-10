"""Behavior 8 — GPU shim migration: dispatcher/* imports from pdomain_ops.gpu directly.

Spec: docs/specs/library-placement.md §4.2
      - adapters/gpu/__init__.py shim removed (no more re-exports)
      - dispatcher/base.py, batched.py, immediate.py import from pdomain_ops.gpu
      - pdomain_ops.gpu.StageDispatcher is the canonical GPU dispatch entry point
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

_SRC = Path(__file__).parent.parent / "src" / "pdomain_prep_for_pgdp"


def _get_imports(path: Path) -> list[str]:
    """Return all 'from X import ...' module names in a file."""
    tree = ast.parse(path.read_text())
    sources = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            sources.append(node.module)
    return sources


def test_dispatcher_base_imports_from_pdomain_ops() -> None:
    """dispatcher/base.py imports BatchJobItem, BatchJobResult from pdomain_ops.gpu."""
    imports = _get_imports(_SRC / "dispatcher" / "base.py")
    assert "pdomain_ops.gpu" in imports, (
        "dispatcher/base.py must import from pdomain_ops.gpu, not adapters.gpu"
    )
    assert not any("adapters.gpu" in s for s in imports), (
        "dispatcher/base.py must NOT import from adapters.gpu"
    )


def test_dispatcher_batched_imports_from_pdomain_ops() -> None:
    """dispatcher/batched.py imports from pdomain_ops.gpu."""
    imports = _get_imports(_SRC / "dispatcher" / "batched.py")
    assert "pdomain_ops.gpu" in imports, (
        "dispatcher/batched.py must import from pdomain_ops.gpu, not adapters.gpu"
    )
    assert not any("adapters.gpu" in s for s in imports), (
        "dispatcher/batched.py must NOT import from adapters.gpu"
    )


def test_dispatcher_immediate_imports_from_pdomain_ops() -> None:
    """dispatcher/immediate.py imports from pdomain_ops.gpu."""
    imports = _get_imports(_SRC / "dispatcher" / "immediate.py")
    assert "pdomain_ops.gpu" in imports, (
        "dispatcher/immediate.py must import from pdomain_ops.gpu, not adapters.gpu"
    )
    assert not any("adapters.gpu" in s for s in imports), (
        "dispatcher/immediate.py must NOT import from adapters.gpu"
    )


def test_adapters_gpu_shim_has_no_re_exports() -> None:
    """adapters/gpu/__init__.py no longer re-exports GPU primitives (shim removed)."""
    shim_path = _SRC / "adapters" / "gpu" / "__init__.py"
    content = shim_path.read_text()
    # The shim used to export BatchJobItem, GPUBackend etc. — verify they are gone
    assert "BatchJobItem" not in content, "BatchJobItem re-export must be removed from shim"
    assert "GPUBackend" not in content, "GPUBackend re-export must be removed from shim"
    assert "__all__" not in content, "shim __all__ must be removed"


def test_pdomain_ops_gpu_primitives_importable() -> None:
    """GPU primitives are importable from pdomain_ops.gpu (canonical location)."""
    from pdomain_ops.gpu import (  # noqa: F401
        BatchJobItem,
        BatchJobResult,
        GPUBackend,
        OcrPageRequest,
        OcrPageResponse,
        ProcessPageRequest,
        ProcessPageResponse,
    )


def test_dispatcher_batched_importable() -> None:
    """BatchDispatcher imports cleanly with new pdomain_ops.gpu import path."""
    # Force reload to exercise the updated import path
    mod_name = "pdomain_prep_for_pgdp.dispatcher.batched"
    if mod_name in sys.modules:
        del sys.modules[mod_name]
    import importlib

    mod = importlib.import_module(mod_name)
    assert hasattr(mod, "BatchDispatcher")


def test_dispatcher_immediate_importable() -> None:
    """ImmediateDispatcher imports cleanly with new pdomain_ops.gpu import path."""
    mod_name = "pdomain_prep_for_pgdp.dispatcher.immediate"
    if mod_name in sys.modules:
        del sys.modules[mod_name]
    import importlib

    mod = importlib.import_module(mod_name)
    assert hasattr(mod, "ImmediateDispatcher")
