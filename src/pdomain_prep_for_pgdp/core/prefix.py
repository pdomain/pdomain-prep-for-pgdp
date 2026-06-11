"""Page-prefix computation.

Two naming formats are supported:

v1 (legacy): ``compute_prefix``
  Produces strings like "f003", "p045", "p045b", "c001".

v2 (CT-decided, W4 Group 2): ``compute_prefix_v2``
  Produces strings like "000f001", "005p001", "000e", "003fp".
  Format: ``<seq:3-4><type><folio?>``

  - seq  = universal binding-order position (idx0 - proof_start_idx0),
            zero-padded to 3 digits (≤999 pages) or 4 digits (>999 pages).
            Placed FIRST so lexicographic sort = binding order always.
  - type = section type letter:
            "f" for frontmatter (normal/blank)
            "p" for bodymatter  (normal/blank)
            "e" for cover       (CT decision: e not c)
            "f"/"p" + plate suffix (b/p/r) for plates in that section
  - folio = 3-digit folio counter for numbered pages (normal/blank);
            OMITTED for unnumbered types (cover, plates).

  Plates sit in a section (f or p) but do not consume a folio counter.
  Cover pages use type "e" with no folio — just ``<seq>e``.
  Skip pages return None (excluded from the package entirely).
  Pages outside the proof range return None.

v2 numeric export: ``export_name_for_seq``
  Returns bare zero-padded seq string for use as zip entry basenames.
  This is an export-time rename only; manifests carry both prefix and
  export_name.  PGDP validator validates the EXPORT names.

PageType → v1 prefix behaviour
---------------------------------
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


# ─────────────────────────────────────────────────────────────────────────────
# v2 naming: <seq><type><folio?>
# ─────────────────────────────────────────────────────────────────────────────


def _seq_width(project: ProjectConfig) -> int:
    """Return 3 for ≤999 pages in proof range, 4 for >999."""
    proof_count = project.proof_end_idx0 - project.proof_start_idx0 + 1
    return 4 if proof_count > 999 else 3


def compute_prefix_v2(
    idx0: int,
    project: ProjectConfig,
    pages_by_idx: Mapping[int, PageRecord],
) -> str | None:
    """Return v2 prefix: ``<seq:3-4><type><folio?>`` — or None.

    Returns None when:
      - idx0 is outside the proof range, OR
      - the page has PageType.skip (excluded from the package entirely).

    Format rules (CT-decided, W4 Group 2):
      seq   = idx0 - proof_start_idx0, zero-padded to 3 or 4 digits.
      type  = "f" (frontmatter normal/blank), "p" (bodymatter normal/blank),
              "e" (cover), or section-letter + plate suffix ("fp"/"fb"/"fr",
              "pp"/"pb"/"pr") for plates.
      folio = 3-digit folio counter for numbered pages (normal/blank only).
              Omitted for cover and plates.

    The seq prefix guarantees that lexicographic sort = binding order.
    """
    if idx0 < project.proof_start_idx0 or idx0 > project.proof_end_idx0:
        return None

    page = pages_by_idx.get(idx0)
    if page is not None and page.page_type == PageType.skip:
        return None

    sw = _seq_width(project)
    seq = idx0 - project.proof_start_idx0
    seq_str = f"{seq:0{sw}d}"

    def is_unnumbered(i: int) -> bool:
        p = pages_by_idx.get(i)
        return p is not None and p.page_type in _UNNUMBERED_TYPES

    # Cover pages: type "e", no folio.
    if page is not None and page.page_type == PageType.cover:
        return f"{seq_str}e"

    # Determine section (frontmatter vs bodymatter).
    in_frontmatter = project.frontmatter_start_idx0 <= idx0 <= project.frontmatter_end_idx0
    section_letter = "f" if in_frontmatter else "p"

    # Plate pages: section_letter + plate suffix, no folio.
    if page is not None and page.page_type in _PLATE_SUFFIX:
        return f"{seq_str}{section_letter}{_PLATE_SUFFIX[page.page_type]}"

    # Numbered page (normal/blank): compute folio counter.
    if in_frontmatter:
        folio = project.frontmatter_page_nbr_start
        for k in range(project.frontmatter_start_idx0, idx0 + 1):
            if not is_unnumbered(k):
                folio += 1
        folio -= 1  # adjust: the loop over-counts by 1 since we include idx0
        # Re-derive: folio = start + count of numbered pages BEFORE idx0
        folio = project.frontmatter_page_nbr_start
        for k in range(project.frontmatter_start_idx0, idx0):
            if not is_unnumbered(k):
                folio += 1
    else:
        folio = project.bodymatter_page_nbr_start
        for k in range(project.bodymatter_start_idx0, idx0):
            if not is_unnumbered(k):
                folio += 1

    return f"{seq_str}{section_letter}{folio:03d}"


def export_name_for_seq(seq: int, *, total: int) -> str:
    """Return the numeric export basename for a zero-based sequence number.

    For total ≤ 999: 3-digit zero-padded (e.g. "012").
    For total > 999: 4-digit zero-padded (e.g. "0012").

    This is the bare filename used in the submission zip when numeric export
    is enabled (``build_package`` export option).  The PGDP validator validates
    these names (not the descriptive prefixes).

    Note: ``seq`` here is a 0-based sequence position, NOT the idx0.  The
    caller is responsible for mapping idx0 → seq (skipping skip pages).
    """
    width = 4 if total > 999 else 3
    return f"{seq:0{width}d}"
