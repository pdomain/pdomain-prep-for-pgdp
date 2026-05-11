"""Tests-first for `core.auto_detect` (spec 01 §"Auto-detection").

Locks in:
  - mostly-white pages → `page_type = blank` suggestion,
  - color pages (non-grayscale source) → `plate_p` suggestion,
  - content occupying <50% of column → `alignment = center` suggestion,
  - median image aspect → returned as the project's default `page_h_w_ratio`.

These are *suggestions*; the user confirms them per page in the UI. The
function returns proposed edits without mutating the inputs.
"""

from __future__ import annotations

import numpy as np
import pytest

from pd_prep_for_pgdp.core.models import (
    AlignmentOverride,
    PageRecord,
    PageType,
)


def _png_blank() -> bytes:
    cv2 = pytest.importorskip("cv2")
    img = np.full((1000, 800, 3), 252, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


def _png_with_text(content_pct: float = 0.6) -> bytes:
    """White page with a centered black rectangle covering ~content_pct of width."""
    cv2 = pytest.importorskip("cv2")
    h, w = 1000, 800
    img = np.full((h, w, 3), 250, dtype=np.uint8)
    margin_x = int(w * (1 - content_pct) / 2)
    margin_y = int(h * 0.1)
    cv2.rectangle(img, (margin_x, margin_y), (w - margin_x, h - margin_y), (0, 0, 0), -1)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


def _png_color() -> bytes:
    """A clearly colour image (R != G != B per pixel)."""
    cv2 = pytest.importorskip("cv2")
    h, w = 600, 400
    # Three saturated colour stripes.
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[:, : w // 3] = (255, 0, 0)  # blue (BGR)
    img[:, w // 3 : 2 * w // 3] = (0, 255, 0)  # green
    img[:, 2 * w // 3 :] = (0, 0, 255)  # red
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


def _page(idx0: int) -> PageRecord:
    return PageRecord(project_id="p", idx0=idx0, prefix="", source_stem=f"s_{idx0}")


def test_blank_detection() -> None:
    pytest.importorskip("cv2")
    from pd_prep_for_pgdp.core.auto_detect import detect_page_attributes

    out = detect_page_attributes(_png_blank())
    assert out.suggested_type == PageType.blank


def test_normal_page_is_not_blank_or_plate() -> None:
    pytest.importorskip("cv2")
    from pd_prep_for_pgdp.core.auto_detect import detect_page_attributes

    out = detect_page_attributes(_png_with_text(content_pct=0.6))
    assert out.suggested_type == PageType.normal


def test_color_page_suggests_plate_p() -> None:
    pytest.importorskip("cv2")
    from pd_prep_for_pgdp.core.auto_detect import detect_page_attributes

    out = detect_page_attributes(_png_color())
    assert out.suggested_type == PageType.plate_p


def test_narrow_content_suggests_center_alignment() -> None:
    pytest.importorskip("cv2")
    from pd_prep_for_pgdp.core.auto_detect import detect_page_attributes

    out = detect_page_attributes(_png_with_text(content_pct=0.3))
    assert out.suggested_alignment == AlignmentOverride.center


def test_full_width_content_keeps_default_alignment() -> None:
    pytest.importorskip("cv2")
    from pd_prep_for_pgdp.core.auto_detect import detect_page_attributes

    out = detect_page_attributes(_png_with_text(content_pct=0.7))
    assert out.suggested_alignment == AlignmentOverride.default


def test_median_aspect_across_pages() -> None:
    pytest.importorskip("cv2")
    from pd_prep_for_pgdp.core.auto_detect import median_aspect_ratio

    # Three images: aspect ratios 1.5, 1.65, 2.0.
    pngs = [_pn for _pn in [_png_at_aspect(1.5), _png_at_aspect(1.65), _png_at_aspect(2.0)]]
    median = median_aspect_ratio(pngs)
    # Median of {1.5, 1.65, 2.0} = 1.65.
    assert abs(median - 1.65) < 0.01


def _png_at_aspect(ratio: float) -> bytes:
    cv2 = pytest.importorskip("cv2")
    w = 400
    h = round(w * ratio)
    img = np.full((h, w, 3), 250, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())
