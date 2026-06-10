/**
 * stageSchemas.ts — Per-stage control-definition data for imageStageReview stages.
 *
 * Each entry in STAGE_SCHEMAS provides metadata about a stage's review surface:
 * - label: human-readable stage name
 * - flagKinds: the recognized flag taxonomy for this stage
 * - controls: ordered list of tunable parameters shown in the inline editor
 * - confirmLabel: the label on the Confirm & Advance button
 *
 * This is the WB_MAP analog for the imageStageReview shared surface. The
 * ImageStageReviewTool component reads this object to parameterize the UI
 * for each stage without needing per-stage components.
 *
 * Note on stageSettings: The F5.1 sibling agent (task/f51-source) is
 * extracting a `stageSettings.ts` with the settings-inheritance tri-state
 * pattern. Until that lands, each schema carries a minimal `settingsLabel`
 * field (the stage name used in the settings banner). When stageSettings.ts
 * merges, replace `settingsLabel` with the imported `StageSettingsConfig`.
 *
 * @see docs/specs/machine-stage-map.md §2 — shared imageStageReview instances
 * @see src/machines/imageStageReview.ts — the shared machine
 */

// ---------------------------------------------------------------------------
// Control types
// ---------------------------------------------------------------------------

export type ControlKind = "slider" | "toggle" | "select" | "info";

export interface ControlDef {
  /** Machine event param key (passed in SET_PARAM.patch) */
  key: string;
  /** Human label */
  label: string;
  kind: ControlKind;
  /** For slider: [min, max, step] */
  range?: [number, number, number];
  /** For select: option values */
  options?: string[];
  /** Default value (used for display when no draft) */
  defaultValue?: unknown;
  /** Short description shown below the label */
  description?: string;
}

export interface FlagKindDef {
  /** Machine flag key (in PageRow.flags[]) */
  key: string;
  /** Human label */
  label: string;
  /** CSS color for the flag chip */
  tone: string;
}

export interface StageSchema {
  /** Stage ID (matches STAGE_DEFS stageId) */
  stageId: string;
  /** Human label used in headings */
  label: string;
  /** Optional description for the review banner */
  description?: string;
  /** Short label for the settings banner tri-state pill */
  settingsLabel: string;
  /** Flag taxonomy for this stage */
  flagKinds: FlagKindDef[];
  /** Controls shown in the inline editor drawer */
  controls: ControlDef[];
  /** Confirm & Advance button label */
  confirmLabel: string;
}

// ---------------------------------------------------------------------------
// Per-stage schemas
// ---------------------------------------------------------------------------

const THRESHOLD_SCHEMA: StageSchema = {
  stageId: "threshold",
  label: "Threshold",
  description:
    "Binarizes the grayscale output to a bilevel (black-on-white) image. " +
    "Flagged pages have speckle, bleed-through, ink bleed, broken text, " +
    "low contrast, or uneven lighting artifacts.",
  settingsLabel: "threshold",
  flagKinds: [
    { key: "speckle", label: "Speckle", tone: "var(--fuzzy)" },
    { key: "bleedThrough", label: "Bleed-through", tone: "var(--mismatch)" },
    { key: "inkBleed", label: "Ink bleed", tone: "var(--mismatch)" },
    { key: "brokenText", label: "Broken text", tone: "var(--ocr)" },
    { key: "lowContrast", label: "Low contrast", tone: "var(--ink-3)" },
    { key: "unevenLight", label: "Uneven light", tone: "var(--fuzzy)" },
  ],
  controls: [
    {
      key: "method",
      label: "Method",
      kind: "select",
      options: ["sauvola", "otsu", "adaptive"],
      defaultValue: "sauvola",
      description: "Binarization algorithm. Sauvola is best for newsprint.",
    },
    {
      key: "threshold",
      label: "Threshold",
      kind: "slider",
      range: [0, 255, 1],
      defaultValue: 140,
      description:
        "Global cut point (0–255). Values below go black, above go white.",
    },
    {
      key: "windowSize",
      label: "Window size",
      kind: "slider",
      range: [11, 101, 2],
      defaultValue: 25,
      description:
        "Local window size (px) for Sauvola/adaptive. Larger = smoother.",
    },
    {
      key: "kFactor",
      label: "k factor",
      kind: "slider",
      range: [0.05, 0.5, 0.01],
      defaultValue: 0.34,
      description: "Sauvola k sensitivity. Higher = darker output.",
    },
  ],
  confirmLabel: "Confirm threshold",
};

const DESKEW_SCHEMA: StageSchema = {
  stageId: "deskew",
  label: "Deskew",
  description:
    "Corrects rotational skew in each page. Flagged pages have large or " +
    "uncertain detected angles that need manual review.",
  settingsLabel: "deskew",
  flagKinds: [
    { key: "largeAngle", label: "Large angle", tone: "var(--fuzzy)" },
    { key: "uncertain", label: "Uncertain", tone: "var(--mismatch)" },
    { key: "multiColumn", label: "Multi-column", tone: "var(--ocr)" },
    { key: "illustration", label: "Illustration", tone: "var(--ink-3)" },
  ],
  controls: [
    {
      key: "maxAngleDeg",
      label: "Max angle (°)",
      kind: "slider",
      range: [0.5, 15, 0.5],
      defaultValue: 5,
      description: "Pages with |angle| > max are flagged for review.",
    },
    {
      key: "algorithm",
      label: "Algorithm",
      kind: "select",
      options: ["projection", "hough", "auto"],
      defaultValue: "auto",
      description: "Skew detection algorithm. Auto selects by page type.",
    },
  ],
  confirmLabel: "Confirm deskew",
};

const DENOISE_SCHEMA: StageSchema = {
  stageId: "denoise",
  label: "Denoise",
  description:
    "Removes speckle and noise from the bilevel output while protecting " +
    "intentional ink marks (page numbers, signatures, catchwords).",
  settingsLabel: "denoise",
  flagKinds: [
    {
      key: "protectConflict",
      label: "Protect conflict",
      tone: "var(--mismatch)",
    },
    { key: "markAtRisk", label: "Mark at risk", tone: "var(--fuzzy)" },
    { key: "residualNoise", label: "Residual noise", tone: "var(--ocr)" },
    { key: "textEroded", label: "Text eroded", tone: "var(--mismatch)" },
  ],
  controls: [
    {
      key: "blobSizeMin",
      label: "Min blob size (px²)",
      kind: "slider",
      range: [1, 50, 1],
      defaultValue: 4,
      description: "Components smaller than this are removed as noise.",
    },
    {
      key: "blobSizeMax",
      label: "Max blob size (px²)",
      kind: "slider",
      range: [50, 500, 10],
      defaultValue: 200,
      description:
        "Components larger than this are protected (likely intentional).",
    },
    {
      key: "protectFootMarks",
      label: "Protect foot marks",
      kind: "toggle",
      defaultValue: true,
      description:
        "Keep the first-pass detector's protected components intact.",
    },
  ],
  confirmLabel: "Confirm denoise",
};

const DEWARP_SCHEMA: StageSchema = {
  stageId: "dewarp",
  label: "Dewarp",
  description:
    "Corrects page curvature caused by book binding or a curved scan bed. " +
    "Flagged pages have strong curvature or uncertain deformation estimates.",
  settingsLabel: "dewarp",
  flagKinds: [
    { key: "strongCurve", label: "Strong curve", tone: "var(--mismatch)" },
    { key: "uncertain", label: "Uncertain", tone: "var(--fuzzy)" },
    { key: "gutter", label: "Gutter shadow", tone: "var(--ocr)" },
    { key: "illustration", label: "Illustration", tone: "var(--ink-3)" },
  ],
  controls: [
    {
      key: "model",
      label: "Dewarp model",
      kind: "select",
      options: ["thin_plate_spline", "polynomial", "cylinder"],
      defaultValue: "thin_plate_spline",
      description: "Deformation model. TPS is best for book scans.",
    },
    {
      key: "stiffness",
      label: "Stiffness",
      kind: "slider",
      range: [0.0, 1.0, 0.05],
      defaultValue: 0.4,
      description: "Higher = smoother warp (less aggressive).",
    },
    {
      key: "gutterRemove",
      label: "Remove gutter shadow",
      kind: "toggle",
      defaultValue: true,
      description: "Crop the inner gutter shadow before dewarp.",
    },
  ],
  confirmLabel: "Confirm dewarp",
};

const POST_TRANSFORM_CROP_SCHEMA: StageSchema = {
  stageId: "post_transform_crop",
  label: "Post-transform crop",
  description:
    "Final crop applied after all geometric corrections (deskew, dewarp). " +
    "Removes residual border artifacts introduced by the transform stages.",
  settingsLabel: "post_transform_crop",
  flagKinds: [
    {
      key: "borderArtifact",
      label: "Border artifact",
      tone: "var(--mismatch)",
    },
    { key: "cropTight", label: "Crop too tight", tone: "var(--fuzzy)" },
    { key: "cropLoose", label: "Crop too loose", tone: "var(--ocr)" },
  ],
  controls: [
    {
      key: "marginTop",
      label: "Top margin (px)",
      kind: "slider",
      range: [0, 60, 1],
      defaultValue: 4,
      description: "Extra margin added after transform crop (top edge).",
    },
    {
      key: "marginBottom",
      label: "Bottom margin (px)",
      kind: "slider",
      range: [0, 60, 1],
      defaultValue: 4,
      description: "Extra margin added after transform crop (bottom edge).",
    },
    {
      key: "marginLeft",
      label: "Left margin (px)",
      kind: "slider",
      range: [0, 60, 1],
      defaultValue: 4,
      description: "Extra margin added after transform crop (left edge).",
    },
    {
      key: "marginRight",
      label: "Right margin (px)",
      kind: "slider",
      range: [0, 60, 1],
      defaultValue: 4,
      description: "Extra margin added after transform crop (right edge).",
    },
  ],
  confirmLabel: "Confirm post-transform crop",
};

const CANVAS_MAP_SCHEMA: StageSchema = {
  stageId: "canvas_map",
  label: "Canvas map",
  description:
    "Places every page on a common canvas using the body-page aspect ratio. " +
    "Flags oversize pages, split children without inner margins, and sidenote " +
    "pages whose outer margins need widening to stay symmetric.",
  settingsLabel: "canvas_map",
  flagKinds: [
    { key: "oversize", label: "Oversize", tone: "var(--mismatch)" },
    { key: "marginTight", label: "Margin tight", tone: "var(--fuzzy)" },
    { key: "sidenote", label: "Sidenote", tone: "var(--fuzzy)" },
    { key: "splitChild", label: "Split child", tone: "var(--ocr)" },
    {
      key: "facingMismatch",
      label: "Facing mismatch",
      tone: "var(--mismatch)",
    },
  ],
  controls: [
    {
      key: "targetCanvas",
      label: "Target canvas",
      kind: "select",
      options: ["body", "a4", "letter", "custom"],
      defaultValue: "body",
      description: "What sets the common canvas dimensions.",
    },
    {
      key: "marginTop",
      label: "Top margin (mm)",
      kind: "slider",
      range: [0, 40, 1],
      defaultValue: 16,
      description: "Top margin applied to all pages on the canvas.",
    },
    {
      key: "marginOuter",
      label: "Outer margin (mm)",
      kind: "slider",
      range: [0, 40, 1],
      defaultValue: 20,
      description: "Outer margin (left on verso, right on recto).",
    },
    {
      key: "marginInner",
      label: "Inner margin (mm)",
      kind: "slider",
      range: [0, 40, 1],
      defaultValue: 14,
      description: "Inner margin (gutter side). Mirrors on facing pages.",
    },
    {
      key: "marginBottom",
      label: "Bottom margin (mm)",
      kind: "slider",
      range: [0, 40, 1],
      defaultValue: 18,
      description: "Bottom margin applied to all pages on the canvas.",
    },
    {
      key: "mirrorFacingMargins",
      label: "Mirror facing margins",
      kind: "toggle",
      defaultValue: true,
      description:
        "Swap outer/inner between verso and recto so spreads read symmetric.",
    },
    {
      key: "fitOutliersWithin",
      label: "Fit outliers within canvas",
      kind: "toggle",
      defaultValue: true,
      description:
        "Scale plates / foldouts to fit rather than letting them set the size.",
    },
  ],
  confirmLabel: "Confirm canvas map",
};

// ---------------------------------------------------------------------------
// Exported lookup map
// ---------------------------------------------------------------------------

export const STAGE_SCHEMAS: Readonly<Record<string, StageSchema>> = {
  threshold: THRESHOLD_SCHEMA,
  deskew: DESKEW_SCHEMA,
  denoise: DENOISE_SCHEMA,
  dewarp: DEWARP_SCHEMA,
  post_transform_crop: POST_TRANSFORM_CROP_SCHEMA,
  canvas_map: CANVAS_MAP_SCHEMA,
};

/** Retrieve the schema for a stage, or null if not registered. */
export function getStageSchema(stageId: string): StageSchema | null {
  return STAGE_SCHEMAS[stageId] ?? null;
}
