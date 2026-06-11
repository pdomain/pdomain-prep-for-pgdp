/**
 * archiveTool.ts — Real ArchiveToolServices backed by the v2 API.
 *
 * DRIFT: Neither archive/run nor archive/items/:name routes exist at I1.
 * The archive stage is deferred — stub both methods.
 *
 * DRIFT: Add POST /api/data/projects/{id}/stages/archive/run and
 * PATCH /api/data/projects/{id}/stages/archive/items/{name} at I2.
 *
 * @see frontend/src/machines/tools/archiveTool.ts — ArchiveToolServices
 */

import type {
  ArchiveToolServices,
  ArchiveItem,
  ArchiveDestination,
  ArchiveRetention,
  ArchiveResult,
} from "@/machines/tools/archiveTool";

/**
 * Run the archive operation.
 *
 * DRIFT: route not implemented at I1 — returns stub result.
 */
function archiveProject(
  _projectId: string,
  items: ArchiveItem[],
  _destination: ArchiveDestination,
  _retention: ArchiveRetention,
): Promise<ArchiveResult> {
  return Promise.resolve({ kept: `${items.length} items`, dropped: "0 B" });
}

/**
 * Persist the keep/drop decision for a single archive item.
 *
 * DRIFT: route not implemented at I1 — returns { ok: true }.
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
