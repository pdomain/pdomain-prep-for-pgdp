/**
 * ocrTool.ts — Real OcrToolServices backed by the v2 API.
 *
 * Backend routes:
 *   GET  /api/data/projects/{id}/pages/{idx0}/stages/wordcheck/flags
 *     (nearest route — at I1 we derive low-score tokens from wordcheck flags)
 *
 * NOT yet implemented (I1 stubs):
 *   GET  /api/projects/:id/stages/ocr/pages  → fetchPageTokens
 *   POST /api/projects/:id/stages/ocr/confirm → confirmStage
 *
 * DRIFT: Add GET /api/data/projects/{id}/stages/ocr/pages + POST confirm
 * to project_stages.py at I2.
 *
 * @see frontend/src/machines/tools/ocrTool.ts — OcrToolServices
 */

import type { OcrToolServices, OcrToken } from "@/machines/tools/ocrTool";

/**
 * Fetch low-score OCR tokens for a page.
 *
 * DRIFT: route not implemented at I1 — returns empty token list.
 */
function fetchPageTokens(
  _projectId: string,
  _pageId: string,
): Promise<{ tokens: OcrToken[] }> {
  return Promise.resolve({ tokens: [] });
}

/**
 * Confirm OCR stage review.
 *
 * DRIFT: route not implemented at I1 — returns { ok: true }.
 */
function confirmStage(_projectId: string): Promise<{ ok: boolean }> {
  return Promise.resolve({ ok: true });
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real OcrToolServices for injection into the machine. */
export function buildRealOcrToolServices(): OcrToolServices {
  return { fetchPageTokens, confirmStage };
}
