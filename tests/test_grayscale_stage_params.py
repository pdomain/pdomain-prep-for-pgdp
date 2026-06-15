"""TDD tests for Wave-2 grayscale stage parameter wiring.

Tests:
1. _grayscale_cpu with cfg carrying grayscale_mode/params → calls to_grayscale
2. _grayscale_cpu missing to_grayscale → fail-loud RuntimeError (not silent fallback)
3. apply_stage_settings_to_config correctly threads grayscale settings into cfg fields
4. Real byte-differential: different param sets produce pixel-distinct output
   (uses the REAL pdomain_book_tools.to_grayscale, no mocking)
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
    """_grayscale_cpu calls run_grayscale_pipeline with the cfg.grayscale config."""

    def test_calls_run_grayscale_pipeline_with_cfg_grayscale(self) -> None:
        """run_grayscale_pipeline is called with config from cfg.grayscale."""
        from pdomain_prep_for_pgdp.core.models import GrayscaleConfigModel

        image = make_bgr_image()
        expected_out = np.zeros((64, 64), dtype=np.uint8)

        cfg = make_cfg(
            grayscale=GrayscaleConfigModel(converter="best_channel", channel="green"),
        )

        mock_pipeline = MagicMock(return_value=expected_out)
        mock_config_cls = MagicMock()
        mock_config_instance = MagicMock()
        mock_config_cls.from_dict.return_value = mock_config_instance

        def fake_load_attr(module_path: str, attr_name: str) -> object:
            if attr_name == "run_grayscale_pipeline":
                return mock_pipeline
            if attr_name == "GrayscaleConfig":
                return mock_config_cls
            raise AttributeError(f"unexpected attr: {attr_name}")

        with patch(
            "pdomain_prep_for_pgdp.core.pipeline.stage_registry._load_attr",
            side_effect=fake_load_attr,
        ):
            result = _grayscale_cpu(image, cfg)

        assert result is expected_out
        # GrayscaleConfig.from_dict must be called with the model_dump of cfg.grayscale
        mock_config_cls.from_dict.assert_called_once_with(cfg.grayscale.model_dump())
        # run_grayscale_pipeline must be called with image + config + use_gpu=False
        mock_pipeline.assert_called_once_with(image, mock_config_instance, use_gpu=False)

    def test_calls_run_grayscale_pipeline_with_default_cfg_grayscale(self) -> None:
        """Default cfg.grayscale (luma converter) is forwarded to run_grayscale_pipeline."""
        from pdomain_prep_for_pgdp.core.models import GrayscaleConfigModel

        image = make_bgr_image()
        expected_out = np.zeros((64, 64), dtype=np.uint8)

        cfg = make_cfg()  # default GrayscaleConfigModel() → converter=luma
        default_dump = GrayscaleConfigModel().model_dump()

        mock_pipeline = MagicMock(return_value=expected_out)
        mock_config_cls = MagicMock()
        mock_config_instance = MagicMock()
        mock_config_cls.from_dict.return_value = mock_config_instance

        def fake_load_attr(module_path: str, attr_name: str) -> object:
            if attr_name == "run_grayscale_pipeline":
                return mock_pipeline
            if attr_name == "GrayscaleConfig":
                return mock_config_cls
            raise AttributeError(f"unexpected attr: {attr_name}")

        with patch(
            "pdomain_prep_for_pgdp.core.pipeline.stage_registry._load_attr",
            side_effect=fake_load_attr,
        ):
            result = _grayscale_cpu(image, cfg)

        assert result is expected_out
        mock_config_cls.from_dict.assert_called_once_with(default_dump)
        mock_pipeline.assert_called_once_with(image, mock_config_instance, use_gpu=False)

    def test_raises_runtime_error_when_run_grayscale_pipeline_missing(self) -> None:
        """Fail-loud: RuntimeError is raised when run_grayscale_pipeline is absent.

        A downgrade below pdomain-book-tools >= 0.21.0 must surface immediately
        rather than silently discarding all grayscale tuning parameters.
        """
        image = make_bgr_image()

        def fake_load_attr(module_path: str, attr_name: str) -> object:
            raise AttributeError(f"{attr_name} not in this version")

        with (
            patch(
                "pdomain_prep_for_pgdp.core.pipeline.stage_registry._load_attr",
                side_effect=fake_load_attr,
            ),
            pytest.raises(RuntimeError, match=r"pdomain-book-tools"),
        ):
            _grayscale_cpu(image)

    def test_raises_runtime_error_preserves_original_attribute_error(self) -> None:
        """RuntimeError raised from AttributeError chains the original exc."""
        image = make_bgr_image()

        def fake_load_attr(module_path: str, attr_name: str) -> object:
            raise AttributeError("not found")

        with (
            patch(
                "pdomain_prep_for_pgdp.core.pipeline.stage_registry._load_attr",
                side_effect=fake_load_attr,
            ),
            pytest.raises(RuntimeError) as exc_info,
        ):
            _grayscale_cpu(image, None)
        # __cause__ should be the original AttributeError (raised from exc)
        assert isinstance(exc_info.value.__cause__, AttributeError)

    def test_no_cfg_uses_default_grayscale_config(self) -> None:
        """When cfg=None, run_grayscale_pipeline is called with GrayscaleConfig()."""
        image = make_bgr_image()
        expected_out = np.zeros((64, 64), dtype=np.uint8)

        mock_pipeline = MagicMock(return_value=expected_out)
        mock_config_cls = MagicMock()
        mock_default_instance = MagicMock()
        mock_config_cls.return_value = mock_default_instance  # GrayscaleConfig() call

        def fake_load_attr(module_path: str, attr_name: str) -> object:
            if attr_name == "run_grayscale_pipeline":
                return mock_pipeline
            if attr_name == "GrayscaleConfig":
                return mock_config_cls
            raise AttributeError(f"unexpected attr: {attr_name}")

        with patch(
            "pdomain_prep_for_pgdp.core.pipeline.stage_registry._load_attr",
            side_effect=fake_load_attr,
        ):
            result = _grayscale_cpu(image, None)

        assert result is expected_out
        # When cfg is None, GrayscaleConfig() (no args) must be used
        mock_config_cls.assert_called_once_with()
        mock_pipeline.assert_called_once_with(image, mock_default_instance, use_gpu=False)


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


# ---------------------------------------------------------------------------
# Suite 3: Real byte-differential — params reach the real primitive
# ---------------------------------------------------------------------------


class TestGrayscaleRealByteDiff:
    """Prove that different GrayscaleConfigModel settings produce pixel-distinct output.

    Uses the REAL pdomain_book_tools.run_grayscale_pipeline — no mocking of the
    core function.  This is the committed proof that tuning parameters via
    cfg.grayscale actually reach the pipeline and change the resulting image bytes,
    not just that the call happens.
    """

    @staticmethod
    def _make_colorful_image(h: int = 128, w: int = 128) -> np.ndarray:
        """Return a synthetic BGR image with strong per-pixel variation.

        A uniform (solid) image collapses to a single luma value, which the
        output_range normalisation maps to the same byte regardless of converter.
        We need spatial variation so each converter's distinct channel-weight
        formula produces a *different* per-pixel distribution.  A deterministic
        random array with seed 123 is used so the test is reproducible.
        """
        rng = np.random.default_rng(123)
        return rng.integers(0, 255, (h, w, 3), dtype=np.uint8)

    def test_luma_vs_best_channel_produce_different_pixels(self) -> None:
        """luma converter vs best_channel/green produce distinct pixel outputs.

        Param set A (luma): converter=luma (weighted BT.601 combination)
        Param set B (best_channel/green): converter=best_channel, channel=green

        These must differ on any image where the green channel differs from
        the BT.601 luma, which is virtually any natural image.
        """
        from pdomain_prep_for_pgdp.core.models import GrayscaleConfigModel

        image = self._make_colorful_image()

        cfg_a = make_cfg(
            grayscale=GrayscaleConfigModel(converter="luma"),
        )
        cfg_b = make_cfg(
            grayscale=GrayscaleConfigModel(converter="best_channel", channel="green"),
        )

        result_a = _grayscale_cpu(image, cfg_a)
        result_b = _grayscale_cpu(image, cfg_b)

        assert result_a.ndim == 2, f"expected 2D output, got shape {result_a.shape}"
        assert result_b.ndim == 2, f"expected 2D output, got shape {result_b.shape}"
        assert result_a.shape == result_b.shape, f"shape mismatch: {result_a.shape} vs {result_b.shape}"

        diff = np.abs(result_a.astype(int) - result_b.astype(int))
        mean_diff = float(diff.mean())
        changed_pixels = int((diff > 0).sum())

        # Commit the proof: cfg.grayscale params must reach the real pipeline and
        # change output.  The threshold is deliberately low — even 1 changed pixel
        # falsifies the "params are silently dropped" hypothesis.
        assert changed_pixels > 0, (
            f"PARAMS IGNORED: luma and best_channel/green produced identical output "
            f"(mean_diff={mean_diff:.4f}, changed_pixels={changed_pixels})"
        )

        # Log the magnitude so it's visible in verbose pytest output.
        import sys

        print(
            f"\n  byte-diff proof: mean_abs_diff={mean_diff:.2f}, "
            f"changed_pixels={changed_pixels}/{result_a.size} "
            f"({100 * changed_pixels / result_a.size:.1f}%)",
            file=sys.stderr,
        )


# ---------------------------------------------------------------------------
# Suite 4: Task 1.2 — _grayscale_cpu calls run_grayscale_pipeline via cfg.grayscale
# ---------------------------------------------------------------------------


class TestGrayscaleCpuRunsPipeline:
    """_grayscale_cpu reads cfg.grayscale and calls run_grayscale_pipeline.

    These tests prove the migration from to_grayscale + flat fields to
    run_grayscale_pipeline + GrayscaleConfigModel.  They use the REAL
    book-tools pipeline — no mocking — so parameter propagation is proven
    by observable pixel differences, not call-site assertions.
    """

    @staticmethod
    def _make_distinct_bgr(h: int = 64, w: int = 64) -> np.ndarray:
        """Build a BGR image where each channel has clearly distinct values.

        B channel: low values (0-63)
        G channel: mid values (100-163)
        R channel: high values (200-255)
        This ensures best_channel/green output differs visibly from luma output.
        """
        rng = np.random.default_rng(77)
        img = np.zeros((h, w, 3), dtype=np.uint8)
        img[:, :, 0] = rng.integers(0, 64, (h, w), dtype=np.uint8)  # B
        img[:, :, 1] = rng.integers(100, 164, (h, w), dtype=np.uint8)  # G
        img[:, :, 2] = rng.integers(200, 255, (h, w), dtype=np.uint8)  # R
        return img

    def test_best_channel_green_equals_green_channel(self) -> None:
        """cfg.grayscale(converter=best_channel, channel=green) → output == green channel.

        Proof that the config reaches run_grayscale_pipeline: best_channel picks
        the channel specified (green = BGR index 1) and returns it verbatim.
        """
        from pdomain_prep_for_pgdp.core.models import GrayscaleConfigModel

        image = self._make_distinct_bgr()
        cfg = make_cfg(
            grayscale=GrayscaleConfigModel(converter="best_channel", channel="green"),
        )

        result = _grayscale_cpu(image, cfg)

        assert result.ndim == 2, f"expected 2D grayscale output, got shape {result.shape}"
        assert result.shape == image.shape[:2], f"shape mismatch: {result.shape} vs {image.shape[:2]}"
        # best_channel/green must return the green channel (BGR index 1) verbatim
        np.testing.assert_array_equal(
            result,
            image[:, :, 1],
            err_msg="best_channel/green output does not equal the green channel pixel-for-pixel",
        )

    def test_byte_diff_luma_vs_best_channel(self) -> None:
        """Two different GrayscaleConfigModel configs produce distinct output bytes.

        Config A: converter=luma (weighted BT.601 luma from all channels)
        Config B: converter=best_channel, channel=green (just the green channel)

        With distinct per-channel values the two outputs must differ.
        """
        import sys

        from pdomain_prep_for_pgdp.core.models import GrayscaleConfigModel

        image = self._make_distinct_bgr()

        cfg_a = make_cfg(
            grayscale=GrayscaleConfigModel(converter="luma", channel="green"),
        )
        cfg_b = make_cfg(
            grayscale=GrayscaleConfigModel(converter="best_channel", channel="green"),
        )

        result_a = _grayscale_cpu(image, cfg_a)
        result_b = _grayscale_cpu(image, cfg_b)

        assert result_a.shape == result_b.shape, f"shape mismatch: {result_a.shape} vs {result_b.shape}"

        diff = np.abs(result_a.astype(int) - result_b.astype(int))
        changed_pixels = int((diff > 0).sum())

        assert changed_pixels > 0, (
            "BYTE-DIFF FAILED: luma and best_channel/green produced identical output "
            "(cfg.grayscale is being silently ignored)"
        )

        print(
            f"\n  Task-1.2 byte-diff: changed_pixels={changed_pixels}/{result_a.size} "
            f"({100 * changed_pixels / result_a.size:.1f}%)",
            file=sys.stderr,
        )
