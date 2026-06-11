/**
 * sourceTool.ts — Real SourceToolServices backed by the v2 API.
 *
 * SourceToolServices extends StageSettingsServices with:
 *   confirmSelection → POST /api/projects/:id/stages/source/confirm
 *
 * DRIFT: confirm route does not exist at I1 — returns stub { pages: N }.
 * The source stage runs via the project-stage run route and SSE.
 *
 * StageSettingsServices methods come from services/stageSettings.ts.
 *
 * @see frontend/src/machines/tools/source.ts — SourceToolServices
 */

import type { SourceToolServices } from "@/machines/tools/source";
import { buildRealStageSettingsServices } from "@/services/stageSettings";

/**
 * Confirm the source file selection.
 *
 * DRIFT: route not implemented at I1 — returns stub { pages: 0 }.
 */
function confirmSelection(
  _projectId: string,
  _files: unknown[],
): Promise<{ pages: number }> {
  return Promise.resolve({ pages: 0 });
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
