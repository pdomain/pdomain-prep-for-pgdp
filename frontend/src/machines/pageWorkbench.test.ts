/**
 * pageWorkbench.test.ts — invariant test suite for the pageWorkbench machine.
 *
 * TDD: tests written before implementation.
 * Uses createActor + simulated events. No DOM.
 *
 * Suite 1 "load lifecycle" — loading → bench / loadError
 * Suite 2 "page navigation" — PREV_PAGE, NEXT_PAGE, JUMP_PAGE
 * Suite 3 "params region" — pristine→dirty→redetecting
 * Suite 4 "viewer region" — single/comparing parallel region
 * Suite 5 "apply & continue" — APPLY → applying → advance / stay
 * Suite 6 "Apply-&-Continue invariants" — advance advances cursor; rejects apply while redetecting
 */

import { describe, it, expect, vi } from "vitest";
import { createActor } from "xstate";
import {
  pageWorkbenchMachine,
  type PageWorkbenchInput,
  type PageWorkbenchServices,
  type PageRef,
} from "./pageWorkbench";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePageRef(overrides: Partial<PageRef> = {}): PageRef {
  return {
    pageId: "pg-001",
    stem: "p001",
    idx: 0,
    flagged: false,
    ...overrides,
  };
}

function makeServices(
  overrides: Partial<PageWorkbenchServices> = {},
): PageWorkbenchServices {
  return {
    fetchBenchPage: vi.fn().mockResolvedValue({
      params: { method: "sauvola", cut: 142, window: 31 },
      pageStats: { box: "1980×3120", confidence: 0.71 },
      flagNote: null,
    }),
    redetect: vi.fn().mockResolvedValue({
      pageStats: { box: "1980×3120", confidence: 0.85 },
    }),
    applyPage: vi.fn().mockResolvedValue(makePageRef()),
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<PageWorkbenchInput> = {},
): PageWorkbenchInput {
  return {
    projectId: "proj-1",
    stageId: "threshold",
    stageIndex: 4,
    pages: [
      makePageRef({ pageId: "pg-001", idx: 0 }),
      makePageRef({ pageId: "pg-002", idx: 1 }),
      makePageRef({ pageId: "pg-003", idx: 2 }),
    ],
    cursor: 0,
    services: makeServices(),
    ...overrides,
  };
}

/** Start the machine and wait for it to leave loading state. */
async function startAndLoad(input?: Partial<PageWorkbenchInput>) {
  const actor = createActor(pageWorkbenchMachine, { input: makeInput(input) });
  actor.start();
  await vi.waitFor(() => {
    const snap = actor.getSnapshot();
    return snap.value !== "loading";
  });
  return actor;
}

// ---------------------------------------------------------------------------
// Suite 1 — load lifecycle
// ---------------------------------------------------------------------------

describe("pageWorkbench — load lifecycle", () => {
  it("starts in loading state", () => {
    const actor = createActor(pageWorkbenchMachine, { input: makeInput() });
    actor.start();
    expect(actor.getSnapshot().value).toBe("loading");
    actor.stop();
  });

  it("transitions to bench after successful load", async () => {
    const actor = await startAndLoad();
    const snap = actor.getSnapshot();
    // bench is a parallel state
    expect(snap.value).toMatchObject({ bench: expect.anything() });
    actor.stop();
  });

  it("assigns params, pageStats, and flagNote from load", async () => {
    const actor = await startAndLoad();
    const ctx = actor.getSnapshot().context;
    expect(ctx.params).toEqual({ method: "sauvola", cut: 142, window: 31 });
    expect(ctx.pageStats).toEqual({ box: "1980×3120", confidence: 0.71 });
    expect(ctx.flagNote).toBeNull();
    actor.stop();
  });

  it("transitions to loadError on fetch failure", async () => {
    const failServices = makeServices({
      fetchBenchPage: vi.fn().mockRejectedValue(new Error("Network error")),
    });
    const actor = createActor(pageWorkbenchMachine, {
      input: makeInput({ services: failServices }),
    });
    actor.start();
    await vi.waitFor(() => actor.getSnapshot().value === "loadError");
    expect(actor.getSnapshot().context.error).toMatchObject({
      message: "Network error",
    });
    actor.stop();
  });

  it("RETRY from loadError goes back to loading", async () => {
    const failServices = makeServices({
      fetchBenchPage: vi.fn().mockRejectedValue(new Error("Network error")),
    });
    const actor = createActor(pageWorkbenchMachine, {
      input: makeInput({ services: failServices }),
    });
    actor.start();
    await vi.waitFor(() => actor.getSnapshot().value === "loadError");
    actor.send({ type: "RETRY" });
    expect(actor.getSnapshot().value).toBe("loading");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — page navigation
// ---------------------------------------------------------------------------

describe("pageWorkbench — page navigation", () => {
  it("NEXT_PAGE increments cursor and reloads", async () => {
    const actor = await startAndLoad({ cursor: 0 });
    actor.send({ type: "NEXT_PAGE" });
    // Transitions to loading with incremented cursor
    expect(actor.getSnapshot().context.cursor).toBe(1);
    expect(actor.getSnapshot().value).toBe("loading");
    actor.stop();
  });

  it("PREV_PAGE decrements cursor and reloads", async () => {
    const actor = await startAndLoad({ cursor: 1 });
    actor.send({ type: "PREV_PAGE" });
    expect(actor.getSnapshot().context.cursor).toBe(0);
    expect(actor.getSnapshot().value).toBe("loading");
    actor.stop();
  });

  it("NEXT_PAGE blocked when on last page", async () => {
    const actor = await startAndLoad({ cursor: 2 }); // last of 3 pages
    actor.send({ type: "NEXT_PAGE" });
    // Should stay in bench (guard blocked)
    expect(actor.getSnapshot().value).not.toBe("loading");
    expect(actor.getSnapshot().context.cursor).toBe(2);
    actor.stop();
  });

  it("PREV_PAGE blocked when on first page", async () => {
    const actor = await startAndLoad({ cursor: 0 });
    actor.send({ type: "PREV_PAGE" });
    // Should stay in bench
    expect(actor.getSnapshot().value).not.toBe("loading");
    expect(actor.getSnapshot().context.cursor).toBe(0);
    actor.stop();
  });

  it("JUMP_PAGE sets cursor and reloads", async () => {
    const actor = await startAndLoad({ cursor: 0 });
    actor.send({ type: "JUMP_PAGE", index: 2 });
    expect(actor.getSnapshot().context.cursor).toBe(2);
    expect(actor.getSnapshot().value).toBe("loading");
    actor.stop();
  });

  it("JUMP_PAGE blocked for out-of-range index", async () => {
    const actor = await startAndLoad({ cursor: 0 });
    actor.send({ type: "JUMP_PAGE", index: 10 });
    // Should stay in bench
    expect(actor.getSnapshot().value).not.toBe("loading");
    expect(actor.getSnapshot().context.cursor).toBe(0);
    actor.stop();
  });

  it("navigation clears draft", async () => {
    const actor = await startAndLoad({ cursor: 0 });
    // Create draft via SET_PARAM
    actor.send({ type: "SET_PARAM", patch: { cut: 100 } });
    expect(actor.getSnapshot().context.draft).not.toBeNull();
    actor.send({ type: "NEXT_PAGE" });
    expect(actor.getSnapshot().context.draft).toBeNull();
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — params region (parallel: bench.params)
// ---------------------------------------------------------------------------

describe("pageWorkbench — params region", () => {
  it("bench.params starts in pristine", async () => {
    const actor = await startAndLoad();
    const snap = actor.getSnapshot();
    expect(snap.value).toMatchObject({ bench: { params: "pristine" } });
    actor.stop();
  });

  it("SET_PARAM transitions params to dirty and begins draft", async () => {
    const actor = await startAndLoad();
    actor.send({ type: "SET_PARAM", patch: { cut: 100 } });
    const snap = actor.getSnapshot();
    expect(snap.value).toMatchObject({ bench: { params: "dirty" } });
    expect(snap.context.draft).toMatchObject({ cut: 100 });
    actor.stop();
  });

  it("SET_PARAM in dirty state patches draft", async () => {
    const actor = await startAndLoad();
    actor.send({ type: "SET_PARAM", patch: { cut: 100 } });
    actor.send({ type: "SET_PARAM", patch: { window: 25 } });
    const draft = actor.getSnapshot().context.draft;
    expect(draft).toMatchObject({ cut: 100, window: 25 });
    actor.stop();
  });

  it("RESET from dirty returns to pristine and clears draft", async () => {
    const actor = await startAndLoad();
    actor.send({ type: "SET_PARAM", patch: { cut: 100 } });
    actor.send({ type: "RESET" });
    const snap = actor.getSnapshot();
    expect(snap.value).toMatchObject({ bench: { params: "pristine" } });
    expect(snap.context.draft).toBeNull();
    actor.stop();
  });

  it("REDETECT transitions params to redetecting", async () => {
    const actor = await startAndLoad();
    actor.send({ type: "SET_PARAM", patch: { cut: 100 } });
    actor.send({ type: "REDETECT" });
    expect(actor.getSnapshot().value).toMatchObject({
      bench: { params: "redetecting" },
    });
    actor.stop();
  });

  it("redetect onDone updates pageStats and returns to dirty", async () => {
    const actor = await startAndLoad();
    actor.send({ type: "SET_PARAM", patch: { cut: 100 } });
    actor.send({ type: "REDETECT" });
    await vi.waitFor(() => {
      const v = actor.getSnapshot().value;
      return (
        typeof v === "object" &&
        "bench" in v &&
        typeof v.bench === "object" &&
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        v.bench !== null &&
        "params" in v.bench &&
        v.bench.params === "dirty"
      );
    });
    expect(actor.getSnapshot().context.pageStats).toEqual({
      box: "1980×3120",
      confidence: 0.85,
    });
    actor.stop();
  });

  it("redetect onError returns to dirty with error", async () => {
    const failServices = makeServices({
      redetect: vi.fn().mockRejectedValue(new Error("Detect failed")),
    });
    const actor = await startAndLoad({ services: failServices });
    actor.send({ type: "SET_PARAM", patch: { cut: 100 } });
    actor.send({ type: "REDETECT" });
    await vi.waitFor(() => {
      const v = actor.getSnapshot().value;
      return (
        typeof v === "object" &&
        "bench" in v &&
        typeof v.bench === "object" &&
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        v.bench !== null &&
        "params" in v.bench &&
        v.bench.params === "dirty"
      );
    });
    expect(actor.getSnapshot().context.error).toMatchObject({
      message: "Detect failed",
    });
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 4 — viewer region (parallel: bench.viewer)
// ---------------------------------------------------------------------------

describe("pageWorkbench — viewer region", () => {
  it("bench.viewer starts in single", async () => {
    const actor = await startAndLoad();
    expect(actor.getSnapshot().value).toMatchObject({
      bench: { viewer: "single" },
    });
    actor.stop();
  });

  it("COMPARE transitions viewer to comparing", async () => {
    const actor = await startAndLoad();
    actor.send({ type: "COMPARE" });
    expect(actor.getSnapshot().value).toMatchObject({
      bench: { viewer: "comparing" },
    });
    actor.stop();
  });

  it("COMPARE in comparing returns to single", async () => {
    const actor = await startAndLoad();
    actor.send({ type: "COMPARE" });
    actor.send({ type: "COMPARE" });
    expect(actor.getSnapshot().value).toMatchObject({
      bench: { viewer: "single" },
    });
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 5 — apply & continue
// ---------------------------------------------------------------------------

describe("pageWorkbench — apply & continue", () => {
  it("APPLY from bench transitions to applying", async () => {
    const actor = await startAndLoad();
    actor.send({ type: "APPLY" });
    expect(actor.getSnapshot().value).toBe("applying");
    actor.stop();
  });

  it("APPLY onDone with next page reloads (loading) and advances cursor", async () => {
    const actor = await startAndLoad({ cursor: 0 });
    actor.send({ type: "APPLY" });
    await vi.waitFor(() => {
      const v = actor.getSnapshot().value;
      return v === "loading" || (typeof v === "object" && "bench" in v);
    });
    // After loading completes, cursor should have advanced
    await vi.waitFor(() => {
      const snap = actor.getSnapshot();
      return snap.value !== "loading" && snap.context.cursor === 1;
    });
    expect(actor.getSnapshot().context.cursor).toBe(1);
    actor.stop();
  });

  it("APPLY onDone on last page stays in bench", async () => {
    const actor = await startAndLoad({ cursor: 2 }); // last of 3 pages
    actor.send({ type: "APPLY" });
    await vi.waitFor(() => {
      const snap = actor.getSnapshot();
      return snap.value !== "applying";
    });
    // Should be back in bench, cursor stays at 2
    expect(actor.getSnapshot().context.cursor).toBe(2);
    expect(actor.getSnapshot().value).toMatchObject({
      bench: expect.anything(),
    });
    actor.stop();
  });

  it("APPLY clears draft on success", async () => {
    const actor = await startAndLoad({ cursor: 0 });
    actor.send({ type: "SET_PARAM", patch: { cut: 100 } });
    expect(actor.getSnapshot().context.draft).not.toBeNull();
    actor.send({ type: "APPLY" });
    await vi.waitFor(() => {
      const snap = actor.getSnapshot();
      return snap.value !== "applying";
    });
    expect(actor.getSnapshot().context.draft).toBeNull();
    actor.stop();
  });

  it("APPLY onError returns to bench with error", async () => {
    const failApply = makeServices({
      applyPage: vi.fn().mockRejectedValue(new Error("Apply failed")),
    });
    const actor = await startAndLoad({ services: failApply });
    actor.send({ type: "APPLY" });
    await vi.waitFor(() => {
      const snap = actor.getSnapshot();
      return typeof snap.value === "object" && "bench" in snap.value;
    });
    expect(actor.getSnapshot().context.error).toMatchObject({
      message: "Apply failed",
    });
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 6 — Apply-&-Continue invariants
// ---------------------------------------------------------------------------

describe("pageWorkbench — apply invariants", () => {
  it("rejects APPLY while redetecting", async () => {
    const slowRedetect = makeServices({
      redetect: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  pageStats: { box: "1980×3120", confidence: 0.85 },
                }),
              1000,
            ),
          ),
      ),
    });
    const actor = await startAndLoad({ services: slowRedetect });
    actor.send({ type: "SET_PARAM", patch: { cut: 100 } });
    actor.send({ type: "REDETECT" });
    expect(actor.getSnapshot().value).toMatchObject({
      bench: { params: "redetecting" },
    });
    // APPLY while redetecting should not start applying
    actor.send({ type: "APPLY" });
    // Not in applying state — APPLY is blocked in a parallel state (redetecting)
    // The machine's top-level APPLY guard must prevent it while params is redetecting.
    // We simply check we're NOT in applying.
    expect(actor.getSnapshot().value).not.toBe("applying");
    actor.stop();
  });
});
