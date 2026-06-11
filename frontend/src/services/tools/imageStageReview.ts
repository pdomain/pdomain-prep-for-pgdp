/**
 * imageStageReview.ts — Real ImageStageReviewServices backed by the v2 API.
 *
 * Backend routes used:
 *   GET  /api/data/projects/{id}/pages/{idx0}/stages   (list page stages)
 *   POST /api/data/projects/{id}/pages/{idx0}/stages/{stageId}/run   (rerun)
 *
 * NOTE: The machine expects:
 *   GET  /api/projects/:id/stages/:stageId/pages -> { rows, totals }
 *   POST /api/projects/:id/stages/:stageId/rerun -> PageRow[]
 *   POST /api/projects/:id/stages/:stageId/confirm -> { ok }
 *
 * None of these exact aggregation routes exist at I1. We use the per-page
 * stage list + summary from GET /projects/{id}/pipeline instead, and fall
 * back to stub responses.
 *
 * DRIFT: Add GET /api/data/projects/{id}/stages/{stageId}/pages (aggregate
 * page summary per stage) to project_stages.py at I2.
 *
 * @see frontend/src/machines/imageStageReview.ts — ImageStageReviewServices
 */

import { api } from "@/api/client";
import type { ImageStageReviewServices } from "@/machines/imageStageReview";
import type { PageRow, Totals } from "@/machines/imageStageReview";

/**
 * Fetch all pages for a stage from the pipeline snapshot.
 *
 * At I1: GET /api/data/projects/{id}/pipeline and extract page_stages_summary
 * entries matching stageId. Returns PageRow[] shaped from the summary.
 *
 * DRIFT: replace with GET /api/data/projects/{id}/stages/{stageId}/pages
 */
async function fetchStagePages(
  projectId: string,
  stageId: string,
): Promise<{ rows: PageRow[]; totals: Totals }> {
  try {
    const snapshot = await api.get<{
      page_stages_summary?: {
        idx0: string;
        stages: Record<
          string,
          { status: string; error_message?: string | null }
        >;
      }[];
    }>(`/api/data/projects/${encodeURIComponent(projectId)}/pipeline`);

    const summary = snapshot.page_stages_summary ?? [];
    const rows: PageRow[] = summary.map((page, i) => {
      const stage = page.stages[stageId] ?? { status: "clean" };
      const row: PageRow = {
        idx: page.idx0,
        prefix: page.idx0,
        state: stage.status as PageRow["state"],
        pageNumber: i,
      };
      if (stage.error_message) {
        row.flags = [stage.error_message];
      }
      return row;
    });

    const totals: Totals = {
      total: rows.length,
      clean: rows.filter((r) => r.state === "clean").length,
      flagged: rows.filter((r) => r.state === "flagged").length,
      done: rows.filter((r) => r.state === "clean" || r.state === "reviewed")
        .length,
      reviewed: rows.filter((r) => r.state === "reviewed").length,
      errors: rows.filter((r) => r.state === "failed").length,
      running: rows.filter((r) => r.state === "running").length,
    };

    return { rows, totals };
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
 * Re-run a stage for specific pages.
 *
 * At I1: POST .../pages/{idx0}/stages/{stageId}/run for each page.
 * Returns the updated PageRow[] (converted from run results).
 *
 * DRIFT: replace with POST /api/data/projects/{id}/stages/{stageId}/rerun
 */
async function reRunPages(
  projectId: string,
  stageId: string,
  _draft: Record<string, unknown>,
  pageIds: string[],
): Promise<PageRow[]> {
  const results: PageRow[] = [];

  for (const idx0 of pageIds) {
    try {
      const result = await api.post<{
        status?: string;
        error_message?: string | null;
      }>(
        `/api/data/projects/${encodeURIComponent(projectId)}/pages/${encodeURIComponent(idx0)}/stages/${encodeURIComponent(stageId)}/run`,
        null,
      );
      const row: PageRow = {
        idx: idx0,
        prefix: idx0,
        state: (result.status ?? "clean") as PageRow["state"],
        pageNumber: results.length,
      };
      if (result.error_message) {
        row.flags = [result.error_message];
      }
      results.push(row);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        idx: idx0,
        prefix: idx0,
        state: "failed",
        flags: [msg],
        pageNumber: results.length,
      });
    }
  }

  return results;
}

/**
 * Confirm stage review.
 *
 * DRIFT: POST /api/data/projects/{id}/stages/{stageId}/confirm does not exist
 * at I1. No-op stub — returns { ok: true }.
 */
function confirmStage(
  _projectId: string,
  _stageId: string,
): Promise<{ ok: boolean }> {
  // Route not yet implemented at I1.
  return Promise.resolve({ ok: true });
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real ImageStageReviewServices for injection into the machine. */
export function buildRealImageStageReviewServices(): ImageStageReviewServices {
  return { fetchStagePages, reRunPages, confirmStage };
}
