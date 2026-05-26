"""Step 8 text post-processing — quote/dash normalisation, scannos, custom regex."""

from __future__ import annotations

from pdomain_prep_for_pgdp.core.models import ProjectConfig, SystemDefaults
from pdomain_prep_for_pgdp.core.text_postprocess import (
    apply_custom_regex_passes,
    apply_scannos,
    join_hyphenated_lines,
    normalize_curly_quotes,
    normalize_em_dash,
    postprocess_text,
)


def test_normalize_curly_quotes_round_trips_to_ascii() -> None:
    src = "He said “hello” to John\u2019s house."  # RIGHT SINGLE QUOTATION MARK (U+2019)
    assert normalize_curly_quotes(src) == 'He said "hello" to John\'s house.'


def test_normalize_em_dash() -> None:
    assert normalize_em_dash("Two—three") == "Two--three"


def test_apply_scannos_is_word_boundaried_and_case_sensitive() -> None:
    text = "The cnly arid land. Only one only."
    out = apply_scannos(text, {"cnly": "only"})
    assert out == "The only arid land. Only one only."


def test_join_hyphenated_lines_only_joins_known_endings() -> None:
    src = "good-\nbye\nblue-\nprint\nun-\nknown"
    # "good" is in the list -> rejoin. "blue" is too. "un" is not.
    out = join_hyphenated_lines(src, ["good", "blue"])
    assert "goodbye" in out
    assert "blueprint" in out
    assert "un-\nknown" in out


def test_apply_custom_regex_passes_runs_in_order() -> None:
    out = apply_custom_regex_passes("abc 123", [(r"\d+", "###"), (r"a(b)c", r"x\1y")])
    assert out == "xby ###"


def test_postprocess_text_orchestrator() -> None:
    sd = SystemDefaults(
        standard_scannos={"foo": "FOO"},
        hyphenation_join_list=["good"],
    )
    pc = ProjectConfig(
        book_name="X",
        source_uri="",
        custom_scannos={"bar": "BAR"},
        custom_regex_passes=[(r"\s+!", "!")],
    )
    src = "He “said” foo and bar good-\nbye — yes !"
    out = postprocess_text(src, system=sd, project=pc)
    assert "“" not in out
    assert "”" not in out
    assert "—" not in out
    assert "--" in out
    assert "FOO" in out
    assert "BAR" in out
    assert "goodbye" in out
    assert "yes!" in out  # regex pass collapsed " !" to "!"
