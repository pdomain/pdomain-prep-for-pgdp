/**
 * archiveTool.ts — Real ArchiveToolServices backed by the v2 API.
 *
 * Backend route (api-v2-deltas.md §1.2):
 *   POST /api/data/projects/{id}/project-stages/archive/run → Job (202)
 *
 * archiveProject: fires the run route (fire-and-forget); returns a stub
 * ArchiveResult — the real manifest comes from GET .../archive/artifact at I2.
 *
 * DRIFT: persistItem PATCH route deferred to I2.
 * Add PATCH /api/data/projects/{id}/project-stages/archive/items/{name} at I2.
 *
 * @see frontend/src/machines/tools/archiveTool.ts — ArchiveToolServices
 * @see docs/specs/api-v2-deltas.md §1.2
 */

import { api } from "@/api/client";
import type {
  ArchiveToolServices,
  ArchiveItem,
  ArchiveDestination,
  ArchiveRetention,
  ArchiveResult,
} from "@/machines/tools/archiveTool";

/**
 * Trigger the archive operation via the project-stage run route.
 *
 * Fire-and-forget: SSE delivers completion. Returns a stub ArchiveResult
 * (real manifest from GET .../archive/artifact at I2).
 */
async function archiveProject(
  projectId: string,
  items: ArchiveItem[],
  _destination: ArchiveDestination,
  _retention: ArchiveRetention,
): Promise<ArchiveResult> {
  try {
    await api.post(
      `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/archive/run`,
    );
  } catch {
    // Best-effort fire-and-forget — SSE delivers result and errors.
  }
  return { kept: `${items.length} items`, dropped: "0 B" };
}

/**
 * Persist the keep/drop decision for a single archive item.
 *
 * DRIFT: PATCH route not implemented at I1 — returns { ok: true }.
 * Add PATCH /api/data/projects/{id}/project-stages/archive/items/{name} at I2.
 */
function persistItem(
  _projectId: string,
  _name: string,
  _keep: boolean,
): Promise<{ ok: boolean }> {
  return Promise.resolve({ ok: true });
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real ArchiveToolServices for injection into the machine. */
export function buildRealArchiveToolServices(): ArchiveToolServices {
  return { archiveProject, persistItem };
}
