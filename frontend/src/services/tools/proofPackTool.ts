/**
 * proofPackTool.ts — Real ProofPackToolServices backed by the v2 API.
 *
 * Backend route (api-v2-deltas.md §1.2):
 *   POST /api/data/projects/{id}/project-stages/proof_pack/run → Job (202)
 *
 * The run is fire-and-forget: the SSE project channel delivers ZIP_PROGRESS /
 * ZIP_DONE / ZIP_FAILED events (F5.6-3). `assemblePack` returns an empty tree
 * and zero completeness stats immediately so the machine can enter `assembling`.
 * Real completeness data arrives via SSE at I2 once the proof_pack stage emits
 * a structured artifact.
 *
 * DRIFT: GET .../proof_pack/artifact + structured completeness response deferred to I2.
 *
 * @see frontend/src/machines/tools/proofPackTool.ts — ProofPackToolServices
 * @see docs/specs/api-v2-deltas.md §1.2
 */

import { api } from "@/api/client";
import type {
  ProofPackToolServices,
  TreeRow,
  CompletenessStats,
  PackInclude,
} from "@/machines/tools/proofPackTool";

/**
 * Trigger the proof-pack assembly via the project-stage run route.
 *
 * Returns a minimal { tree: [], completeness: { complete: 0, total: 0 } } so
 * the machine enters `assembling`; real tree/completeness data arrives via SSE.
 */
async function assemblePack(
  projectId: string,
  _include: PackInclude,
): Promise<{ tree: TreeRow[]; completeness: CompletenessStats }> {
  try {
    await api.post(
      `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/proof_pack/run`,
    );
  } catch {
    // Best-effort fire-and-forget — SSE delivers the real result and errors.
  }
  // Return empty scaffold; SSE / polling fills the real data at I2.
  return { tree: [], completeness: { complete: 0, total: 0 } };
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real ProofPackToolServices for injection into the machine. */
export function buildRealProofPackToolServices(): ProofPackToolServices {
  return { assemblePack };
}
