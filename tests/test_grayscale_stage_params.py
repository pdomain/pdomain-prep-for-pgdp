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
# Suite 2: apply_stage_settings_to_config for grayscale  (Task 1.3 updated)
# ---------------------------------------------------------------------------
#
# Task 1.3 migrated the grayscale stage from flat-field assignment to nested
# GrayscaleConfigModel assignment via migrate_grayscale_settings + from_settings.
# Tests below reflect the new contract: effective_settings → cfg.grayscale,
# with legacy flat-field dicts automatically migrated.


class TestApplyStageSettingsGrayscale:
    """apply_stage_settings_to_config maps grayscale settings to cfg.grayscale."""

    def test_grayscale_defaults_in_registry(self) -> None:
        """STAGE_SETTINGS_DEFAULTS includes the Wave-2 grayscale entry with nested shape."""
        assert "grayscale" in STAGE_SETTINGS_DEFAULTS
        gd = STAGE_SETTINGS_DEFAULTS["grayscale"]
        # Task 1.3: nested pipeline shape replaces legacy flat keys
        assert gd.get("converter") == "luma"
        assert "flatten" in gd
        assert gd["flatten"]["enabled"] is False
        assert "clahe" in gd
        assert gd["clahe"]["enabled"] is False
        assert gd.get("output_range") is None
        # Legacy flat keys must NOT be present
        assert "mode" not in gd
        assert "gamma" not in gd
        assert "sampler_radius" not in gd

    def test_nested_converter_applied_to_cfg_grayscale(self) -> None:
        """Nested settings dict (with 'converter' key) → cfg.grayscale.converter."""
        cfg = make_cfg()
        result = apply_stage_settings_to_config(
            cfg, "grayscale", {"converter": "lab_l", "output_range": None}
        )
        assert result.grayscale.converter == "lab_l"
        assert result is not cfg  # model_copy returns new object

    def test_legacy_perceptual_mode_migrated_to_luma_bt709(self) -> None:
        """Legacy mode='perceptual' in effective_settings → cfg.grayscale.converter='luma_bt709'."""
        cfg = make_cfg()
        result = apply_stage_settings_to_config(
            cfg, "grayscale", {"mode": "perceptual", "gamma": 1.1, "sampler_radius": 3}
        )
        assert result.grayscale.converter == "luma_bt709"

    def test_legacy_standard_mode_migrated_to_luma(self) -> None:
        """Legacy mode='standard' in effective_settings → cfg.grayscale.converter='luma'."""
        cfg = make_cfg()
        result = apply_stage_settings_to_config(cfg, "grayscale", {"mode": "standard", "gamma": 1.0})
        assert result.grayscale.converter == "luma"

    def test_legacy_output_range_migrated(self) -> None:
        """Legacy output_range_min/max in effective_settings → cfg.grayscale.output_range."""
        cfg = make_cfg()
        result = apply_stage_settings_to_config(
            cfg,
            "grayscale",
            {"mode": "perceptual", "output_range_min": 12, "output_range_max": 248},
        )
        assert result.grayscale.output_range == [12, 248]

    def test_unknown_nested_key_does_not_crash(self) -> None:
        """Unknown key alongside converter key does not crash (unknown_future_key ignored by from_settings)."""
        cfg = make_cfg()
        result = apply_stage_settings_to_config(
            cfg, "grayscale", {"converter": "luma", "unknown_future_key": 999}
        )
        assert result.grayscale.converter == "luma"

    def test_mode_key_ignored_for_other_stages(self) -> None:
        """'mode' key is NOT applied for stages that don't declare it in their defaults."""
        cfg = make_cfg()
        # 'denoise' stage doesn't have 'mode' in its defaults
        result = apply_stage_settings_to_config(
            cfg, "denoise", {"mode": "standard", "min_component_area": 10}
        )
        # grayscale must be unchanged
        assert result.grayscale.converter == "luma"
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


# ---------------------------------------------------------------------------
# Suite 5: Task 2.2 — _grayscale_gpu parity + registration
# ---------------------------------------------------------------------------


try:
    import cupy as _cupy  # noqa: F401

    _CUPY_AVAILABLE = True
except ImportError:
    _CUPY_AVAILABLE = False


@pytest.mark.skipif(not _CUPY_AVAILABLE, reason="cupy not installed")
class TestGrayscaleGpuImpl:
    """_grayscale_gpu produces output equal to _grayscale_cpu within tolerance.

    These tests only run when CuPy is importable.  They verify:
    1. _grayscale_gpu is callable and returns a 2-D uint8 ndarray.
    2. GPU output is pixel-close to CPU output (luma converter).
    3. "grayscale" is in _GPU_CAPABLE_STAGE_IDS.
    4. V2_STAGE_IMPL["grayscale"] has a "gpu" key when cupy is available.
    """

    @staticmethod
    def _make_bgr(h: int = 128, w: int = 128) -> np.ndarray:
        rng = np.random.default_rng(99)
        return rng.integers(0, 255, (h, w, 3), dtype=np.uint8)

    def test_grayscale_in_gpu_capable_stage_ids(self) -> None:
        """'grayscale' must be listed in _GPU_CAPABLE_STAGE_IDS."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import _GPU_CAPABLE_STAGE_IDS

        assert "grayscale" in _GPU_CAPABLE_STAGE_IDS, "'grayscale' is absent from _GPU_CAPABLE_STAGE_IDS"

    def test_v2_stage_impl_has_gpu_key(self) -> None:
        """V2_STAGE_IMPL['grayscale'] must have a 'gpu' key when cupy is available."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import V2_STAGE_IMPL

        assert "gpu" in V2_STAGE_IMPL["grayscale"], (
            "V2_STAGE_IMPL['grayscale'] is missing the 'gpu' key even though cupy is present"
        )

    def test_grayscale_gpu_returns_2d_uint8(self) -> None:
        """_grayscale_gpu returns a 2-D uint8 numpy ndarray."""
        import numpy as np

        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import _grayscale_gpu

        image = self._make_bgr()
        result = _grayscale_gpu(image)
        # Convert CuPy → numpy if needed
        if not isinstance(result, np.ndarray):
            import cupy as cp

            result = cp.asnumpy(result)

        assert result.ndim == 2, f"expected 2D output, got shape {result.shape}"
        assert result.dtype == np.uint8, f"expected uint8, got {result.dtype}"

    def test_grayscale_gpu_parity_with_cpu_luma(self) -> None:
        """_grayscale_gpu output equals _grayscale_cpu within ±2 per pixel for luma converter.

        run_grayscale_pipeline(use_gpu=True) runs CuPy ops which must produce
        results bit-close to the CPU path on a synthetic image.  A tolerance
        of ±2 accommodates float32 precision differences in weighted sums.
        """
        import sys

        import numpy as np

        from pdomain_prep_for_pgdp.core.models import GrayscaleConfigModel
        from pdomain_prep_for_pgdp.core.pipeline.stage_registry import _grayscale_cpu, _grayscale_gpu

        image = self._make_bgr()
        cfg = make_cfg(grayscale=GrayscaleConfigModel(converter="luma"))

        cpu_out = _grayscale_cpu(image, cfg)

        gpu_raw = _grayscale_gpu(image, cfg)
        # Convert CuPy → numpy if needed
        if not isinstance(gpu_raw, np.ndarray):
            import cupy as cp

            gpu_out = cp.asnumpy(gpu_raw)
        else:
            gpu_out = gpu_raw

        assert cpu_out.shape == gpu_out.shape, f"shape mismatch: cpu={cpu_out.shape} gpu={gpu_out.shape}"

        diff = np.abs(cpu_out.astype(int) - gpu_out.astype(int))
        max_diff = int(diff.max())
        mean_diff = float(diff.mean())

        print(
            f"\n  GPU parity (luma): max_diff={max_diff}, mean_diff={mean_diff:.4f}, shape={gpu_out.shape}",
            file=sys.stderr,
        )

        assert max_diff <= 2, (
            f"GPU output deviates too much from CPU (max_diff={max_diff} > 2). "
            f"mean_diff={mean_diff:.4f}. This suggests use_gpu=True is not calling "
            f"the same pipeline or there is a serious float-precision issue."
        )
