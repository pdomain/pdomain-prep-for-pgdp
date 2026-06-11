/**
 * validationTool.ts — Real ValidationToolServices backed by the v2 API.
 *
 * The validation stage runs via the project-stage run route (§1.2):
 *   POST /api/data/projects/{id}/project-stages/validation/run  → Job (202)
 *   GET  /api/data/projects/{id}/project-stages/validation/artifact → ValidationReport JSON
 *
 * Adapts ValidationReport { blockers, warnings } → { rules, counts } expected by the machine.
 *
 * DRIFT: persistWaiver has no backend route at I1 — remains a no-op stub.
 * Add POST /api/data/projects/{id}/project-stages/validation/waive at I2.
 *
 * @see frontend/src/machines/tools/validationTool.ts — ValidationToolServices
 * @see docs/specs/api-v2-deltas.md §1.2, §3 — ValidationReport schema
 */

import { api } from "@/api/client";
import type {
  ValidationToolServices,
  ValidationRule,
  ValidationCounts,
} from "@/machines/tools/validationTool";

// ---------------------------------------------------------------------------
// Backend schema types (api-v2-deltas.md §3)
// ---------------------------------------------------------------------------

interface BackendValidationItem {
  page_id: string | null;
  stage_id: string;
  message: string;
  code: string;
}

interface BackendValidationReport {
  project_id: string;
  run_at: string;
  blockers: BackendValidationItem[];
  warnings: BackendValidationItem[];
  blocker_count: number;
  warning_count: number;
  passed: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Poll until the project stage artifact is available (up to 60 s). */
async function pollForArtifact(
  projectId: string,
  stageId: string,
  pollMs = 1500,
  maxAttempts = 40,
): Promise<BackendValidationReport> {
  const artifactUrl = `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/${stageId}/artifact`;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const report = await api.get<BackendValidationReport>(artifactUrl);
      return report;
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== 404) throw err;
      // 404 = stage not yet clean; wait and retry.
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
  throw new Error("validation artifact not available after polling");
}

/** Convert a BackendValidationReport to the machine's { rules, counts } shape. */
function adaptReport(report: BackendValidationReport): {
  rules: ValidationRule[];
  counts: ValidationCounts;
} {
  const rules: ValidationRule[] = [
    ...report.blockers.map(
      (b): ValidationRule => ({
        id: b.code,
        name: b.code,
        level: "error",
        detail: b.message + (b.page_id ? ` (page ${b.page_id})` : ""),
      }),
    ),
    ...report.warnings.map(
      (w): ValidationRule => ({
        id: w.code,
        name: w.code,
        level: "warn",
        detail: w.message + (w.page_id ? ` (page ${w.page_id})` : ""),
      }),
    ),
  ];
  const counts: ValidationCounts = {
    pass: rules.length === 0 ? 1 : 0,
    warn: report.warning_count,
    error: report.blocker_count,
  };
  return { rules, counts };
}

// ---------------------------------------------------------------------------
// Service implementations
// ---------------------------------------------------------------------------

/**
 * Run validation checks.
 *
 * POSTs to the project-stage run route (always async), then polls for the
 * artifact and adapts the ValidationReport to { rules, counts }.
 */
async function runChecks(
  projectId: string,
): Promise<{ rules: ValidationRule[]; counts: ValidationCounts }> {
  // Enqueue the run (202 Accepted).
  await api.post(
    `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/validation/run`,
  );

  // Poll for the artifact (stage transitions: not_run → running → clean).
  const report = await pollForArtifact(projectId, "validation");
  return adaptReport(report);
}

/**
 * Persist a validation rule waiver.
 *
 * Route: POST /api/data/projects/{id}/project-stages/validation/waive
 * W4 Group 4 — real route.
 */
async function persistWaiver(
  projectId: string,
  ruleId: string,
  note: string,
): Promise<{ ok: boolean }> {
  try {
    await api.post(
      `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/validation/waive`,
      { rule_id: ruleId, note },
    );
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real ValidationToolServices for injection into the machine. */
export function buildRealValidationToolServices(): ValidationToolServices {
  return { runChecks, persistWaiver };
}
