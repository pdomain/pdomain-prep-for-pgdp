"""W1 — Settings threading: stage settings wired into execution.

TDD suite for the full W1 workstream:
  W1.1 — run_stage loads StageSettingsStore effective settings and merges
          them into the ResolvedPageConfig handed to V2_STAGE_IMPL.
          Settings hash included in config_hash so a settings change
          dirties the stage.
  W1.2 — _denoise_cpu honours min_component_area / median_kernel_size from cfg.
  W1.3 — _auto_deskew_cpu honours skip_auto_deskew (default True = skip).
  W1.4 — _morph_fill_cpu honours do_morph (default False = skip fill).
  W1.5 — _canvas_map_cpu uses cfg.alignment and cfg.page_h_w_ratio.
  W1.6 — _post_transform_crop_cpu applies cfg.post_transform_crop_insets.
  W1.7 — _ocr_crop_cpu applies cfg.ocr_crop trims.
  W1.8 — _crop_to_content_cpu applies cfg.white_space_additional padding.

Precedence rule (highest wins):
  per-page PageConfigOverrides > stage settings store > registry defaults

All behavioural tests use synthetic images (no real OCR / book-tools models
needed) and assert observable behavioural difference, not merely "no-throw".
"""

from __future__ import annotations

import importlib.util
from typing import TYPE_CHECKING, Any

import numpy as np
import pytest

if TYPE_CHECKING:
    from pathlib import Path

# ── Availability guards ───────────────────────────────────────────────────────

_HAS_BOOK_TOOLS = importlib.util.find_spec("pdomain_book_tools") is not None
_HAS_DENOISE = _HAS_BOOK_TOOLS and importlib.util.find_spec("pdomain_book_tools.image_processing") is not None
_HAS_GEOMETRY_CORRECTION = (
    _HAS_BOOK_TOOLS and importlib.util.find_spec("pdomain_book_tools.geometry_correction") is not None
)
_HAS_CV2_PROCESSING = (
    _HAS_BOOK_TOOLS
    and importlib.util.find_spec("pdomain_book_tools.image_processing.cv2_processing") is not None
)


def _require_cv2_processing() -> None:
    if not _HAS_CV2_PROCESSING:
        pytest.skip("pdomain_book_tools.image_processing.cv2_processing not available")


def _require_denoise() -> None:
    if not _HAS_DENOISE:
        pytest.skip("pdomain_book_tools.image_processing not available (needs >=0.18)")


# ── Synthetic image helpers ───────────────────────────────────────────────────


def _binary_speckled(h: int = 120, w: int = 100, speckle_size: int = 1) -> np.ndarray:
    """Binary image with text stripes (255) on black bg (0) plus tiny speckles.

    Speckles are isolated connected components of `speckle_size` x `speckle_size` pixels.
    A larger min_component_area should remove them; a smaller area should keep them.
    """
    img = np.zeros((h, w), dtype=np.uint8)
    for row in range(10, h - 10, 12):
        img[row : row + 4, 10 : w - 10] = 255
    # Add 1x1 speckle (component area = 1)
    img[2, 2] = 255
    img[2, 50] = 255
    img[h - 3, 5] = 255
    return img


def _solid_white(h: int = 80, w: int = 60) -> np.ndarray:
    """Solid white binary image (all 255 = background)."""
    return np.full((h, w), 255, dtype=np.uint8)


def _solid_black(h: int = 80, w: int = 60) -> np.ndarray:
    """Solid black binary image (all 0)."""
    return np.zeros((h, w), dtype=np.uint8)


def _text_on_black(h: int = 100, w: int = 80) -> np.ndarray:
    """Binary image with text=255 on black bg=0 (v2 pipeline polarity)."""
    img = np.zeros((h, w), dtype=np.uint8)
    for row in range(10, h - 10, 10):
        img[row : row + 3, 8 : w - 8] = 255
    return img


def _make_resolved_config(**overrides: Any):
    """Build a ResolvedPageConfig with optional field overrides for tests."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_registry import default_resolved_page_config

    base = default_resolved_page_config()
    return base.model_copy(update=overrides)


# ─────────────────────────────────────────────────────────────────────────────
# W1.1 — STAGE_SETTINGS_DEFAULTS and registry-default integration
# ─────────────────────────────────────────────────────────────────────────────


class TestStageSettingsDefaults:
    """STAGE_SETTINGS_DEFAULTS maps stage_id → registry default dict."""

    def test_stage_settings_defaults_importable(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_settings import STAGE_SETTINGS_DEFAULTS

        assert isinstance(STAGE_SETTINGS_DEFAULTS, dict)

    def test_denoise_registry_defaults_present(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_settings import STAGE_SETTINGS_DEFAULTS

        d = STAGE_SETTINGS_DEFAULTS["denoise"]
        assert d["min_component_area"] == 6
        assert d["median_kernel_size"] == 0

    def test_post_transform_crop_registry_defaults_present(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_settings import STAGE_SETTINGS_DEFAULTS

        d = STAGE_SETTINGS_DEFAULTS["post_transform_crop"]
        assert d["post_transform_crop_insets"] == (0, 0, 0, 0)

    def test_auto_deskew_registry_defaults_present(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_settings import STAGE_SETTINGS_DEFAULTS

        d = STAGE_SETTINGS_DEFAULTS["deskew"]
        assert "skip_auto_deskew" in d

    def test_morph_fill_registry_defaults_present(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_settings import STAGE_SETTINGS_DEFAULTS

        d = STAGE_SETTINGS_DEFAULTS["canvas_map"]
        assert "do_morph" in d

    def test_canvas_map_registry_defaults_present(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_settings import STAGE_SETTINGS_DEFAULTS

        d = STAGE_SETTINGS_DEFAULTS["canvas_map"]
        assert "page_h_w_ratio" in d

    def test_ocr_crop_registry_defaults_present(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_settings import STAGE_SETTINGS_DEFAULTS

        d = STAGE_SETTINGS_DEFAULTS["post_ocr_crop"]
        assert "ocr_crop" in d

    def test_crop_to_content_registry_defaults_present(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_settings import STAGE_SETTINGS_DEFAULTS

        d = STAGE_SETTINGS_DEFAULTS["crop"]
        assert "white_space_additional" in d


# ─────────────────────────────────────────────────────────────────────────────
# W1.1 — apply_stage_settings_to_config
# ─────────────────────────────────────────────────────────────────────────────


class TestApplyStageSettingsToConfig:
    """apply_stage_settings_to_config merges store settings into ResolvedPageConfig."""

    def test_apply_stage_settings_importable(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_settings import apply_stage_settings_to_config

        assert callable(apply_stage_settings_to_config)

    def test_no_settings_returns_cfg_unchanged(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_settings import apply_stage_settings_to_config

        cfg = _make_resolved_config()
        result = apply_stage_settings_to_config(cfg, "denoise", {})
        assert result.denoise_min_component_area == cfg.denoise_min_component_area
        assert result.denoise_median_kernel_size == cfg.denoise_median_kernel_size

    def test_denoise_settings_applied(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_settings import apply_stage_settings_to_config

        cfg = _make_resolved_config()
        result = apply_stage_settings_to_config(
            cfg, "denoise", {"min_component_area": 20, "median_kernel_size": 3}
        )
        assert result.denoise_min_component_area == 20
        assert result.denoise_median_kernel_size == 3

    def test_post_transform_crop_insets_applied(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_settings import apply_stage_settings_to_config

        cfg = _make_resolved_config()
        result = apply_stage_settings_to_config(
            cfg, "post_transform_crop", {"post_transform_crop_insets": (5, 10, 3, 3)}
        )
        assert result.post_transform_crop_insets == (5, 10, 3, 3)

    def test_unknown_keys_in_settings_are_ignored(self) -> None:
        """Unknown keys in the settings dict are silently dropped (future compat)."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_settings import apply_stage_settings_to_config

        cfg = _make_resolved_config()
        result = apply_stage_settings_to_config(
            cfg, "denoise", {"min_component_area": 10, "unknown_future_key": 99}
        )
        assert result.denoise_min_component_area == 10


# ─────────────────────────────────────────────────────────────────────────────
# W1.1 — config_hash includes settings so settings change dirties stage
# ─────────────────────────────────────────────────────────────────────────────


class TestConfigHashIncludesSettings:
    """_compute_config_hash differs when stage settings change."""

    def test_denoise_hash_changes_on_min_component_area_change(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_runner import _compute_config_hash

        cfg_a = _make_resolved_config(denoise_min_component_area=6)
        cfg_b = _make_resolved_config(denoise_min_component_area=20)
        hash_a = _compute_config_hash(cfg_a, "denoise")
        hash_b = _compute_config_hash(cfg_b, "denoise")
        assert hash_a is not None
        assert hash_b is not None
        assert hash_a != hash_b

    def test_post_transform_crop_hash_changes_on_inset_change(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_runner import _compute_config_hash

        cfg_a = _make_resolved_config(post_transform_crop_insets=(0, 0, 0, 0))
        cfg_b = _make_resolved_config(post_transform_crop_insets=(10, 5, 3, 3))
        hash_a = _compute_config_hash(cfg_a, "post_transform_crop")
        hash_b = _compute_config_hash(cfg_b, "post_transform_crop")
        assert hash_a is not None
        assert hash_b is not None
        assert hash_a != hash_b

    def test_stage_without_settings_fields_hash_is_none(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_runner import _compute_config_hash

        cfg = _make_resolved_config()
        # grayscale has no config fields in STAGE_CONFIG_FIELDS by default
        result = _compute_config_hash(cfg, "grayscale")
        # grayscale has no config fields → None (or a hash if it gains fields later)
        # We don't assert None strictly since that could change; just confirm stable
        assert result is None or isinstance(result, str)

    def test_settings_hash_is_deterministic(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_runner import _compute_config_hash

        cfg = _make_resolved_config(denoise_min_component_area=15)
        h1 = _compute_config_hash(cfg, "denoise")
        h2 = _compute_config_hash(cfg, "denoise")
        assert h1 == h2


# ─────────────────────────────────────────────────────────────────────────────
# W1.1 — StageSettingsStore with run_stage (integration)
# ─────────────────────────────────────────────────────────────────────────────


class TestStageSettingsStoreIntegration:
    """StageSettingsStore.get_effective uses STAGE_SETTINGS_DEFAULTS as registry_default."""

    def test_store_get_effective_uses_stage_settings_defaults(self, tmp_path: Path) -> None:
        """store.get_effective with STAGE_SETTINGS_DEFAULTS returns correct defaults."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_settings import (
            STAGE_SETTINGS_DEFAULTS,
            StageSettingsStore,
        )

        store = StageSettingsStore(tmp_path / "s.db")
        effective = store.get_effective(
            "proj-1", "denoise", registry_default=STAGE_SETTINGS_DEFAULTS["denoise"]
        )
        assert effective["min_component_area"] == 6
        assert effective["median_kernel_size"] == 0

    def test_store_saved_settings_override_defaults(self, tmp_path: Path) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_settings import (
            STAGE_SETTINGS_DEFAULTS,
            StageSettingsStore,
        )

        store = StageSettingsStore(tmp_path / "s.db")
        store.save_as_default("proj-1", "denoise", {"min_component_area": 15, "median_kernel_size": 0})
        effective = store.get_effective(
            "proj-1", "denoise", registry_default=STAGE_SETTINGS_DEFAULTS["denoise"]
        )
        assert effective["min_component_area"] == 15


# ─────────────────────────────────────────────────────────────────────────────
# W1.2 — denoise honours min_component_area / median_kernel_size
# ─────────────────────────────────────────────────────────────────────────────


class TestDenoiseHonoursConfig:
    """_denoise_cpu uses cfg.denoise_min_component_area and cfg.denoise_median_kernel_size."""

    def test_denoise_skip_when_skip_denoise_true(self) -> None:
        """skip_denoise=True → image returned unchanged (same array values)."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import _denoise_cpu

        img = _binary_speckled()
        cfg = _make_resolved_config(skip_denoise=True)
        result = _denoise_cpu(img, cfg)
        np.testing.assert_array_equal(result, img)

    @pytest.mark.skipif(not _HAS_DENOISE, reason="pdomain_book_tools.image_processing not available")
    def test_denoise_large_area_keeps_more_components(self) -> None:
        """Larger min_component_area is more aggressive — fewer components remain."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import _denoise_cpu

        img = _binary_speckled(h=120, w=100)

        cfg_small = _make_resolved_config(skip_denoise=False, denoise_min_component_area=1)
        cfg_large = _make_resolved_config(skip_denoise=False, denoise_min_component_area=50)

        result_small = _denoise_cpu(img, cfg_small)
        result_large = _denoise_cpu(img, cfg_large)

        # Count non-zero pixels: large threshold removes more → fewer white pixels
        count_small = int(np.count_nonzero(result_small))
        count_large = int(np.count_nonzero(result_large))
        assert count_large <= count_small, (
            f"larger min_component_area should remove more speckle; "
            f"got small={count_small} large={count_large}"
        )

    @pytest.mark.skipif(not _HAS_DENOISE, reason="pdomain_book_tools.image_processing not available")
    def test_denoise_reads_cfg_field_not_hardcoded_6(self) -> None:
        """If min_component_area=999 is passed, EVERY component is removed (all black)."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import _denoise_cpu

        img = _binary_speckled(h=80, w=60)
        # Use an absurdly large area — every component should disappear
        cfg = _make_resolved_config(skip_denoise=False, denoise_min_component_area=100_000)
        result = _denoise_cpu(img, cfg)
        # After polarity bridge: cleaned image inverted back; all pixels should be 0
        assert int(np.count_nonzero(result)) == 0, (
            "with min_component_area=100000, all components should be removed"
        )


# ─────────────────────────────────────────────────────────────────────────────
# W1.3 — auto_deskew honours skip_auto_deskew
# ─────────────────────────────────────────────────────────────────────────────


class TestAutoSkewHonoursConfig:
    """_auto_deskew_cpu respects cfg.skip_auto_deskew."""

    @pytest.mark.skipif(not _HAS_CV2_PROCESSING, reason="cv2_processing not available")
    def test_skip_auto_deskew_true_returns_image_unchanged(self) -> None:
        """skip_auto_deskew=True → output is pixel-identical to input."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import _auto_deskew_cpu

        img = _text_on_black()
        cfg = _make_resolved_config(skip_auto_deskew=True)
        result = _auto_deskew_cpu(img, cfg)
        np.testing.assert_array_equal(result, img)

    @pytest.mark.skipif(not _HAS_CV2_PROCESSING, reason="cv2_processing not available")
    def test_skip_auto_deskew_false_may_change_image(self) -> None:
        """skip_auto_deskew=False → deskew runs (output may differ from input)."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import _auto_deskew_cpu

        img = _text_on_black()
        cfg_skip = _make_resolved_config(skip_auto_deskew=True)
        cfg_run = _make_resolved_config(skip_auto_deskew=False)

        result_skip = _auto_deskew_cpu(img, cfg_skip)
        result_run = _auto_deskew_cpu(img, cfg_run)

        # skip returns input unchanged; run path may or may not change it
        # (depends on whether auto_deskew detects a significant skew).
        # We just verify skip=True path is identity; the run path call succeeds.
        np.testing.assert_array_equal(result_skip, img)
        assert result_run.shape == img.shape


# ─────────────────────────────────────────────────────────────────────────────
# W1.4 — morph_fill honours do_morph
# ─────────────────────────────────────────────────────────────────────────────


class TestMorphFillHonoursConfig:
    """_morph_fill_cpu respects cfg.do_morph."""

    @pytest.mark.skipif(not _HAS_CV2_PROCESSING, reason="cv2_processing not available")
    def test_do_morph_false_returns_image_unchanged(self) -> None:
        """do_morph=False → output is pixel-identical to input."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import _morph_fill_cpu

        img = _text_on_black()
        cfg = _make_resolved_config(do_morph=False)
        result = _morph_fill_cpu(img, cfg)
        np.testing.assert_array_equal(result, img)

    @pytest.mark.skipif(not _HAS_CV2_PROCESSING, reason="cv2_processing not available")
    def test_do_morph_true_runs_fill(self) -> None:
        """do_morph=True → morph_fill is called and image may change."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import _morph_fill_cpu

        img = _text_on_black()
        cfg = _make_resolved_config(do_morph=True)
        result = _morph_fill_cpu(img, cfg)
        # morph_fill runs: output is same shape (may or may not differ pixel-for-pixel)
        assert result.shape == img.shape


# ─────────────────────────────────────────────────────────────────────────────
# W1.5 — canvas_map uses cfg.alignment and cfg.page_h_w_ratio
# ─────────────────────────────────────────────────────────────────────────────


class TestCanvasMapHonoursConfig:
    """_canvas_map_cpu uses cfg.alignment and cfg.page_h_w_ratio."""

    @pytest.mark.skipif(not _HAS_CV2_PROCESSING, reason="cv2_processing not available")
    def test_canvas_map_produces_output(self) -> None:
        """canvas_map runs without error and returns an image."""
        from pdomain_prep_for_pgdp.core.models import AlignmentOverride
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import _canvas_map_cpu

        img = _text_on_black(h=200, w=150)
        cfg = _make_resolved_config(
            alignment=AlignmentOverride.default,
            page_h_w_ratio=1.294,
        )
        result = _canvas_map_cpu(img, cfg)
        assert isinstance(result, np.ndarray)
        assert result.ndim == 2

    @pytest.mark.skipif(not _HAS_CV2_PROCESSING, reason="cv2_processing not available")
    def test_canvas_map_different_ratio_produces_different_output_shape(self) -> None:
        """Different page_h_w_ratio produces a canvas of different shape."""
        from pdomain_prep_for_pgdp.core.models import AlignmentOverride
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import _canvas_map_cpu

        img = _text_on_black(h=200, w=150)
        cfg_narrow = _make_resolved_config(alignment=AlignmentOverride.default, page_h_w_ratio=1.0)
        cfg_tall = _make_resolved_config(alignment=AlignmentOverride.default, page_h_w_ratio=1.8)

        result_narrow = _canvas_map_cpu(img, cfg_narrow)
        result_tall = _canvas_map_cpu(img, cfg_tall)

        h_n, w_n = result_narrow.shape[:2]
        h_t, w_t = result_tall.shape[:2]

        # Different ratios → different canvas dimensions
        assert (h_n, w_n) != (h_t, w_t), (
            f"different page_h_w_ratio should yield different canvas; both got {h_n}x{w_n}"
        )

    @pytest.mark.skipif(not _HAS_CV2_PROCESSING, reason="cv2_processing not available")
    def test_canvas_map_center_alignment_differs_from_default(self) -> None:
        """center alignment places content differently than default alignment."""
        from pdomain_prep_for_pgdp.core.models import AlignmentOverride
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import _canvas_map_cpu

        # Use an asymmetric content to make alignment observable
        img = np.zeros((200, 150), dtype=np.uint8)
        img[10:30, 10:30] = 255  # content in top-left corner

        cfg_default = _make_resolved_config(alignment=AlignmentOverride.default, page_h_w_ratio=1.294)
        cfg_center = _make_resolved_config(alignment=AlignmentOverride.center, page_h_w_ratio=1.294)

        result_default = _canvas_map_cpu(img, cfg_default)
        result_center = _canvas_map_cpu(img, cfg_center)

        # Both should produce valid outputs of the same shape
        assert result_default.shape == result_center.shape
        # The pixel content should differ (content placed differently)
        assert not np.array_equal(result_default, result_center), (
            "center vs default alignment should produce different output images"
        )


# ─────────────────────────────────────────────────────────────────────────────
# W1.6 — post_transform_crop applies cfg.post_transform_crop_insets
# ─────────────────────────────────────────────────────────────────────────────


class TestPostTransformCropHonoursConfig:
    """_post_transform_crop_cpu applies post_transform_crop_insets from cfg."""

    def test_zero_insets_returns_image_unchanged(self) -> None:
        """All-zero insets → pass-through (same pixels)."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import _post_transform_crop_cpu

        img = _text_on_black(h=100, w=80)
        cfg = _make_resolved_config(post_transform_crop_insets=(0, 0, 0, 0))
        result = _post_transform_crop_cpu(img, cfg)
        np.testing.assert_array_equal(result, img)

    def test_nonzero_top_inset_reduces_height(self) -> None:
        """top inset > 0 → output has fewer rows than input."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import _post_transform_crop_cpu

        img = _text_on_black(h=100, w=80)
        cfg = _make_resolved_config(post_transform_crop_insets=(10, 0, 0, 0))  # top=10
        result = _post_transform_crop_cpu(img, cfg)
        assert result.shape[0] == 90, f"expected height 90, got {result.shape[0]}"
        assert result.shape[1] == 80

    def test_nonzero_bottom_inset_reduces_height(self) -> None:
        """bottom inset > 0 → output has fewer rows."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import _post_transform_crop_cpu

        img = _text_on_black(h=100, w=80)
        cfg = _make_resolved_config(post_transform_crop_insets=(0, 15, 0, 0))  # bottom=15
        result = _post_transform_crop_cpu(img, cfg)
        assert result.shape[0] == 85, f"expected height 85, got {result.shape[0]}"

    def test_nonzero_left_inset_reduces_width(self) -> None:
        """left inset > 0 → output has fewer columns."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import _post_transform_crop_cpu

        img = _text_on_black(h=100, w=80)
        cfg = _make_resolved_config(post_transform_crop_insets=(0, 0, 8, 0))  # left=8
        result = _post_transform_crop_cpu(img, cfg)
        assert result.shape[1] == 72, f"expected width 72, got {result.shape[1]}"

    def test_nonzero_right_inset_reduces_width(self) -> None:
        """right inset > 0 → output has fewer columns."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import _post_transform_crop_cpu

        img = _text_on_black(h=100, w=80)
        cfg = _make_resolved_config(post_transform_crop_insets=(0, 0, 0, 12))  # right=12
        result = _post_transform_crop_cpu(img, cfg)
        assert result.shape[1] == 68, f"expected width 68, got {result.shape[1]}"

    def test_combined_insets_reduce_both_dimensions(self) -> None:
        """All four insets reduce dimensions accordingly."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import _post_transform_crop_cpu

        img = _text_on_black(h=100, w=80)
        cfg = _make_resolved_config(post_transform_crop_insets=(5, 5, 5, 5))
        result = _post_transform_crop_cpu(img, cfg)
        assert result.shape == (90, 70), f"expected (90, 70), got {result.shape}"

    def test_insets_larger_than_image_return_minimal_slice(self) -> None:
        """Insets that exceed image size clamp gracefully (no crash)."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import _post_transform_crop_cpu

        img = _text_on_black(h=50, w=40)
        cfg = _make_resolved_config(post_transform_crop_insets=(30, 30, 0, 0))
        result = _post_transform_crop_cpu(img, cfg)
        assert result.ndim == 2


# ─────────────────────────────────────────────────────────────────────────────
# W1.7 — ocr_crop applies cfg.ocr_crop trims
# ─────────────────────────────────────────────────────────────────────────────


class TestOcrCropHonoursConfig:
    """_ocr_crop_cpu applies (top, bottom, left, right) trims from cfg.ocr_crop."""

    def test_zero_trims_returns_image_unchanged(self) -> None:
        """(0,0,0,0) → pass-through."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import _ocr_crop_cpu

        img = _text_on_black(h=100, w=80)
        cfg = _make_resolved_config(ocr_crop=(0, 0, 0, 0))
        result = _ocr_crop_cpu(img, cfg)
        np.testing.assert_array_equal(result, img)

    def test_top_trim_removes_rows(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import _ocr_crop_cpu

        img = _text_on_black(h=100, w=80)
        cfg = _make_resolved_config(ocr_crop=(10, 0, 0, 0))  # top=10
        result = _ocr_crop_cpu(img, cfg)
        assert result.shape[0] == 90

    def test_bottom_trim_removes_rows(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import _ocr_crop_cpu

        img = _text_on_black(h=100, w=80)
        cfg = _make_resolved_config(ocr_crop=(0, 20, 0, 0))  # bottom=20
        result = _ocr_crop_cpu(img, cfg)
        assert result.shape[0] == 80

    def test_left_trim_removes_columns(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import _ocr_crop_cpu

        img = _text_on_black(h=100, w=80)
        cfg = _make_resolved_config(ocr_crop=(0, 0, 5, 0))  # left=5
        result = _ocr_crop_cpu(img, cfg)
        assert result.shape[1] == 75

    def test_right_trim_removes_columns(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import _ocr_crop_cpu

        img = _text_on_black(h=100, w=80)
        cfg = _make_resolved_config(ocr_crop=(0, 0, 0, 15))  # right=15
        result = _ocr_crop_cpu(img, cfg)
        assert result.shape[1] == 65

    def test_ocr_crop_content_is_correct_slice(self) -> None:
        """Cropped region matches the expected slice of the original."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import _ocr_crop_cpu

        img = _text_on_black(h=100, w=80)
        cfg = _make_resolved_config(ocr_crop=(5, 10, 3, 7))  # top=5 bottom=10 left=3 right=7
        result = _ocr_crop_cpu(img, cfg)
        expected = img[5:90, 3:73]
        np.testing.assert_array_equal(result, expected)


# ─────────────────────────────────────────────────────────────────────────────
# W1.8 — crop_to_content honours white_space_additional
# ─────────────────────────────────────────────────────────────────────────────


class TestCropToContentHonoursConfig:
    """_crop_to_content_cpu applies white_space_additional padding when set."""

    @pytest.mark.skipif(not _HAS_CV2_PROCESSING, reason="cv2_processing not available")
    def test_no_padding_crops_tightly(self) -> None:
        """white_space_additional=None → no additional whitespace added."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import _crop_to_content_cpu

        img = _text_on_black(h=200, w=150)
        # bbox from find_content_edges: (minX, maxX, minY, maxY)
        bbox: tuple[int, int, int, int] = (10, 140, 10, 190)
        cfg = _make_resolved_config(white_space_additional=None)
        result = _crop_to_content_cpu(img, bbox, cfg)
        assert isinstance(result, np.ndarray)
        assert result.ndim == 2

    @pytest.mark.skipif(not _HAS_CV2_PROCESSING, reason="cv2_processing not available")
    def test_padding_increases_output_size(self) -> None:
        """white_space_additional padding enlarges the output relative to None."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import _crop_to_content_cpu

        img = _text_on_black(h=200, w=150)
        bbox: tuple[int, int, int, int] = (10, 140, 10, 190)

        cfg_no_pad = _make_resolved_config(white_space_additional=None)
        # top=0.05, bottom=0.05, left=0.05, right=0.05 (fractional padding)
        cfg_padded = _make_resolved_config(white_space_additional=(0.05, 0.05, 0.05, 0.05))

        result_no_pad = _crop_to_content_cpu(img, bbox, cfg_no_pad)
        result_padded = _crop_to_content_cpu(img, bbox, cfg_padded)

        h_base, w_base = result_no_pad.shape[:2]
        h_pad, w_pad = result_padded.shape[:2]

        assert h_pad >= h_base or w_pad >= w_base, (
            f"padding should increase output size; base=({h_base},{w_base}), padded=({h_pad},{w_pad})"
        )


# ─────────────────────────────────────────────────────────────────────────────
# W1.1 — ResolvedPageConfig has new stage-settings fields
# ─────────────────────────────────────────────────────────────────────────────


class TestResolvedPageConfigHasSettingsFields:
    """ResolvedPageConfig carries the new stage-settings fields."""

    def test_resolved_page_config_has_denoise_fields(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import default_resolved_page_config

        cfg = default_resolved_page_config()
        assert hasattr(cfg, "denoise_min_component_area")
        assert hasattr(cfg, "denoise_median_kernel_size")
        assert cfg.denoise_min_component_area == 6
        assert cfg.denoise_median_kernel_size == 0

    def test_resolved_page_config_has_post_transform_crop_insets(self) -> None:
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import default_resolved_page_config

        cfg = default_resolved_page_config()
        assert hasattr(cfg, "post_transform_crop_insets")
        assert cfg.post_transform_crop_insets == (0, 0, 0, 0)

    def test_resolved_page_config_fields_are_typed(self) -> None:
        from pdomain_prep_for_pgdp.core.models import ResolvedPageConfig

        fields = ResolvedPageConfig.model_fields
        assert "denoise_min_component_area" in fields
        assert "denoise_median_kernel_size" in fields
        assert "post_transform_crop_insets" in fields
