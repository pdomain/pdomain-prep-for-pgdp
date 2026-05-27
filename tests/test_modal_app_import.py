"""Cover the modal_app.py import guard.

`adapters/gpu/modal_app.py` is the Modal-deploy entry point. The
top-level `try/except` lets non-Modal environments (test hosts, CI
without [modal] extra) import the file without crashing — needed so
auto-discovery tools don't blow up.

Locks in:
  - importing the module never raises, regardless of whether `modal`
    is installed,
  - `_MODAL_AVAILABLE` reflects whether `modal` was importable at load.
"""

from __future__ import annotations

import importlib

import pytest


def test_modal_app_module_imports_without_modal_installed(monkeypatch: pytest.MonkeyPatch) -> None:
    """Block the `modal` import and reload modal_app — the guard should
    catch ImportError and set _MODAL_AVAILABLE=False."""
    import builtins
    import sys

    real = builtins.__import__

    def block_modal(name, *a, **kw):
        if name == "modal" or name.startswith("modal."):
            raise ImportError("modal blocked for test")
        return real(name, *a, **kw)

    monkeypatch.setattr(builtins, "__import__", block_modal)
    # Drop any cached modal_app and reload under the blocked import.
    sys.modules.pop("pdomain_ops.gpu.modal_app", None)

    mod = importlib.import_module("pdomain_ops.gpu.modal_app")
    assert mod._MODAL_AVAILABLE is False
    assert mod.modal is None


def test_modal_app_module_imports_when_modal_present() -> None:
    """If `modal` is actually installed, the module's `_MODAL_AVAILABLE`
    flag is True and the deploy-time `app` symbol exists."""
    pytest.importorskip("modal")

    # Reload from a clean state so prior monkeypatch tests don't bleed.
    import importlib
    import sys

    sys.modules.pop("pdomain_ops.gpu.modal_app", None)
    mod = importlib.import_module("pdomain_ops.gpu.modal_app")
    assert mod._MODAL_AVAILABLE is True
    assert hasattr(mod, "app")
