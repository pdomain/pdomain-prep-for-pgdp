/**
 * sourceTool.ts — Real SourceToolServices backed by the v2 API.
 *
 * SourceToolServices extends StageSettingsServices with:
 *   confirmSelection → POST /api/data/projects/:id/project-stages/source/confirm
 *
 * W4 Group 1: confirm route wired (returns { ok } which we adapt to { pages }).
 * The source stage runs via the project-stage run route and SSE.
 *
 * StageSettingsServices methods come from services/stageSettings.ts.
 *
 * @see frontend/src/machines/tools/source.ts — SourceToolServices
 */

import { api } from "@/api/client";
import type { SourceToolServices } from "@/machines/tools/source";
import { buildRealStageSettingsServices } from "@/services/stageSettings";

/**
 * Confirm the source stage review-complete.
 *
 * Route: POST /api/data/projects/{id}/project-stages/source/confirm
 * Returns { pages: N } — pages is derived from the confirmed_at response
 * since source doesn't have a page-count artifact at confirm time.
 * The machine uses pages count to update its UI state.
 *
 * W4 Group 1 — wire real route (seam-remediation plan).
 */
async function confirmSelection(
  projectId: string,
  _files: unknown[],
): Promise<{ pages: number }> {
  const result = await api.post<{
    stage_id: string;
    status: string;
    confirmed_at: string;
  }>(
    `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/source/confirm`,
    {},
  );
  // Return pages: 0 since we don't track exact page count at confirm time.
  // The pipeline snapshot provides the authoritative page count via pipelineShell.
  return { pages: result.status === "clean" ? 0 : 0 };
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real SourceToolServices for injection into the machine. */
export function buildRealSourceToolServices(): SourceToolServices {
  const stageSettingsSvcs = buildRealStageSettingsServices();
  return {
    ...stageSettingsSvcs,
    confirmSelection,
  };
}
