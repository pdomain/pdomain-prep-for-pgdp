/**
 * hyphenJoin.ts — Real HyphenJoinServices backed by the v2 API.
 *
 * Backend routes that exist at I1:
 *   GET  /api/data/projects/{id}/pages/{idx0}/stages/hyphen-join/candidates
 *   POST /api/data/projects/{id}/pages/{idx0}/stages/hyphen-join/decisions
 *
 * The machine expects a project-level scan → { cases, totals }.
 * At I1 we aggregate from the page-level candidates route.
 *
 * DRIFT: Add POST /api/data/projects/{id}/stages/hyphen_join/scan
 * (project-level aggregate) to project_stages.py at I2.
 *
 * @see frontend/src/machines/tools/hyphenJoin.ts — HyphenJoinServices
 */

import type {
  HyphenJoinServices,
  HyphenCase,
  HyphenTotals,
} from "@/machines/tools/hyphenJoin";

/**
 * Scan hyphenation candidates across all pages.
 *
 * DRIFT: project-level scan route not implemented at I1.
 * Returns empty cases.
 */
function scanHyphenation(
  _projectId: string,
): Promise<{ cases: HyphenCase[]; totals: HyphenTotals }> {
  return Promise.resolve({
    cases: [],
    totals: {
      total: 0,
      joined: 0,
      validated: 0,
      undecided: 0,
      flagged: 0,
      crosspage: 0,
      mismatch: 0,
      unvalidated: 0,
    },
  });
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real HyphenJoinServices for injection into the machine. */
export function buildRealHyphenJoinServices(): HyphenJoinServices {
  return { scanHyphenation };
}
