"""Tests-first for cover/title page handling in `build_package`.

Spec 02 has `cover_idx0` and `title_idx0` on `ProjectConfig` but no pipeline
path consumed them yet. PGDP packages typically expect the cover image
named `cover.png` and the title page is preserved with its normal prefix.

Locks in:
  - when `cover_idx0` is set and the page has a proofing image, the zip
    contains `cover.png` (in addition to the normal page entry),
  - the manifest includes a `"cover_prefix"` field pointing at the cover
    page's source_stem,
  - when `cover_idx0` is None, no cover.png is written.
"""

from __future__ import annotations

import io
import zipfile
from datetime import UTC, datetime

import pytest

from pd_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
from pd_prep_for_pgdp.core.models import (
    PageOutput,
    PageRecord,
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pd_prep_for_pgdp.core.packaging import build_package


def _now() -> datetime:
    return datetime(2026, 5, 5, tzinfo=UTC)


def _project(project_id: str = "pc", *, cover_idx0: int | None = None) -> Project:
    return Project(
        id=project_id,
        owner_id="default",
        name="With Cover",
        created_at=_now(),
        updated_at=_now(),
        status=ProjectStatus.complete,
        page_count=2,
        proof_page_count=2,
        config=ProjectConfig(
            book_name="cover-book",
            source_uri="",
            cover_idx0=cover_idx0,
        ),
        pipeline_state=PipelineState(),
        storage_prefix=f"projects/{project_id}/",
    )


def _page(project_id: str, idx0: int, prefix: str) -> PageRecord:
    return PageRecord(
        project_id=project_id,
        idx0=idx0,
        prefix=prefix,
        source_stem=f"src_{idx0}",
        outputs=[
            PageOutput(
                full_prefix=prefix,
                split_suffix=None,
                reading_order=0,
                for_zip_image_key=f"projects/{project_id}/for_zip/{prefix}.png",
                for_zip_text_key=f"projects/{project_id}/for_zip/{prefix}.txt",
            )
        ],
    )


@pytest.mark.asyncio
async def test_cover_image_written_when_cover_idx0_set(tmp_path) -> None:
    storage = FilesystemStorage(root=tmp_path)
    project = _project("pc", cover_idx0=0)
    pages = [_page("pc", 0, "f000"), _page("pc", 1, "f001")]
    for page in pages:
        for output in page.outputs:
            await storage.put_bytes(output.for_zip_image_key, f"png-{page.prefix}".encode())
            await storage.put_bytes(output.for_zip_text_key, f"txt-{page.prefix}".encode())

    result = await build_package(project=project, pages=pages, storage=storage)

    zip_bytes = await storage.get_bytes(result.package_key)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = set(zf.namelist())
        # Both regular page entries plus a cover.png alias.
        assert "f000.png" in names
        assert "f001.png" in names
        assert "cover.png" in names
        # cover.png is the same bytes as the cover page's image.
        assert zf.read("cover.png") == b"png-f000"

        import json

        manifest = json.loads(zf.read("pgdp.json"))
        assert manifest.get("cover_prefix") == "f000"


@pytest.mark.asyncio
async def test_no_cover_when_cover_idx0_is_none(tmp_path) -> None:
    storage = FilesystemStorage(root=tmp_path)
    project = _project("pc2")
    pages = [_page("pc2", 0, "f000")]
    for output in pages[0].outputs:
        await storage.put_bytes(output.for_zip_image_key, b"x")
        await storage.put_bytes(output.for_zip_text_key, b"x")

    result = await build_package(project=project, pages=pages, storage=storage)
    zip_bytes = await storage.get_bytes(result.package_key)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = set(zf.namelist())
        assert "cover.png" not in names

        import json

        manifest = json.loads(zf.read("pgdp.json"))
        assert "cover_prefix" not in manifest or manifest["cover_prefix"] is None
