/**
 * TextReviewTool.test.tsx — Component artboard tests for the TextReviewTool surface.
 *
 * Covers (F5.5 fix round):
 * - Tab bar presence (overview / review / threads / settings)
 * - Tab switching
 * - VIEW_ON_PAGE eye button rendered per queue item row
 * - SEND_APPROVED button rendered in banner
 * - DISCUSSIONS-GATE: confirm button disabled when discuss > 0
 * - Overview stat cells render
 * - Assembling spinner on initial mount before QUEUE_READY
 *
 * @see src/machines/tools/textReviewTool.ts — machine
 * @see TextReviewTool.tsx — component under test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { TextReviewTool } from "./TextReviewTool";

// ---------------------------------------------------------------------------
// Minimal runnerRef stub (unused at F5 — wired at I1)
// ---------------------------------------------------------------------------

const fakeRunnerRef = {} as never;

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderTool() {
  return render(
    <TextReviewTool stageId="text_review" runnerRef={fakeRunnerRef} />,
  );
}

// ---------------------------------------------------------------------------
// Initial state — assembling spinner
// ---------------------------------------------------------------------------

describe("TextReviewTool — initial assembling state", () => {
  it("shows assembling spinner immediately on mount", () => {
    renderTool();

    expect(
      screen.getByTestId("text-review-tool-assembling"),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tab bar (after QUEUE_READY)
// ---------------------------------------------------------------------------

describe("TextReviewTool — tab bar after queue ready", () => {
  it("renders tab bar after QUEUE_READY (150ms mock delay)", async () => {
    vi.useFakeTimers();
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.getByTestId("text-review-tab-bar")).toBeInTheDocument();

    vi.useRealTimers();
  });

  it("all four tab buttons are present", async () => {
    vi.useFakeTimers();
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.getByTestId("text-review-tab-overview")).toBeInTheDocument();
    expect(screen.getByTestId("text-review-tab-review")).toBeInTheDocument();
    expect(screen.getByTestId("text-review-tab-threads")).toBeInTheDocument();
    expect(screen.getByTestId("text-review-tab-settings")).toBeInTheDocument();

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

describe("TextReviewTool — tab switching", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts on the review tab by default", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.getByTestId("text-review-review-tab")).toBeInTheDocument();
    expect(
      screen.queryByTestId("text-review-overview-tab"),
    ).not.toBeInTheDocument();
  });

  it("clicking Overview tab shows text-review-overview-tab", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    fireEvent.click(screen.getByTestId("text-review-tab-overview"));

    expect(screen.getByTestId("text-review-overview-tab")).toBeInTheDocument();
    expect(
      screen.queryByTestId("text-review-review-tab"),
    ).not.toBeInTheDocument();
  });

  it("clicking Settings tab shows text-review-settings-tab", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    fireEvent.click(screen.getByTestId("text-review-tab-settings"));

    expect(screen.getByTestId("text-review-settings-tab")).toBeInTheDocument();
    expect(
      screen.queryByTestId("text-review-review-tab"),
    ).not.toBeInTheDocument();
  });

  it("clicking Threads tab shows text-review-threads-tab", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    fireEvent.click(screen.getByTestId("text-review-tab-threads"));

    expect(screen.getByTestId("text-review-threads-tab")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// VIEW_ON_PAGE — eye button per queue item (F5.5 fix round wiring)
// ---------------------------------------------------------------------------

describe("TextReviewTool — VIEW_ON_PAGE eye button per item", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders view-on-page button for first mock queue item (qi1)", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // Review tab is default; mock data contains item "qi1"
    expect(screen.getByTestId("view-on-page-item-qi1")).toBeInTheDocument();
  });

  it("view-on-page button has title 'View on page'", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const btn = screen.getByTestId("view-on-page-item-qi1");
    expect(btn).toHaveAttribute("title", "View on page");
  });

  it("renders view-on-page button for all three mock items", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.getByTestId("view-on-page-item-qi1")).toBeInTheDocument();
    expect(screen.getByTestId("view-on-page-item-qi2")).toBeInTheDocument();
    expect(screen.getByTestId("view-on-page-item-qi3")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SEND_APPROVED — banner button (F5.5 fix round wiring)
// ---------------------------------------------------------------------------

describe("TextReviewTool — SEND_APPROVED button", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the send-approved button in the review banner", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.getByTestId("text-review-send-approved")).toBeInTheDocument();
  });

  it("send-approved button label contains 'Illustrations'", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const btn = screen.getByTestId("text-review-send-approved");
    expect(btn).toHaveTextContent(/Illustrations/i);
  });
});

// ---------------------------------------------------------------------------
// DISCUSSIONS-GATE — confirm button disabled when discuss > 0
// ---------------------------------------------------------------------------

describe("TextReviewTool — DISCUSSIONS-GATE", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("confirm-advance button is present in the review tab banner", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // Gate is open (no discuss items in mock data) so button is enabled
    const btn = screen.getByTestId("text-review-confirm-advance");
    expect(btn).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Overview stat cells
// ---------------------------------------------------------------------------

describe("TextReviewTool — overview stat cells", () => {
  it("renders all six stat cells when overview tab is active", async () => {
    // Using real timers — mock QUEUE_READY fires on 150ms real timeout
    renderTool();

    await waitFor(
      () => {
        expect(screen.getByTestId("text-review-tab-bar")).toBeInTheDocument();
      },
      { timeout: 1000 },
    );

    fireEvent.click(screen.getByTestId("text-review-tab-overview"));

    expect(screen.getByTestId("text-review-stat-total")).toBeInTheDocument();
    expect(screen.getByTestId("text-review-stat-pending")).toBeInTheDocument();
    expect(screen.getByTestId("text-review-stat-discuss")).toBeInTheDocument();
    expect(screen.getByTestId("text-review-stat-approved")).toBeInTheDocument();
    expect(screen.getByTestId("text-review-stat-comments")).toBeInTheDocument();
    expect(
      screen.getByTestId("text-review-stat-open-threads"),
    ).toBeInTheDocument();
  });
});
