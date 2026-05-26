"""Shared pytest fixtures.

`temp_settings` builds a Settings instance pointing at an isolated tmpdir so
every test gets a clean filesystem-storage / SQLite database / no-auth setup.

`gpu_available` is True when cupy is importable AND a working CUDA runtime
is reachable. Tests that exercise GPU-accelerated paths use
`@pytest.mark.skipif(not gpu_available, reason=...)` so they run on
CUDA hosts (incl. this devcontainer when present) and skip cleanly on
CPU-only CI.
"""

from __future__ import annotations

import importlib
from typing import TYPE_CHECKING, Protocol, cast

import pytest
from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.bootstrap import build_app
from pdomain_prep_for_pgdp.settings import Settings

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path


class _CupyCuda(Protocol):
    def is_available(self) -> bool: ...


class _CupyLike(Protocol):
    cuda: _CupyCuda | None


def _detect_gpu() -> bool:
    """True iff cupy can import AND `cupy.cuda.is_available()` succeeds.

    Both checks are needed — cupy can install without a working CUDA runtime
    (e.g. wheel mismatch) and the import succeeds but device queries fail.
    """
    try:
        cupy = cast("_CupyLike", cast("object", importlib.import_module("cupy")))
    except ImportError:
        return False
    try:
        cuda = cupy.cuda
        if cuda is None:
            return False
        return bool(cuda.is_available())
    except Exception:
        return False


gpu_available: bool = _detect_gpu()


@pytest.fixture(autouse=True)
def disable_thumbnail_pool(monkeypatch: pytest.MonkeyPatch) -> None:
    """Pin Step-2 thumbnail generation to the single-thread path under tests.

    Production default is `os.cpu_count()` worker processes for real
    thumbnail batches, but tests use 2-6 fake pages where forking a pool
    is pure overhead — and pytest-asyncio + `os.fork()` triggers a
    `DeprecationWarning: multi-threaded, use of fork() may lead to
    deadlocks in the child`. Tests that explicitly want the pool path
    pass `thumbnail_workers=2` directly to `generate_thumbnails`, which
    overrides this env var via `_resolve_thumbnail_workers`.
    """
    monkeypatch.setenv("PGDP_THUMBNAIL_WORKERS", "1")


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        host="127.0.0.1",
        port=8765,
        data_root=tmp_path / "data",
        config_dir=tmp_path / "config",
        storage_backend="filesystem",
        database_url=f"sqlite:///{(tmp_path / 'state.db').as_posix()}",
        auth_mode="none",
        gpu_backend="cpu",
        dispatch_interval_seconds=0,
    )


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    app = build_app(settings)
    with TestClient(app) as c:
        yield c


@pytest.fixture
def three_page_book_zip(tmp_path: Path) -> Path:
    """Reproducible 3-page synthetic-book zip for milestone smoke-tests.

    Generated on demand via ``tests.fixtures.three_page_book`` — no binary
    artifacts are committed to the repo. See
    ``tests/fixtures/three_page_book.py`` for shape details.
    """
    from .fixtures.three_page_book import build_three_page_book_zip

    return build_three_page_book_zip(tmp_path / "three_page_book.zip")
