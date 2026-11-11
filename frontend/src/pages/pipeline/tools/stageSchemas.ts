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

export type ControlKind = "slider" | "toggle" | "select" | "insets";

export interface ControlDef {
  /** Backend stage-settings key, sent unchanged on re-run */
  key: string;
  /** Human label */
  label: string;
  kind: ControlKind;
  /** For slider and insets: [min, max, step] */
  range?: [number, number, number];
  /** For select: option values */
  options?: (string | number)[];
  /** For slider: offers a button that sets the value to null */
  autoLabel?: string;
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
      key: "threshold_level",
      label: "Threshold level",
      kind: "slider",
      range: [0, 255, 1],
      defaultValue: null,
      autoLabel: "Auto (Otsu)",
      description:
        "Fixed cut point (0-255). Auto picks the level for each page with Otsu.",
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
      key: "skip_auto_deskew",
      label: "Skip automatic deskew",
      kind: "toggle",
      defaultValue: true,
      description: "When on, the page keeps its current rotation.",
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
      key: "min_component_area",
      label: "Minimum mark area (px²)",
      kind: "slider",
      range: [1, 50, 1],
      defaultValue: 6,
      description: "Marks with fewer pixels than this are removed as noise.",
    },
    {
      key: "median_kernel_size",
      label: "Median filter size",
      kind: "select",
      options: [0, 3, 5, 7],
      defaultValue: 0,
      description: "Blurs out single-pixel noise first. 0 turns it off.",
    },
    {
      key: "skip_denoise",
      label: "Skip denoise",
      kind: "toggle",
      defaultValue: false,
      description: "When on, the page passes through unchanged.",
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
    { key: "gutter", label: "Gutter shadow-sm", tone: "var(--ocr)" },
    { key: "illustration", label: "Illustration", tone: "var(--ink-3)" },
  ],
  controls: [],
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
      key: "post_transform_crop_insets",
      label: "Crop insets (px)",
      kind: "insets",
      range: [0, 200, 1],
      defaultValue: [0, 0, 0, 0],
      description: "Pixels removed from each edge after the transforms.",
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
      key: "do_morph",
      label: "Close gaps in text strokes",
      kind: "toggle",
      defaultValue: false,
      description: "Applies a morphological fill before mapping.",
    },
    {
      key: "page_h_w_ratio",
      label: "Page height / width",
      kind: "slider",
      range: [1.0, 2.0, 0.001],
      defaultValue: 1.294,
      description: "Aspect ratio of the common canvas.",
    },
  ],
  confirmLabel: "Confirm canvas map",
};

// ---------------------------------------------------------------------------
// Exported lookup map
// ---------------------------------------------------------------------------

/**
 * W5.8: post_ocr_crop — crop applied to the OCR input image after canvas_map.
 * Trims the mapped canvas to the text-zone bounding box before feeding OCR.
 */
const POST_OCR_CROP_SCHEMA: StageSchema = {
  stageId: "post_ocr_crop",
  label: "Post-OCR crop",
  description:
    "Crops the canvas-mapped page to the text-zone bounding box before passing " +
    "it to the OCR engine. Flagged pages have text zones that extend to the " +
    "canvas edge, or the crop removes content that should be kept.",
  settingsLabel: "post_ocr_crop",
  flagKinds: [
    { key: "edgeClip", label: "Edge clip", tone: "var(--mismatch)" },
    { key: "tightCrop", label: "Crop too tight", tone: "var(--fuzzy)" },
    { key: "noZones", label: "No zones", tone: "var(--ink-3)" },
  ],
  controls: [
    {
      key: "ocr_crop",
      label: "Crop insets (px)",
      kind: "insets",
      range: [0, 200, 1],
      defaultValue: [0, 0, 0, 0],
      description: "Pixels removed from each edge before OCR.",
    },
  ],
  confirmLabel: "Confirm post-OCR crop",
};

export const STAGE_SCHEMAS: Readonly<Record<string, StageSchema>> = {
  threshold: THRESHOLD_SCHEMA,
  deskew: DESKEW_SCHEMA,
  denoise: DENOISE_SCHEMA,
  dewarp: DEWARP_SCHEMA,
  post_transform_crop: POST_TRANSFORM_CROP_SCHEMA,
  canvas_map: CANVAS_MAP_SCHEMA,
  post_ocr_crop: POST_OCR_CROP_SCHEMA,
};

/** Retrieve the schema for a stage, or null if not registered. */
export function getStageSchema(stageId: string): StageSchema | null {
  return STAGE_SCHEMAS[stageId] ?? null;
}
