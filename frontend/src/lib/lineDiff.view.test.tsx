/**
 * Component-mount tests for `LineDiffView` — the split-view renderer
 * that paints the `DiffLine[]` produced by `diffLines`. Roadmap §7
 * deferred coverage from §9; pure-function math is tested in
 * `lineDiff.test.ts` (7 cases) — this file covers only the rendering
 * surface (column headers, per-line markup, tint classes, and the
 * delete+insert pairing pass in `buildRows`).
 *
 * Scope is intentionally tiny: assert the visible facts a future
 * regressor would actually break, no DOM-shape snapshots. Tailwind
 * class names are checked only where the colour carries semantic
 * meaning ("this line is a delete / insert / equal") — the layout
 * classes (grid, font, padding) are intentionally out of scope so a
 * styling refactor doesn't churn the test.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DiffLine } from "./lineDiff";
import { LineDiffView } from "./LineDiffView";

describe("LineDiffView", () => {
  it("renders Prior/New column headers", () => {
    render(<LineDiffView diff={[]} />);
    expect(screen.getByText("Prior")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
  });

  it("paints equal/delete/insert lines with the correct tint and content", () => {
    // Crafted by hand rather than running diffLines() so the test
    // pins the renderer's behaviour independent of the LCS pass.
    // One equal line, one paired delete+insert, one lone insert.
    const diff: DiffLine[] = [
      { kind: "equal", priorLineNo: 1, nextLineNo: 1, text: "hello" },
      {
        kind: "delete",
        priorLineNo: 2,
        nextLineNo: null,
        text: "old line",
      },
      {
        kind: "insert",
        priorLineNo: null,
        nextLineNo: 2,
        text: "new line",
      },
      {
        kind: "insert",
        priorLineNo: null,
        nextLineNo: 3,
        text: "extra",
      },
    ];
    render(<LineDiffView diff={diff} />);

    // Equal line shows up once per column (paired).
    const equalCells = screen.getAllByText("hello");
    expect(equalCells).toHaveLength(2);

    // Delete + insert texts each render exactly once (delete on left,
    // insert on right — the LineDiffView pairs them into a single row
    // but neither text is duplicated).
    const oldCell = screen.getByText("old line");
    expect(oldCell).toBeInTheDocument();
    // Walk up to the row to find the tint class — the text span itself
    // has no colour; the row wrapper carries `bg-red-50`.
    expect(oldCell.parentElement?.className).toContain("bg-red-50");

    const newCell = screen.getByText("new line");
    expect(newCell.parentElement?.className).toContain("bg-emerald-50");

    // Lone insert renders too (right-only row with empty left placeholder).
    expect(screen.getByText("extra")).toBeInTheDocument();
  });

  it("pairs adjacent delete+insert into one row (single placeholder count)", () => {
    // A paired delete+insert collapses into one row, so the empty
    // placeholder cells (rendered when one side has no content) only
    // come from the lone-insert/lone-delete cases. Two cases here:
    //   row 0: equal           — no placeholders
    //   row 1: delete+insert   — paired, no placeholders
    //   row 2: lone insert     — left placeholder
    //   row 3: lone delete     — right placeholder
    // → exactly 2 placeholders, regardless of column count.
    const diff: DiffLine[] = [
      { kind: "equal", priorLineNo: 1, nextLineNo: 1, text: "same" },
      { kind: "delete", priorLineNo: 2, nextLineNo: null, text: "x" },
      { kind: "insert", priorLineNo: null, nextLineNo: 2, text: "y" },
      { kind: "insert", priorLineNo: null, nextLineNo: 3, text: "z" },
      { kind: "delete", priorLineNo: 3, nextLineNo: null, text: "w" },
    ];
    const { container } = render(<LineDiffView diff={diff} />);
    // Placeholder rows are the only DOM cells whose only text is the
    // non-breaking space. Counting them is the cleanest assertion that
    // the pairing pass collapsed delete+insert.
    const placeholders = container.querySelectorAll("div.bg-slate-50\\/50");
    expect(placeholders).toHaveLength(2);
  });
});
