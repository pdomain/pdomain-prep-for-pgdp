"""Unit tests for _safe_static_file and HTTP-level traversal regression tests.

All tests here run WITHOUT a real built SPA bundle — a minimal fake static
root (index.html only) is created via tmp_path and monkeypatched into the
bootstrap's importlib.resources call so the FastAPI app mounts it correctly.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

import pd_prep_for_pgdp.bootstrap as bootstrap_mod
from pd_prep_for_pgdp.bootstrap import _safe_static_file, build_app
from pd_prep_for_pgdp.settings import Settings

if TYPE_CHECKING:
    from pathlib import Path

# ---------------------------------------------------------------------------
# Fixture: fake static dir with a minimal index.html
# ---------------------------------------------------------------------------


@pytest.fixture
def fake_static(tmp_path: Path) -> Path:
    """Return a tmp_path directory wired to look like a built SPA bundle."""
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("<div id='root'></div>")
    assets = static / "assets"
    assets.mkdir()
    (assets / "app.js").write_text("console.log('ok')")
    return static


@pytest.fixture
def test_app(fake_static: Path, monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """Build a FastAPI app that mounts the fake static dir."""

    # Monkeypatch resources.files so _mount_static_frontend resolves to fake_static.
    fake_traversable = MagicMock()
    fake_traversable.joinpath.return_value = MagicMock(__str__=lambda self: str(fake_static))
    monkeypatch.setattr(bootstrap_mod.resources, "files", lambda _pkg: fake_traversable)

    settings = Settings(
        host="127.0.0.1",
        port=8765,
        data_root=tmp_path / "data",
        config_dir=tmp_path / "config",
        storage_backend="filesystem",
        database_url=f"sqlite:///{(tmp_path / 's.db').as_posix()}",
        gpu_backend="cpu",
        dispatch_interval_seconds=0,
        auth_mode="none",
    )
    return build_app(settings)


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


# ---------------------------------------------------------------------------
# HTTP-level regression tests — traversal attacks via the FastAPI route
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "attack_path",
    [
        # URL-decoded absolute path (FastAPI decodes %2Fetc%2Fpasswd before handler)
        "%2Fetc%2Fpasswd",
        # Dotdot traversal
        "../etc/passwd",
        "../../etc/passwd",
    ],
)
def test_http_traversal_returns_index_not_host_file(test_app, attack_path: str) -> None:
    """Attack paths must return the SPA index.html (200 HTML), never host file content."""
    with TestClient(test_app, raise_server_exceptions=False) as client:
        r = client.get(f"/{attack_path}", follow_redirects=False)
        # The fallback must serve index.html (200 HTML), not the host file.
        assert r.status_code == 200
        assert "text/html" in r.headers.get("content-type", "")
        # Must not contain /etc/passwd content.
        assert "root:" not in r.text
        assert "<div id='root'>" in r.text


def test_http_valid_asset_still_served(test_app) -> None:
    """A real bundled asset (assets/app.js) must still be served correctly."""
    with TestClient(test_app) as client:
        r = client.get("/assets/app.js")
        assert r.status_code == 200
        assert "text/html" not in r.headers.get("content-type", "")


def test_http_spa_router_path_serves_index(test_app) -> None:
    """A React Router path (/projects/123) must serve index.html."""
    with TestClient(test_app) as client:
        r = client.get("/projects/abc-123")
        assert r.status_code == 200
        assert "text/html" in r.headers.get("content-type", "")
        assert "<div id='root'>" in r.text
