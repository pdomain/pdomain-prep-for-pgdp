"""Grayscale pipeline Auto-detector — Task 3.3.

Spec: docs/specs/2026-06-15-grayscale-pipeline.md §8a

§8a GPU-aware converter rule:
  - GPU present AND meaningful color  → ``color2gray``
  - strong foxing / single-channel cast → ``best_channel`` (green)
  - mostly clean B&W                  → ``luma``
  - CPU-only with color               → ``best_channel``  (color2gray too slow on CPU)

Additionally §8a:
  - ``flatten.enabled = True`` when low-frequency luminance spread exceeds
    ``ILLUMINATION_SPREAD_THRESHOLD`` (uneven illumination / gutter shadows).
  - ``clahe.enabled = True`` when high-pass luma energy is below
    ``CONTRAST_LOW_THRESHOLD`` (faded / washed-out pages).

The entry point is :func:`recommend_grayscale_pipeline` — a PURE function that
takes already-decoded ``np.ndarray`` images + a ``gpu_available`` bool and returns
``(config_dict, why)`` with no side-effects, no I/O, no HTTP.

The route handler in ``project_stages.py`` owns loading the sample images and
detecting GPU availability, then delegates to this function.

Thresholds
----------
All thresholds are named constants below.  The test suite synthesises images
that clearly fall on one side of each threshold so the tests remain deterministic
across runs.

  CHROMA_COLOR_THRESHOLD         = 15.0
      Mean of (Cb std + Cr std) / 2 in YCbCr.  Values above this indicate
      "meaningful colour" (e.g. age-staining, tinted paper, coloured plates).
      Pure B&W pages score ≈ 0; random colourful images score ≈ 80+.

  CHANNEL_IMBALANCE_THRESHOLD    = 20.0
      Max absolute difference between any per-channel mean and the overall mean.
      Strong yellow/red/brown cast (foxing) pushes one or two channels far from
      the global mean.  B&W pages score < 3; yellow cast images score 50+.

  ILLUMINATION_SPREAD_THRESHOLD  = 30.0
      Standard deviation of luma *after 8x downsampling* (preserves low-
      frequency / large-scale gradients; suppresses text noise).  A clean
      evenly-lit page scores < 15; a strong left-to-right brightness ramp scores
      50+.

  CONTRAST_LOW_THRESHOLD         = 40.0
      Standard deviation of a high-pass residual (image - blurred image) in
      luma.  Sharp text with good contrast scores 15+; a uniformly faded page
      (all pixels near mid-gray) scores < 5.

Decision tree
-------------
1. Compute the four signals across all sample images.
2. Compose flatten / clahe flags independently of converter.
3. Converter selection (§8a, in priority order):
   a. ``channel_imbalance > CHANNEL_IMBALANCE_THRESHOLD``
      → ``best_channel`` (green) regardless of GPU.
      (A dominant single channel is best extracted directly.)
   b. ``chroma_mean > CHROMA_COLOR_THRESHOLD`` AND ``gpu_available``
      → ``color2gray``  (perceptual blending; GPU-only-worth-it per spec).
   c. ``chroma_mean > CHROMA_COLOR_THRESHOLD`` AND NOT ``gpu_available``
      → ``best_channel``  (Color2Gray too slow on CPU for long books).
   d. Otherwise (low chroma, low cast)
      → ``luma``  (clean B&W; fastest and sufficient).
"""

from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger(__name__)

# ─── Thresholds (documented constants) ───────────────────────────────────────

# Mean (Cb+Cr)/2 std-dev in YCbCr → "meaningful colour"
CHROMA_COLOR_THRESHOLD: float = 15.0

# Max absolute difference: per-channel mean vs overall mean → "single-channel cast"
CHANNEL_IMBALANCE_THRESHOLD: float = 20.0

# Low-freq luma std-dev (after 8x downsample) -- "uneven illumination"
ILLUMINATION_SPREAD_THRESHOLD: float = 30.0

# High-pass luma std-dev → below this → "faded / low contrast"
CONTRAST_LOW_THRESHOLD: float = 40.0


# ─── Signal extraction ────────────────────────────────────────────────────────


def _compute_chroma_mean(img_bgr) -> float:  # type: ignore[no-untyped-def]
    """Return mean of (Cb std + Cr std)/2 in YCbCr for a single image."""
    import cv2  # pyright: ignore[reportMissingImports]
    import numpy as np  # pyright: ignore[reportMissingImports]

    if img_bgr.ndim == 2 or (img_bgr.ndim == 3 and img_bgr.shape[2] == 1):
        return 0.0
    ycbcr = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2YCrCb)
    cb_std = float(np.std(ycbcr[:, :, 1]))
    cr_std = float(np.std(ycbcr[:, :, 2]))
    return (cb_std + cr_std) / 2.0


def _compute_channel_imbalance(img_bgr) -> float:  # type: ignore[no-untyped-def]
    """Return max |channel_mean - overall_mean| across BGR channels."""
    if img_bgr.ndim == 2 or (img_bgr.ndim == 3 and img_bgr.shape[2] == 1):
        return 0.0
    b_mean = float(img_bgr[:, :, 0].mean())
    g_mean = float(img_bgr[:, :, 1].mean())
    r_mean = float(img_bgr[:, :, 2].mean())
    overall = (b_mean + g_mean + r_mean) / 3.0
    return float(max(abs(b_mean - overall), abs(g_mean - overall), abs(r_mean - overall)))


def _compute_illumination_spread(img_bgr) -> float:  # type: ignore[no-untyped-def]
    """Return luma std-dev after 8x downsampling (low-frequency gradient signal)."""
    import cv2  # pyright: ignore[reportMissingImports]
    import numpy as np  # pyright: ignore[reportMissingImports]

    if img_bgr.ndim == 3 and img_bgr.shape[2] == 3:
        gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    elif img_bgr.ndim == 2:
        gray = img_bgr
    else:
        return 0.0

    h, w = gray.shape[:2]
    small_h, small_w = max(1, h // 8), max(1, w // 8)
    small = cv2.resize(gray, (small_w, small_h), interpolation=cv2.INTER_AREA)
    return float(np.std(small.astype(np.float32)))


def _compute_contrast_energy(img_bgr) -> float:  # type: ignore[no-untyped-def]
    """Return std-dev of high-pass residual (img - blurred) in luma."""
    import cv2  # pyright: ignore[reportMissingImports]
    import numpy as np  # pyright: ignore[reportMissingImports]

    if img_bgr.ndim == 3 and img_bgr.shape[2] == 3:
        gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    elif img_bgr.ndim == 2:
        gray = img_bgr.astype(np.float32)
    else:
        return 0.0

    # Blur with a 15x15 kernel -- low-frequency estimate; residual = high-pass
    ksize = min(15, gray.shape[0] | 1, gray.shape[1] | 1)
    ksize = max(ksize, 1)
    if ksize % 2 == 0:
        ksize += 1
    blurred = cv2.GaussianBlur(gray, (ksize, ksize), 0)
    residual = gray - blurred
    return float(np.std(residual))


# ─── Pure recommender ─────────────────────────────────────────────────────────


def recommend_grayscale_pipeline(
    images: list[Any],  # list[np.ndarray] — np.ndarray typed as Any for optional-import compat
    *,
    gpu_available: bool,
) -> tuple[dict[str, Any], str]:
    """Return ``(config_dict, why)`` for the whole grayscale pipeline.

    Parameters
    ----------
    images:
        List of BGR ``np.ndarray`` sample images (already loaded; no I/O here).
        Typically 0-8 source-page images sampled from the project.
    gpu_available:
        Whether a GPU is available for the grayscale stage.  This drives the
        §8a converter selection: color2gray is only chosen when gpu_available=True.

    Returns
    -------
    config_dict:
        A dict in exactly the shape of
        ``pdomain_book_tools.image_processing.grayscale_pipeline.GrayscaleConfig.to_dict()``,
        ready for ``GrayscaleConfig.from_dict(config_dict)`` round-trip.
    why:
        Human-readable reason string describing the recommendation.

    Notes
    -----
    When ``images`` is empty the function returns a safe ``luma`` default with a
    descriptive reason — no crash.
    """
    if not images:
        return _default_config(), "no sample images available — defaulting to luma"

    # ── Aggregate signals across all sample images ────────────────────────────
    chroma_scores: list[float] = []
    imbalance_scores: list[float] = []
    illumination_scores: list[float] = []
    contrast_scores: list[float] = []

    for img in images:
        try:
            chroma_scores.append(_compute_chroma_mean(img))
            imbalance_scores.append(_compute_channel_imbalance(img))
            illumination_scores.append(_compute_illumination_spread(img))
            contrast_scores.append(_compute_contrast_energy(img))
        except Exception:  # image-signal errors are non-fatal; skip this sample
            log.debug("grayscale autodetect: skipping image in sample due to error", exc_info=True)

    n = len(chroma_scores)
    if n == 0:
        return _default_config(), "could not decode any sample images — defaulting to luma"

    chroma_mean = sum(chroma_scores) / n
    imbalance_mean = sum(imbalance_scores) / n
    illumination_mean = sum(illumination_scores) / n
    contrast_mean = sum(contrast_scores) / n

    # ── Compose flatten / clahe flags ─────────────────────────────────────────
    flatten_enabled = illumination_mean > ILLUMINATION_SPREAD_THRESHOLD
    clahe_enabled = contrast_mean < CONTRAST_LOW_THRESHOLD

    # ── §8a converter selection (priority order) ──────────────────────────────
    # Priority 1: strong single-channel cast → best_channel (green)
    if imbalance_mean > CHANNEL_IMBALANCE_THRESHOLD:
        converter = "best_channel"
        reason_parts = [
            f"strong channel imbalance ({imbalance_mean:.1f} > {CHANNEL_IMBALANCE_THRESHOLD}) "
            f"indicates foxing/colour cast — best_channel(green) selected"
        ]
    # Priority 2: meaningful colour + GPU → color2gray
    elif chroma_mean > CHROMA_COLOR_THRESHOLD and gpu_available:
        converter = "color2gray"
        reason_parts = [
            f"colour content detected (chroma={chroma_mean:.1f} > {CHROMA_COLOR_THRESHOLD}) "
            f"with GPU available — color2gray (perceptual) selected"
        ]
    # Priority 3: meaningful colour + CPU-only → best_channel (color2gray too slow)
    elif chroma_mean > CHROMA_COLOR_THRESHOLD and not gpu_available:
        converter = "best_channel"
        reason_parts = [
            f"colour content detected (chroma={chroma_mean:.1f} > {CHROMA_COLOR_THRESHOLD}) "
            f"but no GPU — best_channel(green) selected (color2gray too slow on CPU)"
        ]
    # Priority 4: clean B&W → luma
    else:
        converter = "luma"
        reason_parts = [
            f"clean B&W source (chroma={chroma_mean:.1f} <= {CHROMA_COLOR_THRESHOLD}, "
            f"imbalance={imbalance_mean:.1f} <= {CHANNEL_IMBALANCE_THRESHOLD}) — luma selected"
        ]

    if flatten_enabled:
        reason_parts.append(
            f"flatten enabled: illumination spread {illumination_mean:.1f} > {ILLUMINATION_SPREAD_THRESHOLD}"
        )
    if clahe_enabled:
        reason_parts.append(
            f"CLAHE enabled: contrast energy {contrast_mean:.1f} < {CONTRAST_LOW_THRESHOLD} (faded/low-contrast)"
        )

    why = "; ".join(reason_parts) + f" (sampled {n} pages)"

    cfg = _build_config(
        converter=converter,
        flatten_enabled=flatten_enabled,
        clahe_enabled=clahe_enabled,
    )
    return cfg, why


# ─── Config builders ──────────────────────────────────────────────────────────


def _default_config() -> dict[str, Any]:
    """Return the default GrayscaleConfig dict (luma, no flatten, no CLAHE)."""
    try:
        from pdomain_book_tools.image_processing.grayscale_pipeline import (  # pyright: ignore[reportMissingImports]
            GrayscaleConfig,
        )

        return GrayscaleConfig().to_dict()
    except ImportError:
        # Fallback: hand-build the canonical shape
        return {
            "flatten": {"enabled": False, "radius": 64, "strength": 1.0},
            "converter": "luma",
            "channel": "green",
            "color2gray": {"radius": 300, "samples": 4, "iterations": 10, "enhance_shadows": False},
            "clahe": {"enabled": False, "clip_limit": 2.0, "tile_grid": 8},
            "output_range": None,
        }


def _build_config(
    *,
    converter: str,
    flatten_enabled: bool,
    clahe_enabled: bool,
) -> dict[str, Any]:
    """Build a GrayscaleConfig dict with the selected converter + enable flags."""
    try:
        from pdomain_book_tools.image_processing.grayscale_pipeline import (  # pyright: ignore[reportMissingImports]
            ClaheConfig,
            Converter,
            FlattenConfig,
            GrayscaleConfig,
        )

        cfg = GrayscaleConfig(
            converter=Converter(converter),
            flatten=FlattenConfig(enabled=flatten_enabled),
            clahe=ClaheConfig(enabled=clahe_enabled),
        )
        return cfg.to_dict()
    except ImportError:
        # book-tools unavailable: return the canonical GrayscaleConfig shape manually
        return {
            "flatten": {"enabled": flatten_enabled, "radius": 64, "strength": 1.0},
            "converter": converter,
            "channel": "green",
            "color2gray": {"radius": 300, "samples": 4, "iterations": 10, "enhance_shadows": False},
            "clahe": {"enabled": clahe_enabled, "clip_limit": 2.0, "tile_grid": 8},
            "output_range": None,
        }
