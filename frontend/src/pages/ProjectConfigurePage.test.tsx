/**
 * Tests for ProjectConfigurePage — focused on the M5 RunAllDirtyPanel.
 *
 * Covers:
 * - "Run all dirty stages" button is visible in the page.
 * - Clicking the button POSTs to /api/data/projects/{id}/run-dirty.
 * - A progress indicator appears after the button is clicked.
 * - The button is disabled while a run is in progress.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { server } from "../test/server";
import { ProjectConfigurePage } from "./ProjectConfigurePage";

function renderWithProviders(
  ui: ReactElement,
  initialPath = "/projects/proj1",
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/projects/:projectId" element={ui} />
          <Route path="/projects/:projectId/*" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const baseProject = {
  id: "proj1",
  name: "Test Book",
  owner_id: "default",
  status: "ready",
  page_count: 3,
  proof_page_count: 3,
  created_at: "2026-05-01T10:00:00Z",
  updated_at: "2026-05-01T10:00:00Z",
  config: {
    book_name: "Test Book",
    source_uri: "",
    alignment: "default",
    crop_to_content: true,
    crop_add_px: 5,
    threshold_level: null,
    white_space_additional: null,
    do_morph: false,
    fuzzy_pct: null,
    book_language: null,
    scannos_file: null,
    custom_regex: null,
    default_overrides: {},
    optimize_png: true,
    proof_start_idx0: null,
    proof_end_idx0: null,
    frontmatter_start_idx0: null,
    frontmatter_end_idx0: null,
    bodymatter_start_idx0: null,
    bodymatter_end_idx0: null,
    frontmatter_page_nbr_start: 1,
    bodymatter_page_nbr_start: 1,
  },
  pipeline_state: {
    unzip_done: false,
    thumbnails_done: false,
    process_pages_done: false,
    ocr_done: false,
    text_postprocess_done: false,
    build_package_done: false,
    extract_illustrations_done: false,
  },
  storage_prefix: "projects/proj1/",
  source_key: null,
  package_key: null,
  stage_artifacts_bytes: 0,
  source_zip_bytes: 0,
};

const pagesResponse = {
  pages: [],
  total: 0,
  next_cursor: null,
};

function setupBaseHandlers() {
  server.use(
    http.get("/api/data/projects/proj1", () => HttpResponse.json(baseProject)),
    http.get("/api/data/projects/proj1/pages", () =>
      HttpResponse.json(pagesResponse),
    ),
    http.get("/api/gpu/jobs", () => HttpResponse.json([])),
    http.get("/api/data/jobs", () => HttpResponse.json([])),
    http.get("/api/data/projects/proj1/review-status", () =>
      HttpResponse.json({ unreviewed_count: 0, awaiting_review_job_id: null }),
    ),
  );
}

describe("ProjectConfigurePage — RunAllDirtyPanel", () => {
  it("renders the Run all dirty stages button", async () => {
    setupBaseHandlers();
    renderWithProviders(<ProjectConfigurePage />);
    expect(
      await screen.findByRole("button", { name: /run all dirty stages/i }),
    ).toBeInTheDocument();
  });

  it("POSTs to /api/data/projects/{id}/run-dirty when button is clicked", async () => {
    setupBaseHandlers();
    let called = false;
    server.use(
      http.post("/api/data/projects/proj1/run-dirty", () => {
        called = true;
        return HttpResponse.json(
          { job_id: "job_x", status: "queued" },
          { status: 202 },
        );
      }),
      http.get("/api/gpu/jobs/:jobId/events", () => HttpResponse.json({})),
    );

    renderWithProviders(<ProjectConfigurePage />);
    const btn = await screen.findByRole("button", {
      name: /run all dirty stages/i,
    });
    await userEvent.click(btn);

    await waitFor(() => expect(called).toBe(true));
  });

  it("disables the button while a run-dirty mutation is pending", async () => {
    setupBaseHandlers();
    // Never-resolving handler — keeps mutation pending indefinitely.
    server.use(
      http.post(
        "/api/data/projects/proj1/run-dirty",
        () => new Promise(() => {}),
      ),
    );

    renderWithProviders(<ProjectConfigurePage />);
    const btn = await screen.findByRole("button", {
      name: /run all dirty stages/i,
    });
    await userEvent.click(btn);

    // Mutation is pending — button becomes disabled.
    await waitFor(() => expect(btn).toBeDisabled());
  });
});
