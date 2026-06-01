"""Integration tests: unzip_source creates event-store lifecycles."""

from __future__ import annotations

import io
import uuid
import zipfile
from datetime import UTC, datetime
from pathlib import Path  # noqa: TC003
from unittest.mock import AsyncMock

import pytest
from pdomain_ops.pages import get_extension

from pdomain_prep_for_pgdp.core.ingest import unzip_source
from pdomain_prep_for_pgdp.core.models import (
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.core.page_store_factory import build_page_service
from pdomain_prep_for_pgdp.core.prep_extension import PrepPageExtension


def _make_zip_with_images(names: list[str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name in names:
            # 1x1 valid JPEG — not decoded by ingest, just stored
            zf.writestr(
                name,
                b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9",
            )
    return buf.getvalue()


def _make_project(project_id: str) -> Project:
    return Project(
        id=project_id,
        name="Test Book",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
        status=ProjectStatus.ingesting,
        page_count=0,
        proof_page_count=0,
        config=ProjectConfig(
            book_name="Test",
            source_uri="test.zip",
            proof_start_idx0=0,
            proof_end_idx0=999,
        ),
        pipeline_state=PipelineState(),
        storage_prefix="",
    )


@pytest.mark.asyncio
async def test_unzip_creates_page_aggregates(tmp_path: Path) -> None:
    project_id = str(uuid.uuid4())
    zip_bytes = _make_zip_with_images(["img001.jpg", "img002.jpg"])
    project = _make_project(project_id)

    storage = AsyncMock()
    storage.get_bytes = AsyncMock(return_value=zip_bytes)
    storage.put_bytes = AsyncMock()

    database = AsyncMock()
    database.get_project = AsyncMock(return_value=project)
    database.put_project = AsyncMock()
    database.put_pages = AsyncMock()

    service = build_page_service(tmp_path, project_id)

    result = await unzip_source(
        project=project,
        source_type="zip",
        source_key="test.zip",
        storage=storage,
        database=database,
        page_service=service,
    )

    assert result.page_count == 2

    proj_uuid = uuid.UUID(project_id)
    proj_agg = service.store.get_project(proj_uuid)
    assert len(proj_agg.record.page_ids) == 2

    for page_uuid in proj_agg.record.page_ids:
        page_agg = service.store.get_page(page_uuid)
        ext = get_extension(page_agg.record, "prep", PrepPageExtension)
        assert ext is not None
        assert ext.project_id == project_id
        assert ext.source_blob_hash is not None


@pytest.mark.asyncio
async def test_unzip_no_legacy_pages_table_writes(tmp_path: Path) -> None:
    """IDatabase.put_pages must NOT be called — pages live in event store only."""
    project_id = str(uuid.uuid4())
    zip_bytes = _make_zip_with_images(["img001.jpg"])
    project = _make_project(project_id)

    storage = AsyncMock()
    storage.get_bytes = AsyncMock(return_value=zip_bytes)
    storage.put_bytes = AsyncMock()
    database = AsyncMock()
    database.get_project = AsyncMock(return_value=project)
    database.put_project = AsyncMock()
    database.put_pages = AsyncMock()

    service = build_page_service(tmp_path, project_id)

    await unzip_source(
        project=project,
        source_type="zip",
        source_key="test.zip",
        storage=storage,
        database=database,
        page_service=service,
    )

    database.put_pages.assert_not_called()


@pytest.mark.asyncio
async def test_generate_thumbnails_writes_blob_hash(tmp_path: Path) -> None:
    """generate_thumbnails writes thumbnail to BlobStore + updates extension."""
    import uuid as _uuid

    import cv2
    import numpy as np

    project_id = str(_uuid.uuid4())
    project = _make_project(project_id)
    service = build_page_service(tmp_path, project_id)

    page_id = _uuid.uuid4()
    project_uuid = _uuid.UUID(project_id)

    # Synthesise a tiny valid 10x10 white PNG
    white_img = np.ones((10, 10, 3), dtype=np.uint8) * 255
    ok, buf = cv2.imencode(".jpg", white_img)
    assert ok
    source_bytes = bytes(buf.tobytes())
    source_hash = service.blobs.write(source_bytes)

    from pdomain_ops.page_aggregate import PageAggregate, ProjectAggregate
    from pdomain_ops.pages import PageRecord as OpsPageRecord
    from pdomain_ops.pages import ProjectRecord, get_extension, set_extension

    ops_record = OpsPageRecord(page_id=page_id, page_index=0, source="raw")
    ext = PrepPageExtension(
        project_id=project_id,
        idx0=0,
        prefix="",
        source_stem="img001",
        source_blob_hash=source_hash,
    )
    set_extension(ops_record, "prep", ext)
    page_agg = PageAggregate(record=ops_record)
    service.store.save_page(page_agg)

    proj_record = ProjectRecord(project_id=project_uuid, name="Test")
    proj_agg = ProjectAggregate(record=proj_record)
    proj_agg.add_page(page_id=page_id, page_index=0)
    service.store.save_project(proj_agg)

    from pdomain_prep_for_pgdp.core.ingest import generate_thumbnails

    database = AsyncMock()
    database.get_project = AsyncMock(return_value=project)
    database.put_project = AsyncMock()

    result = await generate_thumbnails(
        project=project,
        storage=AsyncMock(),
        database=database,
        page_service=service,
        thumbnail_workers=1,
    )

    assert result.page_count == 1

    # Reload from a FRESH PageService (new app/repository instance) — proves
    # thumbnail_blob_hash survives via event-store replay, not any sidecar.
    fresh_service = build_page_service(tmp_path, project_id)
    reloaded_agg = fresh_service.store.get_page(page_id)
    reloaded_ext = get_extension(reloaded_agg.record, "prep", PrepPageExtension)
    assert reloaded_ext is not None
    assert reloaded_ext.thumbnail_blob_hash is not None
    assert fresh_service.blobs.exists(reloaded_ext.thumbnail_blob_hash)
