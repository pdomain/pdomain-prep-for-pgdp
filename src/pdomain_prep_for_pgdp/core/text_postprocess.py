"""Text post-processing -- Step 8 of the pipeline (spec 02).

Two layers:
  - Book-agnostic: curly quotes -> straight, em dash -> double hyphen,
    optional system-wide scanno table, hyphenation join list.
  - Book-specific: `ProjectConfig.custom_regex_passes` + `custom_scannos`
    layered on top.

The order of operations matches what the notebook + pdomain-ocr-cli do today.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Iterable

    from .models import ProjectConfig, SystemDefaults

# --- Quote / dash normalisation (lifted from pdomain-ocr-cli/_text_normalize.py) --

_CURLY_TO_STRAIGHT = str.maketrans(
    {
        "\u2018": "'",  # LEFT SINGLE QUOTATION MARK -> straight apostrophe
        "\u2019": "'",  # RIGHT SINGLE QUOTATION MARK -> straight apostrophe
        "\u201a": "'",  # SINGLE LOW-9 QUOTATION MARK -> straight apostrophe
        "\u201b": "'",  # SINGLE HIGH-REVERSED-9 QUOTATION MARK -> straight apostrophe
        "\u201c": '"',  # LEFT DOUBLE QUOTATION MARK -> straight quote
        "\u201d": '"',  # RIGHT DOUBLE QUOTATION MARK -> straight quote
        "\u201e": '"',  # DOUBLE LOW-9 QUOTATION MARK -> straight quote
        "\u201f": '"',  # DOUBLE HIGH-REVERSED-9 QUOTATION MARK -> straight quote
    }
)


def normalize_curly_quotes(text: str) -> str:
    return text.translate(_CURLY_TO_STRAIGHT)


def normalize_em_dash(text: str) -> str:
    return text.replace("—", "--")  # EM DASH (U+2014) -> double hyphen


# ─── Scannos ────────────────────────────────────────────────


_TOKEN_RE = re.compile(r"\b\w+(?:[-\']\w+)*\b", re.UNICODE)


def apply_scannos(text: str, scannos: dict[str, str]) -> str:
    """Word-by-word case-sensitive replacement.

    PGDP scanno tables are case-sensitive — `arid` vs `arid.` are tokenised
    apart so punctuation is preserved.
    """
    if not scannos:
        return text

    def _sub(m: re.Match[str]) -> str:
        word = m.group(0)
        return scannos.get(word, word)

    return _TOKEN_RE.sub(_sub, text)


# ─── Hyphenation join ────────────────────────────────────────────────

# Match a line ending in "<word>-\n<continuation>" — common case from scanned books.
_HYPHEN_LINE_END = re.compile(r"(\w+)-\n(\w+)", re.UNICODE)


def join_hyphenated_lines(text: str, allowed_endings: Iterable[str]) -> str:
    """Stitch lines split by end-of-line hyphens.

    `allowed_endings` is the system's hyphenation-join list (the legacy
    `hyphenated-line-join.json` content). A match is rejoined only when the
    `prefix-` part is in the allowed list, so genuine hyphenated compounds
    are preserved.
    """
    allowed = {e.rstrip("-").lower() for e in allowed_endings}
    if not allowed:
        return text

    def _maybe_join(m: re.Match[str]) -> str:
        prefix, rest = m.group(1), m.group(2)
        if prefix.lower() in allowed:
            return f"{prefix}{rest}"
        return m.group(0)

    return _HYPHEN_LINE_END.sub(_maybe_join, text)


# ─── Custom regex passes ───────────────────────────────────────────


def apply_custom_regex_passes(text: str, passes: Iterable[tuple[str, str]]) -> str:
    """Apply book-specific (pattern, replacement) regex pairs in order."""
    out = text
    for pattern, repl in passes:
        out = re.sub(pattern, repl, out)
    return out


# ─── Top-level orchestrator ─────────────────────────────────────────


def postprocess_text(
    text: str,
    *,
    system: SystemDefaults,
    project: ProjectConfig,
    straight_quotes: bool = True,
    em_dash_to_double_hyphen: bool = True,
) -> str:
    """Run the full Step-8 pipeline.

    Order: quotes -> em dash -> hyphenation join -> system scannos ->
    project scannos -> custom regex passes. (Quotes/dash first so scanno
    keys don't have to think about curly variants.)
    """
    out = text
    if straight_quotes:
        out = normalize_curly_quotes(out)
    if em_dash_to_double_hyphen:
        out = normalize_em_dash(out)
    out = join_hyphenated_lines(out, system.hyphenation_join_list)
    out = apply_scannos(out, system.standard_scannos)
    out = apply_scannos(out, project.custom_scannos)
    return apply_custom_regex_passes(out, project.custom_regex_passes)
