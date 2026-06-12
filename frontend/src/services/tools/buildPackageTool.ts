/**
 * buildPackageTool.ts — Real BuildPackageToolServices backed by the v2 API.
 *
 * Backend routes (api-v2-deltas.md §1.2):
 *   POST /api/data/projects/{id}/project-stages/build_package/run → Job (202)
 *   GET  /api/data/projects/{id}/project-stages/build_package/manifest
 *        → { deliverable: { files: TreeRow[], count }, manifest: { ... } }
 *
 * This replaces the deprecated POST /projects/{id}/build-package flat route
 * (api-v2-deltas.md §1.7: "Removed at I1, Pack group"). The build is
 * fire-and-forget — the manifest route is polled until the stage is clean.
 *
 * Resolved at I2: `buildArtifacts` now POSTs the run then polls the manifest
 * route until the stage completes, returning real { deliverable, manifest }.
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

const MANIFEST_URL = (projectId: string) =>
  `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/build_package/manifest`;

/**
 * Poll until the build_package manifest is available (up to 90 s).
 *
 * Returns { deliverable, manifest } from the structured JSON manifest.
 */
async function pollForManifest(
  projectId: string,
  pollMs = 2000,
  maxAttempts = 45,
): Promise<{ deliverable: BuildDeliverable; manifest: BuildManifest }> {
  const url = MANIFEST_URL(projectId);
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const result = await api.get<{
        deliverable: BuildDeliverable;
        manifest: BuildManifest;
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

/**
 * Build the project package.
 *
 * Enqueues the build via POST, then polls for the structured manifest.
 * Returns real { deliverable, manifest } once the stage completes.
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
    // Ignore run errors — stage may already be running; poll for manifest.
  }
  return pollForManifest(projectId);
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real BuildPackageToolServices for injection into the machine. */
export function buildRealBuildPackageToolServices(): BuildPackageToolServices {
  return { buildArtifacts };
}
