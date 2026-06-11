/**
 * textReviewTool.ts — Real TextReviewToolServices backed by the v2 API.
 *
 * DRIFT: Neither approve-low-risk nor confirm routes exist at I1.
 * Stubbed; add to project_stages.py at I2.
 *
 * @see frontend/src/machines/tools/textReviewTool.ts — TextReviewToolServices
 */

import type { TextReviewToolServices } from "@/machines/tools/textReviewTool";
// W5.2 — include real stageSettings methods (save-as-default / revert / reset)
import { buildRealStageSettingsServices } from "@/services/stageSettings";

/**
 * Approve all low-risk items.
 *
 * DRIFT: route not implemented at I1 — returns empty approvedIds.
 */
function approveLowRisk(
  _projectId: string,
): Promise<{ approvedIds: string[] }> {
  return Promise.resolve({ approvedIds: [] });
}

/**
 * Confirm the text review stage.
 *
 * DRIFT: route not implemented at I1 — returns { ok: true }.
 */
function confirmStage(_projectId: string): Promise<{ ok: boolean }> {
  return Promise.resolve({ ok: true });
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real TextReviewToolServices for injection into the machine. */
export function buildRealTextReviewToolServices(): TextReviewToolServices {
  return { ...buildRealStageSettingsServices(), approveLowRisk, confirmStage };
}
