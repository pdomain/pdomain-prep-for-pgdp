/**
 * submitCheckTool.ts — Real SubmitCheckToolServices backed by the v2 API.
 *
 * DRIFT: Neither dry-run nor live-submit routes exist at I1.
 * The submit stage is deferred — stub both methods.
 *
 * DRIFT: Add POST /api/data/projects/{id}/stages/submit_check/dry-run
 * and POST /api/data/projects/{id}/stages/submit_check/submit at I2.
 *
 * @see frontend/src/machines/tools/submitCheckTool.ts — SubmitCheckToolServices
 */

import type {
  SubmitCheckToolServices,
  SubmitCheck,
  SubmitTarget,
} from "@/machines/tools/submitCheckTool";

/**
 * Dry-run submission checks.
 *
 * DRIFT: route not implemented at I1 — returns empty checks.
 */
function dryRun(
  _projectId: string,
  _target: SubmitTarget,
): Promise<SubmitCheck[]> {
  return Promise.resolve([]);
}

/**
 * Live submit.
 *
 * DRIFT: route not implemented at I1 — returns stub timestamp.
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
