"""Edge cases for `core.pipeline.crop_for_ocr`.

Locks in:
  - corrupt proofing-image bytes raise a clear ValueError,
  - splits whose coords clamp to an empty rectangle are silently dropped
    (rather than yielding a 0-byte PNG that downstream OCR would fail on),
  - the uniform OCR crop (top/bottom/left/right) is applied even with no splits.
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


def _png(h: int, w: int, fill: int = 200) -> bytes:
    cv2 = pytest.importorskip("cv2")
    img = np.full((h, w), fill, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


def _cfg(top: int = 0, bottom: int = 0, left: int = 0, right: int = 0) -> ResolvedPageConfig:
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
        ocr_crop=(top, bottom, left, right),
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


def _page(**kw) -> PageRecord:
    base = {
        "project_id": "p",
        "idx0": 0,
        "prefix": "",
        "source_stem": "s",
        "page_type": PageType.normal,
    }
    base.update(kw)
    return PageRecord(**base)


def test_crop_rejects_corrupt_proofing_bytes() -> None:
    pytest.importorskip("cv2")
    with pytest.raises(ValueError, match="could not decode"):
        crop_for_ocr(b"garbage", page=_page(), cfg=_cfg())


def test_split_clamping_to_empty_section_is_dropped() -> None:
    """A split with R<=L (after clamping to image extent) should NOT
    produce a 0-byte output; it's silently skipped."""
    pytest.importorskip("cv2")
    proofing = _png(100, 100)
    page = _page(
        splits=[
            # Valid split: left half.
            PageSplit(suffix="a", x_pct=0, reading_order=0, L=0, R=50, T=0, B=100),
            # Invalid split: L=R, empty section.
            PageSplit(suffix="b", x_pct=50, reading_order=1, L=50, R=50, T=0, B=100),
        ]
    )
    out = crop_for_ocr(proofing, page=page, cfg=_cfg())
    assert [o.suffix for o in out] == ["a"]


def test_uniform_crop_applies_when_no_splits() -> None:
    """The (top/bottom/left/right) trim runs even on whole-page output."""
    pytest.importorskip("cv2")
    proofing = _png(100, 100)
    page = _page()
    out = crop_for_ocr(proofing, page=page, cfg=_cfg(top=10, bottom=10, left=10, right=10))
    assert len(out) == 1

    # Decode the result and check dimensions: 100 - (10+10) on each axis.
    cv2 = pytest.importorskip("cv2")
    arr = np.frombuffer(out[0].image, dtype=np.uint8)
    decoded = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
    assert decoded.shape == (80, 80)
