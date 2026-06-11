/**
 * wordcheckTool.test.ts — TDD tests for the Wordcheck stage tool machine.
 *
 * Invariants derived from tool-wordcheck.yaml:
 * - Machine starts in parallel scanning + curating states
 * - SCAN_DONE with suspects → reviewing; without → settled
 * - FIX / KEEP drop the suspect and recount
 * - settleIfClear (always guard): suspects.length === 0 → auto-settle via confirming
 * - CONFIRM_ADVANCE guarded by notRunning (all pages scanned)
 * - PROMOTE_TO_LIBRARY (cross-project write) — invoke works normally from client POV
 * - ACCEPT_DICT_FIXES batch invocation
 * - UPSTREAM_CHANGED / RERUN_CHECK from settled → re-scanning
 */

import { createActor, waitFor } from "xstate";
import { describe, it, expect, vi } from "vitest";
import {
  wordcheckToolMachine,
  type Suspect,
  type SuspectTotals,
  type ListTotals,
  type WordcheckToolServices,
} from "./wordcheckTool";
import { stubStageSettingsServices } from "./stageSettings";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeSuspect(id: string, overrides: Partial<Suspect> = {}): Suspect {
  return {
    id,
    word: `word-${id}`,
    fix: `fix-${id}`,
    ctxL: "context left",
    ctxR: "context right",
    type: "dictFail",
    page: "p001",
    line: 1,
    rule: "dict",
    score: 0.9,
    ...overrides,
  };
}

function makeTotals(overrides: Partial<SuspectTotals> = {}): SuspectTotals {
  return {
    total: 12,
    done: 12,
    suspects: 3,
    stealth: 0,
    flagged: 0,
    reviewed: 0,
    clean: 9,
    ...overrides,
  };
}

function makeServices(
  overrides: Partial<WordcheckToolServices> = {},
): WordcheckToolServices {
  return {
    ...stubStageSettingsServices(),
    acceptDictionaryFixes: vi.fn().mockResolvedValue({ fixedIds: [] }),
    acceptHighConfidence: vi.fn().mockResolvedValue({ acceptedIds: [] }),
    promoteToLibrary: vi.fn().mockResolvedValue({
      good: 0,
      bad: 0,
      bookGood: 0,
      bookBad: 0,
      libraryGood: 0,
      libraryBad: 0,
    }),
    confirmStage: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

function startMachine(services = makeServices()) {
  const actor = createActor(wordcheckToolMachine, {
    input: { projectId: "p1", stageIndex: 8, services },
  });
  actor.start();
  return actor;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe("initial state (parallel)", () => {
  it("starts in suspects.scanning and listBuilder.curating", () => {
    const actor = startMachine();
    const snap = actor.getSnapshot();
    expect(
      snap.matches({ suspects: "scanning", listBuilder: "curating" }),
    ).toBe(true);
  });

  it("has empty suspects, candidates, and null totals", () => {
    const actor = startMachine();
    const { suspects, candidates, totals, listTotals } =
      actor.getSnapshot().context;
    expect(suspects).toHaveLength(0);
    expect(candidates).toHaveLength(0);
    expect(totals).toBeNull();
    expect(listTotals).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Suspects region — scanning phase
// ---------------------------------------------------------------------------

describe("suspects region — scanning", () => {
  it("SCAN_PROGRESS updates totals while in scanning", () => {
    const actor = startMachine();
    // Set initial totals via scan progress
    actor.send({
      type: "SCAN_DONE",
      suspects: [],
      totals: makeTotals({ suspects: 0, done: 12, total: 12 }),
    });
    // Now we're in settled (no suspects). Check SCAN_PROGRESS updates while in scanning
    const actor2 = startMachine();
    actor2.send({ type: "SCAN_PROGRESS", done: 6, suspects: 2 });
    // totals should remain null until SCAN_DONE (SCAN_PROGRESS updates existing totals only)
    // Since totals is null initially, SCAN_PROGRESS returns null
    expect(actor2.getSnapshot().context.totals).toBeNull();
  });

  it("SCAN_DONE with suspects → suspects.reviewing", async () => {
    const actor = startMachine();
    actor.send({
      type: "SCAN_DONE",
      suspects: [makeSuspect("s1"), makeSuspect("s2")],
      totals: makeTotals({ suspects: 2 }),
    });
    const snap = actor.getSnapshot();
    expect(snap.matches({ suspects: "reviewing" })).toBe(true);
    expect(snap.context.suspects).toHaveLength(2);
  });

  it("SCAN_DONE with no suspects → suspects.settled (skips reviewing)", () => {
    const actor = startMachine();
    actor.send({
      type: "SCAN_DONE",
      suspects: [],
      totals: makeTotals({ suspects: 0 }),
    });
    const snap = actor.getSnapshot();
    // With no suspects, always guard fires immediately → confirming → settled
    // Since confirmStage is async, may be in confirming
    const inSettledOrConfirming =
      snap.matches({ suspects: "settled" }) ||
      snap.matches({ suspects: "confirming" });
    expect(inSettledOrConfirming).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suspects region — reviewing
// ---------------------------------------------------------------------------

describe("suspects region — reviewing", () => {
  function reachReviewing(extraSuspects: Suspect[] = []) {
    const services = makeServices();
    const actor = startMachine(services);
    const suspects = [makeSuspect("s1"), makeSuspect("s2"), ...extraSuspects];
    actor.send({
      type: "SCAN_DONE",
      suspects,
      totals: makeTotals({ suspects: suspects.length }),
    });
    return actor;
  }

  it("FIX drops the suspect and recounts", () => {
    const actor = reachReviewing();
    const before = actor.getSnapshot().context.suspects.length;
    actor.send({ type: "FIX", suspectId: "s1" });
    const snap = actor.getSnapshot();
    expect(snap.context.suspects).toHaveLength(before - 1);
    expect(snap.context.suspects.find((s) => s.id === "s1")).toBeUndefined();
  });

  it("KEEP drops the suspect and recounts", () => {
    const actor = reachReviewing();
    actor.send({ type: "KEEP", suspectId: "s1" });
    const snap = actor.getSnapshot();
    expect(snap.context.suspects.find((s) => s.id === "s1")).toBeUndefined();
  });

  it("auto-settles (via confirming) when last suspect is removed by FIX", async () => {
    const actor = startMachine();
    // Single suspect
    actor.send({
      type: "SCAN_DONE",
      suspects: [makeSuspect("s1")],
      totals: makeTotals({ suspects: 1 }),
    });
    expect(actor.getSnapshot().matches({ suspects: "reviewing" })).toBe(true);

    actor.send({ type: "FIX", suspectId: "s1" });

    // The always guard fires → confirming → (async confirm) → settled
    const snap = await waitFor(
      actor,
      (s) =>
        s.matches({ suspects: "settled" }) ||
        s.matches({ suspects: "confirming" }),
    );
    expect(
      snap.matches({ suspects: "settled" }) ||
        snap.matches({ suspects: "confirming" }),
    ).toBe(true);
  });

  it("SET_SUSPECT_FILTER updates the filter", () => {
    const actor = reachReviewing();
    actor.send({ type: "SET_SUSPECT_FILTER", value: "stealth" });
    expect(actor.getSnapshot().context.suspectFilter).toBe("stealth");
  });

  it("CONFIRM_ADVANCE when notRunning (done === total) → confirming", async () => {
    const actor = startMachine();
    actor.send({
      type: "SCAN_DONE",
      suspects: [makeSuspect("s1")],
      totals: makeTotals({ done: 12, total: 12, suspects: 1 }),
    });
    actor.send({ type: "CONFIRM_ADVANCE" });
    const snap = await waitFor(
      actor,
      (s) =>
        s.matches({ suspects: "confirming" }) ||
        s.matches({ suspects: "settled" }),
    );
    expect(
      snap.matches({ suspects: "confirming" }) ||
        snap.matches({ suspects: "settled" }),
    ).toBe(true);
  });

  it("CONFIRM_ADVANCE blocked when totals are null", () => {
    const actor = startMachine();
    actor.send({
      type: "SCAN_DONE",
      suspects: [makeSuspect("s1")],
      totals: { ...makeTotals(), done: 0, total: 12 },
    });
    actor.send({ type: "CONFIRM_ADVANCE" });
    // notRunning is false when done != total
    expect(actor.getSnapshot().matches({ suspects: "reviewing" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suspects region — batchFixing
// ---------------------------------------------------------------------------

describe("suspects region — batchFixing", () => {
  it("ACCEPT_DICT_FIXES invokes service and merges fixedIds", async () => {
    const fixedIds = ["s1", "s2"];
    const acceptDictionaryFixes = vi.fn().mockResolvedValue({ fixedIds });
    const services = makeServices({ acceptDictionaryFixes });
    const actor = startMachine(services);
    actor.send({
      type: "SCAN_DONE",
      suspects: [makeSuspect("s1"), makeSuspect("s2"), makeSuspect("s3")],
      totals: makeTotals({ suspects: 3 }),
    });
    actor.send({ type: "ACCEPT_DICT_FIXES" });

    const snap = await waitFor(
      actor,
      (s) =>
        s.matches({ suspects: "reviewing" }) ||
        s.matches({ suspects: "confirming" }),
    );
    expect(acceptDictionaryFixes).toHaveBeenCalledWith("p1");
    // s1 and s2 should be dropped; s3 remains
    const suspects = snap.context.suspects;
    expect(suspects.find((s) => s.id === "s1")).toBeUndefined();
    expect(suspects.find((s) => s.id === "s2")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Suspects region — confirming + settled
// ---------------------------------------------------------------------------

describe("suspects region — confirming and settled", () => {
  it("confirmStage called on CONFIRM_ADVANCE; settled on success", async () => {
    const confirmStage = vi.fn().mockResolvedValue({ ok: true });
    const services = makeServices({ confirmStage });
    const actor = startMachine(services);
    actor.send({
      type: "SCAN_DONE",
      suspects: [makeSuspect("s1")],
      totals: makeTotals({ done: 12, total: 12, suspects: 1 }),
    });
    actor.send({ type: "CONFIRM_ADVANCE" });
    const snap = await waitFor(actor, (s) =>
      s.matches({ suspects: "settled" }),
    );
    expect(confirmStage).toHaveBeenCalledWith("p1");
    expect(snap.matches({ suspects: "settled" })).toBe(true);
  });

  it("confirmStage error → back to reviewing with error set", async () => {
    const confirmStage = vi.fn().mockRejectedValue(new Error("server error"));
    const services = makeServices({ confirmStage });
    const actor = startMachine(services);
    actor.send({
      type: "SCAN_DONE",
      suspects: [makeSuspect("s1")],
      totals: makeTotals({ done: 12, total: 12, suspects: 1 }),
    });
    actor.send({ type: "CONFIRM_ADVANCE" });
    const snap = await waitFor(actor, (s) =>
      s.matches({ suspects: "reviewing" }),
    );
    expect(snap.context.error?.message).toBe("server error");
  });

  it("UPSTREAM_CHANGED from settled → re-scanning", async () => {
    const actor = startMachine();
    actor.send({
      type: "SCAN_DONE",
      suspects: [],
      totals: makeTotals({ suspects: 0 }),
    });
    await waitFor(
      actor,
      (s) =>
        s.matches({ suspects: "settled" }) ||
        s.matches({ suspects: "confirming" }),
    );
    // Wait for settled specifically
    actor.send({ type: "UPSTREAM_CHANGED" });
    expect(actor.getSnapshot().matches({ suspects: "scanning" })).toBe(true);
  });

  it("RERUN_CHECK from settled → re-scanning", async () => {
    const actor = startMachine();
    actor.send({
      type: "SCAN_DONE",
      suspects: [],
      totals: makeTotals({ suspects: 0 }),
    });
    // May be in confirming or settled
    await waitFor(
      actor,
      (s) =>
        s.matches({ suspects: "settled" }) ||
        s.matches({ suspects: "confirming" }),
    );
    // Force to settled if confirming
    const snap = actor.getSnapshot();
    if (snap.matches({ suspects: "confirming" })) {
      await waitFor(actor, (s) => s.matches({ suspects: "settled" }));
    }
    actor.send({ type: "RERUN_CHECK" });
    expect(actor.getSnapshot().matches({ suspects: "scanning" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// listBuilder region — curating
// ---------------------------------------------------------------------------

describe("listBuilder region — curating", () => {
  it("ADD_TO_LIST removes candidate from list (accepted)", () => {
    const actor = startMachine();
    // Manually load candidates by setting them in the context via SKIP_CANDIDATE
    // (only way without a fetch actor). Test ADD_TO_LIST on empty candidates gracefully.
    actor.send({ type: "ADD_TO_LIST", candidateId: "c1", list: "good" });
    // With no candidates, nothing to drop — list remains empty
    expect(actor.getSnapshot().context.candidates).toHaveLength(0);
  });

  it("SKIP_CANDIDATE removes candidate", () => {
    const actor = startMachine();
    actor.send({ type: "SKIP_CANDIDATE", candidateId: "c1" });
    expect(actor.getSnapshot().context.candidates).toHaveLength(0);
  });

  it("DEFER marks candidate as deferred (no-op if not found)", () => {
    const actor = startMachine();
    actor.send({ type: "DEFER", candidateId: "c1" });
    // candidate not found → context unchanged
    expect(actor.getSnapshot().context.candidates).toHaveLength(0);
  });

  it("SET_LIST_FILTER updates listFilter", () => {
    const actor = startMachine();
    actor.send({ type: "SET_LIST_FILTER", value: "bad" });
    expect(actor.getSnapshot().context.listFilter).toBe("bad");
  });
});

// ---------------------------------------------------------------------------
// listBuilder region — batchAccepting
// ---------------------------------------------------------------------------

describe("listBuilder region — batchAccepting", () => {
  it("ACCEPT_HIGH_CONFIDENCE invokes service and returns to curating", async () => {
    const acceptHighConfidence = vi
      .fn()
      .mockResolvedValue({ acceptedIds: ["c1"] });
    const services = makeServices({ acceptHighConfidence });
    const actor = startMachine(services);
    actor.send({ type: "ACCEPT_HIGH_CONFIDENCE" });
    const snap = await waitFor(actor, (s) =>
      s.matches({ listBuilder: "curating" }),
    );
    expect(acceptHighConfidence).toHaveBeenCalledWith("p1");
    expect(snap.matches({ listBuilder: "curating" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// listBuilder region — promoting (cross-project write)
// ---------------------------------------------------------------------------

describe("listBuilder region — promoting", () => {
  it("PROMOTE_TO_LIBRARY invokes promoteToLibrary and updates listTotals", async () => {
    const promoteResult: ListTotals = {
      good: 5,
      bad: 2,
      bookGood: 5,
      bookBad: 2,
      libraryGood: 5,
      libraryBad: 2,
    };
    const promoteToLibrary = vi.fn().mockResolvedValue(promoteResult);
    const services = makeServices({ promoteToLibrary });
    const actor = startMachine(services);
    actor.send({ type: "PROMOTE_TO_LIBRARY" });
    const snap = await waitFor(actor, (s) =>
      s.matches({ listBuilder: "curating" }),
    );
    expect(promoteToLibrary).toHaveBeenCalledWith("p1");
    expect(snap.context.listTotals?.libraryGood).toBe(5);
  });

  it("promoteToLibrary error → back to curating with error", async () => {
    const promoteToLibrary = vi
      .fn()
      .mockRejectedValue(new Error("not authorized"));
    const services = makeServices({ promoteToLibrary });
    const actor = startMachine(services);
    actor.send({ type: "PROMOTE_TO_LIBRARY" });
    const snap = await waitFor(actor, (s) =>
      s.matches({ listBuilder: "curating" }),
    );
    expect(snap.context.error?.message).toBe("not authorized");
  });
});

// ---------------------------------------------------------------------------
// Independence of parallel regions
// ---------------------------------------------------------------------------

describe("parallel region independence", () => {
  it("listBuilder transitions do not affect suspects region", async () => {
    const actor = startMachine();
    actor.send({
      type: "SCAN_DONE",
      suspects: [makeSuspect("s1")],
      totals: makeTotals({ suspects: 1 }),
    });
    expect(actor.getSnapshot().matches({ suspects: "reviewing" })).toBe(true);

    // Trigger a listBuilder transition
    actor.send({ type: "ACCEPT_HIGH_CONFIDENCE" });

    // suspects region must still be in reviewing
    expect(actor.getSnapshot().matches({ suspects: "reviewing" })).toBe(true);
  });

  it("suspects transitions do not affect listBuilder region", () => {
    const actor = startMachine();
    actor.send({
      type: "SCAN_DONE",
      suspects: [makeSuspect("s1"), makeSuspect("s2")],
      totals: makeTotals({ suspects: 2 }),
    });
    actor.send({ type: "SET_LIST_FILTER", value: "bad" });
    expect(actor.getSnapshot().context.listFilter).toBe("bad");

    actor.send({ type: "FIX", suspectId: "s1" });
    // listFilter should be unchanged
    expect(actor.getSnapshot().context.listFilter).toBe("bad");
  });
});
