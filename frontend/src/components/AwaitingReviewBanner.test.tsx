/**
 * Tests for AwaitingReviewBanner — shown on the project workbench when a
 * build_package job is parked in awaiting_review state.
 *
 * Covers:
 * - Banner appears with correct count when awaiting_review_job_id is set.
 * - "Review next page" button links to the project review queue.
 * - Banner is absent when awaiting_review_job_id is null (no parked job).
 * - Singular/plural "page"/"pages" copy.
 * - Dismiss button hides the banner.
 * - Left-accent amber border class is present (M5 hi-fi design).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
      expect(screen.getByText(/5 pages need review/i)).toBeInTheDocument(),
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
      expect(screen.queryByText(/need review/i)).not.toBeInTheDocument(),
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
      expect(screen.getByText(/1 page need review/i)).toBeInTheDocument(),
    );
  });

  it("shows build_package parked subtitle text", async () => {
    server.use(
      http.get("/api/data/projects/prj4/review-status", () =>
        HttpResponse.json({
          unreviewed_count: 3,
          awaiting_review_job_id: "job_park",
        }),
      ),
    );

    renderWithProviders(<AwaitingReviewBanner projectId="prj4" />);

    await waitFor(() =>
      expect(screen.getByText(/build_package/i)).toBeInTheDocument(),
    );
  });

  it("dismiss button hides the banner", async () => {
    server.use(
      http.get("/api/data/projects/prj5/review-status", () =>
        HttpResponse.json({
          unreviewed_count: 2,
          awaiting_review_job_id: "job_dismiss",
        }),
      ),
    );

    renderWithProviders(<AwaitingReviewBanner projectId="prj5" />);

    await waitFor(() =>
      expect(screen.getByText(/2 pages need review/i)).toBeInTheDocument(),
    );

    const dismissBtn = screen.getByRole("button", { name: /dismiss/i });
    await userEvent.click(dismissBtn);

    expect(screen.queryByText(/need review/i)).not.toBeInTheDocument();
  });

  it("has amber left-accent border styling", async () => {
    server.use(
      http.get("/api/data/projects/prj6/review-status", () =>
        HttpResponse.json({
          unreviewed_count: 2,
          awaiting_review_job_id: "job_style",
        }),
      ),
    );

    const { container } = renderWithProviders(
      <AwaitingReviewBanner projectId="prj6" />,
    );

    await waitFor(() =>
      expect(screen.getByText(/2 pages need review/i)).toBeInTheDocument(),
    );

    // The inner accent element should have the amber left-border class
    const accentEl = container.querySelector(".border-amber-500");
    expect(accentEl).not.toBeNull();
  });
});
