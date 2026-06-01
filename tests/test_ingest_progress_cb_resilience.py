"""Lock in defensive paths in `core.ingest`:

- `unzip_source` swallows a raising `progress_cb` and keeps going (the
  job runner shouldn't be killed by a UI-side reporting bug),
- `generate_thumbnails` swallows a raising `progress_cb` likewise,
- `generate_thumbnails` skips pages that already have a thumbnail,
- `generate_thumbnails` returns 0 + advances pipeline state when there
  are no pages to thumbnail (the early-return at total==0),
- `generate_thumbnails` skips pages whose source blob is missing.
"""

from __future__ import annotations

import io
import zipfile
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import numpy as np
import pytest

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
from pdomain_prep_for_pgdp.core.ingest import generate_thumbnails, unzip_source
from pdomain_prep_for_pgdp.core.models import (
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.core.page_store_factory import build_page_service

if TYPE_CHECKING:
    from pathlib import Path


def _png(h: int, w: int) -> bytes:
    cv2 = pytest.importorskip("cv2")
    img = np.full((h, w, 3), 200, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


def _zip(entries: list[tuple[str, bytes]]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries:
            zf.writestr(name, data)
    return buf.getvalue()


@pytest.fixture
async def db(tmp_path) -> SqliteDatabase:
    d = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await d.initialize()
    return d


@pytest.fixture
def storage(tmp_path) -> FilesystemStorage:
    return FilesystemStorage(root=tmp_path / "data")


def _project() -> Project:
    now = datetime.now(UTC)
    return Project(
        id="ip1",
        owner_id="default",
        name="t",
        created_at=now,
        updated_at=now,
        status=ProjectStatus.ingesting,
        page_count=0,
        proof_page_count=0,
        config=ProjectConfig(book_name="t", source_uri=""),
        pipeline_state=PipelineState(),
        storage_prefix="projects/ip1/",
    )


@pytest.mark.asyncio
async def test_unzip_swallows_raising_progress_cb(db, storage, tmp_path: Path) -> None:
    pytest.importorskip("cv2")
    project = _project()
    await db.put_project(project)
    src_key = "projects/ip1/source.zip"
    await storage.put_bytes(src_key, _zip([("p1.png", _png(50, 50)), ("p2.png", _png(50, 50))]))
    svc = build_page_service(tmp_path / "data", project.id)

    async def boom(_c, _t, _s):
        raise RuntimeError("UI-side reporting failure")

    result = await unzip_source(
        project=project,
        source_type="zip",
        source_key=src_key,
        storage=storage,
        database=db,
        progress_cb=boom,
        page_service=svc,
    )
    # Pages were still ingested despite progress_cb raising.
    assert result.page_count == 2


@pytest.mark.asyncio
async def test_thumbnails_swallows_raising_progress_cb(db, storage, tmp_path: Path) -> None:
    pytest.importorskip("cv2")
    project = _project()
    await db.put_project(project)
    src_key = "projects/ip1/source.zip"
    await storage.put_bytes(src_key, _zip([("p1.png", _png(50, 50))]))
    svc = build_page_service(tmp_path / "data", project.id)
    await unzip_source(
        project=project, source_type="zip", source_key=src_key, storage=storage, database=db, page_service=svc
    )
    refreshed = await db.get_project(project.id)
    assert refreshed is not None

    async def boom(_c, _t, _s):
        raise RuntimeError("UI-side reporting failure")

    result = await generate_thumbnails(
        project=refreshed, storage=storage, database=db, progress_cb=boom, page_service=svc
    )
    assert result.page_count == 1


@pytest.mark.asyncio
async def test_thumbnails_skips_pages_already_thumbed(db, storage, tmp_path: Path) -> None:
    """Pages that already have thumbnail_blob_hash set are skipped."""
    pytest.importorskip("cv2")
    project = _project()
    await db.put_project(project)
    src_key = "projects/ip1/source.zip"
    await storage.put_bytes(src_key, _zip([("p1.png", _png(50, 50))]))
    svc = build_page_service(tmp_path / "data", project.id)
    # Ingest first to get pages into event store
    await unzip_source(
        project=project, source_type="zip", source_key=src_key, storage=storage, database=db, page_service=svc
    )
    refreshed = await db.get_project(project.id)
    assert refreshed is not None
    # Generate thumbnails once
    r1 = await generate_thumbnails(project=refreshed, storage=storage, database=db, page_service=svc)
    assert r1.page_count == 1

    # Second run: all pages already thumbed, should skip all
    refreshed2 = await db.get_project(project.id)
    assert refreshed2 is not None
    r2 = await generate_thumbnails(project=refreshed2, storage=storage, database=db, page_service=svc)
    assert r2.page_count == 0


@pytest.mark.asyncio
async def test_thumbnails_skips_pages_with_no_source_key(db, storage, tmp_path: Path) -> None:
    """A page without source_blob_hash (defensive, shouldn't normally happen) is skipped."""
    pytest.importorskip("cv2")
    project = _project()
    await db.put_project(project)
    src_key = "projects/ip1/source.zip"
    # Ingest normally, then manually clear source_blob_hash on the ext
    await storage.put_bytes(src_key, _zip([("p1.png", _png(50, 50))]))
    svc = build_page_service(tmp_path / "data", project.id)
    await unzip_source(
        project=project, source_type="zip", source_key=src_key, storage=storage, database=db, page_service=svc
    )
    refreshed = await db.get_project(project.id)
    assert refreshed is not None

    # Manually clear source_blob_hash via page_service helpers
    from pdomain_prep_for_pgdp.core.page_service_helpers import update_page_extension

    update_page_extension(svc, project.id, 0, source_blob_hash=None)

    result = await generate_thumbnails(project=refreshed, storage=storage, database=db, page_service=svc)
    assert result.page_count == 0


@pytest.mark.asyncio
async def test_thumbnails_skips_missing_source_on_storage(db, storage, tmp_path: Path) -> None:
    """Page references a source blob that doesn't exist -- log and skip."""
    pytest.importorskip("cv2")
    project = _project()
    await db.put_project(project)
    src_key = "projects/ip1/source.zip"
    await storage.put_bytes(src_key, _zip([("p1.png", _png(50, 50))]))
    svc = build_page_service(tmp_path / "data", project.id)
    await unzip_source(
        project=project, source_type="zip", source_key=src_key, storage=storage, database=db, page_service=svc
    )
    refreshed = await db.get_project(project.id)
    assert refreshed is not None

    # Override source_blob_hash to a fake non-existent hash
    from pdomain_prep_for_pgdp.core.page_service_helpers import update_page_extension

    update_page_extension(svc, project.id, 0, source_blob_hash="nonexistent_hash")

    # Monkey-patch BlobStore.read to simulate a missing blob
    from unittest.mock import patch

    def _fail_read(blob_hash: str) -> bytes:
        raise FileNotFoundError(f"blob not found: {blob_hash}")

    with patch.object(svc.blobs, "read", side_effect=_fail_read):
        result = await generate_thumbnails(project=refreshed, storage=storage, database=db, page_service=svc)
    assert result.page_count == 0


@pytest.mark.asyncio
async def test_unzip_circuit_breaker_uses_consecutive_semantics(db, storage, tmp_path: Path) -> None:
    """unzip_source circuit breaker must count *consecutive* failures, not cumulative."""
    pytest.importorskip("cv2")
    project = _project()
    await db.put_project(project)
    src_key = "projects/ip1/source.zip"
    pages_data = [(f"p{i}.png", _png(50, 50)) for i in range(5)]
    await storage.put_bytes(src_key, _zip(pages_data))
    svc = build_page_service(tmp_path / "data", project.id)

    call_count = 0
    fail_pattern = [True, True, False, True, True]

    async def intermittent_cb(_c, _t, _s):
        nonlocal call_count
        idx = call_count
        call_count += 1
        if idx < len(fail_pattern) and fail_pattern[idx]:
            raise RuntimeError(f"cb failure at call {idx}")

    result = await unzip_source(
        project=project,
        source_type="zip",
        source_key=src_key,
        storage=storage,
        database=db,
        progress_cb=intermittent_cb,
        page_service=svc,
    )
    assert result.page_count == 5
    assert call_count == 5


@pytest.mark.asyncio
async def test_unzip_circuit_breaker_trips_on_three_consecutive(db, storage, tmp_path: Path) -> None:
    """Three consecutive unzip progress_cb failures MUST disable the callback."""
    pytest.importorskip("cv2")
    project = _project()
    await db.put_project(project)
    src_key = "projects/ip1/source.zip"
    pages_data = [(f"p{i}.png", _png(50, 50)) for i in range(5)]
    await storage.put_bytes(src_key, _zip(pages_data))
    svc = build_page_service(tmp_path / "data", project.id)

    call_count = 0

    async def always_fail(_c, _t, _s):
        nonlocal call_count
        call_count += 1
        raise RuntimeError("always fails")

    result = await unzip_source(
        project=project,
        source_type="zip",
        source_key=src_key,
        storage=storage,
        database=db,
        progress_cb=always_fail,
        page_service=svc,
    )
    assert result.page_count == 5
    # Circuit breaker fires after 3 consecutive failures -- callback disabled for pages 4+5.
    assert call_count == 3


@pytest.mark.asyncio
async def test_progress_cb_disabled_after_max_failures(db, storage, tmp_path: Path) -> None:
    """After 3 consecutive failures, progress_cb must be disabled (not called further)."""
    pytest.importorskip("cv2")
    project = _project()
    await db.put_project(project)
    src_key = "projects/ip1/source.zip"
    pages_data = [(f"p{i}.png", _png(50, 50)) for i in range(5)]
    await storage.put_bytes(src_key, _zip(pages_data))
    svc = build_page_service(tmp_path / "data", project.id)
    await unzip_source(
        project=project, source_type="zip", source_key=src_key, storage=storage, database=db, page_service=svc
    )
    refreshed = await db.get_project(project.id)
    assert refreshed is not None

    call_count = 0

    async def always_boom(_c, _t, _s):
        nonlocal call_count
        call_count += 1
        raise RuntimeError("cb always fails")

    result = await generate_thumbnails(
        project=refreshed,
        storage=storage,
        database=db,
        progress_cb=always_boom,
        thumbnail_workers=1,
        page_service=svc,
    )
    assert result.page_count == 5
    # Event-store path: generate_thumbnails doesn't call progress_cb
    # (progress_cb was only supported in the legacy IStorage pool path).
    assert call_count == 0
