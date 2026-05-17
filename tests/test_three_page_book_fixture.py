"""Unit test for the ``three_page_book`` fixture helper.

Verifies the helper produces a zip with the expected entries (image
filenames, sorted, decodable). The smoke-test milestones (M1+) all start
from a `three_page_book_zip` fixture, so this test is the canary that
catches a regressed fixture before any milestone test fails downstream.
"""

from __future__ import annotations

import io
import zipfile
from typing import TYPE_CHECKING

import pytest
from PIL import Image

from tests.fixtures.three_page_book import (
    PAGE_H,
    PAGE_W,
    build_three_page_book_zip,
    page_filenames,
)

if TYPE_CHECKING:
    from pathlib import Path


def test_helper_produces_three_image_entries(tmp_path: Path) -> None:
    zpath = build_three_page_book_zip(tmp_path / "book.zip")
    assert zpath.exists()
    with zipfile.ZipFile(zpath) as zf:
        names = sorted(zf.namelist())
    assert tuple(names) == page_filenames()


def test_helper_pages_are_valid_pngs_at_canonical_size(tmp_path: Path) -> None:
    zpath = build_three_page_book_zip(tmp_path / "book.zip")
    with zipfile.ZipFile(zpath) as zf:
        for name in page_filenames():
            data = zf.read(name)
            with Image.open(io.BytesIO(data)) as im:
                assert im.format == "PNG"
                assert im.size == (PAGE_W, PAGE_H)


def test_helper_is_deterministic_across_calls(tmp_path: Path) -> None:
    """Two consecutive runs produce zips with identical per-entry payloads.

    Determinism matters because the fixture feeds dual-write reconciliation
    tests where the on-disk file's hash is asserted against an expected
    value.
    """
    a = build_three_page_book_zip(tmp_path / "a.zip")
    b = build_three_page_book_zip(tmp_path / "b.zip")
    with zipfile.ZipFile(a) as za, zipfile.ZipFile(b) as zb:
        for name in page_filenames():
            assert za.read(name) == zb.read(name), f"page {name} not deterministic"


def test_fixture_yields_zip_via_pytest_fixture(three_page_book_zip: Path) -> None:
    """The ``three_page_book_zip`` conftest fixture wires the helper up."""
    assert three_page_book_zip.exists()
    assert three_page_book_zip.suffix == ".zip"
    with zipfile.ZipFile(three_page_book_zip) as zf:
        assert sorted(zf.namelist()) == list(page_filenames())


def test_fixture_dest_parent_is_created(tmp_path: Path) -> None:
    """If the parent dir is missing, the helper creates it rather than raising."""
    nested = tmp_path / "deeply" / "nested"
    # Don't pre-create; helper must do it.
    zpath = build_three_page_book_zip(nested / "out.zip")
    assert zpath.exists()
    assert nested.is_dir()


@pytest.mark.parametrize("page_idx", [0, 1, 2])
def test_each_page_decodes_with_distinct_content(tmp_path: Path, page_idx: int) -> None:
    """The three pages must not be byte-identical — each carries a unique
    label drawn into it. Catches a regression where the helper accidentally
    wrote the same payload to all three entries."""
    zpath = build_three_page_book_zip(tmp_path / "book.zip")
    with zipfile.ZipFile(zpath) as zf:
        payloads = [zf.read(name) for name in page_filenames()]
    target = payloads[page_idx]
    others = [p for i, p in enumerate(payloads) if i != page_idx]
    for other in others:
        assert target != other
