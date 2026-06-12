"""Helpers for seeding page state via the event store in tests.

These replace the retired `db.put_pages()` / `db.put_page()` calls.  All page
state is now authoritative in the per-project `.pd-pages/events.db` managed
by `PageService` (`build_page_service`).

Typical usage
-------------
    from tests.fixtures.seed_pages import seed_pages_in_store, seed_page_in_store

    # With a Settings object (API/route tests):
    seed_pages_in_store(settings, "proj1", [page1, page2])

    # With a plain data_root path (unit tests with db fixture):
    seed_pages_in_store(tmp_path / "data", "proj1", [page1, page2])
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import TYPE_CHECKING

from pdomain_ops.page_aggregate import PageAggregate, ProjectAggregate
from pdomain_ops.pages import PageRecord as OpsPageRecord
from pdomain_ops.pages import ProjectRecord, set_extension

from pdomain_prep_for_pgdp.core.page_store_factory import build_page_service
from pdomain_prep_for_pgdp.core.prep_extension import PrepPageExtension

if TYPE_CHECKING:
    from pdomain_prep_for_pgdp.core.models import PageRecord
    from pdomain_prep_for_pgdp.settings import Settings


def _resolve_data_root(settings_or_root: Settings | Path | str) -> Path:
    """Accept Settings, Path, or string for the data_root."""
    if isinstance(settings_or_root, (Path, str)):
        return Path(settings_or_root)
    # Duck-type Settings object
    return Path(settings_or_root.data_root)


def _to_uuid(project_id: str) -> uuid.UUID:
    """Convert project_id string to UUID.

    Must match the _to_uuid in page_service_helpers.py exactly so tests that
    seed via seed_pages_in_store and verify via list_page_records see the same
    project UUID.
    """
    try:
        return uuid.UUID(project_id)
    except (ValueError, AttributeError):
        return uuid.uuid5(uuid.NAMESPACE_OID, project_id)


def _make_prep_ext(page: PageRecord) -> PrepPageExtension:
    """Build a PrepPageExtension from a PageRecord (test seeding only)."""
    return PrepPageExtension(
        project_id=page.project_id,
        idx0=page.idx0,
        prefix=page.prefix,
        source_stem=page.source_stem,
        ignore=page.ignore,
        page_type=page.page_type,
        alignment=page.alignment,
        config_overrides=page.config_overrides,
        splits=page.splits,
        illustration_regions=page.illustration_regions,
        processing_status=page.processing_status,
        processing_job_id=page.processing_job_id,
        processing_error=page.processing_error,
        last_processed_at=page.last_processed_at,
        outputs=page.outputs,
        parent_page_id=page.parent_page_id,
        source_crop_bbox=page.source_crop_bbox,
        split_index=page.split_index,
        split_at_stage=page.split_at_stage,
        split_suffix=page.split_suffix,
        reading_order=page.reading_order,
    )


def seed_pages_in_store(
    settings_or_root: Settings | Path | str,
    project_id: str,
    pages: list[PageRecord],
    *,
    project_name: str = "Test",
) -> None:
    """Seed a list of PageRecords into the event store for the given project.

    Appends pages to an existing project aggregate if one already exists,
    or creates a new one if not. Pages are sorted by idx0.

    Use this wherever tests previously called ``await db.put_pages(pages)``.
    """
    if not pages:
        return
    data_root = _resolve_data_root(settings_or_root)
    svc = build_page_service(data_root, project_id)
    proj_uuid = _to_uuid(project_id)

    # Load existing project aggregate or create a new one
    try:
        proj_agg = svc.store.get_project(proj_uuid)
    except Exception:
        proj_record = ProjectRecord(project_id=proj_uuid, name=project_name)
        proj_agg = ProjectAggregate(record=proj_record)

    for page in sorted(pages, key=lambda p: p.idx0):
        page_uuid = uuid.uuid4()
        ops_record = OpsPageRecord(page_id=page_uuid, page_index=page.idx0, source="raw")
        ext = _make_prep_ext(page)
        set_extension(ops_record, "prep", ext)
        page_agg = PageAggregate(record=ops_record)
        svc.store.save_page(page_agg)
        proj_agg.add_page(page_id=page_uuid, page_index=page.idx0)
    svc.store.save_project(proj_agg)


def seed_page_in_store(
    settings_or_root: Settings | Path | str,
    project_id: str,
    page: PageRecord,
    *,
    project_name: str = "Test",
) -> None:
    """Seed a single PageRecord into the event store.

    Use this wherever tests previously called ``await db.put_page(page)``.
    """
    seed_pages_in_store(settings_or_root, project_id, [page], project_name=project_name)


def seed_v2_page_source(
    data_root: Path,
    project_id: str,
    idx0: int,
    image_bytes: bytes,
) -> None:
    """Seed a page's source image into the BlobStore for v2 root-stage tests.

    This is the v2 equivalent of seeding a `manual_deskew_pre` artifact for
    `grayscale`: instead of writing to the page_stages artifact directory, we
    write the source image into the BlobStore and create a PrepPageExtension
    with the ``source_blob_hash`` set, exactly as `unzip_source` does in
    production.

    After calling this, ``run_stage(..., stage_id="grayscale")`` will find the
    source bytes via the BlobStore path and execute correctly.
    """
    svc = build_page_service(data_root, project_id)
    proj_uuid = _to_uuid(project_id)

    # Load existing project aggregate or create a new one.
    try:
        proj_agg = svc.store.get_project(proj_uuid)
    except Exception:
        proj_record = ProjectRecord(project_id=proj_uuid, name="Test")
        proj_agg = ProjectAggregate(record=proj_record)

    source_hash = svc.blobs.write(image_bytes)
    page_uuid = uuid.uuid4()
    ops_record = OpsPageRecord(page_id=page_uuid, page_index=idx0, source="raw")
    ext = PrepPageExtension(
        project_id=project_id,
        idx0=idx0,
        prefix="",
        source_stem=f"img{idx0:04d}",
        source_blob_hash=source_hash,
    )
    set_extension(ops_record, "prep", ext)
    page_agg = PageAggregate(record=ops_record)
    svc.store.save_page(page_agg)
    proj_agg.add_page(page_id=page_uuid, page_index=idx0)
    svc.store.save_project(proj_agg)
