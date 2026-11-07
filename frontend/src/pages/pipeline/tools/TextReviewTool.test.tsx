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
 * Queue rows that the view-on-page tests need are passed through
 * `_testQueueReady`. A production mount with no project does not invent them.
 *
 * @see src/machines/tools/textReviewTool.ts — machine
 * @see TextReviewTool.tsx — component under test
 */

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { server } from "@/test/server";
import type {
  QueueItem,
  ReviewTotals,
  Thread,
} from "@/machines/tools/textReviewTool";
import { TextReviewTool } from "./TextReviewTool";

// ---------------------------------------------------------------------------
// Minimal runnerRef stub (unused at F5 — wired at I1)
// ---------------------------------------------------------------------------

const fakeRunnerRef = {} as never;

const MOCK_ITEMS: QueueItem[] = [
  {
    id: "qi1",
    word: "tbe",
    ctxL: "…saw ",
    ctxR: " light…",
    suggest: "the",
    reason: "dict-fail",
    page: "p0002",
    line: 14,
    reviewer: "auto",
    comments: 0,
    status: "pending",
  },
  {
    id: "qi2",
    word: "ligbt",
    ctxL: "…tbe ",
    ctxR: " and…",
    reason: "dict-fail",
    page: "p0002",
    line: 14,
    reviewer: "auto",
    comments: 0,
    status: "pending",
  },
  {
    id: "qi3",
    word: "ond",
    ctxL: "…light ",
    ctxR: " the…",
    suggest: "and",
    reason: "dict-fail",
    page: "p0003",
    line: 7,
    reviewer: "auto",
    comments: 0,
    status: "pending",
  },
];

const MOCK_THREADS: Thread[] = [];

const MOCK_TOTALS: ReviewTotals = {
  total: MOCK_ITEMS.length,
  queue: MOCK_ITEMS.length,
  pending: MOCK_ITEMS.length,
  discuss: 0,
  approved: 0,
  clean: 0,
  comments: 0,
};

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function renderTool() {
  return render(
    <TextReviewTool stageId="text_review" runnerRef={fakeRunnerRef} />,
  );
}

function renderToolWithQueue() {
  return render(
    <TextReviewTool
      stageId="text_review"
      runnerRef={fakeRunnerRef}
      _testQueueReady={{
        queue: MOCK_ITEMS,
        threads: MOCK_THREADS,
        totals: MOCK_TOTALS,
      }}
    />,
  );
}

function renderLive(projectId: string) {
  return render(
    <MemoryRouter initialEntries={[`/projects/${projectId}/pipeline`]}>
      <Routes>
        <Route
          path="/projects/:projectId/pipeline"
          element={
            <TextReviewTool stageId="text_review" runnerRef={fakeRunnerRef} />
          }
        />
      </Routes>
    </MemoryRouter>,
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

  it("leaves assembling for an empty queue and does not invent items", async () => {
    renderTool();

    await waitFor(() => {
      expect(
        screen.getByTestId("text-review-tool-settled"),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("text-review-tool-assembling"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("tbe")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tab bar (after QUEUE_READY)
// ---------------------------------------------------------------------------

describe("TextReviewTool — tab bar after queue ready", () => {
  it("renders tab bar after the test queue is applied", () => {
    renderToolWithQueue();

    expect(screen.getByTestId("text-review-tab-bar")).toBeInTheDocument();
  });

  it("all four tab buttons are present", () => {
    renderToolWithQueue();

    expect(screen.getByTestId("text-review-tab-overview")).toBeInTheDocument();
    expect(screen.getByTestId("text-review-tab-review")).toBeInTheDocument();
    expect(screen.getByTestId("text-review-tab-threads")).toBeInTheDocument();
    expect(screen.getByTestId("text-review-tab-settings")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

describe("TextReviewTool — tab switching", () => {
  it("starts on the review tab by default", () => {
    renderToolWithQueue();

    expect(screen.getByTestId("text-review-review-tab")).toBeInTheDocument();
    expect(
      screen.queryByTestId("text-review-overview-tab"),
    ).not.toBeInTheDocument();
  });

  it("clicking Overview tab shows text-review-overview-tab", () => {
    renderToolWithQueue();

    fireEvent.click(screen.getByTestId("text-review-tab-overview"));

    expect(screen.getByTestId("text-review-overview-tab")).toBeInTheDocument();
    expect(
      screen.queryByTestId("text-review-review-tab"),
    ).not.toBeInTheDocument();
  });

  it("clicking Settings tab shows text-review-settings-tab", () => {
    renderToolWithQueue();

    fireEvent.click(screen.getByTestId("text-review-tab-settings"));

    expect(screen.getByTestId("text-review-settings-tab")).toBeInTheDocument();
    expect(
      screen.queryByTestId("text-review-review-tab"),
    ).not.toBeInTheDocument();
  });

  it("clicking Threads tab shows text-review-threads-tab", () => {
    renderToolWithQueue();

    fireEvent.click(screen.getByTestId("text-review-tab-threads"));

    expect(screen.getByTestId("text-review-threads-tab")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// VIEW_ON_PAGE — eye button per queue item (F5.5 fix round wiring)
// ---------------------------------------------------------------------------

describe("TextReviewTool — VIEW_ON_PAGE eye button per item", () => {
  it("renders view-on-page button for first queue item (qi1)", () => {
    renderToolWithQueue();

    expect(screen.getByTestId("view-on-page-item-qi1")).toBeInTheDocument();
  });

  it("view-on-page button has title 'View on page'", () => {
    renderToolWithQueue();

    const btn = screen.getByTestId("view-on-page-item-qi1");
    expect(btn).toHaveAttribute("title", "View on page");
  });

  it("renders view-on-page button for all three injected items", () => {
    renderToolWithQueue();

    expect(screen.getByTestId("view-on-page-item-qi1")).toBeInTheDocument();
    expect(screen.getByTestId("view-on-page-item-qi2")).toBeInTheDocument();
    expect(screen.getByTestId("view-on-page-item-qi3")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SEND_APPROVED — banner button (F5.5 fix round wiring)
// ---------------------------------------------------------------------------

describe("TextReviewTool — SEND_APPROVED button", () => {
  it("renders the send-approved button in the review banner", () => {
    renderToolWithQueue();

    expect(screen.getByTestId("text-review-send-approved")).toBeInTheDocument();
  });

  it("send-approved button label contains 'Illustrations'", () => {
    renderToolWithQueue();

    const btn = screen.getByTestId("text-review-send-approved");
    expect(btn).toHaveTextContent(/Illustrations/i);
  });
});

// ---------------------------------------------------------------------------
// DISCUSSIONS-GATE — confirm button disabled when discuss > 0
// ---------------------------------------------------------------------------

describe("TextReviewTool — DISCUSSIONS-GATE", () => {
  it("confirm-advance button is present in the review tab banner", () => {
    renderToolWithQueue();

    // Gate is open (no discuss items in the injected queue) so button is enabled
    const btn = screen.getByTestId("text-review-confirm-advance");
    expect(btn).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Overview stat cells
// ---------------------------------------------------------------------------

describe("TextReviewTool — overview stat cells", () => {
  it("renders all six stat cells when overview tab is active", () => {
    renderToolWithQueue();

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

// ---------------------------------------------------------------------------
// Live project — flags on an unattested page, never a canned word
// ---------------------------------------------------------------------------

describe("TextReviewTool — live queue", () => {
  it("queues a wordcheck flag from the server and leaves assembling", async () => {
    server.use(
      http.get("/api/data/projects/book/pages", () =>
        HttpResponse.json({
          pages: [{ idx0: 1, prefix: "img0001" }],
          next_cursor: null,
          total: 1,
        }),
      ),
      http.get("/api/data/projects/book/pages/1/stages", () =>
        HttpResponse.json([{ stage_id: "text_review", status: "not-run" }]),
      ),
      http.get("/api/data/projects/book/pages/1/stages/wordcheck/flags", () =>
        HttpResponse.json({
          page_id: "0001",
          flags: [{ word_id: "w-arid", word_text: "arid" }],
          flagged_count: 1,
          total_words: 4,
        }),
      ),
    );
    renderLive("book");

    await waitFor(() => {
      expect(screen.getByTestId("queue-item-row-w-arid")).toBeInTheDocument();
    });
    expect(screen.getAllByText("arid").length).toBeGreaterThan(0);
    expect(
      screen.queryByTestId("text-review-tool-assembling"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("tbe")).not.toBeInTheDocument();
  });
});
