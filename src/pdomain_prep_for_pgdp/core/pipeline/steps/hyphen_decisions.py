"""Saved hyphen_join decisions and the pre-join source text.

Decisions live in ``stages/hyphen_join/decisions.json``. The pre-join prose
lives in ``source.txt``. The stage ``output.txt`` is the text after joins.

Source order, first file that exists:

1. ``stages/wordcheck/output.txt`` — canonical prose before any join
2. ``stages/hyphen_join/source.txt`` — copy saved when a decision was posted
3. ``stages/hyphen_join/output.txt`` — only when nothing earlier was saved
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

from pdomain_prep_for_pgdp.core.models import HyphenJoinDecision

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence
    from pathlib import Path
from pdomain_prep_for_pgdp.core.pipeline.steps.hyphen_join import (
    apply_join_decisions,
    detect_candidates,
)

_JOIN_OR_KEEP = frozenset({"join", "keep"})


def hyphen_stage_dir(data_root: Path, project_id: str, page_id: str) -> Path:
    """Directory that holds hyphen_join artifacts for one page."""
    return data_root / "projects" / project_id / "pages" / page_id / "stages" / "hyphen_join"


def _wordcheck_output_path(data_root: Path, project_id: str, page_id: str) -> Path:
    return data_root / "projects" / project_id / "pages" / page_id / "stages" / "wordcheck" / "output.txt"


def read_hyphen_join_decisions(
    data_root: Path,
    project_id: str,
    page_id: str,
) -> list[HyphenJoinDecision]:
    """Return saved join/keep decisions. Missing or unreadable files yield []."""
    path = hyphen_stage_dir(data_root, project_id, page_id) / "decisions.json"
    if not path.is_file():
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return []
    if not isinstance(raw, dict):
        return []
    items = raw.get("decisions")
    if not isinstance(items, list):
        return []
    decisions: list[HyphenJoinDecision] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        candidate_id = item.get("candidate_id")
        decision = item.get("decision")
        if not isinstance(candidate_id, str) or not candidate_id:
            continue
        if not isinstance(decision, str) or decision not in _JOIN_OR_KEEP:
            continue
        decisions.append(HyphenJoinDecision(candidate_id=candidate_id, decision=decision))
    return decisions


def load_hyphen_source_text(data_root: Path, project_id: str, page_id: str) -> str | None:
    """Pre-join prose. Wordcheck output wins over a saved source, then stage output."""
    paths = (
        _wordcheck_output_path(data_root, project_id, page_id),
        hyphen_stage_dir(data_root, project_id, page_id) / "source.txt",
        hyphen_stage_dir(data_root, project_id, page_id) / "output.txt",
    )
    for path in paths:
        if not path.is_file():
            continue
        try:
            return path.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            continue
    return None


def parse_decision_payload(items: Sequence[Mapping[str, object]]) -> list[HyphenJoinDecision]:
    """Keep only entries whose decision is ``join`` or ``keep``."""
    parsed: list[HyphenJoinDecision] = []
    for item in items:
        candidate_id = item.get("candidate_id")
        decision = item.get("decision")
        if not isinstance(candidate_id, str) or not candidate_id:
            continue
        if not isinstance(decision, str) or decision not in _JOIN_OR_KEEP:
            continue
        parsed.append(HyphenJoinDecision(candidate_id=candidate_id, decision=decision))
    return parsed


def merge_decisions(
    existing: Sequence[HyphenJoinDecision],
    incoming: Sequence[HyphenJoinDecision],
) -> list[HyphenJoinDecision]:
    """Incoming candidate_id replaces the saved one. New ids append."""
    order: list[str] = []
    by_id: dict[str, HyphenJoinDecision] = {}
    for item in (*existing, *incoming):
        candidate_id = item["candidate_id"]
        if candidate_id not in by_id:
            order.append(candidate_id)
        by_id[candidate_id] = item
    return [by_id[candidate_id] for candidate_id in order]


def annotate_candidates(
    text: str,
    decisions: Sequence[HyphenJoinDecision],
) -> list[dict[str, object]]:
    """Detect candidates in pre-join text and attach a saved decision when one exists."""
    by_id = {item["candidate_id"]: item["decision"] for item in decisions}
    annotated: list[dict[str, object]] = []
    for raw in detect_candidates(text):
        candidate_id = str(raw["candidate_id"])
        entry: dict[str, object] = {
            "candidate_id": candidate_id,
            "prefix": str(raw["prefix"]),
            "suffix": str(raw["suffix"]),
            "offset": int(raw["offset"]),
            "match_text": str(raw["match_text"]),
        }
        saved = by_id.get(candidate_id)
        if saved is not None:
            entry["decision"] = saved
        annotated.append(entry)
    return annotated


def joined_text(text: str, decisions: Sequence[HyphenJoinDecision]) -> str:
    """Apply saved decisions. An empty list returns the text unchanged."""
    plain: list[dict[str, str]] = [
        {"candidate_id": item["candidate_id"], "decision": item["decision"]} for item in decisions
    ]
    return apply_join_decisions(text, plain)


def save_hyphen_source(data_root: Path, project_id: str, page_id: str, text: str) -> None:
    """Write the pre-join prose next to the stage artifact."""
    stage_dir = hyphen_stage_dir(data_root, project_id, page_id)
    stage_dir.mkdir(parents=True, exist_ok=True)
    _ = (stage_dir / "source.txt").write_text(text, encoding="utf-8")


def save_hyphen_decisions(
    data_root: Path,
    project_id: str,
    page_id: str,
    decisions: Sequence[HyphenJoinDecision],
) -> None:
    """Write ``{"decisions": [...]}``. An empty list is a real file the runner ignores."""
    stage_dir = hyphen_stage_dir(data_root, project_id, page_id)
    stage_dir.mkdir(parents=True, exist_ok=True)
    payload: dict[str, list[dict[str, str]]] = {
        "decisions": [
            {"candidate_id": item["candidate_id"], "decision": item["decision"]} for item in decisions
        ]
    }
    _ = (stage_dir / "decisions.json").write_text(
        json.dumps(payload, indent=2) + "\n",
        encoding="utf-8",
    )
