/**
 * pageOrderTool.ts — Real PageOrderToolServices backed by the v2 API.
 *
 * Backend routes used:
 *   PATCH /api/data/projects/{id}/pages/reorder  → persistOrder
 *
 * NOT yet implemented (I1 stubs):
 *   PATCH /api/projects/:id/pages/:pageId/leaf   → persistLeaf
 *   PUT   /api/projects/:id/stages/page_order/runs → persistRuns
 *   PUT   /api/projects/:id/stages/page_order/naming → persistNaming
 *   POST  /api/projects/:id/stages/page_order/confirm → confirmStage
 *
 * DRIFT: Add the leaf, runs, naming, and confirm routes at I2.
 *
 * @see frontend/src/machines/tools/pageOrderTool.ts — PageOrderToolServices
 */

import { api } from "@/api/client";
import type {
  PageOrderToolServices,
  Leaf,
  Run,
  NamingScheme,
} from "@/machines/tools/pageOrderTool";

/**
 * Persist leaf metadata for a single page.
 *
 * DRIFT: PATCH /pages/:pageId/leaf route does not exist at I1.
 */
function persistLeaf(_projectId: string, _leaf: Leaf): Promise<void> {
  // No-op at I1 — route not implemented.
  return Promise.resolve();
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
 * DRIFT: route does not exist at I1 — no-op.
 */
function persistRuns(_projectId: string, _runs: Run[]): Promise<void> {
  // No-op at I1.
  return Promise.resolve();
}

/**
 * Persist the naming scheme.
 *
 * DRIFT: route does not exist at I1 — no-op.
 */
function persistNaming(
  _projectId: string,
  _naming: NamingScheme,
): Promise<void> {
  // No-op at I1.
  return Promise.resolve();
}

/**
 * Confirm the page order stage.
 *
 * DRIFT: route does not exist at I1 — returns { ok: true }.
 */
function confirmStage(_projectId: string): Promise<{ ok: boolean }> {
  return Promise.resolve({ ok: true });
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real PageOrderToolServices for injection into the machine. */
export function buildRealPageOrderToolServices(): PageOrderToolServices {
  return {
    persistLeaf,
    persistOrder,
    persistRuns,
    persistNaming,
    confirmStage,
  };
}
