/**
 * zipTool.ts — Real ZipToolServices backed by the v2 API.
 *
 * Backend routes:
 *   GET  /api/data/projects/{id}/project-stages/zip/artifact  (download zip)
 *
 * DRIFT: POST /api/data/projects/{id}/stages/zip/rebuild does not exist.
 * At I1, the zip stage runs via the project-stage run route.
 * requestRebuild → use POST /project-stages/zip/run as fire-and-forget.
 * downloadArchive → use GET /project-stages/zip/artifact.
 *
 * @see frontend/src/machines/tools/zipTool.ts — ZipToolServices
 */

import { api } from "@/api/client";
import type { ZipToolServices, ZipSettings } from "@/machines/tools/zipTool";

/**
 * Request a zip rebuild.
 *
 * At I1: POST /api/data/projects/{id}/project-stages/zip/run (fire-and-forget).
 * SSE delivers ZIP_PROGRESS / ZIP_DONE / ZIP_FAILED.
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
 * Get the download URL for the zip artifact.
 *
 * At I1: returns a direct URL to GET /project-stages/zip/artifact.
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
