/**
 * Vitest coverage for the §9a marquee hit-test helper. The Konva
 * mouse-event wiring on `WordBboxOverlay` calls this helper from its
 * mouse-up handler; isolating the math here keeps it testable without
 * mocking Konva pointer events.
 *
 * The cases mirror the standard axis-aligned rect-intersection truth
 * table — partial overlap, full overlap, containment (both
 * directions), disjoint, edge-only contact, identical bbox — plus a
 * couple of feature-specific sanity checks (id-less words skipped,
 * order preserved).
 */
import { describe, expect, it } from "vitest";
import {
  computeMarqueeSelection,
  normaliseMarquee,
  type MarqueeRect,
} from "./marquee";
import type { OcrWord } from "./wordOffsets";

function makeWord(
  id: string,
  left: number,
  top: number,
  width: number,
  height: number,
): OcrWord {
  return {
    id,
    text: id,
    confidence: 0.99,
    bounding_box: { left, top, width, height },
  };
}

describe("normaliseMarquee", () => {
  it("normalises a top-left → bottom-right drag", () => {
    expect(normaliseMarquee(10, 20, 50, 80)).toEqual({
      x: 10,
      y: 20,
      width: 40,
      height: 60,
    });
  });

  it("normalises a bottom-right → top-left drag (negative-direction)", () => {
    expect(normaliseMarquee(50, 80, 10, 20)).toEqual({
      x: 10,
      y: 20,
      width: 40,
      height: 60,
    });
  });

  it("produces a zero-area rect for a click without drag", () => {
    expect(normaliseMarquee(30, 30, 30, 30)).toEqual({
      x: 30,
      y: 30,
      width: 0,
      height: 0,
    });
  });
});

describe("computeMarqueeSelection", () => {
  it("selects a word whose bbox is fully inside the marquee", () => {
    const words = [makeWord("w0", 20, 20, 10, 10)];
    const rect: MarqueeRect = { x: 0, y: 0, width: 100, height: 100 };
    expect(computeMarqueeSelection(words, rect)).toEqual(["w0"]);
  });

  it("selects a word that partially overlaps the marquee", () => {
    // bbox 50..70 × 50..70; marquee 0..60 × 0..60 → overlap 50..60.
    const words = [makeWord("w0", 50, 50, 20, 20)];
    const rect: MarqueeRect = { x: 0, y: 0, width: 60, height: 60 };
    expect(computeMarqueeSelection(words, rect)).toEqual(["w0"]);
  });

  it("selects a word that fully contains the marquee (marquee inside bbox)", () => {
    // bbox 0..100 × 0..100; marquee 40..50 × 40..50 — fully inside.
    const words = [makeWord("w0", 0, 0, 100, 100)];
    const rect: MarqueeRect = { x: 40, y: 40, width: 10, height: 10 };
    expect(computeMarqueeSelection(words, rect)).toEqual(["w0"]);
  });

  it("does not select a disjoint word", () => {
    const words = [makeWord("w0", 200, 200, 10, 10)];
    const rect: MarqueeRect = { x: 0, y: 0, width: 100, height: 100 };
    expect(computeMarqueeSelection(words, rect)).toEqual([]);
  });

  it("does not select on edge-only contact (zero-area overlap)", () => {
    // bbox 100..110 × 0..10; marquee 0..100 × 0..100 — touching edge only.
    const words = [makeWord("w0", 100, 0, 10, 10)];
    const rect: MarqueeRect = { x: 0, y: 0, width: 100, height: 100 };
    expect(computeMarqueeSelection(words, rect)).toEqual([]);
  });

  it("selects when bbox is identical to the marquee rect", () => {
    const words = [makeWord("w0", 10, 10, 30, 30)];
    const rect: MarqueeRect = { x: 10, y: 10, width: 30, height: 30 };
    expect(computeMarqueeSelection(words, rect)).toEqual(["w0"]);
  });

  it("preserves input order across multiple selected words", () => {
    const words = [
      makeWord("w0", 0, 0, 10, 10),
      makeWord("w1", 200, 200, 10, 10), // disjoint
      makeWord("w2", 20, 20, 10, 10),
      makeWord("w3", 50, 50, 10, 10),
    ];
    const rect: MarqueeRect = { x: 0, y: 0, width: 100, height: 100 };
    expect(computeMarqueeSelection(words, rect)).toEqual(["w0", "w2", "w3"]);
  });

  it("skips words without an id (selection is keyed on id)", () => {
    const words: OcrWord[] = [
      makeWord("w0", 10, 10, 5, 5),
      // Synthetic legacy word with empty id — would otherwise overlap.
      { ...makeWord("", 20, 20, 5, 5), id: "" },
    ];
    const rect: MarqueeRect = { x: 0, y: 0, width: 100, height: 100 };
    expect(computeMarqueeSelection(words, rect)).toEqual(["w0"]);
  });

  it("returns empty for a zero-area marquee (e.g. click without drag)", () => {
    const words = [makeWord("w0", 0, 0, 100, 100)];
    const rect: MarqueeRect = { x: 50, y: 50, width: 0, height: 0 };
    expect(computeMarqueeSelection(words, rect)).toEqual([]);
  });
});
