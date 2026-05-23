"""Step 6 — Crop the proofing image for OCR.

Trims uniform OCR borders (running heads, page numbers) and yields one image
per `PageSplit` (or one whole-page image when no splits are configured).
Output coords are derived from the proofing image (Step 4 output) which
lives in canonical canvas space.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, cast

if TYPE_CHECKING:
    from collections.abc import Iterator

    from pd_prep_for_pgdp.core.models import PageRecord, PageSplit, ResolvedPageConfig


@dataclass
class OcrCropOutput:
    suffix: str  # "" for whole-page, or split.suffix
    reading_order: int
    image: bytes  # PNG-encoded


def crop_for_ocr(
    proofing_png: bytes,
    *,
    page: PageRecord,
    cfg: ResolvedPageConfig,
) -> list[OcrCropOutput]:
    """Apply Step 6 to a proofing image and return one or more OCR-ready PNGs."""
    return list(_crop_iter(proofing_png, page=page, cfg=cfg))


def _crop_iter(
    proofing_png: bytes,
    *,
    page: PageRecord,
    cfg: ResolvedPageConfig,
) -> Iterator[OcrCropOutput]:
    import numpy as np

    try:
        import cv2
    except ImportError as e:
        raise RuntimeError("cv2 required for crop_for_ocr") from e

    arr = np.frombuffer(proofing_png, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise ValueError("could not decode proofing image")
    img = cast("np.ndarray[tuple[int, int], np.dtype[np.uint8]]", img)

    # Apply uniform OCR crop (project-wide). Skipped for pages where it
    # makes no sense — see config_resolver.ocr_crop_skip_idxs().
    top, bottom, left, right = cfg.ocr_crop
    if any((top, bottom, left, right)):
        img = img[top : img.shape[0] - bottom, left : img.shape[1] - right]

    if not page.splits:
        ok, buf = cv2.imencode(".png", img)
        if not ok:
            raise RuntimeError("cv2.imencode failed for whole-page OCR crop")
        yield OcrCropOutput(suffix="", reading_order=0, image=bytes(buf.tobytes()))
        return

    h, w = img.shape
    for split in sorted(page.splits, key=lambda s: s.reading_order):
        L, R, T, B = _split_box(split, w, h)
        section = img[T:B, L:R]
        if section.size == 0:
            continue
        ok, buf = cv2.imencode(".png", section)
        if not ok:
            continue
        yield OcrCropOutput(
            suffix=split.suffix,
            reading_order=split.reading_order,
            image=bytes(buf.tobytes()),
        )


def _split_box(split: PageSplit, w: int, h: int) -> tuple[int, int, int, int]:
    L = max(0, split.L or 0)
    R = min(w, split.R if split.R is not None else w)
    T = max(0, split.T or 0)
    B = min(h, split.B if split.B is not None else h)
    return L, R, T, B
