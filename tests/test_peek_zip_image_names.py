"""Cover `peek_zip_image_names` — the pure helper behind P2 #8 (source preview).

The helper inspects a raw zip byte string without extracting payloads and
returns a sorted list of image-bearing filenames plus the total image count.
Used by the source-preview endpoint to render a thumbnail strip before the
ingest job actually decodes anything.
"""

from __future__ import annotations

import io
import zipfile

from pdomain_prep_for_pgdp.core.ingest import peek_zip_image_names


def _make_zip(entries: list[tuple[str, bytes]]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in entries:
            zf.writestr(name, data)
    return buf.getvalue()


def test_returns_sorted_image_names_and_total_count() -> None:
    raw = _make_zip(
        [
            ("img_002.png", b"x"),
            ("img_001.png", b"y"),
            ("img_003.JPG", b"z"),
            ("notes.txt", b"skip me"),
        ]
    )
    names, total = peek_zip_image_names(raw, limit=10)
    assert total == 3
    # Sorted by filename so the preview strip matches enumeration order.
    assert names == ["img_001.png", "img_002.png", "img_003.JPG"]


def test_limit_truncates_returned_names_but_total_counts_all() -> None:
    raw = _make_zip([(f"page_{i:03d}.png", b"x") for i in range(15)])
    names, total = peek_zip_image_names(raw, limit=5)
    assert total == 15
    assert len(names) == 5
    assert names == [f"page_{i:03d}.png" for i in range(5)]


def test_skips_directories_and_non_image_extensions() -> None:
    raw = _make_zip(
        [
            ("subdir/", b""),
            ("subdir/page1.png", b"x"),
            ("readme.md", b"skip"),
            ("page2.tiff", b"y"),
        ]
    )
    names, total = peek_zip_image_names(raw, limit=10)
    assert total == 2
    # Filename comparison is on the basename for sort stability.
    assert sorted(names) == sorted(["subdir/page1.png", "page2.tiff"])


def test_empty_zip_returns_empty_names_and_zero_total() -> None:
    raw = _make_zip([])
    names, total = peek_zip_image_names(raw, limit=10)
    assert names == []
    assert total == 0


def test_limit_zero_returns_no_names_but_correct_total() -> None:
    raw = _make_zip([("a.png", b"x"), ("b.png", b"y")])
    names, total = peek_zip_image_names(raw, limit=0)
    assert names == []
    assert total == 2
