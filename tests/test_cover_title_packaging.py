"""Tests for cover page handling in `build_package`.

P1.9 NOTE: `cover_idx0` and `title_idx0` were removed from `ProjectConfig`.
Cover pages are now identified by `page.page_type == PageType.cover`.
Title aliasing was also removed — this file only covers cover page behaviour.
The two tests here verify:

  - test_cover_image_written_when_page_type_cover: page_type=PageType.cover
    triggers cover.png alias and cover_prefix in manifest.
  - test_no_cover_when_no_cover_page: a normal-type page produces no cover.png.
"""

from __future__ import annotations

import io
import zipfile
from datetime import UTC, datetime

import pytest

from pdomain_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
from pdomain_prep_for_pgdp.core.models import (
    PageOutput,
    PageRecord,
    PageType,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.core.packaging import build_package


def _now() -> datetime:
    return datetime(2026, 5, 5, tzinfo=UTC)


def _project(project_id: str = "pc") -> Project:
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
        ),
        storage_prefix=f"projects/{project_id}/",
    )


def _page(project_id: str, idx0: int, prefix: str, page_type: PageType = PageType.normal) -> PageRecord:
    return PageRecord(
        project_id=project_id,
        idx0=idx0,
        prefix=prefix,
        source_stem=f"src_{idx0}",
        page_type=page_type,
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
async def test_cover_image_written_when_page_type_cover(tmp_path) -> None:
    """P1.9: cover is identified by page_type=PageType.cover, not cover_idx0."""
    storage = FilesystemStorage(root=tmp_path)
    project = _project("pc")
    pages = [
        _page("pc", 0, "f000", page_type=PageType.cover),
        _page("pc", 1, "f001"),
    ]
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
async def test_no_cover_when_no_cover_page(tmp_path) -> None:
    """When no page has page_type=PageType.cover, no cover.png is written."""
    storage = FilesystemStorage(root=tmp_path)
    project = _project("pc2")
    pages = [_page("pc2", 0, "f000")]  # normal type
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
