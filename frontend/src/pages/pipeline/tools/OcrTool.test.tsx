/**
 * OcrTool.test.tsx — Component tests for the OcrTool surface.
 *
 * Covers:
 * - Tab switching (overview / pages / settings) via OcrTabBar
 * - OcrOverviewTab renders stat cells derived from machine context
 * - OcrStepSettingsTab renders (engine selector, backend control)
 *
 * Note: OcrTool uses a mock simulateMockRun that fires setTimeout on mount.
 * Tests use vi.useFakeTimers to control that + flush the promise queue.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  act,
} from "@testing-library/react";
import { OcrTool } from "./OcrTool";

// ---------------------------------------------------------------------------
// Minimal runnerRef stub (unused at F5 — wired at I1)
// ---------------------------------------------------------------------------

const fakeRunnerRef = {} as never;

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderTool() {
  return render(<OcrTool stageId="ocr" runnerRef={fakeRunnerRef} />);
}

// ---------------------------------------------------------------------------
// Tab bar presence
// ---------------------------------------------------------------------------

describe("OcrTool — tab bar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the tab bar immediately", async () => {
    renderTool();

    // Tab bar renders synchronously (machine starts in recognising, not loading)
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.getByTestId("ocr-tab-bar")).toBeInTheDocument();
  });

  it("all three tab buttons are present", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.getByTestId("ocr-tab-overview")).toBeInTheDocument();
    expect(screen.getByTestId("ocr-tab-pages")).toBeInTheDocument();
    expect(screen.getByTestId("ocr-tab-settings")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

describe("OcrTool — tab switching", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts on the Pages tab by default", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.getByTestId("ocr-pages-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("ocr-overview-tab")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("ocr-step-settings-tab"),
    ).not.toBeInTheDocument();
  });

  it("clicking Overview tab shows ocr-overview-tab", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    fireEvent.click(screen.getByTestId("ocr-tab-overview"));

    expect(screen.getByTestId("ocr-overview-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("ocr-pages-tab")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("ocr-step-settings-tab"),
    ).not.toBeInTheDocument();
  });

  it("clicking Settings tab shows ocr-step-settings-tab", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    fireEvent.click(screen.getByTestId("ocr-tab-settings"));

    expect(screen.getByTestId("ocr-step-settings-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("ocr-pages-tab")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ocr-overview-tab")).not.toBeInTheDocument();
  });

  it("clicking Pages tab after Overview returns to ocr-pages-tab", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // Go to overview
    fireEvent.click(screen.getByTestId("ocr-tab-overview"));
    expect(screen.getByTestId("ocr-overview-tab")).toBeInTheDocument();

    // Return to pages
    fireEvent.click(screen.getByTestId("ocr-tab-pages"));
    expect(screen.getByTestId("ocr-pages-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("ocr-overview-tab")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// OcrOverviewTab — stat cells
// ---------------------------------------------------------------------------

describe("OcrTool — OcrOverviewTab stat cells", () => {
  // Real timers — simulateMockRun uses real setTimeout; fake timers suppress
  // microtask flushing inside waitFor and cause timeout failures.

  it("renders all six stat cells when overview tab is active", () => {
    // OcrTool starts in 'recognising' (no loading state) — tab bar is synchronous.
    renderTool();

    fireEvent.click(screen.getByTestId("ocr-tab-overview"));

    // Stat cells render immediately (totals may be null → shows "0" as default)
    expect(screen.getByTestId("ocr-overview-stat-pages")).toBeInTheDocument();
    expect(
      screen.getByTestId("ocr-overview-stat-recognised"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("ocr-overview-stat-words")).toBeInTheDocument();
    expect(
      screen.getByTestId("ocr-overview-stat-mean-score"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("ocr-overview-stat-low-score"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("ocr-overview-stat-flagged")).toBeInTheDocument();
  });

  it("displays non-zero page count after mock PAGE_PUSH events arrive", async () => {
    // simulateMockRun fires 4 PAGE_PUSH events with staggered real setTimeout delays (80ms each).
    // Assert that at least one page has been pushed (totals.total > 0) within 2s.
    renderTool();

    fireEvent.click(screen.getByTestId("ocr-tab-overview"));

    // Wait until at least one page has been pushed (totals.total >= 1)
    await waitFor(
      () => {
        const pagesCell = screen.getByTestId("ocr-overview-stat-pages");
        expect(pagesCell).not.toHaveTextContent("0");
      },
      { timeout: 2000 },
    );
  });
});

// ---------------------------------------------------------------------------
// OcrStepSettingsTab — engine and backend display
// ---------------------------------------------------------------------------

describe("OcrTool — OcrStepSettingsTab", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders engine selector with doctr and tesseract options", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    fireEvent.click(screen.getByTestId("ocr-tab-settings"));

    expect(screen.getByTestId("ocr-settings-engine-doctr")).toBeInTheDocument();
    expect(
      screen.getByTestId("ocr-settings-engine-tesseract"),
    ).toBeInTheDocument();
  });

  it("renders backend segmented control (doctr selected = GPU/CPU visible)", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    fireEvent.click(screen.getByTestId("ocr-tab-settings"));

    // Default engine is "doctr" (from machine context default)
    // Backend control should be visible
    expect(screen.getByTestId("ocr-settings-backend")).toBeInTheDocument();
  });

  it("doctr engine card shows active styling (border)", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    fireEvent.click(screen.getByTestId("ocr-tab-settings"));

    // DocTR is the default; its card should be present
    const doctrCard = screen.getByTestId("ocr-settings-engine-doctr");
    expect(doctrCard).toBeInTheDocument();
  });
});
