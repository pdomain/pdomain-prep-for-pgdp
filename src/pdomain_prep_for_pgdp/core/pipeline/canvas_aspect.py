"""Page aspect measurements behind the canvas-map review."""

from __future__ import annotations

import statistics
import struct
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Sequence

_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
PNG_HEADER_BYTES = 24
_BODY_RATIO_TOLERANCE = 0.05


def png_dimensions(header: bytes) -> tuple[int, int] | None:
    """Return ``(width, height)`` from the first bytes of a PNG, or None for other data."""
    if len(header) < PNG_HEADER_BYTES or not header.startswith(_PNG_SIGNATURE):
        return None
    width, height = struct.unpack(">II", header[16:PNG_HEADER_BYTES])
    return int(width), int(height)


def split_body_pages(ratios: Sequence[float]) -> tuple[float | None, list[bool]]:
    """Return the median ratio and whether each page sits within 5% of it."""
    if not ratios:
        return None, []
    median = statistics.median(ratios)
    return median, [abs(ratio - median) <= median * _BODY_RATIO_TOLERANCE for ratio in ratios]
