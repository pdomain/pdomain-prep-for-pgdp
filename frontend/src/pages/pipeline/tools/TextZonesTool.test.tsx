/**
 * TextZonesTool.test.tsx — Component tests for the TextZonesTool surface.
 *
 * Covers:
 * - Tab switching (overview / pages / settings) via ZoneTabBar
 * - ZoneOverviewTab renders stat cells derived from machine context
 * - ZoneStepSettingsTab renders (splits toggle, granularity)
 * - zone-editor-redetect button click transitions machine to redetecting
 */

import { describe, it, expect } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { TextZonesTool } from "./TextZonesTool";

// ---------------------------------------------------------------------------
// Minimal runnerRef stub (unused at F5 — wired at I1)
// ---------------------------------------------------------------------------

const fakeRunnerRef = {} as never;

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderTool() {
  return render(
    <TextZonesTool stageId="text_zones" runnerRef={fakeRunnerRef} />,
  );
}

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

describe("TextZonesTool — tab switching", () => {
  it("starts on the Pages tab by default", async () => {
    renderTool();
    // Wait for machine loading → reviewing
    await waitFor(() => {
      expect(screen.getByTestId("zone-pages-tab")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("zone-overview-tab")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("zone-step-settings-tab"),
    ).not.toBeInTheDocument();
  });

  it("clicking Overview tab shows zone-overview-tab", async () => {
    renderTool();
    // Wait for tool to be ready
    await waitFor(() => {
      expect(screen.getByTestId("zone-tab-bar")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("zone-tab-overview"));

    expect(screen.getByTestId("zone-overview-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("zone-pages-tab")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("zone-step-settings-tab"),
    ).not.toBeInTheDocument();
  });

  it("clicking Settings tab shows zone-step-settings-tab", async () => {
    renderTool();
    await waitFor(() => {
      expect(screen.getByTestId("zone-tab-bar")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("zone-tab-settings"));

    expect(screen.getByTestId("zone-step-settings-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("zone-pages-tab")).not.toBeInTheDocument();
    expect(screen.queryByTestId("zone-overview-tab")).not.toBeInTheDocument();
  });

  it("clicking Pages tab after Overview returns to zone-pages-tab", async () => {
    renderTool();
    await waitFor(() => {
      expect(screen.getByTestId("zone-tab-bar")).toBeInTheDocument();
    });

    // Go to overview
    fireEvent.click(screen.getByTestId("zone-tab-overview"));
    expect(screen.getByTestId("zone-overview-tab")).toBeInTheDocument();

    // Return to pages
    fireEvent.click(screen.getByTestId("zone-tab-pages"));
    await waitFor(() => {
      expect(screen.getByTestId("zone-pages-tab")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("zone-overview-tab")).not.toBeInTheDocument();
  });

  it("all three tab buttons are present in the tab bar", async () => {
    renderTool();
    await waitFor(() => {
      expect(screen.getByTestId("zone-tab-bar")).toBeInTheDocument();
    });

    expect(screen.getByTestId("zone-tab-overview")).toBeInTheDocument();
    expect(screen.getByTestId("zone-tab-pages")).toBeInTheDocument();
    expect(screen.getByTestId("zone-tab-settings")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ZoneOverviewTab — stat cells derived from machine context totals
// ---------------------------------------------------------------------------

describe("TextZonesTool — ZoneOverviewTab stat cells", () => {
  it("renders all six stat cells when overview tab is active", async () => {
    renderTool();
    await waitFor(() => {
      expect(screen.getByTestId("zone-tab-bar")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("zone-tab-overview"));

    // The mock services return: total=3, done=3, clean=1, flagged=2, reviewed=0, splits=1
    expect(screen.getByTestId("zone-overview-stat-pages")).toBeInTheDocument();
    expect(
      screen.getByTestId("zone-overview-stat-segmented"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("zone-overview-stat-clean")).toBeInTheDocument();
    expect(
      screen.getByTestId("zone-overview-stat-flagged"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("zone-overview-stat-splits")).toBeInTheDocument();
    expect(
      screen.getByTestId("zone-overview-stat-reviewed"),
    ).toBeInTheDocument();
  });

  it("displays correct total from mock fixture (3 pages)", async () => {
    renderTool();
    await waitFor(() => {
      expect(screen.getByTestId("zone-tab-bar")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("zone-tab-overview"));

    // Machine loads totals from mock: total=3
    await waitFor(() => {
      const pagesCell = screen.getByTestId("zone-overview-stat-pages");
      expect(pagesCell).toHaveTextContent("3");
    });
  });
});

// ---------------------------------------------------------------------------
// ZoneStepSettingsTab
// ---------------------------------------------------------------------------

describe("TextZonesTool — ZoneStepSettingsTab", () => {
  it("renders splits toggle and granularity control", async () => {
    renderTool();
    await waitFor(() => {
      expect(screen.getByTestId("zone-tab-bar")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("zone-tab-settings"));

    expect(
      screen.getByTestId("zone-settings-splits-toggle"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("zone-settings-granularity-line"),
    ).toBeInTheDocument();
  });

  it("granularity buttons are all rendered", async () => {
    renderTool();
    await waitFor(() => {
      expect(screen.getByTestId("zone-tab-bar")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("zone-tab-settings"));

    expect(
      screen.getByTestId("zone-settings-granularity-block"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("zone-settings-granularity-paragraph"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("zone-settings-granularity-line"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("zone-settings-granularity-word"),
    ).toBeInTheDocument();
  });

  it("splits toggle is initially on (aria-checked=true)", async () => {
    renderTool();
    await waitFor(() => {
      expect(screen.getByTestId("zone-tab-bar")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("zone-tab-settings"));

    const toggle = screen.getByTestId("zone-settings-splits-toggle");
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  it("clicking splits toggle flips aria-checked", async () => {
    renderTool();
    await waitFor(() => {
      expect(screen.getByTestId("zone-tab-bar")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("zone-tab-settings"));

    const toggle = screen.getByTestId("zone-settings-splits-toggle");
    expect(toggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });
});

// ---------------------------------------------------------------------------
// zone-editor-redetect button — wires REDETECT to the machine
// ---------------------------------------------------------------------------

describe("TextZonesTool — zone-editor-redetect button", () => {
  // Do NOT use fake timers here — XState fromPromise resolves via microtasks;
  // fake timers suppress microtask flushing inside waitFor.

  it("zone-editor-redetect is present when zone editor is open", async () => {
    renderTool();

    // Wait for machine loading → reviewing (fetchZonePages resolves as microtask)
    await waitFor(() => {
      expect(screen.queryAllByTestId("zone-page-card").length).toBeGreaterThan(
        0,
      );
    });

    // Row 0002 is clean (no splitSuggested) — click it to open zone editor
    const cards = screen.getAllByTestId("zone-page-card");
    const cleanCard = cards.find((c) => c.getAttribute("data-idx") === "0002");
    expect(cleanCard).toBeDefined();
    fireEvent.click(cleanCard!);

    await waitFor(() => {
      expect(screen.getByTestId("zone-editor-redetect")).toBeInTheDocument();
    });
  });

  it("clicking zone-editor-redetect keeps editor open (machine round-trips editingZones → redetecting → editingZones)", async () => {
    renderTool();

    await waitFor(() => {
      expect(screen.queryAllByTestId("zone-page-card").length).toBeGreaterThan(
        0,
      );
    });

    const cards = screen.getAllByTestId("zone-page-card");
    const cleanCard = cards.find((c) => c.getAttribute("data-idx") === "0002");
    expect(cleanCard).toBeDefined();
    fireEvent.click(cleanCard!);

    await waitFor(() => {
      expect(screen.getByTestId("zone-editor-panel")).toBeInTheDocument();
    });

    const redetectBtn = screen.getByTestId("zone-editor-redetect");
    expect(redetectBtn).toBeInTheDocument();

    // Click Re-detect — triggers REDETECT event → machine goes redetecting → editingZones
    fireEvent.click(redetectBtn);

    // Editor panel remains visible after redetect completes
    await waitFor(() => {
      expect(screen.getByTestId("zone-editor-panel")).toBeInTheDocument();
    });
  });
});
