/**
 * stageSettings.ts — Real StageSettingsServices backed by the v2 API.
 *
 * Stage settings routes (api-v2-deltas.md §1.8):
 *   GET  /api/data/projects/{id}/pages/{idx0}/stages/{stageId}/settings
 *   PUT  /api/data/projects/{id}/pages/{idx0}/stages/{stageId}/settings
 *   POST /api/data/projects/{id}/pages/{idx0}/stages/{stageId}/settings/save-as-default
 *   POST /api/data/projects/{id}/pages/{idx0}/stages/{stageId}/settings/revert
 *   POST /api/data/projects/{id}/pages/{idx0}/stages/{stageId}/settings/reset
 *
 * ## idx0 for project-level settings
 *
 * The routes require a page idx0 even for project-level operations
 * (save-as-default, revert, reset). Since these are project-level, we use
 * idx0=0000 as the canonical page — all pages share the same project default.
 * The backend StageSettingsStore stores defaults by projectId + stageId,
 * not by pageId, so any valid idx0 works.
 *
 * @see docs/specs/api-v2-deltas.md §1.8
 * @see frontend/src/machines/tools/stageSettings.ts — StageSettingsServices interface
 */

import { api } from "@/api/client";
import type { StageSettingsServices } from "@/machines/tools/stageSettings";

const SETTINGS_IDX0 = "0000" as const;

function settingsBase(projectId: string, stageId: string): string {
  return `/api/data/projects/${encodeURIComponent(projectId)}/pages/${SETTINGS_IDX0}/stages/${encodeURIComponent(stageId)}/settings`;
}

/**
 * GET effective settings (override > saved default > registry default).
 * Used by tools on mount to pre-populate their settings state.
 * @internal — Called directly by stage-settings tool surfaces at I2.
 */
export async function getStageSettings(
  projectId: string,
  stageId: string,
): Promise<Record<string, unknown>> {
  return api.get<Record<string, unknown>>(settingsBase(projectId, stageId));
}

/**
 * Task 4.2 — Resolved settings response shape.
 *
 * Shape returned by GET .../settings/resolved:
 *   { "effective": {field: value, ...}, "sources": {field: "page"|"project"|"all"|"registry", ...} }
 *
 * The `sources` dict tells the UI which tier supplied each field value so it
 * can show "from: page", "from: project", etc. as per-field source badges.
 *
 * Source tier values: "page" | "project" | "all" | "registry"
 */
export interface ResolvedSettingsResponse {
  effective: Record<string, unknown>;
  sources: Record<string, string>;
}

/**
 * Task 4.2: GET .../settings/resolved — return effective settings + per-field tier sources.
 *
 * GET /api/data/projects/{id}/pages/{idx0}/stages/{stageId}/settings/resolved
 * → { effective: {...}, sources: {field: "page"|"project"|"all"|"registry", ...} }
 *
 * The `sources` map lets the editor render a "from: <tier>" badge per field.
 * Called by GrayscalePipelineEditor to populate the converter/flatten/clahe
 * source-tier badges.
 */
export async function getStageSettingsResolved(
  projectId: string,
  stageId: string,
): Promise<ResolvedSettingsResponse> {
  return api.get<ResolvedSettingsResponse>(
    `${settingsBase(projectId, stageId)}/resolved`,
  );
}

/**
 * PUT saves a session-level override (not persisted as "my default").
 * Called directly by stage-settings tool surfaces.
 */
export async function putStageSettings(
  projectId: string,
  stageId: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return api.put<Record<string, unknown>>(
    settingsBase(projectId, stageId),
    body,
  );
}

/**
 * POST .../save-as-default — persist body as the project-level default.
 * Called by SAVE_AS_DEFAULT machine event; the stageSettings machine invokes
 * this via the "saveAsDefault" fromPromise actor.
 */
export async function saveAsDefault(
  projectId: string,
  stageId: string,
  draft: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return api.post<Record<string, unknown>>(
    `${settingsBase(projectId, stageId)}/save-as-default`,
    draft,
  );
}

/**
 * POST .../revert — delete override, revert to saved default or registry default.
 * Called by REVERT machine event.
 */
export async function revertSettings(
  projectId: string,
  stageId: string,
): Promise<Record<string, unknown>> {
  return api.post<Record<string, unknown>>(
    `${settingsBase(projectId, stageId)}/revert`,
  );
}

/**
 * POST .../reset — delete both override and saved default, revert to registry default.
 * Called by RESET_TO_DEFAULT machine event.
 */
export async function resetSettings(
  projectId: string,
  stageId: string,
): Promise<Record<string, unknown>> {
  return api.post<Record<string, unknown>>(
    `${settingsBase(projectId, stageId)}/reset`,
  );
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real StageSettingsServices for injection into tool machines. */
export function buildRealStageSettingsServices(): StageSettingsServices {
  return {
    saveAsDefault,
    revertSettings,
    resetSettings,
  };
}
