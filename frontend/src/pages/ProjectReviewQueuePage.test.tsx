/**
 * Tests for ProjectReviewQueuePage — hi-fi P3-2 redesign.
 *
 * Covers:
 * - Renders PageHeader with title "Review queue".
 * - Shows amber banner when pages.length > 0.
 * - Shows empty state when pages.length === 0.
 * - Each page row renders with prefix and "Review →" link.
 * - No thumbnail test (avoid image loading in jsdom).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { server } from "../test/server";
import { ProjectReviewQueuePage } from "./ProjectReviewQueuePage";

const PROJECT_ID = "proj_test_123";

function renderWithProviders(
  ui: ReactElement,
  initialPath = `/projects/${PROJECT_ID}/review`,
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
          <Route path="/projects/:projectId/review" element={ui} />
          <Route path="*" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Minimal PageRecord shape for testing. */
function makePage(overrides: {
  idx0?: number;
  prefix?: string;
  processing_status?: "pending" | "processing" | "complete" | "error";
  processing_error?: string | null;
}) {
  return {
    project_id: PROJECT_ID,
    idx0: overrides.idx0 ?? 0,
    prefix: overrides.prefix ?? `p${overrides.idx0 ?? 0}`,
    source_stem: "page_0",
    ignore: false,
    page_type: "normal",
    alignment: "default",
    config_overrides: {},
    splits: [],
    illustration_regions: [],
    source_key: null,
    thumbnail_key: null,
    processed_image_key: null,
    ocr_image_key: null,
    processing_status: overrides.processing_status ?? "pending",
    processing_job_id: null,
    processing_error: overrides.processing_error ?? null,
    last_processed_at: null,
  };
}

/** Stub the jobs poll (useActiveBatchJob) with an empty list. */
function stubNoActiveBatch() {
  server.use(http.get("/api/data/jobs", () => HttpResponse.json([])));
}

describe("ProjectReviewQueuePage", () => {
  it("renders the 'Review queue' PageHeader heading", async () => {
    stubNoActiveBatch();
    server.use(
      http.get(`/api/data/projects/${PROJECT_ID}/pages`, () =>
        HttpResponse.json({ pages: [], total: 0, limit: 500, offset: 0 }),
      ),
    );

    renderWithProviders(<ProjectReviewQueuePage />);

    expect(
      await screen.findByRole("heading", { level: 1, name: /review queue/i }),
    ).toBeInTheDocument();
  });

  it("shows amber banner when there are pages in the queue", async () => {
    stubNoActiveBatch();
    server.use(
      http.get(`/api/data/projects/${PROJECT_ID}/pages`, () =>
        HttpResponse.json({
          pages: [makePage({ idx0: 0, prefix: "p001" })],
          total: 1,
          limit: 500,
          offset: 0,
        }),
      ),
    );

    renderWithProviders(<ProjectReviewQueuePage />);

    // The banner contains "Review queue" text with the count
    await waitFor(() =>
      expect(
        screen.getByText(/review queue — 1 page needing attention/i),
      ).toBeInTheDocument(),
    );
  });

  it("does NOT show amber banner when the queue is empty", async () => {
    stubNoActiveBatch();
    server.use(
      http.get(`/api/data/projects/${PROJECT_ID}/pages`, () =>
        HttpResponse.json({ pages: [], total: 0, limit: 500, offset: 0 }),
      ),
    );

    renderWithProviders(<ProjectReviewQueuePage />);

    // Wait for the heading to appear (data loaded)
    await screen.findByRole("heading", { level: 1, name: /review queue/i });

    expect(
      screen.queryByText(/review queue — .* needing attention/i),
    ).not.toBeInTheDocument();
  });

  it("shows empty state when pages.length === 0", async () => {
    stubNoActiveBatch();
    server.use(
      http.get(`/api/data/projects/${PROJECT_ID}/pages`, () =>
        HttpResponse.json({ pages: [], total: 0, limit: 500, offset: 0 }),
      ),
    );

    renderWithProviders(<ProjectReviewQueuePage />);

    await waitFor(() =>
      expect(screen.getByText(/nothing to review/i)).toBeInTheDocument(),
    );
  });

  it("renders each page row with prefix", async () => {
    stubNoActiveBatch();
    server.use(
      http.get(`/api/data/projects/${PROJECT_ID}/pages`, () =>
        HttpResponse.json({
          pages: [
            makePage({ idx0: 0, prefix: "f001" }),
            makePage({ idx0: 1, prefix: "p001" }),
          ],
          total: 2,
          limit: 500,
          offset: 0,
        }),
      ),
    );

    renderWithProviders(<ProjectReviewQueuePage />);

    await waitFor(() => expect(screen.getByText("f001")).toBeInTheDocument());
    expect(screen.getByText("p001")).toBeInTheDocument();
  });

  it("renders a 'Review →' link for each page row", async () => {
    stubNoActiveBatch();
    server.use(
      http.get(`/api/data/projects/${PROJECT_ID}/pages`, () =>
        HttpResponse.json({
          pages: [
            makePage({ idx0: 0, prefix: "p001" }),
            makePage({ idx0: 1, prefix: "p002" }),
          ],
          total: 2,
          limit: 500,
          offset: 0,
        }),
      ),
    );

    renderWithProviders(<ProjectReviewQueuePage />);

    await waitFor(() =>
      expect(screen.getAllByText(/review →/i)).toHaveLength(2),
    );
  });

  it("'Review →' links point to the correct per-page review route", async () => {
    stubNoActiveBatch();
    server.use(
      http.get(`/api/data/projects/${PROJECT_ID}/pages`, () =>
        HttpResponse.json({
          pages: [makePage({ idx0: 5, prefix: "p006" })],
          total: 1,
          limit: 500,
          offset: 0,
        }),
      ),
    );

    renderWithProviders(<ProjectReviewQueuePage />);

    const link = await screen.findByRole("link", { name: /review →/i });
    expect(link).toHaveAttribute(
      "href",
      `/projects/${PROJECT_ID}/pages/5/review`,
    );
  });
});
