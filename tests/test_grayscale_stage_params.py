"""TDD tests for Wave-2 grayscale stage parameter wiring.

Tests:
1. _grayscale_cpu with cfg carrying grayscale_mode/params → calls to_grayscale
2. _grayscale_cpu without cfg → fallback path (returns 2D grayscale)
3. apply_stage_settings_to_config correctly threads grayscale settings into cfg fields
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from pdomain_prep_for_pgdp.core.pipeline.stage_registry import _grayscale_cpu
from pdomain_prep_for_pgdp.core.pipeline.stage_settings import (
    STAGE_SETTINGS_DEFAULTS,
    apply_stage_settings_to_config,
)

if TYPE_CHECKING:
    pass


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_bgr_image(h: int = 64, w: int = 64) -> np.ndarray:
    """Return a synthetic 3-channel BGR uint8 image."""
    rng = np.random.default_rng(42)
    return rng.integers(0, 255, (h, w, 3), dtype=np.uint8)


def make_cfg(**kwargs):  # type: ignore[no-untyped-def]
    """Build a minimal ResolvedPageConfig with grayscale Wave-2 fields set."""
    from pdomain_prep_for_pgdp.core.models import AlignmentOverride, PageType, ResolvedPageConfig

    # Build with required fields using sensible defaults; override with kwargs.
    defaults = {
        "text_threshold": 128,
        "page_h_w_ratio": 1.294,
        "fuzzy_pct": 0.8,
        "pixel_count_columns": 2,
        "pixel_count_rows": 2,
        "ocr_bbox_edge_min_words": 3,
        "ocr_engine": "doctr",
        "ocr_model_key": None,
        "ocr_dpi": 300,
        "initial_crop_all": (0, 0, 0, 0),
        "ocr_crop": (0, 0, 0, 0),
        "page_type": PageType.normal,
        "alignment": AlignmentOverride.default,
        "initial_crop": None,
        "white_space_additional": None,
        "threshold_level": None,
        "skip_auto_deskew": True,
        "deskew_before_crop": None,
        "deskew_after_crop": None,
        "do_morph": False,
        "skip_denoise": False,
        "use_ocr_bbox_edge": False,
        "rotated_standard": False,
        "single_dimension_rescale": False,
        "flip_horizontal": False,
        "flip_vertical": False,
    }
    defaults.update(kwargs)
    return ResolvedPageConfig(**defaults)


# ---------------------------------------------------------------------------
# Suite 1: _grayscale_cpu calls to_grayscale when available
# ---------------------------------------------------------------------------


class TestGrayscaleCpuWithParams:
    """_grayscale_cpu passes Wave-2 params to to_grayscale when available."""

    def test_calls_to_grayscale_with_mode_and_params(self) -> None:
        """When to_grayscale is available, it is called with cfg params."""
        image = make_bgr_image()
        expected_out = np.zeros((64, 64), dtype=np.uint8)

        cfg = make_cfg(
            grayscale_mode="standard",
            grayscale_sampler_radius=5,
            grayscale_gamma=1.0,
            grayscale_output_range_min=0,
            grayscale_output_range_max=255,
        )

        mock_to_grayscale = MagicMock(return_value=expected_out)

        def fake_load_attr(module_path: str, attr_name: str) -> object:
            if attr_name == "to_grayscale":
                return mock_to_grayscale
            raise AttributeError(f"unexpected attr: {attr_name}")

        with patch(
            "pdomain_prep_for_pgdp.core.pipeline.stage_registry._load_attr",
            side_effect=fake_load_attr,
        ):
            result = _grayscale_cpu(image, cfg)

        assert result is expected_out
        mock_to_grayscale.assert_called_once_with(
            image,
            mode="standard",
            sampler_radius=5,
            gamma=1.0,
            output_range=(0, 255),
        )

    def test_calls_to_grayscale_with_perceptual_mode_defaults(self) -> None:
        """Perceptual mode uses the Wave-2 defaults from cfg."""
        image = make_bgr_image()
        expected_out = np.zeros((64, 64), dtype=np.uint8)

        cfg = make_cfg()  # uses default field values: perceptual, radius=3, gamma=1.1, 12/248

        mock_to_grayscale = MagicMock(return_value=expected_out)

        def fake_load_attr(module_path: str, attr_name: str) -> object:
            if attr_name == "to_grayscale":
                return mock_to_grayscale
            raise AttributeError(f"unexpected attr: {attr_name}")

        with patch(
            "pdomain_prep_for_pgdp.core.pipeline.stage_registry._load_attr",
            side_effect=fake_load_attr,
        ):
            result = _grayscale_cpu(image, cfg)

        assert result is expected_out
        mock_to_grayscale.assert_called_once_with(
            image,
            mode="perceptual",
            sampler_radius=3,
            gamma=1.1,
            output_range=(12, 248),
        )

    def test_output_is_2d_when_to_grayscale_not_available(self) -> None:
        """Fallback path: cv2_convert_to_grayscale returns 2D grayscale."""
        image = make_bgr_image()

        def fake_load_attr(module_path: str, attr_name: str) -> object:
            if attr_name == "to_grayscale":
                raise AttributeError("to_grayscale not in this version")
            if attr_name == "cv2_convert_to_grayscale":
                import cv2

                def _cv2_gray(img):  # type: ignore[no-untyped-def]
                    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

                return _cv2_gray
            raise AttributeError(f"unexpected attr: {attr_name}")

        with patch(
            "pdomain_prep_for_pgdp.core.pipeline.stage_registry._load_attr",
            side_effect=fake_load_attr,
        ):
            result = _grayscale_cpu(image)

        assert result.ndim == 2, "fallback must return 2D (H, W) grayscale"
        assert result.shape == (64, 64)

    def test_fallback_when_to_grayscale_raises_attribute_error(self) -> None:
        """Fallback path used when to_grayscale raises AttributeError."""
        image = make_bgr_image()
        fallback_output = np.zeros((64, 64), dtype=np.uint8)
        mock_legacy = MagicMock(return_value=fallback_output)

        def fake_load_attr(module_path: str, attr_name: str) -> object:
            if attr_name == "to_grayscale":
                raise AttributeError("not found")
            if attr_name == "cv2_convert_to_grayscale":
                return mock_legacy
            raise AttributeError(f"unexpected attr: {attr_name}")

        with patch(
            "pdomain_prep_for_pgdp.core.pipeline.stage_registry._load_attr",
            side_effect=fake_load_attr,
        ):
            result = _grayscale_cpu(image, None)

        assert result is fallback_output
        mock_legacy.assert_called_once_with(image)

    def test_no_cfg_uses_built_in_defaults(self) -> None:
        """When cfg=None, to_grayscale is called with hard-coded defaults."""
        image = make_bgr_image()
        expected_out = np.zeros((64, 64), dtype=np.uint8)
        mock_to_grayscale = MagicMock(return_value=expected_out)

        def fake_load_attr(module_path: str, attr_name: str) -> object:
            if attr_name == "to_grayscale":
                return mock_to_grayscale
            raise AttributeError(f"unexpected attr: {attr_name}")

        with patch(
            "pdomain_prep_for_pgdp.core.pipeline.stage_registry._load_attr",
            side_effect=fake_load_attr,
        ):
            result = _grayscale_cpu(image, None)

        assert result is expected_out
        mock_to_grayscale.assert_called_once_with(
            image,
            mode="perceptual",
            sampler_radius=3,
            gamma=1.1,
            output_range=(12, 248),
        )


# ---------------------------------------------------------------------------
# Suite 2: apply_stage_settings_to_config for grayscale
# ---------------------------------------------------------------------------


class TestApplyStageSettingsGrayscale:
    """apply_stage_settings_to_config correctly maps grayscale settings to cfg."""

    def test_grayscale_defaults_in_registry(self) -> None:
        """STAGE_SETTINGS_DEFAULTS includes the Wave-2 grayscale entry."""
        assert "grayscale" in STAGE_SETTINGS_DEFAULTS
        gd = STAGE_SETTINGS_DEFAULTS["grayscale"]
        assert gd["mode"] == "perceptual"
        assert gd["sampler_radius"] == 3
        assert gd["gamma"] == 1.1
        assert gd["output_range_min"] == 12
        assert gd["output_range_max"] == 248

    def test_mode_applied_to_grayscale_mode_field(self) -> None:
        """'mode' key → grayscale_mode field on ResolvedPageConfig."""
        cfg = make_cfg()
        assert cfg.grayscale_mode == "perceptual"  # default

        result = apply_stage_settings_to_config(cfg, "grayscale", {"mode": "standard"})
        assert result.grayscale_mode == "standard"
        assert result is not cfg  # model_copy returns new object

    def test_sampler_radius_applied(self) -> None:
        """'sampler_radius' key → grayscale_sampler_radius field."""
        cfg = make_cfg()
        result = apply_stage_settings_to_config(cfg, "grayscale", {"sampler_radius": 7})
        assert result.grayscale_sampler_radius == 7

    def test_gamma_applied(self) -> None:
        """'gamma' key → grayscale_gamma field."""
        cfg = make_cfg()
        result = apply_stage_settings_to_config(cfg, "grayscale", {"gamma": 1.4})
        assert result.grayscale_gamma == pytest.approx(1.4)

    def test_output_range_min_applied(self) -> None:
        """'output_range_min' key → grayscale_output_range_min field."""
        cfg = make_cfg()
        result = apply_stage_settings_to_config(cfg, "grayscale", {"output_range_min": 5})
        assert result.grayscale_output_range_min == 5

    def test_output_range_max_applied(self) -> None:
        """'output_range_max' key → grayscale_output_range_max field."""
        cfg = make_cfg()
        result = apply_stage_settings_to_config(cfg, "grayscale", {"output_range_max": 240})
        assert result.grayscale_output_range_max == 240

    def test_full_grayscale_settings_dict(self) -> None:
        """All 5 grayscale keys applied together."""
        cfg = make_cfg()
        effective = {
            "mode": "standard",
            "sampler_radius": 1,
            "gamma": 1.0,
            "output_range_min": 0,
            "output_range_max": 255,
        }
        result = apply_stage_settings_to_config(cfg, "grayscale", effective)
        assert result.grayscale_mode == "standard"
        assert result.grayscale_sampler_radius == 1
        assert result.grayscale_gamma == pytest.approx(1.0)
        assert result.grayscale_output_range_min == 0
        assert result.grayscale_output_range_max == 255

    def test_unknown_key_ignored(self) -> None:
        """Unknown key in settings dict does not crash."""
        cfg = make_cfg()
        result = apply_stage_settings_to_config(
            cfg, "grayscale", {"mode": "standard", "unknown_future_key": 999}
        )
        assert result.grayscale_mode == "standard"

    def test_mode_key_ignored_for_other_stages(self) -> None:
        """'mode' key is NOT applied for stages that don't declare it in their defaults."""
        cfg = make_cfg()
        # 'denoise' stage doesn't have 'mode' in its defaults
        result = apply_stage_settings_to_config(
            cfg, "denoise", {"mode": "standard", "min_component_area": 10}
        )
        # grayscale_mode should be unchanged
        assert result.grayscale_mode == "perceptual"
        # but known denoise key should be applied
        assert result.denoise_min_component_area == 10
