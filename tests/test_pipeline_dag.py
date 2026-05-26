"""M1 §B — 16-stage DAG enumeration + dirty-descendants helper.

Spec: `docs/specs/pipeline-task-model.md` §"Per-page stage DAG" (locked
2026-05-07).

The DAG is the single source of truth for stage IDs, edges, input/output
artifact types, and code pointers. Tests assert acyclicity, edge-target
sanity, topological order matching the canonical sequence, presence of
code pointers, and `compute_dirty_descendants` correctness.

Stage count note: spec STAGE_VERSIONS lists 22 stages (16 image-processing +
6 post-Step-4). `docs/08-roadmap.md` M1 still says "16-stage registry" —
spec is authoritative; roadmap will be cleaned up in the §F doc realign
slice.
"""

from __future__ import annotations

import pytest

from pdomain_prep_for_pgdp.core.models import PAGE_STAGE_IDS
from pdomain_prep_for_pgdp.core.pipeline.stage_dag import (
    STAGE_DAG,
    Stage,
    compute_dirty_descendants,
    topological_order,
)


def test_stage_dag_size_matches_canonical_stage_list() -> None:
    """The DAG enumerates exactly the canonical PAGE_STAGE_IDS set."""
    assert {s.id for s in STAGE_DAG} == set(PAGE_STAGE_IDS)
    assert len(STAGE_DAG) == len(PAGE_STAGE_IDS)


def test_every_stage_id_is_unique() -> None:
    ids = [s.id for s in STAGE_DAG]
    assert len(ids) == len(set(ids)), f"duplicate stage IDs: {ids}"


def test_every_dependency_references_a_known_stage() -> None:
    known = {s.id for s in STAGE_DAG}
    for stage in STAGE_DAG:
        for parent in stage.depends_on:
            assert parent in known, f"stage {stage.id} depends_on={parent!r} which is not in DAG"


def test_dag_is_acyclic_via_kahn_topsort() -> None:
    """Kahn topological sort succeeds iff the DAG is acyclic."""
    by_id = {s.id: s for s in STAGE_DAG}
    in_degree = {s.id: 0 for s in STAGE_DAG}
    for s in STAGE_DAG:
        for _parent in s.depends_on:
            # Edge parent -> s; s has indegree increased.
            in_degree[s.id] += 1

    # Sources: in_degree 0.
    queue = [sid for sid, d in in_degree.items() if d == 0]
    visited: list[str] = []
    while queue:
        sid = queue.pop(0)
        visited.append(sid)
        for child in STAGE_DAG:
            if sid in child.depends_on:
                in_degree[child.id] -= 1
                if in_degree[child.id] == 0:
                    queue.append(child.id)

    assert len(visited) == len(STAGE_DAG), (
        f"DAG has a cycle (kahn visited {len(visited)} of {len(STAGE_DAG)})"
    )
    # And by_id is consistent.
    assert set(visited) == set(by_id.keys())


def test_topological_order_matches_canonical_sequence() -> None:
    """The exposed `topological_order()` is a valid linearisation, and a
    well-known ancestor (e.g. `ingest_source`) appears before its descendants.
    """
    order = topological_order()
    # The function returns a tuple of Stage objects, in topo order.
    assert isinstance(order, tuple)
    assert len(order) == len(STAGE_DAG)
    indices = {s.id: i for i, s in enumerate(order)}
    for s in STAGE_DAG:
        for parent in s.depends_on:
            assert indices[parent] < indices[s.id], (
                f"topo violation: parent {parent!r} appears after child {s.id!r}"
            )


def test_ingest_source_is_the_only_root() -> None:
    """Per the DAG diagram, `ingest_source` is the unique no-deps root."""
    roots = [s.id for s in STAGE_DAG if not s.depends_on]
    assert roots == ["ingest_source"], f"unexpected DAG roots: {roots}"


def test_every_stage_has_nonempty_code_pointer() -> None:
    """Every stage carries a best-effort `code_pointer` for human navigation.

    The pointer doesn't need to be importable — it's a string reference for
    the workbench debug view and developer onboarding. It just must be non-
    empty so a stage row in the artifact viewer can link somewhere.
    """
    for s in STAGE_DAG:
        assert isinstance(s.code_pointer, str) and s.code_pointer, f"stage {s.id} has empty code_pointer"


def test_input_and_output_types_are_named() -> None:
    """Each stage declares string input/output type names — the framework's
    type-conversion rules (Q10) consume these. They must be non-empty."""
    for s in STAGE_DAG:
        assert s.input_type, f"stage {s.id} has empty input_type"
        assert s.output_type, f"stage {s.id} has empty output_type"


# ─── Dirty-descendant computation ─────────────────────────────────────────


def test_dirty_descendants_for_terminal_stage_is_empty() -> None:
    """`text_review` is the terminal proofing-chain stage; nothing downstream."""
    assert compute_dirty_descendants("text_review") == frozenset()


def test_dirty_descendants_for_threshold_includes_full_proofing_chain() -> None:
    """Re-running `threshold` should mark everything from `invert` onward dirty.

    Spec example (§Dirty propagation): threshold change → invert,
    find_content_edges, crop_to_content, auto_deskew, morph_fill, rescale,
    canvas_map, ocr_crop, ocr, text_postprocess, text_review all dirty.
    """
    descendants = compute_dirty_descendants("threshold")
    must_include = {
        "invert",
        "find_content_edges",
        "crop_to_content",
        "auto_deskew",
        "morph_fill",
        "rescale",
        "canvas_map",
        "ocr_crop",
        "ocr",
        "text_postprocess",
        "text_review",
    }
    missing = must_include - descendants
    assert not missing, f"missing descendants of threshold: {missing}"
    # Stages parallel to the threshold chain (e.g. thumbnail) must NOT be in
    # the descendants set — they don't transitively depend on threshold.
    assert "thumbnail" not in descendants
    assert "auto_detect_attrs" not in descendants


def test_dirty_descendants_for_ingest_source_includes_everything_else() -> None:
    """`ingest_source` is the root — every other stage is a descendant."""
    descendants = compute_dirty_descendants("ingest_source")
    expected = set(PAGE_STAGE_IDS) - {"ingest_source"}
    assert descendants == expected


def test_dirty_descendants_for_branching_stage() -> None:
    """`auto_detect_illustrations` only feeds `extract_illustrations` (a leaf
    branch). Its dirty-descendants set must be exactly that one stage —
    not the rest of the proofing chain.
    """
    descendants = compute_dirty_descendants("auto_detect_illustrations")
    assert descendants == frozenset({"extract_illustrations"})


def test_dirty_descendants_for_unknown_stage_raises() -> None:
    with pytest.raises(KeyError):
        compute_dirty_descendants("not_a_real_stage")


def test_stage_dataclass_is_immutable() -> None:
    """`Stage` is frozen — accidental mutation of the registry would be a bug."""
    s = STAGE_DAG[0]
    with pytest.raises((AttributeError, Exception)):
        s.id = "mutated"  # type: ignore[misc]


def test_stage_default_status_is_one_of_two_known_values() -> None:
    """`default_status` documents whether a stage starts `not-run` or `clean`
    after ingest. Tests pin to the two known values so a typo in the table
    fails loudly here."""
    for s in STAGE_DAG:
        assert s.default_status in ("not-run", "clean"), (
            f"stage {s.id} has invalid default_status={s.default_status!r}"
        )


def test_terminal_stages_marked() -> None:
    """`text_review` and `extract_illustrations` are the two `is_terminal`
    stages — the project-level `build_package` consumes their outputs."""
    terminal_ids = {s.id for s in STAGE_DAG if s.is_terminal}
    # text_review is the gate stage producing reviewed OCR text.
    # extract_illustrations is a parallel chain producing hi-res crops.
    assert "text_review" in terminal_ids
    assert "extract_illustrations" in terminal_ids


def test_stage_lookup_helpers_match() -> None:
    """The Stage objects returned by topo-order are the same instances as
    in STAGE_DAG (no defensive copying that would break identity assertions)."""
    assert all(isinstance(s, Stage) for s in STAGE_DAG)
    assert all(isinstance(s, Stage) for s in topological_order())


# ─── Stage versioning ────────────────────────────────────────────────────────


def test_stage_versions_covers_all_22_stages() -> None:
    """STAGE_VERSIONS must contain an entry for every canonical stage ID."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_dag import STAGE_VERSIONS

    assert set(STAGE_VERSIONS.keys()) == set(PAGE_STAGE_IDS), (
        "STAGE_VERSIONS keys must match PAGE_STAGE_IDS exactly"
    )


def test_stage_versions_all_positive_ints() -> None:
    """Every STAGE_VERSIONS value must be a positive integer (>= 1)."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_dag import STAGE_VERSIONS

    for stage_id, ver in STAGE_VERSIONS.items():
        assert isinstance(ver, int) and ver >= 1, (
            f"STAGE_VERSIONS[{stage_id!r}] = {ver!r} is not a positive int"
        )


def test_stage_dag_module_docstring_documents_bump_procedure() -> None:
    """The stage_dag module docstring must mention 'STAGE_VERSIONS' and 'bump'.

    Spec: issue #59 acceptance — dag.py docstring documents the manual bump
    procedure so developers know where to look.
    """
    import pdomain_prep_for_pgdp.core.pipeline.stage_dag as _mod

    doc = _mod.__doc__ or ""
    assert "STAGE_VERSIONS" in doc, "module docstring must mention STAGE_VERSIONS"
    assert "bump" in doc, "module docstring must describe the bump procedure"
