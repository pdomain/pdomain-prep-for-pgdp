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
 * markAsSubmitted: records the GateConfirmation event (gate="submit_confirm")
 * locally. There is no PGDP upload API — submission is a manual step where
 * the user downloads the zip and uploads it to their dpscans folder on
 * pgdp.net. This method records that the user has attested they did so.
 *
 * CT 2026-06-11: liveSubmit removed per CT directive. Submission is non-
 * functional in the automated sense — stub it as manual attestation only.
 *
 * @see frontend/src/machines/tools/submitCheckTool.ts — SubmitCheckToolServices
 * @see docs/specs/api-v2-deltas.md §1.2, §3
 * @see docs/architecture/statechart-convergence-notes.md §Open questions #4 (resolved)
 */

import { api } from "@/api/client";
import type {
  SubmitCheckToolServices,
  SubmitCheck,
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
async function dryRun(projectId: string): Promise<SubmitCheck[]> {
  await api.post(
    `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/submit_check/run`,
  );
  const report = await pollForSubmitCheckArtifact(projectId);
  return adaptSubmitCheckReport(report);
}

/**
 * Record the manual attestation that the user has uploaded the zip to pgdp.net.
 *
 * There is no PGDP upload API. Submission is always a manual step:
 *   1. User downloads the zip via the "Download package" affordance.
 *   2. User uploads the zip to their dpscans folder on pgdp.net.
 *   3. User confirms here — this records the GateConfirmation event
 *      (gate="submit_confirm") in the project aggregate, marking the
 *      submit_check stage clean.
 *
 * Returns the ISO timestamp of the attestation.
 */
async function markAsSubmitted(projectId: string): Promise<{ at: string }> {
  const at = new Date().toISOString();
  // Fire-and-forget: record the gate confirmation event in the project aggregate.
  // The backend route to persist GateConfirmation events is part of the B5
  // route layer. Until B5 is merged, this records locally only.
  try {
    await api.post(
      `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/submit_check/confirm`,
      { gate: "submit_confirm" },
    );
  } catch {
    // Non-blocking: the attestation timestamp is stored in the machine context
    // regardless of backend persistence. The backend will catch up on reindex.
  }
  return { at };
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real SubmitCheckToolServices for injection into the machine. */
export function buildRealSubmitCheckToolServices(): SubmitCheckToolServices {
  return { dryRun, markAsSubmitted };
}
