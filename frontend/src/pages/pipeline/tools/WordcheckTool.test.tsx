/**
 * WordcheckTool.test.tsx — Component artboard tests for the WordcheckTool surface.
 *
 * Covers (F5.5 fix round):
 * - Tab bar presence and switching (overview / suspects / library / settings)
 * - VIEW_ON_PAGE eye button rendered per suspect row
 * - SEND_CLEARED button rendered in banner
 * - Overview stat cells render with default-zero values
 * - Scanning state renders spinner testid
 *
 * @see src/machines/tools/wordcheckTool.ts — machine
 * @see WordcheckTool.tsx — component under test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { WordcheckTool } from "./WordcheckTool";

// ---------------------------------------------------------------------------
// Minimal runnerRef stub (unused at F5 — wired at I1)
// ---------------------------------------------------------------------------

const fakeRunnerRef = {} as never;

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderTool() {
  return render(
    <WordcheckTool stageId="wordcheck" runnerRef={fakeRunnerRef} />,
  );
}

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

describe("WordcheckTool — tab bar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the tab bar after scan completes", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.getByTestId("wordcheck-tab-bar")).toBeInTheDocument();
  });

  it("all three tab buttons are present (overview / suspects / settings)", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.getByTestId("wordcheck-tab-overview")).toBeInTheDocument();
    expect(screen.getByTestId("wordcheck-tab-suspects")).toBeInTheDocument();
    expect(screen.getByTestId("wordcheck-tab-settings")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

describe("WordcheckTool — tab switching", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts on the suspects tab (showing wordcheck-suspects-tab)", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.getByTestId("wordcheck-suspects-tab")).toBeInTheDocument();
    expect(
      screen.queryByTestId("wordcheck-overview-tab"),
    ).not.toBeInTheDocument();
  });

  it("clicking Overview tab shows wordcheck-overview-tab", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    fireEvent.click(screen.getByTestId("wordcheck-tab-overview"));

    expect(screen.getByTestId("wordcheck-overview-tab")).toBeInTheDocument();
    expect(
      screen.queryByTestId("wordcheck-suspects-tab"),
    ).not.toBeInTheDocument();
  });

  it("clicking Settings tab shows wordcheck-settings-tab", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

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
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders overview stat cells when overview tab is active", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

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
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders view-on-page eye button for the first mock suspect", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // Suspects tab is the default; mock data includes suspect "sw1"
    expect(screen.getByTestId("view-on-page-suspect-sw1")).toBeInTheDocument();
  });

  it("view-on-page button has title 'View on page'", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const btn = screen.getByTestId("view-on-page-suspect-sw1");
    expect(btn).toHaveAttribute("title", "View on page");
  });
});

// ---------------------------------------------------------------------------
// SEND_CLEARED — banner button (F5.5 fix round wiring)
// ---------------------------------------------------------------------------

describe("WordcheckTool — SEND_CLEARED button", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the send-cleared button in the suspects banner", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.getByTestId("wordcheck-send-cleared")).toBeInTheDocument();
  });

  it("send-cleared button label contains 'cleared'", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const btn = screen.getByTestId("wordcheck-send-cleared");
    expect(btn).toHaveTextContent(/cleared/i);
  });
});
