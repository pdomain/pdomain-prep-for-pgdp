/**
 * regexPass.ts — Real RegexPassServices backed by the v2 API.
 *
 * DRIFT: Neither GET rules nor POST apply route exists at I1.
 * Stubbed; add to project_stages.py at I2.
 *
 * @see frontend/src/machines/tools/regexPass.ts — RegexPassServices
 */

import type {
  RegexPassServices,
  RegexRule,
  RegexCounts,
} from "@/machines/tools/regexPass";
// W5.2 — include real stageSettings methods (save-as-default / revert / reset)
import { buildRealStageSettingsServices } from "@/services/stageSettings";

/**
 * Fetch regex rules and counts.
 *
 * DRIFT: route not implemented at I1 — returns empty rules list.
 */
function fetchRules(_projectId: string): Promise<{
  rules: RegexRule[];
  counts: RegexCounts;
  snapshotId: string | null;
}> {
  return Promise.resolve({
    rules: [],
    counts: { rules: 0, applied: 0, review: 0, pending: 0, matches: 0 },
    snapshotId: null,
  });
}

/**
 * Apply a single regex rule.
 *
 * DRIFT: route not implemented at I1.
 */
function applyRule(
  _projectId: string,
  _ruleId: string,
): Promise<{ rule: RegexRule; counts: RegexCounts }> {
  return Promise.reject(
    new Error("RegexPass.applyRule not yet implemented at I1"),
  );
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real RegexPassServices for injection into the machine. */
export function buildRealRegexPassServices(): RegexPassServices {
  return { ...buildRealStageSettingsServices(), fetchRules, applyRule };
}
