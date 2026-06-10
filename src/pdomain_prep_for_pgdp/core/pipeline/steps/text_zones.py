"""text_zones stage — zone detection on binary page image.

PLACEMENT: App-local stage (PGDP-specific APPLY_SPLIT semantics).
Algorithm: uses cv2 contour detection on binary images (no pdomain-book-tools
textline dewarp dependency). See docs/specs/library-placement.md §3.

Outputs zone_json: JSON bytes with structure:
    {
        "zones": [
            {
                "zone_id": str,         # stable deterministic ID
                "bbox": [x, y, w, h],   # bounding box in image pixels
                "zone_type": str,       # "text" | "blank"
                "area": int,            # pixel area of zone
            },
            ...
        ],
        "image_width": int,
        "image_height": int,
    }

The APPLY_SPLIT mutation (splitting a page at text_zones) is handled by the
stage runner using split_page_in_store; this module only produces the zone
detection artifact.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, cast

import numpy as np
import numpy.typing as npt

type ImageArray = npt.NDArray[np.uint8]


def detect_text_zones(
    binary: ImageArray,
    *,
    min_area: int = 50,
    merge_gap: int = 20,
) -> dict[str, Any]:
    """Detect text zones in a binary (black-on-white) image using contour analysis.

    This is a lightweight zone detector that finds connected regions of text
    pixels. For production use, pdomain-book-tools textline dewarp pipelines
    provide more sophisticated zone detection; this implementation is suitable
    for the initial zone artifact output.

    Args:
        binary: 2D uint8 ndarray (single-channel, white background).
        min_area: Minimum contour area in pixels to include as a zone.
        merge_gap: Vertical gap in pixels below which adjacent zones are merged.

    Returns:
        dict with keys: zones, image_width, image_height.
    """
    try:
        import cv2  # pyright: ignore[reportMissingImports]
    except ImportError:
        return _fallback_zones(binary)

    h, w = binary.shape[:2]

    # Invert: text is dark on white, contours want white on black
    inverted: ImageArray = cast("ImageArray", cv2.bitwise_not(binary)) if binary.dtype == np.uint8 else binary

    # Find contours of text regions
    contours, _ = cv2.findContours(inverted, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    raw_zones: list[tuple[int, int, int, int]] = []  # (x, y, w, h)
    for cnt in contours:
        area = float(cv2.contourArea(cnt))
        if area < min_area:
            continue
        x, y, cw, ch = cv2.boundingRect(cnt)
        raw_zones.append((int(x), int(y), int(cw), int(ch)))

    # Sort by vertical position for stable ordering
    raw_zones.sort(key=lambda z: (z[1], z[0]))

    # Merge zones that are close vertically (same text block)
    merged = _merge_nearby_zones(raw_zones, gap=merge_gap, image_width=w)

    zones: list[dict[str, Any]] = []
    for i, (x, y, zw, zh) in enumerate(merged):
        zone_id = _zone_id(x, y, zw, zh, i)
        zones.append(
            {
                "zone_id": zone_id,
                "bbox": [x, y, zw, zh],
                "zone_type": "text",
                "area": zw * zh,
            }
        )

    return {
        "zones": zones,
        "image_width": int(w),
        "image_height": int(h),
    }


def _merge_nearby_zones(
    zones: list[tuple[int, int, int, int]],
    *,
    gap: int,
    image_width: int,
) -> list[tuple[int, int, int, int]]:
    """Merge horizontally overlapping or vertically proximate zones."""
    if not zones:
        return []

    # Simple row-based merge: merge zones whose y-ranges overlap or are within gap
    merged: list[tuple[int, int, int, int]] = []
    current_x, current_y, current_w, current_h = zones[0]

    for x, y, w, h in zones[1:]:
        current_bottom = current_y + current_h
        zone_top = y
        if zone_top <= current_bottom + gap:
            # Merge: expand bounding box
            new_x = min(current_x, x)
            new_y = min(current_y, y)
            new_right = max(current_x + current_w, x + w)
            new_bottom = max(current_y + current_h, y + h)
            current_x = new_x
            current_y = new_y
            current_w = new_right - new_x
            current_h = new_bottom - new_y
        else:
            merged.append((current_x, current_y, current_w, current_h))
            current_x, current_y, current_w, current_h = x, y, w, h

    merged.append((current_x, current_y, current_w, current_h))
    return merged


def _fallback_zones(binary: ImageArray) -> dict[str, Any]:
    """Fallback when cv2 is unavailable — return the full image as one zone."""
    h, w = binary.shape[:2]
    zone_id = _zone_id(0, 0, w, h, 0)
    return {
        "zones": [
            {
                "zone_id": zone_id,
                "bbox": [0, 0, w, h],
                "zone_type": "text",
                "area": w * h,
            }
        ],
        "image_width": int(w),
        "image_height": int(h),
    }


def _zone_id(x: int, y: int, w: int, h: int, idx: int) -> str:
    """Generate a stable zone ID from coordinates."""
    key = f"{x},{y},{w},{h},{idx}"
    return "z" + hashlib.sha1(key.encode()).hexdigest()[:12]  # noqa: S324 — non-cryptographic


# ────────────────────────────────────────────────────────────────────────────
# v2 stage callable
# ────────────────────────────────────────────────────────────────────────────


def text_zones_v2_cpu(binary: ImageArray, cfg: Any = None) -> bytes:
    """v2 text_zones stage callable.

    Takes a binary (single-channel) ndarray and returns zone_json bytes.

    The APPLY_SPLIT mutation (splitting a page at the zone boundary) is
    handled by the stage runner, not this function.
    """
    result = detect_text_zones(binary)
    return json.dumps(result).encode("utf-8")
