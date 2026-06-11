/**
 * wordcheckTool.ts — Real WordcheckToolServices backed by the v2 API.
 *
 * Backend routes used (all exist at I1):
 *   POST /api/data/projects/{id}/wordlist-promotion (promote to library)
 *
 * NOT yet implemented (I1 stubs):
 *   POST /api/projects/:id/stages/scannocheck/accept-dict
 *   POST /api/projects/:id/stages/scannocheck/lists/accept-high
 *   POST /api/projects/:id/stages/scannocheck/confirm
 *
 * DRIFT: Add scannocheck aggregation routes to project_stages.py at I2.
 * The wordcheck flags/decisions routes exist per-page but not as project-level
 * aggregations.
 *
 * @see frontend/src/machines/tools/wordcheckTool.ts — WordcheckToolServices
 * @see src/pdomain_prep_for_pgdp/api/data/pages.py — wordlist-promotion route
 */

import { api } from "@/api/client";
import type {
  WordcheckToolServices,
  ListTotals,
} from "@/machines/tools/wordcheckTool";
// W5.2 — include real stageSettings methods (save-as-default / revert / reset)
import { buildRealStageSettingsServices } from "@/services/stageSettings";

/**
 * Accept all dictionary-matched fixes.
 *
 * DRIFT: route not implemented at I1 — returns empty fixedIds.
 */
function acceptDictionaryFixes(
  _projectId: string,
): Promise<{ fixedIds: string[] }> {
  return Promise.resolve({ fixedIds: [] });
}

/**
 * Accept all high-confidence candidates in the list builder.
 *
 * DRIFT: route not implemented at I1 — returns empty acceptedIds.
 */
function acceptHighConfidence(
  _projectId: string,
): Promise<{ acceptedIds: string[] }> {
  return Promise.resolve({ acceptedIds: [] });
}

/**
 * Promote the project word list to the shared library.
 *
 * Uses POST /api/data/projects/{id}/wordlist-promotion — exists at I1.
 */
async function promoteToLibrary(projectId: string): Promise<ListTotals> {
  try {
    const result = await api.post<ListTotals>(
      `/api/data/projects/${encodeURIComponent(projectId)}/wordlist-promotion`,
    );
    return result;
  } catch {
    return {
      good: 0,
      bad: 0,
      bookGood: 0,
      bookBad: 0,
      libraryGood: 0,
      libraryBad: 0,
    };
  }
}

/**
 * Confirm the wordcheck stage review-complete.
 *
 * Route: POST /api/data/projects/{id}/project-stages/wordcheck/confirm
 * W4 Group 1 — wired real route.
 */
async function confirmStage(projectId: string): Promise<{ ok: boolean }> {
  try {
    await api.post(
      `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/wordcheck/confirm`,
      {},
    );
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real WordcheckToolServices for injection into the machine. */
export function buildRealWordcheckToolServices(): WordcheckToolServices {
  return {
    ...buildRealStageSettingsServices(),
    acceptDictionaryFixes,
    acceptHighConfidence,
    promoteToLibrary,
    confirmStage,
  };
}
