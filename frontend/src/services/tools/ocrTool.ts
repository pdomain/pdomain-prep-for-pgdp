/**
 * ocrTool.ts — Real OcrToolServices backed by the v2 API.
 *
 * Backend routes:
 *   GET  /api/data/projects/{id}/pages/{idx0}/stages/wordcheck/flags
 *     (nearest route — at I1 we derive low-score tokens from wordcheck flags)
 *   POST /api/data/projects/{id}/project-stages/ocr/confirm  (W4 Group 1)
 *
 * Remaining stubs (W4 Group 3):
 *   GET  /api/data/projects/{id}/project-stages/ocr/pages  → fetchPageTokens
 *
 * @see frontend/src/machines/tools/ocrTool.ts — OcrToolServices
 */

import { api } from "@/api/client";
import type { OcrToolServices, OcrToken } from "@/machines/tools/ocrTool";
// W5.2 — include real stageSettings methods (save-as-default / revert / reset)
import { buildRealStageSettingsServices } from "@/services/stageSettings";

/**
 * Fetch low-score OCR tokens for a page.
 *
 * DRIFT: GET /api/data/projects/{id}/project-stages/ocr/pages not yet
 * implemented (W4 Group 3). Returns empty token list.
 */
function fetchPageTokens(
  _projectId: string,
  _pageId: string,
): Promise<{ tokens: OcrToken[] }> {
  return Promise.resolve({ tokens: [] });
}

/**
 * Confirm OCR stage review-complete.
 *
 * Route: POST /api/data/projects/{id}/project-stages/ocr/confirm
 * W4 Group 1 — wired real route.
 */
async function confirmStage(projectId: string): Promise<{ ok: boolean }> {
  try {
    await api.post(
      `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/ocr/confirm`,
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

/** Build real OcrToolServices for injection into the machine. */
export function buildRealOcrToolServices(): OcrToolServices {
  return { ...buildRealStageSettingsServices(), fetchPageTokens, confirmStage };
}
