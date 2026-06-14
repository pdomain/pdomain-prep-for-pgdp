/**
 * sourceTool.ts — Real SourceToolServices backed by the v2 API.
 *
 * SourceToolServices extends StageSettingsServices with:
 *   confirmSelection → POST /api/data/projects/:id/project-stages/source/confirm
 *
 * W4 Group 1: confirm route wired (returns { ok } which we adapt to { pages }).
 * The source stage runs via the project-stage run route and SSE.
 *
 * StageSettingsServices methods come from services/stageSettings.ts.
 *
 * ## Persistence contract
 *
 * markSelectedPages(projectId, idxList, pageType)
 *   → PATCH /api/data/projects/{id}/pages/{idx0} { page_type }
 *     per page in idxList (fire-and-forget per page; errors logged not thrown)
 *
 * setPageIgnore(projectId, idx0, ignore)
 *   → PATCH /api/data/projects/{id}/pages/{idx0} { ignore }
 *     Reversible soft-exclude: ignore=true → skipped, ignore=false → restored.
 *     Event-logged server-side (PageIgnoreSet).
 *
 * insertBlankPage(projectId, afterIdx0)
 *   → POST /api/data/projects/{id}/pages/insert { after_idx0 }
 *     Returns { inserted_page, pages[] } — the caller refreshes the machine.
 *
 * @see frontend/src/machines/tools/source.ts — SourceToolServices
 */

import { api } from "@/api/client";
import type { FileRow, SourceToolServices } from "@/machines/tools/source";
import { buildRealStageSettingsServices } from "@/services/stageSettings";
import { resolveFileState } from "@/pages/pipeline/tools/source/useSourcePages";

// ---------------------------------------------------------------------------
// PageType mapping from FileState
// ---------------------------------------------------------------------------

/**
 * Maps source-tool FileState roles to backend PageType enum values.
 *
 * Backend PageType (models.py): normal | blank | plate_b | plate_p | plate_r | skip | cover
 *
 * Mapping decisions:
 *   page      → "normal"   (body page)
 *   cover     → "cover"    (front cover / endpapers; named with c-prefix)
 *   back      → "skip"     (back matter scans excluded from the package)
 *   blank     → "blank"    (blank scan, included as blank page)
 *   duplicate → "skip"     (duplicate excluded from package)
 *
 * States without a PageType mapping (no PATCH issued):
 *   "ready", "pending", "inserted", "skipped"
 */
export const FILE_STATE_TO_PAGE_TYPE: Record<string, string | null> = {
  page: "normal",
  cover: "cover",
  back: "skip",
  blank: "blank",
  duplicate: "skip",
  // "ready", "pending", "inserted", "skipped" have no PageType mapping
};

// ---------------------------------------------------------------------------
// PATCH page role (bulk)
// ---------------------------------------------------------------------------

/**
 * Persist a role change for multiple pages via PATCH .../pages/{idx0}.
 *
 * Fire-and-forget per page: call errors are logged but do not surface to the
 * machine. The machine's in-memory state is already updated; this write is
 * durable persistence so changes survive reload.
 *
 * @param projectId  The project UUID.
 * @param idxList    List of idx0 values to update.
 * @param pageType   Backend PageType enum value (e.g. "normal", "blank", "cover").
 * @param clearIgnore  When true, also sends { ignore: false } to un-remove
 *   pages that were previously soft-excluded. Use when marking a "skipped"
 *   page as a real role so that both page_type and ignore are updated atomically.
 */
export async function markSelectedPages(
  projectId: string,
  idxList: number[],
  pageType: string,
  clearIgnore = false,
): Promise<void> {
  const body: Record<string, unknown> = { page_type: pageType };
  if (clearIgnore) body["ignore"] = false;
  await Promise.all(
    idxList.map(async (idx0) => {
      try {
        await api.patch<unknown>(
          `/api/data/projects/${encodeURIComponent(projectId)}/pages/${String(idx0)}`,
          body,
        );
      } catch (err) {
        console.error(
          `[sourceTool] markSelectedPages: PATCH idx0=${String(idx0)} failed`,
          err,
        );
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// PATCH page ignore (reversible soft-exclude)
// ---------------------------------------------------------------------------

/**
 * Set ignore=true/false on a page via PATCH .../pages/{idx0} { ignore }.
 *
 * This is the "Remove from project" action — event-logged server-side as
 * PageIgnoreSet. The page remains visible in the grid as "skipped" and is
 * reversible by calling setPageIgnore(projectId, idx0, false).
 *
 * Throws on error so callers can surface failures.
 */
export async function setPageIgnore(
  projectId: string,
  idx0: number,
  ignore: boolean,
): Promise<void> {
  await api.patch<unknown>(
    `/api/data/projects/${encodeURIComponent(projectId)}/pages/${String(idx0)}`,
    { ignore },
  );
}

// ---------------------------------------------------------------------------
// POST insert page
// ---------------------------------------------------------------------------

/** Shape returned by POST .../pages/insert */
interface InsertPageResponse {
  inserted_page: {
    idx0: number;
    source_stem: string;
    ignore: boolean;
    page_type: string;
    thumbnail_key: string | null;
  };
  pages: {
    idx0: number;
    source_stem: string;
    ignore: boolean;
    page_type: string;
    thumbnail_key: string | null;
  }[];
}

/**
 * Insert a blank page after `afterIdx0` via POST .../pages/insert.
 *
 * Returns the response payload so the caller can refresh the machine's
 * file list from the authoritative server list.
 *
 * @throws on HTTP error (not found, out-of-range, etc.)
 */
export async function insertBlankPage(
  projectId: string,
  afterIdx0: number,
): Promise<InsertPageResponse> {
  return api.post<InsertPageResponse>(
    `/api/data/projects/${encodeURIComponent(projectId)}/pages/insert`,
    { after_idx0: afterIdx0 },
  );
}

// ---------------------------------------------------------------------------
// confirmSelection
// ---------------------------------------------------------------------------

/**
 * Confirm the source stage review-complete.
 *
 * Route: POST /api/data/projects/{id}/project-stages/source/confirm
 * Returns { pages: N } — pages is derived from the confirmed_at response
 * since source doesn't have a page-count artifact at confirm time.
 * The machine uses pages count to update its UI state.
 *
 * W4 Group 1 — wire real route (seam-remediation plan).
 */
async function confirmSelection(
  projectId: string,
  _files: FileRow[],
): Promise<{ pages: number }> {
  await api.post<{
    stage_id: string;
    status: string;
    confirmed_at: string;
  }>(
    `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/source/confirm`,
    {},
  );
  // Return pages: 0 — source confirm does not return a page count.
  // The pipeline snapshot provides the authoritative page count via pipelineShell.
  return { pages: 0 };
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real SourceToolServices for injection into the machine. */
export function buildRealSourceToolServices(): SourceToolServices {
  const stageSettingsSvcs = buildRealStageSettingsServices();
  return {
    ...stageSettingsSvcs,
    confirmSelection,
    markSelectedPages,
    setPageIgnore,
    insertBlankPage: async (projectId, afterIdx0) => {
      const result = await insertBlankPage(projectId, afterIdx0);
      // Map InsertPageResponse pages → FileRow[] shape for the machine.
      // Only inserted_page and pages[] are needed; the caller will use
      // pages[] to refresh the machine via REFRESH_FILES.
      return {
        inserted_page: {
          idx: result.inserted_page.idx0,
          stem: result.inserted_page.source_stem,
          // Newly inserted page starts as "ready" (no role yet).
          state: "ready" as const,
        },
        pages: result.pages.map((p) => ({
          idx: p.idx0,
          stem: p.source_stem,
          // Use the same resolveFileState logic as the load path so existing
          // page roles survive the post-insert refresh.
          state: resolveFileState(p.ignore, p.page_type),
        })),
      };
    },
  };
}
