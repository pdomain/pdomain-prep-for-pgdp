import uuid
from pathlib import Path

from pdomain_ops.page_aggregate import PageAggregate
from pdomain_ops.pages import PageRecord as OpsPageRecord
from pdomain_ops.pages import set_extension

from pdomain_prep_for_pgdp.core.page_store_factory import build_page_service
from pdomain_prep_for_pgdp.core.pipeline.stage_runner import load_page_extension_from_store
from pdomain_prep_for_pgdp.core.prep_extension import PrepPageExtension


def test_load_page_extension_from_store(tmp_path: Path) -> None:
    project_id = str(uuid.uuid4())
    service = build_page_service(tmp_path, project_id)
    page_id = uuid.uuid4()

    ops_record = OpsPageRecord(page_id=page_id, page_index=0, source="raw")
    ext = PrepPageExtension(project_id=project_id, idx0=0, prefix="", source_stem="img001")
    set_extension(ops_record, "prep", ext)
    page_agg = PageAggregate(record=ops_record)
    service.store.save_page(page_agg)

    loaded = load_page_extension_from_store(service=service, page_id=page_id)
    assert loaded is not None
    assert loaded.source_stem == "img001"
