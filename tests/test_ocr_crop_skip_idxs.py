"""Tests for `core.config_resolver.ocr_crop_skip_idxs`.

Locks in the rule: a page should be SKIPPED by the uniform OCR crop step
(Step 6) when any of these is true:
  - page_type is plate_b/plate_p/plate_r/blank,
  - alignment is center or bottom,
  - rotated_standard is set,
  - single_dimension_rescale is set,
  - the page has at least one split.

The Step 6 crop assumes a "normal" left/right book scan with the same
content rectangle on every page; non-normal pages have their own treatment.
"""

from __future__ import annotations

from pdomain_prep_for_pgdp.core.config_resolver import ocr_crop_skip_idxs
from pdomain_prep_for_pgdp.core.models import (
    AlignmentOverride,
    PageConfigOverrides,
    PageRecord,
    PageSplit,
    PageType,
    ProjectConfig,
    SystemDefaults,
)


def _page(idx0: int, **overrides) -> PageRecord:
    base = {
        "project_id": "p",
        "idx0": idx0,
        "prefix": "",
        "source_stem": f"s{idx0}",
        "page_type": PageType.normal,
    }
    base.update(overrides)
    return PageRecord(**base)


def _system() -> SystemDefaults:
    return SystemDefaults()


def _project() -> ProjectConfig:
    return ProjectConfig(book_name="t", source_uri="")


def test_normal_pages_are_not_skipped() -> None:
    pages = [_page(0), _page(1), _page(2)]
    assert ocr_crop_skip_idxs(_system(), _project(), pages) == []


def test_plate_pages_are_skipped() -> None:
    pages = [
        _page(0, page_type=PageType.normal),
        _page(1, page_type=PageType.plate_p),
        _page(2, page_type=PageType.plate_b),
        _page(3, page_type=PageType.plate_r),
        _page(4, page_type=PageType.blank),
    ]
    assert ocr_crop_skip_idxs(_system(), _project(), pages) == [1, 2, 3, 4]


def test_center_aligned_page_is_skipped() -> None:
    pages = [
        _page(0),
        _page(1, alignment=AlignmentOverride.center),
        _page(2, alignment=AlignmentOverride.bottom),
    ]
    assert ocr_crop_skip_idxs(_system(), _project(), pages) == [1, 2]


def test_split_page_is_skipped() -> None:
    pages = [
        _page(0),
        _page(1, splits=[PageSplit(suffix="a", x_pct=50, reading_order=0)]),
    ]
    assert ocr_crop_skip_idxs(_system(), _project(), pages) == [1]


def test_rotated_or_rescaled_page_is_skipped() -> None:
    pages = [
        _page(0),
        _page(1, config_overrides=PageConfigOverrides(rotated_standard=True)),
        _page(2, config_overrides=PageConfigOverrides(single_dimension_rescale=True)),
    ]
    assert ocr_crop_skip_idxs(_system(), _project(), pages) == [1, 2]


def test_combined_skip_reasons_only_emit_once() -> None:
    """A page that hits multiple skip conditions appears once in the output."""
    pages = [
        _page(
            0,
            page_type=PageType.plate_p,
            alignment=AlignmentOverride.center,
            splits=[PageSplit(suffix="a", x_pct=50, reading_order=0)],
        ),
    ]
    assert ocr_crop_skip_idxs(_system(), _project(), pages) == [0]
