/**
 * Tests for AwaitingReviewBanner — shown on the project workbench when a
 * build_package job is parked in awaiting_review state.
 *
 * Covers:
 * - Banner appears with correct count when awaiting_review_job_id is set.
 * - "Review next page" button links to the project review queue.
 * - Banner is absent when awaiting_review_job_id is null (no parked job).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { server } from "../test/server";
import { AwaitingReviewBanner } from "./AwaitingReviewBanner";

function renderWithProviders(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AwaitingReviewBanner", () => {
  it("shows the banner with unreviewed count when a parked job exists", async () => {
    server.use(
      http.get("/api/data/projects/prj1/review-status", () =>
        HttpResponse.json({
          unreviewed_count: 5,
          awaiting_review_job_id: "job_abc",
        }),
      ),
    );

    renderWithProviders(<AwaitingReviewBanner projectId="prj1" />);

    await waitFor(() =>
      expect(screen.getByText(/5 pages awaiting review/i)).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("link", { name: /review next page/i }),
    ).toHaveAttribute("href", "/projects/prj1/review");
  });

  it("renders nothing when awaiting_review_job_id is null", async () => {
    server.use(
      http.get("/api/data/projects/prj2/review-status", () =>
        HttpResponse.json({
          unreviewed_count: 0,
          awaiting_review_job_id: null,
        }),
      ),
    );

    const { container } = renderWithProviders(
      <AwaitingReviewBanner projectId="prj2" />,
    );

    await waitFor(() =>
      expect(screen.queryByText(/awaiting review/i)).not.toBeInTheDocument(),
    );
    // Container should be empty (null render)
    expect(container.firstChild).toBeNull();
  });

  it("shows singular 'page' when only 1 page is unreviewed", async () => {
    server.use(
      http.get("/api/data/projects/prj3/review-status", () =>
        HttpResponse.json({
          unreviewed_count: 1,
          awaiting_review_job_id: "job_xyz",
        }),
      ),
    );

    renderWithProviders(<AwaitingReviewBanner projectId="prj3" />);

    await waitFor(() =>
      expect(screen.getByText(/1 page awaiting review/i)).toBeInTheDocument(),
    );
  });
});
