/**
 * validationTool.ts — Real ValidationToolServices backed by the v2 API.
 *
 * The validation stage runs via the project-stage run route.
 * Tool-specific aggregation routes are not yet implemented.
 *
 * DRIFT: Add POST /api/data/projects/{id}/stages/validation/run → { rules, counts }
 * and POST /api/data/projects/{id}/stages/validation/waive to project_stages.py at I2.
 *
 * @see frontend/src/machines/tools/validationTool.ts — ValidationToolServices
 */

import type {
  ValidationToolServices,
  ValidationRule,
  ValidationCounts,
} from "@/machines/tools/validationTool";

/**
 * Run validation checks.
 *
 * DRIFT: route not implemented at I1 — returns empty result.
 */
function runChecks(
  _projectId: string,
): Promise<{ rules: ValidationRule[]; counts: ValidationCounts }> {
  return Promise.resolve({
    rules: [],
    counts: { pass: 0, warn: 0, error: 0 },
  });
}

/**
 * Persist a validation rule waiver.
 *
 * DRIFT: route not implemented at I1 — returns { ok: true }.
 */
function persistWaiver(
  _projectId: string,
  _ruleId: string,
  _note: string,
): Promise<{ ok: boolean }> {
  return Promise.resolve({ ok: true });
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real ValidationToolServices for injection into the machine. */
export function buildRealValidationToolServices(): ValidationToolServices {
  return { runChecks, persistWaiver };
}
