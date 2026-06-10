"""hyphen_join stage — end-of-line hyphen candidate detection and join decisions.

PLACEMENT: App-local (PGDP-specific). See docs/specs/library-placement.md §3.

Decisions are EVENTS FIRST. The stage artifact reflects applied joins,
but the original text (pre-join) is never destroyed — the event log plus
original text is the canonical source (idempotent re-run contract).

This module provides:
  1. detect_candidates(text) -> list of candidate dicts
  2. apply_join_decisions(text, decisions) -> transformed text
  3. make_hyphen_join_decision(...) -> event dict

The v2 stage callable (hyphen_join_v2_cpu) is registered in V2_STAGE_IMPL.
"""

from __future__ import annotations

import hashlib
import re
from typing import Any, Literal

# ────────────────────────────────────────────────────────────────────────────
# End-of-line hyphen candidate detection
# ────────────────────────────────────────────────────────────────────────────

# Match a word followed by a hyphen at end of line, then the continuation word
# on the next line.
# Pattern: <word>-\n<word>
# Note: em-dash (—) is NOT matched; only ASCII hyphen (-) before \n.
_EOL_HYPHEN_RE = re.compile(r"(\b\w+)-\n(\w+)", re.UNICODE)


def detect_candidates(text: str) -> list[dict[str, Any]]:
    """Detect end-of-line hyphen candidates in text.

    A candidate is an occurrence of <word>-\\n<continuation>.

    False positives excluded:
      - Em-dash (—) before newline: not a hyphen candidate.
      - Already-joined lines (no hyphen before \\n): not a candidate.

    Returns:
        List of candidate dicts:
            {
                "candidate_id": str,      # stable hash of (prefix, suffix, offset)
                "prefix": str,            # word before the hyphen
                "suffix": str,            # word after the newline
                "offset": int,            # character offset in text
                "match_text": str,        # the matched substring
            }
    """
    candidates: list[dict[str, Any]] = []

    for m in _EOL_HYPHEN_RE.finditer(text):
        prefix = m.group(1)
        suffix = m.group(2)
        offset = m.start()
        match_text = m.group(0)

        # Generate a stable candidate ID based on content + position
        candidate_id = _stable_candidate_id(prefix, suffix, offset)

        candidates.append(
            {
                "candidate_id": candidate_id,
                "prefix": prefix,
                "suffix": suffix,
                "offset": offset,
                "match_text": match_text,
            }
        )

    return candidates


def _stable_candidate_id(prefix: str, suffix: str, offset: int) -> str:
    """Generate a stable, collision-resistant candidate ID."""
    key = f"{prefix}\x00{suffix}\x00{offset}"
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]  # noqa: S324 — non-cryptographic


# ────────────────────────────────────────────────────────────────────────────
# Apply join decisions to text (pure transformation, deterministic)
# ────────────────────────────────────────────────────────────────────────────


def apply_join_decisions(
    text: str,
    decisions: list[dict[str, Any]],
) -> str:
    """Apply hyphen-join decisions to the original text.

    This function is PURE and DETERMINISTIC:
      - Same (text, decisions) always produces the same result.
      - The original text is not mutated; a new string is returned.
      - Applying the same decisions twice gives the same result (idempotent).

    Decisions list:
        [{"candidate_id": str, "decision": "join" | "keep"}, ...]

    "join": Remove the hyphen and newline; concatenate prefix+suffix.
    "keep": Leave the hyphen-newline as-is (no change).

    If a candidate_id in decisions does not match any detected candidate in
    the text, it is silently ignored (the candidate may have been already
    processed or text changed).

    Args:
        text: Original pre-join text.
        decisions: List of decision dicts from events.

    Returns:
        Transformed text with accepted joins applied.
    """
    # Build decision map: candidate_id → decision
    decision_map: dict[str, str] = {}
    for d in decisions:
        cid = str(d["candidate_id"])
        dec = str(d["decision"])
        decision_map[cid] = dec

    if not decision_map:
        return text

    # Detect all candidates in the text
    candidates = detect_candidates(text)

    # Build set of offsets to join
    join_offsets: set[int] = set()
    for cand in candidates:
        cid = str(cand["candidate_id"])
        if decision_map.get(cid) == "join":
            join_offsets.add(int(cand["offset"]))

    if not join_offsets:
        return text

    # Apply joins by replacing matched substrings
    # Process from right to left so offsets remain valid
    sorted_candidates = sorted(
        [c for c in candidates if int(c["offset"]) in join_offsets],
        key=lambda c: int(c["offset"]),
        reverse=True,
    )

    result = text
    for cand in sorted_candidates:
        prefix = str(cand["prefix"])
        suffix = str(cand["suffix"])
        match_text = str(cand["match_text"])
        # Join: remove hyphen and newline, concatenate
        joined = prefix + suffix
        result = result.replace(match_text, joined, 1)

    return result


# ────────────────────────────────────────────────────────────────────────────
# Event constructor
# ────────────────────────────────────────────────────────────────────────────


def make_hyphen_join_decision(
    *,
    candidate_id: str,
    decision: Literal["join", "keep"],
    actor_id: str,
    page_id: str,
) -> dict[str, Any]:
    """Construct a HyphenJoinDecision event dict.

    This is a projection-level event. The caller is responsible for persisting
    via PrepProjectAggregate if persistence is required.

    Returns:
        {
            "event_type": "HyphenJoinDecision",
            "candidate_id": str,
            "decision": "join" | "keep",
            "actor_id": str,
            "page_id": str,
        }
    """
    return {
        "event_type": "HyphenJoinDecision",
        "candidate_id": candidate_id,
        "decision": decision,
        "actor_id": actor_id,
        "page_id": page_id,
    }


# ────────────────────────────────────────────────────────────────────────────
# v2 stage callable
# ────────────────────────────────────────────────────────────────────────────


def hyphen_join_v2_cpu(text_bytes: bytes, cfg: Any = None) -> bytes:
    """v2 hyphen_join stage callable.

    Takes text bytes (UTF-8 output from wordcheck/ocr) and returns text bytes
    with any auto-approved join candidates applied.

    In the default (no decision events) mode, the stage returns the text
    unchanged — all join decisions are made interactively in the textReviewTool.
    This ensures the pre-join text is always the canonical input and no
    irreversible transforms happen without explicit user decision.

    If cfg exposes pre-computed decisions (e.g. from a cached event replay),
    those are applied here.

    The pre-join text is never destroyed — the stage artifact is the post-join
    text, but the event log (HyphenJoinDecision events) + original text makes
    it fully reproducible.
    """
    text = text_bytes.decode("utf-8")

    # Extract pre-approved join decisions from config if available
    decisions: list[dict[str, Any]] = []
    if cfg is not None:
        raw_decisions = getattr(cfg, "hyphen_join_decisions", None)
        if raw_decisions:
            decisions = list(raw_decisions)

    result = apply_join_decisions(text, decisions)
    return result.encode("utf-8")
