"""TDD tests for Task 1.3: Settings defaults + migration from legacy fields.

Covers:
1. STAGE_SETTINGS_DEFAULTS["grayscale"] is the nested pipeline default shape
   (flatten off, converter=luma, clahe off, output_range null).
2. migrate_grayscale_settings: legacy mode="perceptual" → converter="luma_bt709"
3. migrate_grayscale_settings: legacy mode="standard" → converter="luma"
4. migrate_grayscale_settings: legacy output_range_min/max → output_range list
5. migrate_grayscale_settings: already-nested dict passes through unchanged (idempotent)
6. apply_stage_settings_to_config: a legacy grayscale settings dict produces
   a ResolvedPageConfig.grayscale with the migrated converter.
"""

from __future__ import annotations

from pdomain_prep_for_pgdp.core.models import (
    AlignmentOverride,
    GrayscaleConfigModel,
    PageType,
    ResolvedPageConfig,
)
from pdomain_prep_for_pgdp.core.pipeline.stage_settings import (
    STAGE_SETTINGS_DEFAULTS,
    apply_stage_settings_to_config,
    migrate_grayscale_settings,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_resolved_page_config(**kwargs) -> ResolvedPageConfig:  # type: ignore[no-untyped-def]
    """Build a minimal ResolvedPageConfig; caller can override any field."""
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
# Suite 1: STAGE_SETTINGS_DEFAULTS["grayscale"] shape
# ---------------------------------------------------------------------------


class TestGrayscaleDefaultShape:
    def test_grayscale_key_exists(self) -> None:
        """STAGE_SETTINGS_DEFAULTS must have a 'grayscale' key."""
        assert "grayscale" in STAGE_SETTINGS_DEFAULTS

    def test_default_converter_is_luma(self) -> None:
        """The registry default converter must be 'luma' (plain luma, not BT.709)."""
        d = STAGE_SETTINGS_DEFAULTS["grayscale"]
        assert d.get("converter") == "luma"

    def test_default_flatten_off(self) -> None:
        """flatten sub-dict must default to enabled=False."""
        d = STAGE_SETTINGS_DEFAULTS["grayscale"]
        assert "flatten" in d
        assert d["flatten"]["enabled"] is False

    def test_default_clahe_off(self) -> None:
        """clahe sub-dict must default to enabled=False."""
        d = STAGE_SETTINGS_DEFAULTS["grayscale"]
        assert "clahe" in d
        assert d["clahe"]["enabled"] is False

    def test_default_output_range_is_none(self) -> None:
        """output_range must default to None."""
        d = STAGE_SETTINGS_DEFAULTS["grayscale"]
        assert d.get("output_range") is None

    def test_no_legacy_mode_key(self) -> None:
        """The 'mode' key (legacy flat field) must NOT appear in the new default."""
        d = STAGE_SETTINGS_DEFAULTS["grayscale"]
        assert "mode" not in d

    def test_no_legacy_gamma_key(self) -> None:
        """The 'gamma' key (legacy flat field) must NOT appear in the new default."""
        d = STAGE_SETTINGS_DEFAULTS["grayscale"]
        assert "gamma" not in d

    def test_default_is_buildable_by_from_settings(self) -> None:
        """STAGE_SETTINGS_DEFAULTS['grayscale'] must be acceptable to GrayscaleConfigModel.from_settings."""
        model = GrayscaleConfigModel.from_settings(STAGE_SETTINGS_DEFAULTS["grayscale"])
        assert model.converter == "luma"
        assert model.flatten.enabled is False


# ---------------------------------------------------------------------------
# Suite 2: migrate_grayscale_settings — legacy → nested
# ---------------------------------------------------------------------------


class TestMigrateGrayscaleSettings:
    def test_perceptual_mode_maps_to_luma_bt709(self) -> None:
        """Legacy mode='perceptual' must map to converter='luma_bt709' (OQ-1 continuity)."""
        result = migrate_grayscale_settings({"mode": "perceptual"})
        assert result.get("converter") == "luma_bt709"

    def test_standard_mode_maps_to_luma(self) -> None:
        """Legacy mode='standard' must map to converter='luma'."""
        result = migrate_grayscale_settings({"mode": "standard"})
        assert result.get("converter") == "luma"

    def test_no_mode_maps_to_luma(self) -> None:
        """Legacy dict with no 'mode' key still produces converter='luma'."""
        result = migrate_grayscale_settings({"gamma": 1.2})
        assert result.get("converter") == "luma"

    def test_output_range_min_max_maps_to_list(self) -> None:
        """Legacy output_range_min/max must merge into output_range:[min,max]."""
        result = migrate_grayscale_settings({"output_range_min": 10, "output_range_max": 245})
        assert result.get("output_range") == [10, 245]

    def test_perceptual_with_gamma_migrates_correctly(self) -> None:
        """A full legacy settings dict (all flat fields) migrates converter + output_range."""
        legacy = {
            "mode": "perceptual",
            "sampler_radius": 3,
            "gamma": 1.1,
            "output_range_min": 12,
            "output_range_max": 248,
        }
        result = migrate_grayscale_settings(legacy)
        assert result.get("converter") == "luma_bt709"
        assert result.get("output_range") == [12, 248]
        # legacy flat keys must not be forwarded
        assert "mode" not in result
        assert "output_range_min" not in result
        assert "output_range_max" not in result

    def test_nested_dict_is_idempotent(self) -> None:
        """A dict already in nested pipeline shape (has 'converter') passes through unchanged."""
        nested = {
            "converter": "best_channel",
            "flatten": {"enabled": True, "radius": 32, "strength": 0.5},
            "clahe": {"enabled": False},
            "output_range": [5, 250],
        }
        result = migrate_grayscale_settings(nested)
        assert result == nested

    def test_nested_dict_with_flatten_key_is_idempotent(self) -> None:
        """A dict with 'flatten' key is recognised as nested and not re-migrated."""
        nested = {"flatten": {"enabled": False}, "converter": "luma"}
        result = migrate_grayscale_settings(nested)
        assert result == nested

    def test_empty_dict_returns_empty_dict(self) -> None:
        """migrate_grayscale_settings({}) returns {}."""
        result = migrate_grayscale_settings({})
        assert result == {}


# ---------------------------------------------------------------------------
# Suite 3: apply_stage_settings_to_config end-to-end with legacy input
# ---------------------------------------------------------------------------


class TestApplyStageSettingsGrayscale:
    def test_legacy_perceptual_settings_produce_luma_bt709(self) -> None:
        """apply_stage_settings_to_config with a legacy grayscale settings dict
        produces a ResolvedPageConfig.grayscale with converter='luma_bt709'."""
        cfg = _make_resolved_page_config()
        legacy_effective = {
            "mode": "perceptual",
            "gamma": 1.1,
            "sampler_radius": 3,
            "output_range_min": 12,
            "output_range_max": 248,
        }
        result = apply_stage_settings_to_config(cfg, "grayscale", legacy_effective)
        assert result.grayscale.converter == "luma_bt709"
        assert result.grayscale.output_range == [12, 248]

    def test_legacy_standard_settings_produce_luma(self) -> None:
        """apply_stage_settings_to_config with legacy mode='standard' → luma."""
        cfg = _make_resolved_page_config()
        result = apply_stage_settings_to_config(cfg, "grayscale", {"mode": "standard"})
        assert result.grayscale.converter == "luma"

    def test_nested_settings_passthrough(self) -> None:
        """apply_stage_settings_to_config with an already-nested dict sets grayscale correctly."""
        cfg = _make_resolved_page_config()
        nested = {
            "converter": "lab_l",
            "flatten": {"enabled": True, "radius": 64, "strength": 1.0},
            "clahe": {"enabled": False},
            "output_range": None,
        }
        result = apply_stage_settings_to_config(cfg, "grayscale", nested)
        assert result.grayscale.converter == "lab_l"
        assert result.grayscale.flatten.enabled is True

    def test_empty_settings_leaves_grayscale_as_default(self) -> None:
        """apply_stage_settings_to_config({}) returns the same grayscale default."""
        cfg = _make_resolved_page_config()
        result = apply_stage_settings_to_config(cfg, "grayscale", {})
        assert result is cfg  # early-return: same object when settings is empty

    def test_non_grayscale_stage_unaffected(self) -> None:
        """apply_stage_settings_to_config for a non-grayscale stage does NOT touch .grayscale."""
        cfg = _make_resolved_page_config()
        result = apply_stage_settings_to_config(
            cfg, "denoise", {"min_component_area": 10, "median_kernel_size": 3}
        )
        assert result.grayscale.converter == "luma"  # default untouched
        assert result.denoise_min_component_area == 10
