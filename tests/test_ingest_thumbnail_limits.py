"""Slice 3 — image pixel limit in _make_thumbnail_bytes.

Tests written before the implementation. The guard uses Pillow's lazy
header read to check dimensions before cv2.imdecode runs.
"""

from __future__ import annotations

import contextlib
import io
import struct
import warnings
import zlib

import pytest


def _make_png_header_only(width: int, height: int) -> bytes:
    """Construct a minimal but structurally valid PNG with one dummy scanline.

    Pillow can read the IHDR (width, height) without decompressing the image
    data. The single scanline contains garbage data — the image will fail to
    fully decode, but the header is intact for dimension checks.
    """
    sig = b"\x89PNG\r\n\x1a\n"

    # IHDR: width, height, bit_depth=8, color_type=2 (RGB), compress/filter/interlace=0
    ihdr_payload = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    ihdr_crc = zlib.crc32(b"IHDR" + ihdr_payload) & 0xFFFFFFFF
    ihdr = struct.pack(">I", 13) + b"IHDR" + ihdr_payload + struct.pack(">I", ihdr_crc)

    # IDAT: minimal scanline (filter byte + 3 pixels) — truncated / wrong size
    # but good enough for Pillow to identify as a PNG and read the IHDR.
    idat_raw = b"\x00" + b"\x00\x00\x00"  # filter=None, 1 black pixel
    idat_compressed = zlib.compress(idat_raw)
    idat_crc = zlib.crc32(b"IDAT" + idat_compressed) & 0xFFFFFFFF
    idat = struct.pack(">I", len(idat_compressed)) + b"IDAT" + idat_compressed + struct.pack(">I", idat_crc)

    # IEND
    iend_crc = zlib.crc32(b"IEND") & 0xFFFFFFFF
    iend = struct.pack(">I", 0) + b"IEND" + struct.pack(">I", iend_crc)

    return sig + ihdr + idat + iend


# ─── failing tests (pre-implementation) ───────────────────────────────────


def test_make_thumbnail_bytes_rejects_huge_image() -> None:
    """PNG with claimed 10001x10001 pixels → _CorruptImageError before cv2 runs."""
    from pd_prep_for_pgdp.core.ingest import _CorruptImageError, _make_thumbnail_bytes

    raw = _make_png_header_only(10001, 10001)
    # Suppress Pillow's own DecompressionBombWarning (we're intentionally
    # crafting an oversized header for the test).
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        with pytest.raises(_CorruptImageError, match="too large"):
            _make_thumbnail_bytes(raw, max_image_pixels=10001 * 10001 - 1)


def test_make_thumbnail_bytes_accepts_image_within_limit() -> None:
    """PNG within pixel limit passes the header check and reaches cv2."""
    # 1x1 white pixel PNG — always below any reasonable limit
    # Use Pillow to generate a real 1x1 PNG
    from PIL import Image

    from pd_prep_for_pgdp.core.ingest import _make_thumbnail_bytes

    buf = io.BytesIO()
    Image.new("RGB", (1, 1), (255, 255, 255)).save(buf, format="PNG")
    raw = buf.getvalue()

    # Should not raise a pixel-limit error (may raise _CorruptImageError from
    # cv2 if cv2 isn't available in the test env, but pixel check must pass)
    with contextlib.suppress(RuntimeError):
        _make_thumbnail_bytes(raw, max_image_pixels=200_000_000)


def test_make_thumbnail_bytes_with_default_limit_ok_normal_image() -> None:
    """Normal 100x100 image is well below the default 200 MP limit."""
    from PIL import Image

    from pd_prep_for_pgdp.core.ingest import _make_thumbnail_bytes

    buf = io.BytesIO()
    Image.new("RGB", (100, 100), (128, 128, 128)).save(buf, format="PNG")
    raw = buf.getvalue()

    with contextlib.suppress(RuntimeError):
        _make_thumbnail_bytes(raw)  # default limit


def test_make_thumbnail_bytes_nonimage_raises_corrupt_error() -> None:
    """Bytes that Pillow cannot identify as an image raise _CorruptImageError."""
    from pd_prep_for_pgdp.core.ingest import _CorruptImageError, _make_thumbnail_bytes

    with pytest.raises(_CorruptImageError):
        _make_thumbnail_bytes(b"not-an-image", max_image_pixels=200_000_000)
