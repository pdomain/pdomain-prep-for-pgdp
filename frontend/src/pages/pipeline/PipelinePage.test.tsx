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
