/**
 * illustrationsTool.ts — Real IllustrationsToolServices backed by the v2 API.
 *
 * All routes are stubbed at I1. The backend runs the illustrations stage
 * via the project-stage run route but has no separate aggregation endpoints.
 *
 * DRIFT: Add POST /api/data/projects/{id}/stages/illustrations/detect
 * and PATCH /api/data/projects/{id}/stages/illustrations/regions/{id}
 * to project_stages.py at I2.
 *
 * @see frontend/src/machines/tools/illustrationsTool.ts — IllustrationsToolServices
 */

import type {
  IllustrationsToolServices,
  IllustrationRegion,
  IllustrationCounts,
} from "@/machines/tools/illustrationsTool";

/**
 * Detect illustration regions.
 *
 * DRIFT: route not implemented at I1 — returns empty result.
 */
function detectRegions(
  _projectId: string,
): Promise<{ items: IllustrationRegion[]; counts: IllustrationCounts }> {
  return Promise.resolve({
    items: [],
    counts: { detected: 0, extracted: 0, review: 0, flagged: 0 },
  });
}

/**
 * Persist an updated illustration region.
 *
 * DRIFT: route not implemented at I1 — no-op.
 */
function persistRegion(
  _projectId: string,
  _region: IllustrationRegion,
): Promise<void> {
  // No-op at I1.
  return Promise.resolve();
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real IllustrationsToolServices for injection into the machine. */
export function buildRealIllustrationsToolServices(): IllustrationsToolServices {
  return { detectRegions, persistRegion };
}
