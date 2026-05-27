"""Tests for the adapter builder functions in `bootstrap.py`.

Each builder maps a `Settings` instance to a concrete adapter (or raises
a clear RuntimeError when a required setting is missing). Locks in:
  - `build_auth` raises when api_key is missing in apikey mode,
  - `build_auth` raises when jwt_issuer is missing in jwt mode,
  - `build_auth` raises on an unknown auth_mode (forward compatibility),
  - `build_storage` raises when s3_data_bucket is missing in s3 mode,
  - `build_gpu_backend` raises when modal tokens are missing in modal mode,
  - `build_gpu_backend` raises when shared_gpu_url is missing in shared mode,
  - `build_gpu_backend` raises on an unknown gpu_backend value,
  - `_autodetect_gpu_backend` returns 'cpu' on a non-CUDA, non-Apple-Silicon host.
"""

from __future__ import annotations

import platform

import pytest

from pdomain_prep_for_pgdp.bootstrap import (
    _autodetect_gpu_backend,
    build_auth,
    build_gpu_backend,
    build_storage,
)
from pdomain_prep_for_pgdp.settings import Settings


def _settings(tmp_path, **overrides) -> Settings:
    base = {
        "host": "127.0.0.1",
        "port": 8765,
        "data_root": tmp_path / "data",
        "config_dir": tmp_path / "config",
        "storage_backend": "filesystem",
        "database_url": f"sqlite:///{(tmp_path / 's.db').as_posix()}",
        "gpu_backend": "cpu",
        "dispatch_interval_seconds": 0,
        "auth_mode": "none",
    }
    base.update(overrides)
    return Settings(**base)


# ── build_auth ──────────────────────────────────────────────────────────────


def test_build_auth_apikey_requires_api_key(tmp_path) -> None:
    settings = _settings(tmp_path, auth_mode="apikey", api_key="")
    with pytest.raises(RuntimeError, match="PGDP_API_KEY"):
        build_auth(settings)


def test_build_auth_jwt_requires_issuer(tmp_path) -> None:
    settings = _settings(tmp_path, auth_mode="jwt", jwt_issuer="")
    with pytest.raises(RuntimeError, match="PGDP_JWT_ISSUER"):
        build_auth(settings)


def test_build_auth_rejects_unknown_mode(tmp_path) -> None:
    """Unknown auth_mode shouldn't silently fall back — fail loud."""
    settings = _settings(tmp_path)
    settings.auth_mode = "totally-not-a-real-mode"  # bypass the validator
    with pytest.raises(RuntimeError, match="unknown auth_mode"):
        build_auth(settings)


# ── build_storage ───────────────────────────────────────────────────────────


def test_build_storage_s3_requires_bucket(tmp_path) -> None:
    settings = _settings(tmp_path, storage_backend="s3", s3_data_bucket=None)
    with pytest.raises(RuntimeError, match="PGDP_S3_DATA_BUCKET"):
        build_storage(settings)


# ── build_gpu_backend ───────────────────────────────────────────────────────


def test_build_gpu_modal_requires_tokens(tmp_path) -> None:
    settings = _settings(tmp_path, gpu_backend="modal", modal_token_id=None, modal_token_secret=None)
    with pytest.raises(RuntimeError, match="MODAL_TOKEN_ID"):
        build_gpu_backend(settings)


def test_build_gpu_shared_requires_url(tmp_path) -> None:
    settings = _settings(tmp_path, gpu_backend="shared_container", shared_gpu_url=None)
    with pytest.raises(RuntimeError, match="SHARED_GPU_URL"):
        build_gpu_backend(settings)


def test_build_gpu_rejects_unknown_backend(tmp_path) -> None:
    settings = _settings(tmp_path)
    settings.gpu_backend = "fictional-backend"
    with pytest.raises(RuntimeError, match="unknown gpu_backend"):
        build_gpu_backend(settings)


# ── _autodetect_gpu_backend ─────────────────────────────────────────────────


def test_autodetect_falls_back_to_cpu_when_no_cuda(monkeypatch: pytest.MonkeyPatch) -> None:
    """On a host with no cupy and no Apple Silicon, autodetect picks 'cpu'."""
    import builtins

    real_import = builtins.__import__

    def block_cupy(name: str, globals=None, locals=None, fromlist=(), level=0):
        if name == "cupy":
            raise ImportError("no cuda")
        return real_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr(builtins, "__import__", block_cupy)
    # Pretend we're on Linux x86, not Darwin/arm64.
    monkeypatch.setattr(platform, "system", lambda: "Linux")
    monkeypatch.setattr(platform, "machine", lambda: "x86_64")

    assert _autodetect_gpu_backend() == "cpu"


def test_autodetect_picks_mps_on_apple_silicon(monkeypatch: pytest.MonkeyPatch) -> None:
    import builtins

    real_import = builtins.__import__

    def block_cupy(name: str, globals=None, locals=None, fromlist=(), level=0):
        if name == "cupy":
            raise ImportError("no cuda")
        return real_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr(builtins, "__import__", block_cupy)
    monkeypatch.setattr(platform, "system", lambda: "Darwin")
    monkeypatch.setattr(platform, "machine", lambda: "arm64")

    assert _autodetect_gpu_backend() == "mps"


def test_autodetect_gpu_logs_non_import_cupy_error(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """A RuntimeError importing cupy must be logged at ERROR, not silently swallowed."""
    import builtins

    real_import = builtins.__import__

    def raise_runtime(name: str, globals=None, locals=None, fromlist=(), level=0):
        if name == "cupy":
            raise RuntimeError("cupy loaded but CUDA driver is broken")
        return real_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr(builtins, "__import__", raise_runtime)
    monkeypatch.setattr(platform, "system", lambda: "Linux")
    monkeypatch.setattr(platform, "machine", lambda: "x86_64")

    import logging

    with caplog.at_level(logging.ERROR, logger="pdomain_prep_for_pgdp.bootstrap"):
        result = _autodetect_gpu_backend()

    # Falls through to cpu after logging the unexpected error.
    assert result == "cpu"
    assert any("unexpected" in r.message.lower() or "cuda" in r.message.lower() for r in caplog.records)


# ── successful-construction paths (complement the error-path tests above) ───


def test_build_storage_s3_returns_s3storage(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    """When `storage_backend=s3` and bucket is set, build_storage returns
    an S3Storage instance. We pre-inject a fake `boto3` so the real AWS
    SDK isn't required."""
    import sys
    import types

    fake_module = types.ModuleType("boto3")
    fake_module.client = lambda _name: object()
    monkeypatch.setitem(sys.modules, "boto3", fake_module)
    sys.modules.pop("pdomain_prep_for_pgdp.adapters.storage.s3", None)

    # Reimport build_storage so it re-resolves through fake boto3.
    import importlib

    import pdomain_prep_for_pgdp.bootstrap as bs

    importlib.reload(bs)

    settings = _settings(tmp_path, storage_backend="s3", s3_data_bucket="my-bucket")
    storage = bs.build_storage(settings)
    from pdomain_prep_for_pgdp.adapters.storage.s3 import S3Storage

    assert isinstance(storage, S3Storage)


def test_build_gpu_modal_returns_modal_backend(tmp_path) -> None:
    """`gpu_backend=modal` with both tokens returns a ModalStageDispatcher."""
    from pdomain_ops.gpu import ModalStageDispatcher

    settings = _settings(
        tmp_path,
        gpu_backend="modal",
        modal_token_id="tok-id",
        modal_token_secret="tok-secret",
    )
    backend = build_gpu_backend(settings)
    assert isinstance(backend, ModalStageDispatcher)


def test_build_gpu_shared_container_returns_shared_backend(tmp_path) -> None:
    from pdomain_ops.gpu import SharedContainerStageDispatcher

    settings = _settings(
        tmp_path,
        gpu_backend="shared_container",
        shared_gpu_url="https://gpu.example.com",
        shared_gpu_api_key="key",
    )
    backend = build_gpu_backend(settings)
    assert isinstance(backend, SharedContainerStageDispatcher)


def test_build_gpu_backend_cpu_returns_noop(tmp_path) -> None:
    from pdomain_prep_for_pgdp.bootstrap import _NoOpGPUBackend

    settings = _settings(tmp_path, gpu_backend="cpu")
    assert isinstance(build_gpu_backend(settings), _NoOpGPUBackend)


def test_build_gpu_backend_mps_returns_noop(tmp_path) -> None:
    from pdomain_prep_for_pgdp.bootstrap import _NoOpGPUBackend

    settings = _settings(tmp_path, gpu_backend="mps")
    assert isinstance(build_gpu_backend(settings), _NoOpGPUBackend)


def test_build_gpu_backend_local_returns_noop(tmp_path) -> None:
    from pdomain_prep_for_pgdp.bootstrap import _NoOpGPUBackend

    settings = _settings(tmp_path, gpu_backend="local")
    assert isinstance(build_gpu_backend(settings), _NoOpGPUBackend)


def test_build_dispatcher_returns_batched_when_interval_set(tmp_path) -> None:
    """Non-zero `dispatch_interval_seconds` selects the BatchDispatcher
    (managed mode); zero selects the ImmediateDispatcher (local/self-hosted)."""
    from pdomain_prep_for_pgdp.bootstrap import build_dispatcher
    from pdomain_prep_for_pgdp.dispatcher.batched import BatchDispatcher
    from pdomain_prep_for_pgdp.dispatcher.immediate import ImmediateDispatcher

    fake_gpu = object()  # unused by dispatcher constructor
    settings_managed = _settings(tmp_path, dispatch_interval_seconds=300)
    settings_local = _settings(tmp_path, dispatch_interval_seconds=0)
    assert isinstance(build_dispatcher(settings_managed, fake_gpu), BatchDispatcher)  # type: ignore[arg-type]
    assert isinstance(build_dispatcher(settings_local, fake_gpu), ImmediateDispatcher)  # type: ignore[arg-type]
