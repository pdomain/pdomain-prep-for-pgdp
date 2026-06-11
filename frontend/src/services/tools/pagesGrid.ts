/**
 * pagesGrid.ts — Real PagesGridServices backed by the v2 API.
 *
 * Backend routes:
 *   GET  /api/data/projects/{id}/pages (list pages)
 *   GET  /api/data/projects/{id}/pages/{idx0}/stages/{stageId}/thumbnail
 *   PATCH /api/data/projects/{id}/pages/{idx0}  (update page metadata)
 *
 * PagesGridServices expects aggregated crop rows per stage, but the backend
 * has per-page routes. At I1 we aggregate manually.
 *
 * DRIFT: Add GET /api/data/projects/{id}/stages/{stageId}/pages → CropPageRow[]
 * to project_stages.py at I2.
 *
 * @see frontend/src/machines/tools/pagesGrid.ts — PagesGridServices
 */

import { api } from "@/api/client";
import type {
  PagesGridServices,
  CropPageRow,
} from "@/machines/tools/pagesGrid";

interface BackendPage {
  idx0: string;
  n?: number;
  stages?: Record<string, { status: string; flags?: string[] }>;
  bbox?: [number, number, number, number] | null;
  skew_deg?: number | null;
}

/**
 * Fetch all pages for a stage, returning CropPageRow[].
 *
 * Derives thumbnail URL from the page thumbnail endpoint.
 */
async function fetchPages(
  projectId: string,
  stageId: string,
): Promise<CropPageRow[]> {
  try {
    const pages = await api.get<BackendPage[]>(
      `/api/data/projects/${encodeURIComponent(projectId)}/pages`,
    );
    return pages.map((p, i): CropPageRow => {
      const stage = p.stages?.[stageId];
      const thumbUrl = `/api/data/projects/${encodeURIComponent(projectId)}/pages/${encodeURIComponent(p.idx0)}/stages/${encodeURIComponent(stageId)}/thumbnail`;
      return {
        pageId: p.idx0,
        n: p.n ?? i,
        thumbUrl,
        flags: stage?.flags ?? [],
        bbox: p.bbox ?? null,
        skewDeg: p.skew_deg ?? null,
      };
    });
  } catch {
    return [];
  }
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
    const result = await api.patch<BackendPage>(
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
