"""resolve_page_config tests (spec 01).

P1.9 NOTE: compute_prefix (v1) was deleted.  The two tests that called it
(test_compute_prefix_basic_numbering, test_compute_prefix_with_plate_suffix) are
removed here.  Equivalent coverage lives in tests/test_numbering_migration.py
(golden byte-stability) and tests/test_w4_naming_model.py (format assertions).
"""

from __future__ import annotations

from pdomain_prep_for_pgdp.core.config_resolver import (
    blank_page_idxs,
    resolve_page_config,
    split_source_idxs,
)
from pdomain_prep_for_pgdp.core.models import (
    AlignmentOverride,
    PageConfigOverrides,
    PageRecord,
    PageSplit,
    PageType,
    ProjectConfig,
    SystemDefaults,
)


def _page(idx0: int, **kwargs) -> PageRecord:
    return PageRecord(
        project_id="p",
        idx0=idx0,
        prefix="",
        source_stem=f"src_{idx0}",
        **kwargs,
    )


def test_resolver_falls_through_to_system_defaults() -> None:
    sys_ = SystemDefaults()
    proj = ProjectConfig(book_name="X", source_uri="")
    page = _page(0)
    cfg = resolve_page_config(sys_, proj, page)
    assert cfg.text_threshold == sys_.text_threshold
    assert cfg.fuzzy_pct == sys_.default_fuzzy_pct
    assert cfg.threshold_level is None  # Otsu default preserved


def test_resolver_page_overrides_win() -> None:
    sys_ = SystemDefaults()
    proj = ProjectConfig(book_name="X", source_uri="")
    page = _page(
        0,
        config_overrides=PageConfigOverrides(threshold_level=200, fuzzy_pct=0.05),
    )
    cfg = resolve_page_config(sys_, proj, page)
    assert cfg.threshold_level == 200
    assert cfg.fuzzy_pct == 0.05


def test_resolver_project_default_overrides_beat_system() -> None:
    sys_ = SystemDefaults(default_fuzzy_pct=0.02)
    proj = ProjectConfig(
        book_name="X",
        source_uri="",
        default_overrides={"default_fuzzy_pct": 0.07},
    )
    page = _page(0)
    cfg = resolve_page_config(sys_, proj, page)
    assert cfg.fuzzy_pct == 0.07


def test_resolver_page_beats_project_override() -> None:
    sys_ = SystemDefaults(default_fuzzy_pct=0.02)
    proj = ProjectConfig(
        book_name="X",
        source_uri="",
        default_overrides={"default_fuzzy_pct": 0.07},
    )
    page = _page(0, config_overrides=PageConfigOverrides(fuzzy_pct=0.10))
    cfg = resolve_page_config(sys_, proj, page)
    assert cfg.fuzzy_pct == 0.10


def test_blank_and_split_helpers() -> None:
    pages = [
        _page(0),
        _page(1, page_type=PageType.blank),
        _page(2, page_type=PageType.plate_b),
        _page(3, splits=[PageSplit(suffix="a", reading_order=0)]),
    ]
    assert blank_page_idxs(pages) == [1, 2]
    assert split_source_idxs(pages) == [3]


def test_alignment_default_resolves() -> None:
    sys_ = SystemDefaults()
    proj = ProjectConfig(book_name="X", source_uri="")
    page = _page(0, alignment=AlignmentOverride.center)
    cfg = resolve_page_config(sys_, proj, page)
    assert cfg.alignment == AlignmentOverride.center
