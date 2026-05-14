"""Issue #2 — pyoxipng integration.

Tests for:
  - ``_optimize_png`` helper: output is a valid PNG and ≤ input size.
  - ``build_package`` with ``optimize_png=True``: PNGs in the zip are valid.
  - ``build_package`` with ``optimize_png=False``: pass-through (no oxipng call).
  - ``ProjectConfig.optimize_png`` flag propagates into ``build_package``.
"""

from __future__ import annotations

import io
import struct
import zipfile
import zlib
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
from pd_prep_for_pgdp.core.packaging import _optimize_png, build_package

# ─── PNG factory ─────────────────────────────────────────────────────────────


def _make_png(width: int = 8, height: int = 8) -> bytes:
    """Produce a minimal uncompressed-filter-0 RGB PNG of `width` x `height` white pixels.

    The PNG is intentionally NOT pre-optimised so oxipng has something to do
    (or at minimum preserves size).
    """

    def _chunk(name: bytes, data: bytes) -> bytes:
        payload = name + data
        crc = struct.pack(">I", zlib.crc32(payload) & 0xFFFFFFFF)
        return struct.pack(">I", len(data)) + payload + crc

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    ihdr = _chunk(b"IHDR", ihdr_data)
    # Each row: filter byte (0) + width RGB triples (white = 0xff 0xff 0xff)
    row = b"\x00" + b"\xff\xff\xff" * width
    raw_rows = row * height
    idat = _chunk(b"IDAT", zlib.compress(raw_rows))
    iend = _chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


def _is_valid_png(data: bytes) -> bool:
    """Return True iff `data` starts with the PNG signature."""
    return data[:8] == b"\x89PNG\r\n\x1a\n"


# ─── _optimize_png unit tests ─────────────────────────────────────────────────


def test_optimize_png_returns_valid_png() -> None:
    png = _make_png(16, 16)
    result = _optimize_png(png)
    assert _is_valid_png(result), "optimised bytes must be a valid PNG"


def test_optimize_png_size_not_larger() -> None:
    png = _make_png(32, 32)
    result = _optimize_png(png)
    assert len(result) <= len(png), f"optimised size ({len(result)}) must not exceed input ({len(png)})"


def test_optimize_png_fallback_on_bad_input() -> None:
    """Non-PNG bytes must not raise — fallback to original."""
    bad = b"this is not a png at all"
    result = _optimize_png(bad)
    assert result == bad, "fallback must return original bytes unchanged"


# ─── Helpers ─────────────────────────────────────────────────────────────────


def _now() -> datetime:
    return datetime(2026, 5, 14, tzinfo=UTC)


def _project(project_id: str = "opt1", *, optimize_png: bool = True) -> Project:
    return Project(
        id=project_id,
        owner_id="default",
        name="Optimize Test Book",
        created_at=_now(),
        updated_at=_now(),
        status=ProjectStatus.complete,
        page_count=1,
        proof_page_count=1,
        config=ProjectConfig(
            book_name="opt-book",
            source_uri="",
            optimize_png=optimize_png,
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


# ─── build_package integration tests ────────────────────────────────────────


@pytest.mark.asyncio
async def test_build_package_with_optimize_png_true(tmp_path) -> None:
    """PNG in the zip must be valid and ≤ the raw input size."""
    storage = FilesystemStorage(root=tmp_path)
    project = _project("opt2", optimize_png=True)
    pages = [_page("opt2", idx0=0, prefix="p001")]
    raw_png = _make_png(32, 32)
    for page in pages:
        for output in page.outputs:
            await storage.put_bytes(output.for_zip_image_key, raw_png)
            await storage.put_bytes(output.for_zip_text_key, b"page text")

    result = await build_package(project=project, pages=pages, storage=storage)
    assert result.page_count == 1

    zip_bytes = await storage.get_bytes(result.package_key)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        png_out = zf.read("p001.png")

    assert _is_valid_png(png_out), "packaged PNG must be valid"
    assert len(png_out) <= len(raw_png), (
        f"packaged PNG ({len(png_out)} B) must not exceed input ({len(raw_png)} B)"
    )


@pytest.mark.asyncio
async def test_build_package_with_optimize_png_false(tmp_path) -> None:
    """When optimize_png=False, PNG bytes in the zip equal the raw input."""
    storage = FilesystemStorage(root=tmp_path)
    project = _project("opt3", optimize_png=False)
    pages = [_page("opt3", idx0=0, prefix="p001")]
    raw_png = _make_png(32, 32)
    for page in pages:
        for output in page.outputs:
            await storage.put_bytes(output.for_zip_image_key, raw_png)
            await storage.put_bytes(output.for_zip_text_key, b"page text")

    result = await build_package(project=project, pages=pages, storage=storage)
    zip_bytes = await storage.get_bytes(result.package_key)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        png_out = zf.read("p001.png")

    assert png_out == raw_png, "unoptimised build must write raw bytes unchanged"


@pytest.mark.asyncio
async def test_build_package_optimize_png_kwarg_overrides_config(tmp_path) -> None:
    """The optimize_png kwarg must override project.config.optimize_png."""
    storage = FilesystemStorage(root=tmp_path)
    # Config says True, but caller passes False — should skip optimisation.
    project = _project("opt4", optimize_png=True)
    pages = [_page("opt4", idx0=0, prefix="p001")]
    raw_png = _make_png(32, 32)
    for page in pages:
        for output in page.outputs:
            await storage.put_bytes(output.for_zip_image_key, raw_png)
            await storage.put_bytes(output.for_zip_text_key, b"page text")

    result = await build_package(project=project, pages=pages, storage=storage, optimize_png=False)
    zip_bytes = await storage.get_bytes(result.package_key)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        png_out = zf.read("p001.png")

    assert png_out == raw_png, "kwarg False must suppress optimisation despite config True"
