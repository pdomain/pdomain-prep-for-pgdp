"""TDD tests for Task 3.2: End-to-end 3-tier resolution of the grayscale pipeline config.

Covers four scenarios:
1. Scenario A (basic win order): page override for converter beats all tiers; a sibling page
   with no page override falls through to project + all defaults.
2. Scenario B (deep merge): page provides {converter: best_channel}, project provides
   {flatten: {enabled: true}}, all provides {converter: luma}; resolved cfg must have
   converter=best_channel AND flatten.enabled=true AND all other fields from registry defaults.
3. Scenario C (legacy-tier-migrates-then-merges): project tier stores legacy {mode: perceptual};
   page tier stores modern {converter: best_channel}; page wins for converter; project's legacy
   mode migrates to luma_bt709 but is overridden by page; flatten comes from registry.
4. Scenario D (STAGE_CONFIG_FIELDS update): _compute_config_hash tracks the 'grayscale' field
   on ResolvedPageConfig (not the old flat grayscale_* fields), so a settings change
   produces a different config hash.

These tests drive two changes:
- resolve_effective_3tier does NOT need a recursive deep merge for the nested grayscale shape
  (it already works top-level-key-by-key; GrayscaleConfigModel.from_settings merges sub-dicts
  with Pydantic defaults).
- STAGE_CONFIG_FIELDS["grayscale"] must track "grayscale" (the GrayscaleConfigModel field),
  NOT the legacy flat "grayscale_mode"/"grayscale_sampler_radius"/… fields.
"""

from __future__ import annotations

from pdomain_prep_for_pgdp.core.models import (
    AlignmentOverride,
    GrayscaleConfigModel,
    PageType,
    ResolvedPageConfig,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_cfg(**kwargs) -> ResolvedPageConfig:  # type: ignore[no-untyped-def]
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


def _effective_for_page(
    store,
    app_wide,
    project_id: str,
    page_id: str,
) -> dict:  # type: ignore[type-arg]
    """Get the full 3-tier effective dict for the grayscale stage."""
    from pdomain_prep_for_pgdp.core.pipeline.stage_settings import STAGE_SETTINGS_DEFAULTS

    return store.get_effective_3tier(
        project_id,
        "grayscale",
        page_id,
        registry_default=STAGE_SETTINGS_DEFAULTS["grayscale"],
        app_wide=app_wide,
    )


# ---------------------------------------------------------------------------
# Scenario A: basic win order — page beats project beats all beats registry
# ---------------------------------------------------------------------------


class TestScenarioABasicWinOrder:
    """app-wide converter=luma, project flatten=on, page-0 converter=best_channel."""

    def test_page_with_override_gets_page_converter(self, tmp_path) -> None:  # type: ignore[no-untyped-def]
        """Page 0000 has a converter override; must win over all and project."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_settings import (
            AppWideStageSettings,
            StageSettingsStore,
            apply_stage_settings_to_config,
        )

        store = StageSettingsStore(tmp_path / "settings.db")
        aw = AppWideStageSettings(tmp_path)

        # app-wide: converter=luma
        aw.put("grayscale", {"converter": "luma"})
        # project: flatten on
        store.save_as_default("proj1", "grayscale", {"flatten": {"enabled": True}})
        # page 0000: override converter=best_channel
        store.save_page_override("proj1", "grayscale", "0000", {"converter": "best_channel"})

        effective = _effective_for_page(store, aw, "proj1", "0000")
        cfg = apply_stage_settings_to_config(_make_cfg(), "grayscale", effective)

        assert cfg.grayscale.converter == "best_channel"
        assert cfg.grayscale.flatten.enabled is True

    def test_sibling_page_without_override_inherits_project_and_all(self, tmp_path) -> None:  # type: ignore[no-untyped-def]
        """Page 0001 has no page override; must inherit app-wide converter and project flatten."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_settings import (
            AppWideStageSettings,
            StageSettingsStore,
            apply_stage_settings_to_config,
        )

        store = StageSettingsStore(tmp_path / "settings.db")
        aw = AppWideStageSettings(tmp_path)

        aw.put("grayscale", {"converter": "luma"})
        store.save_as_default("proj1", "grayscale", {"flatten": {"enabled": True}})
        # page 0001: NO page override

        effective = _effective_for_page(store, aw, "proj1", "0001")
        cfg = apply_stage_settings_to_config(_make_cfg(), "grayscale", effective)

        # Falls through to all-tier converter
        assert cfg.grayscale.converter == "luma"
        # Falls through to project-tier flatten
        assert cfg.grayscale.flatten.enabled is True


# ---------------------------------------------------------------------------
# Scenario B: deep-merge — page provides converter, project provides flatten,
#             all provides converter (overridden by page), rest from registry
# ---------------------------------------------------------------------------


class TestScenarioBDeepMerge:
    """The key 3-tier deep-merge scenario from the plan."""

    def test_page_converter_plus_project_flatten_plus_registry_rest(self, tmp_path) -> None:  # type: ignore[no-untyped-def]
        """page={converter:best_channel}, project={flatten:{enabled:true}}, all={converter:luma}.

        Expected: converter=best_channel (page wins over all), flatten.enabled=true
        (project), all other fields from registry defaults (clahe.enabled=False,
        channel=green, output_range=None, etc.).
        """
        from pdomain_prep_for_pgdp.core.pipeline.stage_settings import (
            STAGE_SETTINGS_DEFAULTS,
            AppWideStageSettings,
            StageSettingsStore,
            apply_stage_settings_to_config,
        )

        store = StageSettingsStore(tmp_path / "settings.db")
        aw = AppWideStageSettings(tmp_path)

        aw.put("grayscale", {"converter": "luma"})
        store.save_as_default("proj1", "grayscale", {"flatten": {"enabled": True}})
        store.save_page_override("proj1", "grayscale", "0000", {"converter": "best_channel"})

        effective = _effective_for_page(store, aw, "proj1", "0000")
        cfg = apply_stage_settings_to_config(_make_cfg(), "grayscale", effective)

        # page wins converter
        assert cfg.grayscale.converter == "best_channel"
        # project provides flatten.enabled
        assert cfg.grayscale.flatten.enabled is True
        # flatten sub-fields not in project tier come from sub-model defaults
        assert cfg.grayscale.flatten.radius == 64
        assert cfg.grayscale.flatten.strength == 1.0
        # channel falls through to registry
        assert cfg.grayscale.channel == STAGE_SETTINGS_DEFAULTS["grayscale"]["channel"]
        # clahe comes from registry (disabled)
        assert cfg.grayscale.clahe.enabled is False
        # output_range from registry
        assert cfg.grayscale.output_range is None

    def test_all_tier_overrides_registry_for_unset_field(self, tmp_path) -> None:  # type: ignore[no-untyped-def]
        """When all tier sets clahe and no page/project override, clahe from all."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_settings import (
            AppWideStageSettings,
            StageSettingsStore,
            apply_stage_settings_to_config,
        )

        store = StageSettingsStore(tmp_path / "settings.db")
        aw = AppWideStageSettings(tmp_path)

        aw.put("grayscale", {"clahe": {"enabled": True, "clip_limit": 3.0, "tile_grid": 8}})
        # no project default, no page override

        effective = _effective_for_page(store, aw, "proj1", "0000")
        cfg = apply_stage_settings_to_config(_make_cfg(), "grayscale", effective)

        # clahe from all tier
        assert cfg.grayscale.clahe.enabled is True
        assert cfg.grayscale.clahe.clip_limit == 3.0
        # converter falls to registry
        assert cfg.grayscale.converter == "luma"


# ---------------------------------------------------------------------------
# Scenario C: legacy tier migrates then merges
# ---------------------------------------------------------------------------


class TestScenarioCLegacyMigration:
    """Legacy flat settings at any tier must migrate before merging."""

    def test_page_nested_beats_project_legacy(self, tmp_path) -> None:  # type: ignore[no-untyped-def]
        """Page has nested {converter: best_channel}; project has legacy {mode: perceptual}.

        Page wins for converter (best_channel, not luma_bt709 from migration).
        """
        from pdomain_prep_for_pgdp.core.pipeline.stage_settings import (
            AppWideStageSettings,
            StageSettingsStore,
            apply_stage_settings_to_config,
        )

        store = StageSettingsStore(tmp_path / "settings.db")
        aw = AppWideStageSettings(tmp_path)

        # project: legacy flat dict — must be migrated on resolution
        store.save_as_default("proj1", "grayscale", {"mode": "perceptual"})
        # page: modern nested dict with converter override
        store.save_page_override("proj1", "grayscale", "0000", {"converter": "best_channel"})

        effective = _effective_for_page(store, aw, "proj1", "0000")
        cfg = apply_stage_settings_to_config(_make_cfg(), "grayscale", effective)

        # page wins: best_channel (not luma_bt709 from project legacy migration)
        assert cfg.grayscale.converter == "best_channel"

    def test_project_legacy_migrates_when_no_page_override(self, tmp_path) -> None:  # type: ignore[no-untyped-def]
        """When only project tier is set (legacy), it migrates to nested shape correctly."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_settings import (
            AppWideStageSettings,
            StageSettingsStore,
            apply_stage_settings_to_config,
        )

        store = StageSettingsStore(tmp_path / "settings.db")
        aw = AppWideStageSettings(tmp_path)

        # project: legacy flat {mode: perceptual}
        store.save_as_default("proj1", "grayscale", {"mode": "perceptual"})
        # no page override

        effective = _effective_for_page(store, aw, "proj1", "0000")
        cfg = apply_stage_settings_to_config(_make_cfg(), "grayscale", effective)

        # project's legacy mode="perceptual" migrates → converter=luma_bt709
        # BUT: resolve_effective_3tier picks per-top-level-key; the project dict has
        # only "mode" (a legacy key), so the "converter" key falls through to registry.
        # After apply_stage_settings_to_config calls migrate_grayscale_settings on the
        # EFFECTIVE dict, migration converts "mode" to "converter".
        # Result: converter=luma_bt709 (from project legacy migration).
        assert cfg.grayscale.converter == "luma_bt709"

    def test_all_tier_legacy_migrates_when_no_page_or_project(self, tmp_path) -> None:  # type: ignore[no-untyped-def]
        """When only all tier is set (legacy flat), it migrates correctly."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_settings import (
            AppWideStageSettings,
            StageSettingsStore,
            apply_stage_settings_to_config,
        )

        store = StageSettingsStore(tmp_path / "settings.db")
        aw = AppWideStageSettings(tmp_path)

        # all tier: legacy {mode: perceptual}
        aw.put("grayscale", {"mode": "perceptual"})

        effective = _effective_for_page(store, aw, "proj1", "0000")
        cfg = apply_stage_settings_to_config(_make_cfg(), "grayscale", effective)

        # all tier's legacy mode="perceptual" migrates → converter=luma_bt709
        # The "mode" key from all-tier fills "mode" in registry resolution (not in registry),
        # but apply_stage_settings_to_config calls migrate_grayscale_settings first.
        assert cfg.grayscale.converter == "luma_bt709"


# ---------------------------------------------------------------------------
# Scenario D: STAGE_CONFIG_FIELDS tracks "grayscale" field (config hash correctness)
# ---------------------------------------------------------------------------


class TestScenarioDConfigHashTracksGrayscaleField:
    """_compute_config_hash for grayscale must track the 'grayscale' field,
    not the legacy flat grayscale_* fields."""

    def test_stage_config_fields_grayscale_tracks_grayscale_field(self) -> None:
        """STAGE_CONFIG_FIELDS['grayscale'] must include 'grayscale'."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_runner import STAGE_CONFIG_FIELDS

        assert "grayscale" in STAGE_CONFIG_FIELDS["grayscale"], (
            "STAGE_CONFIG_FIELDS['grayscale'] must track the 'grayscale' field "
            "(the GrayscaleConfigModel on ResolvedPageConfig), not the old flat fields"
        )

    def test_stage_config_fields_grayscale_does_not_track_old_flat_fields(self) -> None:
        """STAGE_CONFIG_FIELDS['grayscale'] must NOT contain the legacy flat field names."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_runner import STAGE_CONFIG_FIELDS

        legacy_flat_fields = {
            "grayscale_mode",
            "grayscale_sampler_radius",
            "grayscale_gamma",
            "grayscale_output_range_min",
            "grayscale_output_range_max",
        }
        fields = STAGE_CONFIG_FIELDS["grayscale"]
        overlap = legacy_flat_fields & fields
        assert not overlap, (
            f"STAGE_CONFIG_FIELDS['grayscale'] still contains legacy flat fields: {overlap}; "
            "update to track 'grayscale' (the GrayscaleConfigModel) instead"
        )

    def test_config_hash_differs_when_grayscale_settings_change(self) -> None:
        """_compute_config_hash produces different hashes for different grayscale configs."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_runner import _compute_config_hash

        cfg_default = _make_cfg()
        cfg_luma_bt709 = _make_cfg(grayscale=GrayscaleConfigModel.from_settings({"converter": "luma_bt709"}))
        hash_default = _compute_config_hash(cfg_default, "grayscale")
        hash_custom = _compute_config_hash(cfg_luma_bt709, "grayscale")

        assert hash_default is not None
        assert hash_custom is not None
        assert hash_default != hash_custom, (
            "_compute_config_hash must return different values for different grayscale configs"
        )

    def test_config_hash_same_for_identical_grayscale_configs(self) -> None:
        """_compute_config_hash is deterministic for identical grayscale configs."""
        from pdomain_prep_for_pgdp.core.pipeline.stage_runner import _compute_config_hash

        cfg_a = _make_cfg(grayscale=GrayscaleConfigModel.from_settings({"converter": "best_channel"}))
        cfg_b = _make_cfg(grayscale=GrayscaleConfigModel.from_settings({"converter": "best_channel"}))

        assert _compute_config_hash(cfg_a, "grayscale") == _compute_config_hash(cfg_b, "grayscale")
