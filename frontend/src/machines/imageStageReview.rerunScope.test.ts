import { describe, expect, it } from "vitest";
import { rerunPageIds, type PageRow } from "./imageStageReview";

function row(idx: string, flags: string[]): PageRow {
  return { idx, prefix: idx, state: "flagged", flags, pageNumber: 0 };
}

const rows = [
  row("0000", ["speckle"]),
  row("0001", ["speckle", "inkBleed"]),
  row("0002", ["inkBleed"]),
];

describe("rerunPageIds", () => {
  it("uses only the open page for this-page", () => {
    expect(
      rerunPageIds({
        editing: "0000",
        selected: ["0002"],
        applyTo: "this",
        rows,
      }),
    ).toEqual(["0000"]);
  });

  it("adds the selection for selected", () => {
    expect(
      rerunPageIds({
        editing: "0000",
        selected: ["0000", "0002"],
        applyTo: "selected",
        rows,
      }),
    ).toEqual(["0000", "0002"]);
  });

  it("adds pages sharing a flag for same-flag", () => {
    expect(
      rerunPageIds({
        editing: "0000",
        selected: [],
        applyTo: "sameIssue",
        rows,
      }),
    ).toEqual(["0000", "0001"]);
  });

  it("falls back to the selection when no page is open", () => {
    expect(
      rerunPageIds({
        editing: null,
        selected: ["0001"],
        applyTo: "this",
        rows,
      }),
    ).toEqual(["0001"]);
  });
});
