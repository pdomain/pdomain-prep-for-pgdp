/**
 * GrayscaleTool artboard fixture tests.
 *
 * DCArtboard states:
 *   - detecting    — auto-detect in flight → detecting banner
 *   - converting   — pages being converted → converting-progress shown
 *   - done/idle    — detection resolved, pages converted → settings panel
 *   - done/tuned   — draft modified → Apply & re-run enabled
 *   - error        — detection failed → retry shown
 *
 * @see docs/plans/design_handoff_pgdp_app/final/grayscale/grayscale.jsx
 * @see src/pages/pipeline/tools/GrayscaleTool.tsx
 */

import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { GrayscaleTool } from "./GrayscaleTool";
import type { ToolSlotProps } from "../toolSlot";
import type { GrayscaleToolServices } from "@/machines/tools/grayscaleTool";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_RUNNER_REF = {} as ToolSlotProps["runnerRef"];

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
        {...props}
      />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Artboard: detecting state
// ---------------------------------------------------------------------------

describe("GrayscaleTool — detecting (auto-detect in flight)", () => {
  it("renders the auto-detect detecting banner while detecting", () => {
    renderGrayscale();
    // Machine starts in detecting state
    expect(screen.getByTestId("autodetect-banner-detecting")).toBeDefined();
  });

  it("shows 'Detecting source profile' message", () => {
    renderGrayscale();
    const banner = screen.getByTestId("autodetect-banner-detecting");
    expect(banner.textContent).toContain("Detecting");
  });

  it("renders the grayscale-tool wrapper element", () => {
    renderGrayscale();
    expect(screen.getByTestId("grayscale-tool")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Artboard: done/idle state
// ---------------------------------------------------------------------------

describe("GrayscaleTool — done/idle (detection resolved)", () => {
  it("shows autodetect result banner after detection resolves", async () => {
    renderGrayscale();
    await waitFor(() => {
      expect(screen.getByTestId("autodetect-banner-result")).toBeDefined();
    });
  });

  it("result banner contains the detected mode", async () => {
    renderGrayscale();
    await waitFor(() => {
      const banner = screen.getByTestId("autodetect-banner-result");
      expect(banner.textContent).toContain("perceptual");
    });
  });

  it("shows backend chip after detection", async () => {
    renderGrayscale();
    await waitFor(() => {
      expect(screen.getByTestId("backend-chip")).toBeDefined();
    });
  });

  it("renders step-settings-panel in done state", async () => {
    renderGrayscale();
    await waitFor(() => {
      expect(screen.getByTestId("step-settings-panel")).toBeDefined();
    });
  });

  it("renders grayscale action bar in done state", async () => {
    renderGrayscale();
    await waitFor(() => {
      expect(screen.getByTestId("grayscale-action-bar")).toBeDefined();
    });
  });

  it("renders Apply & re-run button in done state", async () => {
    renderGrayscale();
    await waitFor(() => {
      expect(screen.getByTestId("apply-run-btn")).toBeDefined();
    });
  });

  it("renders mode toggle with perceptual/standard options", async () => {
    renderGrayscale();
    await waitFor(() => {
      expect(screen.getByTestId("mode-toggle")).toBeDefined();
      expect(screen.getByTestId("mode-btn-perceptual")).toBeDefined();
      expect(screen.getByTestId("mode-btn-standard")).toBeDefined();
    });
  });

  it("renders grayscale filter bar in done state", async () => {
    renderGrayscale();
    await waitFor(() => {
      expect(screen.getByTestId("grayscale-filter-bar")).toBeDefined();
    });
  });

  it("filter bar has all / perceptual / standard chips", async () => {
    renderGrayscale();
    await waitFor(() => {
      expect(screen.getByTestId("gs-filter-all")).toBeDefined();
      expect(screen.getByTestId("gs-filter-perceptual")).toBeDefined();
      expect(screen.getByTestId("gs-filter-standard")).toBeDefined();
    });
  });

  it("renders gamma slider in step-settings panel", async () => {
    renderGrayscale();
    await waitFor(() => {
      expect(screen.getByTestId("slider-gamma")).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Artboard: converting state (pages being processed)
// ---------------------------------------------------------------------------

describe("GrayscaleTool — converting state", () => {
  it("renders converting-progress banner while pages are being converted", async () => {
    // Machine flow: detecting → converting (after detectProfile resolves).
    // The converting-progress testid appears before PAGE_PUSH events complete.
    renderGrayscale();
    await waitFor(() => {
      expect(screen.getByTestId("converting-progress")).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Artboard: error state (detection failed)
// ---------------------------------------------------------------------------

describe("GrayscaleTool — error state", () => {
  it("renders grayscale-tool-error when detectProfile rejects", async () => {
    const errorServices: GrayscaleToolServices = {
      detectProfile: () => Promise.reject(new Error("network error")),
    };
    renderGrayscale({ _testServices: errorServices });
    await waitFor(() => {
      expect(screen.getByTestId("grayscale-tool-error")).toBeDefined();
    });
  });

  it("error banner shows retry button", async () => {
    const errorServices: GrayscaleToolServices = {
      detectProfile: () => Promise.reject(new Error("detect failed")),
    };
    renderGrayscale({ _testServices: errorServices });
    await waitFor(() => {
      const errorEl = screen.getByTestId("grayscale-tool-error");
      expect(errorEl.textContent).toContain("Retry");
    });
  });
});

// ---------------------------------------------------------------------------
// Artboard: stageId forwarding
// ---------------------------------------------------------------------------

describe("GrayscaleTool — stageId prop", () => {
  it("renders without crash when stageId is 'grayscale'", () => {
    const { container } = renderGrayscale({ stageId: "grayscale" });
    expect(container.firstChild).toBeTruthy();
  });

  it("renders grayscale-tool testid regardless of stageId variant", async () => {
    renderGrayscale({ stageId: "grayscale" });
    await waitFor(() => {
      expect(screen.getByTestId("grayscale-tool")).toBeDefined();
    });
  });
});
