/**
 * Word-offset tests for `buildWordOffsetIndex` / `offsetToWord` /
 * `wordToRange`, plus edge-case coverage (out-of-range wordToRange,
 * half-open boundary semantics on offsetToWord).
 */
import { describe, expect, it } from "vitest";
import {
  buildWordOffsetIndex,
  offsetToWord,
  wordToRange,
  type OcrWord,
} from "./wordOffsets";

function mkWord(id: string, text: string): OcrWord {
  return {
    id,
    text,
    confidence: 1,
    bounding_box: { left: 0, top: 0, width: 0, height: 0 },
  };
}

describe("buildWordOffsetIndex", () => {
  it("basicSingleLine: anchors each word at its first whitespace-delimited occurrence", () => {
    const text = "hello world";
    const idx = buildWordOffsetIndex(text, [
      mkWord("a", "hello"),
      mkWord("b", "world"),
    ]);
    expect(idx.ranges[0]).toEqual({ start: 0, end: 5 });
    expect(idx.ranges[1]).toEqual({ start: 6, end: 11 });
  });

  it("multilineWithBlankLine: blank line counts as whitespace between words", () => {
    const text = "alpha beta\n\ngamma\n";
    const idx = buildWordOffsetIndex(text, [
      mkWord("a", "alpha"),
      mkWord("b", "beta"),
      mkWord("c", "gamma"),
    ]);
    expect(idx.ranges[0]).toEqual({ start: 0, end: 5 });
    expect(idx.ranges[1]).toEqual({ start: 6, end: 10 });
    expect(idx.ranges[2]).toEqual({ start: 12, end: 17 });
  });

  it("fusedDropCap: drop-cap word resolves; bounded-search recovers the fused remainder", () => {
    // Behaviour matches the inline case docstring: the bounded forward
    // search picks up "EADER!" via indexOf even though there's no
    // whitespace separator. Pinning current behaviour — if we tighten
    // the matcher later, this test deliberately fails so we revisit.
    const text = "R'EADER! continues here\n";
    const idx = buildWordOffsetIndex(text, [
      mkWord("a", "R'"),
      mkWord("b", "EADER!"),
      mkWord("c", "continues"),
      mkWord("d", "here"),
    ]);
    expect(idx.ranges[0]).toEqual({ start: 0, end: 2 });
    expect(idx.ranges[1]).toEqual({ start: 2, end: 8 });
    expect(idx.ranges[2]?.start).toBe(9);
    expect(idx.ranges[3]?.start).toBe(19);
  });

  it("unmatched word is null and does not poison later matches", () => {
    const idx = buildWordOffsetIndex("one three", [
      mkWord("a", "one"),
      mkWord("b", "two"),
      mkWord("c", "three"),
    ]);
    expect(idx.ranges[0]).toEqual({ start: 0, end: 3 });
    expect(idx.ranges[1]).toBeNull();
    expect(idx.ranges[2]).toEqual({ start: 4, end: 9 });
  });

  it("empty word list: ranges array is empty and lookups return null", () => {
    const idx = buildWordOffsetIndex("anything", []);
    expect(idx.ranges).toHaveLength(0);
    expect(idx.sorted).toHaveLength(0);
    expect(offsetToWord(idx, 0)).toBeNull();
    expect(wordToRange(idx, 0)).toBeNull();
  });

  it("empty/whitespace-only word.text values are recorded as null", () => {
    const idx = buildWordOffsetIndex("hello world", [
      mkWord("a", "hello"),
      mkWord("b", ""),
      mkWord("c", "   "),
      mkWord("d", "world"),
    ]);
    expect(idx.ranges[0]).toEqual({ start: 0, end: 5 });
    expect(idx.ranges[1]).toBeNull();
    expect(idx.ranges[2]).toBeNull();
    expect(idx.ranges[3]).toEqual({ start: 6, end: 11 });
  });
});

describe("offsetToWord", () => {
  // Shared index for boundary tests.
  const idx = buildWordOffsetIndex("hello world", [
    mkWord("a", "hello"),
    mkWord("b", "world"),
  ]);

  it("offset at word start hits that word", () => {
    expect(offsetToWord(idx, 0)?.wordIndex).toBe(0);
    expect(offsetToWord(idx, 6)?.wordIndex).toBe(1);
  });

  it("offset at last char of word still hits that word", () => {
    expect(offsetToWord(idx, 4)?.wordIndex).toBe(0);
    expect(offsetToWord(idx, 10)?.wordIndex).toBe(1);
  });

  it("half-open semantics: offset === range.end is NOT in the word", () => {
    // hello = [0,5); offset 5 is the gap (whitespace), not "hello".
    expect(offsetToWord(idx, 5)).toBeNull();
    // world = [6,11); offset 11 is past the end.
    expect(offsetToWord(idx, 11)).toBeNull();
  });

  it("blank-line gap returns null", () => {
    const idx2 = buildWordOffsetIndex("alpha beta\n\ngamma\n", [
      mkWord("a", "alpha"),
      mkWord("b", "beta"),
      mkWord("c", "gamma"),
    ]);
    // index 11 lands on the second \n inside the blank-line gap.
    expect(offsetToWord(idx2, 11)).toBeNull();
  });
});

describe("wordToRange", () => {
  const idx = buildWordOffsetIndex("hello world", [
    mkWord("a", "hello"),
    mkWord("b", "world"),
  ]);

  it("returns the resolved range for an in-bounds index", () => {
    expect(wordToRange(idx, 0)).toEqual({ start: 0, end: 5 });
    expect(wordToRange(idx, 1)).toEqual({ start: 6, end: 11 });
  });

  it("returns null for negative or past-end wordIndex", () => {
    expect(wordToRange(idx, -1)).toBeNull();
    expect(wordToRange(idx, 2)).toBeNull();
    expect(wordToRange(idx, 999)).toBeNull();
  });
});
