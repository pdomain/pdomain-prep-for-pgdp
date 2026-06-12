/**
 * pagesGrid.ts — Real PagesGridServices backed by the v2 API.
 *
 * Backend routes:
 *   GET  /api/data/projects/{id}/project-stages/{stageId}/crop-pages
 *     (R2 — I2 DRIFT resolved: dedicated CropPageRow aggregate)
 *   PATCH /api/data/projects/{id}/pages/{idx0}  (update page metadata)
 *
 * Error contract: fetchPages MUST throw on non-2xx so the machine reaches
 * the `loadError` state and renders the error banner. The previous
 * `catch { return [] }` silently hid errors from the consumer.
 *
 * @see frontend/src/machines/tools/pagesGrid.ts — PagesGridServices
 */

import { api } from "@/api/client";
import type {
  PagesGridServices,
  CropPageRow,
} from "@/machines/tools/pagesGrid";

interface BackendCropPage {
  pageId: string;
  n: number;
  thumbUrl: string;
  flags: string[];
  bbox?: [number, number, number, number] | null;
  skewDeg?: number | null;
}

/**
 * Fetch all pages for a stage, returning CropPageRow[].
 *
 * Route: GET /api/data/projects/{id}/project-stages/{stageId}/crop-pages
 * R2 — I2 DRIFT resolved (seam-remediation plan).
 *
 * NOTE: errors are NOT caught here. The machine's `loading.onError`
 * transitions to `loadError` — the UI renders a retry banner. Swallowing
 * the error with `return []` would silently show an empty grid on 404/409.
 */
async function fetchPages(
  projectId: string,
  stageId: string,
): Promise<CropPageRow[]> {
  const data = await api.get<{ pages: BackendCropPage[] }>(
    `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/${encodeURIComponent(stageId)}/crop-pages`,
  );
  return data.pages.map(
    (p): CropPageRow => ({
      pageId: p.pageId,
      n: p.n,
      thumbUrl: p.thumbUrl,
      flags: p.flags,
      bbox: p.bbox ?? null,
      skewDeg: p.skewDeg ?? null,
    }),
  );
}

/**
 * Save updated crop page row.
 *
 * At I1 maps to PATCH /api/data/projects/{id}/pages/{idx0} for bbox/skew.
 */
async function savePage(
  projectId: string,
  _stageId: string,
  draft: CropPageRow,
): Promise<CropPageRow> {
  try {
    const result = await api.patch<{
      bbox?: [number, number, number, number] | null;
      skew_deg?: number | null;
    }>(
      `/api/data/projects/${encodeURIComponent(projectId)}/pages/${encodeURIComponent(draft.pageId)}`,
      {
        bbox: draft.bbox ?? null,
        skew_deg: draft.skewDeg ?? null,
      },
    );
    return {
      ...draft,
      bbox: result.bbox ?? null,
      skewDeg: result.skew_deg ?? null,
    };
  } catch {
    // Return draft unchanged on error.
    return draft;
  }
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real PagesGridServices for injection into the machine. */
export function buildRealPagesGridServices(): PagesGridServices {
  return { fetchPages, savePage };
}
