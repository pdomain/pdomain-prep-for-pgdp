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


def test_marker_excluded_from_numbered_prefixes(tmp_path: object) -> None:
    """Marker blank (run:None) is unnumbered but KEPT in the package order.

    P3.1 — the headline distinction:
    - A counted blank (role:blank + run:set) gets a real number and a prefix.
    - A marker blank (role:blank + run:None, label="[Blank Page]") has no
      prefix (no folio), but is NOT added to skip_ids — it is kept in order.
    - A skip leaf IS added to skip_ids (dropped from the package).

    Also verifies that the run counter is unaffected by the marker: the
    neighbour at idx0=3 gets label "3", not "4".
    """
    run = NumberingRun(id="body", style=RunStyle.arabic, start=1, step=1, role=LeafRole.text)
    pages = [_page(i, PageType.normal) for i in range(4)]
    assign: dict[int, tuple[LeafRole, str | None]] = {
        0: (LeafRole.text, "body"),
        1: (LeafRole.blank, "body"),  # counted blank — gets number + prefix
        2: (LeafRole.blank, None),  # [Blank Page] marker — no prefix, NOT in skip_ids
        3: (LeafRole.text, "body"),
    }
    raw = materialize_naming_manifest(
        project_id="p",
        ordered_pages=pages,
        project_config=None,  # type: ignore[arg-type]
        data_root=tmp_path,  # type: ignore[arg-type]
        runs=[run],
        leaf_assignments=assign,
    )
    manifest = json.loads(raw)
    by_idx = {e["idx0"]: e for e in manifest["pages"]}

    # Counted blank: gets a real prefix (has an ordinal from the run).
    assert by_idx[1]["prefix"] is not None, "counted blank must have a prefix"
    assert by_idx[1]["label"] == "2"

    # Marker: no prefix (no folio), but NOT in skip_ids.
    assert by_idx[2]["prefix"] is None, "marker must have no prefix"
    assert "0002" not in manifest["skip_ids"], "marker must NOT appear in skip_ids"

    # Neighbour unaffected — counter at 3 (marker did not consume).
    assert by_idx[3]["label"] == "3"

    # All 4 pages appear in the pages list regardless.
    assert len(manifest["pages"]) == 4


def test_skip_leaf_is_in_skip_ids(tmp_path: object) -> None:
    """A skip leaf is excluded from the package (appears in skip_ids).

    Ensures the marker-vs-skip distinction is correct: skip goes into
    skip_ids; marker does not.
    """
    run = NumberingRun(id="body", style=RunStyle.arabic, start=1, step=1, role=LeafRole.text)
    pages = [_page(0, PageType.normal), _page(1, PageType.skip), _page(2, PageType.normal)]
    assign: dict[int, tuple[LeafRole, str | None]] = {
        0: (LeafRole.text, "body"),
        1: (LeafRole.skip, None),
        2: (LeafRole.text, "body"),
    }
    raw = materialize_naming_manifest(
        project_id="p",
        ordered_pages=pages,
        project_config=None,  # type: ignore[arg-type]
        data_root=tmp_path,  # type: ignore[arg-type]
        runs=[run],
        leaf_assignments=assign,
    )
    manifest = json.loads(raw)
    assert "0001" in manifest["skip_ids"], "skip leaf must appear in skip_ids"
    assert "0000" not in manifest["skip_ids"]
    assert "0002" not in manifest["skip_ids"]


def test_cover_has_own_prefix_and_is_not_in_skip_ids(tmp_path: object) -> None:
    """A cover leaf gets its own ``<seq>e`` prefix and is NOT in skip_ids.

    cover is a special packaging path — not excluded like a skip, not
    unnumbered like a plate, not a run consumer like text/blank.

    Expected values (cover at idx0=0, proof_start=0, seq_width=3):
      - prefix: "000e"   (seq=000, type-letter "e" for cover)
      - label:  ""       (cover with run:None → empty string, not MARKER or "—")
      - NOT in skip_ids
    """
    run = NumberingRun(id="body", style=RunStyle.arabic, start=1, step=1, role=LeafRole.text)
    pages = [_page(0, PageType.cover), _page(1, PageType.normal)]
    assign: dict[int, tuple[LeafRole, str | None]] = {
        0: (LeafRole.cover, None),
        1: (LeafRole.text, "body"),
    }
    raw = materialize_naming_manifest(
        project_id="p",
        ordered_pages=pages,
        project_config=None,  # type: ignore[arg-type]
        data_root=tmp_path,  # type: ignore[arg-type]
        runs=[run],
        leaf_assignments=assign,
    )
    manifest = json.loads(raw)
    by_idx = {e["idx0"]: e for e in manifest["pages"]}

    # Cover gets its own "<seq>e" prefix — NOT None, NOT in skip_ids.
    assert by_idx[0]["prefix"] == "000e", f"cover prefix must be '000e', got {by_idx[0]['prefix']!r}"
    assert by_idx[0]["label"] == "", f"cover label must be '', got {by_idx[0]['label']!r}"
    assert "0000" not in manifest["skip_ids"], "cover must NOT appear in skip_ids"

    # Sanity: the body page still gets its prefix normally.
    assert by_idx[1]["prefix"] is not None, "body page must have a prefix"
    assert by_idx[1]["label"] == "1"


def test_plate_gets_prefix_and_unnumbered_label(tmp_path: object) -> None:
    """A plate leaf gets a plate-style prefix (seq + section + plate-letter) and label '—'.

    Plates are included in the package (not in skip_ids) with no folio.
    """
    from pdomain_prep_for_pgdp.core.numbering import UNNUMBERED

    run = NumberingRun(id="body", style=RunStyle.arabic, start=1, step=1, role=LeafRole.text)
    pages = [_page(0, PageType.normal), _page(1, PageType.plate_b), _page(2, PageType.normal)]
    assign: dict[int, tuple[LeafRole, str | None]] = {
        0: (LeafRole.text, "body"),
        1: (LeafRole.plate, None),  # plate: no folio, but has a prefix
        2: (LeafRole.text, "body"),
    }
    raw = materialize_naming_manifest(
        project_id="p",
        ordered_pages=pages,
        project_config=None,  # type: ignore[arg-type]
        data_root=tmp_path,  # type: ignore[arg-type]
        runs=[run],
        leaf_assignments=assign,
    )
    manifest = json.loads(raw)
    by_idx = {e["idx0"]: e for e in manifest["pages"]}

    # Plate: has a prefix but no folio number in the label.
    assert by_idx[1]["prefix"] is not None, "plate must have a prefix"
    assert by_idx[1]["label"] == UNNUMBERED, f"plate label must be '—', got {by_idx[1]['label']!r}"
    # Plate is NOT in skip_ids — it is included in the package.
    assert "0001" not in manifest["skip_ids"], "plate must NOT be in skip_ids"
