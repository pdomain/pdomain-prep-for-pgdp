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
  GrayscalePage,
} from "@/machines/tools/grayscaleTool";
// W5.2 — include real stageSettings methods (save-as-default / revert / reset)
import {
  buildRealStageSettingsServices,
  putStageSettings,
} from "@/services/stageSettings";
// Task 4.1 — pipeline config types + serializers
import {
  type GrayscaleConfig,
  draftToSettings,
} from "@/pages/pipeline/tools/grayscale/grayscaleConfig";

// ---------------------------------------------------------------------------
// Settings serialization (Task 4.1 — nested pipeline config)
// ---------------------------------------------------------------------------

/**
 * Convert a machine draft (GrayscaleDraft = GrayscaleDraftConfig & {mode?:…})
 * to the nested snake_case body expected by PUT /stages/grayscale/settings.
 *
 * Task 4.2: the machine's draft is now a proper GrayscaleDraftConfig (nested
 * pipeline config shape) because `initDraft` seeds it from `settingsToDraft(
 * detected.config)` on entry to `done`, and the SET_CONVERTER/SET_FLATTEN/
 * SET_CLAHE/SET_CHANNEL actions mutate the nested keys directly.
 *
 * draftToSettings() deep-clones the nested config to prevent mutation.
 * The `as unknown as GrayscaleConfig` cast is now SAFE: the machine guarantees
 * the draft has the nested shape. If a legacy flat draft somehow flows through
 * (e.g. test mocks that pre-date Task 4.2), settingsToDraft-backed fallbacks
 * in draftToSettings will still produce a valid GrayscaleConfig.
 *
 * The cast is tightened by the structural type check: GrayscaleDraft extends
 * GrayscaleDraftConfig (which equals GrayscaleConfig), so the only unsound
 * fields are the extra `mode?` and `[key:string]:unknown` index signature —
 * both are ignored by draftToSettings which only reads known nested keys.
 */
function serializeDraftToSettings(
  draft: Record<string, unknown>,
): GrayscaleConfig {
  // Task 4.2: draft is now structurally a GrayscaleDraft which extends
  // GrayscaleDraftConfig (= GrayscaleConfig). The cast via unknown is safe:
  // draftToSettings only reads: flatten, converter, channel, color2gray,
  // clahe, output_range — all guaranteed present after initDraft runs.
  // The double-cast avoids the "may be a mistake" tslint warning since
  // Record<string,unknown> and GrayscaleConfig have overlapping keys at runtime.
  return draftToSettings(draft as unknown as GrayscaleConfig);
}

// ---------------------------------------------------------------------------
// Detect
// ---------------------------------------------------------------------------

/**
 * Detect grayscale profile by sampling COLOR SOURCE page images from the BlobStore.
 *
 * POST /api/data/projects/{id}/project-stages/grayscale/detect
 * → { config, why, mode, backend }
 *
 * Task 4.1: response now includes `config` — the full GrayscalePipelineConfig
 * recommended by the backend heuristic.  `mode` is kept for backward compat
 * with the machine's `detected.mode` context field.
 *
 * Backend heuristic: samples up to 8 original source images, measures four
 * chroma/contrast signals, and recommends the full nested GrayscaleConfig.
 * Spec: docs/specs/2026-06-15-grayscale-pipeline.md §8a.
 */
async function detectProfile(projectId: string): Promise<{
  config: GrayscaleConfig;
  mode: GrayscaleMode;
  why: string;
  backend: GrayscaleBackend;
}> {
  return api.post<{
    config: GrayscaleConfig;
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
  const snakeSettings = serializeDraftToSettings(settings);
  await putStageSettings(
    projectId,
    stageId,
    snakeSettings as unknown as Record<string, unknown>,
  );

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
// Load page stage status (REST prefetch on mount)
// ---------------------------------------------------------------------------

/**
 * Load the stage row list for a single page and map the grayscale row
 * (if clean) to a GrayscalePage so the machine can seed ctx.pages without
 * waiting for SSE events.
 *
 * GET /api/data/projects/{id}/pages/{idx0}/stages
 * → PageStageState[] (all 16 page-scoped stages for that page)
 *
 * We look for the row where stage_id === stageId and status === "clean".
 * If found, we build a GrayscalePage with lastRunAt from the DB row so the
 * artifact URL cache-buster is correct on first render. Returns [] if the
 * stage is not yet clean.
 */
/** Minimal shape of a page stage row returned by GET /pages/{idx0}/stages. */
interface PageStageRow {
  stage_id: string;
  status: string;
  last_run_at: number | null;
}

async function loadPageStages(
  projectId: string,
  stageId: string,
  idx0: number,
  mode: GrayscaleMode,
): Promise<GrayscalePage[]> {
  let rows: PageStageRow[];
  try {
    rows = await api.get<PageStageRow[]>(
      `/api/data/projects/${encodeURIComponent(projectId)}/pages/${idx0}/stages`,
    );
  } catch {
    // If the endpoint is missing or fails, return nothing — the machine
    // will stay in `converting` and wait for live SSE events as before.
    return [];
  }

  const row = rows.find((r) => r.stage_id === stageId && r.status === "clean");
  if (!row) return [];

  const page: GrayscalePage = {
    id: String(idx0).padStart(4, "0"),
    idx0,
    mode,
    ...(row.last_run_at != null ? { lastRunAt: row.last_run_at } : {}),
  };
  return [page];
}

// ---------------------------------------------------------------------------
// Task 4.3 — Tier-scoped save functions
// ---------------------------------------------------------------------------

/**
 * PUT the page-tier override for a given page.
 *
 * PUT /api/data/projects/{id}/pages/{idx0}/stages/{stageId}/settings/page
 *
 * This is a SPARSE page-level override: only the keys provided override that
 * field for this specific page; everything else falls through to
 * project / all / registry. The body is the full nested GrayscaleConfig so
 * all fields are set explicitly (avoids partial-override surprises).
 */
export async function putPageTierSettings(
  projectId: string,
  stageId: string,
  idx0: number,
  body: GrayscaleConfig,
): Promise<Record<string, unknown>> {
  return api.put<Record<string, unknown>>(
    `/api/data/projects/${encodeURIComponent(projectId)}/pages/${idx0}/stages/${encodeURIComponent(stageId)}/settings/page`,
    body,
  );
}

/**
 * PUT the app-wide (all-tier) defaults for a stage.
 *
 * PUT /api/data/settings/stages/{stageId}
 *
 * These apply to all projects that have no project-level or page-level
 * override for this stage's fields.
 */
export async function putAllTierSettings(
  stageId: string,
  body: GrayscaleConfig,
): Promise<Record<string, unknown>> {
  return api.put<Record<string, unknown>>(
    `/api/data/settings/stages/${encodeURIComponent(stageId)}`,
    body,
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
    loadPageStages,
  };
}
