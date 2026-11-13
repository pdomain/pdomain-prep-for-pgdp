/**
 * archiveTool.ts — Real ArchiveToolServices backed by the v2 API.
 *
 * Backend route (api-v2-deltas.md §1.2):
 *   POST /api/data/projects/{id}/project-stages/archive/run → Job (202)
 *
 * archiveProject: fires the run route (fire-and-forget); returns a stub
 * ArchiveResult — the real manifest comes from GET .../archive/artifact.
 *
 * persistItem: PATCH /api/data/projects/{id}/project-stages/archive/items/{name}
 * W4 Group 4 — real route.
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

function archiveItemUrl(projectId: string, name: string): string {
  const encodedName = name
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/archive/items/${encodedName}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isArchiveItem(value: unknown): value is ArchiveItem {
  if (!isRecord(value)) return false;
  const name = value["name"];
  const meta = value["meta"];
  const keep = value["keep"];
  return (
    typeof name === "string" &&
    typeof meta === "string" &&
    typeof keep === "boolean"
  );
}

/**
 * GET the project's stage files. The server list is the keep/drop manifest.
 * A project with no stage files returns no rows.
 */
async function listItems(projectId: string): Promise<ArchiveItem[]> {
  const body: unknown = await api.get<unknown>(
    `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/archive/items`,
  );
  if (!isRecord(body) || !Array.isArray(body["items"])) {
    throw new Error("Archive list response is not a list.");
  }
  return body["items"].filter(isArchiveItem);
}

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
 * Route: PATCH /api/data/projects/{id}/project-stages/archive/items/{name}
 * W4 Group 4 — real route.
 */
async function persistItem(
  projectId: string,
  name: string,
  keep: boolean,
): Promise<{ ok: boolean }> {
  try {
    await api.patch(archiveItemUrl(projectId, name), { keep });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real ArchiveToolServices for injection into the machine. */
export function buildRealArchiveToolServices(): ArchiveToolServices {
  return { archiveProject, persistItem, listItems };
}
