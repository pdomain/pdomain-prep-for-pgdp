"""Unit tests for the git-main [tool.uv.sources] rewriter."""

from __future__ import annotations

import pytest

from scripts.git_master_sources import flip_sources

_SRC = """\
[tool.uv.sources]
pdomain-book-tools = { index = "pdomain-index-pip" }
pdomain-ops = { index = "pdomain-index-pip" }
some-other = { index = "elsewhere" }
"""


def test_flip_single_sibling_to_git_main() -> None:
    out = flip_sources(_SRC, "pdomain", ["pdomain-book-tools"])
    assert (
        'pdomain-book-tools = { git = "https://github.com/pdomain/'
        'pdomain-book-tools.git", branch = "master" }' in out
    )
    assert "pdomain-book-tools = { index" not in out


def test_flip_leaves_other_entries_untouched() -> None:
    out = flip_sources(_SRC, "pdomain", ["pdomain-book-tools"])
    assert 'pdomain-ops = { index = "pdomain-index-pip" }' in out
    assert 'some-other = { index = "elsewhere" }' in out


def test_flip_multiple_siblings() -> None:
    out = flip_sources(_SRC, "pdomain", ["pdomain-book-tools", "pdomain-ops"])
    assert (
        'pdomain-book-tools = { git = "https://github.com/pdomain/'
        'pdomain-book-tools.git", branch = "master" }' in out
    )
    assert 'pdomain-ops = { git = "https://github.com/pdomain/pdomain-ops.git", branch = "master" }' in out


def test_missing_sibling_entry_raises() -> None:
    with pytest.raises(ValueError, match=r"no \[tool.uv.sources\] entry"):
        flip_sources(_SRC, "pdomain", ["pdomain-not-present"])


def test_result_is_valid_toml() -> None:
    import tomllib

    out = flip_sources(_SRC, "pdomain", ["pdomain-book-tools", "pdomain-ops"])
    parsed = tomllib.loads(out)
    src = parsed["tool"]["uv"]["sources"]["pdomain-book-tools"]
    assert src == {"git": "https://github.com/pdomain/pdomain-book-tools.git", "branch": "master"}
