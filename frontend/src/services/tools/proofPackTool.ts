/**
 * proofPackTool.ts — Real ProofPackToolServices backed by the v2 API.
 *
 * Backend routes used:
 *   POST /api/data/projects/{id}/project-stages/proof_pack/run → Job (202)
 *   GET  /api/data/projects/{id}/project-stages/proof_pack/artifact
 *        → { tree: TreeRow[], completeness: { complete, total } }
 *
 * `assemblePack`: POSTs the run (enqueues), then polls the artifact route
 * until the stage is clean and the artifact is available.
 *
 * W4 Group 5 — real structured artifact response.
 *
 * @see frontend/src/machines/tools/proofPackTool.ts — ProofPackToolServices
 * @see docs/specs/api-v2-deltas.md §1.2, §1.4
 */

import { api } from "@/api/client";
import type {
  ProofPackToolServices,
  TreeRow,
  CompletenessStats,
  PackInclude,
} from "@/machines/tools/proofPackTool";

const ARTIFACT_URL = (projectId: string) =>
  `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/proof_pack/artifact`;

/**
 * Poll until the proof_pack artifact is available (up to 90 s).
 *
 * Returns { tree, completeness } from the JSON artifact.
 */
async function pollForArtifact(
  projectId: string,
  pollMs = 2000,
  maxAttempts = 45,
): Promise<{ tree: TreeRow[]; completeness: CompletenessStats }> {
  const url = ARTIFACT_URL(projectId);
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const result = await api.get<{
        tree: TreeRow[];
        completeness: CompletenessStats;
      }>(url);
      return result;
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== 404) throw err;
      // 404 = stage not yet clean; wait and retry.
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
  // Timed out — return empty scaffold so the machine can still render.
  return { tree: [], completeness: { complete: 0, total: 0 } };
}

/**
 * Assemble the proof pack.
 *
 * Enqueues the run via POST, then polls for the structured artifact.
 * Returns real { tree, completeness } once the stage completes.
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
    // Ignore run errors — stage may already be running; poll for artifact.
  }
  return pollForArtifact(projectId);
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real ProofPackToolServices for injection into the machine. */
export function buildRealProofPackToolServices(): ProofPackToolServices {
  return { assemblePack };
}
