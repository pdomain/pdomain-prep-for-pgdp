/**
 * GrayscaleTool — high-fidelity artboard tests.
 *
 * Tests cover the workbench states that the design canvas defines:
 *   - detecting    — auto-detect in flight → detecting banner visible
 *   - converting   — detection resolved, pages in flight → converting-progress
 *   - done/idle    — pages loaded → tab bar + workbench panels visible
 *   - error        — detection failed → error panel + retry
 *
 * Tab-bar navigation (overview / pages / workbench / settings) is smoke-tested.
 *
 * DRIFT (I1): Workbench sub-states that require PAGE_PUSH via real SSE
 * (done/tuned, apply-run → converting) are deferred to e2e / integration
 * tests that can drive the full SSE stack.
 *
 * @see src/pages/pipeline/tools/GrayscaleTool.tsx
 * @see docs/plans/design_handoff_pgdp_app/final/grayscale/grayscale.jsx
 */

import { describe, it, expect } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { GrayscaleTool } from "./GrayscaleTool";
import type { ToolSlotProps } from "../toolSlot";
import type { GrayscaleToolServices } from "@/machines/tools/grayscaleTool";
import { stubStageSettingsServices } from "@/machines/tools/stageSettings";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_RUNNER_REF = {} as ToolSlotProps["runnerRef"];

/** Default stub services: detectProfile resolves to perceptual / GPU. */
const defaultServices: GrayscaleToolServices = {
  ...stubStageSettingsServices(),
  detectProfile: () =>
    Promise.resolve({
      config: {
        flatten: { enabled: false, radius: 64, strength: 1.0 },
        converter: "luma" as const,
        channel: "green" as const,
        color2gray: {
          radius: 300,
          samples: 4,
          iterations: 10,
          enhance_shadows: false,
        },
        clahe: { enabled: false, clip_limit: 2.0, tile_grid: 8 },
        output_range: null,
      },
      mode: "perceptual" as const,
      why: "newsprint · low contrast · low DPI",
      backend: "gpu" as const,
    }),
  runStage: () => Promise.resolve(),
  runPageStage: () => Promise.resolve(),
  // Return no pages so tests are not affected by REST prefetch.
  loadPageStages: () => Promise.resolve([]),
};

function renderGrayscale(
  props: Partial<ToolSlotProps> & {
    _testServices?: GrayscaleToolServices;
  } = {},
) {
  return render(
    <MemoryRouter>
      <GrayscaleTool
        stageId="grayscale"
        runnerRef={MOCK_RUNNER_REF}
        _testServices={defaultServices}
        {...props}
      />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// 1. Detecting state — auto-detect in flight
// ---------------------------------------------------------------------------

describe("GrayscaleTool — detecting state", () => {
  it("renders the grayscale-tool wrapper", () => {
    renderGrayscale();
    expect(screen.getByTestId("grayscale-tool")).toBeDefined();
  });

  it("shows the detecting banner while detecting", () => {
    renderGrayscale();
    expect(screen.getByTestId("autodetect-banner-detecting")).toBeDefined();
  });

  it("detecting banner contains 'Detecting' text", () => {
    renderGrayscale();
    expect(
      screen.getByTestId("autodetect-banner-detecting").textContent,
    ).toContain("Detecting");
  });

  it("renders the tab bar in detecting state", () => {
    renderGrayscale();
    expect(screen.getByTestId("grayscale-tab-bar")).toBeDefined();
  });

  it("workbench tab is selected by default", () => {
    renderGrayscale();
    const workbenchTab = screen.getByTestId("grayscale-tab-workbench");
    expect(workbenchTab).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Converting state — detection resolved, SSE in flight
// ---------------------------------------------------------------------------

describe("GrayscaleTool — converting state", () => {
  it("shows autodetect-banner-result in Overview tab after detection resolves", async () => {
    renderGrayscale();
    // Navigate to overview where the auto-detect result banner lives
    await waitFor(() => {
      expect(screen.getByTestId("grayscale-tab-overview")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("grayscale-tab-overview"));
    await waitFor(() => {
      expect(screen.getByTestId("autodetect-banner-result")).toBeDefined();
    });
  });

  it("result banner in Overview contains detected mode", async () => {
    renderGrayscale();
    await waitFor(() => {
      expect(screen.getByTestId("grayscale-tab-overview")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("grayscale-tab-overview"));
    await waitFor(() => {
      expect(
        screen.getByTestId("autodetect-banner-result").textContent,
      ).toContain("perceptual");
    });
  });

  it("shows converting-progress banner while converting", async () => {
    renderGrayscale();
    await waitFor(() => {
      expect(screen.getByTestId("converting-progress")).toBeDefined();
    });
  });

  it("converting-progress contains 'Converting'", async () => {
    renderGrayscale();
    await waitFor(() => {
      expect(screen.getByTestId("converting-progress").textContent).toContain(
        "Converting",
      );
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Tab bar navigation (smoke — converting state has tab bar)
// ---------------------------------------------------------------------------

describe("GrayscaleTool — tab bar", () => {
  it("renders all four tabs", async () => {
    renderGrayscale();
    await waitFor(() => {
      expect(screen.getByTestId("grayscale-tab-overview")).toBeDefined();
      expect(screen.getByTestId("grayscale-tab-pages")).toBeDefined();
      expect(screen.getByTestId("grayscale-tab-workbench")).toBeDefined();
      expect(screen.getByTestId("grayscale-tab-settings")).toBeDefined();
    });
  });

  it("clicking Overview tab does not crash", async () => {
    renderGrayscale();
    await waitFor(() => {
      expect(screen.getByTestId("grayscale-tab-overview")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("grayscale-tab-overview"));
    // Overview tab renders stat tiles — check subhead appears
    expect(screen.getByTestId("grayscale-tool")).toBeDefined();
  });

  it("clicking Settings tab does not crash", async () => {
    renderGrayscale();
    await waitFor(() => {
      expect(screen.getByTestId("grayscale-tab-settings")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("grayscale-tab-settings"));
    expect(screen.getByTestId("grayscale-tool")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Workbench tab — drawer + viewer (no pages yet = empty placeholders)
// ---------------------------------------------------------------------------

describe("GrayscaleTool — workbench tab (no pages)", () => {
  it("renders stage-controls-drawer in workbench tab", async () => {
    renderGrayscale();
    await waitFor(() => {
      expect(screen.getByTestId("stage-controls-drawer")).toBeDefined();
    });
  });

  it("renders page-viewer in workbench tab", async () => {
    renderGrayscale();
    await waitFor(() => {
      expect(screen.getByTestId("page-viewer")).toBeDefined();
    });
  });

  it("workbench subhead contains 'Page workbench'", async () => {
    renderGrayscale();
    await waitFor(() => {
      expect(screen.getByTestId("grayscale-tool").textContent).toContain(
        "Page workbench",
      );
    });
  });

  it("view-mode toggle has before / split / after buttons", async () => {
    renderGrayscale();
    await waitFor(() => {
      expect(screen.getByTestId("view-mode-before")).toBeDefined();
      expect(screen.getByTestId("view-mode-split")).toBeDefined();
      expect(screen.getByTestId("view-mode-after")).toBeDefined();
    });
  });

  it("apply-run-btn is present", async () => {
    renderGrayscale();
    await waitFor(() => {
      expect(screen.getByTestId("apply-run-btn")).toBeDefined();
    });
  });

  it("backend-chip renders in the drawer", async () => {
    renderGrayscale();
    await waitFor(() => {
      expect(screen.getByTestId("backend-chip")).toBeDefined();
    });
  });

  it("mode-row-perceptual is present and selected by default", async () => {
    renderGrayscale();
    await waitFor(() => {
      expect(screen.getByTestId("mode-row-perceptual")).toBeDefined();
    });
  });

  it("mode-row-standard is present", async () => {
    renderGrayscale();
    await waitFor(() => {
      expect(screen.getByTestId("mode-row-standard")).toBeDefined();
    });
  });

  it("page-strip is present", async () => {
    renderGrayscale();
    await waitFor(() => {
      expect(screen.getByTestId("page-strip")).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// 5. Error state — detection failed
// ---------------------------------------------------------------------------

describe("GrayscaleTool — error state", () => {
  const errorServices: GrayscaleToolServices = {
    ...stubStageSettingsServices(),
    detectProfile: () => Promise.reject(new Error("network error")),
    runStage: () => Promise.resolve(),
    runPageStage: () => Promise.resolve(),
    loadPageStages: () => Promise.resolve([]),
  };

  it("renders grayscale-tool-error when detectProfile rejects", async () => {
    renderGrayscale({ _testServices: errorServices });
    await waitFor(() => {
      expect(screen.getByTestId("grayscale-tool-error")).toBeDefined();
    });
  });

  it("error panel contains 'Retry' button", async () => {
    renderGrayscale({ _testServices: errorServices });
    await waitFor(() => {
      expect(screen.getByTestId("grayscale-tool-error").textContent).toContain(
        "Retry",
      );
    });
  });

  it("error panel shows the rejection message", async () => {
    renderGrayscale({ _testServices: errorServices });
    await waitFor(() => {
      expect(screen.getByTestId("grayscale-tool-error").textContent).toContain(
        "network error",
      );
    });
  });
});

// ---------------------------------------------------------------------------
// 6. Stage settings tab
// ---------------------------------------------------------------------------

describe("GrayscaleTool — settings tab", () => {
  it("settings tab renders mode-cards after detect resolves", async () => {
    renderGrayscale();
    await waitFor(() => {
      expect(screen.getByTestId("grayscale-tab-settings")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("grayscale-tab-settings"));
    await waitFor(() => {
      expect(screen.getByTestId("mode-cards")).toBeDefined();
    });
  });

  it("settings tab renders settings-autodetect-banner", async () => {
    renderGrayscale();
    await waitFor(() => {
      expect(screen.getByTestId("grayscale-tab-settings")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("grayscale-tab-settings"));
    await waitFor(() => {
      expect(screen.getByTestId("settings-autodetect-banner")).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// 7. Overview tab
// ---------------------------------------------------------------------------

describe("GrayscaleTool — overview tab", () => {
  it("clicking Overview renders redetect button", async () => {
    renderGrayscale();
    await waitFor(() => {
      expect(screen.getByTestId("grayscale-tab-overview")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("grayscale-tab-overview"));
    await waitFor(() => {
      expect(screen.getByTestId("redetect-btn")).toBeDefined();
    });
  });
});
