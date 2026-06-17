"""ranges->runs migration helpers (the one place that reads old range config).

Invoked by the registry-version re-derive path on the v2->v3 bump.
"""

from __future__ import annotations

from pdomain_prep_for_pgdp.core.models import (
    LeafRole,
    NumberingRun,
    PageType,
    PlateSide,
    ProjectConfig,
    RunStyle,
    StartMode,
)

_ROLE_MAP: dict[PageType, tuple[LeafRole, PlateSide | None]] = {
    PageType.normal: (LeafRole.text, None),
    PageType.blank: (LeafRole.blank, None),
    PageType.skip: (LeafRole.skip, None),
    PageType.cover: (LeafRole.cover, None),
    PageType.plate_p: (LeafRole.plate, PlateSide.recto),
    PageType.plate_b: (LeafRole.plate, PlateSide.verso),
    PageType.plate_r: (LeafRole.plate, PlateSide.verso),
}

_NO_RUN_TYPES: frozenset[PageType] = frozenset({PageType.skip, PageType.cover})


def page_type_to_leaf_role(pt: PageType) -> tuple[LeafRole, PlateSide | None]:
    """Map a Source-layer PageType to a Page-Order leaf role + plate side."""
    return _ROLE_MAP[pt]


def seed_runs_from_ranges(
    config: ProjectConfig,
    page_types: dict[int, PageType],
) -> tuple[list[NumberingRun], dict[int, str | None]]:
    """Seed numbering runs from the legacy frontmatter/bodymatter ranges.

    Returns (runs, {scan: run_id | None}).  Cover/skip and out-of-proof
    pages map to None (no run).  The roman/arabic split + start numbers come
    straight from the config so migrated labels stay byte-stable.
    """
    # Migration contract: these ids ("frontmatter", "bodymatter") are stable identifiers
    # persisted in the DB by the v2->v3 migration.  P1.9 golden byte-stability depends on
    # them — do not rename without bumping the registry version.
    front = NumberingRun(
        id="frontmatter",
        label="Front matter",
        style=RunStyle.roman_lower,
        start_mode=StartMode.set,
        start=config.frontmatter_page_nbr_start,
        step=1,
        span=(config.frontmatter_start_idx0, config.frontmatter_end_idx0),
    )
    body = NumberingRun(
        id="bodymatter",
        label="Body",
        style=RunStyle.arabic,
        start_mode=StartMode.set,
        start=config.bodymatter_page_nbr_start,
        step=1,
        span=(config.bodymatter_start_idx0, config.bodymatter_end_idx0),
    )
    assign: dict[int, str | None] = {}
    for scan, pt in page_types.items():
        if scan < config.proof_start_idx0 or scan > config.proof_end_idx0 or pt in _NO_RUN_TYPES:
            assign[scan] = None
        elif config.frontmatter_start_idx0 <= scan <= config.frontmatter_end_idx0:
            assign[scan] = front.id
        elif config.bodymatter_start_idx0 <= scan <= config.bodymatter_end_idx0:
            assign[scan] = body.id
        else:
            # In-proof but outside both declared ranges — default to body.
            assign[scan] = body.id
    return [front, body], assign
