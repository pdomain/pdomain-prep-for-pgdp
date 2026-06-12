/**
 * regexPass.ts — Real RegexPassServices backed by the v2 API.
 *
 * Routes (R2 imagetools — DRIFT resolved):
 *   GET  /api/data/projects/{id}/project-stages/regex/rules
 *          → { rules, counts, snapshotId }
 *   POST /api/data/projects/{id}/project-stages/regex/rules/{ruleId}/apply
 *          → { rule, counts }
 *
 * @see frontend/src/machines/tools/regexPass.ts — RegexPassServices
 */

import { api } from "@/api/client";
import type {
  RegexPassServices,
  RegexRule,
  RegexCounts,
} from "@/machines/tools/regexPass";
// W5.2 — include real stageSettings methods (save-as-default / revert / reset)
import { buildRealStageSettingsServices } from "@/services/stageSettings";

function regexBase(projectId: string): string {
  return `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/regex`;
}

/**
 * Fetch regex rules and counts.
 *
 * GET /api/data/projects/{id}/project-stages/regex/rules
 * → { rules, counts, snapshotId }
 */
async function fetchRules(projectId: string): Promise<{
  rules: RegexRule[];
  counts: RegexCounts;
  snapshotId: string | null;
}> {
  return api.get<{
    rules: RegexRule[];
    counts: RegexCounts;
    snapshotId: string | null;
  }>(`${regexBase(projectId)}/rules`);
}

/**
 * Apply a single regex rule.
 *
 * POST /api/data/projects/{id}/project-stages/regex/rules/{ruleId}/apply
 * → { rule, counts }
 */
async function applyRule(
  projectId: string,
  ruleId: string,
): Promise<{ rule: RegexRule; counts: RegexCounts }> {
  return api.post<{ rule: RegexRule; counts: RegexCounts }>(
    `${regexBase(projectId)}/rules/${encodeURIComponent(ruleId)}/apply`,
  );
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real RegexPassServices for injection into the machine. */
export function buildRealRegexPassServices(): RegexPassServices {
  return { ...buildRealStageSettingsServices(), fetchRules, applyRule };
}
