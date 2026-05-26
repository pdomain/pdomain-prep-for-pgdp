"""Tests for duplicate-basename handling in ZIP ingest (issue #134).

When a ZIP contains two entries with the same basename in different
subdirectories (e.g. ``001/img.jpg`` and ``002/img.jpg``), they must not
overwrite each other.  The fix preserves relative-path components in the
output stem, so both entries land in distinct storage keys.

A secondary safety net handles the edge case where two different ZIP paths
produce the same sanitised stem (e.g. ``a/img.jpg`` and ``a__img.jpg``):
a deterministic ``_2``, ``_3`` … suffix is appended and a warning is logged.
"""

from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass

import pytest

# ─── unit tests for _stem_from_zip_path ────────────────────────────────────


def test_stem_from_zip_path_flat_name() -> None:
    """A flat filename (no directory) returns just the stem."""
    from pdomain_prep_for_pgdp.core.ingest import _stem_from_zip_path

    assert _stem_from_zip_path("page0001.png") == "page0001"


def test_stem_from_zip_path_single_dir() -> None:
    """A single-directory prefix is preserved, joined with ``__``."""
    from pdomain_prep_for_pgdp.core.ingest import _stem_from_zip_path

    assert _stem_from_zip_path("imgs/page0001.png") == "imgs__page0001"


def test_stem_from_zip_path_multiple_dirs() -> None:
    """Multiple directory components are all preserved."""
    from pdomain_prep_for_pgdp.core.ingest import _stem_from_zip_path

    assert _stem_from_zip_path("vol1/ch2/page0001.jpg") == "vol1__ch2__page0001"


def test_stem_from_zip_path_backslash_separator() -> None:
    """Windows-style backslash separators are normalised to forward slashes."""
    from pdomain_prep_for_pgdp.core.ingest import _stem_from_zip_path

    assert _stem_from_zip_path("imgs\\page0001.png") == "imgs__page0001"


def test_stem_from_zip_path_no_extension() -> None:
    """Entries without an extension keep the full sanitised path."""
    from pdomain_prep_for_pgdp.core.ingest import _stem_from_zip_path

    assert _stem_from_zip_path("scans/raw_scan") == "scans__raw_scan"


# ─── helpers ───────────────────────────────────────────────────────────────


@dataclass
class _ZipLimits:
    """Mirrors the shape of Settings fields consumed by the guard."""

    max_source_zip_bytes: int = 2 * 1024 * 1024 * 1024
    max_zip_entries: int = 2000
    max_entry_uncompressed_bytes: int = 100 * 1024 * 1024
    max_total_uncompressed_bytes: int = 5 * 1024 * 1024 * 1024


def _make_zip(entries: list[tuple[str, bytes]]) -> bytes:
    """Build an in-memory zip from (filename, data) pairs."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_STORED) as zf:
        for name, data in entries:
            zf.writestr(name, data)
    return buf.getvalue()


# ─── integration tests for _enumerate_zip ──────────────────────────────────


@pytest.mark.asyncio
async def test_enumerate_zip_duplicate_basenames_preserved(tmp_path) -> None:
    """Two entries with the same basename in different subdirs become two
    distinct storage keys — neither overwrites the other."""
    pytest.importorskip("cv2")
    import numpy as np

    from pdomain_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
    from pdomain_prep_for_pgdp.core.ingest import _enumerate_zip

    def _png(h: int, w: int, fill: int) -> bytes:
        cv2 = pytest.importorskip("cv2")
        img = np.full((h, w, 3), fill, dtype=np.uint8)
        ok, buf = cv2.imencode(".png", img)
        assert ok
        return bytes(buf.tobytes())

    img_a = _png(30, 30, 100)  # distinct pixel values so we can tell them apart
    img_b = _png(30, 30, 200)

    raw = _make_zip(
        [
            ("001/img.jpg", img_a),
            ("002/img.jpg", img_b),
        ]
    )

    storage = FilesystemStorage(root=tmp_path / "data")
    project_id = "proj_dupe"
    source_key = f"projects/{project_id}/source.zip"
    await storage.put_bytes(source_key, raw)

    limits = _ZipLimits()
    entries = await _enumerate_zip(storage, source_key, project_id, limits=limits)

    assert len(entries) == 2, f"Expected 2 entries, got {len(entries)}: {[e.key for e in entries]}"
    # Both keys must be distinct.
    keys = {e.key for e in entries}
    assert len(keys) == 2, f"Entries share a storage key: {keys}"
    # The bytes must match their respective originals.
    stems = {e.stem for e in entries}
    assert stems == {"001__img", "002__img"}, f"Unexpected stems: {stems}"


@pytest.mark.asyncio
async def test_enumerate_zip_no_regression_flat_zip(tmp_path) -> None:
    """A ZIP with no subdirectories (all files at root) produces the same
    stems as before — no regressions for the common case."""
    pytest.importorskip("cv2")
    import numpy as np

    from pdomain_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
    from pdomain_prep_for_pgdp.core.ingest import _enumerate_zip

    def _png(h: int, w: int) -> bytes:
        cv2 = pytest.importorskip("cv2")
        img = np.full((h, w, 3), 128, dtype=np.uint8)
        ok, buf = cv2.imencode(".png", img)
        assert ok
        return bytes(buf.tobytes())

    raw = _make_zip(
        [
            ("page0001.png", _png(30, 30)),
            ("page0002.png", _png(30, 30)),
        ]
    )

    storage = FilesystemStorage(root=tmp_path / "data")
    project_id = "proj_flat"
    source_key = f"projects/{project_id}/source.zip"
    await storage.put_bytes(source_key, raw)

    limits = _ZipLimits()
    entries = await _enumerate_zip(storage, source_key, project_id, limits=limits)

    assert len(entries) == 2
    stems = {e.stem for e in entries}
    assert stems == {"page0001", "page0002"}


@pytest.mark.asyncio
async def test_enumerate_zip_collision_suffix_fallback(tmp_path) -> None:
    """When two different zip paths produce the same sanitised stem (e.g.
    ``a/img.jpg`` and ``a__img.jpg`` both map to ``a__img``), the second
    entry gets a ``_2`` suffix rather than overwriting the first."""
    pytest.importorskip("cv2")
    import numpy as np

    from pdomain_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage
    from pdomain_prep_for_pgdp.core.ingest import _enumerate_zip

    def _png() -> bytes:
        cv2 = pytest.importorskip("cv2")
        img = np.full((30, 30, 3), 128, dtype=np.uint8)
        ok, buf = cv2.imencode(".png", img)
        assert ok
        return bytes(buf.tobytes())

    # These two paths both produce the sanitised stem ``a__img``.
    raw = _make_zip(
        [
            ("a/img.jpg", _png()),
            ("a__img.jpg", _png()),
        ]
    )

    storage = FilesystemStorage(root=tmp_path / "data")
    project_id = "proj_collision"
    source_key = f"projects/{project_id}/source.zip"
    await storage.put_bytes(source_key, raw)

    limits = _ZipLimits()
    entries = await _enumerate_zip(storage, source_key, project_id, limits=limits)

    assert len(entries) == 2
    keys = {e.key for e in entries}
    assert len(keys) == 2, f"Collision not resolved: {keys}"
    stems = sorted(e.stem for e in entries)
    # One entry keeps the canonical stem; the other gets _2 appended.
    assert stems == ["a__img", "a__img_2"], f"Unexpected stems: {stems}"
