"""TDD tests for page_type_to_leaf_role mapping (P1.5) and seed_runs_from_ranges (P1.6)."""

from typing import Any

import pytest

from pdomain_prep_for_pgdp.core.models import LeafRole, PageType, PlateSide, ProjectConfig, RunStyle
from pdomain_prep_for_pgdp.core.numbering_migration import page_type_to_leaf_role, seed_runs_from_ranges


@pytest.mark.parametrize(
    ("pt", "role", "side"),
    [
        (PageType.normal, LeafRole.text, None),
        (PageType.blank, LeafRole.blank, None),
        (PageType.skip, LeafRole.skip, None),
        (PageType.cover, LeafRole.cover, None),
        (PageType.plate_p, LeafRole.plate, PlateSide.recto),
        (PageType.plate_b, LeafRole.plate, PlateSide.verso),
        (PageType.plate_r, LeafRole.plate, PlateSide.verso),
    ],
)
def test_page_type_to_leaf_role(pt: PageType, role: LeafRole, side: PlateSide | None) -> None:
    assert page_type_to_leaf_role(pt) == (role, side)


def test_mapping_is_exhaustive_over_page_type() -> None:
    # Every PageType member must map — guards against a new type slipping through.
    for pt in PageType:
        page_type_to_leaf_role(pt)  # must not raise


# ─── P1.6 — seed_runs_from_ranges ────────────────────────────────────────────


def _cfg(**kw: Any) -> ProjectConfig:
    base: dict[str, Any] = {
        "book_name": "b",
        "source_uri": "u",
        "proof_start_idx0": 0,
        "proof_end_idx0": 5,
        "frontmatter_start_idx0": 0,
        "frontmatter_end_idx0": 1,
        "frontmatter_page_nbr_start": 1,
        "bodymatter_start_idx0": 2,
        "bodymatter_end_idx0": 5,
        "bodymatter_page_nbr_start": 1,
    }
    base.update(kw)
    return ProjectConfig(**base)


def test_seed_two_runs_front_roman_body_arabic() -> None:
    cfg = _cfg()
    page_types = {
        0: PageType.normal,
        1: PageType.normal,
        2: PageType.normal,
        3: PageType.normal,
        4: PageType.normal,
        5: PageType.normal,
    }
    runs, assign = seed_runs_from_ranges(cfg, page_types)
    front = next(r for r in runs if r.style is RunStyle.roman_lower)
    body = next(r for r in runs if r.style is RunStyle.arabic)
    assert front.start == 1 and body.start == 1
    assert assign[0] == front.id and assign[1] == front.id
    assert assign[2] == body.id and assign[5] == body.id


def test_skip_and_cover_get_no_run() -> None:
    cfg = _cfg()
    page_types = {
        0: PageType.cover,
        1: PageType.normal,
        2: PageType.normal,
        3: PageType.skip,
        4: PageType.normal,
        5: PageType.normal,
    }
    _, assign = seed_runs_from_ranges(cfg, page_types)
    assert assign.get(0) is None  # cover -> no run
    assert assign.get(3) is None  # skip -> no run
