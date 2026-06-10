"""Behavior 1 — Registry exposes exactly the 24 v2 stage IDs.

Spec: docs/specs/stage-registry-v2.md §2.
"""

from __future__ import annotations

import pytest

# ─── Expected table from stage-registry-v2.md §2.1 ────────────────────────────

_V2_PAGE_STAGES = [
    ("grayscale", "Image prep", ("source",)),
    ("crop", "Image prep", ("grayscale",)),
    ("threshold", "Image prep", ("crop",)),
    ("deskew", "Image prep", ("threshold",)),
    ("denoise", "Image prep", ("deskew",)),
    ("dewarp", "Image prep", ("denoise",)),
    ("post_transform_crop", "Image prep", ("dewarp",)),
    ("canvas_map", "Compose", ("post_transform_crop",)),  # blank branch is internal
    ("text_zones", "OCR", ("post_transform_crop",)),
    ("ocr", "OCR", ("post_ocr_crop",)),
    ("post_ocr_crop", "Image prep", ("canvas_map",)),
    ("wordcheck", "Text", ("ocr",)),
    ("hyphen_join", "Text", ("wordcheck",)),
    ("text_review", "Text", ("hyphen_join", "regex")),
    ("illustrations", "Compose", ("source",)),
    ("regex", "Text", ("hyphen_join",)),
]

_V2_PROJECT_STAGES = [
    ("source", "Source", ()),
    ("page_order", "Compose", ("source", "text_zones")),  # cross-scope
    ("validation", "Pack", ("text_review", "illustrations", "page_order")),
    ("proof_pack", "Pack", ("validation",)),
    ("build_package", "Pack", ("proof_pack",)),
    ("zip", "Pack", ("build_package",)),
    ("submit_check", "Pack", ("zip",)),
    ("archive", "Pack", ("submit_check",)),
]

_ALL_V2_STAGE_IDS = frozenset(s[0] for s in _V2_PAGE_STAGES + _V2_PROJECT_STAGES)


def test_v2_page_stage_ids_exactly_16() -> None:
    """V2_PAGE_STAGE_IDS must contain exactly the 16 page-scoped stage IDs."""
    from pdomain_prep_for_pgdp.core.models import V2_PAGE_STAGE_IDS

    assert len(V2_PAGE_STAGE_IDS) == 16, f"got {len(V2_PAGE_STAGE_IDS)}: {V2_PAGE_STAGE_IDS}"
    expected = frozenset(s[0] for s in _V2_PAGE_STAGES)
    assert frozenset(V2_PAGE_STAGE_IDS) == expected


def test_v2_project_stage_ids_exactly_8() -> None:
    """V2_PROJECT_STAGE_IDS must contain exactly the 8 project-scoped stage IDs."""
    from pdomain_prep_for_pgdp.core.models import V2_PROJECT_STAGE_IDS

    assert len(V2_PROJECT_STAGE_IDS) == 8, f"got {len(V2_PROJECT_STAGE_IDS)}: {V2_PROJECT_STAGE_IDS}"
    expected = frozenset(s[0] for s in _V2_PROJECT_STAGES)
    assert frozenset(V2_PROJECT_STAGE_IDS) == expected


def test_registry_version_constant_is_2() -> None:
    """REGISTRY_VERSION constant must equal 2."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_dag import REGISTRY_VERSION

    assert REGISTRY_VERSION == 2


def test_v2_stage_dag_covers_all_24_stages() -> None:
    """V2_STAGE_DAG must have exactly 24 entries."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_dag import V2_STAGE_DAG

    ids = {s.id for s in V2_STAGE_DAG}
    assert ids == _ALL_V2_STAGE_IDS, f"extra={ids - _ALL_V2_STAGE_IDS}, missing={_ALL_V2_STAGE_IDS - ids}"
    assert len(V2_STAGE_DAG) == 24


@pytest.mark.parametrize(("stage_id", "group", "_deps"), _V2_PAGE_STAGES)
def test_page_stage_scope_is_page(stage_id: str, group: str, _deps: tuple[str, ...]) -> None:
    """Every page-scoped v2 stage has scope='page'."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_dag import V2_STAGE_DAG

    stage_map = {s.id: s for s in V2_STAGE_DAG}
    assert stage_id in stage_map, f"{stage_id!r} missing from V2_STAGE_DAG"
    stage = stage_map[stage_id]
    assert stage.scope == "page", f"{stage_id!r}: expected scope='page', got {stage.scope!r}"
    assert stage.group == group, f"{stage_id!r}: expected group={group!r}, got {stage.group!r}"


@pytest.mark.parametrize(("stage_id", "group", "_deps"), _V2_PROJECT_STAGES)
def test_project_stage_scope_is_project(stage_id: str, group: str, _deps: tuple[str, ...]) -> None:
    """Every project-scoped v2 stage has scope='project'."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_dag import V2_STAGE_DAG

    stage_map = {s.id: s for s in V2_STAGE_DAG}
    assert stage_id in stage_map, f"{stage_id!r} missing from V2_STAGE_DAG"
    stage = stage_map[stage_id]
    assert stage.scope == "project", f"{stage_id!r}: expected scope='project', got {stage.scope!r}"
    assert stage.group == group, f"{stage_id!r}: expected group={group!r}, got {stage.group!r}"


def test_v2_page_stages_topological_order() -> None:
    """V2_PAGE_STAGE_IDS is in topological order (each stage's deps appear before it)."""
    from pdomain_prep_for_pgdp.core.models import V2_PAGE_STAGE_IDS
    from pdomain_prep_for_pgdp.core.pipeline.stage_dag import V2_STAGE_DAG

    page_stage_map = {s.id: s for s in V2_STAGE_DAG if s.scope == "page"}
    seen: set[str] = set()
    for sid in V2_PAGE_STAGE_IDS:
        stage = page_stage_map[sid]
        for dep in stage.depends_on:
            # Cross-scope deps (e.g. 'source') are not in V2_PAGE_STAGE_IDS — skip them
            if dep in page_stage_map:
                assert dep in seen, (
                    f"stage {sid!r} depends on {dep!r} which appears later in V2_PAGE_STAGE_IDS"
                )
        seen.add(sid)


def test_v2_stage_impl_covers_all_24() -> None:
    """V2_STAGE_IMPL must have a 'cpu' entry for every v2 stage ID."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import V2_STAGE_IMPL

    for sid in _ALL_V2_STAGE_IDS:
        assert sid in V2_STAGE_IMPL, f"{sid!r} missing from V2_STAGE_IMPL"
        assert "cpu" in V2_STAGE_IMPL[sid], f"{sid!r} has no cpu entry"
        assert callable(V2_STAGE_IMPL[sid]["cpu"]), f"{sid!r} cpu entry not callable"


def test_new_stages_have_placeholder_impls() -> None:
    """New/unimplemented v2 stages raise StageNotImplemented when invoked."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import V2_STAGE_IMPL, StageNotImplemented

    # These are new stages with no implementation yet (B2-B4 will wire them)
    new_stages = {
        "denoise",
        "dewarp",
        "text_zones",
        "wordcheck",
        "hyphen_join",
        "post_transform_crop",
        "page_order",
        "validation",
        "proof_pack",
        "build_package",
        "zip",
        "submit_check",
        "archive",
    }
    for sid in new_stages:
        fn = V2_STAGE_IMPL[sid]["cpu"]
        with pytest.raises(StageNotImplemented):
            fn(None)


def test_blank_proof_synth_not_in_v2_stages() -> None:
    """blank_proof_synth is folded into canvas_map in v2 — not a standalone stage."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_dag import V2_STAGE_DAG

    ids = {s.id for s in V2_STAGE_DAG}
    assert "blank_proof_synth" not in ids, "blank_proof_synth must be internal to canvas_map in v2"
