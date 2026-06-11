/**
 * WordcheckTool.test.tsx — Component artboard tests for the WordcheckTool surface.
 *
 * Covers (F5.5 fix round + W5.4 mock-leak removal):
 * - Scanning state: spinner testid visible on mount (no mock data injected)
 * - Tab bar presence and switching (overview / suspects / settings)
 * - VIEW_ON_PAGE eye button rendered per suspect row
 * - SEND_CLEARED button rendered in banner
 * - Overview stat cells render
 *
 * W5.4: replaced vi.useFakeTimers()/vi.runAllTimersAsync() pattern with
 * `_testScanDone` prop injection. No timers needed. No MOCK_SUSPECTS in prod.
 *
 * @see src/machines/tools/wordcheckTool.ts — machine
 * @see WordcheckTool.tsx — component under test
 */

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { WordcheckTool } from "./WordcheckTool";
import type { Suspect, SuspectTotals } from "@/machines/tools/wordcheckTool";

// ---------------------------------------------------------------------------
// Minimal runnerRef stub (unused at F5 — wired at I1)
// ---------------------------------------------------------------------------

const fakeRunnerRef = {} as never;

// ---------------------------------------------------------------------------
// Mock scan-done data (only used in tests via _testScanDone — W5.4)
// ---------------------------------------------------------------------------

const MOCK_SUSPECTS: Suspect[] = [
  {
    id: "sw1",
    word: "tbe",
    fix: "the",
    ctxL: "…saw ",
    ctxR: " light…",
    type: "dictFail",
    page: "p0002",
    line: 14,
    rule: "dict",
    score: 0.62,
  },
  {
    id: "sw2",
    word: "ligbt",
    fix: "light",
    ctxL: "…tbe ",
    ctxR: " and…",
    type: "dictFail",
    page: "p0002",
    line: 14,
    rule: "dict",
    score: 0.68,
  },
  {
    id: "sw3",
    word: "ond",
    fix: "and",
    ctxL: "…light ",
    ctxR: " the…",
    type: "dictFail",
    page: "p0003",
    line: 7,
    rule: "dict",
    score: 0.71,
  },
];

const MOCK_TOTALS: SuspectTotals = {
  total: 4,
  done: 4,
  suspects: MOCK_SUSPECTS.length,
  stealth: 0,
  flagged: 0,
  reviewed: 0,
  clean: 1,
};

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function renderToolScanning() {
  // No _testScanDone — machine stays in scanning state
  return render(
    <MemoryRouter>
      <WordcheckTool stageId="wordcheck" runnerRef={fakeRunnerRef} />
    </MemoryRouter>,
  );
}

function renderToolWithScanDone() {
  // _testScanDone fires SCAN_DONE synchronously on mount — advances to reviewing
  return render(
    <MemoryRouter>
      <WordcheckTool
        stageId="wordcheck"
        runnerRef={fakeRunnerRef}
        _testScanDone={{ suspects: MOCK_SUSPECTS, totals: MOCK_TOTALS }}
      />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Scanning state — W5.4 verifies no mock data leaks into production on mount
// ---------------------------------------------------------------------------

describe("WordcheckTool — scanning state (no mock data, W5.4)", () => {
  it("renders scanning indicator inside suspects tab on initial mount", () => {
    renderToolScanning();
    // Tab bar always renders; scanning indicator is inside the suspects tab
    expect(screen.getByTestId("wordcheck-scanning")).toBeInTheDocument();
  });

  it("renders the tab bar even during scanning (always visible)", () => {
    renderToolScanning();
    expect(screen.getByTestId("wordcheck-tab-bar")).toBeInTheDocument();
  });

  it("does NOT render suspect rows before SCAN_DONE (no leak of mock data)", () => {
    renderToolScanning();
    // sw1, sw2, sw3 come from _testScanDone; absent in scanning state
    expect(screen.queryByTestId("suspect-row-sw1")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tab bar (after SCAN_DONE)
// ---------------------------------------------------------------------------

describe("WordcheckTool — tab bar after SCAN_DONE", () => {
  it("renders the tab bar after _testScanDone fires", () => {
    renderToolWithScanDone();
    expect(screen.getByTestId("wordcheck-tab-bar")).toBeInTheDocument();
  });

  it("all three tab buttons are present (overview / suspects / settings)", () => {
    renderToolWithScanDone();
    expect(screen.getByTestId("wordcheck-tab-overview")).toBeInTheDocument();
    expect(screen.getByTestId("wordcheck-tab-suspects")).toBeInTheDocument();
    expect(screen.getByTestId("wordcheck-tab-settings")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

describe("WordcheckTool — tab switching", () => {
  it("starts on the suspects tab (showing wordcheck-suspects-tab)", () => {
    renderToolWithScanDone();
    expect(screen.getByTestId("wordcheck-suspects-tab")).toBeInTheDocument();
    expect(
      screen.queryByTestId("wordcheck-overview-tab"),
    ).not.toBeInTheDocument();
  });

  it("clicking Overview tab shows wordcheck-overview-tab", () => {
    renderToolWithScanDone();

    fireEvent.click(screen.getByTestId("wordcheck-tab-overview"));

    expect(screen.getByTestId("wordcheck-overview-tab")).toBeInTheDocument();
    expect(
      screen.queryByTestId("wordcheck-suspects-tab"),
    ).not.toBeInTheDocument();
  });

  it("clicking Settings tab shows wordcheck-settings-tab", () => {
    renderToolWithScanDone();

    fireEvent.click(screen.getByTestId("wordcheck-tab-settings"));

    expect(screen.getByTestId("wordcheck-settings-tab")).toBeInTheDocument();
    expect(
      screen.queryByTestId("wordcheck-suspects-tab"),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Overview tab stat cells
// ---------------------------------------------------------------------------

describe("WordcheckTool — overview stat cells", () => {
  it("renders overview stat cells when overview tab is active", () => {
    renderToolWithScanDone();

    fireEvent.click(screen.getByTestId("wordcheck-tab-overview"));

    expect(screen.getByTestId("wordcheck-stat-suspects")).toBeInTheDocument();
    expect(
      screen.getByTestId("wordcheck-stat-total-pages"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("wordcheck-stat-scanned")).toBeInTheDocument();
    expect(screen.getByTestId("wordcheck-stat-stealth")).toBeInTheDocument();
    expect(screen.getByTestId("wordcheck-stat-reviewed")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// VIEW_ON_PAGE — eye button per suspect row (F5.5 fix round wiring)
// ---------------------------------------------------------------------------

describe("WordcheckTool — VIEW_ON_PAGE eye button per suspect", () => {
  it("renders view-on-page eye button for the first mock suspect", () => {
    renderToolWithScanDone();
    // Suspects tab is the default; mock data includes suspect "sw1"
    expect(screen.getByTestId("view-on-page-suspect-sw1")).toBeInTheDocument();
  });

  it("view-on-page button has title 'View on page'", () => {
    renderToolWithScanDone();

    const btn = screen.getByTestId("view-on-page-suspect-sw1");
    expect(btn).toHaveAttribute("title", "View on page");
  });
});

// ---------------------------------------------------------------------------
// SEND_CLEARED — banner button (F5.5 fix round wiring)
// ---------------------------------------------------------------------------

describe("WordcheckTool — SEND_CLEARED button", () => {
  it("renders the send-cleared button in the suspects banner", () => {
    renderToolWithScanDone();
    expect(screen.getByTestId("wordcheck-send-cleared")).toBeInTheDocument();
  });

  it("send-cleared button label contains 'cleared'", () => {
    renderToolWithScanDone();
    const btn = screen.getByTestId("wordcheck-send-cleared");
    expect(btn).toHaveTextContent(/cleared/i);
  });
});
