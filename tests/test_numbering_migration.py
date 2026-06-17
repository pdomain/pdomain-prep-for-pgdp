"""Tests for the ranges->runs migration (P1.5/P1.6) + P1.9 byte-stability.

The golden byte-stability proof (``compute_prefixes_from_runs`` reproduces the
deleted legacy ``compute_prefix_v2``) was established WHILE ``compute_prefix_v2``
still existed (it was the live oracle).  After P1.9 deleted that function, the
proven expectations are frozen here as literals — captured verbatim from the
last green cross-check run.  See P1.9 report for the byte-stability evidence.
"""

from typing import Any

import pytest

from pdomain_prep_for_pgdp.core.models import LeafRole, PageType, PlateSide, RunStyle
from pdomain_prep_for_pgdp.core.numbering import Leaf, compute_prefixes_from_runs
from pdomain_prep_for_pgdp.core.numbering_migration import (
    LegacyRanges,
    page_type_to_leaf_role,
    seed_runs_from_ranges,
)


@pytest.mark.parametrize(
    ("pt", "role", "side"),
    [
        (PageType.normal, LeafRole.text, None),
        (PageType.blank, LeafRole.blank, None),
        (PageType.skip, LeafRole.skip, None),
        (PageType.cover, LeafRole.cover, None),
        (PageType.plate_p, LeafRole.plate, PlateSide.recto),
        (PageType.plate_b, LeafRole.plate, PlateSide.verso),
        (PageType.plate_r, LeafRole.plate, PlateSide.verso),
    ],
)
def test_page_type_to_leaf_role(pt: PageType, role: LeafRole, side: PlateSide | None) -> None:
    assert page_type_to_leaf_role(pt) == (role, side)


def test_mapping_is_exhaustive_over_page_type() -> None:
    # Every PageType member must map — guards against a new type slipping through.
    for pt in PageType:
        page_type_to_leaf_role(pt)  # must not raise


# ─── P1.6 — seed_runs_from_ranges ────────────────────────────────────────────


def _ranges(**kw: Any) -> LegacyRanges:
    base: dict[str, Any] = {
        "proof_start_idx0": 0,
        "proof_end_idx0": 5,
        "frontmatter_start_idx0": 0,
        "frontmatter_end_idx0": 1,
        "frontmatter_page_nbr_start": 1,
        "bodymatter_start_idx0": 2,
        "bodymatter_end_idx0": 5,
        "bodymatter_page_nbr_start": 1,
    }
    base.update(kw)
    return LegacyRanges(**base)


def test_legacy_ranges_from_config_dict() -> None:
    """LegacyRanges reads the raw (deleted-from-ProjectConfig) range fields."""
    raw = {
        "book_name": "b",
        "proof_start_idx0": 1,
        "proof_end_idx0": 9,
        "frontmatter_start_idx0": 1,
        "frontmatter_end_idx0": 3,
        "frontmatter_page_nbr_start": 1,
        "bodymatter_start_idx0": 4,
        "bodymatter_end_idx0": 9,
        "bodymatter_page_nbr_start": 1,
    }
    r = LegacyRanges.from_config_dict(raw)
    assert r.proof_start_idx0 == 1
    assert r.bodymatter_end_idx0 == 9
    # Missing keys fall back to historical defaults.
    assert LegacyRanges.from_config_dict({}).frontmatter_page_nbr_start == 1


def test_seed_two_runs_front_roman_body_arabic() -> None:
    rg = _ranges()
    page_types = dict.fromkeys(range(6), PageType.normal)
    runs, assign = seed_runs_from_ranges(rg, page_types)
    front = next(r for r in runs if r.style is RunStyle.roman_lower)
    body = next(r for r in runs if r.style is RunStyle.arabic)
    assert front.start == 1 and body.start == 1
    assert assign[0] == front.id and assign[1] == front.id
    assert assign[2] == body.id and assign[5] == body.id


def test_skip_and_cover_get_no_run() -> None:
    rg = _ranges()
    page_types = {
        0: PageType.cover,
        1: PageType.normal,
        2: PageType.normal,
        3: PageType.skip,
        4: PageType.normal,
        5: PageType.normal,
    }
    _, assign = seed_runs_from_ranges(rg, page_types)
    assert assign.get(0) is None  # cover -> no run
    assert assign.get(3) is None  # skip -> no run


# ─── P1.9 — golden byte-stability (frozen from the legacy compute_prefix_v2) ──
#
# Each expected dict below was captured verbatim from compute_prefixes_from_runs
# while it was cross-checked against the (now deleted) legacy compute_prefix_v2
# and proven identical (modulo the one documented interior-skip folio shift).


def _prefixes_for(
    rg: LegacyRanges,
    page_types: dict[int, PageType],
) -> dict[int, str | None]:
    """Run the runs-based prefix deriver for a migration-seeded assignment."""
    runs, assign = seed_runs_from_ranges(rg, page_types)
    leaves = [
        Leaf(scan=s, leaf_role=page_type_to_leaf_role(page_types[s])[0], run_id=assign.get(s))
        for s in sorted(page_types)
    ]
    legacy_plate = {PageType.plate_b: "b", PageType.plate_p: "p", PageType.plate_r: "r"}
    plate_suffixes = {s: legacy_plate[pt] for s, pt in page_types.items() if pt in legacy_plate}
    seq_width = 4 if (rg.proof_end_idx0 - rg.proof_start_idx0 + 1) > 999 else 3
    return compute_prefixes_from_runs(
        leaves,
        runs,
        proof_start=rg.proof_start_idx0,
        seq_width=seq_width,
        plate_suffixes=plate_suffixes,
    )


def test_golden_roman_front_arabic_body() -> None:
    rg = _ranges()
    pts = dict.fromkeys(range(6), PageType.normal)
    assert _prefixes_for(rg, pts) == {
        0: "000f001",
        1: "001f002",
        2: "002p001",
        3: "003p002",
        4: "004p003",
        5: "005p004",
    }


def test_golden_with_blank_counted() -> None:
    """A blank assigned to its run still consumes a folio number (legacy parity)."""
    rg = _ranges()
    pts = {
        0: PageType.normal,
        1: PageType.normal,
        2: PageType.normal,
        3: PageType.blank,
        4: PageType.normal,
        5: PageType.normal,
    }
    assert _prefixes_for(rg, pts) == {
        0: "000f001",
        1: "001f002",
        2: "002p001",
        3: "003p002",  # blank counted
        4: "004p003",
        5: "005p004",
    }


def test_golden_with_plate_unnumbered() -> None:
    """A plate sits in its section (suffix p) but consumes no folio number."""
    rg = _ranges()
    pts = {
        0: PageType.normal,
        1: PageType.normal,
        2: PageType.normal,
        3: PageType.plate_p,
        4: PageType.normal,
        5: PageType.normal,
    }
    assert _prefixes_for(rg, pts) == {
        0: "000f001",
        1: "001f002",
        2: "002p001",
        3: "003pp",  # plate: section letter p + plate suffix p, no folio
        4: "004p002",
        5: "005p003",
    }


def test_golden_with_skip_excluded() -> None:
    """Skip -> None (excluded).  Interior skip no longer inflates the folio.

    DOCUMENTED DIVERGENCE from legacy: legacy compute_prefix_v2 *counted* skip
    pages in the section folio (is_unnumbered excluded only plates/cover), so a
    body page after an interior skip got an inflated folio (legacy '003p002').
    The runs model does NOT consume a folio for a skip (corrected semantics);
    the filename ``seq`` prefix (binding order) is unchanged, so sort order +
    uniqueness in the zip are preserved.
    """
    rg = _ranges()
    pts = {
        0: PageType.normal,
        1: PageType.normal,
        2: PageType.skip,
        3: PageType.normal,
        4: PageType.normal,
        5: PageType.normal,
    }
    out = _prefixes_for(rg, pts)
    assert out[2] is None  # skip excluded
    assert out[0] == "000f001" and out[1] == "001f002"  # before skip: identical
    assert out[3] == "003p001"  # corrected (legacy was 003p002)
    assert out[3][:4] == "003p"  # seq + section letter unchanged -> sort stable


def test_golden_with_cover_no_folio() -> None:
    rg = _ranges(frontmatter_start_idx0=1)  # cover at 0 precedes the front run
    pts = {
        0: PageType.cover,
        1: PageType.normal,
        2: PageType.normal,
        3: PageType.normal,
        4: PageType.normal,
        5: PageType.normal,
    }
    assert _prefixes_for(rg, pts) == {
        0: "000e",  # cover: <seq>e, no folio
        1: "001f001",
        2: "002p001",
        3: "003p002",
        4: "004p003",
        5: "005p004",
    }


def test_golden_larger_book_4digit_seq() -> None:
    rg = _ranges(
        proof_start_idx0=0,
        proof_end_idx0=1100,
        frontmatter_start_idx0=0,
        frontmatter_end_idx0=9,
        bodymatter_start_idx0=10,
        bodymatter_end_idx0=1100,
    )
    pts = dict.fromkeys(range(1101), PageType.normal)
    out = _prefixes_for(rg, pts)
    # >999 proof pages -> 4-digit seq.
    assert out[0] == "0000f001"
    assert out[9] == "0009f010"
    assert out[10] == "0010p001"
    assert out[1100] == "1100p1091"
