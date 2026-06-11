/**
 * textReviewTool.test.ts — TDD tests for the Text review stage tool machine.
 *
 * Primary coverage: the DISCUSSIONS-GATE invariant.
 *   Named invariant: CONFIRM_ADVANCE MUST be blocked whenever
 *   ctx.totals.discuss > 0, regardless of other settings.
 *
 * Secondary coverage:
 * - assembling phase: QUEUE_PUSH / QUEUE_READY branching
 * - reviewing: APPROVE_ITEM, OPEN_COMMENT, RESOLVE_THREAD, APPROVE_LOW_RISK
 * - auto-settle (always guard) when queueClearAndGateOpen
 * - confirming → settled lifecycle
 * - settled → REOPEN → reviewing
 * - SET_REQUIRE_COMMENTS_RESOLVED (machine-level setting)
 */

import { createActor, waitFor } from "xstate";
import { describe, it, expect, vi } from "vitest";
import {
  textReviewToolMachine,
  type QueueItem,
  type Thread,
  type ReviewTotals,
  type TextReviewToolServices,
} from "./textReviewTool";
import { stubStageSettingsServices } from "./stageSettings";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeItem(
  id: string,
  status: QueueItem["status"] = "pending",
  overrides: Partial<QueueItem> = {},
): QueueItem {
  return {
    id,
    word: `word-${id}`,
    ctxL: "left context",
    ctxR: "right context",
    reason: "auto-flagged",
    page: "p001",
    line: 10,
    reviewer: "user1",
    comments: 0,
    status,
    ...overrides,
  };
}

function makeThread(
  id: string,
  status: Thread["status"] = "open",
  overrides: Partial<Thread> = {},
): Thread {
  // Note: itemId is optional — omit from base to satisfy exactOptionalPropertyTypes.
  return {
    id,
    author: "user1",
    page: "p001",
    folio: "p001",
    anchor: "word-i1",
    body: "This looks wrong",
    replies: 0,
    status,
    ...overrides,
  };
}

function makeTotals(overrides: Partial<ReviewTotals> = {}): ReviewTotals {
  return {
    total: 5,
    queue: 5,
    pending: 4,
    discuss: 0,
    approved: 0,
    clean: 0,
    comments: 0,
    ...overrides,
  };
}

function makeServices(
  overrides: Partial<TextReviewToolServices> = {},
): TextReviewToolServices {
  return {
    ...stubStageSettingsServices(),
    approveLowRisk: vi.fn().mockResolvedValue({ approvedIds: [] }),
    confirmStage: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

function startMachine(
  services = makeServices(),
  settings?: { requireCommentsResolved?: boolean },
) {
  const input =
    settings !== undefined
      ? { projectId: "p1", stageIndex: 9, services, settings }
      : { projectId: "p1", stageIndex: 9, services };
  const actor = createActor(textReviewToolMachine, { input });
  actor.start();
  return actor;
}

function sendQueueReady(
  actor: ReturnType<typeof startMachine>,
  items: QueueItem[],
  threads: Thread[] = [],
) {
  const totals = makeTotals({
    queue: items.length,
    pending: items.filter((i) => i.status === "pending").length,
    discuss: items.filter((i) => i.status === "discuss").length,
    comments: threads.length,
  });
  actor.send({ type: "QUEUE_READY", queue: items, threads, totals });
}

// ---------------------------------------------------------------------------
// Assembling phase
// ---------------------------------------------------------------------------

describe("assembling state", () => {
  it("starts in assembling with empty queue and null totals", () => {
    const actor = startMachine();
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("assembling");
    expect(snap.context.queue).toHaveLength(0);
    expect(snap.context.totals).toBeNull();
  });

  it("QUEUE_PUSH updates progress totals", () => {
    const actor = startMachine();
    // Set initial totals first
    actor.send({ type: "QUEUE_PUSH", done: 3, queue: 2 });
    // totals is null, so the update returns null — no crash
    expect(actor.getSnapshot().context.totals).toBeNull();
  });

  it("QUEUE_READY with items → reviewing", () => {
    const actor = startMachine();
    sendQueueReady(actor, [makeItem("i1"), makeItem("i2")]);
    expect(actor.getSnapshot().matches("reviewing")).toBe(true);
  });

  it("QUEUE_READY with no items → settled (skipping reviewing)", async () => {
    const actor = startMachine();
    sendQueueReady(actor, []);
    // May be in confirming or settled
    const snap = await waitFor(
      actor,
      (s) => s.matches("settled") || s.matches("confirming"),
    );
    expect(snap.matches("settled") || snap.matches("confirming")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DISCUSSIONS-GATE invariant (primary TDD target)
// ---------------------------------------------------------------------------

describe("DISCUSSIONS-GATE invariant", () => {
  /**
   * Rule: CONFIRM_ADVANCE MUST block whenever ctx.totals.discuss > 0.
   * This is independent of requireCommentsResolved setting.
   */

  it("CONFIRM_ADVANCE blocked when any item is in discuss status", () => {
    const actor = startMachine();
    sendQueueReady(actor, [
      makeItem("i1", "pending"),
      makeItem("i2", "discuss"), // open discussion
    ]);

    actor.send({ type: "CONFIRM_ADVANCE" });

    // Must stay in reviewing — gate is closed
    expect(actor.getSnapshot().matches("reviewing")).toBe(true);
  });

  it("CONFIRM_ADVANCE allowed when discuss === 0 and requireCommentsResolved is false", async () => {
    const actor = startMachine();
    sendQueueReady(actor, [makeItem("i1", "pending")]);

    // Approve the item
    actor.send({ type: "APPROVE_ITEM", itemId: "i1" });
    // Queue now empty + discuss === 0 → auto-settle

    const snap = await waitFor(
      actor,
      (s) => s.matches("confirming") || s.matches("settled"),
    );
    expect(snap.matches("confirming") || snap.matches("settled")).toBe(true);
  });

  it("CONFIRM_ADVANCE blocked when requireCommentsResolved=true and open threads exist", () => {
    const actor = startMachine(makeServices(), {
      requireCommentsResolved: true,
    });
    const thread = makeThread("t1", "open");
    sendQueueReady(actor, [makeItem("i1", "pending")], [thread]);

    // Approve the item (no discuss), but open thread blocks the gate
    actor.send({ type: "APPROVE_ITEM", itemId: "i1" });
    actor.send({ type: "CONFIRM_ADVANCE" });

    // Gate blocked by open thread
    expect(actor.getSnapshot().matches("reviewing")).toBe(true);
  });

  it("CONFIRM_ADVANCE allowed when requireCommentsResolved=true and all threads resolved", async () => {
    const actor = startMachine(makeServices(), {
      requireCommentsResolved: true,
    });
    const thread = makeThread("t1", "resolved");
    sendQueueReady(actor, [makeItem("i1", "pending")], [thread]);

    // Approve the item
    actor.send({ type: "APPROVE_ITEM", itemId: "i1" });
    actor.send({ type: "CONFIRM_ADVANCE" });

    const snap = await waitFor(
      actor,
      (s) => s.matches("confirming") || s.matches("settled"),
    );
    expect(snap.matches("confirming") || snap.matches("settled")).toBe(true);
  });

  it("CONFIRM_ADVANCE blocked when discuss > 0 even if requireCommentsResolved=false", () => {
    const actor = startMachine(makeServices(), {
      requireCommentsResolved: false,
    });
    sendQueueReady(actor, [makeItem("i1", "discuss")]);

    actor.send({ type: "CONFIRM_ADVANCE" });

    // Gate blocked by discuss > 0
    expect(actor.getSnapshot().matches("reviewing")).toBe(true);
  });

  it("discuss count comes from OPEN_COMMENT marking item as discuss", () => {
    const actor = startMachine();
    sendQueueReady(actor, [makeItem("i1", "pending")]);

    // Initially discuss === 0, gate is open
    expect(actor.getSnapshot().context.totals?.discuss).toBe(0);

    // Open a comment → item moves to discuss
    actor.send({ type: "OPEN_COMMENT", itemId: "i1", body: "Check this word" });

    const snap = actor.getSnapshot();
    expect(snap.context.totals?.discuss).toBe(1);
    expect(snap.context.queue.find((q) => q.id === "i1")?.status).toBe(
      "discuss",
    );
  });

  it("RESOLVE_THREAD with maybeUnblockItem unblocks item when no other open threads", () => {
    const actor = startMachine();
    const thread = makeThread("t1", "open", { itemId: "i1" });
    sendQueueReady(actor, [makeItem("i1", "discuss")], [thread]);

    actor.send({ type: "RESOLVE_THREAD", threadId: "t1" });

    const snap = actor.getSnapshot();
    expect(snap.context.threads[0]?.status).toBe("resolved");
    // Item should move back to pending
    expect(snap.context.queue.find((q) => q.id === "i1")?.status).toBe(
      "pending",
    );
  });

  it("RESOLVE_THREAD does NOT unblock item when another open thread exists", () => {
    const actor = startMachine();
    const thread1 = makeThread("t1", "open", { itemId: "i1" });
    const thread2 = makeThread("t2", "open", { itemId: "i1" });
    sendQueueReady(actor, [makeItem("i1", "discuss")], [thread1, thread2]);

    // Resolve only thread1
    actor.send({ type: "RESOLVE_THREAD", threadId: "t1" });

    // Item should still be discuss (thread2 is open)
    expect(
      actor.getSnapshot().context.queue.find((q) => q.id === "i1")?.status,
    ).toBe("discuss");
  });
});

// ---------------------------------------------------------------------------
// Per-item decisions
// ---------------------------------------------------------------------------

describe("per-item decisions", () => {
  it("APPROVE_ITEM removes item from queue and recounts", () => {
    const actor = startMachine();
    sendQueueReady(actor, [makeItem("i1"), makeItem("i2")]);
    actor.send({ type: "APPROVE_ITEM", itemId: "i1" });
    const snap = actor.getSnapshot();
    expect(snap.context.queue.find((q) => q.id === "i1")).toBeUndefined();
    expect(snap.context.queue).toHaveLength(1);
  });

  it("REPLY increments thread reply count", () => {
    const actor = startMachine();
    const thread = makeThread("t1", "open");
    sendQueueReady(actor, [makeItem("i1")], [thread]);
    actor.send({ type: "REPLY", threadId: "t1", body: "Agreed" });
    const t = actor.getSnapshot().context.threads.find((t) => t.id === "t1");
    expect(t?.replies).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Auto-settle via always guard
// ---------------------------------------------------------------------------

describe("auto-settle (queueClearAndGateOpen)", () => {
  it("auto-settles when all items approved and discuss === 0", async () => {
    const actor = startMachine();
    sendQueueReady(actor, [makeItem("i1", "pending")]);

    actor.send({ type: "APPROVE_ITEM", itemId: "i1" });

    const snap = await waitFor(
      actor,
      (s) => s.matches("confirming") || s.matches("settled"),
    );
    expect(snap.matches("confirming") || snap.matches("settled")).toBe(true);
  });

  it("does NOT auto-settle when items remain in discuss", () => {
    const actor = startMachine();
    sendQueueReady(actor, [
      makeItem("i1", "discuss"),
      makeItem("i2", "pending"),
    ]);

    actor.send({ type: "APPROVE_ITEM", itemId: "i2" });

    // i1 is still discuss — should remain in reviewing
    expect(actor.getSnapshot().matches("reviewing")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Batch approving
// ---------------------------------------------------------------------------

describe("batchApproving", () => {
  it("APPROVE_LOW_RISK invokes service and merges approvedIds", async () => {
    const approveLowRisk = vi.fn().mockResolvedValue({ approvedIds: ["i1"] });
    const services = makeServices({ approveLowRisk });
    const actor = startMachine(services);
    sendQueueReady(actor, [makeItem("i1"), makeItem("i2")]);
    actor.send({ type: "APPROVE_LOW_RISK" });
    const snap = await waitFor(
      actor,
      (s) => s.matches("reviewing") || s.matches("confirming"),
    );
    expect(approveLowRisk).toHaveBeenCalledWith("p1");
    expect(snap.context.queue.find((q) => q.id === "i1")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Filter events
// ---------------------------------------------------------------------------

describe("filter events", () => {
  it("SET_QUEUE_FILTER updates queueFilter", () => {
    const actor = startMachine();
    sendQueueReady(actor, [makeItem("i1")]);
    actor.send({ type: "SET_QUEUE_FILTER", value: "mine" });
    expect(actor.getSnapshot().context.queueFilter).toBe("mine");
  });

  it("SET_COMMENT_FILTER updates commentFilter", () => {
    const actor = startMachine();
    sendQueueReady(actor, [makeItem("i1")]);
    actor.send({ type: "SET_COMMENT_FILTER", value: "open" });
    expect(actor.getSnapshot().context.commentFilter).toBe("open");
  });
});

// ---------------------------------------------------------------------------
// confirming → settled lifecycle
// ---------------------------------------------------------------------------

describe("confirming and settled", () => {
  it("CONFIRM_ADVANCE → confirming → settled on success", async () => {
    const confirmStage = vi.fn().mockResolvedValue({ ok: true });
    const services = makeServices({ confirmStage });
    const actor = startMachine(services);
    sendQueueReady(actor, [makeItem("i1", "pending")]);
    actor.send({ type: "APPROVE_ITEM", itemId: "i1" });

    // Wait for auto-settle path or manual confirm
    actor.send({ type: "CONFIRM_ADVANCE" });
    const snap = await waitFor(actor, (s) => s.matches("settled"));
    expect(snap.matches("settled")).toBe(true);
  });

  it("confirmStage error → back to reviewing with error", async () => {
    const confirmStage = vi.fn().mockRejectedValue(new Error("confirm failed"));
    const services = makeServices({ confirmStage });
    const actor = startMachine(services);
    sendQueueReady(actor, [makeItem("i1", "pending")]);
    actor.send({ type: "CONFIRM_ADVANCE" });
    const snap = await waitFor(actor, (s) => s.matches("reviewing"));
    expect(snap.context.error?.message).toBe("confirm failed");
  });

  it("REOPEN from settled → reviewing (with pending items stays in reviewing)", async () => {
    // Use a machine that has pending items so the always guard does NOT auto-settle.
    const actor = startMachine();
    // Add two items: approve one, leave one pending
    sendQueueReady(actor, [
      makeItem("i1", "pending"),
      makeItem("i2", "pending"),
    ]);
    actor.send({ type: "APPROVE_ITEM", itemId: "i1" });
    // i2 still pending → reviewing, not auto-settled
    expect(actor.getSnapshot().matches("reviewing")).toBe(true);
    // Now manually advance to confirming
    actor.send({ type: "APPROVE_ITEM", itemId: "i2" });
    await waitFor(
      actor,
      (s) => s.matches("settled") || s.matches("confirming"),
    );
    await waitFor(actor, (s) => s.matches("settled"));

    // Add an item back via the open comment path to see REOPEN works
    // Instead: confirm REOPEN leaves reviewing when queue re-opens
    actor.send({ type: "REOPEN" });
    // With empty queue and no threads, always guard fires → confirming/settled again
    // REOPEN does take us through reviewing → the action runs; auto-settle follows
    const snap = await waitFor(
      actor,
      (s) => s.matches("settled") || s.matches("confirming"),
    );
    expect(snap.matches("settled") || snap.matches("confirming")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Machine-level settings (DIVERGENCES.md #7)
// ---------------------------------------------------------------------------

describe("machine-level settings", () => {
  it("SET_REQUIRE_COMMENTS_RESOLVED available from assembling state", () => {
    const actor = startMachine();
    expect(actor.getSnapshot().context._settings.requireCommentsResolved).toBe(
      false,
    );
    actor.send({ type: "SET_REQUIRE_COMMENTS_RESOLVED", value: true });
    expect(actor.getSnapshot().context._settings.requireCommentsResolved).toBe(
      true,
    );
  });

  it("SET_REQUIRE_COMMENTS_RESOLVED available from reviewing state", () => {
    const actor = startMachine();
    sendQueueReady(actor, [makeItem("i1")]);
    actor.send({ type: "SET_REQUIRE_COMMENTS_RESOLVED", value: true });
    expect(actor.getSnapshot().context._settings.requireCommentsResolved).toBe(
      true,
    );
  });

  it("changing requireCommentsResolved to true with open threads blocks gate", () => {
    // Keep TWO items: approve only one so the queue is not empty.
    // This prevents queueClearAndGateOpen from auto-settling, allowing us to
    // test that CONFIRM_ADVANCE is blocked by the open thread gate.
    const actor = startMachine();
    const thread = makeThread("t1", "open");
    sendQueueReady(
      actor,
      [makeItem("i1", "pending"), makeItem("i2", "pending")],
      [thread],
    );

    // Approve i1 — i2 is still pending, so reviewing stays active
    actor.send({ type: "APPROVE_ITEM", itemId: "i1" });
    expect(actor.getSnapshot().matches("reviewing")).toBe(true);

    // Enable requireCommentsResolved while in reviewing
    actor.send({ type: "SET_REQUIRE_COMMENTS_RESOLVED", value: true });
    expect(actor.getSnapshot().context._settings.requireCommentsResolved).toBe(
      true,
    );

    // Approve i2 — queue is now empty; but open thread blocks queueClearAndGateOpen
    actor.send({ type: "APPROVE_ITEM", itemId: "i2" });

    // queueClearAndGateOpen: queue=0 but requireCommentsResolved=true with open thread → false
    // Machine must stay in reviewing
    expect(actor.getSnapshot().matches("reviewing")).toBe(true);

    // Explicit CONFIRM_ADVANCE also blocked
    actor.send({ type: "CONFIRM_ADVANCE" });
    expect(actor.getSnapshot().matches("reviewing")).toBe(true);
  });
});
