"""Pure numbering-runs engine — mirrors statechart computeLabels/reconcile.

design-source: docs/plans/design_handoff_pgdp_app/statecharts/tool-page-order.yaml
(actions.computeLabels / actions.reconcile) and final/page_order/pr-data.js.
No I/O — labels are always derived, never stored truth.
"""

from __future__ import annotations

from dataclasses import dataclass

from pdomain_prep_for_pgdp.core.models import LeafRole, NumberingRun, RunStyle, StartMode

MARKER = "[Blank Page]"
UNNUMBERED = "—"

_ROMAN = [
    (1000, "m"),
    (900, "cm"),
    (500, "d"),
    (400, "cd"),
    (100, "c"),
    (90, "xc"),
    (50, "l"),
    (40, "xl"),
    (10, "x"),
    (9, "ix"),
    (5, "v"),
    (4, "iv"),
    (1, "i"),
]


def _to_roman(n: int) -> str:
    if n <= 0:
        return str(n)
    out, rem = "", n
    for val, sym in _ROMAN:
        while rem >= val:
            out += sym
            rem -= val
    return out


def _style_label(style: RunStyle, n: int) -> str:
    if style is RunStyle.roman_lower:
        return _to_roman(n)
    if style is RunStyle.roman_upper:
        return _to_roman(n).upper()
    if style is RunStyle.arabic:
        return str(n)
    if style is RunStyle.alpha:
        return chr(ord("A") + (n - 1)) if 1 <= n <= 26 else str(n)
    return UNNUMBERED  # RunStyle.none


@dataclass
class Leaf:
    """Minimal numbering input — scan index, role, run assignment."""

    scan: int
    leaf_role: LeafRole
    run_id: str | None
    ocr_folio: str | None = None


def compute_labels(leaves: list[Leaf], runs: list[NumberingRun]) -> dict[int, str]:
    """Compute the folio label per leaf from runs + roles + order.

    A leaf consumes a number iff it is assigned to a run AND its role is
    countable (text or blank). A blank with run:None is a [Blank Page]
    marker; a plate is unnumbered ("—"); a skip/cover with run:None has
    no label ("").
    """
    runs_by_id = {r.id: r for r in runs}
    run_pos = {r.id: i for i, r in enumerate(runs)}
    counters: dict[str, int] = {}
    last_number: dict[str, int] = {}
    labels: dict[int, str] = {}

    def effective_start(run: NumberingRun) -> int:
        if run.start_mode is StartMode.set:
            return run.start
        # continue: nearest preceding numbered run's last number + step
        for prev in reversed(runs[: run_pos[run.id]]):
            if prev.style is not RunStyle.none and prev.id in last_number:
                # continue: resume one step past the prior numbered run's last value
                return last_number[prev.id] + run.step
        return run.start

    for leaf in leaves:
        run = runs_by_id.get(leaf.run_id) if leaf.run_id else None
        if leaf.leaf_role is LeafRole.plate:
            labels[leaf.scan] = UNNUMBERED
            continue
        if run is None:
            labels[leaf.scan] = MARKER if leaf.leaf_role is LeafRole.blank else ""
            continue
        count = counters.get(run.id, 0)
        n = effective_start(run) + count * run.step
        counters[run.id] = count + 1
        last_number[run.id] = n
        labels[leaf.scan] = _style_label(run.style, n)

    return labels


def compute_ordinals(leaves: list[Leaf], runs: list[NumberingRun]) -> dict[int, int]:
    """Return ``{scan: ordinal}`` — the raw arabic number each leaf consumes.

    This is the *ordinal* a leaf consumes within its run (1-based from the
    run's effective start), independent of the run's display style.  A roman
    front-matter leaf with ``start=1`` consumes ordinal ``1`` even though its
    display label is ``"i"``.  Leaves that consume no number (plates, markers,
    skips, cover, out-of-run) are absent from the returned map.

    Used by :func:`compute_prefixes_from_runs` to reproduce the legacy v2
    filename folio component (which was always arabic, regardless of the
    section's display style).
    """
    runs_by_id = {r.id: r for r in runs}
    run_pos = {r.id: i for i, r in enumerate(runs)}
    counters: dict[str, int] = {}
    last_number: dict[str, int] = {}
    ordinals: dict[int, int] = {}

    def effective_start(run: NumberingRun) -> int:
        if run.start_mode is StartMode.set:
            return run.start
        for prev in reversed(runs[: run_pos[run.id]]):
            if prev.style is not RunStyle.none and prev.id in last_number:
                return last_number[prev.id] + run.step
        return run.start

    for leaf in leaves:
        run = runs_by_id.get(leaf.run_id) if leaf.run_id else None
        if leaf.leaf_role is LeafRole.plate or run is None:
            continue
        count = counters.get(run.id, 0)
        n = effective_start(run) + count * run.step
        counters[run.id] = count + 1
        last_number[run.id] = n
        ordinals[leaf.scan] = n

    return ordinals


_PLATE_SIDE_SUFFIX = {"recto": "p", "verso": "b"}
"""Plate-side → legacy v2 filename suffix.

Migration mapping (numbering_migration._ROLE_MAP):
  plate_p → recto, plate_b/plate_r → verso.
The legacy v2 filename suffix was the PageType letter: plate_p→"p",
plate_b→"b", plate_r→"r".  recto unambiguously maps back to "p"; verso was
either "b" or "r" in the legacy world.  We emit "b" for verso (the dominant
case); an explicit per-leaf override carries the original letter when needed.
"""


def compute_prefixes_from_runs(
    leaves: list[Leaf],
    runs: list[NumberingRun],
    *,
    proof_start: int,
    seq_width: int,
    plate_suffixes: dict[int, str] | None = None,
) -> dict[int, str | None]:
    """Reproduce the legacy v2 ``<seq><type><folio?>`` filename prefix from runs.

    This is the byte-stable replacement for ``compute_prefix_v2``.  Format
    (CT-decided, W4 Group 2):

      - ``seq``  = ``scan - proof_start``, zero-padded to ``seq_width`` digits.
      - ``type`` = ``"e"`` (cover), or section letter (``"f"`` front / ``"p"``
        body) optionally followed by a plate suffix.
      - ``folio`` = the leaf's arabic ordinal within its run, 3-digit padded;
        omitted for cover and plate leaves.

    Skip leaves and leaves with no run that are not cover/plate/blank return
    ``None`` (excluded from the package).

    Args:
        leaves: leaves in binding order.
        runs: numbering runs (front run = smallest span-start).
        proof_start: scan index of the first in-proof leaf (``seq`` origin).
        seq_width: 3 (≤999 proof pages) or 4 (>999).
        plate_suffixes: optional ``{scan: "b"|"p"|"r"}`` to preserve the exact
            legacy plate letter; defaults to the plate-side mapping.

    Returns:
        ``{scan: prefix | None}``.
    """
    _suffixes = plate_suffixes or {}
    ordinals = compute_ordinals(leaves, runs)

    # Front-section span = the earliest-starting run's span; its bounds the
    # frontmatter section.  Reproduces the legacy idx0-in-frontmatter test.
    spans: list[tuple[int, int]] = [r.span for r in runs if r.span is not None]
    front_span: tuple[int, int] | None = min(spans, key=lambda s: s[0]) if spans else None

    def section_letter(scan: int) -> str:
        if front_span is not None and front_span[0] <= scan <= front_span[1]:
            return "f"
        return "p"

    out: dict[int, str | None] = {}
    for leaf in leaves:
        scan = leaf.scan
        seq_str = f"{scan - proof_start:0{seq_width}d}"
        if leaf.leaf_role is LeafRole.skip:
            out[scan] = None
            continue
        if leaf.leaf_role is LeafRole.cover:
            out[scan] = f"{seq_str}e"
            continue
        if leaf.leaf_role is LeafRole.plate:
            suffix = _suffixes.get(scan, "b")
            out[scan] = f"{seq_str}{section_letter(scan)}{suffix}"
            continue
        # text / blank numbered leaf — needs a consumed ordinal.
        n = ordinals.get(scan)
        if n is None:
            # No run assignment and not a special role: excluded (legacy None).
            out[scan] = None
            continue
        out[scan] = f"{seq_str}{section_letter(scan)}{n:03d}"
    return out


def reconcile(labels: dict[int, str], leaves: list[Leaf]) -> dict[int, list[str]]:
    """Derive reconciliation flags from computed labels vs OCR folios.

    Flags: ``duplicate`` (same computed number appears twice),
    ``out_of_sequence`` (OCR-read folio disagrees with the computed label).
    Markers ("[Blank Page]") and unnumbered ("—"/"") are never flagged.
    """
    seen: dict[str, int] = {}
    flags: dict[int, list[str]] = {}
    for leaf in leaves:
        lf_flags: list[str] = []
        computed = labels.get(leaf.scan, "")
        if computed and computed not in (MARKER, UNNUMBERED):
            if computed in seen:
                lf_flags.append("duplicate")
            else:
                seen[computed] = leaf.scan
            if leaf.ocr_folio and leaf.ocr_folio != computed:
                lf_flags.append("out_of_sequence")
        flags[leaf.scan] = lf_flags
    return flags
