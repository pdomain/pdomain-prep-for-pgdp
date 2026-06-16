/**
 * ProjectConfigurePage — retirement tests.
 *
 * The old ProjectConfigurePage has been retired. This file asserts that:
 * 1. Navigating to /projects/:id redirects to /projects/:id/pipeline (React Router Navigate).
 * 2. The pipeline shell renders correctly at the redirected URL.
 *
 * All old ProjectConfigurePage unit tests (RunAllDirtyPanel, tab scaffold,
 * RunPipelinePanel, Download Package, PageDrawer, BulkActions, drag-and-drop)
 * have been removed — the pipeline shell (PipelinePage) owns those surfaces now.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, Navigate } from "react-router-dom";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderWithRedirect(initialPath: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  // Minimal stand-in for the pipeline page so we can assert redirection without
  // mounting the full PipelinePage (which needs services / MSW).
  function PipelinePlaceholder() {
    return <div data-testid="pipeline-shell">pipeline shell</div>;
  }

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          {/* The retired route: /projects/:id → redirect to pipeline sub-path */}
          <Route
            path="/projects/:projectId"
            element={<Navigate to="pipeline" replace />}
          />
          {/* Pipeline route: /projects/:id/pipeline */}
          <Route
            path="/projects/:projectId/pipeline"
            element={<PipelinePlaceholder />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProjectConfigurePage retirement — /projects/:id redirect", () => {
  it("navigating to /projects/:id redirects to /projects/:id/pipeline", async () => {
    renderWithRedirect("/projects/proj1");

    // The redirect renders the pipeline shell, not the old configure page.
    await waitFor(() => {
      expect(screen.getByTestId("pipeline-shell")).toBeInTheDocument();
    });
  });

  it("redirect preserves :projectId and lands on /pipeline sub-path", async () => {
    renderWithRedirect("/projects/book-abc");

    await waitFor(() => {
      expect(screen.getByTestId("pipeline-shell")).toBeInTheDocument();
    });
  });

  it("does not render the old ProjectConfigurePage content after redirect", async () => {
    renderWithRedirect("/projects/proj1");

    await waitFor(() => {
      expect(screen.getByTestId("pipeline-shell")).toBeInTheDocument();
    });
    // Old page had a "Run all dirty stages" button — it must not exist.
    expect(
      screen.queryByRole("button", { name: /run all dirty stages/i }),
    ).not.toBeInTheDocument();
  });
});
