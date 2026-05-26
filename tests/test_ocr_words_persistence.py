"""Lock in the words-blob helper utilities (moved from deleted cpu.py to base.py).

Locks in:
  - `words_key_for` derives the sibling `.words.json` key correctly for
    whole-page and split-page cases,
  - `load_words_from_storage` round-trips a list of OcrWords through JSON.

Note: integration tests that exercised `CpuBackend.run_ocr` directly have
been removed in M6 — CpuBackend was deleted (superseded by per-stage registry).
"""

from __future__ import annotations

import json

from pdomain_prep_for_pgdp.core.models import (
    BoundingBox,
    OcrWord,
)
from pdomain_prep_for_pgdp.core.ocr_artifacts import load_words_from_storage, words_key_for


def test_words_key_for_replaces_txt_suffix() -> None:
    assert words_key_for("projects/p1/ocr_text/src1_p001.txt") == "projects/p1/ocr_text/src1_p001.words.json"


def test_words_key_for_handles_missing_txt_suffix_defensively() -> None:
    # Defensive: should never happen in practice, but don't crash.
    assert words_key_for("projects/p1/ocr_text/weird") == "projects/p1/ocr_text/weird.words.json"


def test_words_key_for_split_page() -> None:
    assert (
        words_key_for("projects/p1/ocr_text/src1_p001L.txt") == "projects/p1/ocr_text/src1_p001L.words.json"
    )


def test_load_words_from_storage_round_trips() -> None:
    words = [
        OcrWord(
            id="w1",
            text="hello",
            confidence=0.99,
            bounding_box=BoundingBox(left=10, top=20, width=30, height=40),
        ),
        OcrWord(
            id="w2",
            text="world",
            confidence=0.5,
            bounding_box=BoundingBox(left=50, top=60, width=70, height=80),
            split_suffix="L",
        ),
    ]
    blob = json.dumps([w.model_dump(mode="json") for w in words]).encode("utf-8")
    decoded = load_words_from_storage(blob)
    assert decoded == words


def test_load_words_from_storage_handles_empty_list() -> None:
    blob = json.dumps([]).encode("utf-8")
    assert load_words_from_storage(blob) == []
