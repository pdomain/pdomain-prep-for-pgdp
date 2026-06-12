/**
 * ocrTool.ts — Real OcrToolServices backed by the v2 API.
 *
 * Backend routes:
 *   GET  /api/data/projects/{id}/project-stages/ocr/tokens/{page_id}
 *     (R2 — I2 DRIFT resolved: low-confidence tokens from words.json)
 *   POST /api/data/projects/{id}/project-stages/ocr/confirm  (W4 Group 1)
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
 * Route: GET /api/data/projects/{id}/project-stages/ocr/tokens/{page_id}
 * R2 — I2 DRIFT resolved (seam-remediation plan).
 */
async function fetchPageTokens(
  projectId: string,
  pageId: string,
): Promise<{ tokens: OcrToken[] }> {
  const data = await api.get<{ tokens: OcrToken[] }>(
    `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/ocr/tokens/${encodeURIComponent(pageId)}`,
  );
  return data;
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
