/**
 * grayscaleConfig.test.ts — Unit tests for GrayscaleConfig TS types + serializers.
 *
 * Task 4.1: Grayscale config types + service wiring
 *
 * Verifies:
 *   1. GrayscaleConfig mirrors the backend snake_case nested dict shape.
 *   2. draftToSettings(draft) → PUT body (snake_case nested matching backend).
 *   3. settingsToDraft(settings) → draft (round-trip inverse).
 *   4. Round-trip: settingsToDraft(draftToSettings(d)) deep-equals d.
 *
 * @see frontend/src/pages/pipeline/tools/grayscale/types.ts — GrayscaleConfig
 * @see frontend/src/services/tools/grayscaleTool.ts — service wiring
 * @see docs/plans/hifi-loader-source-grayscale-complete.md — Task 4.1
 */

import { describe, it, expect } from "vitest";
import {
  type GrayscaleConfig,
  type GrayscaleDraftConfig,
  draftToSettings,
  settingsToDraft,
  GRAYSCALE_CONFIG_DEFAULTS,
} from "./grayscaleConfig";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Full backend config dict (all fields explicitly set). */
const FULL_BACKEND_CONFIG: GrayscaleConfig = {
  flatten: { enabled: true, radius: 48, strength: 0.8 },
  converter: "color2gray",
  channel: "green",
  color2gray: {
    radius: 200,
    samples: 6,
    iterations: 12,
    enhance_shadows: true,
  },
  clahe: { enabled: true, clip_limit: 3.5, tile_grid: 16 },
  output_range: [10, 245],
};

/** Full draft form of the same config. */
const FULL_DRAFT: GrayscaleDraftConfig = {
  flatten: { enabled: true, radius: 48, strength: 0.8 },
  converter: "color2gray",
  channel: "green",
  color2gray: {
    radius: 200,
    samples: 6,
    iterations: 12,
    enhance_shadows: true,
  },
  clahe: { enabled: true, clip_limit: 3.5, tile_grid: 16 },
  output_range: [10, 245],
};

/** Default config (matches backend defaults). */
const DEFAULT_BACKEND_CONFIG: GrayscaleConfig = {
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
// Suite 1: GRAYSCALE_CONFIG_DEFAULTS shape
// ---------------------------------------------------------------------------

describe("GRAYSCALE_CONFIG_DEFAULTS", () => {
  it("matches the backend default config shape", () => {
    expect(GRAYSCALE_CONFIG_DEFAULTS).toEqual(DEFAULT_BACKEND_CONFIG);
  });

  it("has all required nested keys", () => {
    expect(GRAYSCALE_CONFIG_DEFAULTS.flatten).toHaveProperty("enabled");
    expect(GRAYSCALE_CONFIG_DEFAULTS.flatten).toHaveProperty("radius");
    expect(GRAYSCALE_CONFIG_DEFAULTS.flatten).toHaveProperty("strength");
    expect(GRAYSCALE_CONFIG_DEFAULTS.color2gray).toHaveProperty("radius");
    expect(GRAYSCALE_CONFIG_DEFAULTS.color2gray).toHaveProperty("samples");
    expect(GRAYSCALE_CONFIG_DEFAULTS.color2gray).toHaveProperty("iterations");
    expect(GRAYSCALE_CONFIG_DEFAULTS.color2gray).toHaveProperty(
      "enhance_shadows",
    );
    expect(GRAYSCALE_CONFIG_DEFAULTS.clahe).toHaveProperty("enabled");
    expect(GRAYSCALE_CONFIG_DEFAULTS.clahe).toHaveProperty("clip_limit");
    expect(GRAYSCALE_CONFIG_DEFAULTS.clahe).toHaveProperty("tile_grid");
    expect(GRAYSCALE_CONFIG_DEFAULTS.output_range).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Suite 2: draftToSettings — draft → PUT body
// ---------------------------------------------------------------------------

describe("draftToSettings", () => {
  it("returns a config matching the full backend shape (snake_case nested)", () => {
    const body = draftToSettings(FULL_DRAFT);
    expect(body).toEqual(FULL_BACKEND_CONFIG);
  });

  it("produces snake_case keys at all nesting levels", () => {
    const body = draftToSettings(FULL_DRAFT);
    // Top-level keys are snake_case
    expect(body).toHaveProperty("flatten");
    expect(body).toHaveProperty("converter");
    expect(body).toHaveProperty("channel");
    expect(body).toHaveProperty("color2gray");
    expect(body).toHaveProperty("clahe");
    expect(body).toHaveProperty("output_range");
    // Nested clahe keys
    expect(body.clahe).toHaveProperty("clip_limit");
    expect(body.clahe).toHaveProperty("tile_grid");
    // Nested color2gray keys
    expect(body.color2gray).toHaveProperty("enhance_shadows");
  });

  it("preserves output_range null", () => {
    const draft: GrayscaleDraftConfig = {
      ...FULL_DRAFT,
      output_range: null,
    };
    const body = draftToSettings(draft);
    expect(body.output_range).toBeNull();
  });

  it("preserves output_range tuple", () => {
    const draft: GrayscaleDraftConfig = {
      ...FULL_DRAFT,
      output_range: [5, 250],
    };
    const body = draftToSettings(draft);
    expect(body.output_range).toEqual([5, 250]);
  });

  it("default draft → default backend config", () => {
    const body = draftToSettings(GRAYSCALE_CONFIG_DEFAULTS);
    expect(body).toEqual(DEFAULT_BACKEND_CONFIG);
  });
});

// ---------------------------------------------------------------------------
// Suite 3: settingsToDraft — settings → draft
// ---------------------------------------------------------------------------

describe("settingsToDraft", () => {
  it("converts full backend config to draft with the same values", () => {
    const draft = settingsToDraft(FULL_BACKEND_CONFIG);
    expect(draft).toEqual(FULL_DRAFT);
  });

  it("uses defaults for missing nested keys", () => {
    const partial: GrayscaleConfig = {
      ...DEFAULT_BACKEND_CONFIG,
      converter: "luma_bt709",
    };
    const draft = settingsToDraft(partial);
    expect(draft.converter).toBe("luma_bt709");
    expect(draft.flatten).toEqual(GRAYSCALE_CONFIG_DEFAULTS.flatten);
  });

  it("preserves null output_range", () => {
    const cfg: GrayscaleConfig = {
      ...DEFAULT_BACKEND_CONFIG,
      output_range: null,
    };
    const draft = settingsToDraft(cfg);
    expect(draft.output_range).toBeNull();
  });

  it("preserves non-null output_range", () => {
    const cfg: GrayscaleConfig = {
      ...DEFAULT_BACKEND_CONFIG,
      output_range: [15, 240],
    };
    const draft = settingsToDraft(cfg);
    expect(draft.output_range).toEqual([15, 240]);
  });
});

// ---------------------------------------------------------------------------
// Suite 4: Round-trip — settingsToDraft(draftToSettings(d)) deep-equals d
// ---------------------------------------------------------------------------

describe("round-trip: settingsToDraft(draftToSettings(draft)) === draft", () => {
  it("full config round-trips exactly", () => {
    const roundTripped = settingsToDraft(draftToSettings(FULL_DRAFT));
    expect(roundTripped).toEqual(FULL_DRAFT);
  });

  it("default config round-trips exactly", () => {
    const roundTripped = settingsToDraft(
      draftToSettings(GRAYSCALE_CONFIG_DEFAULTS),
    );
    expect(roundTripped).toEqual(GRAYSCALE_CONFIG_DEFAULTS);
  });

  it("null output_range round-trips exactly", () => {
    const draft: GrayscaleDraftConfig = {
      ...FULL_DRAFT,
      output_range: null,
    };
    const roundTripped = settingsToDraft(draftToSettings(draft));
    expect(roundTripped.output_range).toBeNull();
  });

  it("each converter variant round-trips", () => {
    const converters: GrayscaleConfig["converter"][] = [
      "luma",
      "luma_bt709",
      "lab_l",
      "color2gray",
      "best_channel",
    ];
    for (const converter of converters) {
      const draft: GrayscaleDraftConfig = { ...FULL_DRAFT, converter };
      const roundTripped = settingsToDraft(draftToSettings(draft));
      expect(roundTripped.converter).toBe(converter);
    }
  });

  it("each channel variant round-trips", () => {
    const channels: GrayscaleConfig["channel"][] = [
      "green",
      "red",
      "blue",
      "auto",
    ];
    for (const channel of channels) {
      const draft: GrayscaleDraftConfig = { ...FULL_DRAFT, channel };
      const roundTripped = settingsToDraft(draftToSettings(draft));
      expect(roundTripped.channel).toBe(channel);
    }
  });

  it("inverse round-trip: draftToSettings(settingsToDraft(cfg)) === cfg", () => {
    const roundTripped = draftToSettings(settingsToDraft(FULL_BACKEND_CONFIG));
    expect(roundTripped).toEqual(FULL_BACKEND_CONFIG);
  });
});
