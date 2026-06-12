/**
 * zipTool.ts — Real ZipToolServices backed by the v2 API.
 *
 * Backend routes:
 *   POST /api/data/projects/{id}/project-stages/zip/run   (fire-and-forget rebuild)
 *   GET  /api/data/projects/{id}/project-stages/zip/manifest
 *        → { archive: { name, entries, bytes, ratio, sha256 }, tree: TreeRow[] }
 *   GET  /api/data/projects/{id}/project-stages/zip/artifact  (download zip)
 *
 * Resolved at I2: the `fetchManifest` helper reads the structured manifest
 * endpoint so `ZipTool.tsx` can deliver `ZIP_DONE { archive, tree }` to the
 * machine once the project SSE channel reports `stage_id: "zip", status: "clean"`.
 *
 * @see frontend/src/machines/tools/zipTool.ts — ZipToolServices
 * @see frontend/src/pages/pipeline/tools/ZipTool.tsx — SSE wiring
 */

import { api } from "@/api/client";
import type {
  ZipToolServices,
  ZipSettings,
  ZipArchive,
} from "@/machines/tools/zipTool";
import type { TreeRow } from "@/machines/tools/proofPackTool";

/**
 * Request a zip rebuild.
 *
 * POST /api/data/projects/{id}/project-stages/zip/run (fire-and-forget).
 * SSE delivers the `project-stage-status { stage_id: "zip", status: "clean" }`
 * event that triggers `ZipTool.tsx` to fetch the manifest and send ZIP_DONE.
 */
async function requestRebuild(
  projectId: string,
  _settings: ZipSettings,
): Promise<void> {
  try {
    await api.post(
      `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/zip/run`,
    );
  } catch {
    // Best-effort fire-and-forget — SSE delivers result.
  }
}

/**
 * Fetch the structured zip manifest once the stage is clean.
 *
 * Called by `ZipTool.tsx` when the project SSE channel reports
 * `{ type: "project-stage-status", stage_id: "zip", status: "clean" }`.
 *
 * Returns `{ archive, tree }` to pass as ZIP_DONE payload, or null if the
 * manifest is not yet available (caller should ignore and wait for the next
 * SSE event).
 */
export async function fetchZipManifest(
  projectId: string,
): Promise<{ archive: ZipArchive; tree: TreeRow[] } | null> {
  const url = `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/zip/manifest`;
  try {
    const result = await api.get<{ archive: ZipArchive; tree: TreeRow[] }>(url);
    return result;
  } catch {
    return null;
  }
}

/**
 * Get the download URL for the zip artifact.
 *
 * Returns a direct URL to GET /project-stages/zip/artifact.
 * The browser navigates to this URL to download the file.
 */
function downloadArchive(projectId: string): Promise<string> {
  // Return the direct artifact URL for browser navigation.
  // The backend sets Content-Disposition: attachment.
  return Promise.resolve(
    `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/zip/artifact`,
  );
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real ZipToolServices for injection into the machine. */
export function buildRealZipToolServices(): ZipToolServices {
  return { requestRebuild, downloadArchive };
}
