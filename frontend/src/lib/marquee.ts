/**
 * Pure-function helpers for §9a marquee bulk-select on the
 * `WordBboxOverlay` Konva layer.
 *
 * Why a separate file: the runtime path (Konva mouse-event wiring on
 * the Stage) is awkward to unit-test in jsdom because `react-konva` is
 * mocked away and Konva's pointer-event payloads aren't trivial to
 * forge. Hit-testing the marquee rect against word bboxes is the only
 * non-trivial logic in the feature, so it lives here as a pure
 * function with thorough coverage; the overlay just calls it on
 * mouse-up.
 *
 * Coordinate space: the marquee rect is expressed in the **same
 * coordinate space as the word `bounding_box`**, i.e. the natural
 * pixel space of the underlying image. The overlay scales DOM-pixel
 * pointer coordinates back into natural space before calling
 * `computeMarqueeSelection`, which keeps this helper independent of
 * any rendered-size state.
 *
 * Selection semantics: **partial overlap selects** (a marquee that
 * clips even a single pixel of a word's bbox flags it). This matches
 * the typical drag-rectangle UX in image editors / labelers and is
 * what the proofer wants when sweeping over dust speckles.
 */
import type { OcrWord } from "./wordOffsets";

/**
 * Axis-aligned rectangle in image-pixel space.
 *
 * `x` / `y` are the top-left corner; `width` / `height` extend right
 * and down. Negative width/height are not supported — the caller
 * (overlay mouse-up handler) is expected to normalise the marquee
 * drag (anchor → current pointer) into a positive-extent rect before
 * passing it in.
 */
export interface MarqueeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Build a normalised `MarqueeRect` from two pointer coordinates,
 * regardless of drag direction. Lets the overlay capture
 * `{anchorX, anchorY}` on mouse-down and feed the current pointer
 * directly without per-direction branching.
 */
export function normaliseMarquee(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): MarqueeRect {
  const x = Math.min(ax, bx);
  const y = Math.min(ay, by);
  const width = Math.abs(bx - ax);
  const height = Math.abs(by - ay);
  return { x, y, width, height };
}

/**
 * Two axis-aligned rects overlap iff they overlap on **both** axes.
 * Touching edges (zero-area overlap) do not count as overlap; a
 * proofer dragging a 1-pixel-tall marquee shouldn't flag the row
 * below it.
 */
function rectsOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  if (aw <= 0 || ah <= 0 || bw <= 0 || bh <= 0) return false;
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/**
 * Return the ids of every word whose bbox overlaps the marquee rect.
 *
 * Words without an `id` (legacy/synthetic data) are skipped — the
 * delete pipeline is keyed on id, so an unaddressable word can't be
 * staged for deletion anyway.
 *
 * Order is preserved from the input `words` array so the caller can
 * rely on a stable selection sequence (useful for the toolbar's
 * "N selected" count and for tests).
 */
export function computeMarqueeSelection(
  words: readonly OcrWord[],
  rect: MarqueeRect,
): string[] {
  const out: string[] = [];
  for (const w of words) {
    if (!w.id) continue;
    const bb = w.bounding_box;
    if (
      rectsOverlap(
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        bb.left,
        bb.top,
        bb.width,
        bb.height,
      )
    ) {
      out.push(w.id);
    }
  }
  return out;
}
