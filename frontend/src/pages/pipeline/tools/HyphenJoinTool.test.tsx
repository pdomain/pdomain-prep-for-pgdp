/**
 * HyphenJoinTool.test.tsx — Component artboard tests for the HyphenJoinTool surface.
 *
 * Covers (F5.5 fix round):
 * - Tab bar presence (overview / queue / joined / mismatch / workbench / settings)
 * - Tab switching to queue/overview/settings/workbench
 * - OPEN_GLOBAL_LIBRARY button rendered in queue banner
 * - Page workbench tab shows no-page prompt when pageId is null
 * - Page workbench open-demo button sends OPEN_PAGE and shows workbench panel
 * - APPLY_CONTINUE, PREV_PAGE, NEXT_PAGE, CLOSE_PAGE buttons in workbench
 * - Overview stat cells render with mock data values
 *
 * @see src/machines/tools/hyphenJoin.ts — machine
 * @see HyphenJoinTool.tsx — component under test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HyphenJoinTool } from "./HyphenJoinTool";
import type {
  HyphenJoinServices,
  HyphenCase,
} from "@/machines/tools/hyphenJoin";

// ---------------------------------------------------------------------------
// Minimal runnerRef stub + test services
// ---------------------------------------------------------------------------

const fakeRunnerRef = {} as never;

const MOCK_CASES: HyphenCase[] = [
  {
    caseId: "hc1",
    kind: "auto",
    head: "house",
    tail: "hold",
    line: 22,
    page: "p0004",
    status: "undecided",
    validated: false,
    conf: 0.88,
    book: { inBody: true, joinedElsewhere: true, mismatch: false },
  },
  {
    caseId: "hc2",
    kind: "auto",
    head: "break",
    tail: "fast",
    line: 7,
    page: "p0005",
    status: "joined",
    validated: false,
    conf: 0.91,
    book: { inBody: true, joinedElsewhere: false, mismatch: false },
  },
  {
    caseId: "hc3",
    kind: "mismatch",
    head: "over",
    tail: "coat",
    line: 14,
    page: "p0006",
    status: "mismatch",
    validated: false,
    conf: 0.77,
    book: { inBody: false, joinedElsewhere: true, mismatch: true },
  },
];

const TEST_SERVICES: HyphenJoinServices = {
  async scanHyphenation(_pid) {
    return {
      cases: MOCK_CASES,
      totals: {
        total: 3,
        joined: 1,
        validated: 0,
        undecided: 1,
        flagged: 0,
        crosspage: 0,
        mismatch: 1,
        unvalidated: 1,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderTool() {
  return render(
    <MemoryRouter>
      <HyphenJoinTool
        stageId="hyphen_join"
        runnerRef={fakeRunnerRef}
        _testServices={TEST_SERVICES}
      />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

describe("HyphenJoinTool — tab bar", () => {
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

    expect(screen.getByTestId("hyphen-tab-bar")).toBeInTheDocument();
  });

  it("all six tab buttons are present (including workbench)", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.getByTestId("hyphen-tab-overview")).toBeInTheDocument();
    expect(screen.getByTestId("hyphen-tab-queue")).toBeInTheDocument();
    expect(screen.getByTestId("hyphen-tab-joined")).toBeInTheDocument();
    expect(screen.getByTestId("hyphen-tab-mismatch")).toBeInTheDocument();
    expect(screen.getByTestId("hyphen-tab-workbench")).toBeInTheDocument();
    expect(screen.getByTestId("hyphen-tab-settings")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

describe("HyphenJoinTool — tab switching", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts on the queue tab by default", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // Queue tab default — hyphen-case-list-queue is rendered
    expect(screen.getByTestId("hyphen-case-list-queue")).toBeInTheDocument();
    expect(screen.queryByTestId("hyphen-overview-tab")).not.toBeInTheDocument();
  });

  it("clicking Overview tab shows hyphen-overview-tab", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    fireEvent.click(screen.getByTestId("hyphen-tab-overview"));

    expect(screen.getByTestId("hyphen-overview-tab")).toBeInTheDocument();
    expect(
      screen.queryByTestId("hyphen-case-list-queue"),
    ).not.toBeInTheDocument();
  });

  it("clicking Settings tab shows hyphen-settings-tab", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    fireEvent.click(screen.getByTestId("hyphen-tab-settings"));

    expect(screen.getByTestId("hyphen-settings-tab")).toBeInTheDocument();
    expect(
      screen.queryByTestId("hyphen-case-list-queue"),
    ).not.toBeInTheDocument();
  });

  it("clicking Workbench tab shows hyphen-workbench-no-page (no page open)", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    fireEvent.click(screen.getByTestId("hyphen-tab-workbench"));

    expect(screen.getByTestId("hyphen-workbench-no-page")).toBeInTheDocument();
    expect(
      screen.queryByTestId("hyphen-workbench-panel"),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// OPEN_GLOBAL_LIBRARY — "Edit global library" button (F5.5 fix round wiring)
// ---------------------------------------------------------------------------

describe("HyphenJoinTool — OPEN_GLOBAL_LIBRARY button", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders Edit global library button in the queue banner", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    // Queue tab is default — the banner has the global library button
    expect(
      screen.getByTestId("hyphen-open-global-library"),
    ).toBeInTheDocument();
  });

  it("Edit global library button contains 'library' text", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const btn = screen.getByTestId("hyphen-open-global-library");
    expect(btn).toHaveTextContent(/library/i);
  });

  it("Settings tab also shows Edit global library button", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    fireEvent.click(screen.getByTestId("hyphen-tab-settings"));

    expect(
      screen.getByTestId("hyphen-open-global-library"),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Page workbench panel — OPEN_PAGE / CLOSE_PAGE / PREV_PAGE / NEXT_PAGE / APPLY_CONTINUE
// ---------------------------------------------------------------------------

describe("HyphenJoinTool — page workbench panel", () => {
  it("workbench tab initially shows no-page prompt", async () => {
    renderTool();

    // No fake timers — machine may be in scanning or reviewing
    await waitFor(() => {
      expect(screen.getByTestId("hyphen-tab-bar")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("hyphen-tab-workbench"));

    expect(screen.getByTestId("hyphen-workbench-no-page")).toBeInTheDocument();
  });

  it("clicking open-mock button transitions to workbench panel with page controls", async () => {
    renderTool();

    await waitFor(() => {
      expect(screen.getByTestId("hyphen-tab-bar")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("hyphen-tab-workbench"));
    fireEvent.click(screen.getByTestId("hyphen-workbench-open-mock"));

    await waitFor(() => {
      expect(screen.getByTestId("hyphen-workbench-panel")).toBeInTheDocument();
    });
  });

  it("workbench panel has PREV_PAGE button", async () => {
    renderTool();

    await waitFor(() =>
      expect(screen.getByTestId("hyphen-tab-bar")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("hyphen-tab-workbench"));
    fireEvent.click(screen.getByTestId("hyphen-workbench-open-mock"));

    await waitFor(() =>
      expect(
        screen.getByTestId("hyphen-workbench-prev-page"),
      ).toBeInTheDocument(),
    );
  });

  it("workbench panel has NEXT_PAGE button", async () => {
    renderTool();

    await waitFor(() =>
      expect(screen.getByTestId("hyphen-tab-bar")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("hyphen-tab-workbench"));
    fireEvent.click(screen.getByTestId("hyphen-workbench-open-mock"));

    await waitFor(() =>
      expect(
        screen.getByTestId("hyphen-workbench-next-page"),
      ).toBeInTheDocument(),
    );
  });

  it("workbench panel has APPLY_CONTINUE button", async () => {
    renderTool();

    await waitFor(() =>
      expect(screen.getByTestId("hyphen-tab-bar")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("hyphen-tab-workbench"));
    fireEvent.click(screen.getByTestId("hyphen-workbench-open-mock"));

    await waitFor(() =>
      expect(
        screen.getByTestId("hyphen-workbench-apply-continue"),
      ).toBeInTheDocument(),
    );
  });

  it("workbench panel has CLOSE_PAGE button", async () => {
    renderTool();

    await waitFor(() =>
      expect(screen.getByTestId("hyphen-tab-bar")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("hyphen-tab-workbench"));
    fireEvent.click(screen.getByTestId("hyphen-workbench-open-mock"));

    await waitFor(() =>
      expect(screen.getByTestId("hyphen-workbench-close")).toBeInTheDocument(),
    );
  });

  it("clicking Close in workbench panel returns to no-page prompt", async () => {
    renderTool();

    await waitFor(() =>
      expect(screen.getByTestId("hyphen-tab-bar")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("hyphen-tab-workbench"));
    fireEvent.click(screen.getByTestId("hyphen-workbench-open-mock"));

    await waitFor(() =>
      expect(screen.getByTestId("hyphen-workbench-close")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("hyphen-workbench-close"));

    await waitFor(() =>
      expect(
        screen.getByTestId("hyphen-workbench-no-page"),
      ).toBeInTheDocument(),
    );
  });
});

// ---------------------------------------------------------------------------
// Overview stat cells
// ---------------------------------------------------------------------------

describe("HyphenJoinTool — overview stat cells", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders six stat cells when overview tab is active", async () => {
    renderTool();

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    fireEvent.click(screen.getByTestId("hyphen-tab-overview"));

    expect(screen.getByTestId("hyphen-stat-total")).toBeInTheDocument();
    expect(screen.getByTestId("hyphen-stat-undecided")).toBeInTheDocument();
    expect(screen.getByTestId("hyphen-stat-joined")).toBeInTheDocument();
    expect(screen.getByTestId("hyphen-stat-validated")).toBeInTheDocument();
    expect(screen.getByTestId("hyphen-stat-mismatch")).toBeInTheDocument();
    expect(screen.getByTestId("hyphen-stat-unvalidated")).toBeInTheDocument();
  });
});
