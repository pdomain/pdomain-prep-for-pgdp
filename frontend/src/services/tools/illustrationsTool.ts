/**
 * illustrationsTool.ts — Real IllustrationsToolServices backed by the v2 API.
 *
 * Routes (R2 imagetools — DRIFT resolved):
 *   POST  /api/data/projects/{id}/project-stages/illustrations/detect
 *           → { items: IllustrationRegion[], counts: IllustrationCounts }
 *   PATCH /api/data/projects/{id}/project-stages/illustrations/regions/{regionId}
 *           → { ok: boolean }
 *
 * @see frontend/src/machines/tools/illustrationsTool.ts — IllustrationsToolServices
 */

import { api } from "@/api/client";
import type {
  IllustrationsToolServices,
  IllustrationRegion,
  IllustrationCounts,
} from "@/machines/tools/illustrationsTool";

function illustrationsBase(projectId: string): string {
  return `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/illustrations`;
}

/**
 * Detect illustration regions.
 *
 * POST /api/data/projects/{id}/project-stages/illustrations/detect
 * → { items, counts }
 *
 * Returns previously-saved regions seeded from page-extension data.
 * Future: triggers real layout-detector run on source images.
 */
async function detectRegions(
  projectId: string,
): Promise<{ items: IllustrationRegion[]; counts: IllustrationCounts }> {
  return api.post<{ items: IllustrationRegion[]; counts: IllustrationCounts }>(
    `${illustrationsBase(projectId)}/detect`,
  );
}

/**
 * Persist an updated illustration region.
 *
 * PATCH /api/data/projects/{id}/project-stages/illustrations/regions/{regionId}
 * → { ok: boolean }
 */
async function persistRegion(
  projectId: string,
  region: IllustrationRegion,
): Promise<void> {
  await api.patch<{ ok: boolean }>(
    `${illustrationsBase(projectId)}/regions/${encodeURIComponent(region.id)}`,
    region,
  );
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real IllustrationsToolServices for injection into the machine. */
export function buildRealIllustrationsToolServices(): IllustrationsToolServices {
  return { detectRegions, persistRegion };
}
