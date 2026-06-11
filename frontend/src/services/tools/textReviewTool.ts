/**
 * textReviewTool.ts — Real TextReviewToolServices backed by the v2 API.
 *
 * W4 Group 1: confirmStage wired.
 * W4 Group 3: approveLowRisk (approve-low-risk route) still stub.
 *
 * @see frontend/src/machines/tools/textReviewTool.ts — TextReviewToolServices
 */

import { api } from "@/api/client";
import type { TextReviewToolServices } from "@/machines/tools/textReviewTool";
// W5.2 — include real stageSettings methods (save-as-default / revert / reset)
import { buildRealStageSettingsServices } from "@/services/stageSettings";

/**
 * Approve all low-risk items.
 *
 * DRIFT: POST .../project-stages/text_review/approve-low-risk not yet
 * implemented (W4 Group 3). Returns empty approvedIds.
 */
function approveLowRisk(
  _projectId: string,
): Promise<{ approvedIds: string[] }> {
  return Promise.resolve({ approvedIds: [] });
}

/**
 * Confirm the text review stage review-complete.
 *
 * Route: POST /api/data/projects/{id}/project-stages/text_review/confirm
 * W4 Group 1 — wired real route.
 */
async function confirmStage(projectId: string): Promise<{ ok: boolean }> {
  try {
    await api.post(
      `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/text_review/confirm`,
      {},
    );
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real TextReviewToolServices for injection into the machine. */
export function buildRealTextReviewToolServices(): TextReviewToolServices {
  return { ...buildRealStageSettingsServices(), approveLowRisk, confirmStage };
}
