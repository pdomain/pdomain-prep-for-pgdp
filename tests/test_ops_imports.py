def test_ops_0_7_imports() -> None:
    from pdomain_ops.blob_store import BlobStore
    from pdomain_ops.page_aggregate import PageAggregate, PagesApplication, ProjectAggregate
    from pdomain_ops.page_server import LocalPageStore, PageStore, SingleShard
    from pdomain_ops.pages import PageRecord, ProjectRecord, get_extension, set_extension

    assert PageRecord is not None
    assert ProjectRecord is not None
    assert get_extension is not None
    assert set_extension is not None
    assert PageAggregate is not None
    assert PagesApplication is not None
    assert ProjectAggregate is not None
    assert BlobStore is not None
    assert LocalPageStore is not None
    assert PageStore is not None
    assert SingleShard is not None
