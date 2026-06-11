"""V2 DAG enumeration + dirty-descendants helper.

Spec: `docs/specs/stage-registry-v2.md` §2 (registry v2).

The V2_STAGE_DAG has 24 stages: 16 page-scoped + 8 project-scoped.
Tests assert acyclicity, edge-target sanity, topological order,
presence of scope/group/type fields, and
`compute_v2_dirty_descendants` correctness.

V1 DAG tests are removed at I1 — the v1 22-stage STAGE_DAG is retained
in stage_dag.py for B1-B5 backward-compat but is no longer the canonical
authority. New code uses V2_STAGE_DAG / V2_PAGE_STAGE_IDS.
"""

from __future__ import annotations

import pytest

from pdomain_prep_for_pgdp.core.models import V2_PAGE_STAGE_IDS, V2_PROJECT_STAGE_IDS
from pdomain_prep_for_pgdp.core.pipeline.stage_dag import (
    V2_STAGE_DAG,
    compute_v2_dirty_descendants,
)

# ─── V2 DAG shape ──────────────────────────────────────────────────────────


def test_v2_stage_dag_size_matches_canonical_stage_lists() -> None:
    """The V2 DAG enumerates exactly V2_PAGE_STAGE_IDS + V2_PROJECT_STAGE_IDS."""
    all_v2 = set(V2_PAGE_STAGE_IDS) | set(V2_PROJECT_STAGE_IDS)
    assert {s.id for s in V2_STAGE_DAG} == all_v2
    assert len(V2_STAGE_DAG) == len(all_v2)


def test_v2_every_stage_id_is_unique() -> None:
    ids = [s.id for s in V2_STAGE_DAG]
    assert len(ids) == len(set(ids)), f"duplicate stage IDs: {ids}"


def test_v2_every_dependency_references_a_known_stage() -> None:
    known = {s.id for s in V2_STAGE_DAG}
    for stage in V2_STAGE_DAG:
        for parent in stage.depends_on:
            assert parent in known, f"stage {stage.id} depends_on={parent!r} which is not in V2 DAG"


def test_v2_dag_is_acyclic() -> None:
    """Kahn topological sort succeeds iff the DAG is acyclic."""
    by_id = {s.id: s for s in V2_STAGE_DAG}
    in_degree = {s.id: 0 for s in V2_STAGE_DAG}
    for s in V2_STAGE_DAG:
        for _parent in s.depends_on:
            in_degree[s.id] += 1

    queue = [sid for sid, d in in_degree.items() if d == 0]
    visited: list[str] = []
    while queue:
        sid = queue.pop(0)
        visited.append(sid)
        for child in V2_STAGE_DAG:
            if sid in child.depends_on:
                in_degree[child.id] -= 1
                if in_degree[child.id] == 0:
                    queue.append(child.id)

    assert len(visited) == len(V2_STAGE_DAG), (
        f"V2 DAG has a cycle (kahn visited {len(visited)} of {len(V2_STAGE_DAG)})"
    )
    assert set(visited) == set(by_id.keys())


def test_v2_source_is_the_only_root() -> None:
    """Per the V2 DAG, `source` is the unique no-deps root."""
    roots = [s.id for s in V2_STAGE_DAG if not s.depends_on]
    assert roots == ["source"], f"unexpected V2 DAG roots: {roots}"


def test_v2_every_stage_has_scope_and_group() -> None:
    """Every V2Stage must have non-empty scope and group fields."""
    for s in V2_STAGE_DAG:
        assert s.scope in ("page", "project"), f"stage {s.id} has invalid scope={s.scope!r}"
        assert s.group, f"stage {s.id} has empty group"


def test_v2_every_stage_has_input_and_output_types() -> None:
    for s in V2_STAGE_DAG:
        assert s.input_type, f"stage {s.id} has empty input_type"
        assert s.output_type, f"stage {s.id} has empty output_type"


def test_v2_stage_counts_per_scope() -> None:
    """16 page-scoped + 8 project-scoped = 24 total."""
    page_stages = [s for s in V2_STAGE_DAG if s.scope == "page"]
    project_stages = [s for s in V2_STAGE_DAG if s.scope == "project"]
    assert len(page_stages) == 16, f"expected 16 page-scoped stages, got {len(page_stages)}"
    assert len(project_stages) == 8, f"expected 8 project-scoped stages, got {len(project_stages)}"


def test_v2_page_stage_ids_match_dag_scope() -> None:
    """V2_PAGE_STAGE_IDS matches the page-scoped stages in V2_STAGE_DAG."""
    dag_page_ids = {s.id for s in V2_STAGE_DAG if s.scope == "page"}
    assert dag_page_ids == set(V2_PAGE_STAGE_IDS)


def test_v2_project_stage_ids_match_dag_scope() -> None:
    """V2_PROJECT_STAGE_IDS matches the project-scoped stages in V2_STAGE_DAG."""
    dag_project_ids = {s.id for s in V2_STAGE_DAG if s.scope == "project"}
    assert dag_project_ids == set(V2_PROJECT_STAGE_IDS)


def test_v2_archive_is_only_terminal() -> None:
    """In V2, only `archive` is is_terminal."""
    terminal_ids = {s.id for s in V2_STAGE_DAG if s.is_terminal}
    assert terminal_ids == {"archive"}, f"unexpected terminal stages: {terminal_ids}"


def test_v2_stage_dataclass_is_immutable() -> None:
    s = V2_STAGE_DAG[0]
    with pytest.raises((AttributeError, Exception)):
        s.id = "mutated"  # type: ignore[misc]


# ─── V2 dirty-descendant computation ─────────────────────────────────────────


def test_v2_dirty_descendants_for_terminal_stage_is_empty() -> None:
    """`archive` is the terminal stage; nothing downstream."""
    assert compute_v2_dirty_descendants("archive") == frozenset()


def test_v2_dirty_descendants_for_source_includes_all_page_stages() -> None:
    """`source` is the root — all page-scoped stages (and pack chain) are downstream."""
    descendants = compute_v2_dirty_descendants("source")
    # All page-scoped stages must be reachable from source.
    for sid in V2_PAGE_STAGE_IDS:
        assert sid in descendants, f"page stage {sid!r} should be a descendant of source"


def test_v2_dirty_descendants_for_threshold_includes_downstream_chain() -> None:
    """Marking `threshold` dirty should cascade to deskew → denoise → dewarp → ..."""
    descendants = compute_v2_dirty_descendants("threshold")
    must_include = {
        "deskew",
        "denoise",
        "dewarp",
        "post_transform_crop",
        "text_zones",
        "canvas_map",
        "post_ocr_crop",
        "ocr",
        "wordcheck",
        "hyphen_join",
        "regex",
        "text_review",
    }
    missing = must_include - descendants
    assert not missing, f"missing v2 descendants of threshold: {missing}"


def test_v2_dirty_descendants_for_illustrations_is_project_chain() -> None:
    """`illustrations` feeds into `validation` (via project stage) → archive chain."""
    descendants = compute_v2_dirty_descendants("illustrations")
    assert "validation" in descendants
    assert "proof_pack" in descendants


def test_v2_dirty_descendants_for_unknown_stage_raises() -> None:
    with pytest.raises(KeyError):
        compute_v2_dirty_descendants("not_a_real_stage")
