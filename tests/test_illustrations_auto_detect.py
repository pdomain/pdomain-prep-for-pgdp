"""Cover the auto-detect path of `core.illustrations`.

`auto_detect_illustrations` runs a layout detector and converts the
resulting regions into spec-05 IllustrationRegions. Locks in:
  - layout_detector=None returns [] without touching pdomain-book-tools,
  - regions of the wrong type are filtered out,
  - regions below the confidence threshold are filtered out,
  - kept regions get sequential 1-based `index` values,
  - non-LayoutRegion objects in page_layout.regions raise TypeError,
  - missing pdomain_book_tools raises RuntimeError (not silent []),
  - corrupt source bytes for `extract_illustration` raise a clear ValueError.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pytest

from pdomain_prep_for_pgdp.core.illustrations import (
    auto_detect_illustrations,
    extract_illustration,
)
from pdomain_prep_for_pgdp.core.models import IllustrationRegion

# ─── Fakes used by tests ──────────────────────────────────────────────────


@dataclass
class _FakePageLayout:
    regions: list


class _FakeDetector:
    def __init__(self, regions: list) -> None:
        self._regions = regions

    def detect(self, image_path: Path) -> _FakePageLayout:
        return _FakePageLayout(regions=self._regions)


# ─── Tests ────────────────────────────────────────────────────────────────


def test_none_detector_returns_empty(tmp_path: Path) -> None:
    out = auto_detect_illustrations(tmp_path / "img.png", layout_detector=None, confidence_threshold=0.5)
    assert out == []


def test_filters_by_type_and_confidence(tmp_path: Path) -> None:
    # Use real LayoutRegion / RegionType instances — the new implementation
    # does isinstance(region, LayoutRegion) and requires typed access.
    from pdomain_book_tools.layout.types import LayoutRegion, RegionType

    regions = [
        LayoutRegion(type=RegionType.figure, L=10, T=20, R=110, B=220, confidence=0.9),
        LayoutRegion(type=RegionType.text, L=0, T=0, R=10, B=10, confidence=0.99),  # wrong type
        LayoutRegion(type=RegionType.decoration, L=0, T=0, R=10, B=10, confidence=0.2),  # below threshold
        LayoutRegion(type=RegionType.table, L=0, T=0, R=5, B=5, confidence=0.51),
    ]
    detector = _FakeDetector(regions)  # type: ignore[arg-type]
    out = auto_detect_illustrations(tmp_path / "img.png", layout_detector=detector, confidence_threshold=0.5)

    assert [r.index for r in out] == [1, 2]
    assert out[0].L == 10
    assert out[0].R == 110
    assert out[1].L == 0
    assert out[1].R == 5


def test_raises_runtime_error_if_pdomain_book_tools_missing(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """No pdomain_book_tools installed → auto_detect_illustrations must raise RuntimeError
    rather than silently returning []. The caller must know the detector can't work."""
    import builtins

    real_import = builtins.__import__

    def block(name: str, globals=None, locals=None, fromlist=(), level=0):
        if name.startswith("pdomain_book_tools"):
            raise ImportError("pdomain_book_tools blocked")
        return real_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr(builtins, "__import__", block)

    detector = _FakeDetector([])  # type: ignore[arg-type]
    with pytest.raises(RuntimeError, match="pdomain_book_tools layout types are not available"):
        auto_detect_illustrations(tmp_path / "img.png", layout_detector=detector, confidence_threshold=0.5)


def test_map_region_type_unknown_value_raises() -> None:
    """_map_region_type must not silently map unknown enum values to 'illustration'."""
    from pdomain_book_tools.layout.types import RegionType

    from pdomain_prep_for_pgdp.core.illustrations import _map_region_type

    # Known mappings must still work.
    assert _map_region_type(RegionType.figure) == "illustration"
    assert _map_region_type(RegionType.table) == "illustration"
    assert _map_region_type(RegionType.decoration) == "decoration"

    # An unknown enum value must raise, not silently produce "illustration".
    with pytest.raises(KeyError):
        _map_region_type(RegionType.text)  # text regions are NOT illustrations


def test_auto_detect_raises_on_non_layout_region() -> None:
    """A non-LayoutRegion object in page_layout.regions must raise TypeError."""
    from unittest.mock import MagicMock

    from pdomain_book_tools.layout.types import RegionType

    from pdomain_prep_for_pgdp.core.illustrations import auto_detect_illustrations

    fake_layout = MagicMock()
    bad_region = MagicMock(spec=[])  # has no LayoutRegion fields
    bad_region.type = RegionType.figure
    bad_region.confidence = 1.0
    fake_layout.regions = [bad_region]

    fake_detector = MagicMock()
    fake_detector.detect.return_value = fake_layout

    with pytest.raises(TypeError):
        auto_detect_illustrations(
            Path("/fake/image.png"),
            layout_detector=fake_detector,
            confidence_threshold=0.5,
        )


def test_extract_illustration_rejects_corrupt_bytes() -> None:
    pytest.importorskip("cv2")
    region = IllustrationRegion(index=1, L=0, T=0, R=10, B=10)
    with pytest.raises(ValueError, match="could not decode"):
        extract_illustration(source_image_bytes=b"not a real image", region=region)


def test_extract_illustration_rejects_empty_clamped_region() -> None:
    """A region whose coords are entirely outside the image should fail
    cleanly rather than producing a zero-size encode."""
    cv2 = pytest.importorskip("cv2")
    import numpy as np

    img = np.full((50, 50, 3), 200, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    src = bytes(buf.tobytes())

    region = IllustrationRegion(index=1, L=200, T=200, R=300, B=300)  # outside the 50x50
    with pytest.raises(ValueError, match="empty region after clamping"):
        extract_illustration(source_image_bytes=src, region=region)
