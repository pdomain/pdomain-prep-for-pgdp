"""TDD tests for Task 1.1: ResolvedPageConfig carries a GrayscaleConfig.

Covers:
1. ResolvedPageConfig has a `grayscale` field with default converter="luma".
2. A nested settings dict builds the right GrayscaleConfigModel via from_settings.
3. model_dump() round-trips through book-tools GrayscaleConfig.from_dict exactly.
"""

from __future__ import annotations

import pytest
from pdomain_book_tools.image_processing.grayscale_pipeline import GrayscaleConfig

from pdomain_prep_for_pgdp.core.models import (
    AlignmentOverride,
    GrayscaleConfigModel,
    PageType,
    ResolvedPageConfig,
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
# Suite 1: GrayscaleConfigModel defaults
# ---------------------------------------------------------------------------


class TestGrayscaleConfigModelDefaults:
    def test_default_converter_is_luma(self) -> None:
        """GrayscaleConfigModel() must default converter to 'luma'."""
        model = GrayscaleConfigModel()
        assert model.converter == "luma"

    def test_default_flatten_disabled(self) -> None:
        model = GrayscaleConfigModel()
        assert model.flatten.enabled is False

    def test_default_clahe_disabled(self) -> None:
        model = GrayscaleConfigModel()
        assert model.clahe.enabled is False

    def test_default_output_range_is_none(self) -> None:
        model = GrayscaleConfigModel()
        assert model.output_range is None

    def test_default_channel_is_green(self) -> None:
        """Matches book-tools GrayscaleConfig default channel."""
        model = GrayscaleConfigModel()
        assert model.channel == "green"


# ---------------------------------------------------------------------------
# Suite 2: ResolvedPageConfig.grayscale field
# ---------------------------------------------------------------------------


class TestResolvedPageConfigGrayscaleField:
    def test_grayscale_field_exists(self) -> None:
        """ResolvedPageConfig must have a `grayscale` field."""
        cfg = _make_resolved_page_config()
        assert hasattr(cfg, "grayscale")

    def test_grayscale_field_default_type(self) -> None:
        """The default value must be a GrayscaleConfigModel instance."""
        cfg = _make_resolved_page_config()
        assert isinstance(cfg.grayscale, GrayscaleConfigModel)

    def test_grayscale_default_converter_is_luma(self) -> None:
        """Default grayscale converter on ResolvedPageConfig is 'luma'."""
        cfg = _make_resolved_page_config()
        assert cfg.grayscale.converter == "luma"

    def test_grayscale_instances_are_independent(self) -> None:
        """Two ResolvedPageConfig instances must not share the same GrayscaleConfigModel."""
        cfg_a = _make_resolved_page_config()
        cfg_b = _make_resolved_page_config()
        assert cfg_a.grayscale is not cfg_b.grayscale


# ---------------------------------------------------------------------------
# Suite 3: from_settings builder
# ---------------------------------------------------------------------------


class TestGrayscaleConfigModelFromSettings:
    def test_from_settings_empty_gives_default(self) -> None:
        """from_settings({}) returns the luma default."""
        model = GrayscaleConfigModel.from_settings({})
        assert model.converter == "luma"
        assert model.flatten.enabled is False

    def test_from_settings_converter_override(self) -> None:
        """from_settings can set converter to best_channel."""
        model = GrayscaleConfigModel.from_settings({"converter": "best_channel"})
        assert model.converter == "best_channel"

    def test_from_settings_nested_flatten(self) -> None:
        """from_settings wires nested flatten dict into FlattenConfigModel."""
        model = GrayscaleConfigModel.from_settings(
            {"flatten": {"enabled": True, "radius": 32, "strength": 0.5}}
        )
        assert model.flatten.enabled is True
        assert model.flatten.radius == 32
        assert model.flatten.strength == pytest.approx(0.5)

    def test_from_settings_nested_clahe(self) -> None:
        """from_settings wires nested clahe dict into ClaheConfigModel."""
        model = GrayscaleConfigModel.from_settings(
            {"clahe": {"enabled": True, "clip_limit": 3.0, "tile_grid": 16}}
        )
        assert model.clahe.enabled is True
        assert model.clahe.clip_limit == pytest.approx(3.0)
        assert model.clahe.tile_grid == 16

    def test_from_settings_output_range(self) -> None:
        """from_settings can set output_range."""
        model = GrayscaleConfigModel.from_settings({"output_range": [10, 245]})
        assert model.output_range == [10, 245]

    def test_from_settings_channel_override(self) -> None:
        """from_settings can change channel."""
        model = GrayscaleConfigModel.from_settings({"channel": "red"})
        assert model.channel == "red"


# ---------------------------------------------------------------------------
# Suite 4: model_dump → book-tools GrayscaleConfig.from_dict round-trip
# ---------------------------------------------------------------------------


class TestGrayscaleConfigModelRoundTrip:
    def test_default_round_trips_to_book_tools(self) -> None:
        """GrayscaleConfigModel().model_dump() must round-trip through
        GrayscaleConfig.from_dict and equal GrayscaleConfig()."""
        model = GrayscaleConfigModel()
        bt_cfg = GrayscaleConfig.from_dict(model.model_dump())
        assert bt_cfg == GrayscaleConfig()

    def test_custom_settings_round_trip(self) -> None:
        """A customised GrayscaleConfigModel must round-trip through book-tools."""
        settings = {
            "converter": "best_channel",
            "channel": "green",
            "flatten": {"enabled": True, "radius": 32, "strength": 0.8},
        }
        model = GrayscaleConfigModel.from_settings(settings)
        bt_cfg = GrayscaleConfig.from_dict(model.model_dump())
        # converter and flatten must reflect what we set
        assert bt_cfg.converter.value == "best_channel"
        assert bt_cfg.flatten.enabled is True
        assert bt_cfg.flatten.radius == 32
        assert bt_cfg.flatten.strength == pytest.approx(0.8)

    def test_clahe_round_trip(self) -> None:
        """CLAHE settings round-trip cleanly."""
        model = GrayscaleConfigModel.from_settings(
            {"clahe": {"enabled": True, "clip_limit": 4.0, "tile_grid": 8}}
        )
        bt_cfg = GrayscaleConfig.from_dict(model.model_dump())
        assert bt_cfg.clahe.enabled is True
        assert bt_cfg.clahe.clip_limit == pytest.approx(4.0)

    def test_output_range_round_trip(self) -> None:
        """output_range round-trips as a two-element sequence."""
        model = GrayscaleConfigModel.from_settings({"output_range": [12, 248]})
        bt_cfg = GrayscaleConfig.from_dict(model.model_dump())
        assert bt_cfg.output_range == (12, 248)
