/**
 * proofPackTool.ts — Real ProofPackToolServices backed by the v2 API.
 *
 * DRIFT: POST /api/projects/:id/stages/proof_pack/assemble does not exist.
 * At I1 this is stubbed. Implement at I2 as a project-stage run result.
 *
 * @see frontend/src/machines/tools/proofPackTool.ts — ProofPackToolServices
 */

import type {
  ProofPackToolServices,
  TreeRow,
  CompletenessStats,
  PackInclude,
} from "@/machines/tools/proofPackTool";

/**
 * Assemble the proof pack.
 *
 * DRIFT: route not implemented at I1 — returns empty tree.
 */
function assemblePack(
  _projectId: string,
  _include: PackInclude,
): Promise<{ tree: TreeRow[]; completeness: CompletenessStats }> {
  return Promise.resolve({
    tree: [],
    completeness: { complete: 0, total: 0 },
  });
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real ProofPackToolServices for injection into the machine. */
export function buildRealProofPackToolServices(): ProofPackToolServices {
  return { assemblePack };
}
