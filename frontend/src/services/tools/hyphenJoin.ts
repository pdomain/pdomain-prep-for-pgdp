/**
 * hyphenJoin.ts — Real HyphenJoinServices backed by the v2 API.
 *
 * Backend routes:
 *   POST /api/data/projects/{id}/project-stages/hyphen_join/scan
 *     (R2 — I2 DRIFT resolved: project-level hyphen scan)
 *   GET  /api/data/projects/{id}/pages/{idx0}/stages/hyphen-join/candidates
 *   POST /api/data/projects/{id}/pages/{idx0}/stages/hyphen-join/decisions
 *
 * @see frontend/src/machines/tools/hyphenJoin.ts — HyphenJoinServices
 */

import { api } from "@/api/client";
import type {
  HyphenJoinServices,
  HyphenCase,
  HyphenTotals,
} from "@/machines/tools/hyphenJoin";

/**
 * Scan hyphenation candidates across all pages.
 *
 * Route: POST /api/data/projects/{id}/project-stages/hyphen_join/scan
 * R2 — I2 DRIFT resolved (seam-remediation plan).
 */
async function scanHyphenation(
  projectId: string,
): Promise<{ cases: HyphenCase[]; totals: HyphenTotals }> {
  const data = await api.post<{ cases: HyphenCase[]; totals: HyphenTotals }>(
    `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/hyphen_join/scan`,
    {},
  );
  return data;
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real HyphenJoinServices for injection into the machine. */
export function buildRealHyphenJoinServices(): HyphenJoinServices {
  return { scanHyphenation };
}
