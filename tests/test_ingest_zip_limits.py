"""Slice 2 — zip-bomb guards in _enumerate_zip.

Tests are written before the implementation so failures prove the gap.

The guards live on a thin helper `_check_zip_limits(raw, limits)` that
raises ValueError before any entry payload is decompressed. Tests construct
minimal zip archives in-memory to exercise each limit independently.
"""

from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass

import pytest


@dataclass
class _ZipLimits:
    """Mirrors the shape of Settings fields consumed by the guard."""

    max_source_zip_bytes: int = 2 * 1024 * 1024 * 1024
    max_zip_entries: int = 2000
    max_entry_uncompressed_bytes: int = 100 * 1024 * 1024
    max_total_uncompressed_bytes: int = 5 * 1024 * 1024 * 1024


def _make_zip(entries: list[tuple[str, bytes, int | None]] | None = None) -> bytes:
    """Build an in-memory zip.

    Each entry is (filename, data, override_file_size).  When
    ``override_file_size`` is not None the ZipInfo.file_size is patched
    so the central-directory header claims a different uncompressed size
    than the actual data — useful for testing the bomb-detection path
    without actually allocating gigabytes.
    """
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_STORED) as zf:
        for name, data, fake_size in entries or []:
            info = zipfile.ZipInfo(name)
            zf.writestr(info, data)
            if fake_size is not None:
                # Patch the file_size in the in-memory central directory.
                # zipfile stores ZipInfo in _RealGetContents; we can't easily
                # patch the raw bytes, so we post-modify the ZipInfo list.
                for stored_info in zf.infolist():
                    if stored_info.filename == name:
                        stored_info.file_size = fake_size
    return buf.getvalue()


# ─── source-zip byte limit ─────────────────────────────────────────────────


def test_source_zip_too_large_raises() -> None:
    """raw bytes > max_source_zip_bytes raises ValueError."""
    from pdomain_prep_for_pgdp.core.ingest import _check_zip_limits

    big = b"x" * 1001
    limits = _ZipLimits(max_source_zip_bytes=1000)
    with pytest.raises(ValueError, match="source zip exceeds limit"):
        _check_zip_limits(big, limits)


def test_source_zip_within_size_limit_ok() -> None:
    """raw bytes == max is not rejected."""
    from pdomain_prep_for_pgdp.core.ingest import _check_zip_limits

    raw = _make_zip([("page0001.png", b"data", None)])
    limits = _ZipLimits(max_source_zip_bytes=len(raw))
    _check_zip_limits(raw, limits)  # no exception


# ─── entry count limit ────────────────────────────────────────────────────


def test_zip_too_many_entries_raises() -> None:
    """len(infolist()) > max_zip_entries raises ValueError."""
    from pdomain_prep_for_pgdp.core.ingest import _check_zip_limits

    entries = [(f"page{i:04d}.png", b"x", None) for i in range(11)]
    raw = _make_zip(entries)
    limits = _ZipLimits(max_zip_entries=10)
    with pytest.raises(ValueError, match="too many entries"):
        _check_zip_limits(raw, limits)


def test_zip_entry_count_at_limit_ok() -> None:
    """Exactly max_zip_entries entries is allowed."""
    from pdomain_prep_for_pgdp.core.ingest import _check_zip_limits

    entries = [(f"page{i:04d}.png", b"x", None) for i in range(10)]
    raw = _make_zip(entries)
    limits = _ZipLimits(max_zip_entries=10)
    _check_zip_limits(raw, limits)  # no exception


# ─── single entry size limit ──────────────────────────────────────────────


def test_zip_single_entry_too_large_raises() -> None:
    """An entry claiming file_size > max_entry_uncompressed_bytes raises."""
    from pdomain_prep_for_pgdp.core.ingest import _check_zip_limits

    limit = 100 * 1024 * 1024  # 100 MB
    entries = [("page0001.png", b"fake", limit + 1)]
    raw = _make_zip(entries)
    limits = _ZipLimits(max_entry_uncompressed_bytes=limit)
    with pytest.raises(ValueError, match="too large"):
        _check_zip_limits(raw, limits)


def test_zip_single_entry_at_limit_ok() -> None:
    """Entry exactly at max_entry_uncompressed_bytes is allowed."""
    from pdomain_prep_for_pgdp.core.ingest import _check_zip_limits

    limit = 100
    entries = [("page0001.png", b"x" * limit, None)]
    raw = _make_zip(entries)
    limits = _ZipLimits(max_entry_uncompressed_bytes=limit)
    _check_zip_limits(raw, limits)  # no exception


# ─── total uncompressed size limit ────────────────────────────────────────


def test_zip_total_uncompressed_too_large_raises() -> None:
    """Sum of file_size across entries exceeding limit raises ValueError."""
    from pdomain_prep_for_pgdp.core.ingest import _check_zip_limits

    limit = 200
    # 3 entries each claiming 100 bytes → 300 total > 200
    entries = [
        (f"page{i:04d}.png", b"x" * 50, 100)  # 50 actual, 100 claimed
        for i in range(3)
    ]
    raw = _make_zip(entries)
    limits = _ZipLimits(
        max_total_uncompressed_bytes=limit,
        max_entry_uncompressed_bytes=1000,  # single-entry limit not the trigger
    )
    with pytest.raises(ValueError, match="total uncompressed"):
        _check_zip_limits(raw, limits)


def test_zip_total_uncompressed_at_limit_ok() -> None:
    """Sum exactly at limit is allowed."""
    from pdomain_prep_for_pgdp.core.ingest import _check_zip_limits

    limit = 300
    entries = [(f"page{i:04d}.png", b"x" * 100, None) for i in range(3)]
    raw = _make_zip(entries)
    limits = _ZipLimits(max_total_uncompressed_bytes=limit)
    _check_zip_limits(raw, limits)  # no exception


# ─── regression: normal small zip passes all guards ───────────────────────


def test_normal_zip_passes_all_guards() -> None:
    """A well-formed 3-page zip with tiny images passes all checks."""
    from pdomain_prep_for_pgdp.core.ingest import _check_zip_limits

    entries = [(f"page{i:04d}.png", b"x" * 1024, None) for i in range(3)]
    raw = _make_zip(entries)
    limits = _ZipLimits()  # production defaults
    _check_zip_limits(raw, limits)  # no exception
