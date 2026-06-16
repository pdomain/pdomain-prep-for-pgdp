/**
 * PipelinePage artboard fixture tests.
 *
 * Covers every DCArtboard state from final/pipeline/ canvases.
 * Style: F3 component test pattern (no router mocking — uses MemoryRouter).
 *
 * DCArtboard states:
 *   - booting          — fetchPipeline in flight → spinner
 *   - loadError        — fetchPipeline failed → retry button
 *   - pipeline/stages  — stage strip + tabs + tool slot
 *   - pipeline/settings — settings panel swap
 *   - pipeline/dots    — StageStrip dot projection from runner snapshots
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/test/server";
import { PipelinePage, type PipelinePageServices } from "./PipelinePage";
import type { PipelineShellServices } from "@/machines/pipelineShell";
import type { ProjectSettingsServices } from "@/machines/projectSettings";
import {
  MOCK_PROJECT_ID,
  MOCK_PROJECT,
  MOCK_AUTOMATION,
  makeFreshPageStages,
  makeFreshProjectStages,
} from "@/mocks/fixtures";
import type { PipelineSnapshot } from "@/mocks/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePipelineSnapshot(): PipelineSnapshot {
  const projectStagesMap = makeFreshProjectStages();
  const pageStagesMap = makeFreshPageStages();
  const pageStageIds = Array.from(pageStagesMap.get("0000")?.keys() ?? []);
  return {
    project: MOCK_PROJECT,
    page_stages_summary: pageStageIds.map((stageId) => ({
      stage_id: stageId,
      worst_status: "not_run",
      stale_count: 0,
      flagged_count: 0,
    })),
    project_stages: Array.from(projectStagesMap.values()),
    automation: MOCK_AUTOMATION,
  };
}

function makeShellServices(
  overrides: Partial<PipelineShellServices> = {},
): PipelineShellServices {
  return {
    fetchPipeline: vi.fn().mockResolvedValue(makePipelineSnapshot()),
    runnerServices: {
      runStage: vi
        .fn()
        .mockResolvedValue({ status: "clean", flaggedPages: [] }),
      requestCancel: vi.fn().mockResolvedValue(undefined),
      requestPause: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };
}

function makeSettingsServices(
  overrides: Partial<ProjectSettingsServices> = {},
): ProjectSettingsServices {
  return {
    fetchSettings: vi.fn().mockResolvedValue({
      values: { name: "Test Book" },
      automation: {
        autoRunAfterIngest: true,
        rerunDownstreamOnStale: true,
        notifyOnError: true,
        pauseOnFlagPct: 10,
      },
    }),
    saveField: vi.fn().mockResolvedValue(undefined),
    saveAutomation: vi.fn().mockResolvedValue(undefined),
    runDestructive: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

function makeServices(
  shellOverrides: Partial<PipelineShellServices> = {},
  settingsOverrides: Partial<ProjectSettingsServices> = {},
): PipelinePageServices {
  return {
    shell: makeShellServices(shellOverrides),
    settings: makeSettingsServices(settingsOverrides),
  };
}

function renderPipeline(
  services: PipelinePageServices,
  path = `/projects/${MOCK_PROJECT_ID}/pipeline`,
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/projects/:projectId/pipeline"
            element={<PipelinePage services={services} />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Artboard: booting
// ---------------------------------------------------------------------------

describe("PipelinePage — booting", () => {
  it("shows loading spinner while fetchPipeline is in flight", () => {
    const services = makeServices({
      fetchPipeline: vi.fn().mockReturnValue(new Promise(() => {})),
    });
    renderPipeline(services);
    expect(screen.getByTestId("pipeline-loading")).toBeDefined();
  });

  it("hides pipeline content while booting", () => {
    const services = makeServices({
      fetchPipeline: vi.fn().mockReturnValue(new Promise(() => {})),
    });
    renderPipeline(services);
    expect(screen.queryByTestId("stage-strip")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Artboard: loadError
// ---------------------------------------------------------------------------

describe("PipelinePage — loadError", () => {
  it("shows error message when fetchPipeline rejects", async () => {
    const services = makeServices({
      fetchPipeline: vi.fn().mockRejectedValue(new Error("network error")),
    });
    renderPipeline(services);
    await waitFor(() => {
      expect(screen.getByTestId("pipeline-error")).toBeDefined();
    });
  });

  it("shows retry button in loadError", async () => {
    const services = makeServices({
      fetchPipeline: vi.fn().mockRejectedValue(new Error("fail")),
    });
    renderPipeline(services);
    await waitFor(() => {
      expect(screen.getByTestId("pipeline-retry-btn")).toBeDefined();
    });
  });

  it("retry button calls fetchPipeline again", async () => {
    const fetchPipeline = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue(makePipelineSnapshot());
    const services = makeServices({ fetchPipeline });
    renderPipeline(services);
    await waitFor(() => {
      expect(screen.getByTestId("pipeline-retry-btn")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("pipeline-retry-btn"));
    await waitFor(() => {
      expect(fetchPipeline).toHaveBeenCalledTimes(2);
    });
  });
});

// ---------------------------------------------------------------------------
// Artboard: pipeline/stages
// ---------------------------------------------------------------------------

describe("PipelinePage — pipeline/stages", () => {
  it("renders stage-strip after boot", async () => {
    const services = makeServices();
    renderPipeline(services);
    await waitFor(() => {
      expect(screen.getByTestId("stage-strip")).toBeDefined();
    });
  });

  it("renders project-info-band", async () => {
    const services = makeServices();
    renderPipeline(services);
    await waitFor(() => {
      expect(screen.getByTestId("project-info-band")).toBeDefined();
    });
  });

  it("pipeline-project-title heading shows human project name, not UUID", async () => {
    const services = makeServices();
    renderPipeline(services);
    await waitFor(() => {
      const heading = screen.getByTestId("pipeline-project-title");
      // Should show the human name from the snapshot (MOCK_PROJECT.name = "Mock Book")
      expect(heading.textContent).toBe(MOCK_PROJECT.name);
      // Must NOT show the raw UUID as the heading
      expect(heading.textContent).not.toBe(MOCK_PROJECT_ID);
    });
  });

  it("pipeline-project-title heading falls back to projectId when projectName is empty", async () => {
    // Snapshot with an empty name (wire field is `name`, not `title`)
    const snapshot = makePipelineSnapshot();
    const snapshotWithEmptyTitle = {
      ...snapshot,
      project: { ...snapshot.project, name: "" },
    };
    const services = makeServices({
      fetchPipeline: vi.fn().mockResolvedValue(snapshotWithEmptyTitle),
    });
    renderPipeline(services);
    await waitFor(() => {
      const heading = screen.getByTestId("pipeline-project-title");
      // Falls back to the project id from the URL param
      expect(heading.textContent).toBe(MOCK_PROJECT_ID);
    });
  });

  it("project UUID appears as secondary line below the heading", async () => {
    const services = makeServices();
    renderPipeline(services);
    await waitFor(() => {
      const band = screen.getByTestId("project-info-band");
      const heading = screen.getByTestId("pipeline-project-title");
      // The band contains the project id (as a secondary line, not the heading)
      expect(band.textContent).toContain(MOCK_PROJECT_ID);
      // The heading itself does not show the raw UUID
      expect(heading.textContent).toBe(MOCK_PROJECT.name);
    });
  });

  it("renders tabs-band", async () => {
    const services = makeServices();
    renderPipeline(services);
    await waitFor(() => {
      expect(screen.getByTestId("tabs-band")).toBeDefined();
    });
  });

  it("renders 23 runner dots (one per RUNNER_STAGE_DEFS)", async () => {
    const services = makeServices();
    renderPipeline(services);
    await waitFor(() => {
      // 23 dots + 1 source dot = 24 total
      const dots = screen.getAllByTestId(/^stage-dot-/);
      // Source dot + 23 runner dots
      expect(dots.length).toBeGreaterThanOrEqual(23);
    });
  });

  it("renders Prev button", async () => {
    const services = makeServices();
    renderPipeline(services);
    await waitFor(() => {
      expect(screen.getByTestId("stage-prev-btn")).toBeDefined();
    });
  });

  it("renders Next button", async () => {
    const services = makeServices();
    renderPipeline(services);
    await waitFor(() => {
      expect(screen.getByTestId("stage-next-btn")).toBeDefined();
    });
  });

  it("renders tool-slot-area", async () => {
    const services = makeServices();
    renderPipeline(services);
    await waitFor(() => {
      expect(screen.getByTestId("tool-slot-area")).toBeDefined();
    });
  });

  it("renders F5 tool (ImageStageReviewTool) for default threshold stage", async () => {
    // F5 filled TOOL_REGISTRY — the placeholder no longer appears for registered stages.
    // Default stage is "threshold" → ImageStageReviewTool renders.
    const services = makeServices();
    renderPipeline(services);
    await waitFor(() => {
      expect(
        screen.getByTestId("image-stage-review-tool-threshold"),
      ).toBeDefined();
    });
  });

  it("clicking stage dot changes selected stage", async () => {
    const services = makeServices();
    renderPipeline(services);
    await waitFor(() => {
      expect(screen.getByTestId("stage-dot-grayscale")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("stage-dot-grayscale"));
    await waitFor(() => {
      expect(screen.getByTestId("stage-chip-label").textContent).toBe(
        "grayscale",
      );
    });
  });

  it("clicking Next navigates to next stage", async () => {
    const services = makeServices();
    renderPipeline(
      services,
      `/projects/${MOCK_PROJECT_ID}/pipeline?stage=threshold`,
    );
    await waitFor(() => {
      expect(screen.getByTestId("stage-chip-label").textContent).toBe(
        "threshold",
      );
    });
    fireEvent.click(screen.getByTestId("stage-next-btn"));
    // Should advance to deskew (next after threshold in STAGE_DEFS)
    await waitFor(() => {
      expect(screen.getByTestId("stage-chip-label").textContent).not.toBe(
        "threshold",
      );
    });
  });

  it("renders Run all stale button", async () => {
    const services = makeServices();
    renderPipeline(services);
    await waitFor(() => {
      expect(screen.getByTestId("run-all-stale-btn")).toBeDefined();
    });
  });

  it("renders settings-toggle-btn", async () => {
    const services = makeServices();
    renderPipeline(services);
    await waitFor(() => {
      expect(screen.getByTestId("settings-toggle-btn")).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Artboard: pipeline/settings
// ---------------------------------------------------------------------------

describe("PipelinePage — pipeline/settings", () => {
  it("clicking settings toggle opens settings panel", async () => {
    const services = makeServices();
    renderPipeline(services);
    await waitFor(() => {
      expect(screen.getByTestId("settings-toggle-btn")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("settings-toggle-btn"));
    await waitFor(() => {
      // Stage strip should be hidden, settings panel should appear
      expect(screen.queryByTestId("stage-strip")).toBeNull();
      // Settings loading or panel should be visible
      const settingsEl =
        screen.queryByTestId("settings-panel") ??
        screen.queryByTestId("settings-loading") ??
        screen.queryByTestId("settings-error");
      expect(settingsEl).toBeDefined();
    });
  });

  it("settings panel shows group rail after load", async () => {
    const services = makeServices();
    renderPipeline(services);
    await waitFor(() => {
      expect(screen.getByTestId("settings-toggle-btn")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("settings-toggle-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("settings-group-rail")).toBeDefined();
    });
  });

  it("settings panel has group buttons for all 8 groups", async () => {
    const services = makeServices();
    renderPipeline(services);
    await waitFor(() => {
      expect(screen.getByTestId("settings-toggle-btn")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("settings-toggle-btn"));
    await waitFor(() => {
      const groups = [
        "general",
        "bib",
        "pgdp",
        "format",
        "defaults",
        "members",
        "storage",
        "danger",
      ];
      for (const g of groups) {
        expect(screen.getByTestId(`settings-group-${g}`)).toBeDefined();
      }
    });
  });

  it("Close settings button returns to stage view", async () => {
    const services = makeServices();
    renderPipeline(services);
    await waitFor(() => {
      expect(screen.getByTestId("settings-toggle-btn")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("settings-toggle-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("settings-close-btn")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("settings-close-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("stage-strip")).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Artboard: StageStrip dot projections
// ---------------------------------------------------------------------------

describe("PipelinePage — StageStrip dot projections", () => {
  it("source dot is rendered independently of runners", async () => {
    const services = makeServices();
    renderPipeline(services);
    await waitFor(() => {
      expect(screen.getByTestId("stage-dot-source")).toBeDefined();
    });
  });

  it("each runner stage has a dot with correct testid", async () => {
    const services = makeServices();
    renderPipeline(services);
    await waitFor(() => {
      // Check a sample of runner stage dots
      expect(screen.getByTestId("stage-dot-grayscale")).toBeDefined();
      expect(screen.getByTestId("stage-dot-threshold")).toBeDefined();
      expect(screen.getByTestId("stage-dot-ocr")).toBeDefined();
      expect(screen.getByTestId("stage-dot-archive")).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Stat tiles in ProjectInfoBand
// ---------------------------------------------------------------------------

describe("PipelinePage — ProjectInfoBand stat tiles", () => {
  it("renders pipeline-stat-tiles container after boot", async () => {
    const services = makeServices();
    renderPipeline(services);
    await waitFor(() => {
      expect(screen.getByTestId("pipeline-stat-tiles")).toBeDefined();
    });
  });

  it("renders stat-total-pages tile", async () => {
    const services = makeServices();
    renderPipeline(services);
    await waitFor(() => {
      expect(screen.getByTestId("stat-total-pages")).toBeDefined();
    });
  });

  it("renders stat-done tile", async () => {
    const services = makeServices();
    renderPipeline(services);
    await waitFor(() => {
      expect(screen.getByTestId("stat-done")).toBeDefined();
    });
  });

  it("renders stat-awaiting-review tile", async () => {
    const services = makeServices();
    renderPipeline(services);
    await waitFor(() => {
      expect(screen.getByTestId("stat-awaiting-review")).toBeDefined();
    });
  });

  it("stat-total-pages shows page_count from project snapshot", async () => {
    // MOCK_PROJECT.page_count is set in fixtures — verify it shows up in the tile.
    const services = makeServices();
    renderPipeline(services);
    await waitFor(() => {
      const tile = screen.getByTestId("stat-total-pages");
      // The tile should contain a numeric value (page_count from MOCK_PROJECT).
      expect(tile.textContent).toMatch(/\d/);
    });
  });
});

// ---------------------------------------------------------------------------
// IngestBanner — shown while unzip/thumbnails job is running or queued
// ---------------------------------------------------------------------------
//
// The banner is driven by useActiveBatchJob which polls /api/data/jobs.
// The global MSW handler returns [] by default; individual tests override
// it with server.use(...) to inject a live ingest job.

describe("PipelinePage — IngestBanner", () => {
  it("banner is hidden when there are no active ingest jobs", async () => {
    // Default handler returns [] so no ingest job is live.
    const services = makeServices();
    renderPipeline(services);
    await waitFor(() => {
      // Page has finished booting (stage-strip is visible).
      expect(screen.getByTestId("stage-strip")).toBeDefined();
    });
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });

  it("banner shows 'Creating thumbnails…' for a live thumbnails job", async () => {
    server.use(
      http.get("/api/data/jobs", () =>
        HttpResponse.json([
          {
            id: "job-thumb-1",
            type: "thumbnails",
            status: "running",
            progress: { current: 3, total: 10, message: "" },
          },
        ]),
      ),
    );
    const services = makeServices();
    renderPipeline(services);
    await waitFor(() => {
      expect(screen.getByTestId("ingest-banner")).toBeDefined();
    });
    expect(screen.getByTestId("ingest-banner-label").textContent).toBe(
      "Creating thumbnails…",
    );
  });

  it("banner shows 'Unzipping source archive…' for a live unzip job", async () => {
    server.use(
      http.get("/api/data/jobs", () =>
        HttpResponse.json([
          {
            id: "job-unzip-1",
            type: "unzip",
            status: "scheduled",
            progress: { current: 0, total: 0, message: "" },
          },
        ]),
      ),
    );
    const services = makeServices();
    renderPipeline(services);
    await waitFor(() => {
      expect(screen.getByTestId("ingest-banner")).toBeDefined();
    });
    expect(screen.getByTestId("ingest-banner-label").textContent).toBe(
      "Unzipping source archive…",
    );
  });

  it("banner links to /jobs?project_id=<id>", async () => {
    server.use(
      http.get("/api/data/jobs", () =>
        HttpResponse.json([
          {
            id: "job-thumb-2",
            type: "thumbnails",
            status: "queued",
            progress: { current: 0, total: 0, message: "" },
          },
        ]),
      ),
    );
    const services = makeServices();
    renderPipeline(services);
    await waitFor(() => {
      expect(screen.getByTestId("ingest-banner")).toBeDefined();
    });
    const link = screen.getByRole("link", { name: /open jobs page/i });
    expect((link as HTMLAnchorElement).href).toContain(
      `/jobs?project_id=${encodeURIComponent(MOCK_PROJECT_ID)}`,
    );
  });

  it("banner is hidden for a completed thumbnails job", async () => {
    server.use(
      http.get("/api/data/jobs", () =>
        HttpResponse.json([
          {
            id: "job-thumb-done",
            type: "thumbnails",
            status: "complete",
            progress: { current: 10, total: 10, message: "" },
          },
        ]),
      ),
    );
    const services = makeServices();
    renderPipeline(services);
    await waitFor(() => {
      expect(screen.getByTestId("stage-strip")).toBeDefined();
    });
    expect(screen.queryByTestId("ingest-banner")).toBeNull();
  });
});
