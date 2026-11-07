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
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { server } from "@/test/server";
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
  // No _testScanDone — a demo mount hydrates to the empty settled scan.
  return render(
    <MemoryRouter>
      <WordcheckTool stageId="wordcheck" runnerRef={fakeRunnerRef} />
    </MemoryRouter>,
  );
}

function renderLive(projectId: string) {
  return render(
    <MemoryRouter initialEntries={[`/projects/${projectId}/pipeline`]}>
      <Routes>
        <Route
          path="/projects/:projectId/pipeline"
          element={
            <WordcheckTool stageId="wordcheck" runnerRef={fakeRunnerRef} />
          }
        />
      </Routes>
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

describe("WordcheckTool — empty scan is the zero-state", () => {
  it("leaves scanning after hydrate when no scan is injected", async () => {
    renderToolScanning();
    await waitFor(() => {
      expect(screen.getByTestId("wordcheck-tool-settled")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("wordcheck-scanning")).not.toBeInTheDocument();
  });

  it("does not keep the review tab bar on an empty settle", async () => {
    renderToolScanning();
    await waitFor(() => {
      expect(screen.getByTestId("wordcheck-tool-settled")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("wordcheck-tab-bar")).not.toBeInTheDocument();
  });

  it("does NOT render suspect rows when no scan is injected", async () => {
    renderToolScanning();
    await waitFor(() => {
      expect(screen.getByTestId("wordcheck-tool-settled")).toBeInTheDocument();
    });
    // sw1 comes from _testScanDone; the honest empty scan has no rows.
    expect(screen.queryByTestId("suspect-row-sw1")).not.toBeInTheDocument();
    expect(screen.queryByText("tbe")).not.toBeInTheDocument();
  });

  it("settles when every page flags route is 404", async () => {
    server.use(
      http.get("/api/data/projects/book/pages", () =>
        HttpResponse.json({
          pages: [{ idx0: 0, prefix: "img0000" }],
          next_cursor: null,
          total: 1,
        }),
      ),
      http.get(
        "/api/data/projects/book/pages/0/stages/wordcheck/flags",
        () => new HttpResponse(null, { status: 404 }),
      ),
    );
    renderLive("book");
    await waitFor(() => {
      expect(screen.getByTestId("wordcheck-tool-settled")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("wordcheck-scanning")).not.toBeInTheDocument();
    expect(screen.queryByText("tbe")).not.toBeInTheDocument();
  });

  it("shows a real flag and leaves scanning", async () => {
    server.use(
      http.get("/api/data/projects/book/pages", () =>
        HttpResponse.json({
          pages: [{ idx0: 2, prefix: "img0002" }],
          next_cursor: null,
          total: 1,
        }),
      ),
      http.get("/api/data/projects/book/pages/2/stages/wordcheck/flags", () =>
        HttpResponse.json({
          page_id: "0002",
          stage_id: "wordcheck",
          flags: [{ word_id: "w-arid", word_text: "arid", status: "open" }],
          flagged_count: 1,
          total_words: 10,
        }),
      ),
    );
    renderLive("book");
    await waitFor(() => {
      expect(screen.getByTestId("suspect-row-w-arid")).toBeInTheDocument();
    });
    expect(screen.getAllByText("arid").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("wordcheck-scanning")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("wordcheck-tool-settled"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("tbe")).not.toBeInTheDocument();
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
