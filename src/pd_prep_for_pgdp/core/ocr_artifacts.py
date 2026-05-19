"""OCR artifact helpers: key derivation and word-list deserialization."""

from __future__ import annotations

import json

from pd_prep_for_pgdp.core.models import OcrWord


def words_key_for(text_key: str) -> str:
    """Sibling words-blob key for an OCR text key.

    ``<root>.txt`` → ``<root>.words.json``. If the text key doesn't end in
    ``.txt`` (shouldn't happen, but be defensive), we still append the
    suffix so the words blob is co-located with the text.
    """
    if text_key.endswith(".txt"):
        return text_key[:-4] + ".words.json"
    return text_key + ".words.json"


def load_words_from_storage(raw: bytes) -> list[OcrWord]:
    """Decode the on-disk words blob into a list of ``OcrWord``."""
    items = json.loads(raw.decode("utf-8"))
    return [OcrWord.model_validate(item) for item in items]
