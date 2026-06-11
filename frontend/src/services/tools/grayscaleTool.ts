/**
 * grayscaleTool.ts — Real GrayscaleToolServices backed by the v2 API.
 *
 * NOTE: POST /api/projects/:id/stages/grayscale/detect does not exist at I1.
 * The stage settings GET returns config that includes the detected profile.
 * At I1 we stub detectProfile — real detection is I2.
 *
 * DRIFT: Add POST /api/data/projects/{id}/pages/0000/stages/grayscale/detect
 * to pages.py at I2.
 *
 * @see frontend/src/machines/tools/grayscaleTool.ts — GrayscaleToolServices
 */

import type {
  GrayscaleToolServices,
  GrayscaleMode,
  GrayscaleBackend,
} from "@/machines/tools/grayscaleTool";

/**
 * Detect grayscale profile.
 *
 * DRIFT: route not implemented at I1 — returns a default profile.
 */
function detectProfile(
  _projectId: string,
): Promise<{ mode: GrayscaleMode; why: string; backend: GrayscaleBackend }> {
  // No backend route yet — return sensible default.
  const result: {
    mode: GrayscaleMode;
    why: string;
    backend: GrayscaleBackend;
  } = {
    mode: "perceptual",
    why: "Default (I1 stub — real detection at I2)",
    backend: "cpu",
  };
  return Promise.resolve(result);
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/** Build real GrayscaleToolServices for injection into the machine. */
export function buildRealGrayscaleToolServices(): GrayscaleToolServices {
  return { detectProfile };
}
