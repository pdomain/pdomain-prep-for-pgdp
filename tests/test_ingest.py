"""Tests-first for `core.ingest` (split into unzip + thumbnails stages).

Locks in:
  - `unzip_source` writes one PageRecord per source image, sorted, idx0
    starts at 0,
  - source files land under `source/`,
  - `s3_folder`/`local_folder` source types use list_prefix instead of
    unzipping,
  - `generate_thumbnails` writes JPGs to BlobStore, populates
    `thumbnail_blob_hash` in PrepPageExtension, and records corrupt
    entries as errors,
  - project status only advances to `configuring` after thumbnails finish
    (unzip leaves it at `ingesting` so the UI can render a "creating
    thumbnails" banner).
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
from pdomain_prep_for_pgdp.core.models import (
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.core.page_store_factory import build_page_service

if TYPE_CHECKING:
    from pathlib import Path


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
async def test_unzip_zip_creates_one_page_per_image(
    db: SqliteDatabase, storage: FilesystemStorage, tmp_path: Path
) -> None:
    from pdomain_ops.pages import get_extension

    from pdomain_prep_for_pgdp.core.ingest import unzip_source
    from pdomain_prep_for_pgdp.core.prep_extension import PrepPageExtension

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
    svc = build_page_service(tmp_path / "data", project.id)

    result = await unzip_source(
        project=project,
        source_type="zip",
        source_key=source_key,
        storage=storage,
        database=db,
        page_service=svc,
    )

    assert result.page_count == 3
    assert result.errors == []

    from tests.fixtures.seed_pages import _to_uuid

    proj_agg = svc.store.get_project(_to_uuid(project.id))
    assert len(proj_agg.record.page_ids) == 3
    exts = []
    for pid in proj_agg.record.page_ids:
        page_agg = svc.store.get_page(pid)
        ext = get_extension(page_agg.record, "prep", PrepPageExtension)
        if ext is not None:
            exts.append(ext)
    exts.sort(key=lambda e: e.idx0)
    assert [e.idx0 for e in exts] == [0, 1, 2]
    assert [e.source_stem for e in exts] == ["page_001", "page_002", "page_003"]
    # Source blobs stored; thumbnails NOT yet created (separate stage).
    for e in exts:
        assert e.source_blob_hash is not None
        assert e.thumbnail_blob_hash is None


@pytest.mark.asyncio
async def test_unzip_leaves_project_in_ingesting(
    db: SqliteDatabase, storage: FilesystemStorage, tmp_path: Path
) -> None:
    from pdomain_prep_for_pgdp.core.ingest import unzip_source

    project = _project()
    await db.put_project(project)
    zip_bytes = _make_zip([("p.png", _png(50, 50))])
    await storage.put_bytes(f"projects/{project.id}/source.zip", zip_bytes)
    svc = build_page_service(tmp_path / "data", project.id)

    await unzip_source(
        project=project,
        source_type="zip",
        source_key=f"projects/{project.id}/source.zip",
        storage=storage,
        database=db,
        page_service=svc,
    )

    refreshed = await db.get_project(project.id)
    assert refreshed is not None
    # Stays in ingesting until thumbnails finish -- gives the UI a single
    # "creating thumbnails" state to render.
    assert refreshed.status == ProjectStatus.ingesting
    assert refreshed.page_count == 1


@pytest.mark.asyncio
async def test_unzip_skips_non_image_entries(
    db: SqliteDatabase, storage: FilesystemStorage, tmp_path: Path
) -> None:
    from pdomain_prep_for_pgdp.core.ingest import unzip_source

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
    svc = build_page_service(tmp_path / "data", project.id)

    result = await unzip_source(
        project=project,
        source_type="zip",
        source_key=f"projects/{project.id}/source.zip",
        storage=storage,
        database=db,
        page_service=svc,
    )

    assert result.page_count == 2  # png + jpg, README skipped


@pytest.mark.asyncio
async def test_unzip_local_folder_lists_storage_prefix(
    db: SqliteDatabase, storage: FilesystemStorage, tmp_path: Path
) -> None:
    from pdomain_prep_for_pgdp.core.ingest import unzip_source

    project = _project()
    await db.put_project(project)
    folder_prefix = f"projects/{project.id}/raw/"
    await storage.put_bytes(f"{folder_prefix}page_a.png", _png(40, 40))
    await storage.put_bytes(f"{folder_prefix}page_b.png", _png(40, 40))
    svc = build_page_service(tmp_path / "data", project.id)

    result = await unzip_source(
        project=project,
        source_type="local_folder",
        source_key=folder_prefix,
        storage=storage,
        database=db,
        page_service=svc,
    )

    assert result.page_count == 2


# ─── generate_thumbnails ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_thumbnails_generates_jpgs_for_every_page(
    db: SqliteDatabase, storage: FilesystemStorage, tmp_path: Path
) -> None:

    from pdomain_ops.pages import get_extension

    from pdomain_prep_for_pgdp.core.ingest import generate_thumbnails, unzip_source
    from pdomain_prep_for_pgdp.core.prep_extension import PrepPageExtension

    project = _project()
    await db.put_project(project)
    zip_bytes = _make_zip([("p1.png", _png(80, 60)), ("p2.png", _png(80, 60))])
    src_key = f"projects/{project.id}/source.zip"
    await storage.put_bytes(src_key, zip_bytes)
    svc = build_page_service(tmp_path / "data", project.id)
    await unzip_source(
        project=project, source_type="zip", source_key=src_key, storage=storage, database=db, page_service=svc
    )

    refreshed = await db.get_project(project.id)
    assert refreshed is not None
    result = await generate_thumbnails(project=refreshed, storage=storage, database=db, page_service=svc)
    assert result.page_count == 2

    from tests.fixtures.seed_pages import _to_uuid

    proj_agg = svc.store.get_project(_to_uuid(project.id))
    for page_id in proj_agg.record.page_ids:
        page_agg = svc.store.get_page(page_id)
        ext = get_extension(page_agg.record, "prep", PrepPageExtension)
        assert ext is not None
        assert ext.thumbnail_blob_hash is not None
        assert svc.blobs.exists(ext.thumbnail_blob_hash)


@pytest.mark.asyncio
async def test_thumbnails_advances_project_status(
    db: SqliteDatabase, storage: FilesystemStorage, tmp_path: Path
) -> None:
    from pdomain_prep_for_pgdp.core.ingest import generate_thumbnails, unzip_source

    project = _project()
    await db.put_project(project)
    zip_bytes = _make_zip([("p.png", _png(50, 50))])
    src_key = f"projects/{project.id}/source.zip"
    await storage.put_bytes(src_key, zip_bytes)
    svc = build_page_service(tmp_path / "data", project.id)
    await unzip_source(
        project=project, source_type="zip", source_key=src_key, storage=storage, database=db, page_service=svc
    )
    refreshed = await db.get_project(project.id)
    assert refreshed is not None
    await generate_thumbnails(project=refreshed, storage=storage, database=db, page_service=svc)

    final = await db.get_project(project.id)
    assert final is not None
    assert final.status == ProjectStatus.configuring


@pytest.mark.asyncio
async def test_thumbnails_records_corrupt_entries_as_errors(
    db: SqliteDatabase, storage: FilesystemStorage, tmp_path: Path
) -> None:
    from pdomain_prep_for_pgdp.core.ingest import generate_thumbnails, unzip_source

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
    svc = build_page_service(tmp_path / "data", project.id)
    await unzip_source(
        project=project, source_type="zip", source_key=src_key, storage=storage, database=db, page_service=svc
    )

    refreshed = await db.get_project(project.id)
    assert refreshed is not None
    result = await generate_thumbnails(project=refreshed, storage=storage, database=db, page_service=svc)

    # Healthy page got a thumbnail; corrupt one is recorded.
    assert result.page_count == 1
    assert any("page_2" in e for e in result.errors)


@pytest.mark.asyncio
async def test_thumbnail_source_read_error_appears_in_ingest_errors(
    db: SqliteDatabase, storage: FilesystemStorage, monkeypatch, tmp_path: Path
) -> None:
    """When blobs.read raises while reading source data for thumbnailing,
    the failure must appear in IngestResult.errors (not swallowed silently)."""
    from unittest.mock import patch

    from pdomain_prep_for_pgdp.core.ingest import generate_thumbnails, unzip_source

    project = _project()
    await db.put_project(project)
    zip_bytes = _make_zip([("page_1.png", _png(50, 50))])
    src_key = f"projects/{project.id}/source.zip"
    await storage.put_bytes(src_key, zip_bytes)
    svc = build_page_service(tmp_path / "data", project.id)
    await unzip_source(
        project=project, source_type="zip", source_key=src_key, storage=storage, database=db, page_service=svc
    )

    refreshed = await db.get_project(project.id)
    assert refreshed is not None

    # Wrap blobs.read so it raises, simulating a missing or corrupt blob.

    def _failing_read(blob_hash: str) -> bytes:
        raise OSError(f"simulated blob failure: {blob_hash}")

    with patch.object(svc.blobs, "read", side_effect=_failing_read):
        result = await generate_thumbnails(project=refreshed, storage=storage, database=db, page_service=svc)

    assert result.errors, "expected at least one error in IngestResult.errors"
    assert any("page_1" in e for e in result.errors)
