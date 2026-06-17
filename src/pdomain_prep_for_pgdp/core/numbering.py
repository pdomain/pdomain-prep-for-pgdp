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
