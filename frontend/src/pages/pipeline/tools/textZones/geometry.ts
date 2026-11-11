/**
 * geometry.ts — pure helpers for the Text Zones canvases (W2.4).
 *
 * All zone and split coordinates are normalised fractions of the page image
 * ([0, 1] on both axes), matching the `Zone` and `SplitDraft` machine types
 * and the `normalized: true` split request body.
 */

import type { SplitDraft, ZonePageRow } from "@/machines/tools/textZonesTool";

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

export interface NormBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A drag shorter than this fraction of the page on either axis is a click. */
const MIN_ZONE_FRACTION = 0.01;

const MIN_GUTTER = 0.1;
const MAX_GUTTER = 0.9;

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function round4(v: number): number {
  return Math.round(v * 10_000) / 10_000;
}

/**
 * Turn a drag between two stage-pixel points into a normalised box clipped to
 * the page. Returns null when the drag is too small to be a zone.
 */
export function boxFromDrag(a: Point, b: Point, size: Size): NormBox | null {
  const x0 = clamp01(Math.min(a.x, b.x) / size.w);
  const x1 = clamp01(Math.max(a.x, b.x) / size.w);
  const y0 = clamp01(Math.min(a.y, b.y) / size.h);
  const y1 = clamp01(Math.max(a.y, b.y) / size.h);
  if (x1 - x0 < MIN_ZONE_FRACTION || y1 - y0 < MIN_ZONE_FRACTION) return null;
  return {
    x: round4(x0),
    y: round4(y0),
    w: round4(x1 - x0),
    h: round4(y1 - y0),
  };
}

/** Keep a split gutter between 10% and 90%, rounded to a whole percent. */
export function clampGutter(g: number): number {
  const clamped = Math.min(MAX_GUTTER, Math.max(MIN_GUTTER, g));
  return Math.round(clamped * 100) / 100;
}

/** The gutter position for a pointer on the stage, along the split axis. */
export function gutterFromPointer(
  p: Point,
  size: Size,
  axis: SplitDraft["axis"],
): number {
  return clampGutter(axis === "col" ? p.x / size.w : p.y / size.h);
}

/** The page's integer idx0 for the per-page API routes. */
export function rowIdx0(row: ZonePageRow): number {
  const idx0 = row["idx0"];
  return typeof idx0 === "number" ? idx0 : parseInt(row.idx, 10);
}

function pageBase(projectId: string, idx0: number): string {
  return `/api/data/projects/${encodeURIComponent(projectId)}/pages/${idx0}`;
}

/** The ingest thumbnail: a scaled copy of the source scan. */
export function pageThumbnailUrl(projectId: string, idx0: number): string {
  return `${pageBase(projectId, idx0)}/thumbnail`;
}

/**
 * Images for the zone canvas, best first. Zones are detected on the
 * post_transform_crop binary, so that is the true backdrop; the ingest
 * thumbnail stands in until that stage has a clean artifact.
 */
export function pageImageUrls(projectId: string, idx0: number): string[] {
  return [
    `${pageBase(projectId, idx0)}/stages/post_transform_crop/artifact`,
    pageThumbnailUrl(projectId, idx0),
  ];
}
