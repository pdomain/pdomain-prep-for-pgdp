/**
 * grayscaleTool.ts — Real GrayscaleToolServices backed by the v2 API.
 *
 * Routes (R2 imagetools — DRIFT resolved):
 *   POST /api/data/projects/{id}/project-stages/grayscale/detect
 *          → { mode, why, backend }
 *
 * @see frontend/src/machines/tools/grayscaleTool.ts — GrayscaleToolServices
 */

import { api } from "@/api/client";
import type {
  GrayscaleToolServices,
  GrayscaleMode,
  GrayscaleBackend,
} from "@/machines/tools/grayscaleTool";
// W5.2 — include real stageSettings methods (save-as-default / revert / reset)
import { buildRealStageSettingsServices } from "@/services/stageSettings";

/**
 * Detect grayscale profile by sampling page images.
 *
 * POST /api/data/projects/{id}/project-stages/grayscale/detect
 * → { mode, why, backend }
 *
 * Backend heuristic: samples up to 8 page images, measures chromatic energy.
 * Returns "perceptual" for colour-biased sources, "standard" for B&W line art.
 */
async function detectProfile(
  projectId: string,
): Promise<{ mode: GrayscaleMode; why: string; backend: GrayscaleBackend }> {
  return api.post<{
    mode: GrayscaleMode;
    why: string;
    backend: GrayscaleBackend;
  }>(
    `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/grayscale/detect`,
  );
}

// ---------------------------------------------------------------------------
// Run stage (project-wide)
// ---------------------------------------------------------------------------

async function runStage(
  projectId: string,
  stageId: string,
  settings: Record<string, unknown>,
): Promise<void> {
  await api.post(
    `/api/data/projects/${encodeURIComponent(projectId)}/project-stages/${encodeURIComponent(stageId)}/run`,
    settings,
  );
}

// ---------------------------------------------------------------------------
// Run single page stage
// ---------------------------------------------------------------------------

async function runPageStage(
  projectId: string,
  stageId: string,
  idx0: number,
): Promise<void> {
  await api.post(
    `/api/data/projects/${encodeURIComponent(projectId)}/pages/${idx0}/stages/${encodeURIComponent(stageId)}/run`,
  );
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real GrayscaleToolServices for injection into the machine. */
export function buildRealGrayscaleToolServices(): GrayscaleToolServices {
  return {
    ...buildRealStageSettingsServices(),
    detectProfile,
    runStage,
    runPageStage,
  };
}
