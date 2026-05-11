"""Step 4 — proofing-image pipeline (CPU path).

Mirrors the GPU sub-step sequence in spec 02 §4c-4o using
`pd_book_tools.image_processing.cv2_processing` primitives. The GPU
(`adapters/gpu/local.py`) overrides this with its cupy_processing variant
later; the orchestration shape is identical.

Order (matches spec 02):
  4c. read source
  4d. initial crop (project-wide + per-page)
  4e. optional manual deskew before crop
  4f. color -> grayscale
  4g. threshold (Otsu auto unless override)
  4h. invert (text=255, bg=0)
  4i. find content edges
  4j. crop to content + optional whitespace pad
  4k. auto-deskew (when not skipped/aligned/rotated/single-dim)
  4l. optional morph fill
  4m. re-invert + rescale to canonical aspect
  4n. map onto canonical canvas with alignment
  4o. encode PNG
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from ..models import PageType, ResolvedPageConfig

log = logging.getLogger(__name__)


@dataclass
class ProcessPageOutput:
    proofing_png: bytes
    pre_ocr_png: bytes
    height: int
    width: int


def process_page_cpu(
    source_image_bytes: bytes,
    cfg: ResolvedPageConfig,
) -> ProcessPageOutput:
    """Run Step 4 on CPU and return PNG-encoded proofing + pre-OCR images.

    For blank/plate-b/plate-r pages this returns a generated blank proof
    (Step 4b) — caller is expected to short-circuit before calling, but we
    handle it defensively.
    """
    import numpy as np  # type: ignore[import-not-found]

    try:
        import cv2  # type: ignore[import-not-found]
        from pd_book_tools.image_processing.cv2_processing import (  # type: ignore[import-not-found]
            Alignment,
            add_whitespace_percentage,
            auto_deskew,
            binary_thresh,
            crop_edges,
            crop_to_rectangle,
            cv2_convert_to_grayscale,
            find_edges,
            invert_image,
            map_content_onto_scaled_canvas,
            morph_fill,
            otsu_binary_thresh,
            rescale_image,
            rotate_image,
        )
    except ImportError as e:
        raise RuntimeError(
            "process_page_cpu requires cv2 and pd_book_tools.image_processing.cv2_processing"
        ) from e

    if cfg.page_type in {PageType.blank, PageType.plate_b, PageType.plate_r}:
        from .blank_proof import create_blank_proof

        png = create_blank_proof(h_w_ratio=cfg.page_h_w_ratio)
        # Decode once to surface dimensions to caller.
        arr = np.frombuffer(png, dtype=np.uint8)
        decoded = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
        h, w = decoded.shape[:2]
        return ProcessPageOutput(proofing_png=png, pre_ocr_png=png, height=h, width=w)

    # 4c — read source ─────────────────────────────────────────────────────
    arr = np.frombuffer(source_image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("could not decode source image bytes")

    # 4d — initial crop ────────────────────────────────────────────────────
    crop = cfg.initial_crop or cfg.initial_crop_all
    L_, R_, T_, B_ = crop
    if any(crop):
        img = crop_edges(img, top=T_, bottom=B_, left=L_, right=R_)

    # 4e — optional manual deskew before crop ─────────────────────────────
    if cfg.deskew_before_crop is not None:
        img = rotate_image(img, cfg.deskew_before_crop)

    # 4f — grayscale ───────────────────────────────────────────────────────
    img_gray = cv2_convert_to_grayscale(img)

    # 4g — threshold ───────────────────────────────────────────────────────
    if cfg.threshold_level is None:
        img_thresh = otsu_binary_thresh(img_gray)
    else:
        img_thresh = binary_thresh(img_gray, level=cfg.threshold_level)

    # 4h — invert (text=255, bg=0) ────────────────────────────────────────
    img_inv = invert_image(img_thresh)

    # 4i — find content edges (CPU path: pixel-based only) ────────────────
    minX, maxX, minY, maxY = find_edges(
        img_inv,
        fuzzy_pct=cfg.fuzzy_pct,
        pixel_count_columns=cfg.pixel_count_columns,
        pixel_count_rows=cfg.pixel_count_rows,
    )

    # 4j — crop to content + optional whitespace pad ──────────────────────
    img_cropped = crop_to_rectangle(img_inv, minX, maxX, minY, maxY)
    if cfg.white_space_additional is not None:
        l_pct, r_pct, t_pct, b_pct = cfg.white_space_additional
        img_cropped = add_whitespace_percentage(
            img_cropped,
            left_pct=l_pct,
            right_pct=r_pct,
            top_pct=t_pct,
            bottom_pct=b_pct,
        )

    # 4k — auto-deskew ─────────────────────────────────────────────────────
    if cfg.deskew_after_crop is not None:
        img_deskewed = rotate_image(img_cropped, cfg.deskew_after_crop)
    elif (
        cfg.skip_auto_deskew
        or cfg.alignment.value != "default"
        or cfg.single_dimension_rescale
        or cfg.rotated_standard
    ):
        img_deskewed = img_cropped
    else:
        out = auto_deskew(img_cropped, pct=0.30)
        img_deskewed = out[0] if isinstance(out, tuple) else out

    # 4l — optional morph fill ─────────────────────────────────────────────
    if cfg.do_morph:
        img_deskewed = morph_fill(img_deskewed)

    # 4m — re-invert + rescale ─────────────────────────────────────────────
    img_rescaled = rescale_image(
        invert_image(img_deskewed),
        target_short_side=1000,
    )

    # 4n — map onto canonical canvas ───────────────────────────────────────
    alignment = {
        "default": Alignment.DEFAULT,
        "top": Alignment.TOP,
        "center": Alignment.CENTER,
        "bottom": Alignment.BOTTOM,
    }[cfg.alignment.value]
    img_final = map_content_onto_scaled_canvas(
        img_rescaled,
        force_align=alignment,
        height_width_ratio=cfg.page_h_w_ratio,
    )

    # 4o — encode PNG ──────────────────────────────────────────────────────
    h, w = img_final.shape[:2]
    ok, buf = cv2.imencode(".png", img_final)
    if not ok:
        raise RuntimeError("cv2.imencode failed for proofing image")
    png = bytes(buf.tobytes())
    return ProcessPageOutput(proofing_png=png, pre_ocr_png=png, height=h, width=w)
