/**
 * Tests for rotate mode in PageWorkbenchPage (issue #100 / #102).
 *
 * Acceptance bullets covered:
 * - "Rotate" button in ModeToolbar toggles rotate mode.
 * - Apply fires PATCH config + POST .../manual_deskew_pre/run.
 * - Escape exits rotate mode with no write.
 * - Discrete 90° CW, 90° CCW, 180° buttons immediately fire PATCH + POST.
 * - Existing mode-switching mutually excludes rotate.
 * - Entering rotate mode pre-fills angle from stored config.
 * - Flip affordance is absent.
 *
 * Issue #102 — angle range and precision:
 * - Angle stored to exactly one decimal place (rounded).
 * - Angle is clamped/wrapped to ±180° range.
 * - No snap-to-grid behaviour.
 */

// Defuse the `react-konva` -> `konva/lib/index-node.js` -> `require("canvas")`
// chain at module-load time. jsdom has no canvas; PageWorkbenchPage's Konva
// canvas would otherwise crash the test runner. Vitest hoists `vi.mock` calls
// above imports so the page's transitive konva import resolves to these stubs.
//
// Phase 2.2: PageWorkbenchPage now also imports @concavetrillion/pd-ui/canvas
// which itself imports react-konva. We mock pd-ui/canvas so that the slot fills
// (tool slot) are invoked and rendered as plain DOM elements. The react-konva
// mock still handles the Rect/Transformer primitives that CanvasViewer renders
// inside the tool slot.
import type { ReactNode } from "react";

vi.mock("@concavetrillion/pd-ui/canvas", () => ({
  PageImageCanvas: ({
    children,
  }: {
    src?: string;
    page?: { width: number; height: number };
    words?: unknown[];
    fitOnMount?: boolean;
    children?: {
      selection?: () => ReactNode;
      tool?: () => ReactNode;
      underlay?: () => ReactNode;
      overlay?: () => ReactNode;
      hud?: () => ReactNode;
    };
  }) => (
    <div data-testid="pd-ui-canvas">
      {children?.selection?.()}
      {children?.tool?.()}
    </div>
  ),
}));

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
      flip_horizontal: null,
      flip_vertical: null,
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

  it("renders a Flip button alongside the Rotate button (P2.1 shipped)", async () => {
    setupBasicHandlers();
    renderWithProviders(<PageWorkbenchPage />);

    await screen.findByRole("button", { name: /^rotate$/i });
    // P2.1: Flip button is now present in ModeToolbar.
    await screen.findByRole("button", { name: /^flip$/i });
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

describe("PageWorkbenchPage — rotate mode Reset with applied angle", () => {
  it("Reset clears draftAngle to 0 and PATCHes manual_deskew_angle null + POSTs re-run", async () => {
    // Page already has a stored angle (simulating a previously-applied rotation)
    const pageWithAngle = makePageRecord({
      config_overrides: {
        ...makePageRecord().config_overrides,
        manual_deskew_angle: -3.5,
      },
    });
    setupBasicHandlers(pageWithAngle);

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
    // Enter rotate mode (pre-fills -3.5)
    await user.click(await screen.findByRole("button", { name: /^rotate$/i }));
    await screen.findByText(/-3\.5/);

    // Click Reset — should PATCH angle to null and POST re-run
    await user.click(screen.getByRole("button", { name: /^reset$/i }));

    await waitFor(() => {
      expect(patchCalls).toHaveLength(1);
      expect(runCalled).toBe(true);
    });

    // PATCH body must set manual_deskew_angle to null (clears the override)
    const patchBody = patchCalls[0] as {
      config_overrides?: { manual_deskew_angle?: number | null };
    };
    expect(patchBody.config_overrides?.manual_deskew_angle).toBeNull();
  });

  it("Reset with no stored angle only clears draftAngle locally (no network call)", async () => {
    // Page has no stored angle
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

    // Click Reset with no stored angle — should not PATCH
    await user.click(screen.getByRole("button", { name: /^reset$/i }));

    // Wait briefly to confirm no network call was made
    await waitFor(() => {
      expect(patchCalled).toBe(false);
    });
  });
});

// ─── Issue #102: angle range and precision ───────────────────────────────────

function setupRotateHandlers(pageRecord: PageRecord = makePageRecord()) {
  server.use(
    http.get("/api/data/projects/prj_1/pages/0", () =>
      HttpResponse.json(pageRecord),
    ),
    http.get("/api/data/projects/prj_1/pages/0/stages", () =>
      HttpResponse.json([]),
    ),
    http.get("/api/data/jobs", () => HttpResponse.json([])),
    http.patch("/api/data/projects/prj_1/pages/0", async ({ request }) => {
      const body = await request.json();
      return HttpResponse.json({ ...pageRecord, ...(body as object) });
    }),
    http.post(
      "/api/data/projects/prj_1/pages/0/stages/manual_deskew_pre/run",
      () =>
        HttpResponse.json({
          stage_id: "manual_deskew_pre",
          status: "clean",
          artifact_key: null,
          artifact_url: null,
          config_hash: null,
          stage_version: 1,
          ran_at: "2026-01-01T00:00:00Z",
          error_message: null,
        }),
    ),
  );
}

describe("issue #102 — angle precision: stored to one decimal place", () => {
  it("Apply stores angle rounded to one decimal place when pre-filled from a raw float", async () => {
    // If the stored angle is a raw float (e.g. 3.567 from a prior Konva drag),
    // entering rotate mode pre-fills draftAngle = 3.567, and clicking Apply
    // should store 3.6, not 3.567.
    const pageWithRawAngle = makePageRecord({
      config_overrides: {
        ...makePageRecord().config_overrides,
        manual_deskew_angle: 3.567,
      },
    });
    setupRotateHandlers(pageWithRawAngle);

    const patchCalls: unknown[] = [];
    server.use(
      http.patch("/api/data/projects/prj_1/pages/0", async ({ request }) => {
        patchCalls.push(await request.json());
        return HttpResponse.json(makePageRecord());
      }),
    );

    renderWithProviders(<PageWorkbenchPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^rotate$/i }));
    // Confirm pre-fill shows rounded value
    await screen.findByText(/3\.6/);
    await user.click(await screen.findByRole("button", { name: /^apply$/i }));

    await waitFor(() => expect(patchCalls).toHaveLength(1));

    const stored = (
      patchCalls[0] as { config_overrides: { manual_deskew_angle: number } }
    ).config_overrides.manual_deskew_angle;

    // Must be stored as 3.6, not 3.567
    expect(stored).toBe(3.6);
  });

  it("pre-filled stored angle -3.567 is pre-filled as -3.6 in angle readout", async () => {
    // If server stores a raw float (e.g. from a Konva drag), the readout
    // must display it rounded to 1dp when entering rotate mode.
    const pageWithRawAngle = makePageRecord({
      config_overrides: {
        ...makePageRecord().config_overrides,
        manual_deskew_angle: -3.567,
      },
    });
    setupRotateHandlers(pageWithRawAngle);
    renderWithProviders(<PageWorkbenchPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^rotate$/i }));

    // The readout must show -3.6, not -3.567
    await screen.findByText(/-3\.6/);
    expect(screen.queryByText(/-3\.567/)).toBeNull();
  });
});

describe("issue #102 — angle clamped to ±180°", () => {
  it("discrete 90° CW from 120 wraps to -150, not 210", async () => {
    // Start at stored 120; clicking 90° CW should add 90 and wrap within ±180.
    // raw 120+90=210 → wraps to 210-360 = -150.
    const pageAt120 = makePageRecord({
      config_overrides: {
        ...makePageRecord().config_overrides,
        manual_deskew_angle: 120,
      },
    });
    setupRotateHandlers(pageAt120);

    const patchCalls: unknown[] = [];
    server.use(
      http.patch("/api/data/projects/prj_1/pages/0", async ({ request }) => {
        patchCalls.push(await request.json());
        return HttpResponse.json(makePageRecord());
      }),
    );

    renderWithProviders(<PageWorkbenchPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^rotate$/i }));
    // Confirm pre-fill
    await screen.findByText(/120/);
    await user.click(await screen.findByRole("button", { name: /^90° CW$/i }));

    await waitFor(() => expect(patchCalls).toHaveLength(1));
    const stored = (
      patchCalls[0] as { config_overrides: { manual_deskew_angle: number } }
    ).config_overrides.manual_deskew_angle;
    // 120 + 90 = 210 → wraps to -150
    expect(stored).toBe(-150);
  });

  it("discrete 90° CCW from -120 wraps to 150, not -210", async () => {
    // raw -120-90=-210 → wraps to -210+360 = 150.
    const pageAtMinus120 = makePageRecord({
      config_overrides: {
        ...makePageRecord().config_overrides,
        manual_deskew_angle: -120,
      },
    });
    setupRotateHandlers(pageAtMinus120);

    const patchCalls: unknown[] = [];
    server.use(
      http.patch("/api/data/projects/prj_1/pages/0", async ({ request }) => {
        patchCalls.push(await request.json());
        return HttpResponse.json(makePageRecord());
      }),
    );

    renderWithProviders(<PageWorkbenchPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^rotate$/i }));
    await user.click(await screen.findByRole("button", { name: /^90° CCW$/i }));

    await waitFor(() => expect(patchCalls).toHaveLength(1));
    const stored = (
      patchCalls[0] as { config_overrides: { manual_deskew_angle: number } }
    ).config_overrides.manual_deskew_angle;
    // -120 - 90 = -210 → wraps to 150
    expect(stored).toBe(150);
  });
});

describe("issue #102 — no snap-to-grid", () => {
  it("angle display shows fractional values (not snapped to integer degrees)", async () => {
    // A non-integer stored angle should display as-is at 1dp, not snapped to integers.
    const pageWithFrac = makePageRecord({
      config_overrides: {
        ...makePageRecord().config_overrides,
        manual_deskew_angle: -3.5,
      },
    });
    setupRotateHandlers(pageWithFrac);
    renderWithProviders(<PageWorkbenchPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^rotate$/i }));

    // Must show -3.5, not -4 or -3 (no integer snapping)
    await screen.findByText(/-3\.5/);
  });
});

// ─── §10: CanvasViewer renders without error in rotate mode ─────────────────
//
// Note: in jsdom, HTMLImageElement.onload never fires (no real network), so
// CanvasViewer's `img` state stays null and the Konva <Stage> is never
// mounted — the fallback "Loading image…" div renders instead.  These tests
// therefore verify the *parent* component remains stable (no crash, no
// unmount) rather than inspecting Konva internals, which are unreachable in
// the unit-test environment.  The imageRef-guarded effects are exercised by
// the TypeScript compiler + the null-check in the effect body.

describe("CanvasViewer — rotate mode rendering", () => {
  it("entering rotate mode does not crash the page — toolbar controls appear", async () => {
    // Verifies that the new draftAngle / onRotate props on CanvasViewer do not
    // cause an unhandled error when the component transitions to rotate mode.
    setupBasicHandlers();
    renderWithProviders(<PageWorkbenchPage />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^rotate$/i }));

    // Rotate toolbar controls must appear without any crash
    await screen.findByRole("button", { name: /^apply$/i });
    expect(screen.getByRole("button", { name: /^reset$/i })).toBeTruthy();
  });

  it("exits rotate mode cleanly when Cancel is clicked — page remains stable", async () => {
    setupBasicHandlers();
    renderWithProviders(<PageWorkbenchPage />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^rotate$/i }));
    await screen.findByRole("button", { name: /^cancel$/i });

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    // Rotate toolbar should be gone; Mode toolbar must still be visible
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /^apply$/i })).toBeNull();
    });
    expect(screen.getByRole("button", { name: /^rotate$/i })).toBeTruthy();
  });
});
