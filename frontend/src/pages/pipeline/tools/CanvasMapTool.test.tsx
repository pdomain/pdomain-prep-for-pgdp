import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { api } from "@/api/client";
import { CanvasMapTool } from "./CanvasMapTool";
import type { ToolSlotProps } from "../toolSlot";

const MOCK_RUNNER_REF = {} as ToolSlotProps["runnerRef"];

const ROWS = [
  { idx: "0000", idx0: 0, prefix: "p001", state: "clean", pageNumber: 0 },
  { idx: "0001", idx0: 1, prefix: "p002", state: "clean", pageNumber: 1 },
];

const ASPECT = {
  points: [
    {
      pageId: "0000",
      idx0: 0,
      prefix: "p001",
      width: 100,
      height: 130,
      ratio: 1.3,
      body: true,
    },
    {
      pageId: "0001",
      idx0: 1,
      prefix: "p002",
      width: 50,
      height: 65,
      ratio: 1.3,
      body: true,
    },
    {
      pageId: "0002",
      idx0: 2,
      prefix: "p003",
      width: 100,
      height: 80,
      ratio: 0.8,
      body: false,
    },
  ],
  bodyRatio: 1.3,
  canvasRatio: 1.294,
};

let aspectResponse: unknown = ASPECT;

function apiGet(path: string): Promise<unknown> {
  if (path.endsWith("/aspect-points")) return Promise.resolve(aspectResponse);
  if (path.endsWith("/stages/canvas_map/settings")) {
    return Promise.resolve({ do_morph: true });
  }
  return Promise.resolve({
    rows: ROWS,
    totals: {
      total: 2,
      clean: 2,
      flagged: 0,
      done: 2,
      reviewed: 0,
      errors: 0,
      running: 0,
    },
  });
}

function renderCanvasMap() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/p/proj1"]}>
        <Routes>
          <Route
            path="/p/:projectId"
            element={
              <CanvasMapTool stageId="canvas_map" runnerRef={MOCK_RUNNER_REF} />
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  aspectResponse = ASPECT;
  vi.spyOn(api, "get").mockImplementation(apiGet);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CanvasMapTool — review surface", () => {
  it("loads real page rows into the shared review tool", async () => {
    renderCanvasMap();

    expect(await screen.findByTestId("page-thumb-0000")).toBeDefined();
    expect(screen.queryByTestId("page-thumb-page-1")).toBeNull();
    expect(api.get).toHaveBeenCalledWith(
      "/api/data/projects/proj1/project-stages/canvas_map/pages",
    );
  });
});

describe("CanvasMapTool — aspect scatter", () => {
  it("draws one mark per measured page, scaled to the largest page", async () => {
    renderCanvasMap();

    const large = await screen.findByTestId("aspect-point-0000");
    const small = screen.getByTestId("aspect-point-0001");

    expect(Number(small.getAttribute("cx"))).toBeLessThan(
      Number(large.getAttribute("cx")),
    );
    expect(Number(small.getAttribute("cy"))).toBeGreaterThan(
      Number(large.getAttribute("cy")),
    );
    expect(large.tagName.toLowerCase()).toBe("circle");
    expect(screen.getByTestId("aspect-point-0002").tagName.toLowerCase()).toBe(
      "rect",
    );
  });

  it("reports measured counts and ratios", async () => {
    renderCanvasMap();

    await screen.findByTestId("aspect-point-0000");

    expect(screen.getByTestId("canvas-map-stat-canvas ratio").textContent).toBe(
      "1.294",
    );
    expect(screen.getByTestId("canvas-map-stat-median ratio").textContent).toBe(
      "1.300",
    );
    expect(screen.getByTestId("canvas-map-stat-body pages").textContent).toBe(
      "2",
    );
    expect(screen.getByTestId("canvas-map-stat-outliers").textContent).toBe(
      "1",
    );
  });

  it("says when no pages have been measured", async () => {
    aspectResponse = { points: [], bodyRatio: null, canvasRatio: 1.294 };
    renderCanvasMap();

    expect(
      await screen.findByText(
        "No page sizes yet. Run post-transform crop first.",
      ),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Re-derive canvas" }),
    ).toHaveProperty("disabled", true);
  });

  it("reports a failed size request", async () => {
    vi.spyOn(api, "get").mockImplementation((path: string) =>
      path.endsWith("/aspect-points")
        ? Promise.reject(new Error("boom"))
        : apiGet(path),
    );
    renderCanvasMap();

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not load the page sizes.",
    );
  });
});

describe("CanvasMapTool — Re-derive", () => {
  it("saves the median ratio and re-runs every page", async () => {
    const put = vi.spyOn(api, "put").mockResolvedValue({});
    const post = vi.spyOn(api, "post").mockResolvedValue({ rows: [] });
    renderCanvasMap();
    await screen.findByTestId("aspect-point-0000");
    await screen.findByTestId("page-thumb-0001");

    fireEvent.click(screen.getByRole("button", { name: "Re-derive canvas" }));

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith(
        "/api/data/projects/proj1/project-stages/canvas_map/rerun",
        { page_ids: ["0000", "0001"], settings: {} },
      );
    });
    expect(put).toHaveBeenCalledWith(
      "/api/data/projects/proj1/stages/canvas_map/settings",
      { do_morph: true, page_h_w_ratio: 1.3 },
    );
  });
});
