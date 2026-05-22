"""Step 6 — crop_for_ocr.

Tests-first: lock in (a) whole-page output when no splits, (b) one output per
split in reading-order, (c) uniform OCR border crop applied before splitting.
"""

from __future__ import annotations

import numpy as np
import pytest

from pd_prep_for_pgdp.core.models import (
    AlignmentOverride,
    PageRecord,
    PageSplit,
    PageType,
    ResolvedPageConfig,
)
from pd_prep_for_pgdp.core.pipeline.crop_for_ocr import crop_for_ocr


def _png(h: int, w: int) -> bytes:
    cv2 = pytest.importorskip("cv2")
    img = np.full((h, w), 255, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


def _cfg(*, ocr_crop=(0, 0, 0, 0)) -> ResolvedPageConfig:
    return ResolvedPageConfig(
        text_threshold=140,
        page_h_w_ratio=1.65,
        fuzzy_pct=0.02,
        pixel_count_columns=150,
        pixel_count_rows=75,
        ocr_bbox_edge_min_words=5,
        ocr_engine="doctr",
        ocr_model_key=None,
        ocr_dpi=150,
        initial_crop_all=(0, 0, 0, 0),
        ocr_crop=ocr_crop,  # (top, bottom, left, right)
        page_type=PageType.normal,
        alignment=AlignmentOverride.default,
        initial_crop=None,
        white_space_additional=None,
        threshold_level=None,
        skip_auto_deskew=False,
        deskew_before_crop=None,
        deskew_after_crop=None,
        do_morph=False,
        skip_denoise=False,
        use_ocr_bbox_edge=False,
        rotated_standard=False,
        single_dimension_rescale=False,
        flip_horizontal=False,
        flip_vertical=False,
    )


def _page(splits: list[PageSplit] | None = None) -> PageRecord:
    return PageRecord(
        project_id="p",
        idx0=0,
        prefix="p001",
        source_stem="src",
        splits=splits or [],
    )


def test_whole_page_output_when_no_splits() -> None:
    out = crop_for_ocr(_png(100, 80), page=_page(), cfg=_cfg())
    assert len(out) == 1
    assert out[0].suffix == ""
    assert out[0].reading_order == 0
    assert out[0].image  # non-empty PNG bytes


def test_uniform_ocr_crop_strips_borders_first() -> None:
    cv2 = pytest.importorskip("cv2")
    src = _png(100, 80)
    out = crop_for_ocr(src, page=_page(), cfg=_cfg(ocr_crop=(10, 5, 8, 4)))
    assert len(out) == 1
    decoded = cv2.imdecode(np.frombuffer(out[0].image, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
    # Original 100x80; crop top=10, bottom=5, left=8, right=4 -> 85x68
    assert decoded.shape == (85, 68)


def test_one_output_per_split_in_reading_order() -> None:
    splits = [
        PageSplit(suffix="b", reading_order=1, L=0, R=40, T=0, B=100),
        PageSplit(suffix="a", reading_order=0, L=40, R=80, T=0, B=100),
    ]
    out = crop_for_ocr(_png(100, 80), page=_page(splits=splits), cfg=_cfg())
    assert [o.suffix for o in out] == ["a", "b"]
    assert [o.reading_order for o in out] == [0, 1]


def test_split_with_none_bounds_uses_image_extent() -> None:
    cv2 = pytest.importorskip("cv2")
    splits = [
        PageSplit(suffix="full", reading_order=0, L=None, R=None, T=None, B=None),
    ]
    out = crop_for_ocr(_png(100, 80), page=_page(splits=splits), cfg=_cfg())
    assert len(out) == 1
    decoded = cv2.imdecode(np.frombuffer(out[0].image, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
    assert decoded.shape == (100, 80)
