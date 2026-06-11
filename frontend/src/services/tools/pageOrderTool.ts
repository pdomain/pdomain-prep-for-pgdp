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
 * DIVERGENCE: route not yet implemented — no-op.
 * Recorded in DIVERGENCES.md §F5.4-services.
 */
function persistRuns(_projectId: string, _runs: Run[]): Promise<void> {
  // No-op: PUT /api/projects/:id/stages/page_order/runs not yet landed.
  return Promise.resolve();
}

/**
 * Persist the naming scheme.
 *
 * DIVERGENCE: route not yet implemented — no-op.
 * Recorded in DIVERGENCES.md §F5.4-services.
 */
function persistNaming(
  _projectId: string,
  _naming: NamingScheme,
): Promise<void> {
  // No-op: PUT /api/projects/:id/stages/page_order/naming not yet landed.
  return Promise.resolve();
}

/**
 * Confirm the page order stage.
 *
 * DIVERGENCE: route not yet implemented — returns { ok: true }.
 * Recorded in DIVERGENCES.md §F5.4-services.
 */
function confirmStage(_projectId: string): Promise<{ ok: boolean }> {
  return Promise.resolve({ ok: true });
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
    persistLeaf,
    persistOrder,
    persistRuns,
    persistNaming,
    confirmStage,
    // Omit onOrderChanged when not provided to satisfy exactOptionalPropertyTypes.
    ...(onOrderChanged ? { onOrderChanged } : {}),
  };
}
