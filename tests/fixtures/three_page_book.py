"""Synthetic 3-page book fixture for milestone smoke-tests.

Build a small reproducible zip on demand — three white-background PNGs with
simple black "PAGE N" text drawn on each, sized like a typical scan
(roughly 1200x1700, equivalent to ~150 DPI on a 8x11" page). No external
binary fixtures live in the repo; the helper produces the zip from
deterministic inputs each time.

The shape matches what `core/ingest.unzip_source` expects: image entries
named `0001.png` / `0002.png` / `0003.png`. No companion config files are
needed — `_enumerate_zip` only looks at image-extension entries.

Usage::

    from tests.fixtures.three_page_book import build_three_page_book_zip
    zip_path = build_three_page_book_zip(tmp_path / "book.zip")

Or via the conftest fixture::

    def test_example(three_page_book_zip): ...
"""

from __future__ import annotations

import io
import zipfile
from typing import TYPE_CHECKING

from PIL import Image, ImageDraw

if TYPE_CHECKING:
    from pathlib import Path

# Roughly an 8x11" page at 150 DPI, but kept smaller than typical fixtures
# so the resulting zip stays compact (a few KB per page).
PAGE_W = 1200
PAGE_H = 1700

# Sorted page filenames (4-digit, 1-based) — match the convention used by
# IA / archive-org scan zips. `_enumerate_zip` sorts by stem after extracting,
# so the on-disk idx0 ordering matches this declaration.
_PAGE_FILENAMES = ("0001.png", "0002.png", "0003.png")


def _render_page_png(page_label: str) -> bytes:
    """Render one synthetic page as PNG bytes — white background, black text."""
    img = Image.new("RGB", (PAGE_W, PAGE_H), color="white")
    draw = ImageDraw.Draw(img)
    # Simple text rendered with PIL's default font; positioned near top-left.
    # Keeps the fixture deterministic without depending on system fonts.
    draw.text((100, 200), page_label, fill="black")
    # A few horizontal black bars further down to give the binary-threshold
    # pipeline something non-trivial to chew on.
    for y in (600, 700, 800, 900):
        draw.rectangle(((100, y), (PAGE_W - 100, y + 30)), fill="black")
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=False)
    return buf.getvalue()


def build_three_page_book_zip(dest: Path) -> Path:
    """Write a 3-page synthetic-book zip to ``dest`` and return its path.

    The zip contains three image entries named per ``_PAGE_FILENAMES``. The
    parent directory of ``dest`` must exist.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_STORED) as zf:
        for filename in _PAGE_FILENAMES:
            page_label = f"PAGE {filename.removesuffix('.png').lstrip('0') or '0'}"
            zf.writestr(filename, _render_page_png(page_label))
    return dest


def page_filenames() -> tuple[str, ...]:
    """Expose the canonical page filename list for assertions."""
    return _PAGE_FILENAMES
