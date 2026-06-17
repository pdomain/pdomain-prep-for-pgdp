"""ranges->runs migration helpers (the one place that reads old range config).

Invoked by the registry-version re-derive path on the v2->v3 bump.
"""

from __future__ import annotations

from pdomain_prep_for_pgdp.core.models import LeafRole, PageType, PlateSide

_ROLE_MAP: dict[PageType, tuple[LeafRole, PlateSide | None]] = {
    PageType.normal: (LeafRole.text, None),
    PageType.blank: (LeafRole.blank, None),
    PageType.skip: (LeafRole.skip, None),
    PageType.cover: (LeafRole.cover, None),
    PageType.plate_p: (LeafRole.plate, PlateSide.recto),
    PageType.plate_b: (LeafRole.plate, PlateSide.verso),
    PageType.plate_r: (LeafRole.plate, PlateSide.verso),
}


def page_type_to_leaf_role(pt: PageType) -> tuple[LeafRole, PlateSide | None]:
    """Map a Source-layer PageType to a Page-Order leaf role + plate side."""
    return _ROLE_MAP[pt]
