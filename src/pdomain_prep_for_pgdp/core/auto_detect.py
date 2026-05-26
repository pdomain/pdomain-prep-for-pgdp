"""Auto-detection (spec 01 §"Auto-detection (new project setup)").

Given the source bytes for a page (or a list of pages), return cheap
heuristic suggestions:
  - `suggested_type`: `blank` for mostly-white pages, `plate_p` for color
    pages, `normal` otherwise.
  - `suggested_alignment`: `center` when content occupies <50% of width,
    `default` otherwise.
  - `median_aspect_ratio()`: median of `height / width` across a sample of
    page images. Drives the project default `page_h_w_ratio`.

Suggestions land on the page record only after the user confirms them in
the page tagger; the auto-detect step never silently mutates state.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass

from .models import AlignmentOverride, PageType

# Tuning constants — pulled from the notebook's defaults; can be exposed via
# `SystemDefaults` if the user wants to override.
BLANK_MEAN_LUMA_THRESHOLD = 245.0  # average pixel value (0..255) above this -> blank
COLOR_SATURATION_FRACTION = 0.05  # fraction of pixels with strong color
COLOR_SATURATION_LEVEL = 30  # max(R,G,B) - min(R,G,B) > this counts as colored
NARROW_CONTENT_FRACTION = 0.5  # content width / page width
CONTENT_DARKNESS_THRESHOLD = 200  # pixels darker than this count as content


@dataclass
class PageAttributeSuggestion:
    suggested_type: PageType
    suggested_alignment: AlignmentOverride
    confidence: float = 0.0


def detect_page_attributes(image_bytes: bytes) -> PageAttributeSuggestion:
    """Heuristic suggestions for a single page."""
    import numpy as np  # pyright: ignore[reportMissingImports]

    try:
        import cv2  # pyright: ignore[reportMissingImports]
    except ImportError as e:
        raise RuntimeError("cv2 required for auto_detect") from e

    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        return PageAttributeSuggestion(
            suggested_type=PageType.normal, suggested_alignment=AlignmentOverride.default
        )

    # ── Blank detection ─────────────────────────────────────────────────
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    mean_luma = float(gray.mean())
    if mean_luma >= BLANK_MEAN_LUMA_THRESHOLD:
        return PageAttributeSuggestion(
            suggested_type=PageType.blank,
            suggested_alignment=AlignmentOverride.default,
            confidence=min(1.0, (mean_luma - BLANK_MEAN_LUMA_THRESHOLD) / 10.0 + 0.6),
        )

    # ── Color detection ─────────────────────────────────────────────────
    # Per-pixel max-min across BGR channels; pixels whose max-min exceeds
    # the saturation level are coloured. If a meaningful fraction of the
    # page is coloured, suggest plate_p.
    b, g, r = cv2.split(img)
    chmax = np.maximum(np.maximum(b, g), r).astype(np.int16)
    chmin = np.minimum(np.minimum(b, g), r).astype(np.int16)
    saturated = (chmax - chmin) > COLOR_SATURATION_LEVEL
    color_fraction = float(saturated.mean())
    if color_fraction > COLOR_SATURATION_FRACTION:
        return PageAttributeSuggestion(
            suggested_type=PageType.plate_p,
            suggested_alignment=AlignmentOverride.default,
            confidence=min(1.0, color_fraction / 0.2 + 0.4),
        )

    # ── Alignment heuristic ─────────────────────────────────────────────
    _h, w = gray.shape
    content_mask = gray < CONTENT_DARKNESS_THRESHOLD
    if not content_mask.any():
        return PageAttributeSuggestion(
            suggested_type=PageType.normal,
            suggested_alignment=AlignmentOverride.default,
        )
    cols_with_content = content_mask.any(axis=0)
    xs = np.where(cols_with_content)[0]
    content_width = int(xs.max() - xs.min() + 1)
    if content_width / w < NARROW_CONTENT_FRACTION:
        return PageAttributeSuggestion(
            suggested_type=PageType.normal,
            suggested_alignment=AlignmentOverride.center,
            confidence=1.0 - (content_width / w),
        )

    return PageAttributeSuggestion(
        suggested_type=PageType.normal, suggested_alignment=AlignmentOverride.default
    )


def median_aspect_ratio(image_bytes_list: list[bytes]) -> float:
    """Return the median `height / width` across a list of page image bytes.

    Used during ingest to seed the project's default `page_h_w_ratio`. Decoded
    one at a time to keep memory bounded; corrupt entries are skipped.
    """
    import numpy as np  # pyright: ignore[reportMissingImports]

    try:
        import cv2  # pyright: ignore[reportMissingImports]
    except ImportError as e:
        raise RuntimeError("cv2 required for median_aspect_ratio") from e

    ratios: list[float] = []
    for bts in image_bytes_list:
        if not bts:
            continue
        arr = np.frombuffer(bts, dtype=np.uint8)
        try:
            img = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
        except cv2.error:
            # cv2 raises on empty/invalid buffers in some builds rather than
            # returning None. Treat both as "skip this entry".
            continue
        if img is None:
            continue
        h, w = img.shape[:2]
        if w == 0:
            continue
        ratios.append(h / w)
    if not ratios:
        return 1.65  # spec default
    return statistics.median(ratios)
