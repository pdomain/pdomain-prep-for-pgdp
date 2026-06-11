/**
 * CanvasMapTool component tests.
 *
 * Covers:
 *   - canvas-map-tool wrapper renders
 *   - canvas-map-extras panel renders (aspect scatter + re-derive button)
 *   - Re-derive canvas button sends REDERIVE to the imageStageReview machine
 *
 * @see src/pages/pipeline/tools/CanvasMapTool.tsx
 * @see src/machines/imageStageReview.ts — REDERIVE event + running state
 */

import { describe, it, expect } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CanvasMapTool } from "./CanvasMapTool";
import type { ToolSlotProps } from "../toolSlot";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_RUNNER_REF = {} as ToolSlotProps["runnerRef"];

function renderCanvasMap() {
  return render(
    <MemoryRouter>
      <CanvasMapTool stageId="canvas_map" runnerRef={MOCK_RUNNER_REF} />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Artboard: CanvasMapTool wrapper
// ---------------------------------------------------------------------------

describe("CanvasMapTool — wrapper", () => {
  it("renders the canvas-map-tool wrapper", () => {
    renderCanvasMap();
    expect(screen.getByTestId("canvas-map-tool")).toBeDefined();
  });

  it("renders the shared ImageStageReviewTool surface inside the wrapper", async () => {
    renderCanvasMap();
    await waitFor(() => {
      expect(
        screen.getByTestId("image-stage-review-tool-canvas_map"),
      ).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Artboard: CanvasMapExtras panel
// ---------------------------------------------------------------------------

describe("CanvasMapTool — extras panel", () => {
  it("renders the canvas-map-extras panel", () => {
    renderCanvasMap();
    expect(screen.getByTestId("canvas-map-extras")).toBeDefined();
  });

  it("renders the aspect scatter placeholder", () => {
    renderCanvasMap();
    expect(screen.getByTestId("canvas-map-aspect-scatter")).toBeDefined();
  });

  it("renders the Re-derive canvas button", () => {
    renderCanvasMap();
    expect(screen.getByTestId("canvas-map-rederive-btn")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// REDERIVE wiring
// ---------------------------------------------------------------------------

describe("CanvasMapTool — REDERIVE wiring", () => {
  it("clicking Re-derive canvas sends REDERIVE and transitions machine to running", async () => {
    renderCanvasMap();

    // Wait for the review surface to load (mock fetchStagePages resolves immediately)
    await waitFor(() => {
      // The mock returns all-clean pages so the machine reaches settled
      // (or review banner). Either way the button is present.
      expect(screen.getByTestId("canvas-map-rederive-btn")).toBeDefined();
    });

    // Click the Re-derive button — should send REDERIVE to the machine
    fireEvent.click(screen.getByTestId("canvas-map-rederive-btn"));

    // Machine transitions to running on REDERIVE (imageStageReview global on.REDERIVE)
    await waitFor(() => {
      expect(screen.getByTestId("review-banner-running")).toBeDefined();
    });
  });
});
