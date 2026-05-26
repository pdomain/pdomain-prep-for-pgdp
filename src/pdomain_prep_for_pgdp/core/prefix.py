"""Page-prefix computation.

Produces strings like "f003" or "p045" or "p045b" given a project + the page
records. Mirrors the implementation in spec 01.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from .models import PageRecord, PageType, ProjectConfig

if TYPE_CHECKING:
    from collections.abc import Mapping

_PLATE_SUFFIX = {
    PageType.plate_b: "b",
    PageType.plate_p: "p",
    PageType.plate_r: "r",
}


def compute_prefix(
    idx0: int,
    project: ProjectConfig,
    pages_by_idx: Mapping[int, PageRecord],
) -> str | None:
    """Return e.g. "f003", "p045", "p045b" — or None if outside the proof range."""
    if idx0 < project.proof_start_idx0 or idx0 > project.proof_end_idx0:
        return None

    def is_unnumbered_plate(i: int) -> bool:
        p = pages_by_idx.get(i)
        return p is not None and p.page_type in {
            PageType.plate_b,
            PageType.plate_p,
            PageType.plate_r,
        }

    fidx = project.frontmatter_page_nbr_start
    for k in range(
        project.frontmatter_start_idx0,
        min(idx0 + 1, project.frontmatter_end_idx0 + 1),
    ):
        if not is_unnumbered_plate(k):
            fidx += 1

    pidx = project.bodymatter_page_nbr_start
    for k in range(
        project.bodymatter_start_idx0,
        min(idx0, project.bodymatter_end_idx0 + 1),
    ):
        if not is_unnumbered_plate(k):
            pidx += 1

    if project.frontmatter_start_idx0 <= idx0 <= project.frontmatter_end_idx0:
        prefix = f"f{fidx - 1:03d}"
    else:
        prefix = f"p{pidx - 1:03d}"

    page = pages_by_idx.get(idx0)
    if page and page.page_type in _PLATE_SUFFIX:
        prefix += _PLATE_SUFFIX[page.page_type]

    return prefix
