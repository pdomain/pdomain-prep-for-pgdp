"""TDD tests for page_type_to_leaf_role mapping (P1.5)."""

import pytest

from pdomain_prep_for_pgdp.core.models import LeafRole, PageType, PlateSide
from pdomain_prep_for_pgdp.core.numbering_migration import page_type_to_leaf_role


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
