/**
 * CropsGridPage — canvas_map thumbnail grid for all pages in a project.
 *
 * Acceptance criteria:
 * - Page renders a grid of thumbnail cards, one per page returned by the list endpoint.
 * - Each card shows the page prefix (e.g. "001") as a label.
 * - Thumbnail src uses the canvas_map stage thumbnail URL when the page has a
 *   thumbnail_key (proxy for "canvas_map ran").
 * - When a page has no thumbnail_key, a grey placeholder is shown instead of an <img>.
 * - Clicking a card navigates to /projects/{id}/pages/{idx0}.
 * - A loading state is shown while the pages query is in flight.
 * - A "Back to project" breadcrumb link points to /projects/{id}.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import type { components } from "../api/types.gen";
import { server } from "../test/server";
import { CropsGridPage } from "./CropsGridPage";

type PageRecord = components["schemas"]["PageRecord"];
type ListPagesResponse = components["schemas"]["ListPagesResponse"];

function renderWithProviders(
  ui: ReactElement,
  { initialEntry = "/projects/prj_1/crops" }: { initialEntry?: string } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/projects/:projectId/crops" element={ui} />
          {/* Catch-all so navigation targets don't 404 in MemoryRouter */}
          <Route
            path="/projects/:projectId/pages/:idx0"
            element={<div data-testid="workbench-page" />}
          />
          <Route
            path="/projects/:projectId"
            element={<div data-testid="project-configure-page" />}
          />
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

function makeListResponse(
  pageRecords: PageRecord[],
  overrides: Partial<ListPagesResponse> = {},
): ListPagesResponse {
  return {
    pages: pageRecords,
    total: pageRecords.length,
    next_cursor: null,
    ...overrides,
  };
}

// ─── Loading state ─────────────────────────────────────────────────────────

describe("CropsGridPage — loading state", () => {
  it("shows a loading indicator while pages are being fetched", () => {
    // Handler that never resolves, so the query stays in-flight.
    server.use(
      http.get("/api/data/projects/prj_1/pages", () => new Promise(() => {})),
    );

    renderWithProviders(<CropsGridPage />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});

// ─── Grid renders one card per page ────────────────────────────────────────

describe("CropsGridPage — thumbnail grid", () => {
  it("renders one card per page returned by the list endpoint", async () => {
    server.use(
      http.get("/api/data/projects/prj_1/pages", () =>
        HttpResponse.json(
          makeListResponse([
            makePageRecord({ idx0: 0, prefix: "001" }),
            makePageRecord({ idx0: 1, prefix: "002" }),
            makePageRecord({ idx0: 2, prefix: "003" }),
          ]),
        ),
      ),
    );

    renderWithProviders(<CropsGridPage />);

    await screen.findByText("001");
    expect(screen.getByText("002")).toBeInTheDocument();
    expect(screen.getByText("003")).toBeInTheDocument();
  });

  it("renders the page prefix as a visible label on each card", async () => {
    server.use(
      http.get("/api/data/projects/prj_1/pages", () =>
        HttpResponse.json(
          makeListResponse([makePageRecord({ idx0: 0, prefix: "f000" })]),
        ),
      ),
    );

    renderWithProviders(<CropsGridPage />);

    expect(await screen.findByText("f000")).toBeInTheDocument();
  });

  it("shows an <img> with the canvas_map thumbnail URL when thumbnail_key is present", async () => {
    server.use(
      http.get("/api/data/projects/prj_1/pages", () =>
        HttpResponse.json(
          makeListResponse([
            makePageRecord({
              idx0: 0,
              prefix: "001",
              thumbnail_key: "projects/prj_1/pages/0/thumb.jpg",
            }),
          ]),
        ),
      ),
    );

    renderWithProviders(<CropsGridPage />);

    await screen.findByText("001");
    const img = screen.getByRole("img", { name: /001/i });
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute(
      "src",
      "/api/data/projects/prj_1/pages/0/stages/canvas_map/thumbnail",
    );
  });

  it("shows a placeholder when the page has no thumbnail_key (canvas_map not yet run)", async () => {
    server.use(
      http.get("/api/data/projects/prj_1/pages", () =>
        HttpResponse.json(
          makeListResponse([
            makePageRecord({
              idx0: 0,
              prefix: "001",
              thumbnail_key: null,
            }),
          ]),
        ),
      ),
    );

    renderWithProviders(<CropsGridPage />);

    await screen.findByText("001");
    // No img element for this card
    expect(screen.queryByRole("img")).toBeNull();
    // Placeholder element present
    expect(screen.getByTestId("thumbnail-placeholder-0")).toBeInTheDocument();
  });
});

// ─── Navigation ────────────────────────────────────────────────────────────

describe("CropsGridPage — navigation", () => {
  it("clicking a card navigates to the page workbench URL", async () => {
    server.use(
      http.get("/api/data/projects/prj_1/pages", () =>
        HttpResponse.json(
          makeListResponse([
            makePageRecord({ idx0: 2, prefix: "003", thumbnail_key: "k" }),
          ]),
        ),
      ),
    );

    renderWithProviders(<CropsGridPage />);

    const user = userEvent.setup();
    const card = await screen.findByRole("link", { name: /003/i });
    await user.click(card);

    // After navigation the workbench stub renders
    await screen.findByTestId("workbench-page");
  });

  it("renders a 'Back to project' breadcrumb link pointing to /projects/{id}", async () => {
    server.use(
      http.get("/api/data/projects/prj_1/pages", () =>
        HttpResponse.json(makeListResponse([])),
      ),
    );

    renderWithProviders(<CropsGridPage />);

    const link = await screen.findByRole("link", { name: /back to project/i });
    expect(link).toHaveAttribute("href", "/projects/prj_1");
  });
});

// ─── Empty state ─────────────────────────────────────────────────────────────

describe("CropsGridPage — empty state", () => {
  it("renders an empty-state message when no pages exist", async () => {
    server.use(
      http.get("/api/data/projects/prj_1/pages", () =>
        HttpResponse.json(makeListResponse([])),
      ),
    );

    renderWithProviders(<CropsGridPage />);

    expect(await screen.findByText(/no pages/i)).toBeInTheDocument();
  });
});

// ─── Error state ──────────────────────────────────────────────────────────────

describe("CropsGridPage — error state", () => {
  it("shows the loading state indefinitely when the pages query fails", async () => {
    server.use(
      http.get("/api/data/projects/prj_1/pages", () => HttpResponse.error()),
    );

    renderWithProviders(<CropsGridPage />);

    // When query fails and has no data, we stay in loading state
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});
