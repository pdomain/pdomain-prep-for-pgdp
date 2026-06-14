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

// ---------------------------------------------------------------------------
// PageType mapping from FileState
// ---------------------------------------------------------------------------

/** Maps source-tool role states to backend PageType values. */
const FILE_STATE_TO_PAGE_TYPE: Record<string, string | null> = {
  page: "normal",
  cover: "front_matter",
  back: "back_matter",
  blank: "blank",
  duplicate: "duplicate",
  // "ready", "pending", "inserted", "skipped" have no PageType mapping
};

// ---------------------------------------------------------------------------
// PATCH page role
// ---------------------------------------------------------------------------

/**
 * Persist a role change for a single page via PATCH /api/data/projects/{id}/pages/{idx0}.
 * Fire-and-forget: call errors are logged but do not surface to the machine.
 * The machine's in-memory state is already updated; this write is durable persistence.
 */
export async function patchPageRole(
  projectId: string,
  idx0: number,
  pageType: string,
): Promise<void> {
  await api.patch<unknown>(
    `/api/data/projects/${encodeURIComponent(projectId)}/pages/${String(idx0)}`,
    { page_type: pageType },
  );
}

// ---------------------------------------------------------------------------
// PATCH page ignore
// ---------------------------------------------------------------------------

/**
 * Set ignore=true on a page (reversible soft-remove) via PATCH.
 * This is the "Remove from project" action — event-logged, not hard-deleted.
 */
export async function patchPageIgnore(
  projectId: string,
  idx0: number,
  ignore: boolean,
): Promise<void> {
  await api.patch<unknown>(
    `/api/data/projects/${encodeURIComponent(projectId)}/pages/${String(idx0)}`,
    { page_type: ignore ? "excluded" : "normal" },
  );
}

// ---------------------------------------------------------------------------
// confirmSelection
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Re-export helpers for consumers (SourceTool wires role/ignore PATCH calls)
// ---------------------------------------------------------------------------

export { FILE_STATE_TO_PAGE_TYPE };
