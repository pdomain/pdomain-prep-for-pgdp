"""resolve_page_config + compute_prefix tests (spec 01)."""

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
from pdomain_prep_for_pgdp.core.prefix import compute_prefix


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


def test_compute_prefix_basic_numbering() -> None:
    """Spec 01 implementation reference test.

    First frontmatter page should be f001, not f000. Bodymatter starts at p000.
    """
    proj = ProjectConfig(
        book_name="X",
        source_uri="",
        proof_start_idx0=10,
        proof_end_idx0=30,
        frontmatter_start_idx0=10,
        frontmatter_end_idx0=14,
        bodymatter_start_idx0=15,
        bodymatter_end_idx0=30,
        frontmatter_page_nbr_start=1,
        bodymatter_page_nbr_start=1,
    )
    pages_by_idx = {i: _page(i) for i in range(10, 31)}
    assert compute_prefix(10, proj, pages_by_idx) == "f001"
    assert compute_prefix(14, proj, pages_by_idx) == "f005"
    assert compute_prefix(15, proj, pages_by_idx) == "p000"
    assert compute_prefix(5, proj, pages_by_idx) is None


def test_compute_prefix_with_plate_suffix() -> None:
    proj = ProjectConfig(
        book_name="X",
        source_uri="",
        proof_start_idx0=0,
        proof_end_idx0=5,
        frontmatter_start_idx0=0,
        frontmatter_end_idx0=2,
        bodymatter_start_idx0=3,
        bodymatter_end_idx0=5,
    )
    pages_by_idx = {
        0: _page(0),
        1: _page(1, page_type=PageType.plate_p),
        2: _page(2),
        3: _page(3),
        4: _page(4, page_type=PageType.plate_b),
        5: _page(5),
    }
    # Plate pages get a suffix and are not numbered.
    p1 = compute_prefix(1, proj, pages_by_idx)
    assert p1 is not None
    assert p1.endswith("p")
    p4 = compute_prefix(4, proj, pages_by_idx)
    assert p4 is not None
    assert p4.endswith("b")


def test_alignment_default_resolves() -> None:
    sys_ = SystemDefaults()
    proj = ProjectConfig(book_name="X", source_uri="")
    page = _page(0, alignment=AlignmentOverride.center)
    cfg = resolve_page_config(sys_, proj, page)
    assert cfg.alignment == AlignmentOverride.center
