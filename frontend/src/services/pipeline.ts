/**
 * pipeline.ts — Real service implementations for PipelinePage machines.
 *
 * Implements:
 *   - PipelineShellServices (fetchPipeline)
 *   - StageRunnerServices (runStage, requestCancel, requestPause)
 *   - ProjectSettingsServices (fetchSettings, saveField, saveAutomation, runDestructive)
 *
 * At I1, these replace the stub "not yet wired (I1)" placeholders in PipelinePage.tsx.
 *
 * ## Page-stage run strategy (I1)
 *
 * The `runStage` service uses the synchronous run path (async=false).
 * The backend runs the stage in-process and returns the final PageStageState.
 * The sseActor receives STAGE_PUSH events in parallel; reconcile() handles
 * any race between the HTTP response and SSE push. For long-running stages
 * (OCR, ~30s) this blocks until complete — async mode is the I2 optimisation.
 *
 * ## Project-stage run strategy (I1)
 *
 * Project-scoped stages (page_order, validation, ...) always run async.
 * The POST returns a Job; the sseActor delivers `project-stage-status` pushes.
 * stageRunner.reconcile() drives the machine to the terminal state when
 * the push arrives.
 *
 * @see frontend/src/machines/pipelineShell.ts  — PipelineShellServices
 * @see frontend/src/machines/stageRunner.ts    — StageRunnerServices
 * @see frontend/src/machines/projectSettings.ts — ProjectSettingsServices
 * @see docs/specs/api-v2-deltas.md §1.1, §1.2, §1.5
 */

import { api } from "@/api/client";
import type {
  PipelineShellServices,
  AutomationToggles,
} from "@/machines/pipelineShell";
import type {
  StageRunnerServices,
  RunStageOutcome,
} from "@/machines/stageRunner";
import type {
  ProjectSettingsServices,
  ProjectSettingsValues,
  DestructiveAction,
} from "@/machines/projectSettings";
import type {
  PipelineSnapshot,
  PageStageState,
  ProjectStageState,
} from "@/mocks/types";
import { STAGE_DEFS } from "@/machines/pipelineShell";

// ---------------------------------------------------------------------------
// PipelineShellServices — real implementation
// ---------------------------------------------------------------------------

/**
 * fetchPipeline: GET /api/data/projects/{id}/pipeline
 *
 * Returns PipelineSnapshot shape (project + page_stages_summary + project_stages
 * + automation). The backend returns JSON-serialised dict; cast directly.
 *
 * @see docs/specs/api-v2-deltas.md §1.5
 */
async function fetchPipeline(projectId: string): Promise<PipelineSnapshot> {
  return api.get<PipelineSnapshot>(
    `/api/data/projects/${encodeURIComponent(projectId)}/pipeline`,
  );
}

// ---------------------------------------------------------------------------
// StageRunnerServices — real implementation
// ---------------------------------------------------------------------------

/**
 * runStage: POST /api/data/projects/{id}/pages/{idx0}/stages/{stageId}/run
 *   (for page-scoped stages, idx0 derived from stageId context — see note)
 * OR: POST /api/data/projects/{id}/project-stages/{stageId}/run
 *   (for project-scoped stages)
 *
 * The stageRunner machine calls this with projectId and stageId.
 * We derive page-scoped vs project-scoped from the stageId.
 *
 * For page-scoped stages: uses pageIdx=0 (first page) as the canonical page
 * for the stage run. This is incorrect for multi-page runs — the real I1
 * fix should pass the active pageId from the machine context. At I1,
 * running a stage on "the project" means running it on all pages via the
 * job runner; we use the sync path on page 0 for compatibility.
 *
 * DIVERGENCE NOTE (I1): StageRunner is conceptually project-level for the
 * pipeline shell (run all pages of a stage). The current backend has per-page
 * run routes. At I1 we use the project-stage run route for project-scoped
 * stages, and page 0 as a placeholder for page-scoped stages. Full multi-page
 * orchestration is the I2 work.
 */
async function runStage(
  projectId: string,
  stageId: string,
  request?: { force?: boolean },
): Promise<RunStageOutcome> {
  const stageDef = STAGE_DEFS.find((s) => s.id === stageId);
  const isProjectScoped = stageDef ? !stageDef.pageScoped : false;

  if (isProjectScoped) {
    // Project-scoped stage: POST /api/data/projects/{id}/project-stages/{stageId}/run
    // Always async; SSE reconcile drives the machine to final state.
    try {
      await api.post<ProjectStageState>(
        `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/${encodeURIComponent(stageId)}/run`,
        request ? { force: request.force } : null,
      );
      // Return "running" outcome — sseActor will push the final status.
      return { status: "running" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { status: "error", message: msg };
    }
  }

  // Page-scoped stage: POST .../pages/0000/stages/{stageId}/run (sync)
  // Uses idx0=0 as placeholder — full per-page orchestration is I2.
  try {
    const result = await api.post<
      PageStageState | { status: number; id: string }
    >(
      `/api/data/projects/${encodeURIComponent(projectId)}/pages/0000/stages/${encodeURIComponent(stageId)}/run`,
      request ? { force: request.force } : null,
    );

    // Synchronous path returns PageStageState; translate to RunStageOutcome.
    if ("stage_id" in result) {
      const row = result;
      if (row.status === "failed") {
        return {
          status: "error",
          message: row.error_message ?? "Stage failed",
        };
      }
      if (row.status === "flagged") {
        return { status: "flagged", flaggedPages: [] };
      }
      return { status: "clean" };
    }

    // Async path (202 Job) — treat as running; SSE delivers final status.
    return { status: "running" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: "error", message: msg };
  }
}

async function requestCancel(
  projectId: string,
  stageId: string,
): Promise<void> {
  try {
    await api.post(
      `/api/data/projects/${encodeURIComponent(projectId)}/stages/${encodeURIComponent(stageId)}/cancel`,
    );
  } catch {
    // Cancel is a best-effort hint — ignore errors.
  }
}

async function requestPause(
  _projectId: string,
  _stageId: string,
): Promise<void> {
  // Pause not yet implemented in the backend. No-op at I1.
}

// ---------------------------------------------------------------------------
// ProjectSettingsServices — real implementation
// ---------------------------------------------------------------------------

/**
 * fetchSettings: GET /api/data/projects/{id} + /pipeline for automation.
 *
 * The backend stores project config in Project.config. Automation toggles
 * are in PipelineSnapshot.automation. At I1 we fetch both in sequence.
 */
async function fetchSettings(projectId: string): Promise<{
  values: ProjectSettingsValues;
  automation: AutomationToggles;
}> {
  const [project, snapshot] = await Promise.all([
    api.get<{
      id: string;
      name: string;
      config: Record<string, unknown>;
    }>(`/api/data/projects/${encodeURIComponent(projectId)}`),
    api
      .get<{
        automation?: Record<string, unknown>;
      }>(`/api/data/projects/${encodeURIComponent(projectId)}/pipeline`)
      .catch(() => ({ automation: {} })),
  ]);

  const values: ProjectSettingsValues = {
    name: project.name,
    ...project.config,
  };

  const rawAuto: Record<string, unknown> = snapshot.automation ?? {};
  const automation: AutomationToggles = {
    autoRunAfterIngest:
      typeof rawAuto["autoRunAfterIngest"] === "boolean"
        ? rawAuto["autoRunAfterIngest"]
        : false,
    rerunDownstreamOnStale:
      typeof rawAuto["rerunDownstreamOnStale"] === "boolean"
        ? rawAuto["rerunDownstreamOnStale"]
        : false,
    notifyOnError:
      typeof rawAuto["notifyOnError"] === "boolean"
        ? rawAuto["notifyOnError"]
        : false,
    pauseOnFlagPct:
      typeof rawAuto["pauseOnFlagPct"] === "number"
        ? rawAuto["pauseOnFlagPct"]
        : 0,
  };

  return { values, automation };
}

/**
 * saveField: PATCH /api/data/projects/{id}/config
 *
 * Sends the updated field as a partial config patch.
 */
async function saveField(
  projectId: string,
  key: string,
  value: unknown,
): Promise<void> {
  await api.patch(
    `/api/data/projects/${encodeURIComponent(projectId)}/config`,
    { project_config: { [key]: value } },
  );
}

/**
 * saveAutomation: PATCH /api/data/projects/{id}/config
 *
 * Automation toggles are stored in project config at I1.
 */
async function saveAutomation(
  projectId: string,
  automation: AutomationToggles,
): Promise<void> {
  await api.patch(
    `/api/data/projects/${encodeURIComponent(projectId)}/config`,
    {
      project_config: {
        auto_run_after_ingest: automation.autoRunAfterIngest,
        rerun_downstream_on_stale: automation.rerunDownstreamOnStale,
        notify_on_error: automation.notifyOnError,
        pause_on_flag_pct: automation.pauseOnFlagPct,
      },
    },
  );
}

/**
 * runDestructive: POST /api/data/projects/{id}/settings/danger/{action}
 *
 * Only "delete" has a backend route at I1. Other destructive actions are
 * deferred. "delete" maps to DELETE /api/data/projects/{id}.
 */
async function runDestructive(
  projectId: string,
  action: DestructiveAction,
): Promise<{ ok: boolean; message?: string }> {
  if (action === "delete") {
    await api.delete(`/api/data/projects/${encodeURIComponent(projectId)}`);
    return { ok: true };
  }
  // reset / purge not yet implemented at I1.
  return { ok: false, message: `Action '${action}' not yet implemented` };
}

// ---------------------------------------------------------------------------
// Exported factory functions
// ---------------------------------------------------------------------------

/**
 * Build real PipelineShellServices backed by the v2 API.
 *
 * @param runnerSvcs — StageRunnerServices instance (same for all runners)
 */
export function buildRealPipelineShellServices(
  runnerSvcs: StageRunnerServices,
): PipelineShellServices {
  return {
    fetchPipeline,
    runnerServices: runnerSvcs,
  };
}

/** Build real StageRunnerServices backed by the v2 run routes. */
export function buildRealStageRunnerServices(): StageRunnerServices {
  return { runStage, requestCancel, requestPause };
}

/** Build real ProjectSettingsServices backed by the project config routes. */
export function buildRealProjectSettingsServices(): ProjectSettingsServices {
  return { fetchSettings, saveField, saveAutomation, runDestructive };
}
