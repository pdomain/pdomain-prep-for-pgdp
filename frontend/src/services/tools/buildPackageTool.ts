/**
 * buildPackageTool.ts — Real BuildPackageToolServices backed by the v2 API.
 *
 * Backend route (api-v2-deltas.md §1.2):
 *   POST /api/data/projects/{id}/project-stages/build_package/run → Job (202)
 *
 * This replaces the deprecated POST /projects/{id}/build-package flat route
 * (api-v2-deltas.md §1.7: "Removed at I1, Pack group"). The build is
 * fire-and-forget — SSE delivers progress and the final artifact.
 *
 * DRIFT: Structured { deliverable, manifest } response deferred to I2 once
 * GET .../project-stages/build_package/artifact returns a structured JSON.
 *
 * @see frontend/src/machines/tools/buildPackageTool.ts — BuildPackageToolServices
 * @see docs/specs/api-v2-deltas.md §1.2, §1.7
 */

import { api } from "@/api/client";
import type {
  BuildPackageToolServices,
  BuildDeliverable,
  BuildManifest,
  ChecksumAlgo,
} from "@/machines/tools/buildPackageTool";

/**
 * Build the project package.
 *
 * POSTs to the v2 project-stage run route (not the deprecated flat route).
 * Returns a stub deliverable/manifest; real data arrives via SSE at I2.
 */
async function buildArtifacts(
  projectId: string,
  _checksumAlgo: ChecksumAlgo,
): Promise<{ deliverable: BuildDeliverable; manifest: BuildManifest }> {
  try {
    await api.post(
      `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/build_package/run`,
    );
  } catch {
    // Best-effort fire-and-forget — SSE delivers the real result and errors.
  }

  // Return scaffold; real manifest comes via SSE / GET artifact at I2.
  const now = new Date().toISOString();
  return {
    deliverable: { files: [], count: 0 },
    manifest: {
      project: projectId,
      pages: 0,
      canvas: "",
      built: now,
      pipeline: "",
      files: 0,
      sha256: "",
    },
  };
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real BuildPackageToolServices for injection into the machine. */
export function buildRealBuildPackageToolServices(): BuildPackageToolServices {
  return { buildArtifacts };
}
