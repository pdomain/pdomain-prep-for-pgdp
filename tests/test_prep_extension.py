import pytest
from pydantic import ValidationError

from pdomain_prep_for_pgdp.core.models import (
    PageType,
)
from pdomain_prep_for_pgdp.core.prep_extension import PrepPageExtension


def test_root_page_defaults() -> None:
    ext = PrepPageExtension(project_id="proj1", idx0=0, prefix="", source_stem="img001")
    assert ext.parent_page_id is None
    assert ext.source_crop_bbox is None
    assert ext.split_index is None
    assert ext.split_at_stage is None
    assert ext.split_suffix is None
    assert ext.reading_order == 0
    assert ext.page_type == PageType.normal
    assert ext.ignore is False


def test_split_child_all_fields_required() -> None:
    with pytest.raises(ValidationError, match="split-child"):
        PrepPageExtension(
            project_id="proj1",
            idx0=5,
            prefix="001a",
            source_stem="img001",
            parent_page_id="550e8400-e29b-41d4-a716-446655440000",
            # missing source_crop_bbox, split_index, split_at_stage, split_suffix
        )


def test_split_child_valid() -> None:
    import uuid

    parent_id = str(uuid.uuid4())
    ext = PrepPageExtension(
        project_id="proj1",
        idx0=5,
        prefix="001a",
        source_stem="img001",
        parent_page_id=parent_id,
        source_crop_bbox=(0, 0, 100, 200),
        split_index=1,
        split_at_stage="auto_detect_attrs",
        split_suffix="a",
        reading_order=0,
    )
    assert ext.parent_page_id == parent_id
    assert ext.split_index == 1


def test_root_page_no_split_fields() -> None:
    with pytest.raises(ValidationError, match="root PageRecord"):
        PrepPageExtension(
            project_id="proj1",
            idx0=0,
            prefix="",
            source_stem="img001",
            split_index=1,  # not allowed on root
        )


def test_json_round_trip() -> None:
    ext = PrepPageExtension(
        project_id="proj1",
        idx0=3,
        prefix="004",
        source_stem="img004",
        page_type=PageType.blank,
    )
    dumped = ext.model_dump(mode="json")
    restored = PrepPageExtension.model_validate(dumped)
    assert restored.idx0 == 3
    assert restored.page_type == PageType.blank


def test_get_set_extension_roundtrip() -> None:
    import uuid

    from pdomain_ops.pages import PageRecord, get_extension, set_extension

    record = PageRecord(page_id=uuid.uuid4(), page_index=0, source="raw")
    ext = PrepPageExtension(project_id="proj1", idx0=0, prefix="", source_stem="img001")
    set_extension(record, "prep", ext)
    recovered = get_extension(record, "prep", PrepPageExtension)
    assert recovered is not None
    assert recovered.idx0 == 0
    assert recovered.source_stem == "img001"
