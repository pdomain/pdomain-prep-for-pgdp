"""Event-store split + unsplit integration tests."""

from __future__ import annotations

import uuid
from pathlib import Path

from pdomain_ops.page_aggregate import PageAggregate, ProjectAggregate
from pdomain_ops.pages import PageRecord as OpsPageRecord
from pdomain_ops.pages import ProjectRecord, get_extension, set_extension

from pdomain_prep_for_pgdp.core.page_store_factory import build_page_service
from pdomain_prep_for_pgdp.core.prep_extension import PrepPageExtension
from pdomain_prep_for_pgdp.core.split_ops import split_page_in_store, unsplit_page_in_store


def _setup_parent_page(service: object, project_id: str, project_uuid: uuid.UUID) -> tuple[uuid.UUID, object]:
    """Create a parent page + project in the event store. Returns (page_id, proj_agg)."""
    from pdomain_prep_for_pgdp.core.page_store_factory import PageService

    svc: PageService = service  # type: ignore[assignment]

    page_id = uuid.uuid4()
    ops_record = OpsPageRecord(page_id=page_id, page_index=0, source="raw")
    ext = PrepPageExtension(project_id=project_id, idx0=0, prefix="001", source_stem="img001")
    set_extension(ops_record, "prep", ext)
    page_agg = PageAggregate(record=ops_record)
    svc.store.save_page(page_agg)

    proj_record = ProjectRecord(project_id=project_uuid, name="Test")
    proj_agg = ProjectAggregate(record=proj_record)
    proj_agg.add_page(page_id=page_id, page_index=0)
    svc.store.save_project(proj_agg)

    return page_id, proj_agg


def test_split_creates_child_pages(tmp_path: Path) -> None:
    project_id = str(uuid.uuid4())
    project_uuid = uuid.UUID(project_id)
    service = build_page_service(tmp_path, project_id)
    parent_id, _ = _setup_parent_page(service, project_id, project_uuid)

    children = split_page_in_store(
        service=service,
        project_id=project_id,
        parent_page_id=parent_id,
        parent_idx0=0,
        parent_prefix="001",
        parent_source_stem="img001",
        bbox=(0, 0, 100, 200),
        split_at_stage="auto_detect_attrs",
        suffixes=["a", "b"],
    )

    assert len(children) == 2

    child_a = service.store.get_page(children[0].page_id)
    ext_a = get_extension(child_a.record, "prep", PrepPageExtension)
    assert ext_a is not None
    assert ext_a.parent_page_id == str(parent_id)
    assert ext_a.split_index == 1
    assert ext_a.split_suffix == "a"
    assert ext_a.split_at_stage == "auto_detect_attrs"
    assert ext_a.source_crop_bbox == (0, 0, 100, 200)

    child_b = service.store.get_page(children[1].page_id)
    ext_b = get_extension(child_b.record, "prep", PrepPageExtension)
    assert ext_b is not None
    assert ext_b.split_index == 2
    assert ext_b.split_suffix == "b"

    proj_agg = service.store.get_project(project_uuid)
    child_ids = {children[0].page_id, children[1].page_id}
    assert child_ids.issubset(set(proj_agg.record.page_ids))


def test_unsplit_removes_children_from_project(tmp_path: Path) -> None:
    project_id = str(uuid.uuid4())
    project_uuid = uuid.UUID(project_id)
    service = build_page_service(tmp_path, project_id)
    parent_id, _ = _setup_parent_page(service, project_id, project_uuid)

    children = split_page_in_store(
        service=service,
        project_id=project_id,
        parent_page_id=parent_id,
        parent_idx0=0,
        parent_prefix="001",
        parent_source_stem="img001",
        bbox=(0, 0, 50, 200),
        split_at_stage="auto_detect_attrs",
        suffixes=["a", "b"],
    )

    unsplit_page_in_store(
        service=service,
        project_id=project_id,
        parent_page_id=parent_id,
    )

    proj_agg = service.store.get_project(project_uuid)
    child_ids = {c.page_id for c in children}
    # None of the children should remain in project.page_ids
    assert not child_ids.intersection(set(proj_agg.record.page_ids))
    # Parent still present
    assert parent_id in proj_agg.record.page_ids
