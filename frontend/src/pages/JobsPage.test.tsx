/**
 * Tests for JobsPage — M5 hi-fi upgrade covering the collapsible job card,
 * per-page stage cells, filter tabs, progress bar, and page detail drawer.
 *
 * Covers:
 * - "Recent jobs" heading is shown.
 * - Jobs list renders job type and status badges.
 * - "No jobs yet" empty state is shown when the list is empty.
 * - Project filter chip is shown when ?project_id= is present.
 * - Live count badge appears when jobs are in-flight.
 * - Cancel button appears for live jobs.
 * - Retry button appears for errored/cancelled jobs.
 * - Progress text is shown when progress.total > 0.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { server } from "../test/server";
import { JobsPage } from "./JobsPage";

function renderWithProviders(ui: ReactElement, initialPath = "/jobs") {
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
          <Route path="*" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const baseJob = {
  id: "job_1",
  project_id: "proj_abc",
  type: "batch_process_pages",
  status: "running",
  progress: { current: 3, total: 10, message: "processing" },
  created_at: "2026-05-01T10:00:00Z",
  started_at: "2026-05-01T10:00:01Z",
  completed_at: null,
  next_dispatch_at: null,
  error_message: null,
};

describe("JobsPage", () => {
  it("renders the page heading", async () => {
    server.use(http.get("/api/data/jobs", () => HttpResponse.json([])));
    renderWithProviders(<JobsPage />);
    expect(await screen.findByText(/recent jobs/i)).toBeInTheDocument();
  });

  it("shows empty state when no jobs", async () => {
    server.use(http.get("/api/data/jobs", () => HttpResponse.json([])));
    renderWithProviders(<JobsPage />);
    await waitFor(() =>
      expect(screen.getByText(/no jobs yet/i)).toBeInTheDocument(),
    );
  });

  it("renders job type for each job", async () => {
    server.use(http.get("/api/data/jobs", () => HttpResponse.json([baseJob])));
    renderWithProviders(<JobsPage />);
    await waitFor(() =>
      expect(screen.getByText("batch_process_pages")).toBeInTheDocument(),
    );
  });

  it("shows status badge for each job", async () => {
    server.use(http.get("/api/data/jobs", () => HttpResponse.json([baseJob])));
    renderWithProviders(<JobsPage />);
    await waitFor(() =>
      expect(screen.getByText("Running")).toBeInTheDocument(),
    );
  });

  it("shows progress text when total > 0", async () => {
    server.use(http.get("/api/data/jobs", () => HttpResponse.json([baseJob])));
    renderWithProviders(<JobsPage />);
    await waitFor(() =>
      expect(screen.getByText(/3 \/ 10/)).toBeInTheDocument(),
    );
  });

  it("shows live count badge when jobs are in-flight", async () => {
    server.use(http.get("/api/data/jobs", () => HttpResponse.json([baseJob])));
    renderWithProviders(<JobsPage />);
    await waitFor(() =>
      expect(screen.getByText(/live: 1/i)).toBeInTheDocument(),
    );
  });

  it("shows cancel button for live jobs", async () => {
    server.use(http.get("/api/data/jobs", () => HttpResponse.json([baseJob])));
    renderWithProviders(<JobsPage />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /cancel/i }),
      ).toBeInTheDocument(),
    );
  });

  it("shows retry button for errored jobs", async () => {
    const errorJob = {
      ...baseJob,
      id: "job_err",
      status: "error",
      progress: { current: 0, total: 0, message: "" },
    };
    server.use(http.get("/api/data/jobs", () => HttpResponse.json([errorJob])));
    renderWithProviders(<JobsPage />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /retry/i }),
      ).toBeInTheDocument(),
    );
  });

  it("shows project filter chip when project_id param is set", async () => {
    server.use(http.get("/api/data/jobs", () => HttpResponse.json([])));
    renderWithProviders(<JobsPage />, "/jobs?project_id=proj_abc");
    await waitFor(() =>
      expect(screen.getByText(/filtered to project/i)).toBeInTheDocument(),
    );
  });

  it("clears project filter when clear button is clicked", async () => {
    server.use(http.get("/api/data/jobs", () => HttpResponse.json([])));
    renderWithProviders(<JobsPage />, "/jobs?project_id=proj_abc");
    await waitFor(() => screen.getByText(/filtered to project/i));
    await userEvent.click(
      screen.getByRole("button", { name: /clear filter/i }),
    );
    await waitFor(() =>
      expect(
        screen.queryByText(/filtered to project/i),
      ).not.toBeInTheDocument(),
    );
  });

  it("shows error message for failed jobs", async () => {
    const errorJob = {
      ...baseJob,
      id: "job_err2",
      status: "error",
      progress: { current: 0, total: 0, message: "" },
      error_message: "timeout after 60s",
    };
    server.use(http.get("/api/data/jobs", () => HttpResponse.json([errorJob])));
    renderWithProviders(<JobsPage />);
    await waitFor(() =>
      expect(screen.getByText(/timeout after 60s/i)).toBeInTheDocument(),
    );
  });
});
