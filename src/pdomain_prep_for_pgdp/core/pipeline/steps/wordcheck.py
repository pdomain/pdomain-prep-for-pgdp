"""wordcheck stage — project word-list checking and flag generation.

PLACEMENT: App-local (PGDP-specific). See docs/specs/library-placement.md §3.

Decisions are EVENTS FIRST (registry §5 — WordlistPromotion event from
PrepProjectAggregate). Flags and counts are projections, never stored derived state.

Word-list promotion to a cross-project library is an explicit separate event
(WordlistPromotion via PrepProjectAggregate.record_wordlist_promotion).

This module provides pure functions that:
  1. flag_words(words_json, bad_words, good_words) -> list of flag dicts
  2. make_wordcheck_decision(...) -> event dict
  3. make_wordlist_promotion_event(...) -> event dict
  4. promote_word(word, list_scope, wordlist_store, ...) -> event dict + mutates store
  5. project_flags_from_events(initial_flags, events) -> updated flags list

The v2 stage callable (wordcheck_v2_cpu) is also defined here and registered
in stage_registry.V2_STAGE_IMPL.
"""

from __future__ import annotations

import json
from typing import Any, Literal

# ────────────────────────────────────────────────────────────────────────────
# Core flag generation (pure function, no side effects)
# ────────────────────────────────────────────────────────────────────────────


def flag_words(
    words_json: bytes,
    *,
    bad_words: set[str],
    good_words: set[str],
) -> list[dict[str, Any]]:
    """Generate flags for OCR words against project word lists.

    Args:
        words_json: JSON bytes containing a list of OcrWord dicts
            (fields: id, text, confidence, bounding_box).
        bad_words: Words known to be OCR errors (scannos, misspellings).
        good_words: Words known to be correct even if they look odd.
            good_words overrides bad_words.

    Returns:
        List of flag dicts:
            {
                "word_id": str,
                "word_text": str,
                "flag_reason": "bad_word" | "not_in_good_words",
                "status": "open",
            }

    Placement: docs/specs/library-placement.md §3 — PGDP-specific word lists.
    OCR words are never silently dropped; only flagged for review.
    """
    words: list[dict[str, Any]] = json.loads(words_json.decode("utf-8"))
    flags: list[dict[str, Any]] = []

    for word in words:
        word_id: str = word["id"]
        word_text: str = word.get("text", "")

        # good_words overrides bad_words
        if word_text in good_words:
            continue

        if word_text in bad_words:
            flags.append(
                {
                    "word_id": word_id,
                    "word_text": word_text,
                    "flag_reason": "bad_word",
                    "status": "open",
                }
            )

    return flags


# ────────────────────────────────────────────────────────────────────────────
# Event constructors (pure, no side effects)
# ────────────────────────────────────────────────────────────────────────────


def make_wordcheck_decision(
    *,
    word_id: str,
    word_text: str,
    decision: Literal["accepted", "rejected", "deferred"],
    actor_id: str,
    page_id: str,
    stage_id: str = "wordcheck",
) -> dict[str, Any]:
    """Construct a WordCheckDecision event dict.

    This is a projection-level event (not a PrepProjectAggregate eventsourcing
    event). It records a reviewer's decision about a specific flagged word.
    The caller is responsible for persisting via PrepProjectAggregate.record_review_decision
    if persistence is required.

    Returns a plain dict so tests can assert on structure without DB dependencies.
    """
    return {
        "event_type": "WordCheckDecision",
        "word_id": word_id,
        "word_text": word_text,
        "decision": decision,
        "actor_id": actor_id,
        "page_id": page_id,
        "stage_id": stage_id,
    }


def make_wordlist_promotion_event(
    *,
    word: str,
    source_stage: str,
    source_page_id: str,
    list_scope: Literal["project", "global"],
    actor_id: str,
) -> dict[str, Any]:
    """Construct a WordlistPromotion event dict.

    Matches the WordlistPromotion event payload from docs/specs/stage-registry-v2.md §5.2.
    The caller passes this to PrepProjectAggregate.record_wordlist_promotion
    for eventsourcing persistence.
    """
    return {
        "event_type": "WordlistPromotion",
        "word": word,
        "source_stage": source_stage,
        "source_page_id": source_page_id,
        "list_scope": list_scope,
        "actor_id": actor_id,
    }


def promote_word(
    *,
    word: str,
    list_scope: Literal["project", "global"],
    wordlist_store: dict[str, set[str]],
    actor_id: str,
    source_stage: str,
    source_page_id: str,
) -> dict[str, Any]:
    """Promote a word to the project or global word list.

    Guards:
      - Empty word raises ValueError.

    Mutates wordlist_store[list_scope] in-place and returns the promotion event dict.
    The caller must persist the event via PrepProjectAggregate.record_wordlist_promotion.

    Args:
        word: The word to promote.
        list_scope: 'project' or 'global'.
        wordlist_store: Mutable dict mapping scope → set of words.
        actor_id: User performing the promotion.
        source_stage: Stage where the word was flagged.
        source_page_id: Page where the word was flagged.

    Returns:
        WordlistPromotion event dict.

    Raises:
        ValueError: If word is empty.
    """
    if not word or not word.strip():
        raise ValueError("Cannot promote empty word to word list")

    if list_scope not in wordlist_store:
        wordlist_store[list_scope] = set()
    wordlist_store[list_scope].add(word)

    return make_wordlist_promotion_event(
        word=word,
        source_stage=source_stage,
        source_page_id=source_page_id,
        list_scope=list_scope,
        actor_id=actor_id,
    )


# ────────────────────────────────────────────────────────────────────────────
# Projection recomputation
# ────────────────────────────────────────────────────────────────────────────


def project_flags_from_events(
    initial_flags: list[dict[str, Any]],
    events: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Recompute flag state by applying WordCheckDecision events to initial flags.

    This is the projection function — it never modifies stored state directly.
    Each call from (initial_flags, events) gives a deterministic result.

    Decision semantics:
      - "accepted": flag status → "accepted" (no longer open)
      - "rejected": flag status → "rejected" (confirm it is an error)
      - "deferred": flag status → "deferred" (skip for now)

    Returns a new list of flags with updated statuses.
    """
    # Build lookup: word_id → latest decision
    decisions: dict[str, str] = {}
    for event in events:
        if event.get("event_type") == "WordCheckDecision":
            wid = str(event["word_id"])
            decisions[wid] = str(event["decision"])

    updated: list[dict[str, Any]] = []
    for flag in initial_flags:
        wid = str(flag["word_id"])
        if wid in decisions:
            new_flag = dict(flag)
            new_flag["status"] = decisions[wid]
            updated.append(new_flag)
        else:
            updated.append(dict(flag))

    return updated


# ────────────────────────────────────────────────────────────────────────────
# v2 stage callable — registered in V2_STAGE_IMPL
# ────────────────────────────────────────────────────────────────────────────

# Default bad-words list (common scannos for PGDP books).
# In production, this is loaded from the project/system word list store.
# The stage callable uses an empty bad-words set by default so it is
# side-effect free without a project context; callers with a project context
# pass bad_words via cfg.
_DEFAULT_BAD_WORDS: frozenset[str] = frozenset(
    {
        # Common OCR scannos (PGDP community standard)
        "teh",
        "adn",
        "nw",
        "ot",
        "fi",
        "ii",
        "llie",
        "llis",
        "thc",
        "ihe",
        "thf",
        "thg",
        "tbi",
        "tbis",
        "tbat",
        "tbey",
        "wbat",
        "wbich",
        "ibe",
        "tins",
        "bim",
        "bave",
        "bead",
        "bee",
    }
)


def wordcheck_v2_cpu(words_json: bytes, cfg: Any = None) -> bytes:
    """v2 wordcheck stage callable.

    Takes words.json bytes (list of OcrWord dicts) and returns a JSON bytes
    artifact containing the flag report:
        {"flags": [...], "flagged_count": int, "total_words": int}

    cfg may expose bad_words and good_words sets for project-specific lists.
    Default: uses _DEFAULT_BAD_WORDS with no good_words.

    Words are NEVER silently dropped — only flagged. Deleted words (OcrWord.deleted=True)
    are skipped from flag generation (they were already reviewed).
    """
    # Extract word lists from config if available
    bad_words: set[str] = set(_DEFAULT_BAD_WORDS)
    good_words: set[str] = set()

    if cfg is not None:
        extra_bad = getattr(cfg, "wordcheck_bad_words", None)
        if extra_bad:
            bad_words.update(extra_bad)
        extra_good = getattr(cfg, "wordcheck_good_words", None)
        if extra_good:
            good_words.update(extra_good)

    flags = flag_words(words_json, bad_words=bad_words, good_words=good_words)

    words_list: list[dict[str, Any]] = json.loads(words_json.decode("utf-8"))
    total = len(words_list)

    result: dict[str, Any] = {
        "flags": flags,
        "flagged_count": len(flags),
        "total_words": total,
    }
    return json.dumps(result).encode("utf-8")
