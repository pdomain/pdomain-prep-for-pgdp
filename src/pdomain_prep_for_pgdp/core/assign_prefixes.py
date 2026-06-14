"""Step 3 helper -- assign `PageRecord.prefix` for every page in a project.

Called after the user finalises the proof / frontmatter / bodymatter ranges
on the Configure page. Uses `compute_prefix_v2` so the same v2 naming logic
the page_order stage manifest uses is what gets persisted to PageRecord.

Ignore semantics (two orthogonal bits):
- ``derived_ignore``: computed here from range membership and page_type.
  Out-of-range pages and ``page_type==skip`` are always derived-excluded.
- ``manual_ignore``: set by the user via PATCH /pages/{idx0} {"ignore": true}.
  This function PRESERVES it — a user-excluded in-range normal page stays
  excluded even after a config edit that re-runs ``assign_prefixes``.
- Effective ``ignore`` on PageRecord = derived_ignore OR manual_ignore.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from .page_service_helpers import list_page_records, put_page_records
from .prefix import compute_prefix_v2

if TYPE_CHECKING:
    from pdomain_prep_for_pgdp.core.models import Project
    from pdomain_prep_for_pgdp.core.page_store_factory import PageService


async def assign_prefixes(*, project: Project, page_service: PageService) -> int:
    """Re-derive ``prefix`` + effective ``ignore`` for every page; persist changes.

    The effective ``ignore`` flag equals ``derived_ignore OR page.manual_ignore``.
    ``manual_ignore`` is never touched by this function — it is only set/cleared
    by user action via PATCH /pages/{idx0}.

    Returns the count of pages inspected. Pages whose prefix and effective
    ignore both match the re-derived values are not rewritten.
    """
    pages_in = list_page_records(page_service, project.id)
    pages_by_idx = {p.idx0: p for p in pages_in}

    from .models import PageType

    updates = []
    for page in pages_in:
        new_prefix = compute_prefix_v2(page.idx0, project.config, pages_by_idx) or ""
        # derived_ignore = outside proof range OR skip page (auto-excluded).
        # manual_ignore is user-controlled and must NOT be reset by this function.
        out_of_range = (
            page.idx0 < project.config.proof_start_idx0 or page.idx0 > project.config.proof_end_idx0
        )
        derived_ignore = out_of_range or page.page_type == PageType.skip
        # Effective ignore = derived OR manual.  manual_ignore is preserved as-is.
        new_ignore = derived_ignore or page.manual_ignore
        if page.prefix == new_prefix and page.ignore == new_ignore:
            continue
        updates.append(page.model_copy(update={"prefix": new_prefix, "ignore": new_ignore}))

    if updates:
        put_page_records(page_service, updates)
    return len(pages_in)
