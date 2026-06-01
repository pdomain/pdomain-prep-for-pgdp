import uuid
from pathlib import Path

import pytest
from pdomain_ops.page_aggregate import PageAggregate, ProjectAggregate
from pdomain_ops.pages import PageRecord, ProjectRecord, get_extension, set_extension

from pdomain_prep_for_pgdp.core.page_store_factory import build_page_service
from pdomain_prep_for_pgdp.core.prep_extension import PrepPageExtension


def test_build_page_service_creates_dirs(tmp_path: Path) -> None:
    project_id = "test-project-abc"
    build_page_service(tmp_path, project_id)
    pd_pages = tmp_path / "projects" / project_id / ".pd-pages"
    assert pd_pages.is_dir()
    assert (pd_pages / "blobs").is_dir()


def test_image_ingested_persists_and_loads(tmp_path: Path) -> None:
    project_id = "test-project-ingest"
    service = build_page_service(tmp_path, project_id)

    page_id = uuid.uuid4()
    record = PageRecord(page_id=page_id, page_index=0, source="raw")
    ext = PrepPageExtension(project_id=project_id, idx0=0, prefix="", source_stem="img001")
    set_extension(record, "prep", ext)

    agg = PageAggregate(record=record)
    service.store.save_page(agg)

    loaded = service.store.get_page(page_id)
    recovered_ext = get_extension(loaded.record, "prep", PrepPageExtension)
    assert recovered_ext is not None
    assert recovered_ext.idx0 == 0
    assert recovered_ext.source_stem == "img001"


def test_blob_store_write_read(tmp_path: Path) -> None:
    project_id = "test-project-blob"
    service = build_page_service(tmp_path, project_id)

    data = b"fake png bytes"
    blob_hash = service.blobs.write(data)
    assert service.blobs.exists(blob_hash)
    assert service.blobs.read(blob_hash) == data


def test_project_aggregate_persists(tmp_path: Path) -> None:
    project_id = "test-project-proj"
    service = build_page_service(tmp_path, project_id)

    proj_uuid = uuid.uuid4()
    proj_record = ProjectRecord(project_id=proj_uuid, name="Test Book")
    proj_agg = ProjectAggregate(record=proj_record)
    service.store.save_project(proj_agg)

    loaded_proj = service.store.get_project(proj_uuid)
    assert loaded_proj.record.name == "Test Book"
    assert loaded_proj.record.page_ids == []


@pytest.mark.parametrize("project_id", ["proj-a", "proj-b"])
def test_separate_projects_isolated(tmp_path: Path, project_id: str) -> None:
    build_page_service(tmp_path, project_id)
    pd_pages = tmp_path / "projects" / project_id / ".pd-pages"
    assert (pd_pages / "events.db").exists()
