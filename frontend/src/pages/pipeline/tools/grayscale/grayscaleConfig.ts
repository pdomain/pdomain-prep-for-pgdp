/**
 * grayscaleConfig.ts — GrayscaleConfig TS types + (de)serializers.
 *
 * Task 4.1: Grayscale config types + service wiring
 *
 * The backend stores and returns the nested pipeline config in snake_case.
 * This module defines the canonical TS representation (GrayscaleConfig) that
 * mirrors the backend dict shape exactly, plus:
 *   - GrayscaleDraftConfig: editor in-memory form (same shape — no translation
 *     needed, round-trip is trivially identity; kept as a distinct alias so
 *     Task 4.2 can diverge the draft if the form needs a flatter structure).
 *   - draftToSettings(draft) → GrayscaleConfig: the PUT body for the backend.
 *   - settingsToDraft(settings) → GrayscaleDraftConfig: hydrate the editor.
 *   - GRAYSCALE_CONFIG_DEFAULTS: mirrors backend defaults (book-tools defaults).
 *
 * Converter values: luma | luma_bt709 | lab_l | color2gray | best_channel
 * Channel values:   green | red | blue | auto
 *
 * @see src/pdomain_prep_for_pgdp/core/models.py — GrayscaleConfigModel (backend mirror)
 * @see frontend/src/machines/tools/grayscaleTool.ts — machine types
 * @see frontend/src/services/tools/grayscaleTool.ts — service layer
 */

// ---------------------------------------------------------------------------
// Sub-config types
// ---------------------------------------------------------------------------

export interface FlattenConfig {
  enabled: boolean;
  radius: number;
  strength: number;
}

export interface ClaheConfig {
  enabled: boolean;
  clip_limit: number;
  tile_grid: number;
}

export interface Color2GrayParams {
  radius: number;
  samples: number;
  iterations: number;
  enhance_shadows: boolean;
}

// ---------------------------------------------------------------------------
// Top-level config type
// ---------------------------------------------------------------------------

/** Converter algorithm union — matches backend GrayscaleConfig converter field. */
export type GrayscaleConverter =
  | "luma"
  | "luma_bt709"
  | "lab_l"
  | "color2gray"
  | "best_channel";

/** Channel selection union — matches backend GrayscaleConfig channel field. */
export type GrayscaleChannel = "green" | "red" | "blue" | "auto";

/**
 * GrayscaleConfig — mirrors the backend snake_case nested pipeline config dict.
 *
 * This is the shape produced by `GrayscaleConfig.to_dict()` (book-tools) and
 * stored/returned by the backend stage-settings and detect endpoints.
 *
 * It is also the shape accepted by PUT /stages/grayscale/settings.
 */
export interface GrayscaleConfig {
  flatten: FlattenConfig;
  converter: GrayscaleConverter;
  channel: GrayscaleChannel;
  color2gray: Color2GrayParams;
  clahe: ClaheConfig;
  /** null means "use the full 0–255 range (no clipping)". */
  output_range: [number, number] | null;
}

/**
 * GrayscaleDraftConfig — editor in-memory representation.
 *
 * Currently identical to GrayscaleConfig (the draft shape equals the PUT body
 * shape — no translation layer is needed for the nested config). Kept as a
 * distinct alias so Task 4.2 can diverge the draft (e.g. add UI-only fields)
 * without changing the serializer contract.
 *
 * Round-trip invariant:
 *   settingsToDraft(draftToSettings(d)) deep-equals d for any GrayscaleDraftConfig d.
 */
export type GrayscaleDraftConfig = GrayscaleConfig;

// ---------------------------------------------------------------------------
// Defaults — mirror backend book-tools defaults
// ---------------------------------------------------------------------------

/**
 * GRAYSCALE_CONFIG_DEFAULTS — default GrayscaleDraftConfig.
 *
 * Matches the defaults in:
 *   - pdomain_prep_for_pgdp/core/models.py FlattenConfigModel / ClaheConfigModel /
 *     Color2GrayParamsModel / GrayscaleConfigModel
 *   - pdomain_book_tools/image_processing/grayscale_pipeline.py GrayscaleConfig
 */
export const GRAYSCALE_CONFIG_DEFAULTS: GrayscaleDraftConfig = {
  flatten: { enabled: false, radius: 64, strength: 1.0 },
  converter: "luma",
  channel: "green",
  color2gray: {
    radius: 300,
    samples: 4,
    iterations: 10,
    enhance_shadows: false,
  },
  clahe: { enabled: false, clip_limit: 2.0, tile_grid: 8 },
  output_range: null,
};

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

/**
 * draftToSettings — serialize the editor draft to the PUT body shape.
 *
 * The draft and PUT body are both snake_case nested GrayscaleConfig dicts,
 * so this is a deep clone (no key translation required).  Explicit cloning
 * prevents accidental mutation of the draft in the caller.
 *
 * PUT /api/data/projects/{id}/pages/{idx0}/stages/grayscale/settings
 * accepts this shape.
 */
export function draftToSettings(draft: GrayscaleDraftConfig): GrayscaleConfig {
  return {
    flatten: { ...draft.flatten },
    converter: draft.converter,
    channel: draft.channel,
    color2gray: { ...draft.color2gray },
    clahe: { ...draft.clahe },
    output_range: draft.output_range != null ? [...draft.output_range] : null,
  };
}

/**
 * settingsToDraft — hydrate a draft from persisted or detected settings.
 *
 * Accepts the nested GrayscaleConfig dict returned by:
 *   - GET /stages/grayscale/settings (resolved config)
 *   - POST /project-stages/grayscale/detect → response.config
 *
 * Falls back to GRAYSCALE_CONFIG_DEFAULTS for any missing nested object
 * so partial backend responses don't yield undefined fields.
 */
export function settingsToDraft(
  settings: GrayscaleConfig,
): GrayscaleDraftConfig {
  return {
    flatten: settings.flatten
      ? { ...settings.flatten }
      : { ...GRAYSCALE_CONFIG_DEFAULTS.flatten },
    converter: settings.converter ?? GRAYSCALE_CONFIG_DEFAULTS.converter,
    channel: settings.channel ?? GRAYSCALE_CONFIG_DEFAULTS.channel,
    color2gray: settings.color2gray
      ? { ...settings.color2gray }
      : { ...GRAYSCALE_CONFIG_DEFAULTS.color2gray },
    clahe: settings.clahe
      ? { ...settings.clahe }
      : { ...GRAYSCALE_CONFIG_DEFAULTS.clahe },
    output_range:
      settings.output_range != null ? [...settings.output_range] : null,
  };
}
