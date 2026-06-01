"""Pure event-store split + unsplit operations for prep pages.

Decoupled from the API layer so tests can call them directly.
"""

from __future__ import annotations

import logging
import uuid as _uuid
from typing import TYPE_CHECKING

from pdomain_ops.page_aggregate import PageAggregate
from pdomain_ops.pages import PageRecord as OpsPageRecord
from pdomain_ops.pages import get_extension, set_extension

from pdomain_prep_for_pgdp.core.prep_extension import PrepPageExtension

if TYPE_CHECKING:
    from pdomain_prep_for_pgdp.core.page_store_factory import PageService

log = logging.getLogger(__name__)


def _to_uuid(s: str) -> _uuid.UUID:
    """Convert a string to UUID, falling back to MD5 for non-UUID strings."""
    try:
        return _uuid.UUID(s)
    except (ValueError, AttributeError):
        return _uuid.uuid5(_uuid.NAMESPACE_OID, s)


def split_page_in_store(
    *,
    service: PageService,
    project_id: str,
    parent_page_id: _uuid.UUID,
    parent_idx0: int,
    parent_prefix: str,
    parent_source_stem: str,
    bbox: tuple[int, int, int, int],
    split_at_stage: str,
    suffixes: list[str],
) -> list[OpsPageRecord]:
    """Create N sibling child pages in the event store. Returns child OpsPageRecords.

    Each child gets its own UUID PageAggregate. The parent's ProjectAggregate gains
    each child via ProjectAggregate.add_page. All children inherit the parent's project.
    """
    project_uuid = _to_uuid(project_id)
    proj_agg = service.store.get_project(project_uuid)

    children: list[OpsPageRecord] = []
    # Children start at page_index = current max + 1
    current_max_index = len(proj_agg.record.page_ids)

    for i, suffix in enumerate(suffixes):
        child_page_id = _uuid.uuid4()
        child_record = OpsPageRecord(
            page_id=child_page_id,
            page_index=current_max_index + i,
            source="raw",
        )
        child_ext = PrepPageExtension(
            project_id=project_id,
            idx0=current_max_index + i,
            prefix=f"{parent_prefix}{suffix}",
            source_stem=parent_source_stem,
            parent_page_id=str(parent_page_id),
            source_crop_bbox=bbox,
            split_index=i + 1,
            split_at_stage=split_at_stage,
            split_suffix=suffix,
            reading_order=i,
        )
        set_extension(child_record, "prep", child_ext)
        child_agg = PageAggregate(record=child_record)
        service.store.save_page(child_agg)
        proj_agg.add_page(page_id=child_page_id, page_index=current_max_index + i)
        children.append(child_record)

    service.store.save_project(proj_agg)
    return children


def unsplit_page_in_store(
    *,
    service: PageService,
    project_id: str,
    parent_page_id: _uuid.UUID,
    parent_page_id_str: str | None = None,
) -> None:
    """Remove all split children of parent_page_id from the ProjectAggregate.

    Uses ProjectAggregate.remove_page (ops 0.7.0 PageRemoved event).
    Child PageAggregates remain in the event store as historical records;
    they are simply removed from the project's page_ids ordering.
    The prep page_stages rows for removed children should be cleaned up
    by the caller (pass child page_ids to IDatabase.delete_page_stages_for_page).

    parent_page_id_str: optional string form of the parent ID as stored in
        child extensions (may differ from str(parent_page_id) for legacy data).
    """
    project_uuid = _to_uuid(project_id)
    proj_agg = service.store.get_project(project_uuid)

    # Match children by either UUID string or the provided parent_page_id_str
    match_ids = {str(parent_page_id)}
    if parent_page_id_str is not None:
        match_ids.add(parent_page_id_str)

    # Find all child pages: load each page_id, check parent_page_id in extension
    to_remove: list[_uuid.UUID] = []
    for page_id in list(proj_agg.record.page_ids):
        try:
            page_agg = service.store.get_page(page_id)
        except Exception:
            log.warning("unsplit_page_in_store: could not load page %s", page_id)
            continue
        ext = get_extension(page_agg.record, "prep", PrepPageExtension)
        if ext is not None and ext.parent_page_id in match_ids:
            to_remove.append(page_id)

    for child_id in to_remove:
        proj_agg.remove_page(page_id=child_id)

    if to_remove:
        service.store.save_project(proj_agg)
