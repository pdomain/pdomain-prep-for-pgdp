"""Cover the auto-detect path of `core.illustrations`.

`auto_detect_illustrations` runs a layout detector and converts the
resulting regions into spec-05 IllustrationRegions. Locks in:
  - layout_detector=None returns [] without touching pd-book-tools,
  - regions of the wrong type are filtered out,
  - regions below the confidence threshold are filtered out,
  - kept regions get sequential 1-based `index` values,
  - L/T/R/B are coerced to int even when the detector hands None,
  - corrupt source bytes for `extract_illustration` raise a clear ValueError.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pytest

from pd_prep_for_pgdp.core.illustrations import (
    auto_detect_illustrations,
    extract_illustration,
)
from pd_prep_for_pgdp.core.models import IllustrationRegion

# ─── Fakes that mirror pd_book_tools.layout.types shape ───────────────────


class _FakeRegionType:
    """Stand-in for pd_book_tools.layout.types.RegionType.<member>."""

    def __init__(self, name: str) -> None:
        self.name = name

    def __repr__(self) -> str:
        return f"FakeRT({self.name})"


_figure = _FakeRegionType("figure")
_decoration = _FakeRegionType("decoration")
_table = _FakeRegionType("table")
_text = _FakeRegionType("text")  # should be filtered


@dataclass
class _FakeRegion:
    type: object
    confidence: float
    L: int | None
    T: int | None
    R: int | None
    B: int | None


@dataclass
class _FakePageLayout:
    regions: list[_FakeRegion]


class _FakeDetector:
    def __init__(self, regions: list[_FakeRegion]) -> None:
        self._regions = regions

    def detect(self, image_path: Path) -> _FakePageLayout:
        return _FakePageLayout(regions=self._regions)


# ─── Tests ────────────────────────────────────────────────────────────────


def test_none_detector_returns_empty(tmp_path: Path) -> None:
    out = auto_detect_illustrations(tmp_path / "img.png", layout_detector=None, confidence_threshold=0.5)
    assert out == []


def test_filters_by_type_and_confidence(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    # auto_detect_illustrations imports pd_book_tools.layout.types at runtime
    # to source RegionType. Patch a fake module in so the {keep_types} set
    # built at the top of the function uses our fakes.
    import sys
    import types

    fake_pkg = types.ModuleType("pd_book_tools")
    fake_layout = types.ModuleType("pd_book_tools.layout")
    fake_types = types.ModuleType("pd_book_tools.layout.types")

    class RegionType:
        figure = _figure
        decoration = _decoration
        table = _table
        text = _text

    fake_types.RegionType = RegionType
    monkeypatch.setitem(sys.modules, "pd_book_tools", fake_pkg)
    monkeypatch.setitem(sys.modules, "pd_book_tools.layout", fake_layout)
    monkeypatch.setitem(sys.modules, "pd_book_tools.layout.types", fake_types)

    detector = _FakeDetector(
        [
            _FakeRegion(type=_figure, confidence=0.9, L=10, T=20, R=110, B=220),
            _FakeRegion(type=_text, confidence=0.99, L=0, T=0, R=10, B=10),  # wrong type
            _FakeRegion(type=_decoration, confidence=0.2, L=0, T=0, R=10, B=10),  # below threshold
            _FakeRegion(type=_table, confidence=0.51, L=None, T=None, R=None, B=None),  # None coords
        ]
    )
    out = auto_detect_illustrations(tmp_path / "img.png", layout_detector=detector, confidence_threshold=0.5)

    assert [r.index for r in out] == [1, 2]
    assert out[0].L == 10 and out[0].R == 110
    # None coords coerced to 0.
    assert out[1].L == 0 and out[1].R == 0


def test_returns_empty_if_pd_book_tools_missing(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """No pd_book_tools installed → auto-detect can't decide what counts as
    illustration vs text. Must degrade to [] rather than crashing."""
    import builtins

    real_import = builtins.__import__

    def block(name: str, globals=None, locals=None, fromlist=(), level=0):
        if name.startswith("pd_book_tools"):
            raise ImportError("pd_book_tools blocked")
        return real_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr(builtins, "__import__", block)

    detector = _FakeDetector([_FakeRegion(type=_figure, confidence=0.99, L=0, T=0, R=10, B=10)])
    out = auto_detect_illustrations(tmp_path / "img.png", layout_detector=detector, confidence_threshold=0.5)
    assert out == []


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
