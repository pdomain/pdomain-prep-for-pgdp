"""API integration: page routes assemble responses from event store + PrepPageExtension."""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest
from pdomain_ops.page_aggregate import PageAggregate, ProjectAggregate
from pdomain_ops.pages import PageRecord as OpsPageRecord
from pdomain_ops.pages import ProjectRecord, get_extension, set_extension

from pdomain_prep_for_pgdp.core.page_store_factory import build_page_service
from pdomain_prep_for_pgdp.core.prep_extension import PrepPageExtension


@pytest.fixture
def project_id() -> str:
    return str(uuid.uuid4())


@pytest.fixture
def page_uuid() -> uuid.UUID:
    return uuid.uuid4()


@pytest.fixture
def seeded_service(tmp_path: Path, project_id: str, page_uuid: uuid.UUID):
    """Event store pre-seeded with one page."""
    service = build_page_service(tmp_path, project_id)

    proj_uuid = uuid.UUID(project_id)
    ops_record = OpsPageRecord(page_id=page_uuid, page_index=0, source="raw")
    ext = PrepPageExtension(project_id=project_id, idx0=0, prefix="001", source_stem="img001")
    set_extension(ops_record, "prep", ext)
    page_agg = PageAggregate(record=ops_record)
    service.store.save_page(page_agg)

    proj_record = ProjectRecord(project_id=proj_uuid, name="Test Book")
    proj_agg = ProjectAggregate(record=proj_record)
    proj_agg.add_page(page_id=page_uuid, page_index=0)
    service.store.save_project(proj_agg)

    return service


def test_get_page_from_event_store(seeded_service, project_id: str, page_uuid: uuid.UUID) -> None:
    """Page aggregates load from event store with correct PrepPageExtension."""
    proj_agg = seeded_service.store.get_project(uuid.UUID(project_id))
    assert len(proj_agg.record.page_ids) == 1
    assert page_uuid in proj_agg.record.page_ids

    page_agg = seeded_service.store.get_page(page_uuid)
    ext = get_extension(page_agg.record, "prep", PrepPageExtension)
    assert ext is not None
    assert ext.idx0 == 0
    assert ext.source_stem == "img001"
    assert ext.prefix == "001"


def test_split_page_creates_event_store_children(
    seeded_service, project_id: str, page_uuid: uuid.UUID
) -> None:
    """split_page_in_store creates child pages in event store."""
    from pdomain_prep_for_pgdp.core.split_ops import split_page_in_store

    children = split_page_in_store(
        service=seeded_service,
        project_id=project_id,
        parent_page_id=page_uuid,
        parent_idx0=0,
        parent_prefix="001",
        parent_source_stem="img001",
        bbox=(0, 0, 100, 200),
        split_at_stage="auto_detect_attrs",
        suffixes=["a", "b"],
    )
    assert len(children) == 2

    child_a = seeded_service.store.get_page(children[0].page_id)
    ext_a = get_extension(child_a.record, "prep", PrepPageExtension)
    assert ext_a is not None
    assert ext_a.split_suffix == "a"


def test_unsplit_removes_children(seeded_service, project_id: str, page_uuid: uuid.UUID) -> None:
    """unsplit_page_in_store removes children from ProjectAggregate."""
    from pdomain_prep_for_pgdp.core.split_ops import split_page_in_store, unsplit_page_in_store

    children = split_page_in_store(
        service=seeded_service,
        project_id=project_id,
        parent_page_id=page_uuid,
        parent_idx0=0,
        parent_prefix="001",
        parent_source_stem="img001",
        bbox=(0, 0, 50, 200),
        split_at_stage="auto_detect_attrs",
        suffixes=["a", "b"],
    )

    unsplit_page_in_store(service=seeded_service, project_id=project_id, parent_page_id=page_uuid)

    proj_agg = seeded_service.store.get_project(uuid.UUID(project_id))
    child_ids = {c.page_id for c in children}
    assert not child_ids.intersection(set(proj_agg.record.page_ids))
    assert page_uuid in proj_agg.record.page_ids


def test_ext_to_page_record_assembles_wire_shape(
    seeded_service, project_id: str, page_uuid: uuid.UUID
) -> None:
    """_ext_to_page_record assembles a valid PageRecord wire shape from PrepPageExtension."""
    from pdomain_prep_for_pgdp.api.data.pages import _ext_to_page_record
    from pdomain_prep_for_pgdp.core.models import PageRecord

    page_agg = seeded_service.store.get_page(page_uuid)
    ext = get_extension(page_agg.record, "prep", PrepPageExtension)
    assert ext is not None

    wire = _ext_to_page_record(ext)
    assert isinstance(wire, PageRecord)
    assert wire.idx0 == 0
    assert wire.source_stem == "img001"
    assert wire.prefix == "001"
    assert wire.project_id == project_id
