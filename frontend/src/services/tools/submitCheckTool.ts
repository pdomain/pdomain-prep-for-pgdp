/**
 * submitCheckTool.ts — Real SubmitCheckToolServices backed by the v2 API.
 *
 * Backend routes (api-v2-deltas.md §1.2, §3):
 *   POST /api/data/projects/{id}/project-stages/submit_check/run  → Job (202)
 *   GET  /api/data/projects/{id}/project-stages/submit_check/artifact → SubmitCheckReport JSON
 *
 * dryRun: fires the run, polls for the SubmitCheckReport artifact, adapts
 * { issues, passed } → SubmitCheck[].
 *
 * liveSubmit: there is no separate live-submit backend route at I1 — the
 * submit_check stage itself IS the terminal validation step. Returns a stub
 * timestamp. Add a real POST .../submit route at I2 for pgdp.net upload.
 *
 * DRIFT: liveSubmit backend route deferred to I2.
 *
 * @see frontend/src/machines/tools/submitCheckTool.ts — SubmitCheckToolServices
 * @see docs/specs/api-v2-deltas.md §1.2, §3
 */

import { api } from "@/api/client";
import type {
  SubmitCheckToolServices,
  SubmitCheck,
  SubmitTarget,
} from "@/machines/tools/submitCheckTool";

// ---------------------------------------------------------------------------
// Backend schema types (api-v2-deltas.md §3)
// ---------------------------------------------------------------------------

interface BackendSubmitCheckReport {
  project_id: string;
  run_at: string;
  zip_sha256: string;
  zip_size_bytes: number;
  file_count: number;
  issues: string[];
  passed: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Poll until the project stage artifact is available (up to 60 s). */
async function pollForSubmitCheckArtifact(
  projectId: string,
  pollMs = 1500,
  maxAttempts = 40,
): Promise<BackendSubmitCheckReport> {
  const artifactUrl = `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/submit_check/artifact`;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const report = await api.get<BackendSubmitCheckReport>(artifactUrl);
      return report;
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== 404) throw err;
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
  throw new Error("submit_check artifact not available after polling");
}

/** Adapt SubmitCheckReport { issues, passed } → SubmitCheck[]. */
function adaptSubmitCheckReport(
  report: BackendSubmitCheckReport,
): SubmitCheck[] {
  if (report.passed && report.issues.length === 0) {
    return [{ ok: true, label: "Submission checks passed" }];
  }
  return report.issues.map((issue) => ({ ok: false, label: issue }));
}

// ---------------------------------------------------------------------------
// Service implementations
// ---------------------------------------------------------------------------

/**
 * Dry-run submission checks via the submit_check project stage.
 *
 * Fires POST .../submit_check/run then polls for the SubmitCheckReport artifact.
 * Adapts { issues, passed } → SubmitCheck[].
 */
async function dryRun(
  projectId: string,
  _target: SubmitTarget,
): Promise<SubmitCheck[]> {
  await api.post(
    `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/submit_check/run`,
  );
  const report = await pollForSubmitCheckArtifact(projectId);
  return adaptSubmitCheckReport(report);
}

/**
 * Live submit.
 *
 * DRIFT: No live-submit route exists at I1 — submit_check is the terminal
 * validation step; actual pgdp.net upload is out of scope at I1.
 * Returns a stub timestamp. Add POST .../submit at I2.
 */
function liveSubmit(
  _projectId: string,
  _target: SubmitTarget,
): Promise<{ at: string }> {
  return Promise.resolve({ at: new Date().toISOString() });
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real SubmitCheckToolServices for injection into the machine. */
export function buildRealSubmitCheckToolServices(): SubmitCheckToolServices {
  return { dryRun, liveSubmit };
}
