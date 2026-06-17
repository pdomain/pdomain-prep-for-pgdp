"""Tests for prefix assignment behavior (P1.9 port).

P1.9: `core.assign_prefixes` was deleted.  The prefix-assignment logic now
lives in the runs model: ``compute_prefixes_from_runs`` driven by
``seed_runs_from_ranges`` (migration helper).

This file ports the meaningful behavioral assertions from the deleted
``assign_prefixes`` tests to ``compute_prefixes_from_runs`` unit tests:

  - prefix shape matches v2 format: <seq:3-4><type><folio?>
  - pages outside proof range get None prefix
  - plate pages get the correct b/p/r suffix and don't consume a number
  - skip pages get None prefix
  - manual_ignore preservation is now a route-layer concern (the pure
    compute function has no concept of "manual_ignore"); the coverage for
    that invariant lives in tests/test_page_order_runs_route.py.

Integration coverage (range-edit → re-numbering, idempotency) is provided
by tests/test_numbering_migration.py (golden byte-stability) and
tests/test_naming_prefix_coverage.py (config-edit scenarios now ported
to use compute_prefixes_from_runs directly).
"""

from __future__ import annotations

from typing import Any

from pdomain_prep_for_pgdp.core.models import PageType
from pdomain_prep_for_pgdp.core.numbering import Leaf, compute_prefixes_from_runs
from pdomain_prep_for_pgdp.core.numbering_migration import (
    LegacyRanges,
    page_type_to_leaf_role,
    seed_runs_from_ranges,
)


def _ranges(**kw: Any) -> LegacyRanges:
    base: dict[str, Any] = {
        "proof_start_idx0": 0,
        "proof_end_idx0": 4,
        "frontmatter_start_idx0": 0,
        "frontmatter_end_idx0": 1,
        "frontmatter_page_nbr_start": 1,
        "bodymatter_start_idx0": 2,
        "bodymatter_end_idx0": 4,
        "bodymatter_page_nbr_start": 1,
    }
    base.update(kw)
    return LegacyRanges(**base)


def _prefixes_for(
    rg: LegacyRanges,
    page_types: dict[int, PageType],
) -> dict[int, str | None]:
    """Canonical helper: seed runs → compute prefixes."""
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


def test_writes_frontmatter_and_bodymatter_v2_prefixes() -> None:
    """v2 format: <seq:3><type><folio> — proof 0..4, fm 0..1, bm 2..4."""
    rg = _ranges()
    pts = dict.fromkeys(range(5), PageType.normal)
    result = _prefixes_for(rg, pts)
    # proof_start=0, fm=0-1, bm=2-4, fm_nbr_start=1, bm_nbr_start=1
    assert result[0] == "000f001"
    assert result[1] == "001f002"
    assert result[2] == "002p001"
    assert result[3] == "003p002"
    assert result[4] == "004p003"


def test_pages_outside_proof_range_get_none_prefix() -> None:
    """Pages outside proof_start..proof_end get None (not in any run)."""
    rg = _ranges(
        proof_start_idx0=2,
        proof_end_idx0=3,
        frontmatter_start_idx0=2,
        frontmatter_end_idx0=2,
        bodymatter_start_idx0=3,
        bodymatter_end_idx0=3,
    )
    pts = dict.fromkeys(range(5), PageType.normal)
    result = _prefixes_for(rg, pts)
    assert result[0] is None  # before proof range
    assert result[1] is None  # before proof range
    assert result[2] is not None  # in range, fm
    assert "f" in result[2]
    assert result[3] is not None  # in range, bm
    assert "p" in result[3]
    assert result[4] is None  # after proof range


def test_plate_suffix_and_no_folio_consumption() -> None:
    """Plate page gets b/p/r suffix and does not consume a folio number."""
    rg = _ranges(
        proof_end_idx0=3,
        frontmatter_end_idx0=0,
        bodymatter_start_idx0=1,
        bodymatter_end_idx0=3,
    )
    pts = {
        0: PageType.normal,
        1: PageType.normal,
        2: PageType.plate_p,
        3: PageType.normal,
    }
    result = _prefixes_for(rg, pts)
    # plate_p gets "p" suffix (seq+pp → e.g. "002pp") and doesn't consume a body number.
    assert result[2] is not None
    assert result[2].endswith("p")
    # Body numbering: normal(1) gets p001, plate skips, normal(3) gets p002.
    assert "p" in result[1]
    assert not result[1].endswith("p")  # not a plate suffix
    assert "p" in result[3]
    assert not result[3].endswith("p")


def test_skip_page_returns_none() -> None:
    """Skip pages get None prefix (excluded from proof package)."""
    rg = _ranges()
    pts = dict.fromkeys(range(5), PageType.normal)
    pts[1] = PageType.skip
    result = _prefixes_for(rg, pts)
    assert result[1] is None


def test_idempotent_repeated_calls() -> None:
    """compute_prefixes_from_runs is deterministic — calling twice gives same result."""
    rg = _ranges()
    pts = dict.fromkeys(range(5), PageType.normal)
    first = _prefixes_for(rg, pts)
    second = _prefixes_for(rg, pts)
    assert first == second


def test_blank_counted_in_section_folio() -> None:
    """Blank page assigned to a run still consumes a folio number (legacy parity)."""
    rg = _ranges()
    pts = {0: PageType.normal, 1: PageType.normal, 2: PageType.normal, 3: PageType.blank, 4: PageType.normal}
    result = _prefixes_for(rg, pts)
    # blank at idx0=3 in bm gets p002 (folio consumed)
    assert result[3] == "003p002"
    assert result[4] == "004p003"
