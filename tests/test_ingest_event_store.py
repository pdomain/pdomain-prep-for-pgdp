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
