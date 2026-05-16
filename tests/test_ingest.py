"""Tests-first for `core.ingest` (split into unzip + thumbnails stages).

Locks in:
  - `unzip_source` writes one PageRecord per source image, sorted, idx0
    starts at 0,
  - source files land under `source/`,
  - `s3_folder`/`local_folder` source types use list_prefix instead of
    unzipping,
  - `generate_thumbnails` writes JPGs under `thumbnails/`, populates
    `page.thumbnail_key`, and records corrupt entries as errors,
  - project status only advances to `configuring` after thumbnails finish
    (unzip leaves it at `ingesting` so the UI can render a "creating
    thumbnails" banner).
"""

from __future__ import annotations

import io
import zipfile
from datetime import UTC, datetime

import numpy as np
import pytest

from pd_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pd_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
from pd_prep_for_pgdp.core.models import (
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)


def _png(h: int, w: int, fill: int = 200) -> bytes:
    cv2 = pytest.importorskip("cv2")
    img = np.full((h, w, 3), fill, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


def _make_zip(entries: list[tuple[str, bytes]]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in entries:
            zf.writestr(name, data)
    return buf.getvalue()


def _project(project_id: str = "p1") -> Project:
    now = datetime.now(UTC)
    return Project(
        id=project_id,
        owner_id="default",
        name="Test Book",
        created_at=now,
        updated_at=now,
        status=ProjectStatus.ingesting,
        page_count=0,
        proof_page_count=0,
        config=ProjectConfig(book_name="test-book", source_uri=""),
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


# ─── unzip_source ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_unzip_zip_creates_one_page_per_image(db: SqliteDatabase, storage: FilesystemStorage) -> None:
    from pd_prep_for_pgdp.core.ingest import unzip_source

    project = _project()
    await db.put_project(project)

    zip_bytes = _make_zip(
        [
            ("page_002.png", _png(100, 80)),
            ("page_001.png", _png(100, 80)),
            ("page_003.png", _png(100, 80)),
        ]
    )
    source_key = f"projects/{project.id}/source.zip"
    await storage.put_bytes(source_key, zip_bytes)

    result = await unzip_source(
        project=project,
        source_type="zip",
        source_key=source_key,
        storage=storage,
        database=db,
    )

    assert result.page_count == 3
    assert result.errors == []

    pages, _, total = await db.list_pages(project.id, None, 100)
    assert total == 3
    assert [p.idx0 for p in pages] == [0, 1, 2]
    assert [p.source_stem for p in pages] == ["page_001", "page_002", "page_003"]
    # Source extracted; thumbnails NOT yet created (separate stage).
    for p in pages:
        assert p.source_key and await storage.exists(p.source_key)
        assert p.thumbnail_key is None


@pytest.mark.asyncio
async def test_unzip_leaves_project_in_ingesting(db: SqliteDatabase, storage: FilesystemStorage) -> None:
    from pd_prep_for_pgdp.core.ingest import unzip_source

    project = _project()
    await db.put_project(project)
    zip_bytes = _make_zip([("p.png", _png(50, 50))])
    await storage.put_bytes(f"projects/{project.id}/source.zip", zip_bytes)

    await unzip_source(
        project=project,
        source_type="zip",
        source_key=f"projects/{project.id}/source.zip",
        storage=storage,
        database=db,
    )

    refreshed = await db.get_project(project.id)
    assert refreshed is not None
    # Stays in ingesting until thumbnails finish — gives the UI a single
    # "creating thumbnails" state to render.
    assert refreshed.status == ProjectStatus.ingesting
    assert refreshed.page_count == 1


@pytest.mark.asyncio
async def test_unzip_skips_non_image_entries(db: SqliteDatabase, storage: FilesystemStorage) -> None:
    from pd_prep_for_pgdp.core.ingest import unzip_source

    project = _project()
    await db.put_project(project)
    zip_bytes = _make_zip(
        [
            ("README.txt", b"not an image"),
            ("dir/page_1.png", _png(50, 50)),
            ("dir/page_2.jpg", _png(50, 50)),
        ]
    )
    await storage.put_bytes(f"projects/{project.id}/source.zip", zip_bytes)

    result = await unzip_source(
        project=project,
        source_type="zip",
        source_key=f"projects/{project.id}/source.zip",
        storage=storage,
        database=db,
    )

    assert result.page_count == 2  # png + jpg, README skipped


@pytest.mark.asyncio
async def test_unzip_local_folder_lists_storage_prefix(
    db: SqliteDatabase, storage: FilesystemStorage
) -> None:
    from pd_prep_for_pgdp.core.ingest import unzip_source

    project = _project()
    await db.put_project(project)
    folder_prefix = f"projects/{project.id}/raw/"
    await storage.put_bytes(f"{folder_prefix}page_a.png", _png(40, 40))
    await storage.put_bytes(f"{folder_prefix}page_b.png", _png(40, 40))

    result = await unzip_source(
        project=project,
        source_type="local_folder",
        source_key=folder_prefix,
        storage=storage,
        database=db,
    )

    assert result.page_count == 2


# ─── generate_thumbnails ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_thumbnails_generates_jpgs_for_every_page(
    db: SqliteDatabase, storage: FilesystemStorage
) -> None:
    from pd_prep_for_pgdp.core.ingest import generate_thumbnails, unzip_source

    project = _project()
    await db.put_project(project)
    zip_bytes = _make_zip([("p1.png", _png(80, 60)), ("p2.png", _png(80, 60))])
    src_key = f"projects/{project.id}/source.zip"
    await storage.put_bytes(src_key, zip_bytes)
    await unzip_source(project=project, source_type="zip", source_key=src_key, storage=storage, database=db)

    refreshed = await db.get_project(project.id)
    assert refreshed is not None
    result = await generate_thumbnails(project=refreshed, storage=storage, database=db)
    assert result.page_count == 2

    pages, _, _ = await db.list_pages(project.id, None, 100)
    for p in pages:
        assert p.thumbnail_key and await storage.exists(p.thumbnail_key)


@pytest.mark.asyncio
async def test_thumbnails_advances_project_status(db: SqliteDatabase, storage: FilesystemStorage) -> None:
    from pd_prep_for_pgdp.core.ingest import generate_thumbnails, unzip_source

    project = _project()
    await db.put_project(project)
    zip_bytes = _make_zip([("p.png", _png(50, 50))])
    src_key = f"projects/{project.id}/source.zip"
    await storage.put_bytes(src_key, zip_bytes)
    await unzip_source(project=project, source_type="zip", source_key=src_key, storage=storage, database=db)
    refreshed = await db.get_project(project.id)
    assert refreshed is not None
    await generate_thumbnails(project=refreshed, storage=storage, database=db)

    final = await db.get_project(project.id)
    assert final is not None
    assert final.status == ProjectStatus.configuring


@pytest.mark.asyncio
async def test_thumbnails_records_corrupt_entries_as_errors(
    db: SqliteDatabase, storage: FilesystemStorage
) -> None:
    from pd_prep_for_pgdp.core.ingest import generate_thumbnails, unzip_source

    project = _project()
    await db.put_project(project)
    zip_bytes = _make_zip(
        [
            ("page_1.png", _png(50, 50)),
            ("page_2.png", b"not actually a png"),  # cv2.imdecode -> None
        ]
    )
    src_key = f"projects/{project.id}/source.zip"
    await storage.put_bytes(src_key, zip_bytes)
    await unzip_source(project=project, source_type="zip", source_key=src_key, storage=storage, database=db)

    refreshed = await db.get_project(project.id)
    assert refreshed is not None
    result = await generate_thumbnails(project=refreshed, storage=storage, database=db)

    # Healthy page got a thumbnail; corrupt one is recorded.
    assert result.page_count == 1
    assert any("page_2" in e for e in result.errors)


@pytest.mark.asyncio
async def test_thumbnail_source_read_error_appears_in_ingest_errors(
    db: SqliteDatabase, storage: FilesystemStorage, monkeypatch
) -> None:
    """When storage.get_bytes raises while reading source data for thumbnailing,
    the failure must appear in IngestResult.errors (not swallowed silently)."""
    from unittest.mock import patch

    from pd_prep_for_pgdp.core.ingest import generate_thumbnails, unzip_source

    project = _project()
    await db.put_project(project)
    zip_bytes = _make_zip([("page_1.png", _png(50, 50))])
    src_key = f"projects/{project.id}/source.zip"
    await storage.put_bytes(src_key, zip_bytes)
    await unzip_source(project=project, source_type="zip", source_key=src_key, storage=storage, database=db)

    refreshed = await db.get_project(project.id)
    assert refreshed is not None

    # Wrap storage.get_bytes so that reads on source keys raise, simulating a
    # missing or corrupt object-store entry.
    original_get_bytes = storage.get_bytes

    async def _failing_get_bytes(key: str) -> bytes:
        if "/source/" in key:
            raise OSError(f"simulated storage failure: {key}")
        return await original_get_bytes(key)

    with patch.object(storage, "get_bytes", side_effect=_failing_get_bytes):
        result = await generate_thumbnails(project=refreshed, storage=storage, database=db)

    assert result.errors, "expected at least one error in IngestResult.errors"
    assert any("page_1" in e for e in result.errors)
