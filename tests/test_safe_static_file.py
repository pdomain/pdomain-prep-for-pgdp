"""Unit tests for _safe_static_file — path-traversal containment helper.

These tests run WITHOUT a built SPA bundle (pure Python, no FastAPI server).
They prove the helper rejects absolute paths and traversal segments before
any file is served.
"""

from __future__ import annotations

import pytest

from pd_prep_for_pgdp.bootstrap import _safe_static_file

# ---------------------------------------------------------------------------
# Rejection cases — must return None
# ---------------------------------------------------------------------------


def test_rejects_absolute_path(tmp_path) -> None:
    """URL-decoded absolute path like %2Fetc%2Fpasswd → /etc/passwd must be None."""
    result = _safe_static_file(str(tmp_path), "/etc/passwd")
    assert result is None


def test_rejects_dotdot_traversal(tmp_path) -> None:
    """Classic traversal ../../etc/passwd must be None."""
    result = _safe_static_file(str(tmp_path), "../../etc/passwd")
    assert result is None


def test_rejects_encoded_absolute_path(tmp_path) -> None:
    """FastAPI decodes %2F before the handler sees full_path.

    If the caller passes the pre-decoded value '/etc/passwd', _safe_static_file
    must still reject it — this covers the documented attack vector.
    """
    # FastAPI already decodes %2Fetc%2Fpasswd to /etc/passwd before the handler
    # sees full_path; this test exercises the same decoded string.
    result = _safe_static_file(str(tmp_path), "/etc/passwd")
    assert result is None


def test_rejects_blank_path(tmp_path) -> None:
    """Empty string must return None (no file to serve)."""
    # Even if tmp_path exists as a directory, an empty full_path is not a file.
    result = _safe_static_file(str(tmp_path), "")
    assert result is None


def test_rejects_path_that_equals_root(tmp_path) -> None:
    """A path resolving to exactly static_root (a directory) must return None.

    Defensive test for the off-by-one check:
    `root_resolved not in resolved.parents and resolved != root_resolved`.
    The root itself is a directory, so is_file() would return False anyway,
    but the equality arm keeps the guard correct even in adversarial edge cases.
    """
    # Passing "." resolves to tmp_path itself (the root dir).
    result = _safe_static_file(str(tmp_path), ".")
    assert result is None


def test_rejects_path_escaping_via_symlink_parent(tmp_path) -> None:
    """A traversal that tries to escape via a sibling directory must be None."""
    # We do NOT create any file — the path escapes containment regardless.
    result = _safe_static_file(str(tmp_path), "../sibling_secret.txt")
    assert result is None


# ---------------------------------------------------------------------------
# Acceptance cases — must return the resolved absolute path string
# ---------------------------------------------------------------------------


def test_accepts_valid_relative_file(tmp_path) -> None:
    """A real file inside the static root must be returned as its resolved path."""
    assets = tmp_path / "assets"
    assets.mkdir()
    js = assets / "app.js"
    js.write_text("console.log('ok')")

    result = _safe_static_file(str(tmp_path), "assets/app.js")
    assert result is not None
    assert result == str(js.resolve())


def test_accepts_file_in_root(tmp_path) -> None:
    """A file directly inside the static root (not in a subdir) must be accepted."""
    favicon = tmp_path / "favicon.ico"
    favicon.write_bytes(b"\x00" * 4)

    result = _safe_static_file(str(tmp_path), "favicon.ico")
    assert result is not None
    assert result == str(favicon.resolve())


def test_returns_none_for_nonexistent_file(tmp_path) -> None:
    """A well-formed relative path that points to a nonexistent file → None."""
    result = _safe_static_file(str(tmp_path), "assets/missing.js")
    assert result is None


@pytest.mark.parametrize(
    "full_path",
    [
        "/etc/passwd",
        "../../etc/passwd",
        "../etc/passwd",
        "/root/.bashrc",
    ],
)
def test_parametrized_traversal_attacks(tmp_path, full_path: str) -> None:
    """Parametrized sweep of common path-traversal attack strings."""
    result = _safe_static_file(str(tmp_path), full_path)
    assert result is None, f"Expected None for {full_path!r}, got {result!r}"
