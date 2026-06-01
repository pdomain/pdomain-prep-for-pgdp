"""Slice 1 — Settings resource-bound fields + CDN upload size limit.

Tests are written before the implementation so failures prove the gap.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from pdomain_prep_for_pgdp.settings import Settings

if TYPE_CHECKING:
    from pathlib import Path

# ─── Settings defaults ─────────────────────────────────────────────────────


def test_settings_has_max_cdn_upload_bytes() -> None:
    s = Settings()
    assert s.max_cdn_upload_bytes == 300 * 1024 * 1024


def test_settings_has_max_source_zip_bytes() -> None:
    s = Settings()
    assert s.max_source_zip_bytes == 2 * 1024 * 1024 * 1024


def test_settings_has_max_zip_entries() -> None:
    s = Settings()
    assert s.max_zip_entries == 2000


def test_settings_has_max_entry_uncompressed_bytes() -> None:
    s = Settings()
    assert s.max_entry_uncompressed_bytes == 100 * 1024 * 1024


def test_settings_has_max_total_uncompressed_bytes() -> None:
    s = Settings()
    assert s.max_total_uncompressed_bytes == 5 * 1024 * 1024 * 1024


def test_settings_has_max_image_pixels() -> None:
    s = Settings()
    assert s.max_image_pixels == 200_000_000


def test_settings_limits_overridable_via_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PGDP_MAX_CDN_UPLOAD_BYTES", "1024")
    monkeypatch.setenv("PGDP_MAX_ZIP_ENTRIES", "10")
    s = Settings()
    assert s.max_cdn_upload_bytes == 1024
    assert s.max_zip_entries == 10


# ─── CDN upload size limit — _check_upload_size unit tests ─────────────────


class _FakeRequest:
    """Minimal Request stand-in for testing _check_upload_size directly."""

    def __init__(
        self,
        content_length: int | None = None,
    ) -> None:
        self.headers: dict[str, str] = {}
        if content_length is not None:
            self.headers["content-length"] = str(content_length)


def test_check_upload_size_raises_413_on_oversized_content_length() -> None:
    """Content-length header larger than limit → HTTPException 413."""
    from pdomain_prep_for_pgdp.api.cdn import _check_upload_size

    req: Any = _FakeRequest(content_length=101)
    with pytest.raises(HTTPException) as exc:
        _check_upload_size(req, max_bytes=100)
    assert exc.value.status_code == 413


def test_check_upload_size_passes_when_within_limit() -> None:
    """Content-length at limit → no exception."""
    from pdomain_prep_for_pgdp.api.cdn import _check_upload_size

    req: Any = _FakeRequest(content_length=100)
    _check_upload_size(req, max_bytes=100)  # no exception


def test_check_upload_size_passes_when_no_content_length(tmp_path: Path) -> None:
    """No content-length header → no exception (body check deferred to post-read)."""
    from pdomain_prep_for_pgdp.api.cdn import _check_upload_size

    req: Any = _FakeRequest()
    _check_upload_size(req, max_bytes=100)  # no exception


# ─── CDN upload size limit — integration via TestClient ────────────────────


@pytest.fixture
def tight_client(tmp_path: Path) -> TestClient:
    """TestClient with max_cdn_upload_bytes=100 for limit integration tests."""
    from pdomain_prep_for_pgdp.bootstrap import build_app

    s = Settings(
        data_root=tmp_path / "data",
        config_dir=tmp_path / "config",
        storage_backend="filesystem",
        database_url=f"sqlite:///{(tmp_path / 'state.db').as_posix()}",
        auth_mode="none",
        gpu_backend="cpu",
        max_cdn_upload_bytes=100,
    )
    app = build_app(s)
    with TestClient(app) as c:
        return c


def test_cdn_put_rejects_oversized_content_length(tight_client: TestClient) -> None:
    """Content-length header larger than limit → 413."""
    r = tight_client.put(
        "/cdn/projects/abc/test.png",
        content=b"x",
        headers={"content-length": "101"},
    )
    assert r.status_code == 413


def test_cdn_put_rejects_oversized_body(tight_client: TestClient) -> None:
    """Body larger than limit (no content-length) → 413."""
    r = tight_client.put(
        "/cdn/projects/abc/test.png",
        content=b"x" * 101,
    )
    assert r.status_code == 413


def test_cdn_put_accepts_body_within_limit(tight_client: TestClient) -> None:
    """Body within limit → 204."""
    r = tight_client.put(
        "/cdn/projects/abc/ok.png",
        content=b"x" * 50,
    )
    assert r.status_code == 204
