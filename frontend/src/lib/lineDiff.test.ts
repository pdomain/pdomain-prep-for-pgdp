/**
 * Line-diff tests for the public `diffLines` helper in `lineDiff.ts`.
 * Back-trace details are observed via the returned `DiffLine[]`. The
 * `it` names below preserve the labels of the original inline smoke
 * suite so cross-referencing past commits stays cheap.
 */
import { describe, expect, it } from "vitest";
import { diffLines } from "./lineDiff";

describe("diffLines", () => {
  it("bothEmpty: empty inputs produce empty diff", () => {
    expect(diffLines("", "")).toEqual([]);
  });

  it("identical: every line tagged `equal` with paired line numbers", () => {
    const out = diffLines("a\nb\nc\n", "a\nb\nc\n");
    expect(out).toHaveLength(3);
    expect(out.every((d) => d.kind === "equal")).toBe(true);
    expect(out.map((d) => d.text)).toEqual(["a", "b", "c"]);
    expect(out.map((d) => d.priorLineNo)).toEqual([1, 2, 3]);
    expect(out.map((d) => d.nextLineNo)).toEqual([1, 2, 3]);
  });

  it("pureInserts: empty prior + non-empty next yields all inserts", () => {
    const out = diffLines("", "x\ny\n");
    expect(out).toHaveLength(2);
    expect(out.every((d) => d.kind === "insert")).toBe(true);
    expect(out.map((d) => d.text)).toEqual(["x", "y"]);
    expect(out.map((d) => d.priorLineNo)).toEqual([null, null]);
    expect(out.map((d) => d.nextLineNo)).toEqual([1, 2]);
  });

  it("pureDeletes: non-empty prior + empty next yields all deletes", () => {
    const out = diffLines("x\ny\n", "");
    expect(out).toHaveLength(2);
    expect(out.every((d) => d.kind === "delete")).toBe(true);
    expect(out.map((d) => d.text)).toEqual(["x", "y"]);
    expect(out.map((d) => d.priorLineNo)).toEqual([1, 2]);
    expect(out.map((d) => d.nextLineNo)).toEqual([null, null]);
  });

  it("ocrishSingleWordCorrection: one delete+insert pair, deletes precede inserts", () => {
    const prior = [
      "CHAPTER I.",
      "",
      "It was the best of tirnes,",
      "it was the worst of times,",
      "",
      "the end.",
    ].join("\n");
    const next = [
      "CHAPTER I.",
      "",
      "It was the best of times,",
      "it was the worst of times,",
      "",
      "the end.",
    ].join("\n");
    const out = diffLines(prior, next);
    const kinds = out.map((d) => d.kind);
    expect(kinds.filter((k) => k === "delete")).toHaveLength(1);
    expect(kinds.filter((k) => k === "insert")).toHaveLength(1);
    expect(kinds.filter((k) => k === "equal")).toHaveLength(5);

    // Delete must come before its paired insert (the UI groups
    // adjacent delete+insert into one row — see lineDiff.ts:75).
    const delIdx = kinds.indexOf("delete");
    const insIdx = kinds.indexOf("insert");
    expect(insIdx).toBe(delIdx + 1);
    // noUncheckedIndexedAccess: delIdx/insIdx are valid indices (indexOf found them)
    expect(out[delIdx]!.text).toBe("It was the best of tirnes,");
    expect(out[insIdx]!.text).toBe("It was the best of times,");
  });

  it("trailingNewlineParity: trailing \\n does not produce a phantom blank line", () => {
    const out = diffLines("a\nb\n", "a\nb");
    expect(out).toHaveLength(2);
    expect(out.every((d) => d.kind === "equal")).toBe(true);
    expect(out.map((d) => d.text)).toEqual(["a", "b"]);
  });

  it("trailingNewlineParity: a genuine trailing blank line (input ends \\n\\n) survives", () => {
    const out = diffLines("a\n\n", "a\n\n");
    expect(out).toHaveLength(2);
    expect(out.map((d) => d.text)).toEqual(["a", ""]);
  });
});
