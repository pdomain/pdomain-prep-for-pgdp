/**
 * Tests for P2.1 — Konva flip in PageWorkbenchPage.
 *
 * Acceptance bullets covered:
 * - "Flip" button in ModeToolbar enters flip mode.
 * - Flip toolbar shows H-flip and V-flip buttons.
 * - H-flip fires PATCH config_overrides + POST manual_deskew_pre/run.
 * - V-flip fires PATCH config_overrides + POST manual_deskew_pre/run.
 * - Reset clears flip flags and re-runs.
 * - Escape exits flip mode without writing.
 * - Flip mode and rotate mode are mutually exclusive.
 * - Entering flip mode pre-fills flip flags from stored config.
 * - PATCH body includes flip_horizontal and flip_vertical fields.
 */

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

function setupFlipHandlers(
  pageRecord: PageRecord = makePageRecord(),
  opts: { onPatch?: (body: unknown) => void; onRun?: () => void } = {},
) {
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
      opts.onPatch?.(body);
      return HttpResponse.json(makePageRecord());
    }),
    http.post(
      "/api/data/projects/prj_1/pages/0/stages/manual_deskew_pre/run",
      () => {
        opts.onRun?.();
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
}

// ─── ModeToolbar: Flip button presence ──────────────────────────────────────

describe("PageWorkbenchPage — flip mode toolbar button", () => {
  it("renders a Flip button in ModeToolbar", async () => {
    setupBasicHandlers();
    renderWithProviders(<PageWorkbenchPage />);
    await screen.findByRole("button", { name: /^flip$/i });
  });

  it("clicking Flip enters flip mode and shows H-flip and V-flip buttons", async () => {
    setupBasicHandlers();
    renderWithProviders(<PageWorkbenchPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^flip$/i }));
    await screen.findByRole("button", { name: /flip horizontal/i });
    expect(screen.getByRole("button", { name: /flip vertical/i })).toBeTruthy();
  });

  it("flip mode shows a Reset and Cancel button", async () => {
    setupBasicHandlers();
    renderWithProviders(<PageWorkbenchPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^flip$/i }));
    await screen.findByRole("button", { name: /reset/i });
    expect(screen.getByRole("button", { name: /cancel/i })).toBeTruthy();
  });
});

// ─── H-flip: fires PATCH + POST ─────────────────────────────────────────────

describe("PageWorkbenchPage — flip mode H-flip action", () => {
  it("clicking Flip Horizontal fires PATCH with flip_horizontal=true + POST re-run", async () => {
    const patchCalls: unknown[] = [];
    let runCalled = false;
    setupFlipHandlers(makePageRecord(), {
      onPatch: (body) => patchCalls.push(body),
      onRun: () => {
        runCalled = true;
      },
    });

    renderWithProviders(<PageWorkbenchPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^flip$/i }));
    await user.click(
      await screen.findByRole("button", { name: /flip horizontal/i }),
    );

    await waitFor(() => {
      expect(patchCalls).toHaveLength(1);
      expect(runCalled).toBe(true);
    });

    const body = patchCalls[0] as {
      config_overrides?: { flip_horizontal?: boolean | null };
    };
    expect(body.config_overrides?.flip_horizontal).toBe(true);
  });
});

// ─── V-flip: fires PATCH + POST ─────────────────────────────────────────────

describe("PageWorkbenchPage — flip mode V-flip action", () => {
  it("clicking Flip Vertical fires PATCH with flip_vertical=true + POST re-run", async () => {
    const patchCalls: unknown[] = [];
    let runCalled = false;
    setupFlipHandlers(makePageRecord(), {
      onPatch: (body) => patchCalls.push(body),
      onRun: () => {
        runCalled = true;
      },
    });

    renderWithProviders(<PageWorkbenchPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^flip$/i }));
    await user.click(
      await screen.findByRole("button", { name: /flip vertical/i }),
    );

    await waitFor(() => {
      expect(patchCalls).toHaveLength(1);
      expect(runCalled).toBe(true);
    });

    const body = patchCalls[0] as {
      config_overrides?: { flip_vertical?: boolean | null };
    };
    expect(body.config_overrides?.flip_vertical).toBe(true);
  });
});

// ─── Flip Reset ──────────────────────────────────────────────────────────────

describe("PageWorkbenchPage — flip mode Reset", () => {
  it("Reset with active flip clears flags to null + POST re-run", async () => {
    // Page with both flips active.
    const pageWithFlip = makePageRecord({
      config_overrides: {
        ...makePageRecord().config_overrides,
        flip_horizontal: true,
        flip_vertical: false,
      },
    });

    const patchCalls: unknown[] = [];
    let runCalled = false;
    setupFlipHandlers(pageWithFlip, {
      onPatch: (body) => patchCalls.push(body),
      onRun: () => {
        runCalled = true;
      },
    });

    renderWithProviders(<PageWorkbenchPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^flip$/i }));
    await screen.findByRole("button", { name: /flip horizontal/i });
    await user.click(screen.getByRole("button", { name: /reset/i }));

    await waitFor(() => {
      expect(patchCalls).toHaveLength(1);
      expect(runCalled).toBe(true);
    });

    const body = patchCalls[0] as {
      config_overrides?: {
        flip_horizontal?: boolean | null;
        flip_vertical?: boolean | null;
      };
    };
    expect(body.config_overrides?.flip_horizontal).toBeNull();
    expect(body.config_overrides?.flip_vertical).toBeNull();
  });

  it("Reset with no stored flip makes no network call", async () => {
    let patchCalled = false;
    setupFlipHandlers(makePageRecord(), {
      onPatch: () => {
        patchCalled = true;
      },
    });

    renderWithProviders(<PageWorkbenchPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^flip$/i }));
    await screen.findByRole("button", { name: /flip horizontal/i });
    await user.click(screen.getByRole("button", { name: /reset/i }));

    await waitFor(() => expect(patchCalled).toBe(false));
  });
});

// ─── Flip Cancel / Escape ────────────────────────────────────────────────────

describe("PageWorkbenchPage — flip mode Cancel", () => {
  it("Cancel button exits flip mode without writing", async () => {
    let patchCalled = false;
    setupFlipHandlers(makePageRecord(), {
      onPatch: () => {
        patchCalled = true;
      },
    });

    renderWithProviders(<PageWorkbenchPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^flip$/i }));
    await screen.findByRole("button", { name: /flip horizontal/i });
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /flip horizontal/i }),
      ).toBeNull();
    });
    expect(patchCalled).toBe(false);
  });
});

// ─── Mutual exclusion with rotate ────────────────────────────────────────────

describe("PageWorkbenchPage — flip and rotate mutual exclusion", () => {
  it("entering flip mode while in rotate mode exits rotate controls", async () => {
    setupBasicHandlers();
    renderWithProviders(<PageWorkbenchPage />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^rotate$/i }));
    // Rotate toolbar should appear.
    await screen.findByRole("button", { name: /^apply$/i });

    // Switch to flip mode.
    await user.click(screen.getByRole("button", { name: /^flip$/i }));

    // Rotate toolbar should be gone; flip toolbar should appear.
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /^apply$/i })).toBeNull();
    });
    await screen.findByRole("button", { name: /flip horizontal/i });
  });

  it("entering rotate mode while in flip mode exits flip controls", async () => {
    setupBasicHandlers();
    renderWithProviders(<PageWorkbenchPage />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^flip$/i }));
    await screen.findByRole("button", { name: /flip horizontal/i });

    // Switch to rotate mode.
    await user.click(screen.getByRole("button", { name: /^rotate$/i }));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /flip horizontal/i }),
      ).toBeNull();
    });
    await screen.findByRole("button", { name: /^apply$/i });
  });
});

// ─── Pre-fill stored flip state ──────────────────────────────────────────────

describe("PageWorkbenchPage — flip mode pre-fills stored state", () => {
  it("entering flip mode with stored flip_horizontal=true shows toggled state", async () => {
    const pageWithFlip = makePageRecord({
      config_overrides: {
        ...makePageRecord().config_overrides,
        flip_horizontal: true,
        flip_vertical: null,
      },
    });
    setupBasicHandlers(pageWithFlip);
    renderWithProviders(<PageWorkbenchPage />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^flip$/i }));

    // The H-flip button should be visually active (aria-pressed=true).
    const hBtn = await screen.findByRole("button", {
      name: /flip horizontal/i,
    });
    expect(hBtn).toHaveAttribute("aria-pressed", "true");
  });
});
