"""Edge-case coverage for `core.auto_detect`.

Locks in:
  - corrupt source bytes → suggestion defaults to (normal, default), no crash,
  - a page that's almost-white but below the blank threshold and has no
    content darker than CONTENT_DARKNESS_THRESHOLD takes the
    "no content" branch (return normal/default),
  - `median_aspect_ratio` skips corrupt entries, skips zero-width entries,
  - `median_aspect_ratio` falls back to the spec default 1.65 when no
    ratios survive.
"""

from __future__ import annotations

import numpy as np
import pytest

from pdomain_prep_for_pgdp.core.auto_detect import (
    detect_page_attributes,
    median_aspect_ratio,
)
from pdomain_prep_for_pgdp.core.models import AlignmentOverride, PageType


def _png(h: int, w: int, fill: int = 255) -> bytes:
    cv2 = pytest.importorskip("cv2")
    img = np.full((h, w, 3), fill, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


def test_corrupt_image_returns_default_suggestion() -> None:
    pytest.importorskip("cv2")
    s = detect_page_attributes(b"garbage not a real image")
    assert s.suggested_type == PageType.normal
    assert s.suggested_alignment == AlignmentOverride.default


def test_no_content_branch_returns_default() -> None:
    """A page that's just below the blank threshold (luma < 245) but has
    NO pixel below CONTENT_DARKNESS_THRESHOLD (200) skips both blank and
    plate paths, then early-returns from the alignment branch."""
    pytest.importorskip("cv2")
    # Fill 240: not blank (< 245), not coloured (grayscale), not dark (> 200).
    page = _png(50, 50, fill=240)
    s = detect_page_attributes(page)
    assert s.suggested_type == PageType.normal
    assert s.suggested_alignment == AlignmentOverride.default


def test_median_aspect_ratio_skips_corrupt_entries() -> None:
    pytest.importorskip("cv2")
    real = _png(200, 100)  # h/w = 2.0
    out = median_aspect_ratio([b"garbage", real, b""])
    assert out == 2.0  # only one valid entry survives


def test_median_aspect_ratio_falls_back_when_all_corrupt() -> None:
    pytest.importorskip("cv2")
    out = median_aspect_ratio([b"garbage", b""])
    assert out == 1.65  # spec default


def test_median_aspect_ratio_handles_empty_list() -> None:
    pytest.importorskip("cv2")
    out = median_aspect_ratio([])
    assert out == 1.65
