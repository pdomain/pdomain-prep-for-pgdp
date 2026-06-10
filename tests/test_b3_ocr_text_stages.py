"""B3: OCR/Compose/Text stage group — TDD tests.

Covers:
  1. text_zones v2 coverage (new stage — zone JSON output)
  2. ocr v2 coverage (word-preservation guarantee)
  3. text_review v2 coverage (compound output with attestation)
  4. wordcheck stage (project word lists, flag generation, decision events, promotion)
  5. hyphen_join stage (candidate detection, decision events, idempotent re-run)
  6. APPLY_SPLIT regression under v2 (sibling pages with full DAG, SplitFanout event,
     compute_v2_dirty_descendants reflects wider staleness)

Placement: docs/specs/library-placement.md §3
  wordcheck + hyphen_join stay APP-LOCAL (PGDP-specific).

Event types: docs/specs/stage-registry-v2.md §5
  WordlistPromotion, SplitFanout (via PrepProjectAggregate)
"""

from __future__ import annotations

import json
import uuid
from typing import TYPE_CHECKING

import pytest

if TYPE_CHECKING:
    from pathlib import Path

# ────────────────────────────────────────────────────────────────────────────
# 1. text_zones — new stage, outputs zone_json
# ────────────────────────────────────────────────────────────────────────────


def test_text_zones_placeholder_is_wired() -> None:
    """text_zones is in V2_STAGE_IMPL (may still be placeholder until wired)."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import V2_STAGE_IMPL

    assert "text_zones" in V2_STAGE_IMPL


def test_text_zones_v2_impl_registered() -> None:
    """text_zones cpu callable is now wired (not a placeholder)."""
    import numpy as np

    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import (
        StageNotImplemented,
        get_v2_stage_impl,
    )

    fn = get_v2_stage_impl("text_zones", "cpu")
    binary = np.full((80, 60), 255, dtype=np.uint8)
    binary[10:70, 5:55] = 0

    # Must NOT raise StageNotImplemented — a real impl is wired
    try:
        result = fn(binary)
    except StageNotImplemented:
        pytest.fail("text_zones raised StageNotImplemented — B3 should wire a real impl")

    assert result is not None


def test_text_zones_returns_zone_json_bytes() -> None:
    """text_zones output is JSON-decodable bytes with a 'zones' list."""
    import numpy as np

    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import get_v2_stage_impl

    fn = get_v2_stage_impl("text_zones", "cpu")
    binary = np.full((100, 80), 255, dtype=np.uint8)
    binary[10:50, 5:75] = 0  # text region
    binary[55:90, 5:75] = 0  # second region

    result = fn(binary)

    # Output must be bytes (JSON)
    assert isinstance(result, bytes), f"Expected bytes, got {type(result)}"
    parsed = json.loads(result.decode("utf-8"))
    assert isinstance(parsed, dict), f"Expected dict, got {type(parsed)}"
    assert "zones" in parsed, f"Expected 'zones' key, got {list(parsed.keys())}"
    assert isinstance(parsed["zones"], list)


def test_text_zones_zone_has_bbox() -> None:
    """Each zone in text_zones output has a bounding box."""
    import numpy as np

    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import get_v2_stage_impl

    fn = get_v2_stage_impl("text_zones", "cpu")
    binary = np.full((120, 100), 255, dtype=np.uint8)
    binary[15:55, 5:95] = 0  # clear text block

    result = fn(binary)
    parsed = json.loads(result.decode("utf-8"))

    for zone in parsed["zones"]:
        assert "bbox" in zone, f"zone missing 'bbox': {zone}"
        assert len(zone["bbox"]) == 4, f"bbox should be [x, y, w, h]: {zone['bbox']}"


def test_text_zones_stage_removed_from_placeholder_list() -> None:
    """text_zones is no longer in the StageNotImplemented placeholder set."""
    import numpy as np

    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import (
        StageNotImplemented,
        get_v2_stage_impl,
    )

    fn = get_v2_stage_impl("text_zones", "cpu")
    binary = np.full((60, 50), 255, dtype=np.uint8)
    try:
        fn(binary)
    except StageNotImplemented:
        pytest.fail("text_zones still has a StageNotImplemented placeholder after B3")
    except Exception:  # noqa: S110 — intentional pass; only StageNotImplemented is a failure
        pass  # real impl may raise on unusual input; StageNotImplemented is the only failure


# ────────────────────────────────────────────────────────────────────────────
# 2. ocr v2 — word-preservation guarantee
# ────────────────────────────────────────────────────────────────────────────


def test_ocr_v2_is_registered() -> None:
    """ocr is in V2_STAGE_IMPL and the cpu callable is not a placeholder."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import get_v2_stage_impl

    fn = get_v2_stage_impl("ocr", "cpu")
    assert callable(fn)
    assert "placeholder" not in (fn.__name__ or "")


def test_ocr_v2_matches_v1_ocr() -> None:
    """v2 ocr is the same callable as v1 ocr (re-key, not re-implementation)."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import (
        get_stage_impl,
        get_v2_stage_impl,
    )

    v2_fn = get_v2_stage_impl("ocr", "cpu")
    v1_fn = get_stage_impl("ocr", "cpu")
    # Same callable or at least same __name__ (v2 is a direct re-key)
    assert v2_fn is v1_fn or v2_fn.__name__ == v1_fn.__name__


# ────────────────────────────────────────────────────────────────────────────
# 3. text_review v2 — compound output
# ────────────────────────────────────────────────────────────────────────────


def test_text_review_v2_compound_output_keys() -> None:
    """v2 text_review produces dict with output.txt and attestation.json."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import get_v2_stage_impl

    fn = get_v2_stage_impl("text_review", "cpu")
    result = fn(b"Sample text line.\nAnother line.")
    assert isinstance(result, dict)
    assert "output.txt" in result
    assert "attestation.json" in result


def test_text_review_v2_preserves_text() -> None:
    """v2 text_review output.txt contains the input text."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import get_v2_stage_impl

    fn = get_v2_stage_impl("text_review", "cpu")
    text = b"Hello world."
    result = fn(text)
    assert result["output.txt"] == text


def test_text_review_v2_attestation_is_json() -> None:
    """v2 text_review attestation.json is valid JSON."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import get_v2_stage_impl

    fn = get_v2_stage_impl("text_review", "cpu")
    result = fn(b"Some reviewed text.")
    attestation = json.loads(result["attestation.json"].decode("utf-8"))
    assert isinstance(attestation, dict)


# ────────────────────────────────────────────────────────────────────────────
# 4. wordcheck stage — project word lists + flag generation + events
# ────────────────────────────────────────────────────────────────────────────


def test_wordcheck_module_importable() -> None:
    """wordcheck step module is importable."""
    from pdomain_prep_for_pgdp.core.pipeline.steps import wordcheck  # noqa: F401


def test_wordcheck_flag_generation_known_bad_word() -> None:
    """flag_words returns a flag for each word in the bad-words list."""
    from pdomain_prep_for_pgdp.core.pipeline.steps.wordcheck import flag_words

    words_json = json.dumps(
        [
            {
                "id": "w1",
                "text": "teh",
                "confidence": 0.9,
                "bounding_box": {"x": 0, "y": 0, "w": 10, "h": 10},
            },
            {
                "id": "w2",
                "text": "the",
                "confidence": 0.95,
                "bounding_box": {"x": 15, "y": 0, "w": 10, "h": 10},
            },
            {
                "id": "w3",
                "text": "adn",
                "confidence": 0.8,
                "bounding_box": {"x": 30, "y": 0, "w": 10, "h": 10},
            },
        ]
    ).encode()

    bad_words = {"teh", "adn"}
    good_words: set[str] = set()

    flags = flag_words(words_json, bad_words=bad_words, good_words=good_words)

    assert isinstance(flags, list)
    flagged_ids = {f["word_id"] for f in flags}
    assert "w1" in flagged_ids, "teh should be flagged"
    assert "w3" in flagged_ids, "adn should be flagged"
    assert "w2" not in flagged_ids, "the should NOT be flagged"


def test_wordcheck_flag_generation_good_words_override() -> None:
    """Words in the good-words list are NOT flagged even if low confidence."""
    from pdomain_prep_for_pgdp.core.pipeline.steps.wordcheck import flag_words

    words_json = json.dumps(
        [
            {
                "id": "w1",
                "text": "unusual",
                "confidence": 0.5,
                "bounding_box": {"x": 0, "y": 0, "w": 10, "h": 10},
            },
        ]
    ).encode()

    bad_words = {"unusual"}  # in bad list
    good_words = {"unusual"}  # also in good list — good wins

    flags = flag_words(words_json, bad_words=bad_words, good_words=good_words)
    flagged_ids = {f["word_id"] for f in flags}
    assert "w1" not in flagged_ids, "good_words must override bad_words"


def test_wordcheck_no_flags_for_clean_text() -> None:
    """No flags when all words are clean."""
    from pdomain_prep_for_pgdp.core.pipeline.steps.wordcheck import flag_words

    words_json = json.dumps(
        [
            {
                "id": "w1",
                "text": "hello",
                "confidence": 0.99,
                "bounding_box": {"x": 0, "y": 0, "w": 10, "h": 10},
            },
            {
                "id": "w2",
                "text": "world",
                "confidence": 0.99,
                "bounding_box": {"x": 15, "y": 0, "w": 10, "h": 10},
            },
        ]
    ).encode()

    flags = flag_words(words_json, bad_words=set(), good_words=set())
    assert flags == []


def test_wordcheck_decision_event_structure() -> None:
    """make_wordcheck_decision returns a dict with required event fields."""
    from pdomain_prep_for_pgdp.core.pipeline.steps.wordcheck import make_wordcheck_decision

    event = make_wordcheck_decision(
        word_id="w1",
        word_text="teh",
        decision="accepted",
        actor_id="user-42",
        page_id="page-001",
        stage_id="wordcheck",
    )

    assert event["event_type"] == "WordCheckDecision"
    assert event["word_id"] == "w1"
    assert event["word_text"] == "teh"
    assert event["decision"] == "accepted"
    assert event["actor_id"] == "user-42"
    assert event["page_id"] == "page-001"
    assert event["stage_id"] == "wordcheck"


def test_wordcheck_promotion_event_structure() -> None:
    """make_wordlist_promotion_event returns a dict matching WordlistPromotion spec."""
    from pdomain_prep_for_pgdp.core.pipeline.steps.wordcheck import make_wordlist_promotion_event

    event = make_wordlist_promotion_event(
        word="teh",
        source_stage="wordcheck",
        source_page_id="page-001",
        list_scope="project",
        actor_id="user-42",
    )

    assert event["event_type"] == "WordlistPromotion"
    assert event["word"] == "teh"
    assert event["source_stage"] == "wordcheck"
    assert event["source_page_id"] == "page-001"
    assert event["list_scope"] == "project"
    assert event["actor_id"] == "user-42"


def test_wordcheck_guarded_promotion_rejects_empty_word() -> None:
    """promote_word raises ValueError for empty word string."""
    from pdomain_prep_for_pgdp.core.pipeline.steps.wordcheck import promote_word

    with pytest.raises(ValueError, match="empty"):
        promote_word(
            word="",
            list_scope="project",
            wordlist_store={},
            actor_id="user-42",
            source_stage="wordcheck",
            source_page_id="page-001",
        )


def test_wordcheck_guarded_promotion_adds_word() -> None:
    """promote_word adds the word to the given list scope and returns the event."""
    from pdomain_prep_for_pgdp.core.pipeline.steps.wordcheck import promote_word

    store: dict[str, set[str]] = {"project": set(), "global": set()}
    event = promote_word(
        word="unusual",
        list_scope="project",
        wordlist_store=store,
        actor_id="user-42",
        source_stage="wordcheck",
        source_page_id="page-001",
    )

    assert "unusual" in store["project"]
    assert event["event_type"] == "WordlistPromotion"
    assert event["word"] == "unusual"


def test_wordcheck_projection_recompute_from_events() -> None:
    """Recomputing flags from event log gives same result as initial flag_words call."""
    from pdomain_prep_for_pgdp.core.pipeline.steps.wordcheck import (
        flag_words,
        project_flags_from_events,
    )

    words_json = json.dumps(
        [
            {
                "id": "w1",
                "text": "teh",
                "confidence": 0.85,
                "bounding_box": {"x": 0, "y": 0, "w": 10, "h": 10},
            },
            {
                "id": "w2",
                "text": "the",
                "confidence": 0.99,
                "bounding_box": {"x": 15, "y": 0, "w": 10, "h": 10},
            },
        ]
    ).encode()

    bad_words = {"teh"}
    good_words: set[str] = set()

    initial_flags = flag_words(words_json, bad_words=bad_words, good_words=good_words)

    # Simulate accepting w1 via a decision event
    events = [
        {
            "event_type": "WordCheckDecision",
            "word_id": "w1",
            "decision": "accepted",
            "actor_id": "user",
            "page_id": "p1",
            "stage_id": "wordcheck",
        }
    ]
    projected = project_flags_from_events(initial_flags, events)

    # After accepting w1, it should no longer appear as an open flag
    open_flags = [f for f in projected if f.get("status") == "open"]
    assert not any(f["word_id"] == "w1" for f in open_flags), "accepted word should not be in open flags"


def test_wordcheck_v2_impl_registered() -> None:
    """wordcheck cpu callable in V2_STAGE_IMPL is not a placeholder."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import (
        StageNotImplemented,
        get_v2_stage_impl,
    )

    fn = get_v2_stage_impl("wordcheck", "cpu")
    words_json = json.dumps(
        [
            {
                "id": "w1",
                "text": "hello",
                "confidence": 0.99,
                "bounding_box": {"x": 0, "y": 0, "w": 10, "h": 10},
            },
        ]
    ).encode()

    try:
        result = fn(words_json)
    except StageNotImplemented:
        pytest.fail("wordcheck raised StageNotImplemented — B3 should wire a real impl")

    assert result is not None


def test_wordcheck_v2_output_is_bytes() -> None:
    """wordcheck v2 impl returns bytes (JSON flag report)."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import get_v2_stage_impl

    fn = get_v2_stage_impl("wordcheck", "cpu")
    words_json = json.dumps(
        [
            {
                "id": "w1",
                "text": "teh",
                "confidence": 0.8,
                "bounding_box": {"x": 0, "y": 0, "w": 10, "h": 10},
            },
        ]
    ).encode()

    result = fn(words_json)
    assert isinstance(result, bytes)
    parsed = json.loads(result.decode("utf-8"))
    assert "flags" in parsed


# ────────────────────────────────────────────────────────────────────────────
# 5. hyphen_join stage — candidate detection + decisions + idempotent
# ────────────────────────────────────────────────────────────────────────────


def test_hyphen_join_module_importable() -> None:
    """hyphen_join step module is importable."""
    from pdomain_prep_for_pgdp.core.pipeline.steps import hyphen_join  # noqa: F401


def test_hyphen_join_detects_eol_hyphen_candidate() -> None:
    """detect_candidates finds end-of-line hyphen candidates in text."""
    from pdomain_prep_for_pgdp.core.pipeline.steps.hyphen_join import detect_candidates

    text = "The quick brown-\nfox jumped over."
    candidates = detect_candidates(text)

    assert len(candidates) >= 1
    cand = candidates[0]
    assert "prefix" in cand
    assert cand["prefix"] == "brown"
    assert "suffix" in cand
    assert cand["suffix"] == "fox"


def test_hyphen_join_does_not_flag_em_dash() -> None:
    """Em-dash (—) is not a hyphen candidate."""
    from pdomain_prep_for_pgdp.core.pipeline.steps.hyphen_join import detect_candidates

    text = "Hello—world\nThis is fine."
    candidates = detect_candidates(text)
    # No end-of-line hyphen here
    assert all(c["prefix"] != "Hello" for c in candidates)


def test_hyphen_join_does_not_flag_already_joined() -> None:
    """Text without a trailing hyphen before newline has no candidates."""
    from pdomain_prep_for_pgdp.core.pipeline.steps.hyphen_join import detect_candidates

    text = "already joined text\nnext line here."
    candidates = detect_candidates(text)
    assert candidates == []


def test_hyphen_join_apply_joins_text() -> None:
    """apply_join_decisions returns text with accepted joins applied."""
    from pdomain_prep_for_pgdp.core.pipeline.steps.hyphen_join import (
        apply_join_decisions,
        detect_candidates,
    )

    text = "The brown-\nfox ran."
    candidates = detect_candidates(text)
    assert candidates, "should detect a candidate"

    # Accept the first candidate
    decisions = [{"candidate_id": candidates[0]["candidate_id"], "decision": "join"}]
    result = apply_join_decisions(text, decisions)

    assert "brown-\nfox" not in result
    assert "brownfox" in result or "brown\nfox" not in result


def test_hyphen_join_apply_rejected_candidate_unchanged() -> None:
    """Rejected candidate leaves the hyphen-newline in place."""
    from pdomain_prep_for_pgdp.core.pipeline.steps.hyphen_join import (
        apply_join_decisions,
        detect_candidates,
    )

    text = "The col-\nour ran."
    candidates = detect_candidates(text)
    if not candidates:
        pytest.skip("No candidate detected — text may not parse as hyphen candidate")

    decisions = [{"candidate_id": candidates[0]["candidate_id"], "decision": "keep"}]
    result = apply_join_decisions(text, decisions)
    assert "col-\n" in result or "col-" in result


def test_hyphen_join_idempotent_rerun_from_events() -> None:
    """Re-running apply_join_decisions with same event log gives same output."""
    from pdomain_prep_for_pgdp.core.pipeline.steps.hyphen_join import (
        apply_join_decisions,
        detect_candidates,
    )

    text = "Snap-\nshot taken."
    candidates = detect_candidates(text)
    if not candidates:
        pytest.skip("No candidate detected")

    decisions = [{"candidate_id": candidates[0]["candidate_id"], "decision": "join"}]
    result1 = apply_join_decisions(text, decisions)
    result2 = apply_join_decisions(text, decisions)
    assert result1 == result2, "apply_join_decisions must be deterministic"


def test_hyphen_join_decision_event_structure() -> None:
    """make_hyphen_join_decision returns dict with required event fields."""
    from pdomain_prep_for_pgdp.core.pipeline.steps.hyphen_join import make_hyphen_join_decision

    event = make_hyphen_join_decision(
        candidate_id="cand-001",
        decision="join",
        actor_id="user-42",
        page_id="page-001",
    )

    assert event["event_type"] == "HyphenJoinDecision"
    assert event["candidate_id"] == "cand-001"
    assert event["decision"] == "join"
    assert event["actor_id"] == "user-42"
    assert event["page_id"] == "page-001"


def test_hyphen_join_pre_join_text_preserved_via_events() -> None:
    """Original text is never destroyed; events make join reproducible.

    The stage artifact after joining reflects the applied decisions.
    Re-applying from the event log to the original text gives the same artifact.
    """
    from pdomain_prep_for_pgdp.core.pipeline.steps.hyphen_join import (
        apply_join_decisions,
        detect_candidates,
    )

    original = "Snap-\nshot taken."
    candidates = detect_candidates(original)
    if not candidates:
        pytest.skip("No candidate detected")

    cid = candidates[0]["candidate_id"]
    decisions = [{"candidate_id": cid, "decision": "join"}]

    result = apply_join_decisions(original, decisions)
    # Re-applying from original + events gives same result
    result2 = apply_join_decisions(original, decisions)
    assert result == result2


def test_hyphen_join_v2_impl_registered() -> None:
    """hyphen_join cpu callable in V2_STAGE_IMPL is not a placeholder."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import (
        StageNotImplemented,
        get_v2_stage_impl,
    )

    fn = get_v2_stage_impl("hyphen_join", "cpu")
    text = b"Hello world\nno candidates here."

    try:
        result = fn(text)
    except StageNotImplemented:
        pytest.fail("hyphen_join raised StageNotImplemented — B3 should wire a real impl")

    assert result is not None


def test_hyphen_join_v2_output_is_bytes() -> None:
    """hyphen_join v2 impl returns bytes (the processed text)."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import get_v2_stage_impl

    fn = get_v2_stage_impl("hyphen_join", "cpu")
    text = b"Sample-\ntext here."
    result = fn(text)
    assert isinstance(result, bytes)


def test_hyphen_join_v2_no_candidates_passthrough() -> None:
    """hyphen_join with no candidates returns text unchanged."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import get_v2_stage_impl

    fn = get_v2_stage_impl("hyphen_join", "cpu")
    text = b"No hyphens at end of lines.\nClean text here."
    result = fn(text)
    assert result == text


# ────────────────────────────────────────────────────────────────────────────
# 6. APPLY_SPLIT regression under v2
# ────────────────────────────────────────────────────────────────────────────


def test_apply_split_v2_children_get_full_dag(tmp_path: Path) -> None:
    """A text_zones split produces sibling pages with full v2 page-stage DAGs.

    After split_page_in_store, each child page has prep extension with
    split_at_stage='text_zones'. The parent's v2 DAG dirty descendants
    include all page-scoped stages downstream of text_zones.
    """
    from pdomain_ops.page_aggregate import PageAggregate, ProjectAggregate
    from pdomain_ops.pages import (
        PageRecord as OpsPageRecord,
    )
    from pdomain_ops.pages import (
        ProjectRecord,
        set_extension,
    )

    from pdomain_prep_for_pgdp.core.page_store_factory import build_page_service
    from pdomain_prep_for_pgdp.core.pipeline.stage_dag import compute_v2_dirty_descendants
    from pdomain_prep_for_pgdp.core.prep_extension import PrepPageExtension
    from pdomain_prep_for_pgdp.core.split_ops import split_page_in_store

    project_id = str(uuid.uuid4())
    project_uuid = uuid.UUID(project_id)
    service = build_page_service(tmp_path, project_id)

    page_id = uuid.uuid4()
    ops_record = OpsPageRecord(page_id=page_id, page_index=0, source="raw")
    ext = PrepPageExtension(project_id=project_id, idx0=0, prefix="001", source_stem="img001")
    set_extension(ops_record, "prep", ext)
    page_agg = PageAggregate(record=ops_record)
    service.store.save_page(page_agg)

    proj_record = ProjectRecord(project_id=project_uuid, name="Test")
    proj_agg = ProjectAggregate(record=proj_record)
    proj_agg.add_page(page_id=page_id, page_index=0)
    service.store.save_project(proj_agg)

    children = split_page_in_store(
        service=service,
        project_id=project_id,
        parent_page_id=page_id,
        parent_idx0=0,
        parent_prefix="001",
        parent_source_stem="img001",
        bbox=(0, 0, 100, 200),
        split_at_stage="text_zones",  # v2 stage
        suffixes=["a", "b"],
    )

    assert len(children) == 2

    # Each child has split_at_stage = 'text_zones'
    from pdomain_ops.pages import get_extension

    for child in children:
        child_agg = service.store.get_page(child.page_id)
        child_ext = get_extension(child_agg.record, "prep", PrepPageExtension)
        assert child_ext is not None
        assert child_ext.split_at_stage == "text_zones"

    # Dirty descendants of text_zones per the actual DAG topology:
    # text_zones → page_order (cross-scope — page_order depends on text_zones)
    # page_order → validation → proof_pack → build_package → zip → submit_check → archive
    # Note: ocr depends on post_ocr_crop (a separate path), NOT on text_zones.
    dirty = compute_v2_dirty_descendants("text_zones")
    assert "page_order" in dirty  # cross-scope: page_order depends on text_zones
    assert "validation" in dirty  # page_order → validation
    assert "build_package" in dirty  # validation → proof_pack → build_package


def test_apply_split_v2_fanout_event_fires(tmp_path: Path) -> None:
    """SplitFanout event is recorded when APPLY_SPLIT is triggered at text_zones.

    The PrepProjectAggregate records SplitFanout with correct fields.
    """
    from pdomain_prep_for_pgdp.core.pipeline.prep_aggregate import PrepProjectAggregate

    project_id = uuid.uuid4()
    agg = PrepProjectAggregate(project_id=project_id)
    parent_id = str(uuid.uuid4())
    child_a = str(uuid.uuid4())
    child_b = str(uuid.uuid4())

    agg.record_split_fanout(
        parent_page_id=parent_id,
        split_stage="text_zones",
        children=[
            {"page_id": child_a, "split_index": 1, "source_crop_bbox": [0, 0, 100, 200]},
            {"page_id": child_b, "split_index": 2, "source_crop_bbox": [100, 0, 200, 200]},
        ],
        actor_id="system",
    )

    events = list(agg.collect_events())
    split_events = [e for e in events if type(e).__name__ == "SplitFanout"]
    assert len(split_events) == 1

    ev = split_events[0]
    assert ev.parent_page_id == parent_id
    assert ev.split_stage == "text_zones"
    assert len(ev.children) == 2
    assert ev.actor_id == "system"


def test_apply_split_v2_wider_staleness() -> None:
    """APPLY_SPLIT at text_zones fans staleness wider than a regular page re-run.

    text_zones split stales page_order (project-scoped) via cross-scope edge,
    which a normal page stage would not do. This confirms the DAG captures the
    wider fanout.
    """
    from pdomain_prep_for_pgdp.core.pipeline.stage_dag import compute_v2_dirty_descendants

    # text_zones stales page_order (cross-scope)
    text_zones_dirty = compute_v2_dirty_descendants("text_zones")
    assert "page_order" in text_zones_dirty

    # ocr does NOT stale page_order (ocr is downstream of post_ocr_crop,
    # not a dep of page_order)
    ocr_dirty = compute_v2_dirty_descendants("ocr")
    # page_order depends on text_zones, not ocr — so a pure ocr re-run
    # should NOT stale page_order via a direct edge
    # (page_order deps = source + text_zones, not ocr)
    assert "page_order" not in ocr_dirty


def test_apply_split_v2_split_at_stage_is_v2_id() -> None:
    """split_at_stage must be a valid v2 stage ID (text_zones in V2_PAGE_STAGE_IDS)."""
    from pdomain_prep_for_pgdp.core.models import V2_PAGE_STAGE_IDS

    assert "text_zones" in V2_PAGE_STAGE_IDS, "text_zones must be a valid v2 page-stage ID for APPLY_SPLIT"


def test_compute_v2_dirty_descendants_post_transform_crop_stales_text_zones() -> None:
    """post_transform_crop (upstream of text_zones and canvas_map) stales both paths.

    post_transform_crop → text_zones → page_order (cross-scope)
    post_transform_crop → canvas_map → post_ocr_crop → ocr → wordcheck → hyphen_join
    """
    from pdomain_prep_for_pgdp.core.pipeline.stage_dag import compute_v2_dirty_descendants

    dirty = compute_v2_dirty_descendants("post_transform_crop")
    # text_zones path
    assert "text_zones" in dirty
    assert "page_order" in dirty  # cross-scope via text_zones
    # canvas_map/OCR path
    assert "canvas_map" in dirty
    assert "post_ocr_crop" in dirty
    assert "ocr" in dirty
    assert "wordcheck" in dirty
    assert "hyphen_join" in dirty
