/**
 * Tests for JobsPage — hi-fi P3-1 redesign.
 *
 * Covers:
 * - PageHeader "Jobs" heading is shown.
 * - Filter ToggleGroup renders (All / Running / Queued / Done / Errored / Awaiting review).
 * - Jobs list renders job type and status badges.
 * - "No jobs yet" empty state is shown when the list is empty.
 * - Job Card renders for each job (type + id visible).
 * - Project filter chip is shown when ?project_id= is present.
 * - Live count badge appears when jobs are in-flight.
 * - Cancel button appears in More menu for live jobs.
 * - Retry button appears in More menu for errored/cancelled jobs.
 * - Progress text is shown when progress.total > 0.
 * - Filter ToggleGroup filters the displayed jobs.
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
    expect(
      await screen.findByRole("heading", { name: /jobs/i }),
    ).toBeInTheDocument();
  });

  it("renders the filter ToggleGroup with all options", async () => {
    server.use(http.get("/api/data/jobs", () => HttpResponse.json([])));
    renderWithProviders(<JobsPage />);
    await screen.findByRole("heading", { name: /jobs/i });
    expect(screen.getByRole("radio", { name: /^all$/i })).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /^running$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /^queued$/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /^done$/i })).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /^errored$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /awaiting review/i }),
    ).toBeInTheDocument();
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

  it("renders job Card for each job (id visible)", async () => {
    server.use(http.get("/api/data/jobs", () => HttpResponse.json([baseJob])));
    renderWithProviders(<JobsPage />);
    await waitFor(() => expect(screen.getByText("job_1")).toBeInTheDocument());
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

  it("shows cancel button in More menu for live jobs", async () => {
    server.use(http.get("/api/data/jobs", () => HttpResponse.json([baseJob])));
    renderWithProviders(<JobsPage />);
    await waitFor(() => screen.getByText("batch_process_pages"));
    // Open the More dropdown
    await userEvent.click(
      screen.getByRole("button", { name: /more actions/i }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("menuitem", { name: /cancel/i }),
      ).toBeInTheDocument(),
    );
  });

  it("shows retry button in More menu for errored jobs", async () => {
    const errorJob = {
      ...baseJob,
      id: "job_err",
      status: "error",
      progress: { current: 0, total: 0, message: "" },
    };
    server.use(http.get("/api/data/jobs", () => HttpResponse.json([errorJob])));
    renderWithProviders(<JobsPage />);
    await waitFor(() => screen.getByText("job_err"));
    await userEvent.click(
      screen.getByRole("button", { name: /more actions/i }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("menuitem", { name: /retry/i }),
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

  it("filters jobs to Done when Done tab is clicked", async () => {
    const doneJob = {
      ...baseJob,
      id: "job_done",
      status: "complete",
      progress: { current: 0, total: 0, message: "" },
    };
    server.use(
      http.get("/api/data/jobs", () => HttpResponse.json([baseJob, doneJob])),
    );
    renderWithProviders(<JobsPage />);
    await waitFor(() => screen.getByText("job_done"));

    // Both visible initially
    expect(screen.getByText("job_1")).toBeInTheDocument();

    // Click "Done" filter
    await userEvent.click(screen.getByRole("radio", { name: /^done$/i }));

    // Only done job visible
    await waitFor(() =>
      expect(screen.queryByText("batch_process_pages")).toBeInTheDocument(),
    );
    expect(screen.getByText("job_done")).toBeInTheDocument();
    expect(screen.queryByText("job_1")).not.toBeInTheDocument();
  });
});
