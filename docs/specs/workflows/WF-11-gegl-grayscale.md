# Workflow: Perceptual Grayscale Stage Controls

**Priority:** P1 (quality regression from notebook)
**Affects:** `04-page-workbench.md` StageControlsPanel for grayscale stage
**Audience:** Content provider processing color scans

## Problem

The legacy notebook used GEGL C2G (color-to-grayscale) — a perceptual algorithm that
preserves local contrast in color images far better than luminosity-weighted grayscale
for historical books with age-stained, yellowed, or multi-toned pages. The current app
uses standard grayscale. This is a quality regression that affects thresholding quality
downstream.

pdomain-book-tools already has this algorithm in
`image_processing/cupy_processing/color_to_gray.py` as `np_uint8_color_to_gray()` —
a GPU-accelerated perceptual color-to-grayscale via random neighbourhood envelope
sampling (analogous to GEGL `c2g`).

## Goal

Add a grayscale mode selector to the grayscale stage controls, offering:

- Standard (luminosity-weighted) — current behavior, fast
- Perceptual (pdomain-book-tools `np_uint8_color_to_gray`) — better on color scans, slower

## Happy Path Mockup Spec

### StageControlsPanel — grayscale stage

"Grayscale mode" Select:

- Standard (fast) — default for B&W source scans
- Perceptual (slower, better for color/tinted scans)

When Perceptual selected: amber info callout:
"ℹ Perceptual grayscale takes ~10–30s per page. Recommended for color or yellowed/tinted source scans."

Thumbnail in chip rail updates after re-run to show the difference.

## Open Design Questions

- Should perceptual mode be auto-selected when the source image is detected as color?
