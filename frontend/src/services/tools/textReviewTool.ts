/**
 * textReviewTool.ts — Real TextReviewToolServices backed by the v2 API.
 *
 * W4 Group 1: confirmStage wired.
 * W4 Group 3: approveLowRisk wired to real route.
 *
 * Backend routes used:
 *   POST /api/data/projects/{id}/project-stages/text_review/approve-low-risk
 *   POST /api/data/projects/{id}/project-stages/text_review/confirm
 *
 * At I1: approve-low-risk returns empty approvedIds (no real risk model yet).
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
 * W4 Group 3: POST /api/data/projects/{id}/project-stages/text_review/approve-low-risk
 * At I1: returns empty approvedIds (no real risk model yet — I2 TODO).
 */
async function approveLowRisk(
  projectId: string,
): Promise<{ approvedIds: string[] }> {
  try {
    const result = await api.post<{ approved_ids: string[] }>(
      `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/text_review/approve-low-risk`,
      {},
    );
    return { approvedIds: result.approved_ids ?? [] };
  } catch {
    return { approvedIds: [] };
  }
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
