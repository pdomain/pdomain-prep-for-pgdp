"""Page-prefix computation.

Produces strings like "f003", "p045", "p045b", "c001" given a project + the
page records. Mirrors the implementation in spec 01 with additive extensions
for ``skip`` and ``cover`` page types.

PageType → prefix behaviour
---------------------------
normal / blank      → "f###" (frontmatter) or "p###" (bodymatter)
plate_b/p/r         → "f###b"/"f###p"/"f###r" or "p###b"/"p###p"/"p###r";
                      do not consume a folio number
skip                → None (excluded from the package entirely — no zip entry)
cover               → "c###" (own counter, sorts before "f"); does not
                      consume a frontmatter / bodymatter folio number
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

# Page types that are "unnumbered" in the run — they sit in proof range but do
# not consume a folio counter.
_UNNUMBERED_TYPES: frozenset[PageType] = frozenset(
    {PageType.plate_b, PageType.plate_p, PageType.plate_r, PageType.cover}
)


def compute_prefix(
    idx0: int,
    project: ProjectConfig,
    pages_by_idx: Mapping[int, PageRecord],
) -> str | None:
    """Return e.g. "f003", "p045", "p045b", "c001" — or None.

    Returns None when:
      - idx0 is outside the proof range, OR
      - the page has PageType.skip (excluded from the package entirely).
    """
    if idx0 < project.proof_start_idx0 or idx0 > project.proof_end_idx0:
        return None

    page = pages_by_idx.get(idx0)
    if page is not None and page.page_type == PageType.skip:
        return None

    def is_unnumbered(i: int) -> bool:
        p = pages_by_idx.get(i)
        return p is not None and p.page_type in _UNNUMBERED_TYPES

    # Cover pages get their own counter (independent of frontmatter/bodymatter).
    if page is not None and page.page_type == PageType.cover:
        cidx = 1
        for k in range(project.proof_start_idx0, idx0):
            p = pages_by_idx.get(k)
            if p is not None and p.page_type == PageType.cover:
                cidx += 1
        return f"c{cidx:03d}"

    fidx = project.frontmatter_page_nbr_start
    for k in range(
        project.frontmatter_start_idx0,
        min(idx0 + 1, project.frontmatter_end_idx0 + 1),
    ):
        if not is_unnumbered(k):
            fidx += 1

    pidx = project.bodymatter_page_nbr_start
    for k in range(
        project.bodymatter_start_idx0,
        min(idx0, project.bodymatter_end_idx0 + 1),
    ):
        if not is_unnumbered(k):
            pidx += 1

    if project.frontmatter_start_idx0 <= idx0 <= project.frontmatter_end_idx0:
        prefix = f"f{fidx - 1:03d}"
    else:
        prefix = f"p{pidx - 1:03d}"

    if page and page.page_type in _PLATE_SUFFIX:
        prefix += _PLATE_SUFFIX[page.page_type]

    return prefix
