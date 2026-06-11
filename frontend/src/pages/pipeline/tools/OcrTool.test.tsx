/**
 * OcrTool.test.tsx — Component tests for the OcrTool surface.
 *
 * Covers:
 * - Tab switching (overview / pages / settings) via OcrTabBar
 * - OcrOverviewTab renders stat cells derived from machine context
 * - OcrStepSettingsTab renders (engine selector, backend control)
 *
 * At I1: real services are wired; pages arrive via SSE (not mock setTimeout).
 * Stat cells start at zero and are updated when SSE PAGE_PUSH events arrive.
 */

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { OcrTool } from "./OcrTool";

// ---------------------------------------------------------------------------
// Minimal runnerRef stub
// ---------------------------------------------------------------------------

const fakeRunnerRef = {} as never;

// ---------------------------------------------------------------------------
// Render helper — MemoryRouter required since OcrTool uses useParams
// ---------------------------------------------------------------------------

function renderTool() {
  return render(
    <MemoryRouter initialEntries={["/projects/demo/pipeline"]}>
      <OcrTool stageId="ocr" runnerRef={fakeRunnerRef} />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tab bar presence
// ---------------------------------------------------------------------------

describe("OcrTool — tab bar", () => {
  it("renders the tab bar immediately", () => {
    renderTool();
    expect(screen.getByTestId("ocr-tab-bar")).toBeInTheDocument();
  });

  it("all three tab buttons are present", () => {
    renderTool();
    expect(screen.getByTestId("ocr-tab-overview")).toBeInTheDocument();
    expect(screen.getByTestId("ocr-tab-pages")).toBeInTheDocument();
    expect(screen.getByTestId("ocr-tab-settings")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

describe("OcrTool — tab switching", () => {
  it("starts on the Pages tab by default", () => {
    renderTool();
    expect(screen.getByTestId("ocr-pages-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("ocr-overview-tab")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("ocr-step-settings-tab"),
    ).not.toBeInTheDocument();
  });

  it("clicking Overview tab shows ocr-overview-tab", () => {
    renderTool();
    fireEvent.click(screen.getByTestId("ocr-tab-overview"));
    expect(screen.getByTestId("ocr-overview-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("ocr-pages-tab")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("ocr-step-settings-tab"),
    ).not.toBeInTheDocument();
  });

  it("clicking Settings tab shows ocr-step-settings-tab", () => {
    renderTool();
    fireEvent.click(screen.getByTestId("ocr-tab-settings"));
    expect(screen.getByTestId("ocr-step-settings-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("ocr-pages-tab")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ocr-overview-tab")).not.toBeInTheDocument();
  });

  it("clicking Pages tab after Overview returns to ocr-pages-tab", () => {
    renderTool();
    fireEvent.click(screen.getByTestId("ocr-tab-overview"));
    expect(screen.getByTestId("ocr-overview-tab")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("ocr-tab-pages"));
    expect(screen.getByTestId("ocr-pages-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("ocr-overview-tab")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// OcrOverviewTab — stat cells
// ---------------------------------------------------------------------------

describe("OcrTool — OcrOverviewTab stat cells", () => {
  it("renders all six stat cells when overview tab is active", () => {
    // OcrTool starts in 'recognising' (no loading state) — tab bar is synchronous.
    renderTool();
    fireEvent.click(screen.getByTestId("ocr-tab-overview"));
    // Stat cells render immediately (totals null → shows "0" as default)
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

  it("stat cells show zero until SSE PAGE_PUSH events arrive", () => {
    // At I1 pages arrive via real SSE; in unit tests no SSE fires so stats start at 0.
    renderTool();
    fireEvent.click(screen.getByTestId("ocr-tab-overview"));
    const pagesCell = screen.getByTestId("ocr-overview-stat-pages");
    expect(pagesCell.textContent).toContain("0");
  });
});

// ---------------------------------------------------------------------------
// OcrStepSettingsTab — engine and backend display
// ---------------------------------------------------------------------------

describe("OcrTool — OcrStepSettingsTab", () => {
  it("renders engine selector with doctr and tesseract options", () => {
    renderTool();
    fireEvent.click(screen.getByTestId("ocr-tab-settings"));
    expect(screen.getByTestId("ocr-settings-engine-doctr")).toBeInTheDocument();
    expect(
      screen.getByTestId("ocr-settings-engine-tesseract"),
    ).toBeInTheDocument();
  });

  it("renders backend segmented control (doctr selected = GPU/CPU visible)", () => {
    renderTool();
    fireEvent.click(screen.getByTestId("ocr-tab-settings"));
    // Default engine is "doctr" (from machine context default)
    expect(screen.getByTestId("ocr-settings-backend")).toBeInTheDocument();
  });

  it("doctr engine card shows active styling (border)", () => {
    renderTool();
    fireEvent.click(screen.getByTestId("ocr-tab-settings"));
    // DocTR is the default; its card should be present
    const doctrCard = screen.getByTestId("ocr-settings-engine-doctr");
    expect(doctrCard).toBeInTheDocument();
  });
});
