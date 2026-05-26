"""Step-2 thumbnail generation parallelism — `ProcessPoolExecutor` wiring.

Locks in:
  - `_resolve_thumbnail_workers` honours an explicit override, then
    `PGDP_THUMBNAIL_WORKERS`, then falls back to `os.cpu_count()`.
  - `1` disables the pool path (single-thread fallback).
  - `>=2` actually dispatches via `ProcessPoolExecutor` with the right
    `max_workers`.
  - Final stored thumbnails preserve idx0 ordering across pages even
    when the pool returns futures out of order.
  - Per-page progress callback fires once per completed page.
  - `make test` (which ships no env override) doesn't suddenly need
    forked subprocesses for tiny test inputs.
"""

from __future__ import annotations

import io
import zipfile
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
from pdomain_prep_for_pgdp.core.models import (
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)


def _png(h: int, w: int) -> bytes:
    cv2 = pytest.importorskip("cv2")
    img = np.full((h, w, 3), 200, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


def _make_zip(entries: list[tuple[str, bytes]]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries:
            zf.writestr(name, data)
    return buf.getvalue()


def _project(project_id: str = "tp") -> Project:
    now = datetime.now(UTC)
    return Project(
        id=project_id,
        owner_id="default",
        name="t",
        created_at=now,
        updated_at=now,
        status=ProjectStatus.ingesting,
        page_count=0,
        proof_page_count=0,
        config=ProjectConfig(book_name="t", source_uri=""),
        pipeline_state=PipelineState(),
        storage_prefix=f"projects/{project_id}/",
    )


@pytest.fixture
async def db(tmp_path) -> SqliteDatabase:
    d = SqliteDatabase(f"sqlite:///{(tmp_path / 'state.db').as_posix()}")
    await d.initialize()
    return d


@pytest.fixture
def storage(tmp_path) -> FilesystemStorage:
    return FilesystemStorage(root=tmp_path / "data")


# ─── _resolve_thumbnail_workers ────────────────────────────────────────────


def test_resolve_workers_explicit_override_wins(monkeypatch) -> None:
    from pdomain_prep_for_pgdp.core.ingest import _resolve_thumbnail_workers

    monkeypatch.setenv("PGDP_THUMBNAIL_WORKERS", "8")
    assert _resolve_thumbnail_workers(override=3) == 3


def test_resolve_workers_env_when_no_override(monkeypatch) -> None:
    from pdomain_prep_for_pgdp.core.ingest import _resolve_thumbnail_workers

    monkeypatch.setenv("PGDP_THUMBNAIL_WORKERS", "5")
    assert _resolve_thumbnail_workers(override=None) == 5


def test_resolve_workers_defaults_to_cpu_count(monkeypatch) -> None:
    import os

    from pdomain_prep_for_pgdp.core.ingest import _resolve_thumbnail_workers

    monkeypatch.delenv("PGDP_THUMBNAIL_WORKERS", raising=False)
    assert _resolve_thumbnail_workers(override=None) == max(1, os.cpu_count() or 1)


def test_resolve_workers_clamps_below_one_to_one(monkeypatch) -> None:
    from pdomain_prep_for_pgdp.core.ingest import _resolve_thumbnail_workers

    monkeypatch.setenv("PGDP_THUMBNAIL_WORKERS", "0")
    assert _resolve_thumbnail_workers(override=None) == 1
    monkeypatch.setenv("PGDP_THUMBNAIL_WORKERS", "-7")
    assert _resolve_thumbnail_workers(override=None) == 1


# ─── pool wiring (uses ProcessPoolExecutor for workers >= 2) ───────────────


@pytest.mark.asyncio
async def test_pool_used_when_workers_ge_two(db, storage) -> None:
    """When `thumbnail_workers >= 2`, dispatch goes through
    `ProcessPoolExecutor` with the configured `max_workers`."""
    from pdomain_prep_for_pgdp.core import ingest as ingest_mod
    from pdomain_prep_for_pgdp.core.ingest import generate_thumbnails, unzip_source

    project = _project()
    await db.put_project(project)
    zip_bytes = _make_zip(
        [
            ("p1.png", _png(50, 50)),
            ("p2.png", _png(50, 50)),
            ("p3.png", _png(50, 50)),
            ("p4.png", _png(50, 50)),
        ]
    )
    src_key = f"projects/{project.id}/source.zip"
    await storage.put_bytes(src_key, zip_bytes)
    await unzip_source(project=project, source_type="zip", source_key=src_key, storage=storage, database=db)
    refreshed = await db.get_project(project.id)
    assert refreshed is not None

    # We patch the indirection point inside `core.ingest` rather than the
    # stdlib name, so the test exercises the production import path.
    real_executor = ingest_mod.ProcessPoolExecutor

    def _spy(*args, **kwargs):
        _spy.calls.append(kwargs)  # type: ignore[attr-defined]
        return real_executor(*args, **kwargs)

    _spy.calls = []  # type: ignore[attr-defined]

    with patch.object(ingest_mod, "ProcessPoolExecutor", _spy):
        result = await generate_thumbnails(
            project=refreshed,
            storage=storage,
            database=db,
            thumbnail_workers=2,
        )

    assert result.page_count == 4
    # Pool was constructed exactly once with the requested max_workers.
    assert len(_spy.calls) == 1  # type: ignore[attr-defined]
    assert _spy.calls[0]["max_workers"] == 2  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_pool_not_used_when_workers_is_one(db, storage) -> None:
    """`thumbnail_workers=1` keeps the single-thread path — the pool
    constructor is never reached. This is the test-suite default so
    `make test` doesn't fork subprocesses for tiny inputs."""
    from pdomain_prep_for_pgdp.core import ingest as ingest_mod
    from pdomain_prep_for_pgdp.core.ingest import generate_thumbnails, unzip_source

    project = _project()
    await db.put_project(project)
    zip_bytes = _make_zip([("a.png", _png(40, 40)), ("b.png", _png(40, 40))])
    src_key = f"projects/{project.id}/source.zip"
    await storage.put_bytes(src_key, zip_bytes)
    await unzip_source(project=project, source_type="zip", source_key=src_key, storage=storage, database=db)
    refreshed = await db.get_project(project.id)
    assert refreshed is not None

    sentinel = MagicMock(side_effect=AssertionError("ProcessPoolExecutor must not be used when workers=1"))
    with patch.object(ingest_mod, "ProcessPoolExecutor", sentinel):
        result = await generate_thumbnails(
            project=refreshed, storage=storage, database=db, thumbnail_workers=1
        )

    assert result.page_count == 2
    sentinel.assert_not_called()


@pytest.mark.asyncio
async def test_pool_preserves_thumbnail_ordering(db, storage) -> None:
    """Even when futures complete out of order, every page ends up with
    the right `thumbnail_key` (matching its idx0/source_stem) — the
    orchestrator looks up by idx0, so order at storage-write time
    shouldn't smear page identity."""
    from pdomain_prep_for_pgdp.core.ingest import generate_thumbnails, unzip_source

    project = _project()
    await db.put_project(project)
    zip_bytes = _make_zip(
        [
            ("page_001.png", _png(50, 50)),
            ("page_002.png", _png(50, 50)),
            ("page_003.png", _png(50, 50)),
            ("page_004.png", _png(50, 50)),
            ("page_005.png", _png(50, 50)),
            ("page_006.png", _png(50, 50)),
        ]
    )
    src_key = f"projects/{project.id}/source.zip"
    await storage.put_bytes(src_key, zip_bytes)
    await unzip_source(project=project, source_type="zip", source_key=src_key, storage=storage, database=db)
    refreshed = await db.get_project(project.id)
    assert refreshed is not None

    result = await generate_thumbnails(
        project=refreshed,
        storage=storage,
        database=db,
        thumbnail_workers=2,
    )
    assert result.page_count == 6
    pages, _, _ = await db.list_pages(project.id, None, 100)
    pages.sort(key=lambda p: p.idx0)
    for p in pages:
        # thumbnail_key carries the source stem — so identity-by-idx0
        # was preserved through the pool round-trip.
        assert p.thumbnail_key is not None
        assert p.source_stem in p.thumbnail_key
        assert await storage.exists(p.thumbnail_key)


@pytest.mark.asyncio
async def test_pool_progress_cb_fires_per_page(db, storage) -> None:
    """Per-page progress reports stream back from the pool — once per
    completed page, not just once at the end."""
    from pdomain_prep_for_pgdp.core.ingest import generate_thumbnails, unzip_source

    project = _project()
    await db.put_project(project)
    zip_bytes = _make_zip([(f"p{i:03d}.png", _png(40, 40)) for i in range(5)])
    src_key = f"projects/{project.id}/source.zip"
    await storage.put_bytes(src_key, zip_bytes)
    await unzip_source(project=project, source_type="zip", source_key=src_key, storage=storage, database=db)
    refreshed = await db.get_project(project.id)
    assert refreshed is not None

    seen: list[tuple[int, int, str]] = []

    async def _cb(current: int, total: int, stem: str) -> None:
        seen.append((current, total, stem))

    await generate_thumbnails(
        project=refreshed,
        storage=storage,
        database=db,
        progress_cb=_cb,
        thumbnail_workers=2,
    )

    assert len(seen) == 5
    # Final tick reports total=5; current values cover 1..5 (order-agnostic).
    assert {c for c, _, _ in seen} == {1, 2, 3, 4, 5}
    assert all(t == 5 for _, t, _ in seen)
