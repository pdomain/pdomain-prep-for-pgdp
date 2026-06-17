"""P1.7 — materialize_naming_manifest derives labels from compute_labels / runs.

Tests that:
- The v2 manifest carries a ``label`` and ``run_id`` per entry.
- A [Blank Page] marker leaf gets MARKER and does not consume a run counter.
- MANIFEST_VERSION == 2.
"""

from __future__ import annotations

import json

from pdomain_prep_for_pgdp.core.models import (
    LeafRole,
    NumberingRun,
    PageRecord,
    PageType,
    RunStyle,
)
from pdomain_prep_for_pgdp.core.pipeline.steps.page_order import (
    MANIFEST_VERSION,
    materialize_naming_manifest,
)


def _page(idx0: int, pt: PageType) -> PageRecord:
    return PageRecord(
        project_id="p",
        idx0=idx0,
        prefix="",
        source_stem=f"s{idx0}",
        page_type=pt,
    )


def test_manifest_version_is_2() -> None:
    """MANIFEST_VERSION constant must be 2 after the P1.7 bump."""
    assert MANIFEST_VERSION == 2


def test_manifest_v2_counted_blank_vs_marker(tmp_path: object) -> None:
    """Counted blank (blank+run) consumes a number; marker (blank+run:None) does not.

    Per the numbering-runs design (docs/plans/2026-06-17-page-numbering-runs-model.md
    §compute_labels): a ``role:blank`` leaf WITH a run is COUNTED (consumes a
    folio); a ``role:blank`` leaf with ``run:None`` is the ``[Blank Page]``
    marker (held out of the count).

    Sequence: normal(0) → counted-blank(1, run) → marker-blank(2, run:None) →
    normal(3, run).  Expected labels: "1", "2", "[Blank Page]", "3"
    (the marker did NOT consume; the counted blank DID).
    """
    from pdomain_prep_for_pgdp.core.numbering import MARKER

    run = NumberingRun(id="body", style=RunStyle.arabic, start=1, step=1, role=LeafRole.text)
    pages = [
        _page(0, PageType.normal),
        _page(1, PageType.blank),
        _page(2, PageType.blank),
        _page(3, PageType.normal),
    ]
    leaf_assignments: dict[int, tuple[LeafRole, str | None]] = {
        0: (LeafRole.text, "body"),
        1: (LeafRole.blank, "body"),  # counted blank
        2: (LeafRole.blank, None),  # [Blank Page] marker
        3: (LeafRole.text, "body"),
    }
    raw = materialize_naming_manifest(
        project_id="p",
        ordered_pages=pages,
        project_config=None,  # type: ignore[arg-type]
        data_root=tmp_path,  # type: ignore[arg-type]
        runs=[run],
        leaf_assignments=leaf_assignments,
    )
    manifest = json.loads(raw)
    assert manifest["version"] == MANIFEST_VERSION == 2

    by_idx = {e["idx0"]: e for e in manifest["pages"]}

    # idx0=0: first numbered text leaf → "1"
    assert by_idx[0]["label"] == "1", f"got {by_idx[0]['label']!r}"
    assert by_idx[0]["run_id"] == "body"

    # idx0=1: counted blank (blank + run) → consumes → "2"
    assert by_idx[1]["label"] == "2", f"got {by_idx[1]['label']!r}"
    assert by_idx[1]["run_id"] == "body"

    # idx0=2: marker (blank + run:None) → MARKER, does NOT consume
    assert by_idx[2]["label"] == MARKER, f"got {by_idx[2]['label']!r}"
    assert by_idx[2]["run_id"] is None

    # idx0=3: next text leaf → "3" (marker did not consume; counted blank did)
    assert by_idx[3]["label"] == "3", f"got {by_idx[3]['label']!r}"
    assert by_idx[3]["run_id"] == "body"


def test_manifest_v2_has_label_and_run_id_keys(tmp_path: object) -> None:
    """Every manifest entry must have 'label' and 'run_id' keys in v2."""
    run = NumberingRun(id="body", style=RunStyle.arabic, start=1, step=1, role=LeafRole.text)
    pages = [_page(0, PageType.normal)]
    leaf_assignments: dict[int, tuple[LeafRole, str | None]] = {0: (LeafRole.text, "body")}

    raw = materialize_naming_manifest(
        project_id="p",
        ordered_pages=pages,
        project_config=None,  # type: ignore[arg-type]
        data_root=tmp_path,  # type: ignore[arg-type]
        runs=[run],
        leaf_assignments=leaf_assignments,
    )
    manifest = json.loads(raw)
    for entry in manifest["pages"]:
        assert "label" in entry, f"'label' key missing from entry: {entry}"
        assert "run_id" in entry, f"'run_id' key missing from entry: {entry}"


def test_manifest_v2_no_run_assignment_blank_is_marker(tmp_path: object) -> None:
    """A blank page with no run assignment (run_id=None) still gets MARKER.

    This covers the stopgap path where leaf_assignments has run_id=None.
    compute_labels: blank with run=None → MARKER.
    """
    from pdomain_prep_for_pgdp.core.numbering import MARKER

    pages = [_page(0, PageType.blank)]
    leaf_assignments: dict[int, tuple[LeafRole, str | None]] = {0: (LeafRole.blank, None)}

    raw = materialize_naming_manifest(
        project_id="p",
        ordered_pages=pages,
        project_config=None,  # type: ignore[arg-type]
        data_root=tmp_path,  # type: ignore[arg-type]
        runs=[],
        leaf_assignments=leaf_assignments,
    )
    manifest = json.loads(raw)
    by_idx = {e["idx0"]: e for e in manifest["pages"]}
    assert by_idx[0]["label"] == MARKER
    assert by_idx[0]["run_id"] is None


def test_manifest_v2_empty_runs_no_crash(tmp_path: object) -> None:
    """materialize_naming_manifest with runs=[] and empty assignments must not crash."""
    pages = [_page(0, PageType.normal), _page(1, PageType.skip)]

    raw = materialize_naming_manifest(
        project_id="p",
        ordered_pages=pages,
        project_config=None,  # type: ignore[arg-type]
        data_root=tmp_path,  # type: ignore[arg-type]
        runs=[],
        leaf_assignments={},
    )
    manifest = json.loads(raw)
    assert manifest["version"] == 2
    assert len(manifest["pages"]) == 2
