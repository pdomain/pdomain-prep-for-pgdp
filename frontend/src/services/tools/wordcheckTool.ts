/**
 * wordcheckTool.ts — Real WordcheckToolServices backed by the v2 API.
 *
 * Backend routes used:
 *   POST /api/data/projects/{id}/wordlist-promotion (promote to library)
 *
 * W4 Group 3 — now real:
 *   POST /api/data/projects/{id}/project-stages/wordcheck/accept-dict
 *   POST /api/data/projects/{id}/project-stages/wordcheck/accept-high
 *   POST /api/data/projects/{id}/project-stages/wordcheck/confirm (W4 G1)
 *
 * At I1: accept-dict and accept-high routes exist but return empty results
 * (no real dictionary-fix or candidate data model yet — I2 TODO).
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
 * W4 Group 3: POST /api/data/projects/{id}/project-stages/wordcheck/accept-dict
 * At I1: returns empty fixedIds (no real fix model yet — I2 TODO).
 */
async function acceptDictionaryFixes(
  projectId: string,
): Promise<{ fixedIds: string[] }> {
  try {
    const result = await api.post<{ fixed_ids: string[] }>(
      `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/wordcheck/accept-dict`,
      {},
    );
    return { fixedIds: result.fixed_ids ?? [] };
  } catch {
    return { fixedIds: [] };
  }
}

/**
 * Accept all high-confidence candidates in the list builder.
 *
 * W4 Group 3: POST /api/data/projects/{id}/project-stages/wordcheck/accept-high
 * At I1: returns empty acceptedIds (no real candidate model yet — I2 TODO).
 */
async function acceptHighConfidence(
  projectId: string,
): Promise<{ acceptedIds: string[] }> {
  try {
    const result = await api.post<{ accepted_ids: string[] }>(
      `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/wordcheck/accept-high`,
      {},
    );
    return { acceptedIds: result.accepted_ids ?? [] };
  } catch {
    return { acceptedIds: [] };
  }
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
