from pdomain_prep_for_pgdp.core.models import PageRecord


def test_page_record_no_longer_has_validator() -> None:
    """Wire-shape PageRecord no longer enforces split all-or-none — PrepPageExtension does."""
    # Should succeed without a validator error even with partial split fields
    record = PageRecord(
        project_id="p1",
        idx0=0,
        prefix="",
        source_stem="img",
        parent_page_id="some-id",
        split_index=1,
        # deliberately omit split_at_stage and split_suffix to confirm no validator
    )
    assert record.parent_page_id == "some-id"
