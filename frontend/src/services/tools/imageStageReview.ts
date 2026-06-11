/**
 * imageStageReview.ts — Real ImageStageReviewServices backed by the v2 API.
 *
 * Backend routes used (W4 Group 3 — now real):
 *   GET  /api/data/projects/{id}/project-stages/{stageId}/pages  (aggregate)
 *   POST /api/data/projects/{id}/project-stages/{stageId}/rerun  (batched rerun)
 *
 * W4 Group 1 — confirm routes (real):
 *   POST /api/data/projects/{id}/project-stages/{stageId}/confirm
 *
 * @see frontend/src/machines/imageStageReview.ts — ImageStageReviewServices
 */

import { api } from "@/api/client";
import type { ImageStageReviewServices } from "@/machines/imageStageReview";
import type { PageRow, Totals } from "@/machines/imageStageReview";

/**
 * Fetch all pages for a stage.
 *
 * W4 Group 3: GET /api/data/projects/{id}/project-stages/{stageId}/pages
 * Returns { rows: PageRow[], totals: Totals } directly from the aggregate route.
 */
async function fetchStagePages(
  projectId: string,
  stageId: string,
): Promise<{ rows: PageRow[]; totals: Totals }> {
  try {
    const result = await api.get<{ rows: PageRow[]; totals: Totals }>(
      `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/${encodeURIComponent(stageId)}/pages`,
    );
    return result;
  } catch {
    return {
      rows: [],
      totals: {
        total: 0,
        clean: 0,
        flagged: 0,
        done: 0,
        reviewed: 0,
        errors: 0,
        running: 0,
      },
    };
  }
}

/**
 * Re-run a stage for specific pages (batched).
 *
 * W4 Group 3: POST /api/data/projects/{id}/project-stages/{stageId}/rerun
 * Body: { page_ids: string[] }
 * Returns the updated PageRow[] for the re-run scope.
 */
async function reRunPages(
  projectId: string,
  stageId: string,
  _draft: Record<string, unknown>,
  pageIds: string[],
): Promise<PageRow[]> {
  try {
    const result = await api.post<{ rows: PageRow[] }>(
      `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/${encodeURIComponent(stageId)}/rerun`,
      { page_ids: pageIds },
    );
    return result.rows;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return pageIds.map((idx, i) => ({
      idx,
      prefix: idx,
      state: "failed",
      flags: [msg],
      pageNumber: i,
    }));
  }
}

// The image-stage-review bespoke confirm routes (W4 Group 1) are project-level
// stage confirms. Not all imageStageReview stage_ids have bespoke confirm routes —
// only the stages explicitly named in W4: text_zones, ocr. The other image-prep
// stages (grayscale, crop, threshold, deskew, denoise, dewarp, post_transform_crop,
// post_ocr_crop, canvas_map) fall back to a no-op since they don't have a
// review-complete concept (they're auto-processed, not reviewer-attested).
//
// The imageStageReview machine uses confirmStage(projectId, stageId) generically.

/** Stage IDs that have bespoke W4 confirm routes. */
const _CONFIRMABLE_STAGE_IDS = new Set([
  "text_zones",
  "ocr",
  "text_review",
  "wordcheck",
]);

/**
 * Confirm stage review-complete.
 *
 * W4 Group 1: calls POST /api/data/projects/{id}/project-stages/{stageId}/confirm
 * for stages that have bespoke confirm routes. Falls back to { ok: true } for
 * image-prep stages (grayscale, crop, threshold, deskew, etc.) which don't have
 * a reviewer-attestation confirm concept.
 */
async function confirmStage(
  projectId: string,
  stageId: string,
): Promise<{ ok: boolean }> {
  if (!_CONFIRMABLE_STAGE_IDS.has(stageId)) {
    // No bespoke confirm route for this stage — succeed silently.
    return { ok: true };
  }
  try {
    await api.post(
      `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/${encodeURIComponent(stageId)}/confirm`,
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

/** Build real ImageStageReviewServices for injection into the machine. */
export function buildRealImageStageReviewServices(): ImageStageReviewServices {
  return { fetchStagePages, reRunPages, confirmStage };
}
