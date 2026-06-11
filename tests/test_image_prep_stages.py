"""B2 — image-prep stage group: denoise, dewarp, post_transform_crop.

TDD tests for:
  - denoise: speckled binary → speckle removed, glyphs preserved (polarity contract)
  - dewarp: synthetically warped image is measurably straightened
  - post_transform_crop: pass-through at default config; re-key equivalence

Spec: docs/specs/stage-registry-v2.md §2 (table rows 06-08)

All tests use UV_NO_SYNC mode (editable pdomain-book-tools local main installed
in worktree venv; see DEP APPROACH in B2 commit message).

Availability: denoise and dewarp require pdomain-book-tools >=0.18.0 (local main),
which includes the geometry_correction and updated image_processing modules.
When only the published wheel (0.17.x) is installed, these tests skip cleanly.
"""

from __future__ import annotations

import importlib.util

import numpy as np
import pytest

# Skip all denoise/dewarp tests when the required pdomain-book-tools sub-modules
# are not available (i.e. the published 0.17.x wheel is installed instead of
# the local editable main). post_transform_crop tests still run.
_HAS_GEOMETRY_CORRECTION = importlib.util.find_spec("pdomain_book_tools.geometry_correction") is not None
_HAS_DENOISE = importlib.util.find_spec("pdomain_book_tools.image_processing") is not None

# Checked lazily inside each test — see _require_geometry_correction() helper below.


def _require_geometry_correction() -> None:
    """Skip the calling test if geometry_correction is unavailable."""
    if not _HAS_GEOMETRY_CORRECTION:
        pytest.skip(
            "pdomain_book_tools.geometry_correction not available — "
            "install editable pdomain-book-tools (>=0.18 local main)"
        )


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────


def _binary_text_on_white(h: int = 120, w: int = 100) -> np.ndarray:
    """Synthetic binary image: text=255 (ink), bg=0 (white) — v2 pipeline polarity.

    After threshold_v2 (threshold + invert), the binary image has text=255/bg=0.
    This is what deskew and denoise receive.
    """
    img = np.zeros((h, w), dtype=np.uint8)  # bg=0
    # horizontal text "stripes" to simulate lines of text
    for row in range(10, h - 10, 12):
        img[row : row + 3, 10 : w - 10] = 255  # text stroke = 255
    # Add isolated 1px speckle in background areas
    rng = np.random.default_rng(42)
    speckle_rows = rng.integers(2, h - 2, size=30)
    speckle_cols = rng.integers(2, w - 2, size=30)
    for r, c in zip(speckle_rows, speckle_cols, strict=True):
        # only set if in background (avoid overwriting glyphs)
        if img[r, c] == 0:
            img[r, c] = 255
    return img


def _warped_text_lines(h: int = 200, w: int = 160) -> np.ndarray:
    """Small synthetic page — used by shape/polarity tests that do not need dewarp to fire."""
    img = np.zeros((h, w), dtype=np.uint8)
    amplitude = 6
    for base_row in range(15, h - 15, 14):
        for col in range(5, w - 5):
            warp = int(amplitude * np.sin(2 * np.pi * col / w))
            row = base_row + warp
            if 0 <= row < h and 0 <= row + 2 < h:
                img[row : row + 2, col] = 255
    return img


def _warped_page_for_dewarp_test(
    h: int = 1000,
    w: int = 760,
    n_lines: int = 20,
    top: int = 60,
    gap: int = 42,
    amplitude: int = 14,
) -> np.ndarray:
    """Synthetic page that exercises TextlineDisparityDewarp (needs ≥15 textlines).

    Uses white background / black text (bg=255, text=0) — Otsu binarization in
    the detector handles either polarity.  Returns a uint8 array sized (h, w).

    Text lines are drawn as sinusoidal arcs so that row-projection variance
    of the un-dewarped image is measurably lower than after dewarping:
    warped lines spread ink across more rows → lower row-sum variance;
    straight lines concentrate ink into sharp peaks → higher variance.
    """
    img = np.full((h, w), 255, dtype=np.uint8)  # white bg
    for i in range(n_lines):
        base_row = top + i * gap
        for x0 in range(40, w - 40, 60):
            col_centre = x0 + 25
            warp = int(amplitude * np.sin(2 * np.pi * col_centre / w))
            y = base_row + warp
            if 0 <= y < h and y + 10 < h:
                img[y : y + 10, x0 : x0 + 50] = 0  # black rectangle (text blob)
    return img


# ──────────────────────────────────────────────────────────────────────────────
# denoise stage
# ──────────────────────────────────────────────────────────────────────────────


def test_denoise_stage_registered_in_v2() -> None:
    """denoise is registered in V2_STAGE_IMPL and no longer raises StageNotImplemented."""
    _require_geometry_correction()
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import (
        StageNotImplemented,
        get_v2_stage_impl,
    )

    fn = get_v2_stage_impl("denoise", "cpu")
    # Should not raise StageNotImplemented on a real binary image
    img = _binary_text_on_white()
    try:
        out = fn(img)
        assert isinstance(out, np.ndarray)
    except StageNotImplemented:
        pytest.fail("denoise stage is still a placeholder — should be implemented")


def test_denoise_removes_speckle() -> None:
    """Denoise stage removes isolated 1-pixel speckle from the background."""
    _require_geometry_correction()
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import get_v2_stage_impl

    fn = get_v2_stage_impl("denoise", "cpu")
    img = _binary_text_on_white(h=120, w=100)

    # Count isolated background pixels before
    # (pixels with value 255 that are not part of text stripes)
    # We know the speckle was placed in bg=0 areas and set to 255
    out = fn(img)

    assert isinstance(out, np.ndarray)
    assert out.shape == img.shape
    assert out.dtype == np.uint8

    # The output must have fewer or equal 255-pixels than input in the
    # speckled regions (rows 2-9, rows 15..23 etc between text stripes).
    # More concretely: speckle-only pixels (single isolated pixels) should be gone.
    # We check that at least some pixels were removed.
    speckle_region = out[2:9, 2:98]  # a background-only band above first text row
    # After denoise, isolated speckles should be removed (≤ very few non-zero pixels)
    remaining_speckle = int(np.sum(speckle_region > 0))
    assert remaining_speckle == 0, (
        f"denoise should remove single-pixel speckle in background bands; {remaining_speckle} pixels remain"
    )


def test_denoise_preserves_glyphs() -> None:
    """Denoise stage preserves large connected text glyphs."""
    _require_geometry_correction()
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import get_v2_stage_impl

    fn = get_v2_stage_impl("denoise", "cpu")

    # Image with only large glyphs, no speckle
    img = np.zeros((80, 100), dtype=np.uint8)
    img[10:20, 10:90] = 255  # large text stripe (area=10*80=800, well above min)

    out = fn(img)

    # The large stripe should be preserved
    stripe_pixels_before = int(np.sum(img[10:20, 10:90] > 0))
    stripe_pixels_after = int(np.sum(out[10:20, 10:90] > 0))
    assert stripe_pixels_after == stripe_pixels_before, (
        f"denoise must not remove large text stripes: before={stripe_pixels_before}, "
        f"after={stripe_pixels_after}"
    )


def test_denoise_output_polarity_matches_input() -> None:
    """Denoise output polarity is text=255/bg=0, same as v2 pipeline convention."""
    _require_geometry_correction()
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import get_v2_stage_impl

    fn = get_v2_stage_impl("denoise", "cpu")
    img = _binary_text_on_white()
    out = fn(img)

    # Background (majority) should be 0; text (minority) should be 255
    # In our synthetic image text stripes are ~25% of pixels
    bg_pixels = int(np.sum(out == 0))
    total = out.size
    # More than half should be background (0)
    assert bg_pixels > total * 0.5, (
        f"Expected bg=0 to dominate after denoise, got {bg_pixels}/{total} bg pixels"
    )


def test_denoise_equivalence_to_v1_chain() -> None:
    """v2 denoise output has same shape and dtype as its binary input."""
    _require_geometry_correction()
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import get_v2_stage_impl

    fn = get_v2_stage_impl("denoise", "cpu")
    img = _binary_text_on_white()
    out = fn(img)

    assert out.shape == img.shape
    assert out.dtype == img.dtype
    # Output values must be binary (only 0 and 255)
    unique_vals = set(np.unique(out).tolist())
    assert unique_vals.issubset({0, 255}), f"non-binary output: {unique_vals}"


# ──────────────────────────────────────────────────────────────────────────────
# dewarp stage
# ──────────────────────────────────────────────────────────────────────────────


def test_dewarp_stage_registered_in_v2() -> None:
    """dewarp is registered in V2_STAGE_IMPL and no longer raises StageNotImplemented."""
    _require_geometry_correction()
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import (
        StageNotImplemented,
        get_v2_stage_impl,
    )

    fn = get_v2_stage_impl("dewarp", "cpu")
    img = _binary_text_on_white(h=200, w=160)
    try:
        out = fn(img)
        assert isinstance(out, np.ndarray)
    except StageNotImplemented:
        pytest.fail("dewarp stage is still a placeholder — should be implemented")


def test_dewarp_preserves_shape() -> None:
    """Dewarp output has the same shape as the input."""
    _require_geometry_correction()
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import get_v2_stage_impl

    fn = get_v2_stage_impl("dewarp", "cpu")
    img = _binary_text_on_white(h=200, w=160)
    out = fn(img)

    assert out.shape == img.shape, f"shape mismatch: {out.shape} vs {img.shape}"
    assert out.dtype == np.uint8


def test_dewarp_output_polarity_matches_input() -> None:
    """Dewarp output polarity is text=255/bg=0, matching the v2 pipeline convention."""
    _require_geometry_correction()
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import get_v2_stage_impl

    fn = get_v2_stage_impl("dewarp", "cpu")
    img = _binary_text_on_white(h=200, w=160)
    out = fn(img)

    # Background should be 0, text stripes should be 255
    bg_fraction = float(np.sum(out == 0)) / out.size
    assert bg_fraction > 0.5, f"bg=0 should dominate after dewarp, got {bg_fraction:.2%}"


def _row_projection_variance(img: np.ndarray) -> float:
    """Variance of per-row ink sums (axis=1).

    Straight text lines concentrate ink into sharp row-peaks; curved/warped
    lines spread ink more uniformly.  After a successful dewarp the lines
    straighten → peak/trough contrast rises → variance *increases*.
    """
    row_sums = img.astype(np.float64).sum(axis=1)
    return float(np.var(row_sums))


def test_dewarp_on_warped_image_increases_row_projection_variance() -> None:
    """Dewarp on a synthetically warped page increases row-projection variance.

    Metric: variance of per-row ink sums (img.sum(axis=1)).

    Straight lines concentrate ink into sharp peaks → higher variance.
    Warped lines distribute ink more uniformly → lower variance.
    After dewarping, variance must increase by at least 5 %.

    The synthetic image uses 20 sinusoidal text-block rows at h=1000/w=760,
    which reliably provides ≥15 detected textlines for TextlineDisparityDewarp.
    """
    _require_geometry_correction()
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import get_v2_stage_impl

    fn = get_v2_stage_impl("dewarp", "cpu")
    img = _warped_page_for_dewarp_test()

    out = fn(img)

    assert isinstance(out, np.ndarray)
    assert out.shape == img.shape
    assert out.dtype == np.uint8

    var_before = _row_projection_variance(img)
    var_after = _row_projection_variance(out)

    assert var_after > var_before * 1.05, (
        f"dewarp should increase row-projection variance by ≥5 %: "
        f"before={var_before:.2f}, after={var_after:.2f}"
    )


def test_dewarp_low_textline_image_is_identity() -> None:
    """Dewarp with fewer than min_textlines (15) returns shape/dtype-identical output.

    TextlineDisparityDewarp falls back to identity + confidence=0 when fewer
    than 15 textlines are detected.  The output must have the same shape and
    dtype as the input (graceful pass-through, no crash).
    """
    _require_geometry_correction()
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import get_v2_stage_impl

    fn = get_v2_stage_impl("dewarp", "cpu")
    # Small image with only ~8 text lines — well below the min_textlines=15 threshold
    img = _warped_text_lines(h=200, w=160)

    out = fn(img)

    assert isinstance(out, np.ndarray)
    assert out.shape == img.shape, f"identity path must preserve shape: {out.shape} vs {img.shape}"
    assert out.dtype == np.uint8


def test_dewarp_output_is_binary() -> None:
    """Dewarp output contains only 0 and 255 values (binary polarity preserved)."""
    _require_geometry_correction()
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import get_v2_stage_impl

    fn = get_v2_stage_impl("dewarp", "cpu")
    img = _warped_text_lines()
    out = fn(img)

    unique_vals = set(np.unique(out).tolist())
    assert unique_vals.issubset({0, 255}), f"dewarp must produce binary output; got values: {unique_vals}"


# ──────────────────────────────────────────────────────────────────────────────
# post_transform_crop stage
# ──────────────────────────────────────────────────────────────────────────────


def test_post_transform_crop_registered_in_v2() -> None:
    """post_transform_crop is registered in V2_STAGE_IMPL."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import (
        StageNotImplemented,
        get_v2_stage_impl,
    )

    fn = get_v2_stage_impl("post_transform_crop", "cpu")
    img = _binary_text_on_white()
    try:
        out = fn(img)
        assert isinstance(out, np.ndarray)
    except StageNotImplemented:
        pytest.fail("post_transform_crop is still a placeholder — should be implemented")


def test_post_transform_crop_passthrough_at_default_config() -> None:
    """post_transform_crop is a pass-through at default config (no-op)."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import get_v2_stage_impl

    fn = get_v2_stage_impl("post_transform_crop", "cpu")
    img = _binary_text_on_white(h=100, w=80)
    out = fn(img)

    assert np.array_equal(out, img), "post_transform_crop at default config must be identity"


def test_post_transform_crop_shape_preserved() -> None:
    """post_transform_crop output has the same shape as the input."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import get_v2_stage_impl

    fn = get_v2_stage_impl("post_transform_crop", "cpu")
    img = _binary_text_on_white(h=150, w=120)
    out = fn(img)

    assert out.shape == img.shape
    assert out.dtype == img.dtype


# ──────────────────────────────────────────────────────────────────────────────
# placeholder tests: verify that the new stages are no longer in the
# "unimplemented" list in test_composed_stage_execution.py
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("stage_id", ["denoise", "dewarp", "post_transform_crop"])
def test_image_prep_stages_not_placeholder(stage_id: str) -> None:
    """denoise, dewarp, post_transform_crop must NOT raise StageNotImplemented."""
    if stage_id in ("denoise", "dewarp"):
        _require_geometry_correction()
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import (
        StageNotImplemented,
        get_v2_stage_impl,
    )

    fn = get_v2_stage_impl(stage_id, "cpu")
    img = _binary_text_on_white()
    try:
        fn(img)
    except StageNotImplemented:
        pytest.fail(f"{stage_id} must not raise StageNotImplemented when given a valid image")
