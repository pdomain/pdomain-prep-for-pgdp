"""Test core/illustrations.py — region resolution + cv2 cropping.

Written tests-first: locks in `regions_for_page` and `extract_illustration`
behavior before adding more region-handling logic in later iterations.
"""

from __future__ import annotations

import numpy as np
import pytest

from pd_prep_for_pgdp.core.illustrations import (
    extract_illustration,
    regions_for_page,
    synthesise_plate_region,
)
from pd_prep_for_pgdp.core.models import (
    IllustrationRegion,
    PageRecord,
    PageType,
    SystemDefaults,
)


def _png_bytes(h: int, w: int, fill: int = 200) -> bytes:
    cv2 = pytest.importorskip("cv2")
    img = np.full((h, w, 3), fill, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


def _page(idx0: int = 0, **kw) -> PageRecord:
    return PageRecord(project_id="p", idx0=idx0, prefix="p001", source_stem="src", **kw)


def test_regions_for_page_returns_user_configured_first() -> None:
    region = IllustrationRegion(index=1, L=10, R=20, T=30, B=40)
    page = _page(illustration_regions=[region])
    out = regions_for_page(page, system=SystemDefaults(), source_dimensions=(500, 400))
    assert out == [region]


def test_regions_for_page_synthesises_full_page_for_plate_p() -> None:
    page = _page(page_type=PageType.plate_p)
    out = regions_for_page(page, system=SystemDefaults(), source_dimensions=(800, 600))
    assert len(out) == 1
    r = out[0]
    assert (r.L, r.R, r.T, r.B) == (0, 600, 0, 800)
    assert r.type == "plate"


def test_regions_for_page_normal_page_with_no_regions_returns_empty() -> None:
    out = regions_for_page(_page(), system=SystemDefaults(), source_dimensions=(800, 600))
    assert out == []


def test_synthesise_plate_region_uses_full_dimensions() -> None:
    page = _page(page_type=PageType.plate_p)
    r = synthesise_plate_region(page, source_dimensions=(1200, 900))
    assert (r.L, r.T, r.R, r.B) == (0, 0, 900, 1200)


def test_extract_illustration_jpeg_round_trip() -> None:
    cv2 = pytest.importorskip("cv2")
    src = _png_bytes(h=200, w=300, fill=128)
    region = IllustrationRegion(index=1, L=50, R=250, T=10, B=150, output_format="jpg")

    crop_bytes = extract_illustration(source_image_bytes=src, region=region)
    assert crop_bytes  # non-empty

    arr = np.frombuffer(crop_bytes, dtype=np.uint8)
    decoded = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    assert decoded is not None
    h, w = decoded.shape[:2]
    assert h == 140  # B - T
    assert w == 200  # R - L


def test_extract_illustration_png_grayscale() -> None:
    cv2 = pytest.importorskip("cv2")
    src = _png_bytes(h=100, w=100, fill=200)
    region = IllustrationRegion(
        index=1, L=10, R=80, T=20, B=90, output_format="png", convert_to_grayscale=True
    )
    crop_bytes = extract_illustration(source_image_bytes=src, region=region)
    arr = np.frombuffer(crop_bytes, dtype=np.uint8)
    decoded = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
    assert decoded is not None
    assert decoded.ndim == 2  # grayscale
    assert decoded.shape == (70, 70)


def test_extract_illustration_clamps_oversize_region() -> None:
    src = _png_bytes(h=100, w=100)
    # R=999 > w; should clamp to image width.
    region = IllustrationRegion(index=1, L=10, R=999, T=10, B=999)
    crop = extract_illustration(source_image_bytes=src, region=region)
    assert crop


def test_extract_illustration_rejects_empty_region() -> None:
    src = _png_bytes(h=100, w=100)
    region = IllustrationRegion(index=1, L=50, R=20, T=50, B=20)  # inverted
    with pytest.raises(ValueError, match="empty region"):
        extract_illustration(source_image_bytes=src, region=region)
