/**
 * Tests for rotate mode in PageWorkbenchPage (issue #100).
 *
 * Acceptance bullets covered:
 * - "Rotate" button in ModeToolbar toggles rotate mode.
 * - Apply fires PATCH config + POST .../manual_deskew_pre/run.
 * - Escape exits rotate mode with no write.
 * - Discrete 90° CW, 90° CCW, 180° buttons immediately fire PATCH + POST.
 * - Existing mode-switching mutually excludes rotate.
 * - Entering rotate mode pre-fills angle from stored config.
 * - Flip affordance is absent.
 */

// Defuse the `react-konva` -> `konva/lib/index-node.js` -> `require("canvas")`
// chain at module-load time. jsdom has no canvas; PageWorkbenchPage's Konva
// canvas would otherwise crash the test runner. Vitest hoists `vi.mock` calls
// above imports so the page's transitive konva import resolves to these stubs.
import type { ReactNode } from "react";
vi.mock("react-konva", () => ({
  Stage: ({
    children,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onClick,
  }: {
    children?: ReactNode;
    onMouseDown?: () => void;
    onMouseMove?: () => void;
    onMouseUp?: () => void;
    onClick?: () => void;
  }) => (
    <div
      data-testid="konva-stage"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onClick={onClick}
    >
      {children}
    </div>
  ),
  Layer: ({ children }: { children?: ReactNode }) => (
    <div data-testid="konva-layer">{children}</div>
  ),
  Image: () => <div data-testid="konva-image" />,
  Rect: ({ onClick }: { onClick?: () => void }) => (
    <div data-testid="konva-rect" onClick={onClick} />
  ),
  Transformer: () => <div data-testid="konva-transformer" />,
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { components } from "../api/types.gen";
import { server } from "../test/server";
import { PageWorkbenchPage } from "./PageWorkbenchPage";

type PageRecord = components["schemas"]["PageRecord"];

function renderWithProviders(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/projects/prj_1/pages/0"]}>
        <Routes>
          <Route path="/projects/:projectId/pages/:idx0" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function makePageRecord(overrides: Partial<PageRecord> = {}): PageRecord {
  return {
    project_id: "prj_1",
    idx0: 0,
    prefix: "001",
    source_stem: "scan_001",
    ignore: false,
    page_type: "normal",
    alignment: "default",
    config_overrides: {
      initial_crop: null,
      white_space_additional: null,
      threshold_level: null,
      fuzzy_pct: null,
      pixel_count_columns: null,
      pixel_count_rows: null,
      skip_auto_deskew: null,
      deskew_before_crop: null,
      deskew_after_crop: null,
      do_morph: null,
      skip_denoise: null,
      use_ocr_bbox_edge: null,
      rotated_standard: null,
      single_dimension_rescale: null,
      manual_deskew_angle: null,
    },
    splits: [],
    illustration_regions: [],
    source_key: null,
    thumbnail_key: null,
    processed_image_key: null,
    ocr_image_key: null,
    processing_status: "pending",
    processing_job_id: null,
    processing_error: null,
    last_processed_at: null,
    outputs: [],
    parent_page_id: null,
    source_crop_bbox: null,
    split_index: null,
    split_at_stage: null,
    split_suffix: null,
    reading_order: 0,
    ...overrides,
  };
}

function setupBasicHandlers(pageRecord: PageRecord = makePageRecord()) {
  server.use(
    http.get("/api/data/projects/prj_1/pages/0", () =>
      HttpResponse.json(pageRecord),
    ),
    http.get("/api/data/projects/prj_1/pages/0/stages", () =>
      HttpResponse.json([]),
    ),
    http.get("/api/data/jobs", () => HttpResponse.json([])),
  );
}

describe("PageWorkbenchPage — rotate mode toolbar", () => {
  it("renders a Rotate button in ModeToolbar", async () => {
    setupBasicHandlers();
    renderWithProviders(<PageWorkbenchPage />);

    await screen.findByRole("button", { name: /^rotate$/i });
  });

  it("does NOT render a Flip button (flip is out of scope)", async () => {
    setupBasicHandlers();
    renderWithProviders(<PageWorkbenchPage />);

    await screen.findByRole("button", { name: /^rotate$/i });
    expect(screen.queryByRole("button", { name: /flip/i })).toBeNull();
  });

  it("clicking Rotate enters rotate mode and shows rotate controls", async () => {
    setupBasicHandlers();
    renderWithProviders(<PageWorkbenchPage />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^rotate$/i }));

    // Rotate mode controls should appear: Apply, Reset, discrete buttons
    await screen.findByRole("button", { name: /^apply$/i });
    expect(screen.getByRole("button", { name: /^reset$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^90° CW$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^90° CCW$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^180°$/i })).toBeTruthy();
  });

  it("switching from rotate to View mode exits rotate controls", async () => {
    setupBasicHandlers();
    renderWithProviders(<PageWorkbenchPage />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^rotate$/i }));
    await screen.findByRole("button", { name: /^apply$/i });

    await user.click(screen.getByRole("button", { name: /^view$/i }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /^apply$/i })).toBeNull();
    });
  });
});

describe("PageWorkbenchPage — rotate mode Apply", () => {
  it("Apply fires PATCH config_overrides then POST manual_deskew_pre/run", async () => {
    setupBasicHandlers();

    const patchCalls: unknown[] = [];
    let runCalled = false;

    server.use(
      http.patch("/api/data/projects/prj_1/pages/0", async ({ request }) => {
        patchCalls.push(await request.json());
        return HttpResponse.json(makePageRecord());
      }),
      http.post(
        "/api/data/projects/prj_1/pages/0/stages/manual_deskew_pre/run",
        () => {
          runCalled = true;
          return HttpResponse.json({
            stage_id: "manual_deskew_pre",
            status: "clean",
            artifact_key: null,
            artifact_url: null,
            config_hash: null,
            stage_version: 1,
            ran_at: "2026-01-01T00:00:00Z",
            error_message: null,
          });
        },
      ),
    );

    renderWithProviders(<PageWorkbenchPage />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^rotate$/i }));
    await user.click(await screen.findByRole("button", { name: /^apply$/i }));

    await waitFor(() => {
      expect(patchCalls).toHaveLength(1);
      expect(runCalled).toBe(true);
    });

    // PATCH body includes config_overrides with manual_deskew_angle
    const patchBody = patchCalls[0] as {
      config_overrides?: { manual_deskew_angle?: number | null };
    };
    expect(patchBody.config_overrides).toBeDefined();
    expect("manual_deskew_angle" in (patchBody.config_overrides ?? {})).toBe(
      true,
    );
  });
});

describe("PageWorkbenchPage — rotate mode Escape", () => {
  it("pressing Escape exits rotate mode without writing", async () => {
    setupBasicHandlers();

    let patchCalled = false;
    server.use(
      http.patch("/api/data/projects/prj_1/pages/0", () => {
        patchCalled = true;
        return HttpResponse.json(makePageRecord());
      }),
    );

    renderWithProviders(<PageWorkbenchPage />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^rotate$/i }));
    await screen.findByRole("button", { name: /^apply$/i });

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /^apply$/i })).toBeNull();
    });
    expect(patchCalled).toBe(false);
  });
});

describe("PageWorkbenchPage — rotate mode discrete buttons", () => {
  it("90° CW button immediately fires PATCH + POST with angle 90", async () => {
    setupBasicHandlers();

    const patchCalls: unknown[] = [];
    let runCalled = false;

    server.use(
      http.patch("/api/data/projects/prj_1/pages/0", async ({ request }) => {
        patchCalls.push(await request.json());
        return HttpResponse.json(makePageRecord());
      }),
      http.post(
        "/api/data/projects/prj_1/pages/0/stages/manual_deskew_pre/run",
        () => {
          runCalled = true;
          return HttpResponse.json({
            stage_id: "manual_deskew_pre",
            status: "clean",
            artifact_key: null,
            artifact_url: null,
            config_hash: null,
            stage_version: 1,
            ran_at: "2026-01-01T00:00:00Z",
            error_message: null,
          });
        },
      ),
    );

    renderWithProviders(<PageWorkbenchPage />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^rotate$/i }));
    await user.click(await screen.findByRole("button", { name: /^90° CW$/i }));

    await waitFor(() => {
      expect(patchCalls).toHaveLength(1);
      expect(runCalled).toBe(true);
    });

    const patchBody = patchCalls[0] as {
      config_overrides?: { manual_deskew_angle?: number };
    };
    expect(patchBody.config_overrides?.manual_deskew_angle).toBe(90);
  });

  it("90° CCW button immediately fires PATCH + POST with angle -90", async () => {
    setupBasicHandlers();

    const patchCalls: unknown[] = [];
    let runCalled = false;

    server.use(
      http.patch("/api/data/projects/prj_1/pages/0", async ({ request }) => {
        patchCalls.push(await request.json());
        return HttpResponse.json(makePageRecord());
      }),
      http.post(
        "/api/data/projects/prj_1/pages/0/stages/manual_deskew_pre/run",
        () => {
          runCalled = true;
          return HttpResponse.json({
            stage_id: "manual_deskew_pre",
            status: "clean",
            artifact_key: null,
            artifact_url: null,
            config_hash: null,
            stage_version: 1,
            ran_at: "2026-01-01T00:00:00Z",
            error_message: null,
          });
        },
      ),
    );

    renderWithProviders(<PageWorkbenchPage />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^rotate$/i }));
    await user.click(await screen.findByRole("button", { name: /^90° CCW$/i }));

    await waitFor(() => {
      expect(patchCalls).toHaveLength(1);
      expect(runCalled).toBe(true);
    });

    const patchBody = patchCalls[0] as {
      config_overrides?: { manual_deskew_angle?: number };
    };
    expect(patchBody.config_overrides?.manual_deskew_angle).toBe(-90);
  });

  it("180° button immediately fires PATCH + POST with angle 180", async () => {
    setupBasicHandlers();

    const patchCalls: unknown[] = [];
    let runCalled = false;

    server.use(
      http.patch("/api/data/projects/prj_1/pages/0", async ({ request }) => {
        patchCalls.push(await request.json());
        return HttpResponse.json(makePageRecord());
      }),
      http.post(
        "/api/data/projects/prj_1/pages/0/stages/manual_deskew_pre/run",
        () => {
          runCalled = true;
          return HttpResponse.json({
            stage_id: "manual_deskew_pre",
            status: "clean",
            artifact_key: null,
            artifact_url: null,
            config_hash: null,
            stage_version: 1,
            ran_at: "2026-01-01T00:00:00Z",
            error_message: null,
          });
        },
      ),
    );

    renderWithProviders(<PageWorkbenchPage />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^rotate$/i }));
    await user.click(await screen.findByRole("button", { name: /^180°$/i }));

    await waitFor(() => {
      expect(patchCalls).toHaveLength(1);
      expect(runCalled).toBe(true);
    });

    const patchBody = patchCalls[0] as {
      config_overrides?: { manual_deskew_angle?: number };
    };
    expect(patchBody.config_overrides?.manual_deskew_angle).toBe(180);
  });
});

describe("PageWorkbenchPage — rotate mode pre-fills stored angle", () => {
  it("entering rotate mode pre-fills angle readout from stored config value", async () => {
    const pageWithAngle = makePageRecord({
      config_overrides: {
        ...makePageRecord().config_overrides,
        manual_deskew_angle: -3.5,
      },
    });
    setupBasicHandlers(pageWithAngle);

    renderWithProviders(<PageWorkbenchPage />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^rotate$/i }));

    // The angle readout should show the stored value
    await screen.findByText(/-3\.5/);
  });
});
