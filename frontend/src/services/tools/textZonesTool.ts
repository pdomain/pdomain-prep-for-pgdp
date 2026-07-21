/**
 * textZonesTool.ts — Real TextZonesToolServices backed by the v2 API.
 *
 * Backend routes used:
 *   GET  /api/data/projects/{id}/project-stages/text_zones/pages-aggregate → fetchZonePages
 *   POST /api/data/projects/{id}/pages/{idx0}/stages/text_zones/redetect   → redetectLayout
 *   PUT  /api/data/projects/{id}/pages/{idx0}/stages/text_zones/layout      → persistLayout
 *   POST /api/data/projects/{id}/pages/{idx0}/split                         → applySplit
 *   POST /api/data/projects/{id}/project-stages/text_zones/confirm          → confirmStage
 *
 * ## idx0 from pageId
 *
 * The frontend machine identifies pages by string `pageId` (e.g. "0001").
 * The backend redetect/persist routes expect `idx0` as an integer path segment
 * (same as other per-page routes in pages.py).
 * We parse the zero-padded string as an integer: parseInt(pageId, 10).
 *
 * ## SplitDraft → backend translation (W0.5)
 *
 * Machine `SplitDraft` = { axis, into, gutter, conf }
 * Backend `POST /pages/{idx0}/split` expects SplitPageRequest:
 *   suffixes: string[] (e.g. ["a", "b"])
 *   bboxes: [x, y, w, h][] — one per suffix (or single bbox for shared crop)
 *   split_at_stage: string (text_zones tool uses "text_zones")
 *   normalized: true when coords are fractions of the parent source image
 *
 * Translation: gutter → two normalized region boxes.
 *   axis=col → [0,0,gutter,1] + [gutter,0,1-gutter,1]
 *   axis=row → [0,0,1,gutter] + [0,gutter,1,1-gutter]
 *
 * @see frontend/src/machines/tools/textZonesTool.ts — TextZonesToolServices
 * @see docs/specs/api-v2-deltas.md §1.3 — page split route
 */

import { api } from "@/api/client";
import type {
  TextZonesToolServices,
  ZonePageRow,
  ZoneTotals,
  SplitDraft,
  SplitResult,
  Zone,
} from "@/machines/tools/textZonesTool";
// W5.2 — include real stageSettings methods (save-as-default / revert / reset)
import { buildRealStageSettingsServices } from "@/services/stageSettings";

// ---------------------------------------------------------------------------
// fetchZonePages — real route (R2)
// ---------------------------------------------------------------------------

/**
 * Fetch zone page rows for the text_zones stage.
 *
 * Route: GET /api/data/projects/{id}/project-stages/text_zones/pages-aggregate
 * Returns { rows: ZonePageRow[], totals: ZoneTotals }.
 */
async function fetchZonePages(
  projectId: string,
): Promise<{ rows: ZonePageRow[]; totals: ZoneTotals }> {
  const result = await api.get<{ rows: ZonePageRow[]; totals: ZoneTotals }>(
    `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/text_zones/pages-aggregate`,
  );
  return {
    rows: result.rows ?? [],
    totals: {
      total: result.totals?.total ?? 0,
      clean: result.totals?.clean ?? 0,
      flagged: result.totals?.flagged ?? 0,
      done: result.totals?.done ?? 0,
      reviewed: result.totals?.reviewed ?? 0,
      splits: result.totals?.splits ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// applySplit — uses real POST /pages/{idx0}/split
// ---------------------------------------------------------------------------

/**
 * Apply a page split.
 *
 * Translates SplitDraft { axis, gutter } → SplitPageRequest
 * { suffixes, bboxes, split_at_stage, normalized }.
 * Returns SplitResult { parentRow, childRows }.
 */
async function applySplit(
  projectId: string,
  pageId: string,
  draft: SplitDraft,
): Promise<SplitResult> {
  // Normalised coordinates: [x, y, w, h] fractions of parent source image.
  const bboxA: [number, number, number, number] =
    draft.axis === "col" ? [0, 0, draft.gutter, 1] : [0, 0, 1, draft.gutter];
  const bboxB: [number, number, number, number] =
    draft.axis === "col"
      ? [draft.gutter, 0, 1 - draft.gutter, 1]
      : [0, draft.gutter, 1, 1 - draft.gutter];

  // Path uses integer idx0 (parse zero-padded pageId).
  const idx0 = parseInt(pageId, 10);
  const result = await api.post<{
    children?: {
      idx0?: number;
      prefix?: string;
      split_suffix?: string | null;
    }[];
  }>(
    `/api/data/projects/${encodeURIComponent(projectId)}/pages/${idx0}/split`,
    {
      suffixes: ["a", "b"],
      bboxes: [bboxA, bboxB],
      split_at_stage: "text_zones",
      normalized: true,
    },
  );

  // Adapt backend SplitPageResponse → SplitResult shape.
  const parentRow: ZonePageRow = {
    idx: pageId,
    prefix: pageId,
    state: "split",
  };
  const children = (result.children ?? []).map((child): ZonePageRow => {
    const id =
      child.idx0 !== undefined && child.idx0 !== null
        ? String(child.idx0).padStart(4, "0")
        : pageId;
    return {
      idx: id,
      prefix: child.prefix ?? id,
      state: "clean",
    };
  });
  // SplitResult.childRows must be a 2-tuple; pad/trim to ensure this.
  const childA: ZonePageRow = children[0] ?? {
    idx: `${pageId}a`,
    prefix: `${pageId}a`,
    state: "clean",
  };
  const childB: ZonePageRow = children[1] ?? {
    idx: `${pageId}b`,
    prefix: `${pageId}b`,
    state: "clean",
  };
  const childRows: [ZonePageRow, ZonePageRow] = [childA, childB];

  return { parentRow, childRows };
}

// ---------------------------------------------------------------------------
// redetectLayout — real route (R2)
// ---------------------------------------------------------------------------

/**
 * Re-run zone detection on a single page's binary artifact.
 *
 * Route: POST /api/data/projects/{id}/pages/{idx0}/stages/text_zones/redetect
 * Returns { zones: Zone[] } in normalised [0,1] coordinates.
 *
 * pageId is expected to be a zero-padded string (e.g. "0001"); parsed to int
 * for the route's idx0 path segment.
 */
async function redetectLayout(
  projectId: string,
  pageId: string,
  _currentDraft: Zone[] | null,
): Promise<{ zones: Zone[] }> {
  const idx0 = parseInt(pageId, 10);
  const result = await api.post<{ zones: Zone[] }>(
    `/api/data/projects/${encodeURIComponent(projectId)}/pages/${idx0}/stages/text_zones/redetect`,
    {},
  );
  return { zones: result.zones ?? [] };
}

// ---------------------------------------------------------------------------
// persistLayout — real route (R2)
// ---------------------------------------------------------------------------

/**
 * Persist user-edited zones for a single page (dual-write).
 *
 * Route: PUT /api/data/projects/{id}/pages/{idx0}/stages/text_zones/layout
 * Writes zone artifact to disk + marks page_stage row clean.
 *
 * pageId is expected to be a zero-padded string (e.g. "0001"); parsed to int
 * for the route's idx0 path segment.
 */
async function persistLayout(
  projectId: string,
  pageId: string,
  data: { zones?: Zone[]; dismissed?: boolean },
): Promise<{ ok: boolean }> {
  const idx0 = parseInt(pageId, 10);
  const result = await api.put<{ ok: boolean }>(
    `/api/data/projects/${encodeURIComponent(projectId)}/pages/${idx0}/stages/text_zones/layout`,
    data,
  );
  return { ok: result.ok ?? false };
}

// ---------------------------------------------------------------------------
// confirmStage — W4 Group 1: real route
// ---------------------------------------------------------------------------

/**
 * Confirm text_zones stage review-complete.
 *
 * Route: POST /api/data/projects/{id}/project-stages/text_zones/confirm
 * W4 Group 1 — wired real route.
 */
async function confirmStage(projectId: string): Promise<{ ok: boolean }> {
  try {
    await api.post(
      `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/text_zones/confirm`,
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

/** Build real TextZonesToolServices for injection into the machine. */
export function buildRealTextZonesToolServices(): TextZonesToolServices {
  return {
    ...buildRealStageSettingsServices(),
    fetchZonePages,
    applySplit,
    redetectLayout,
    persistLayout,
    confirmStage,
  };
}
