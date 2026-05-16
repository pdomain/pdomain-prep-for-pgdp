"""Step 10 — build_package zip assembly.

Written tests-first to nail down the package-key naming, the manifest shape,
and the inclusion rules for splits / illustrations.
"""

from __future__ import annotations

import io
import json
import zipfile
from datetime import UTC, datetime

import pytest

import pd_prep_for_pgdp.core.packaging as packaging_mod
from pd_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
from pd_prep_for_pgdp.core.models import (
    IllustrationRegion,
    PageOutput,
    PageRecord,
    PageType,
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pd_prep_for_pgdp.core.packaging import build_package


def _now() -> datetime:
    return datetime(2026, 5, 5, tzinfo=UTC)


def _project(project_id: str = "abc") -> Project:
    return Project(
        id=project_id,
        owner_id="default",
        name="Belloc — The Four Men",
        created_at=_now(),
        updated_at=_now(),
        status=ProjectStatus.complete,
        page_count=2,
        proof_page_count=2,
        config=ProjectConfig(book_name="four-men", source_uri=""),
        pipeline_state=PipelineState(),
        storage_prefix=f"projects/{project_id}/",
    )


def _page(
    project_id: str,
    idx0: int,
    prefix: str,
    *,
    splits=(),
    illustration_regions=(),
    page_type: PageType = PageType.normal,
    ignore: bool = False,
) -> PageRecord:
    outputs: list[PageOutput] = []
    if splits:
        for i, suffix in enumerate(splits):
            outputs.append(
                PageOutput(
                    full_prefix=f"{prefix}{suffix}",
                    split_suffix=suffix,
                    reading_order=i,
                    for_zip_image_key=f"projects/{project_id}/for_zip/{prefix}{suffix}.png",
                    for_zip_text_key=f"projects/{project_id}/for_zip/{prefix}{suffix}.txt",
                )
            )
    else:
        outputs.append(
            PageOutput(
                full_prefix=prefix,
                split_suffix=None,
                reading_order=0,
                for_zip_image_key=f"projects/{project_id}/for_zip/{prefix}.png",
                for_zip_text_key=f"projects/{project_id}/for_zip/{prefix}.txt",
            )
        )
    return PageRecord(
        project_id=project_id,
        idx0=idx0,
        prefix=prefix,
        source_stem=f"src_{idx0}",
        page_type=page_type,
        ignore=ignore,
        outputs=outputs,
        illustration_regions=list(illustration_regions),
    )


@pytest.mark.asyncio
async def test_build_package_minimal_two_pages(tmp_path) -> None:
    storage = FilesystemStorage(root=tmp_path)
    project = _project("p1")
    pages = [
        _page("p1", idx0=0, prefix="p001"),
        _page("p1", idx0=1, prefix="p002"),
    ]
    # Seed for_zip artefacts.
    for page in pages:
        for output in page.outputs:
            await storage.put_bytes(output.for_zip_image_key, b"\x89PNG-fake-" + page.prefix.encode())
            await storage.put_bytes(output.for_zip_text_key, f"text for {page.prefix}".encode())

    result = await build_package(project=project, pages=pages, storage=storage)

    assert result.page_count == 2
    assert result.illustration_count == 0
    assert result.package_key == "projects/p1/for_zip/four-men.zip"

    zip_bytes = await storage.get_bytes(result.package_key)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = set(zf.namelist())
        assert "p001.png" in names
        assert "p001.txt" in names
        assert "p002.png" in names
        assert "p002.txt" in names
        assert "pgdp.json" in names

        manifest = json.loads(zf.read("pgdp.json"))
        assert manifest["book_name"] == "four-men"
        assert manifest["page_count"] == 2
        assert manifest["illustration_count"] == 0
        assert [p["prefix"] for p in manifest["pages"]] == ["p001", "p002"]


@pytest.mark.asyncio
async def test_build_package_skips_ignored_pages(tmp_path) -> None:
    storage = FilesystemStorage(root=tmp_path)
    project = _project("p2")
    pages = [
        _page("p2", idx0=0, prefix="p001"),
        _page("p2", idx0=1, prefix="p002", ignore=True),
    ]
    for page in pages:
        for output in page.outputs:
            await storage.put_bytes(output.for_zip_image_key, b"x")
            await storage.put_bytes(output.for_zip_text_key, b"x")

    result = await build_package(project=project, pages=pages, storage=storage)
    assert result.page_count == 1


@pytest.mark.asyncio
async def test_build_package_includes_split_outputs_in_reading_order(tmp_path) -> None:
    storage = FilesystemStorage(root=tmp_path)
    project = _project("p3")
    pages = [_page("p3", idx0=0, prefix="p001", splits=("a", "b"))]
    for output in pages[0].outputs:
        await storage.put_bytes(output.for_zip_image_key, b"x")
        await storage.put_bytes(output.for_zip_text_key, b"x")

    result = await build_package(project=project, pages=pages, storage=storage)
    assert result.page_count == 2  # one per split

    zip_bytes = await storage.get_bytes(result.package_key)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = zf.namelist()
        # Both split files present
        assert "p001a.png" in names
        assert "p001b.png" in names


@pytest.mark.asyncio
async def test_build_package_collects_illustrations(tmp_path) -> None:
    storage = FilesystemStorage(root=tmp_path)
    project = _project("p4")
    pages = [
        _page(
            "p4",
            idx0=0,
            prefix="p007",
            illustration_regions=[
                IllustrationRegion(index=1, L=0, R=10, T=0, B=10, output_format="jpg"),
                IllustrationRegion(index=2, L=0, R=10, T=0, B=10, output_format="png"),
            ],
        ),
    ]
    for output in pages[0].outputs:
        await storage.put_bytes(output.for_zip_image_key, b"x")
        await storage.put_bytes(output.for_zip_text_key, b"x")
    await storage.put_bytes("projects/p4/hi_res/p007_01.jpg", b"jpegbytes")
    await storage.put_bytes("projects/p4/hi_res/p007_02.png", b"pngbytes")

    result = await build_package(project=project, pages=pages, storage=storage)
    assert result.illustration_count == 2

    zip_bytes = await storage.get_bytes(result.package_key)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        assert "images/p007_01.jpg" in zf.namelist()
        assert "images/p007_02.png" in zf.namelist()


@pytest.mark.asyncio
async def test_oxipng_skip_counted_in_result(monkeypatch, tmp_path) -> None:
    """When oxipng fails, PackagingResult.oxipng_skipped_pages is incremented
    and the page is still written (original bytes used)."""
    monkeypatch.setattr(
        packaging_mod.oxipng,
        "optimize_from_memory",
        lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("corrupt PNG")),
    )

    storage = FilesystemStorage(root=tmp_path)
    project = _project("p5")
    pages = [
        _page("p5", idx0=0, prefix="p001"),
        _page("p5", idx0=1, prefix="p002"),
    ]
    for page in pages:
        for output in page.outputs:
            await storage.put_bytes(output.for_zip_image_key, b"\x89PNG-fake")
            await storage.put_bytes(output.for_zip_text_key, b"text")

    result = await build_package(project=project, pages=pages, storage=storage, optimize_png=True)

    # Both pages still written — skips must never drop pages.
    assert result.page_count == 2
    # Both oxipng calls failed, so both pages counted as skipped.
    assert result.oxipng_skipped_pages == 2


@pytest.mark.asyncio
async def test_oxipng_skip_zero_when_optimize_disabled(tmp_path) -> None:
    """When optimize_png=False, oxipng is never called and the skip counter stays 0."""
    storage = FilesystemStorage(root=tmp_path)
    project = _project("p6")
    pages = [_page("p6", idx0=0, prefix="p001")]
    for output in pages[0].outputs:
        await storage.put_bytes(output.for_zip_image_key, b"\x89PNG-fake")
        await storage.put_bytes(output.for_zip_text_key, b"text")

    result = await build_package(project=project, pages=pages, storage=storage, optimize_png=False)

    assert result.oxipng_skipped_pages == 0
