"""Step 3 helper — assign `PageRecord.prefix` for every page in a project.

Called after the user finalises the proof / frontmatter / bodymatter ranges
on the Configure page. Uses `compute_prefix` (spec 01) so the same numbering
logic the pipeline uses is the one persisted to disk.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from .prefix import compute_prefix

if TYPE_CHECKING:
    from pd_prep_for_pgdp.adapters.database import IDatabase

    from .models import PageRecord, Project


async def assign_prefixes(*, project: Project, database: IDatabase) -> int:
    """Re-derive `prefix` + `ignore` for every page; persist any changes.

    Returns the count of pages inspected. Pages whose prefix didn't change
    are not rewritten.
    """
    pages_in, _, _ = await database.list_pages(project.id, None, 1_000_000)
    pages_by_idx = {p.idx0: p for p in pages_in}

    updates: list[PageRecord] = []
    for page in pages_in:
        new_prefix = compute_prefix(page.idx0, project.config, pages_by_idx) or ""
        new_ignore = page.idx0 < project.config.proof_start_idx0 or page.idx0 > project.config.proof_end_idx0
        if page.prefix == new_prefix and page.ignore == new_ignore:
            continue
        updates.append(page.model_copy(update={"prefix": new_prefix, "ignore": new_ignore}))

    if updates:
        await database.put_pages(updates)
    return len(pages_in)
