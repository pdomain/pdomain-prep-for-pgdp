import { describe, it, expect } from "vitest";
import {
  boxFromDrag,
  clampGutter,
  gutterFromPointer,
  pageImageUrls,
  pageThumbnailUrl,
  rowIdx0,
} from "./geometry";

describe("text zones geometry", () => {
  it("normalises a drag in either direction to a box inside the page", () => {
    expect(
      boxFromDrag({ x: 150, y: 300 }, { x: 30, y: 60 }, { w: 300, h: 600 }),
    ).toEqual({ x: 0.1, y: 0.1, w: 0.4, h: 0.4 });
  });

  it("clips a drag that leaves the page", () => {
    expect(
      boxFromDrag({ x: 240, y: 480 }, { x: 400, y: 900 }, { w: 300, h: 600 }),
    ).toEqual({ x: 0.8, y: 0.8, w: 0.2, h: 0.2 });
  });

  it("ignores a click that is too small to be a zone", () => {
    expect(
      boxFromDrag({ x: 10, y: 10 }, { x: 11, y: 12 }, { w: 300, h: 600 }),
    ).toBeNull();
  });

  it("keeps the gutter between 10% and 90% and rounds it to a whole percent", () => {
    expect(clampGutter(0.02)).toBe(0.1);
    expect(clampGutter(0.973)).toBe(0.9);
    expect(clampGutter(0.4249)).toBe(0.42);
  });

  it("reads the gutter from the pointer along the split axis", () => {
    expect(
      gutterFromPointer({ x: 120, y: 50 }, { w: 300, h: 400 }, "col"),
    ).toBe(0.4);
    expect(
      gutterFromPointer({ x: 120, y: 100 }, { w: 300, h: 400 }, "row"),
    ).toBe(0.25);
  });

  it("prefers a row's idx0 and falls back to its zero-padded idx", () => {
    expect(
      rowIdx0({ idx: "0007", prefix: "p008", state: "clean", idx0: 7 }),
    ).toBe(7);
    expect(rowIdx0({ idx: "0012", prefix: "p013", state: "clean" })).toBe(12);
  });

  it("uses the deskewed binary for zones, then the ingest thumbnail", () => {
    expect(pageImageUrls("proj 1", 3)).toEqual([
      "/api/data/projects/proj%201/pages/3/stages/post_transform_crop/artifact",
      "/api/data/projects/proj%201/pages/3/thumbnail",
    ]);
    expect(pageThumbnailUrl("proj 1", 3)).toBe(
      "/api/data/projects/proj%201/pages/3/thumbnail",
    );
  });
});
