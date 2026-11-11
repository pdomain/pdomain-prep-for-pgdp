import { afterEach, describe, expect, it, vi } from "vitest";
import { runManageAction } from "./projects";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runManageAction saveCopy", () => {
  it("starts a browser download of the export", async () => {
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function record(this: HTMLAnchorElement) {
        clicked.push(this);
      },
    );

    const result = await runManageAction("p 1", "saveCopy");

    expect(result).toEqual({ action: "saveCopy" });
    expect(clicked).toHaveLength(1);
    expect(clicked[0]?.getAttribute("href")).toBe(
      "/api/data/projects/p%201/export",
    );
    expect(clicked[0]?.hasAttribute("download")).toBe(true);
  });
});
