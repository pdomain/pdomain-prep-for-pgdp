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

    def test_raises_runtime_error_when_to_grayscale_missing(self) -> None:
        """Fail-loud: RuntimeError is raised when to_grayscale is absent.

        Silently falling back to the legacy cv2_convert_to_grayscale would
        discard all four tuning params (mode/sampler_radius/gamma/output_range).
        The pin is pdomain-book-tools >= 0.20.0 so this should never fire in
        practice — but a bad downgrade must be loud rather than silent.
        """
        image = make_bgr_image()

        def fake_load_attr(module_path: str, attr_name: str) -> object:
            if attr_name == "to_grayscale":
                raise AttributeError("to_grayscale not in this version")
            raise AttributeError(f"unexpected attr: {attr_name}")

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
            if attr_name == "to_grayscale":
                raise AttributeError("not found")
            raise AttributeError(f"unexpected attr: {attr_name}")

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


# ---------------------------------------------------------------------------
# Suite 3: Real byte-differential — params reach the real primitive
# ---------------------------------------------------------------------------


class TestGrayscaleRealByteDiff:
    """Prove that different param sets produce pixel-distinct output.

    Uses the REAL pdomain_book_tools.to_grayscale — no mocking of the
    core function.  This is the committed proof that tuning parameters
    actually reach the primitive and change the resulting image bytes,
    not just that the call happens.
    """

    @staticmethod
    def _make_colorful_image(h: int = 128, w: int = 128) -> np.ndarray:
        """Return a synthetic BGR image with strong per-pixel variation.

        A uniform (solid) image collapses to a single luma value, which the
        output_range normalisation maps to the same byte regardless of mode.
        We need spatial variation so each mode's distinct channel-weight
        formula (BT.601 vs BT.709 linear-light) produces a *different* per-pixel
        luma distribution.  A deterministic random array with seed 123 is
        used so the test is reproducible across machines.
        """
        rng = np.random.default_rng(123)
        return rng.integers(0, 255, (h, w, 3), dtype=np.uint8)

    def test_standard_vs_perceptual_produce_different_pixels(self) -> None:
        """standard + gamma=1.0 vs perceptual + gamma=2.2 + radius=7 differ.

        Param set A (standard / fast luma):
          mode="standard", sampler_radius=0, gamma=1.0, output_range=(0, 255)

        Param set B (perceptual / gamma-aware):
          mode="perceptual", sampler_radius=7, gamma=2.2, output_range=(0, 255)

        The two modes use different channel-weight formulas (BT.601 vs BT.709
        in linear light), so even a uniform-colour patch will yield a different
        single luma value.  We assert pixel arrays differ AND report the mean
        absolute difference for traceability.
        """
        image = self._make_colorful_image()

        cfg_a = make_cfg(
            grayscale_mode="standard",
            grayscale_sampler_radius=0,
            grayscale_gamma=1.0,
            grayscale_output_range_min=0,
            grayscale_output_range_max=255,
        )
        cfg_b = make_cfg(
            grayscale_mode="perceptual",
            grayscale_sampler_radius=7,
            grayscale_gamma=2.2,
            grayscale_output_range_min=0,
            grayscale_output_range_max=255,
        )

        result_a = _grayscale_cpu(image, cfg_a)
        result_b = _grayscale_cpu(image, cfg_b)

        assert result_a.ndim == 2, f"expected 2D output, got shape {result_a.shape}"
        assert result_b.ndim == 2, f"expected 2D output, got shape {result_b.shape}"
        assert result_a.shape == result_b.shape, f"shape mismatch: {result_a.shape} vs {result_b.shape}"

        diff = np.abs(result_a.astype(int) - result_b.astype(int))
        mean_diff = float(diff.mean())
        changed_pixels = int((diff > 0).sum())

        # Commit the proof: params must reach the real primitive and change output.
        # The threshold is deliberately low — even 1 changed pixel falsifies
        # the "params are silently dropped" hypothesis.  In practice the BT.601
        # vs BT.709 difference on our test patch is several luma counts.
        assert changed_pixels > 0, (
            f"PARAMS IGNORED: result_a and result_b are identical pixel-for-pixel "
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
