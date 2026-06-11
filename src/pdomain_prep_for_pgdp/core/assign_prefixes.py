"""Step 3 helper -- assign `PageRecord.prefix` for every page in a project.

Called after the user finalises the proof / frontmatter / bodymatter ranges
on the Configure page. Uses `compute_prefix` (spec 01) so the same numbering
logic the pipeline uses is the one persisted to disk.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from .page_service_helpers import list_page_records, put_page_records
from .prefix import compute_prefix

if TYPE_CHECKING:
    from pdomain_prep_for_pgdp.core.models import Project
    from pdomain_prep_for_pgdp.core.page_store_factory import PageService


async def assign_prefixes(*, project: Project, page_service: PageService) -> int:
    """Re-derive `prefix` + `ignore` for every page; persist any changes.

    Returns the count of pages inspected. Pages whose prefix didn't change
    are not rewritten.
    """
    pages_in = list_page_records(page_service, project.id)
    pages_by_idx = {p.idx0: p for p in pages_in}

    from .models import PageType

    updates = []
    for page in pages_in:
        new_prefix = compute_prefix(page.idx0, project.config, pages_by_idx) or ""
        # ignore = outside proof range OR skip page (excluded from the package)
        out_of_range = (
            page.idx0 < project.config.proof_start_idx0 or page.idx0 > project.config.proof_end_idx0
        )
        new_ignore = out_of_range or page.page_type == PageType.skip
        if page.prefix == new_prefix and page.ignore == new_ignore:
            continue
        updates.append(page.model_copy(update={"prefix": new_prefix, "ignore": new_ignore}))

    if updates:
        put_page_records(page_service, updates)
    return len(pages_in)
