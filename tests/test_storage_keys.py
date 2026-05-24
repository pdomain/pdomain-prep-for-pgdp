"""Unit tests for the shared storage_keys helper.

Written test-first (Slice 2 of #128) before storage_keys.py exists.
"""

from __future__ import annotations

import pytest

from pd_prep_for_pgdp.api.data.storage_keys import assert_project_scoped_key


def test_valid_key_passes() -> None:
    # Normal well-formed key — must not raise.
    assert_project_scoped_key("proj123", "projects/proj123/for_zip/my-book.zip")


def test_valid_key_with_subdir_passes() -> None:
    # Keys deeper than one level under the project prefix are fine.
    assert_project_scoped_key("proj123", "projects/proj123/hi_res/p001_00.png")


def test_leading_slash_stripped_before_check() -> None:
    # CDN-relative keys may have a leading slash; must still pass.
    assert_project_scoped_key("proj123", "/projects/proj123/for_zip/book.zip")


def test_wrong_project_raises() -> None:
    with pytest.raises(ValueError, match="projects/proj123/"):
        assert_project_scoped_key("proj123", "projects/other_proj/for_zip/book.zip")


def test_traversal_outside_project_prefix_raises() -> None:
    # A key that escapes the project prefix entirely is rejected.
    # Note: "projects/proj123/for_zip/../../evil.zip" still starts with
    # "projects/proj123/" (literal prefix check), so the helper does NOT catch
    # that case — _safe_package_slug is responsible for preventing such keys
    # from being composed in the first place.
    # This test validates keys that escape the project namespace altogether.
    with pytest.raises(ValueError, match="projects/proj123/"):
        assert_project_scoped_key("proj123", "projects/evil.zip")


def test_empty_key_raises() -> None:
    with pytest.raises(ValueError, match="projects/proj123/"):
        assert_project_scoped_key("proj123", "")


def test_error_message_contains_key() -> None:
    bad_key = "projects/other/for_zip/book.zip"
    with pytest.raises(ValueError, match=repr(bad_key)):
        assert_project_scoped_key("proj123", bad_key)
