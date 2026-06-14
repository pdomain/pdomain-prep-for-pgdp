/**
 * Estimation helpers for the Grayscale tool.
 * Mirrors the design-canvas model from grayscale.jsx.
 *
 *   GPU ≈ 0.18 s/MP (CUDA-backed neighbourhood sampler)
 *   CPU ≈ 2.5  s/MP (numpy fallback, single-threaded)
 */

import type { GrayscaleBackend } from "./types";

const SAMPLE_PAGE = { w: 2364, h: 3568 };

export function estimateSecPerPage(backend: GrayscaleBackend): number {
  const mp = (SAMPLE_PAGE.w * SAMPLE_PAGE.h) / 1_000_000;
  const rate = backend === "gpu" ? 0.18 : 2.5;
  return mp * rate;
}

export function fmtSec(s: number): string {
  if (s < 10) return `~${s.toFixed(1)}s`;
  if (s < 60) return `~${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return rem ? `~${m}m ${rem}s` : `~${m}m`;
}

export function fmtProjectTotal(perPageSec: number, n: number): string {
  const total = perPageSec * n;
  if (total < 90) return `${Math.round(total)}s`;
  if (total < 3600) return `${Math.round(total / 60)}m`;
  return `${(total / 3600).toFixed(1)}h`;
}

/**
 * Build the artifact URL for a page's grayscale output.
 *   /api/data/projects/{projectId}/pages/{idx0}/stages/grayscale/artifact
 */
export function grayscaleArtifactUrl(
  projectId: string,
  idx0: number,
  lastRunAt?: number | null,
): string {
  const base = `/api/data/projects/${encodeURIComponent(projectId)}/pages/${idx0}/stages/grayscale/artifact`;
  return lastRunAt != null ? `${base}?v=${lastRunAt}` : base;
}

/**
 * Build the URL for a page's ingest-time color thumbnail.
 *   GET /api/data/projects/{projectId}/pages/{idx0}/thumbnail
 *
 * This route is served from the BlobStore (written during ingest) and is
 * available for every page immediately after the source/thumbnail ingest
 * stage completes.  It is the authoritative color-source image for the
 * before pane in the grayscale workbench.
 *
 * Previously this function built a URL for the `manual_deskew_pre` stage
 * artifact, which is not a V2_PAGE_STAGE_IDS member and therefore always
 * returned 422.  That has been corrected here (OQ-5).
 */
export function sourceArtifactUrl(projectId: string, idx0: number): string {
  return `/api/data/projects/${encodeURIComponent(projectId)}/pages/${idx0}/thumbnail`;
}

/**
 * Build the URL for a page's grayscale stage thumbnail (small PNG).
 *   GET /api/data/projects/{projectId}/pages/{idx0}/stages/grayscale/thumbnail
 *
 * Returns 404 when the grayscale stage has not yet run or is not clean.
 * Callers should fall back to sourceArtifactUrl() (the ingest color thumbnail)
 * when this returns a non-200 status (OQ-4).
 */
export function grayscaleStageThumbnailUrl(
  projectId: string,
  idx0: number,
  lastRunAt?: number | null,
): string {
  const base = `/api/data/projects/${encodeURIComponent(projectId)}/pages/${idx0}/stages/grayscale/thumbnail`;
  return lastRunAt != null ? `${base}?v=${lastRunAt}` : base;
}
