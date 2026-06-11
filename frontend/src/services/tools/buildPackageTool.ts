/**
 * buildPackageTool.ts — Real BuildPackageToolServices backed by the v2 API.
 *
 * The backend has POST /api/data/projects/{id}/build-package (exists at I1).
 * The machine expects a more structured response; we adapt from the backend.
 *
 * Backend POST /projects/{id}/build-package returns a Job or a result dict.
 * At I1, treat as fire-and-forget; SSE delivers build progress/done events.
 *
 * DRIFT: The machine expects buildArtifacts → { deliverable, manifest }.
 * The real backend build-package runs via the project-stage run route and
 * pushes results via SSE. At I2, expose GET for build manifest + artifact list.
 *
 * @see frontend/src/machines/tools/buildPackageTool.ts — BuildPackageToolServices
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
 * At I1: POST /api/data/projects/{id}/build-package as a fire-and-forget.
 * The actual build is driven by the project-stage run; SSE delivers progress.
 * Returns a stub deliverable/manifest; real data comes via SSE PREFLIGHT_PUSH.
 */
async function buildArtifacts(
  projectId: string,
  _checksumAlgo: ChecksumAlgo,
): Promise<{ deliverable: BuildDeliverable; manifest: BuildManifest }> {
  try {
    await api.post(
      `/api/data/projects/${encodeURIComponent(projectId)}/build-package`,
    );
  } catch {
    // Best-effort — SSE delivers the real result.
  }

  // Return stub; real manifest comes via SSE at I2.
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
