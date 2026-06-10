/**
 * imageStageReview.test.ts — invariant test suite for the imageStageReview machine.
 *
 * TDD: tests written before implementation.
 * Uses createActor + simulated events. No DOM.
 *
 * Suite 1 "load lifecycle" — loading → running / review / settled
 * Suite 2 "review browsing + selection" — SELECT_PAGE, CLEAR_SELECTION
 * Suite 3 "exclusive inline editor" — OPEN_EDITOR, ACCEPT_AS_IS, CANCEL, RERUN
 * Suite 4 "filter + density" — SET_FILTER, SET_DENSITY (global on: events)
 * Suite 5 "settled + confirm gate" — allFlagsReviewed guard, confirming state
 * Suite 6 "stale banner" — UPSTREAM_CHANGED sets stale flag
 * Suite 7 "PAGE_PUSH in running" — mergePageResult, transition to review/settled
 * Suite 8 "re-run scopes" — rerunning state, onDone/onError
 */

import { describe, it, expect, vi } from "vitest";
import { createActor } from "xstate";
import {
  imageStageReviewMachine,
  type ImageStageReviewInput,
  type ImageStageReviewServices,
  type PageRow,
  type Totals,
} from "./imageStageReview";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<PageRow> = {}): PageRow {
  return {
    idx: "p001",
    prefix: "p001",
    state: "clean",
    pageNumber: 1,
    ...overrides,
  };
}

function makeTotals(overrides: Partial<Totals> = {}): Totals {
  return {
    total: 4,
    done: 4,
    flagged: 0,
    clean: 4,
    reviewed: 0,
    errors: 0,
    running: 0,
    ...overrides,
  };
}

function makeServices(
  overrides: Partial<ImageStageReviewServices> = {},
): ImageStageReviewServices {
  return {
    fetchStagePages: vi.fn().mockResolvedValue({
      rows: [
        makeRow({ idx: "p001", state: "clean", pageNumber: 1 }),
        makeRow({
          idx: "p002",
          state: "flagged",
          flags: ["thresh_low"],
          pageNumber: 2,
        }),
        makeRow({ idx: "p003", state: "clean", pageNumber: 3 }),
        makeRow({
          idx: "p004",
          state: "flagged",
          flags: ["thresh_low"],
          pageNumber: 4,
        }),
      ],
      totals: makeTotals({ flagged: 2, clean: 2 }),
    }),
    reRunPages: vi
      .fn()
      .mockResolvedValue([
        makeRow({ idx: "p002", state: "clean", pageNumber: 2 }),
        makeRow({ idx: "p004", state: "clean", pageNumber: 4 }),
      ]),
    confirmStage: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<ImageStageReviewInput> = {},
): ImageStageReviewInput {
  return {
    projectId: "proj-1",
    stageId: "threshold",
    stageIndex: 4,
    services: makeServices(),
    ...overrides,
  };
}

/** Start the machine and wait for it to finish loading (leave the `loading` state). */
async function startAndLoad(input?: Partial<ImageStageReviewInput>) {
  const actor = createActor(imageStageReviewMachine, {
    input: makeInput(input),
  });
  actor.start();
  // Wait for the initial fetchStagePages promise to resolve
  await vi.waitFor(() => {
    const snap = actor.getSnapshot();
    return snap.value !== "loading";
  });
  return actor;
}

// ---------------------------------------------------------------------------
// Suite 1 — load lifecycle
// ---------------------------------------------------------------------------

describe("imageStageReview — load lifecycle", () => {
  it("starts in loading state", () => {
    const actor = createActor(imageStageReviewMachine, { input: makeInput() });
    actor.start();
    expect(actor.getSnapshot().value).toBe("loading");
    actor.stop();
  });

  it("transitions to review when data has flagged pages", async () => {
    const actor = await startAndLoad();
    const snap = actor.getSnapshot();
    expect(snap.value).toMatchObject({ review: "browsing" });
    actor.stop();
  });

  it("transitions to running when data has pages still running", async () => {
    const runningServices = makeServices({
      fetchStagePages: vi.fn().mockResolvedValue({
        rows: [makeRow({ idx: "p001", state: "running", pageNumber: 1 })],
        totals: makeTotals({ running: 1, done: 0, clean: 0 }),
      }),
    });
    const actor = await startAndLoad({ services: runningServices });
    expect(actor.getSnapshot().value).toBe("running");
    actor.stop();
  });

  it("transitions to settled when all pages are clean/reviewed", async () => {
    const cleanServices = makeServices({
      fetchStagePages: vi.fn().mockResolvedValue({
        rows: [
          makeRow({ idx: "p001", state: "clean", pageNumber: 1 }),
          makeRow({ idx: "p002", state: "reviewed", pageNumber: 2 }),
        ],
        totals: makeTotals({ flagged: 0, clean: 1, reviewed: 1 }),
      }),
    });
    const actor = await startAndLoad({ services: cleanServices });
    expect(actor.getSnapshot().value).toBe("settled");
    actor.stop();
  });

  it("transitions to loadError on fetch failure", async () => {
    const failServices = makeServices({
      fetchStagePages: vi.fn().mockRejectedValue(new Error("Network error")),
    });
    const actor = createActor(imageStageReviewMachine, {
      input: makeInput({ services: failServices }),
    });
    actor.start();
    await vi.waitFor(() => actor.getSnapshot().value === "loadError");
    const snap = actor.getSnapshot();
    expect(snap.context.error).toEqual({ message: "Network error" });
    actor.stop();
  });

  it("RETRY from loadError transitions back to loading", async () => {
    const failServices = makeServices({
      fetchStagePages: vi.fn().mockRejectedValue(new Error("Network error")),
    });
    const actor = createActor(imageStageReviewMachine, {
      input: makeInput({ services: failServices }),
    });
    actor.start();
    await vi.waitFor(() => actor.getSnapshot().value === "loadError");
    actor.send({ type: "RETRY" });
    expect(actor.getSnapshot().value).toBe("loading");
    actor.stop();
  });

  it("assigns rows and totals after successful load", async () => {
    const actor = await startAndLoad();
    const ctx = actor.getSnapshot().context;
    expect(ctx.rows).toHaveLength(4);
    expect(ctx.totals).not.toBeNull();
    expect(ctx.totals?.flagged).toBe(2);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — review browsing + selection
// ---------------------------------------------------------------------------

describe("imageStageReview — review browsing + selection", () => {
  it("SELECT_PAGE from browsing enters selecting with one item", async () => {
    const actor = await startAndLoad();
    actor.send({ type: "SELECT_PAGE", idx: "p001" });
    const snap = actor.getSnapshot();
    expect(snap.value).toMatchObject({ review: "selecting" });
    expect(snap.context.selected).toEqual(["p001"]);
    actor.stop();
  });

  it("CLEAR_SELECTION from selecting returns to browsing", async () => {
    const actor = await startAndLoad();
    actor.send({ type: "SELECT_PAGE", idx: "p001" });
    actor.send({ type: "CLEAR_SELECTION" });
    expect(actor.getSnapshot().value).toMatchObject({ review: "browsing" });
    expect(actor.getSnapshot().context.selected).toEqual([]);
    actor.stop();
  });

  it("SELECT_PAGE in selecting toggles the item", async () => {
    const actor = await startAndLoad();
    actor.send({ type: "SELECT_PAGE", idx: "p001" });
    // Add a second item
    actor.send({ type: "SELECT_PAGE", idx: "p002" });
    expect(actor.getSnapshot().context.selected).toContain("p002");
    // Remove it
    actor.send({ type: "SELECT_PAGE", idx: "p002" });
    expect(actor.getSnapshot().context.selected).not.toContain("p002");
    actor.stop();
  });

  it("BULK_RERUN from selecting enters running state", async () => {
    const actor = await startAndLoad();
    actor.send({ type: "SELECT_PAGE", idx: "p002" });
    actor.send({ type: "BULK_RERUN" });
    expect(actor.getSnapshot().value).toBe("running");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — exclusive inline editor
// ---------------------------------------------------------------------------

describe("imageStageReview — exclusive inline editor", () => {
  it("OPEN_EDITOR from browsing enters editing state", async () => {
    const actor = await startAndLoad();
    actor.send({ type: "OPEN_EDITOR", idx: "p002" });
    const snap = actor.getSnapshot();
    expect(snap.value).toMatchObject({ review: "editing" });
    expect(snap.context.editing).toBe("p002");
    actor.stop();
  });

  it("OPEN_EDITOR from selecting enters editing state", async () => {
    const actor = await startAndLoad();
    actor.send({ type: "SELECT_PAGE", idx: "p001" });
    actor.send({ type: "OPEN_EDITOR", idx: "p002" });
    const snap = actor.getSnapshot();
    expect(snap.value).toMatchObject({ review: "editing" });
    expect(snap.context.editing).toBe("p002");
    actor.stop();
  });

  it("opening one editor closes any previous — exclusive", async () => {
    const actor = await startAndLoad();
    actor.send({ type: "OPEN_EDITOR", idx: "p002" });
    actor.send({ type: "CANCEL" }); // close first editor
    actor.send({ type: "OPEN_EDITOR", idx: "p004" }); // open second
    expect(actor.getSnapshot().context.editing).toBe("p004");
    actor.stop();
  });

  it("CANCEL from editing returns to browsing, clears editing + draft", async () => {
    const actor = await startAndLoad();
    actor.send({ type: "OPEN_EDITOR", idx: "p002" });
    actor.send({ type: "SET_PARAM", patch: { threshold: 0.5 } });
    actor.send({ type: "CANCEL" });
    const snap = actor.getSnapshot();
    expect(snap.value).toMatchObject({ review: "browsing" });
    expect(snap.context.editing).toBeNull();
    expect(snap.context.draft).toBeNull();
    actor.stop();
  });

  it("SET_PARAM patches draft", async () => {
    const actor = await startAndLoad();
    actor.send({ type: "OPEN_EDITOR", idx: "p002" });
    actor.send({ type: "SET_PARAM", patch: { threshold: 0.7 } });
    const draft = actor.getSnapshot().context.draft;
    expect(draft).toMatchObject({ threshold: 0.7 });
    actor.stop();
  });

  it("ACCEPT_AS_IS marks row as reviewed and returns to browsing", async () => {
    const actor = await startAndLoad();
    actor.send({ type: "OPEN_EDITOR", idx: "p002" });
    actor.send({ type: "ACCEPT_AS_IS" });
    const snap = actor.getSnapshot();
    const row = snap.context.rows.find((r) => r.idx === "p002");
    expect(row?.state).toBe("reviewed");
    expect(snap.context.editing).toBeNull();
    actor.stop();
  });

  it("RERUN from editing enters rerunning state", async () => {
    const actor = await startAndLoad();
    actor.send({ type: "OPEN_EDITOR", idx: "p002" });
    actor.send({ type: "RERUN" });
    expect(actor.getSnapshot().value).toMatchObject({ review: "rerunning" });
    actor.stop();
  });

  it("rerunning onDone merges results and returns to browsing", async () => {
    const actor = await startAndLoad();
    actor.send({ type: "OPEN_EDITOR", idx: "p002" });
    actor.send({ type: "RERUN" });
    await vi.waitFor(() => {
      const v = actor.getSnapshot().value;
      return typeof v === "object" && "review" in v && v.review === "browsing";
    });
    const snap = actor.getSnapshot();
    expect(snap.context.editing).toBeNull();
    expect(snap.context.draft).toBeNull();
    actor.stop();
  });

  it("rerunning onError returns to editing state with error", async () => {
    const failRerun = makeServices({
      reRunPages: vi.fn().mockRejectedValue(new Error("Rerun failed")),
    });
    const actor = await startAndLoad({ services: failRerun });
    actor.send({ type: "OPEN_EDITOR", idx: "p002" });
    actor.send({ type: "RERUN" });
    await vi.waitFor(() => {
      const v = actor.getSnapshot().value;
      return typeof v === "object" && "review" in v && v.review === "editing";
    });
    expect(actor.getSnapshot().context.error).toMatchObject({
      message: "Rerun failed",
    });
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 4 — filter + density (global on: events)
// ---------------------------------------------------------------------------

describe("imageStageReview — filter + density", () => {
  it("SET_FILTER updates filter context in review state", async () => {
    const actor = await startAndLoad();
    actor.send({ type: "SET_FILTER", value: "flagged" });
    expect(actor.getSnapshot().context.filter).toBe("flagged");
    actor.stop();
  });

  it("SET_DENSITY updates density context in review state", async () => {
    const actor = await startAndLoad();
    actor.send({ type: "SET_DENSITY", value: "L" });
    expect(actor.getSnapshot().context.density).toBe("L");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 5 — settled + confirm gate
// ---------------------------------------------------------------------------

describe("imageStageReview — settled + confirm gate", () => {
  it("CONFIRM_ADVANCE allowed only when allFlagsReviewed", async () => {
    // With 2 flagged + 0 reviewed → gate should block
    const actor = await startAndLoad();
    // In review state with flagged rows, confirm should not transition
    actor.send({ type: "CONFIRM_ADVANCE" });
    // Should still be in review (guard blocked)
    const snap = actor.getSnapshot();
    expect(snap.value).not.toBe("confirming");
    actor.stop();
  });

  it("CONFIRM_ADVANCE allowed when all flagged are reviewed", async () => {
    const allReviewedServices = makeServices({
      fetchStagePages: vi.fn().mockResolvedValue({
        rows: [
          makeRow({ idx: "p001", state: "reviewed", pageNumber: 1 }),
          makeRow({ idx: "p002", state: "reviewed", pageNumber: 2 }),
        ],
        totals: makeTotals({ flagged: 2, reviewed: 2, clean: 0 }),
      }),
    });
    const actor = await startAndLoad({ services: allReviewedServices });
    actor.send({ type: "CONFIRM_ADVANCE" });
    expect(actor.getSnapshot().value).toBe("confirming");
    actor.stop();
  });

  it("confirming onDone transitions to settled", async () => {
    const allReviewedServices = makeServices({
      fetchStagePages: vi.fn().mockResolvedValue({
        rows: [makeRow({ idx: "p001", state: "reviewed", pageNumber: 1 })],
        totals: makeTotals({ flagged: 1, reviewed: 1, clean: 0 }),
      }),
    });
    const actor = await startAndLoad({ services: allReviewedServices });
    actor.send({ type: "CONFIRM_ADVANCE" });
    await vi.waitFor(() => actor.getSnapshot().value === "settled");
    expect(actor.getSnapshot().value).toBe("settled");
    actor.stop();
  });

  it("OPEN_EDITOR from settled transitions to review.editing for spot-check", async () => {
    const cleanServices = makeServices({
      fetchStagePages: vi.fn().mockResolvedValue({
        rows: [makeRow({ idx: "p001", state: "clean", pageNumber: 1 })],
        totals: makeTotals({ flagged: 0, clean: 1 }),
      }),
    });
    const actor = await startAndLoad({ services: cleanServices });
    // Should be in settled
    expect(actor.getSnapshot().value).toBe("settled");
    actor.send({ type: "OPEN_EDITOR", idx: "p001" });
    const snap = actor.getSnapshot();
    expect(snap.value).toMatchObject({ review: "editing" });
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 6 — stale banner
// ---------------------------------------------------------------------------

describe("imageStageReview — stale banner", () => {
  it("UPSTREAM_CHANGED in review sets stale flag to true", async () => {
    const actor = await startAndLoad();
    expect(actor.getSnapshot().context.stale).toBe(false);
    actor.send({ type: "UPSTREAM_CHANGED" });
    expect(actor.getSnapshot().context.stale).toBe(true);
    actor.stop();
  });

  it("RERUN_STAGE in review transitions to running", async () => {
    const actor = await startAndLoad();
    actor.send({ type: "RERUN_STAGE" });
    expect(actor.getSnapshot().value).toBe("running");
    actor.stop();
  });

  it("REDERIVE in review transitions to running", async () => {
    const actor = await startAndLoad();
    actor.send({ type: "REDERIVE" });
    expect(actor.getSnapshot().value).toBe("running");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 7 — PAGE_PUSH in running state
// ---------------------------------------------------------------------------

describe("imageStageReview — PAGE_PUSH in running state", () => {
  async function startRunning() {
    const runningServices = makeServices({
      fetchStagePages: vi.fn().mockResolvedValue({
        rows: [
          makeRow({ idx: "p001", state: "running", pageNumber: 1 }),
          makeRow({ idx: "p002", state: "running", pageNumber: 2 }),
        ],
        totals: makeTotals({ running: 2, done: 0, clean: 0 }),
      }),
    });
    const actor = await startAndLoad({ services: runningServices });
    expect(actor.getSnapshot().value).toBe("running");
    return actor;
  }

  it("PAGE_PUSH while still running updates rows but stays in running", async () => {
    const actor = await startRunning();
    actor.send({
      type: "PAGE_PUSH",
      row: makeRow({ idx: "p001", state: "clean", pageNumber: 1 }),
    });
    // Still 1 page running
    expect(actor.getSnapshot().value).toBe("running");
    actor.stop();
  });

  it("PAGE_PUSH with last running page + flagged transitions to review", async () => {
    const actor = await startRunning();
    // Mark p001 as done first (merge it in)
    actor.send({
      type: "PAGE_PUSH",
      row: makeRow({ idx: "p001", state: "clean", pageNumber: 1 }),
    });
    // Last page finishes as flagged
    actor.send({
      type: "PAGE_PUSH",
      row: makeRow({
        idx: "p002",
        state: "flagged",
        flags: ["thresh_low"],
        pageNumber: 2,
      }),
    });
    expect(actor.getSnapshot().value).toMatchObject({ review: "browsing" });
    actor.stop();
  });

  it("PAGE_PUSH with last running page + all clean transitions to settled", async () => {
    const actor = await startRunning();
    actor.send({
      type: "PAGE_PUSH",
      row: makeRow({ idx: "p001", state: "clean", pageNumber: 1 }),
    });
    actor.send({
      type: "PAGE_PUSH",
      row: makeRow({ idx: "p002", state: "clean", pageNumber: 2 }),
    });
    expect(actor.getSnapshot().value).toBe("settled");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 8 — SET_APPLY_TO scope
// ---------------------------------------------------------------------------

describe("imageStageReview — apply-to scope", () => {
  it("SET_APPLY_TO updates applyTo context", async () => {
    const actor = await startAndLoad();
    actor.send({ type: "OPEN_EDITOR", idx: "p002" });
    actor.send({ type: "SET_APPLY_TO", value: "sameIssue" });
    expect(actor.getSnapshot().context.applyTo).toBe("sameIssue");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 9 — BULK_ACCEPT settle gap (DIVERGENCE #5 fix)
// ---------------------------------------------------------------------------

describe("imageStageReview — BULK_ACCEPT settle from selecting", () => {
  /**
   * BEHAVIORAL BUG (pre-fix): BULK_ACCEPT from selecting only ran acceptSelected
   * and stayed in selecting — no settle guard existed there. The always guard was
   * only on browsing, so if the last flagged pages were bulk-accepted while in
   * selecting, the machine stranded in selecting instead of reaching settled.
   *
   * Fix: selecting now also has an always guard that mirrors browsing.
   * DIVERGENCE #5 update: the settle guard must cover BOTH browsing and selecting.
   */
  it("BULK_ACCEPT clearing the last flagged pages from selecting reaches settled", async () => {
    // Load with exactly the two flagged pages (p002, p004) in view
    const actor = await startAndLoad();
    // Enter selecting
    actor.send({ type: "SELECT_PAGE", idx: "p002" });
    expect(actor.getSnapshot().value).toMatchObject({ review: "selecting" });
    // Also select the other flagged page
    actor.send({ type: "SELECT_PAGE", idx: "p004" });
    // Accept both — this marks p002 and p004 as "reviewed", leaving totals.flagged === 0
    actor.send({ type: "BULK_ACCEPT" });
    // Machine must auto-settle; stranding in selecting is the bug
    await vi.waitFor(() => actor.getSnapshot().value === "settled");
    expect(actor.getSnapshot().value).toBe("settled");
    actor.stop();
  });

  it("BULK_ACCEPT with remaining flagged pages stays in selecting", async () => {
    // Only accept one of the two flagged pages — should stay in selecting/browsing, not settle
    const actor = await startAndLoad();
    actor.send({ type: "SELECT_PAGE", idx: "p002" });
    actor.send({ type: "BULK_ACCEPT" });
    // p004 is still flagged — must NOT settle
    const snap = actor.getSnapshot();
    expect(snap.value).not.toBe("settled");
    actor.stop();
  });
});
