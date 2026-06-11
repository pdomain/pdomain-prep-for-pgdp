/**
 * textZonesTool.ts — Real TextZonesToolServices backed by the v2 API.
 *
 * Backend routes used:
 *   POST /api/data/projects/{id}/pages/{idx0}/split
 *
 * NOT yet implemented (I1 stubs):
 *   GET  /api/projects/:id/stages/text_zones/pages    → fetchZonePages
 *   POST /api/projects/:id/stages/text_zones/pages/:pageId/detect → redetectLayout
 *   PUT  /api/projects/:id/stages/text_zones/pages/:pageId/layout → persistLayout
 *   POST /api/projects/:id/stages/text_zones/confirm  → confirmStage
 *
 * DRIFT: Add these aggregation routes to project_stages.py at I2.
 *
 * ## SplitDraft → backend translation (DIVERGENCES F5-3-I1)
 *
 * Machine `SplitDraft` = { axis, into, gutter, conf }
 * Backend `POST /pages/{idx0}/split` expects = { suffixes, bbox }
 *   suffixes: string[] (e.g. ["a", "b"] for 2 splits)
 *   bbox: [x, y, w, h] or null (null = full-page)
 *
 * Translation: gutter → bbox that cuts at the gutter position.
 * We use full-page width/height = 1.0 (normalised) and cut at gutter.
 *   axis=col → bbox_a = [0, 0, gutter, 1], bbox_b = [gutter, 0, 1-gutter, 1]
 *   axis=row → bbox_a = [0, 0, 1, gutter], bbox_b = [0, gutter, 1, 1-gutter]
 *
 * The backend stores split_at_stage and source_crop_bbox on the child pages.
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

// ---------------------------------------------------------------------------
// fetchZonePages — stub at I1
// ---------------------------------------------------------------------------

/**
 * Fetch zone page rows for the text_zones stage.
 *
 * DRIFT: route not implemented — returns empty response at I1.
 */
function fetchZonePages(
  _projectId: string,
): Promise<{ rows: ZonePageRow[]; totals: ZoneTotals }> {
  return Promise.resolve({
    rows: [],
    totals: {
      total: 0,
      clean: 0,
      flagged: 0,
      done: 0,
      reviewed: 0,
      splits: 0,
    },
  });
}

// ---------------------------------------------------------------------------
// applySplit — uses real POST /pages/{idx0}/split
// ---------------------------------------------------------------------------

/**
 * Apply a page split.
 *
 * Translates SplitDraft { axis, gutter } → backend { suffixes, bbox }.
 * Returns SplitResult { parentRow, childRows }.
 *
 * DIVERGENCES F5-3-I1: SplitDraft is the UI model; backend expects suffixes+bbox.
 */
async function applySplit(
  projectId: string,
  pageId: string,
  draft: SplitDraft,
): Promise<SplitResult> {
  // Translate gutter position to bbox pairs.
  // Normalised coordinates: [x, y, w, h] relative to page dimensions.
  const bboxA: [number, number, number, number] =
    draft.axis === "col" ? [0, 0, draft.gutter, 1] : [0, 0, 1, draft.gutter];
  const bboxB: [number, number, number, number] =
    draft.axis === "col"
      ? [draft.gutter, 0, 1 - draft.gutter, 1]
      : [0, draft.gutter, 1, 1 - draft.gutter];

  // Backend accepts suffixes for new child page IDs and bbox for each child.
  // At I1 the endpoint accepts { suffixes, bboxes } where bboxes is a list.
  const result = await api.post<{
    parent?: { idx0?: string; status?: string };
    children?: { idx0?: string; status?: string }[];
  }>(
    `/api/data/projects/${encodeURIComponent(projectId)}/pages/${encodeURIComponent(pageId)}/split`,
    {
      suffixes: ["a", "b"],
      bboxes: [bboxA, bboxB],
    },
  );

  // Adapt backend response → SplitResult shape.
  const parentRow: ZonePageRow = {
    idx: result.parent?.idx0 ?? pageId,
    prefix: pageId,
    state: "split",
  };
  const children = (result.children ?? []).map(
    (child): ZonePageRow => ({
      idx: child.idx0 ?? pageId,
      prefix: child.idx0 ?? pageId,
      state: "clean",
    }),
  );
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
// redetectLayout — stub at I1
// ---------------------------------------------------------------------------

function redetectLayout(
  _projectId: string,
  _pageId: string,
  _currentDraft: Zone[] | null,
): Promise<{ zones: Zone[] }> {
  // Route not yet implemented at I1.
  return Promise.resolve({ zones: [] });
}

// ---------------------------------------------------------------------------
// persistLayout — stub at I1
// ---------------------------------------------------------------------------

function persistLayout(
  _projectId: string,
  _pageId: string,
  _data: { zones?: Zone[]; dismissed?: boolean },
): Promise<{ ok: boolean }> {
  // Route not yet implemented at I1.
  return Promise.resolve({ ok: true });
}

// ---------------------------------------------------------------------------
// confirmStage — stub at I1
// ---------------------------------------------------------------------------

function confirmStage(_projectId: string): Promise<{ ok: boolean }> {
  // Route not yet implemented at I1.
  return Promise.resolve({ ok: true });
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real TextZonesToolServices for injection into the machine. */
export function buildRealTextZonesToolServices(): TextZonesToolServices {
  return {
    fetchZonePages,
    applySplit,
    redetectLayout,
    persistLayout,
    confirmStage,
  };
}
