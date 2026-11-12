import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import {
  clearPageTier,
  fetchAllTier,
  fetchResolved,
  overridesAt,
  saveAllTier,
  savePageTier,
  saveProjectTier,
} from "./stageTiers";

afterEach(() => {
  vi.restoreAllMocks();
});

const PAGE = "/api/data/projects/p%201/pages/3/stages/denoise/settings";

describe("stage tier requests", () => {
  it("loads the resolved settings for a page", async () => {
    const get = vi
      .spyOn(api, "get")
      .mockResolvedValue({ effective: {}, sources: {} });

    await fetchResolved("p 1", "denoise", 3);

    expect(get).toHaveBeenCalledWith(`${PAGE}/resolved`);
  });

  it("saves a page override", async () => {
    const put = vi.spyOn(api, "put").mockResolvedValue({});

    await savePageTier("p 1", "denoise", 3, { skip_denoise: true });

    expect(put).toHaveBeenCalledWith(`${PAGE}/page`, { skip_denoise: true });
  });

  it("clears a page override", async () => {
    const del = vi.spyOn(api, "delete").mockResolvedValue({});

    await clearPageTier("p 1", "denoise", 3);

    expect(del).toHaveBeenCalledWith(`${PAGE}/page`);
  });

  it("saves a project default", async () => {
    const put = vi.spyOn(api, "put").mockResolvedValue({});

    await saveProjectTier("p 1", "denoise", { min_component_area: 9 });

    expect(put).toHaveBeenCalledWith(
      "/api/data/projects/p%201/stages/denoise/settings",
      { min_component_area: 9 },
    );
  });

  it("reads and writes the app-wide tier", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue({});
    const put = vi.spyOn(api, "put").mockResolvedValue({});

    await fetchAllTier("deskew");
    await saveAllTier("deskew", { skip_auto_deskew: false });

    expect(get).toHaveBeenCalledWith("/api/data/settings/stages/deskew");
    expect(put).toHaveBeenCalledWith("/api/data/settings/stages/deskew", {
      skip_auto_deskew: false,
    });
  });
});

describe("overridesAt", () => {
  it("keeps only the fields resolved from that tier", () => {
    expect(
      overridesAt(
        {
          effective: { a: 1, b: 2, c: 3 },
          sources: { a: "page", b: "project", c: "page" },
        },
        "page",
      ),
    ).toEqual({ a: 1, c: 3 });
  });
});
