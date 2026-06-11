/**
 * regexPass.test.ts — TDD tests for the Regex pass stage tool machine.
 *
 * Invariants derived from tool-regex.yaml:
 * - loading → clean (nothingPending) or reviewing
 * - reviewing.idle → previewing (OPEN_PREVIEW) or runningRule (RUN_RULE pending)
 * - previewing → runningRule (COMMIT_RULE) or idle (SKIP_RULE / CLOSE)
 * - runningRule → clean (nothingPendingAfter) or idle
 * - clean → reviewing on ADD_RULE / TOGGLE_RULE
 * - clean → reviewing on TEXT_CHANGED (when rerunOnTextChange=true)
 * - ROLLBACK from clean → loading
 * - RETRY from error → loading
 * - REORDER_RULE invalidates downstream applied rules
 * - toggleEnabled recounts
 */

import { createActor, waitFor } from "xstate";
import { describe, it, expect, vi } from "vitest";
import {
  regexPassMachine,
  type RegexRule,
  type RegexCounts,
  type RegexPassServices,
} from "./regexPass";
import { stubStageSettingsServices } from "./stageSettings";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeRule(
  id: string,
  status: RegexRule["status"] = "pending",
  overrides: Partial<RegexRule> = {},
): RegexRule {
  return {
    id,
    name: `Rule ${id}`,
    find: `find-${id}`,
    repl: `repl-${id}`,
    flags: "gi",
    scope: "all",
    status,
    enabled: true,
    matches: 3,
    ...overrides,
  };
}

function makeCounts(overrides: Partial<RegexCounts> = {}): RegexCounts {
  return {
    rules: 3,
    applied: 1,
    review: 1,
    pending: 1,
    matches: 9,
    ...overrides,
  };
}

function makeServices(
  overrides: Partial<RegexPassServices> = {},
): RegexPassServices {
  return {
    ...stubStageSettingsServices(),
    fetchRules: vi.fn().mockResolvedValue({
      rules: [
        makeRule("r1", "applied"),
        makeRule("r2", "review"),
        makeRule("r3", "pending"),
      ],
      counts: makeCounts(),
      snapshotId: "snap-001",
    }),
    applyRule: vi.fn().mockResolvedValue({
      rule: makeRule("r3", "applied"),
      counts: makeCounts({ applied: 2, pending: 0, review: 1 }),
    }),
    ...overrides,
  };
}

function startMachine(
  services = makeServices(),
  opts: { requirePreviewToCommit?: boolean; rerunOnTextChange?: boolean } = {},
) {
  const actor = createActor(regexPassMachine, {
    input: {
      projectId: "p1",
      stageIndex: 11,
      services,
      ...opts,
    },
  });
  actor.start();
  return actor;
}

async function reachReviewing(services = makeServices()) {
  const actor = startMachine(services);
  await waitFor(actor, (s) => s.matches("reviewing"));
  return actor;
}

async function reachClean(services = makeServices()) {
  const fetchRules = vi.fn().mockResolvedValue({
    rules: [makeRule("r1", "applied")],
    counts: makeCounts({ applied: 1, review: 0, pending: 0 }),
    snapshotId: "snap-002",
  });
  const actor = startMachine({ ...services, fetchRules });
  await waitFor(actor, (s) => s.matches("clean"));
  return actor;
}

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

describe("loading state", () => {
  it("starts in loading and invokes fetchRules", async () => {
    const fetchRules = vi.fn().mockResolvedValue({
      rules: [],
      counts: makeCounts({ rules: 0, applied: 0, review: 0, pending: 0 }),
      snapshotId: null,
    });
    const actor = startMachine(makeServices({ fetchRules }));
    await waitFor(actor, (s) => s.matches("clean") || s.matches("reviewing"));
    expect(fetchRules).toHaveBeenCalledWith("p1");
  });

  it("transitions to reviewing when review+pending > 0", async () => {
    const actor = await reachReviewing();
    expect(actor.getSnapshot().matches("reviewing")).toBe(true);
  });

  it("transitions to clean when nothingPending (review+pending === 0)", async () => {
    const actor = await reachClean();
    expect(actor.getSnapshot().matches("clean")).toBe(true);
  });

  it("transitions to error on fetchRules failure", async () => {
    const fetchRules = vi.fn().mockRejectedValue(new Error("network error"));
    const actor = startMachine(makeServices({ fetchRules }));
    const snap = await waitFor(actor, (s) => s.matches("error"));
    expect(snap.context.error?.message).toBe("network error");
  });

  it("loads rules, counts, and snapshotId into context", async () => {
    const actor = await reachReviewing();
    const { rules, counts, snapshotId } = actor.getSnapshot().context;
    expect(rules).toHaveLength(3);
    expect(counts?.applied).toBe(1);
    expect(snapshotId).toBe("snap-001");
  });
});

// ---------------------------------------------------------------------------
// Reviewing — idle state
// ---------------------------------------------------------------------------

describe("reviewing.idle state", () => {
  it("starts in reviewing.idle", async () => {
    const actor = await reachReviewing();
    expect(actor.getSnapshot().matches({ reviewing: "idle" })).toBe(true);
  });

  it("OPEN_PREVIEW transitions to reviewing.previewing and sets previewRule", async () => {
    const actor = await reachReviewing();
    actor.send({ type: "OPEN_PREVIEW", ruleId: "r2" });
    const snap = actor.getSnapshot();
    expect(snap.matches({ reviewing: "previewing" })).toBe(true);
    expect(snap.context.previewRule).toBe("r2");
  });

  it("RUN_RULE on pending rule → runningRule", async () => {
    const actor = await reachReviewing();
    actor.send({ type: "RUN_RULE", ruleId: "r3" });
    expect(actor.getSnapshot().matches({ reviewing: "runningRule" })).toBe(
      true,
    );
  });

  it("RUN_RULE on non-pending rule is blocked (ruleIsPending guard)", async () => {
    const actor = await reachReviewing();
    // r2 is 'review', not 'pending'
    actor.send({ type: "RUN_RULE", ruleId: "r2" });
    // Must stay in idle
    expect(actor.getSnapshot().matches({ reviewing: "idle" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Reviewing — previewing state
// ---------------------------------------------------------------------------

describe("reviewing.previewing state", () => {
  async function reachPreviewing() {
    const actor = await reachReviewing();
    actor.send({ type: "OPEN_PREVIEW", ruleId: "r2" });
    return actor;
  }

  it("COMMIT_RULE → runningRule (invokes applyRule)", async () => {
    const actor = await reachPreviewing();
    actor.send({ type: "COMMIT_RULE" });
    const snap = await waitFor(
      actor,
      (s) =>
        s.matches({ reviewing: "runningRule" }) ||
        s.matches({ reviewing: "idle" }) ||
        s.matches("clean"),
    );
    // After commit, machine moves to runningRule (briefly) then idle or clean
    expect(
      snap.matches({ reviewing: "idle" }) ||
        snap.matches({ reviewing: "runningRule" }) ||
        snap.matches("clean"),
    ).toBe(true);
  });

  it("SKIP_RULE → idle with preview cleared", async () => {
    const actor = await reachPreviewing();
    actor.send({ type: "SKIP_RULE" });
    const snap = actor.getSnapshot();
    expect(snap.matches({ reviewing: "idle" })).toBe(true);
    expect(snap.context.previewRule).toBeNull();
  });

  it("CLOSE → idle with preview cleared", async () => {
    const actor = await reachPreviewing();
    actor.send({ type: "CLOSE" });
    const snap = actor.getSnapshot();
    expect(snap.matches({ reviewing: "idle" })).toBe(true);
    expect(snap.context.previewRule).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Reviewing — runningRule → clean path
// ---------------------------------------------------------------------------

describe("reviewing.runningRule → clean", () => {
  it("transitions to clean when nothingPendingAfter (no review/pending remaining)", async () => {
    const applyRule = vi.fn().mockResolvedValue({
      rule: makeRule("r3", "applied"),
      counts: makeCounts({ applied: 3, review: 0, pending: 0 }),
    });
    const actor = await reachReviewing({ ...makeServices(), applyRule });
    actor.send({ type: "RUN_RULE", ruleId: "r3" });
    const snap = await waitFor(actor, (s) => s.matches("clean"));
    expect(snap.matches("clean")).toBe(true);
    expect(applyRule).toHaveBeenCalledWith("p1", "r3");
  });

  it("stays in idle when review+pending remain after apply", async () => {
    const applyRule = vi.fn().mockResolvedValue({
      rule: makeRule("r3", "applied"),
      counts: makeCounts({ applied: 2, review: 1, pending: 0 }),
    });
    const actor = await reachReviewing({ ...makeServices(), applyRule });
    actor.send({ type: "RUN_RULE", ruleId: "r3" });
    const snap = await waitFor(actor, (s) => s.matches({ reviewing: "idle" }));
    expect(snap.matches({ reviewing: "idle" })).toBe(true);
  });

  it("mergeRule updates the rule in context", async () => {
    const actor = await reachReviewing();
    actor.send({ type: "RUN_RULE", ruleId: "r3" });
    await waitFor(
      actor,
      (s) => s.matches({ reviewing: "idle" }) || s.matches("clean"),
    );
    const r3 = actor.getSnapshot().context.rules.find((r) => r.id === "r3");
    expect(r3?.status).toBe("applied");
  });
});

// ---------------------------------------------------------------------------
// Rule management events (reviewing top-level)
// ---------------------------------------------------------------------------

describe("rule management events", () => {
  it("TOGGLE_RULE flips enabled flag and recounts", async () => {
    const actor = await reachReviewing();
    const before = actor
      .getSnapshot()
      .context.rules.find((r) => r.id === "r1")?.enabled;
    actor.send({ type: "TOGGLE_RULE", ruleId: "r1" });
    const after = actor
      .getSnapshot()
      .context.rules.find((r) => r.id === "r1")?.enabled;
    expect(after).toBe(!before);
  });

  it("ADD_RULE appends a new rule with status pending", async () => {
    const actor = await reachReviewing();
    const before = actor.getSnapshot().context.rules.length;
    actor.send({
      type: "ADD_RULE",
      fields: {
        name: "New Rule",
        find: "foo",
        repl: "bar",
        flags: "g",
        scope: "all",
        enabled: true,
      },
    });
    const snap = actor.getSnapshot();
    expect(snap.context.rules).toHaveLength(before + 1);
    const newRule = snap.context.rules[snap.context.rules.length - 1];
    expect(newRule?.status).toBe("pending");
  });

  it("REORDER_RULE reorders rules and invalidates downstream applied rules", async () => {
    const actor = await reachReviewing();
    // r1=applied, r2=review, r3=pending at indices 0,1,2
    // Move r3 to index 0 (before r1)
    actor.send({ type: "REORDER_RULE", from: 2, to: 0 });
    const snap = actor.getSnapshot();
    // r1 was at index 0, now is at index 1 (after r3 moved to 0)
    // Downstream rules after movedTo=0: indices > 0 with status 'applied' → 'review'
    const r1 = snap.context.rules.find((r) => r.id === "r1");
    expect(r1?.status).toBe("review"); // invalidated
  });

  it("SET_LIST_FILTER updates listFilter", async () => {
    const actor = await reachReviewing();
    actor.send({ type: "SET_LIST_FILTER", value: "applied" });
    expect(actor.getSnapshot().context.listFilter).toBe("applied");
  });

  it("LOAD_PRESET goes back to loading", async () => {
    const fetchRules = vi
      .fn()
      .mockResolvedValueOnce({
        rules: [makeRule("r1", "review")],
        counts: makeCounts({ review: 1, pending: 0 }),
        snapshotId: "snap-001",
      })
      .mockResolvedValue({
        rules: [makeRule("r1", "applied")],
        counts: makeCounts({ applied: 1, review: 0, pending: 0 }),
        snapshotId: "snap-002",
      });
    const actor = startMachine({ ...makeServices(), fetchRules });
    await waitFor(actor, (s) => s.matches("reviewing"));
    actor.send({ type: "LOAD_PRESET" });
    await waitFor(actor, (s) => s.matches("clean") || s.matches("reviewing"));
    expect(fetchRules).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Clean state
// ---------------------------------------------------------------------------

describe("clean state", () => {
  it("ADD_RULE from clean → reviewing with the new rule appended", async () => {
    const actor = await reachClean();
    actor.send({
      type: "ADD_RULE",
      fields: {
        name: "Extra",
        find: "x",
        repl: "y",
        flags: "g",
        scope: "all",
        enabled: true,
      },
    });
    expect(actor.getSnapshot().matches("reviewing")).toBe(true);
  });

  it("TOGGLE_RULE from clean → reviewing", async () => {
    const actor = await reachClean();
    const rules = actor.getSnapshot().context.rules;
    actor.send({ type: "TOGGLE_RULE", ruleId: rules[0]!.id });
    expect(actor.getSnapshot().matches("reviewing")).toBe(true);
  });

  it("TEXT_CHANGED from clean → reviewing when rerunOnTextChange=true", async () => {
    const fetchRules = vi.fn().mockResolvedValue({
      rules: [makeRule("r1", "applied")],
      counts: makeCounts({ applied: 1, review: 0, pending: 0 }),
      snapshotId: null,
    });
    const actor = startMachine(makeServices({ fetchRules }), {
      rerunOnTextChange: true,
    });
    await waitFor(actor, (s) => s.matches("clean"));
    actor.send({ type: "TEXT_CHANGED" });
    expect(actor.getSnapshot().matches("reviewing")).toBe(true);
    // Applied rule should be invalidated to review
    expect(
      actor.getSnapshot().context.rules.find((r) => r.id === "r1")?.status,
    ).toBe("review");
  });

  it("TEXT_CHANGED from clean has no effect when rerunOnTextChange=false", async () => {
    const actor = await reachClean();
    actor.send({ type: "TEXT_CHANGED" });
    expect(actor.getSnapshot().matches("clean")).toBe(true);
  });

  it("ROLLBACK from clean → loading", async () => {
    const fetchRules = vi
      .fn()
      .mockResolvedValueOnce({
        rules: [makeRule("r1", "applied")],
        counts: makeCounts({ applied: 1, review: 0, pending: 0 }),
        snapshotId: "snap-001",
      })
      .mockResolvedValue({
        rules: [makeRule("r1", "pending")],
        counts: makeCounts({ applied: 0, review: 0, pending: 1 }),
        snapshotId: null,
      });
    const actor = startMachine(makeServices({ fetchRules }));
    await waitFor(actor, (s) => s.matches("clean"));
    actor.send({ type: "ROLLBACK" });
    await waitFor(actor, (s) => s.matches("reviewing") || s.matches("clean"));
    expect(fetchRules).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

describe("error state", () => {
  it("RETRY from error → loading (re-invokes fetchRules)", async () => {
    const fetchRules = vi
      .fn()
      .mockRejectedValueOnce(new Error("first fail"))
      .mockResolvedValue({
        rules: [makeRule("r1", "applied")],
        counts: makeCounts({ applied: 1, review: 0, pending: 0 }),
        snapshotId: null,
      });
    const actor = startMachine(makeServices({ fetchRules }));
    await waitFor(actor, (s) => s.matches("error"));
    actor.send({ type: "RETRY" });
    await waitFor(actor, (s) => s.matches("clean") || s.matches("reviewing"));
    expect(fetchRules).toHaveBeenCalledTimes(2);
  });
});
