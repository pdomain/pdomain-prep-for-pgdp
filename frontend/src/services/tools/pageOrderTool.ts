/**
 * pageOrderTool.ts — Real PageOrderToolServices backed by the v2 API.
 *
 * Backend routes used:
 *   PATCH /api/data/projects/{id}/pages/reorder  → persistOrder
 *   PATCH /api/data/projects/{id}/pages/{idx0}   → persistLeaf (page_type)
 *
 * Role → PageType mapping (design roles → wire values):
 *   "text"    → "normal"
 *   "blank"   → "blank"
 *   "skip"    → "skip"
 *   "cover"   → "cover"
 *   "plate"   → "plate_p" (default plate kind; plateTag in the inspector
 *               determines the exact plate suffix — see SET_PLATE_TAG below)
 *
 * Plate-kind mapping (plateTag → PageType suffix):
 *   The inspector's SET_PLATE_TAG action carries a plateTag string.  The
 *   tag is a human-readable label (e.g. "Plate VIII"), not a kind code.
 *   Plate kind (plate_b / plate_p / plate_r) is a SEPARATE field on the
 *   Leaf that must be set by the user in the inspector.  Until a plate-kind
 *   picker is wired, all plate roles default to "plate_p".
 *
 * Not yet implemented (DIVERGENCES):
 *   PUT  /api/projects/:id/stages/page_order/runs → persistRuns
 *   PUT  /api/projects/:id/stages/page_order/naming → persistNaming
 *   POST /api/projects/:id/stages/page_order/confirm → confirmStage
 *
 *   These are recorded in DIVERGENCES.md §F5.4-services as explicit
 *   future items.  The controls that depend on them (run editing, naming
 *   scheme apply) are NOT hidden — they operate locally in machine context
 *   but the persistence side-effect is a no-op until the routes land.
 *
 * @see frontend/src/machines/tools/pageOrderTool.ts — PageOrderToolServices
 */

import { api } from "@/api/client";
import type {
  PageOrderToolServices,
  Leaf,
  LeafRole,
  Run,
  NamingScheme,
  PageOrderTotals,
} from "@/machines/tools/pageOrderTool";

// ---------------------------------------------------------------------------
// Role → PageType wire value mapping
// ---------------------------------------------------------------------------

/** Map design-layer LeafRole to the wire PageType value sent to the backend. */
function roleToPageType(role: LeafRole): string {
  switch (role) {
    case "text":
      return "normal";
    case "blank":
      return "blank";
    case "skip":
      return "skip";
    case "cover":
      return "cover";
    case "plate":
      // Default to plate_p until a plate-kind picker is wired in the inspector.
      // When SET_PLATE_TAG arrives the inspector will have an explicit kind field.
      return "plate_p";
  }
}

/** Map wire PageType value to design-layer LeafRole. */
function pageTypeToRole(pageType: string): LeafRole {
  if (pageType === "blank") return "blank";
  if (pageType === "skip") return "skip";
  if (pageType === "cover") return "cover";
  if (pageType.startsWith("plate")) return "plate";
  return "text"; // "normal" and any unknown types default to text
}

// ---------------------------------------------------------------------------
// Service implementations
// ---------------------------------------------------------------------------

/**
 * Persist leaf metadata for a single page.
 *
 * Maps the design-layer role to a PageType and PATCHes the page record.
 * Route: PATCH /api/data/projects/{id}/pages/{idx0}
 * Body: { page_type: PageType }
 *
 * The leaf's ``scan`` field is the 0-based scan index (idx0).
 */
async function persistLeaf(projectId: string, leaf: Leaf): Promise<void> {
  const pageType = roleToPageType(leaf.role);
  await api.patch(
    `/api/data/projects/${encodeURIComponent(projectId)}/pages/${leaf.scan}`,
    { page_type: pageType },
  );
}

/**
 * Persist the new page order.
 *
 * Maps to PATCH /api/data/projects/{id}/pages/reorder
 * Body: { order: number[] } — ordered scan indices (0-based).
 */
async function persistOrder(projectId: string, scans: number[]): Promise<void> {
  await api.patch(
    `/api/data/projects/${encodeURIComponent(projectId)}/pages/reorder`,
    { order: scans },
  );
}

/**
 * Persist the full runs array.
 *
 * W4 Group 2 — PUT /api/data/projects/{id}/project-stages/page_order/runs
 */
async function persistRuns(projectId: string, runs: Run[]): Promise<void> {
  await api.put(
    `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/page_order/runs`,
    {
      runs: runs.map((r) => ({
        start_idx: r.span[0],
        style: r.style,
        number_start: r.start.mode === "set" ? r.start.value : 1,
        type_code: r.style === "arabic" ? "p" : "f",
      })),
    },
  );
}

/**
 * Persist the naming scheme.
 *
 * W4 Group 2 — PUT /api/data/projects/{id}/project-stages/page_order/naming
 */
async function persistNaming(
  projectId: string,
  naming: NamingScheme,
): Promise<void> {
  await api.put(
    `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/page_order/naming`,
    { naming },
  );
}

/**
 * Confirm the page order stage (freezes naming manifest).
 *
 * Route: POST /api/data/projects/{id}/project-stages/page_order/confirm
 * W4 Group 1 — wired real route. Marks the page_order project stage clean,
 * recording that the naming manifest is frozen.
 */
async function confirmStage(projectId: string): Promise<{ ok: boolean }> {
  try {
    await api.post(
      `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/page_order/confirm`,
      {},
    );
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// W5.5 — fetchFolios (replaces FOLIO_PUSH/FOLIOS_DONE streaming)
// ---------------------------------------------------------------------------

/** Wire shape of a single page record from GET /api/data/projects/{id}/pages */
interface WirePageRecord {
  idx0: number;
  page_type: string;
  prefix: string;
  source_stem: string;
}

interface WireListPagesResponse {
  pages: WirePageRecord[];
  total: number;
  next_cursor: string | null;
}

/**
 * Fetch all pages for the project and assemble the initial pageOrderTool model.
 *
 * CT decision 2026-06-11: replaces FOLIO_PUSH/FOLIOS_DONE streaming.
 * Calls GET /api/data/projects/{id}/pages (up to 500 pages per request).
 *
 * Transforms the flat page list into:
 *   - leaves: one Leaf per page (role from page_type, ocrFolio from prefix)
 *   - runs: single default body run (at I1, replace with a real runs endpoint)
 *   - totals: derived from the page count
 *
 * See DIVERGENCES.md §W5.5-fetchFolios.
 */
async function fetchFolios(projectId: string): Promise<{
  leaves: Leaf[];
  runs: Run[];
  totals: PageOrderTotals;
}> {
  // Fetch all pages (max 500; projects with >500 pages are degenerate)
  const raw = await api.get<WireListPagesResponse>(
    `/api/data/projects/${encodeURIComponent(projectId)}/pages?limit=500`,
  );

  const leaves: Leaf[] = (raw.pages ?? []).map((p) => ({
    scan: p.idx0,
    role: pageTypeToRole(p.page_type),
    runId: null,
    folioLabel: null,
    // W5.5: ocrFolio from the page prefix (best available at initial load;
    // real folio detection arrives via the page_order artifact at I1).
    ocrFolio: p.prefix || null,
    flags: [],
  }));

  // Default body run covering all pages (placeholder until a real runs
  // endpoint is available — see DIVERGENCES.md §W5.5-fetchFolios).
  const defaultRun: Run = {
    id: "body",
    label: "Body",
    style: "arabic",
    start: { mode: "set", value: 1 },
    step: 1,
    span: [0, Math.max(0, leaves.length - 1)],
  };

  const totals: PageOrderTotals = {
    total: leaves.length,
    scanned: leaves.length,
    outOfSeq: 0,
    gaps: 0,
    duplicates: 0,
  };

  return {
    leaves,
    runs: leaves.length > 0 ? [defaultRun] : [],
    totals,
  };
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/**
 * Build real PageOrderToolServices for injection into the machine.
 *
 * @param onOrderChanged W5.3 — called after DROP; triggers pipelineShell
 *   fan-out of UPSTREAM_CHANGED to all downstream runners. Optional: omitting
 *   disables fan-out (safe default for tests and non-PipelinePage mounts).
 */
export function buildRealPageOrderToolServices(
  onOrderChanged?: () => void,
): PageOrderToolServices {
  return {
    fetchFolios,
    persistLeaf,
    persistOrder,
    persistRuns,
    persistNaming,
    confirmStage,
    // Omit onOrderChanged when not provided to satisfy exactOptionalPropertyTypes.
    ...(onOrderChanged ? { onOrderChanged } : {}),
  };
}
