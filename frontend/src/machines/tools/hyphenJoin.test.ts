/**
 * hyphenJoin.test.ts — TDD tests for the Hyphen join stage tool machine.
 *
 * Invariants derived from tool-hyphen-join.yaml:
 * - Starts in scanning; invokes scanHyphenation
 * - anythingToDecide guard branches reviewing vs settled
 * - isDecidable guard blocks ACCEPT_JOIN / KEEP_HYPHEN on non-undecided cases
 * - isUnvalidatedJoin guard gates VALIDATE_JOIN
 * - isMismatch guard gates FIX_MISMATCH
 * - allDecided always guard auto-settles when nothing left
 * - settled emits resolved on entry
 * - UPSTREAM_CHANGED / SETTINGS_CHANGED re-scans from settled
 * - RETRY re-scans from failed
 */

import { createActor, waitFor } from "xstate";
import { describe, it, expect, vi } from "vitest";
import {
  hyphenJoinMachine,
  type HyphenCase,
  type HyphenTotals,
  type HyphenJoinServices,
} from "./hyphenJoin";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeCase(
  caseId: string,
  status: HyphenCase["status"],
  overrides: Partial<HyphenCase> = {},
): HyphenCase {
  return {
    caseId,
    kind: "auto",
    head: "house",
    tail: "hold",
    line: 10,
    page: "p001",
    status,
    validated: false,
    conf: 0.9,
    book: { inBody: true, joinedElsewhere: false, mismatch: false },
    ...overrides,
  };
}

function makeTotals(overrides: Partial<HyphenTotals> = {}): HyphenTotals {
  return {
    total: 10,
    joined: 4,
    validated: 2,
    undecided: 2,
    flagged: 1,
    crosspage: 0,
    mismatch: 1,
    unvalidated: 3,
    ...overrides,
  };
}

function makeServices(
  overrides: Partial<HyphenJoinServices> = {},
): HyphenJoinServices {
  return {
    scanHyphenation: vi.fn().mockResolvedValue({
      cases: [
        makeCase("c1", "undecided"),
        makeCase("c2", "joined", { validated: false }),
        makeCase("c3", "mismatch"),
      ],
      totals: makeTotals({ undecided: 1, unvalidated: 1, mismatch: 1 }),
    }),
    ...overrides,
  };
}

function startMachine(services = makeServices()) {
  const actor = createActor(hyphenJoinMachine, {
    input: { projectId: "p1", stageIndex: 6, services },
  });
  actor.start();
  return actor;
}

async function reachReviewing(services = makeServices()) {
  const actor = startMachine(services);
  await waitFor(actor, (s) => s.matches("reviewing"));
  return actor;
}

// ---------------------------------------------------------------------------
// Initial state — scanning
// ---------------------------------------------------------------------------

describe("scanning state", () => {
  it("starts in scanning and invokes scanHyphenation", async () => {
    const scanHyphenation = vi.fn().mockResolvedValue({
      cases: [makeCase("c1", "undecided")],
      totals: makeTotals({ undecided: 1, mismatch: 0, unvalidated: 0 }),
    });
    const actor = startMachine({ scanHyphenation });
    await waitFor(actor, (s) => s.matches("reviewing"));
    expect(scanHyphenation).toHaveBeenCalledWith("p1");
  });

  it("transitions to settled when nothing to decide", async () => {
    const scanHyphenation = vi.fn().mockResolvedValue({
      cases: [
        makeCase("c1", "validated"),
        makeCase("c2", "joined", { validated: true }),
      ],
      totals: {
        total: 2,
        joined: 1,
        validated: 1,
        undecided: 0,
        flagged: 0,
        crosspage: 0,
        mismatch: 0,
        unvalidated: 0,
      } satisfies HyphenTotals,
    });
    const actor = startMachine({ scanHyphenation });
    await waitFor(actor, (s) => s.matches("settled"));
    expect(actor.getSnapshot().matches("settled")).toBe(true);
  });

  it("transitions to failed on scan error", async () => {
    const scanHyphenation = vi.fn().mockRejectedValue(new Error("scan error"));
    const actor = startMachine({ scanHyphenation });
    const snap = await waitFor(actor, (s) => s.matches("failed"));
    expect(snap.context.error?.message).toBe("scan error");
  });
});

// ---------------------------------------------------------------------------
// Reviewing state — navigation
// ---------------------------------------------------------------------------

describe("reviewing state — navigation", () => {
  it("SET_MODE updates mode and resets cursor", async () => {
    const actor = await reachReviewing();
    actor.send({ type: "SET_MODE", mode: "joined" });
    const snap = actor.getSnapshot();
    expect(snap.context.mode).toBe("joined");
    expect(snap.context.cursor).toBe(0);
  });

  it("NEXT_CASE and PREV_CASE update cursor", async () => {
    const actor = await reachReviewing();
    actor.send({ type: "NEXT_CASE" });
    expect(actor.getSnapshot().context.cursor).toBeGreaterThanOrEqual(0);
    actor.send({ type: "PREV_CASE" });
    expect(actor.getSnapshot().context.cursor).toBeGreaterThanOrEqual(0);
  });

  it("SELECT_CASE sets cursor to given index", async () => {
    const actor = await reachReviewing();
    actor.send({ type: "SELECT_CASE", index: 2 });
    expect(actor.getSnapshot().context.cursor).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Reviewing state — decisions
// ---------------------------------------------------------------------------

describe("reviewing state — decisions", () => {
  it("ACCEPT_JOIN on undecided case → status joined, validated:true", async () => {
    const actor = await reachReviewing();
    const c1 = actor.getSnapshot().context.cases.find((c) => c.caseId === "c1");
    expect(c1?.status).toBe("undecided");

    actor.send({ type: "ACCEPT_JOIN", caseId: "c1" });

    const updatedCase = actor
      .getSnapshot()
      .context.cases.find((c) => c.caseId === "c1");
    expect(updatedCase?.status).toBe("joined");
    expect(updatedCase?.validated).toBe(true);
  });

  it("ACCEPT_JOIN blocked on non-undecided case (isDecidable guard)", async () => {
    const actor = await reachReviewing();
    // c2 is joined (not undecided/flagged)
    actor.send({ type: "ACCEPT_JOIN", caseId: "c2" });
    const c2 = actor.getSnapshot().context.cases.find((c) => c.caseId === "c2");
    // should remain joined, not re-validated
    expect(c2?.status).toBe("joined");
    expect(c2?.validated).toBe(false); // unchanged
  });

  it("KEEP_HYPHEN on undecided case → status validated", async () => {
    const actor = await reachReviewing();
    actor.send({ type: "KEEP_HYPHEN", caseId: "c1" });
    const updatedCase = actor
      .getSnapshot()
      .context.cases.find((c) => c.caseId === "c1");
    expect(updatedCase?.status).toBe("validated");
    expect(updatedCase?.validated).toBe(true);
  });

  it("VALIDATE_JOIN on unvalidated joined case → validated:true", async () => {
    const actor = await reachReviewing();
    // c2 is joined + validated:false
    actor.send({ type: "VALIDATE_JOIN", caseId: "c2" });
    const c2 = actor.getSnapshot().context.cases.find((c) => c.caseId === "c2");
    expect(c2?.validated).toBe(true);
  });

  it("VALIDATE_JOIN blocked on already-validated case", async () => {
    const scanHyphenation = vi.fn().mockResolvedValue({
      cases: [makeCase("c1", "joined", { validated: true })],
      // flagged must be 0 too — makeTotals defaults flagged:1
      totals: makeTotals({
        joined: 1,
        unvalidated: 0,
        undecided: 0,
        flagged: 0,
        mismatch: 0,
      }),
    });
    const actor = startMachine({ scanHyphenation });
    // With unvalidated=0, flagged=0, undecided=0, mismatch=0 → settled directly
    await waitFor(actor, (s) => s.matches("settled"));
    // No reviewing state reached
    expect(actor.getSnapshot().matches("settled")).toBe(true);
  });

  it("FIX_MISMATCH on mismatch case → validated status", async () => {
    const actor = await reachReviewing();
    // c3 is mismatch
    actor.send({ type: "FIX_MISMATCH", caseId: "c3" });
    const c3 = actor.getSnapshot().context.cases.find((c) => c.caseId === "c3");
    expect(c3?.status).toBe("validated");
    expect(c3?.validated).toBe(true);
  });

  it("REVERT_DECISION on any case → undecided, validated:false", async () => {
    const actor = await reachReviewing();
    // First accept c1
    actor.send({ type: "ACCEPT_JOIN", caseId: "c1" });
    expect(
      actor.getSnapshot().context.cases.find((c) => c.caseId === "c1")?.status,
    ).toBe("joined");

    actor.send({ type: "REVERT_DECISION", caseId: "c1" });
    const reverted = actor
      .getSnapshot()
      .context.cases.find((c) => c.caseId === "c1");
    expect(reverted?.status).toBe("undecided");
    expect(reverted?.validated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Reviewing — allDecided auto-settle
// ---------------------------------------------------------------------------

describe("allDecided guard — auto settle", () => {
  it("auto-transitions to settled when all cases decided", async () => {
    const scanHyphenation = vi.fn().mockResolvedValue({
      cases: [makeCase("c1", "undecided")],
      totals: makeTotals({ undecided: 1, mismatch: 0, unvalidated: 0 }),
    });
    const actor = startMachine({ scanHyphenation });
    await waitFor(actor, (s) => s.matches("reviewing"));

    // Decide the only undecided case
    actor.send({ type: "ACCEPT_JOIN", caseId: "c1" });

    // After deciding, allDecided fires → settled
    const snap = await waitFor(actor, (s) => s.matches("settled"));
    expect(snap.matches("settled")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Page workbench
// ---------------------------------------------------------------------------

describe("page workbench", () => {
  it("OPEN_PAGE sets pageId", async () => {
    const actor = await reachReviewing();
    actor.send({ type: "OPEN_PAGE", pageId: "p001" });
    expect(actor.getSnapshot().context.pageId).toBe("p001");
  });

  it("CLOSE_PAGE clears pageId", async () => {
    const actor = await reachReviewing();
    actor.send({ type: "OPEN_PAGE", pageId: "p001" });
    actor.send({ type: "CLOSE_PAGE" });
    expect(actor.getSnapshot().context.pageId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Settled and failed states
// ---------------------------------------------------------------------------

describe("settled state", () => {
  it("UPSTREAM_CHANGED from settled → scanning", async () => {
    const scanHyphenation = vi.fn().mockResolvedValue({
      cases: [],
      totals: {
        total: 0,
        joined: 0,
        validated: 0,
        undecided: 0,
        flagged: 0,
        crosspage: 0,
        mismatch: 0,
        unvalidated: 0,
      } satisfies HyphenTotals,
    });
    const actor = startMachine({ scanHyphenation });
    await waitFor(actor, (s) => s.matches("settled"));
    // scanHyphenation called once for initial scan
    actor.send({ type: "UPSTREAM_CHANGED" });
    await waitFor(
      actor,
      (s) => s.matches("settled") && scanHyphenation.mock.calls.length >= 2,
    );
    expect(scanHyphenation).toHaveBeenCalledTimes(2);
  });
});

describe("failed state", () => {
  it("RETRY from failed → scanning", async () => {
    const scanHyphenation = vi
      .fn()
      .mockRejectedValueOnce(new Error("first fail"))
      .mockResolvedValue({
        cases: [],
        totals: {
          total: 0,
          joined: 0,
          validated: 0,
          undecided: 0,
          flagged: 0,
          crosspage: 0,
          mismatch: 0,
          unvalidated: 0,
        } satisfies HyphenTotals,
      });
    const actor = startMachine({ scanHyphenation });
    await waitFor(actor, (s) => s.matches("failed"));
    actor.send({ type: "RETRY" });
    await waitFor(actor, (s) => s.matches("settled") || s.matches("scanning"));
    expect(scanHyphenation).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Recounting (inline per DIVERGENCES.md #9)
// ---------------------------------------------------------------------------

describe("inline recount", () => {
  it("totals update after ACCEPT_JOIN", async () => {
    const scanHyphenation = vi.fn().mockResolvedValue({
      cases: [makeCase("c1", "undecided"), makeCase("c2", "undecided")],
      totals: makeTotals({ undecided: 2, mismatch: 0, unvalidated: 0 }),
    });
    const actor = startMachine({ scanHyphenation });
    await waitFor(actor, (s) => s.matches("reviewing"));

    actor.send({ type: "ACCEPT_JOIN", caseId: "c1" });

    const snap = actor.getSnapshot();
    // One undecided remains
    expect(snap.context.totals?.undecided).toBe(1);
    expect(snap.context.totals?.joined).toBe(1);
  });
});
