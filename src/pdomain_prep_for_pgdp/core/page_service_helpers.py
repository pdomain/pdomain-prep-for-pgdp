"""Helpers for reading and mutating page state via the event-store PageService.

These replace the six retired IDatabase page methods:
  get_page / put_page / put_pages / list_pages / delete_page / list_pages_by_parent_id

All page state is now authoritative in the per-project events.db handled by
`PageService` (`build_page_service`).  Every caller that previously called
the IDatabase page methods should import from here instead.
"""

from __future__ import annotations

import logging
import uuid
from typing import TYPE_CHECKING, Any

from pdomain_ops.pages import get_extension

from pdomain_prep_for_pgdp.core.models import PageRecord
from pdomain_prep_for_pgdp.core.prep_extension import PrepPageExtension

if TYPE_CHECKING:
    from pdomain_prep_for_pgdp.core.page_store_factory import PageService

log = logging.getLogger(__name__)


def _to_uuid(s: str) -> uuid.UUID:
    """Convert any string to a UUID, falling back to UUID5 for non-UUID strings."""
    try:
        return uuid.UUID(s)
    except (ValueError, AttributeError):
        return uuid.uuid5(uuid.NAMESPACE_OID, s)


def _ext_to_page_record(ext: PrepPageExtension) -> PageRecord:
    """Assemble a wire-shape PageRecord from a PrepPageExtension."""
    return PageRecord(
        project_id=ext.project_id,
        idx0=ext.idx0,
        prefix=ext.prefix,
        source_stem=ext.source_stem,
        ignore=ext.ignore,
        manual_ignore=ext.manual_ignore,
        page_type=ext.page_type,
        page_role=ext.page_role,
        alignment=ext.alignment,
        config_overrides=ext.config_overrides,
        splits=ext.splits,
        illustration_regions=ext.illustration_regions,
        source_key=None,
        thumbnail_key=None,
        processing_status=ext.processing_status,
        processing_job_id=ext.processing_job_id,
        processing_error=ext.processing_error,
        last_processed_at=ext.last_processed_at,
        outputs=ext.outputs,
        parent_page_id=ext.parent_page_id,
        source_crop_bbox=ext.source_crop_bbox,
        split_index=ext.split_index,
        split_at_stage=ext.split_at_stage,
        split_suffix=ext.split_suffix,
        reading_order=ext.reading_order,
    )


def _get_proj_page_ids(service: PageService, project_id: str) -> list[uuid.UUID]:
    """Return page UUIDs in insertion order for the given project."""
    try:
        proj_agg = service.store.get_project(_to_uuid(project_id))
        return list(proj_agg.record.page_ids)
    except Exception:  # noqa: BLE001
        return []


def list_page_records(service: PageService, project_id: str) -> list[PageRecord]:
    """Return all PageRecord objects for the project, sorted by idx0.

    Replaces IDatabase.list_pages for full-scan callers.  Does not
    implement cursor/limit pagination -- use a slice of the returned list
    when pagination is needed.
    """
    records: list[PageRecord] = []
    for page_uuid in _get_proj_page_ids(service, project_id):
        try:
            page_agg = service.store.get_page(page_uuid)
            ext = get_extension(page_agg.record, "prep", PrepPageExtension)
            if ext is not None:
                records.append(_ext_to_page_record(ext))
        except Exception:  # noqa: BLE001, S112
            continue
    records.sort(key=lambda p: p.idx0)
    return records


def get_page_record(service: PageService, project_id: str, idx0: int) -> PageRecord | None:
    """Return a single PageRecord by (project_id, idx0), or None if not found.

    Replaces IDatabase.get_page.
    """
    for page_uuid in _get_proj_page_ids(service, project_id):
        try:
            page_agg = service.store.get_page(page_uuid)
            ext = get_extension(page_agg.record, "prep", PrepPageExtension)
            if ext is not None and ext.idx0 == idx0:
                return _ext_to_page_record(ext)
        except Exception:  # noqa: BLE001, S112
            continue
    return None


def list_page_records_by_parent_id(
    service: PageService, project_id: str, parent_page_id: str
) -> list[PageRecord]:
    """Return all split-children whose parent_page_id matches, sorted by idx0.

    Replaces IDatabase.list_pages_by_parent_id.
    """
    results: list[PageRecord] = []
    for page_uuid in _get_proj_page_ids(service, project_id):
        try:
            page_agg = service.store.get_page(page_uuid)
            ext = get_extension(page_agg.record, "prep", PrepPageExtension)
            if ext is not None and ext.parent_page_id == parent_page_id:
                results.append(_ext_to_page_record(ext))
        except Exception:  # noqa: BLE001, S112
            continue
    results.sort(key=lambda p: p.idx0)
    return results


def _get_page_agg_and_ext(
    service: PageService, project_id: str, idx0: int
) -> tuple[Any, PrepPageExtension | None]:
    """Return the (page_agg, ext) pair for a given idx0, or (None, None)."""
    for page_uuid in _get_proj_page_ids(service, project_id):
        try:
            page_agg = service.store.get_page(page_uuid)
            ext = get_extension(page_agg.record, "prep", PrepPageExtension)
            if ext is not None and ext.idx0 == idx0:
                return page_agg, ext
        except Exception:  # noqa: BLE001, S112
            continue
    return None, None


def update_page_extension(
    service: PageService,
    project_id: str,
    idx0: int,
    **updates: Any,
) -> PageRecord | None:
    """Apply **updates to the PrepPageExtension for page idx0 and persist.

    Replaces IDatabase.put_page for single-field-update callers.
    Returns the updated PageRecord, or None if the page was not found.
    """
    page_agg, ext = _get_page_agg_and_ext(service, project_id, idx0)
    if ext is None or page_agg is None:
        return None
    updated_ext = ext.model_copy(update=updates)
    # Use page_agg.set_extension to fire an ExtensionSet event (persists via eventsourcing).
    page_agg.set_extension("prep", updated_ext)
    service.store.save_page(page_agg)
    return _ext_to_page_record(updated_ext)


def put_page_records(service: PageService, pages: list[PageRecord]) -> None:
    """Persist a batch of PageRecord mutations back to the event store.

    Replaces IDatabase.put_pages for callers that bulk-update records
    (e.g. assign_prefixes, reorder_pages).  Each record is matched by
    idx0 within its project; unknown idx0 values are silently skipped.
    """
    for rec in pages:
        page_agg, ext = _get_page_agg_and_ext(service, rec.project_id, rec.idx0)
        if ext is None or page_agg is None:
            continue
        updated_ext = PrepPageExtension(
            project_id=ext.project_id,
            idx0=rec.idx0,
            prefix=rec.prefix,
            source_stem=ext.source_stem,
            ignore=rec.ignore,
            manual_ignore=ext.manual_ignore,  # preserve manual flag; callers that want to mutate it use update_page_extension
            page_type=rec.page_type,
            page_role=rec.page_role,
            # Numbering-runs leaf fields (P1) are NOT on the PageRecord wire
            # shape — preserve them from the existing extension so bulk
            # PageRecord rewrites (reorder, prefix recompute) don't wipe the
            # v3 migration's classification.
            leaf_role=ext.leaf_role,
            run_id=ext.run_id,
            label_override=ext.label_override,
            plate_tag=ext.plate_tag,
            plate_side=ext.plate_side,
            ocr_folio=ext.ocr_folio,
            alignment=rec.alignment,
            config_overrides=rec.config_overrides,
            splits=rec.splits,
            illustration_regions=rec.illustration_regions,
            source_blob_hash=ext.source_blob_hash,
            thumbnail_blob_hash=ext.thumbnail_blob_hash,
            processed_image_blob_hash=ext.processed_image_blob_hash,
            ocr_image_blob_hash=ext.ocr_image_blob_hash,
            processing_status=rec.processing_status,
            processing_job_id=rec.processing_job_id,
            processing_error=rec.processing_error,
            last_processed_at=rec.last_processed_at,
            outputs=rec.outputs,
            parent_page_id=rec.parent_page_id,
            source_crop_bbox=rec.source_crop_bbox,
            split_index=rec.split_index,
            split_at_stage=rec.split_at_stage,
            split_suffix=rec.split_suffix,
            reading_order=rec.reading_order,
        )
        # Use page_agg.set_extension to fire an ExtensionSet event (persists via eventsourcing).
        page_agg.set_extension("prep", updated_ext)
        service.store.save_page(page_agg)


def delete_page_from_store(service: PageService, project_id: str, idx0: int) -> None:
    """Remove a page from the event store by (project_id, idx0).

    Replaces IDatabase.delete_page.  Removes the page from its project
    aggregate; the page aggregate itself becomes unreachable.
    """
    proj_uuid = _to_uuid(project_id)
    try:
        proj_agg = service.store.get_project(proj_uuid)
    except Exception:  # noqa: BLE001
        return

    target_uuid: uuid.UUID | None = None
    for page_uuid in list(proj_agg.record.page_ids):
        try:
            page_agg = service.store.get_page(page_uuid)
            ext = get_extension(page_agg.record, "prep", PrepPageExtension)
            if ext is not None and ext.idx0 == idx0:
                target_uuid = page_uuid
                break
        except Exception:  # noqa: BLE001, S112
            continue

    if target_uuid is None:
        return

    proj_agg.remove_page(page_id=target_uuid)
    service.store.save_project(proj_agg)
