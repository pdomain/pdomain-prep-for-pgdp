"""Construction + not-yet-wired contracts for managed-mode GPU backends.

`ModalBackend` and `SharedContainerBackend` are concrete classes whose
GPU dispatch is wired in later iterations. Until they're real, the
NotImplementedError contract is testable, and the construction +
function-cache logic for Modal is testable without standing up a real
Modal app.

Locks in:
  - ModalBackend caches function handles after first lookup,
  - ModalBackend raises a clear RuntimeError naming the [modal] extra
    when modal isn't installed,
  - SharedContainerBackend stores base_url/api_key and strips trailing /,
  - SharedContainerBackend's three methods all raise NotImplementedError
    until wired (lock in case someone partially wires it).
"""

from __future__ import annotations

import pytest
from pdomain_ops.gpu import (
    BatchJobItem,
    OcrPageRequest,
    ProcessPageRequest,
)
from pdomain_ops.gpu import ModalStageDispatcher as ModalBackend
from pdomain_ops.gpu import SharedContainerStageDispatcher as SharedContainerBackend

# ── ModalBackend ───────────────────────────────────────────────────────────


def test_modal_backend_caches_function_handles() -> None:
    """The second `_load_function(name)` call returns the cached handle
    without re-importing modal."""
    backend = ModalBackend("tok-id", "tok-secret")
    sentinel = object()
    backend._fns["process_page"] = sentinel  # pre-warm cache
    assert backend._load_function("process_page") is sentinel


def test_modal_backend_missing_extra_raises_clear_error(monkeypatch: pytest.MonkeyPatch) -> None:
    """Without [modal] installed, _load_function raises a RuntimeError
    that points the user at the install command (not a bare ImportError)."""
    import builtins

    real = builtins.__import__

    def block(name, *a, **kw):
        if name == "modal":
            raise ImportError("no modal")
        return real(name, *a, **kw)

    monkeypatch.setattr(builtins, "__import__", block)
    backend = ModalBackend("tok-id", "tok-secret")
    with pytest.raises(RuntimeError, match=r"\[modal\] extra"):
        backend._load_function("process_page")


# ── SharedContainerBackend ─────────────────────────────────────────────────


def test_shared_container_strips_trailing_slash() -> None:
    backend = SharedContainerBackend("https://gpu.example.com/", "api-key")
    assert backend._base_url == "https://gpu.example.com"
    assert backend._api_key == "api-key"


def test_shared_container_construction_with_no_trailing_slash() -> None:
    backend = SharedContainerBackend("https://gpu.example.com", "x")
    assert backend._base_url == "https://gpu.example.com"


@pytest.mark.asyncio
async def test_shared_container_methods_are_not_yet_wired() -> None:
    backend = SharedContainerBackend("https://gpu.example.com", "key")

    with pytest.raises(NotImplementedError):
        await backend.process_page(
            ProcessPageRequest(
                project_id="p",
                idx0=0,
                config_overrides={},
                output_context="commit",
            )
        )

    with pytest.raises(NotImplementedError):
        await backend.run_ocr(OcrPageRequest(project_id="p", idx0=0))

    with pytest.raises(NotImplementedError):
        await backend.run_batch([BatchJobItem(job_type="batch_ocr", project_id="p", idx0=0, payload={})])
