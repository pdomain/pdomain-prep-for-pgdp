/**
 * grayscaleTool.ts — Real GrayscaleToolServices backed by the v2 API.
 *
 * Routes (R2 imagetools — all wiring corrected):
 *   POST /api/data/projects/{id}/project-stages/grayscale/detect
 *          → { mode, why, backend }
 *
 *   PUT  /api/data/projects/{id}/pages/0/stages/grayscale/settings
 *          → persist draft as override (must happen BEFORE run so run_stage
 *            reads the updated StageSettingsStore)
 *
 *   POST /api/data/projects/{id}/pages/{idx0}/stages/grayscale/run
 *          → run the grayscale stage on one page (page-scoped, not project-scoped)
 *
 * Fix summary (Issue 1-3):
 *   Issue 1: `runStage` was POSTing to the project-scoped route
 *     (`/project-stages/grayscale/run`) which raises 422 because "grayscale"
 *     is a PAGE stage (in V2_PAGE_STAGE_IDS, not V2_PROJECT_STAGE_IDS).
 *     Fix: use the page-scoped route `/pages/{idx0}/stages/grayscale/run`.
 *
 *   Issue 2: settings were sent only in the run body, which is ignored.
 *     `apply_stage_settings_to_config` reads from StageSettingsStore, not from
 *     the run request body. Fix: PUT settings via the override route BEFORE run.
 *
 *   Issue 3: draft used camelCase keys (samplerRadius/outputRangeMin/outputRangeMax)
 *     but the backend store / _SETTINGS_KEY_TO_FIELD uses snake_case. Unknown
 *     camelCase keys were silently dropped. Fix: serialize to snake_case at the
 *     service boundary before the PUT.
 *
 * @see frontend/src/machines/tools/grayscaleTool.ts — GrayscaleToolServices
 */

import { api } from "@/api/client";
import type {
  GrayscaleToolServices,
  GrayscaleMode,
  GrayscaleBackend,
} from "@/machines/tools/grayscaleTool";
// W5.2 — include real stageSettings methods (save-as-default / revert / reset)
import {
  buildRealStageSettingsServices,
  putStageSettings,
} from "@/services/stageSettings";

// ---------------------------------------------------------------------------
// Snake-case serialization (Issue 3 fix)
// ---------------------------------------------------------------------------

/**
 * Convert a camelCase draft dict to the snake_case body expected by
 * PUT /stages/grayscale/settings and the StageSettingsStore.
 *
 * STAGE_SETTINGS_DEFAULTS["grayscale"] keys: mode, sampler_radius, gamma,
 * output_range_min, output_range_max — all snake_case. Unknown camelCase
 * keys from the draft are dropped here; only the five known knobs are emitted.
 *
 * Accepts Record<string, unknown> (the machine passes GrayscaleDraft which
 * is assignable to this) to avoid a redundant type assertion at the call site.
 */
function draftToSnakeCase(
  draft: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (draft["mode"] !== undefined) {
    body["mode"] = draft["mode"];
  }
  if (draft["samplerRadius"] !== undefined) {
    body["sampler_radius"] = draft["samplerRadius"];
  }
  if (draft["gamma"] !== undefined) {
    body["gamma"] = draft["gamma"];
  }
  if (draft["outputRangeMin"] !== undefined) {
    body["output_range_min"] = draft["outputRangeMin"];
  }
  if (draft["outputRangeMax"] !== undefined) {
    body["output_range_max"] = draft["outputRangeMax"];
  }
  return body;
}

// ---------------------------------------------------------------------------
// Detect
// ---------------------------------------------------------------------------

/**
 * Detect grayscale profile by sampling COLOR SOURCE page images from the BlobStore.
 *
 * POST /api/data/projects/{id}/project-stages/grayscale/detect
 * → { mode, why, backend }
 *
 * Backend heuristic: samples up to 8 original source images, measures YCbCr
 * chromatic energy. Returns "perceptual" for colour-biased sources, "standard"
 * for B&W line art.
 */
async function detectProfile(
  projectId: string,
): Promise<{ mode: GrayscaleMode; why: string; backend: GrayscaleBackend }> {
  return api.post<{
    mode: GrayscaleMode;
    why: string;
    backend: GrayscaleBackend;
  }>(
    `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/grayscale/detect`,
  );
}

// ---------------------------------------------------------------------------
// Apply & Run (Issue 1 + 2 + 3 fix)
// ---------------------------------------------------------------------------

/**
 * Persist draft settings as a project override then run the grayscale stage on
 * the currently-viewed page (page index 0 for a single-page preview; callers
 * that know the current idx0 should use `runPageStageWithSettings` instead).
 *
 * Two-step sequence:
 *   1. PUT /pages/0/stages/grayscale/settings — saves draft as override in
 *      StageSettingsStore so `apply_stage_settings_to_config` picks it up.
 *   2. POST /pages/0/stages/grayscale/run — runs the stage (reads settings
 *      from the store, not from the run body).
 *
 * The machine calls `requestRun` with `context.draft`; at that point the draft
 * is still non-null (commitDraft runs after requestRun per the statechart).
 *
 * Issue 1 fix: was POSTing to /project-stages/ (project-scoped → 422).
 * Issue 2 fix: settings now persisted before run.
 * Issue 3 fix: draft serialized to snake_case.
 */
async function runStage(
  projectId: string,
  stageId: string,
  settings: Record<string, unknown>,
): Promise<void> {
  // Persist the draft override first so run_stage sees the new settings.
  const snakeSettings = draftToSnakeCase(settings);
  await putStageSettings(projectId, stageId, snakeSettings);

  // Run on page 0 (the "currently viewed" page in Apply&Run context).
  // The machine always navigates to the current page; idx0=0 is the canonical
  // first page for the initial Apply&Run. Full per-page support uses
  // runPageStageWithSettings.
  await api.post(
    `/api/data/projects/${encodeURIComponent(projectId)}/pages/0/stages/${encodeURIComponent(stageId)}/run`,
    { force: true },
  );
}

// ---------------------------------------------------------------------------
// Re-run single page (no settings mutation)
// ---------------------------------------------------------------------------

/**
 * Re-run the grayscale stage on a single page using the stored settings.
 *
 * POST /api/data/projects/{id}/pages/{idx0}/stages/{stageId}/run
 *
 * RERUN_PAGE does NOT change settings — it re-runs with whatever override is
 * currently in the StageSettingsStore. No PUT needed here.
 */
async function runPageStage(
  projectId: string,
  stageId: string,
  idx0: number,
): Promise<void> {
  await api.post(
    `/api/data/projects/${encodeURIComponent(projectId)}/pages/${idx0}/stages/${encodeURIComponent(stageId)}/run`,
    { force: true },
  );
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real GrayscaleToolServices for injection into the machine. */
export function buildRealGrayscaleToolServices(): GrayscaleToolServices {
  return {
    ...buildRealStageSettingsServices(),
    detectProfile,
    runStage,
    runPageStage,
  };
}
