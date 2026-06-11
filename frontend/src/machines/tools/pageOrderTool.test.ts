/**
 * pageOrderTool.test.ts — invariant tests for the pageOrderTool machine.
 *
 * TDD invariants from tool-page-order.yaml:
 *
 * Suite 1 (W5.5) "loading lifecycle" — loading → workspace via fetchFolios invoke
 *   (FOLIOS_DONE still works as test-injection bypass for enterWorkspace helpers)
 * Suite 2 "ledger: drag-reorder" — DRAG_START → reordering → DROP → browsing
 * Suite 3 "ledger: role / run assignment" — SET_ROLE, SET_RUN + persistLeaf
 * Suite 4 "ledger: lens + view filters" — SET_LENS, SET_VIEW
 * Suite 5 "inspector: open/close" — SELECT_LEAF → LEAF_SELECTED → open → CLOSE
 * Suite 6 "runs: add / edit / remove" — ADD_RUN → CONFIRM_ADD; EDIT_RUN → DONE
 * Suite 7 "naming" — SET_NAME_PART patches naming context
 * Suite 8 "confirm advance" — sequenceClean guard + confirming → settled
 *   + W5.7: MANIFEST_PUSH accepted in settled (post-confirm manifest refetch)
 * Suite 9 "UPSTREAM_CHANGED resets to loading" from settled (W5.5)
 */

import { describe, it, expect, vi } from "vitest";
import { createActor } from "xstate";
import {
  pageOrderToolMachine,
  type PageOrderToolInput,
  type PageOrderToolServices,
  type Leaf,
  type Run,
} from "./pageOrderTool";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLeaf(overrides: Partial<Leaf> = {}): Leaf {
  return {
    scan: 1,
    role: "text",
    runId: "body",
    folioLabel: null,
    ocrFolio: null,
    flags: [],
    ...overrides,
  };
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "body",
    label: "Body",
    style: "arabic",
    start: { mode: "set", value: 1 },
    step: 1,
    span: [1, 10],
    ...overrides,
  };
}

function makeServices(
  overrides: Partial<PageOrderToolServices> = {},
): PageOrderToolServices {
  return {
    // W5.5: fetchFolios is now required — default mock returns 2 leaves
    fetchFolios: vi.fn().mockResolvedValue({
      leaves: [makeLeaf({ scan: 1 }), makeLeaf({ scan: 2, ocrFolio: "2" })],
      runs: [makeRun()],
      totals: { total: 2, scanned: 2, outOfSeq: 0, gaps: 0, duplicates: 0 },
    }),
    persistLeaf: vi.fn().mockResolvedValue(undefined),
    persistOrder: vi.fn().mockResolvedValue(undefined),
    persistRuns: vi.fn().mockResolvedValue(undefined),
    persistNaming: vi.fn().mockResolvedValue(undefined),
    confirmStage: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<PageOrderToolInput> = {},
): PageOrderToolInput {
  return {
    projectId: "proj-1",
    stageIndex: 9,
    services: makeServices(),
    ...overrides,
  };
}

async function waitForState(
  actor: ReturnType<typeof createActor<typeof pageOrderToolMachine>>,
  predicate: (snapshot: ReturnType<typeof actor.getSnapshot>) => boolean,
  maxMs = 500,
): Promise<ReturnType<typeof actor.getSnapshot>> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + maxMs;
    const check = () => {
      const snap = actor.getSnapshot();
      if (predicate(snap)) {
        resolve(snap);
        return;
      }
      if (Date.now() > deadline) {
        reject(
          new Error(
            `timeout waiting for state — current: ${JSON.stringify(snap.value)}`,
          ),
        );
        return;
      }
      setTimeout(check, 10);
    };
    check();
  });
}

// ---------------------------------------------------------------------------
// Suite 1 (W5.5): loading lifecycle — fetchFolios invoke replaces streaming
// ---------------------------------------------------------------------------

describe("pageOrderTool — loading lifecycle (W5.5)", () => {
  it("starts in loading state (was readingFolios)", () => {
    const actor = createActor(pageOrderToolMachine, { input: makeInput() });
    actor.start();
    expect(actor.getSnapshot().matches("loading")).toBe(true);
    actor.stop();
  });

  it("fetchFolios resolve transitions to workspace", async () => {
    const actor = createActor(pageOrderToolMachine, { input: makeInput() });
    actor.start();
    await waitForState(actor, (s) => s.matches("workspace"));
    const snap = actor.getSnapshot();
    expect(snap.matches("workspace")).toBe(true);
    expect(snap.context.leaves).toHaveLength(2);
    actor.stop();
  });

  it("fetchFolios rejection transitions to loadError", async () => {
    const services = makeServices({
      fetchFolios: vi.fn().mockRejectedValue(new Error("network error")),
    });
    const actor = createActor(pageOrderToolMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("loadError"));
    expect(actor.getSnapshot().matches("loadError")).toBe(true);
    actor.stop();
  });

  it("UPSTREAM_CHANGED from loadError retries (back to loading)", async () => {
    const services = makeServices({
      fetchFolios: vi.fn().mockRejectedValue(new Error("fail")),
    });
    const actor = createActor(pageOrderToolMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("loadError"));
    actor.send({ type: "UPSTREAM_CHANGED" });
    expect(actor.getSnapshot().matches("loading")).toBe(true);
    actor.stop();
  });

  it("FOLIOS_DONE bypass still works in loading state (test injection)", () => {
    // Keep backward compat: FOLIOS_DONE can still bypass the invoke for tests
    const actor = createActor(pageOrderToolMachine, { input: makeInput() });
    actor.start();
    const leaves = [makeLeaf({ scan: 1, ocrFolio: "1" })];
    const runs = [makeRun()];
    actor.send({
      type: "FOLIOS_DONE",
      leaves,
      runs,
      totals: { total: 1, scanned: 1, outOfSeq: 0, gaps: 0, duplicates: 0 },
    });
    const snap = actor.getSnapshot();
    expect(snap.matches("workspace")).toBe(true);
    expect(snap.context.leaves).toHaveLength(1);
    expect(snap.context.runs).toHaveLength(1);
    actor.stop();
  });

  it("FOLIO_PUSH accumulates partial leaves in loading state (legacy)", () => {
    const actor = createActor(pageOrderToolMachine, { input: makeInput() });
    actor.start();
    actor.send({ type: "FOLIO_PUSH", scan: 1, ocrFolio: "1" });
    const snap = actor.getSnapshot();
    expect(snap.context.partialLeaves).toHaveLength(1);
    expect(snap.context.partialLeaves[0]!.ocrFolio).toBe("1");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 2: ledger drag-reorder
// ---------------------------------------------------------------------------

describe("pageOrderTool — ledger drag-reorder", () => {
  function enterWorkspace() {
    const actor = createActor(pageOrderToolMachine, { input: makeInput() });
    actor.start();
    const leaves = [
      makeLeaf({ scan: 1 }),
      makeLeaf({ scan: 2, ocrFolio: "2" }),
    ];
    const runs = [makeRun()];
    actor.send({
      type: "FOLIOS_DONE",
      leaves,
      runs,
      totals: { total: 2, scanned: 2, outOfSeq: 0, gaps: 0, duplicates: 0 },
    });
    return actor;
  }

  it("DRAG_START transitions ledger to reordering", () => {
    const actor = enterWorkspace();
    actor.send({ type: "DRAG_START", scan: 1 });
    expect(
      actor.getSnapshot().matches({ workspace: { ledger: "reordering" } }),
    ).toBe(true);
    actor.stop();
  });

  it("DRAG_CANCEL returns to browsing", () => {
    const actor = enterWorkspace();
    actor.send({ type: "DRAG_START", scan: 1 });
    actor.send({ type: "DRAG_CANCEL" });
    expect(
      actor.getSnapshot().matches({ workspace: { ledger: "browsing" } }),
    ).toBe(true);
    actor.stop();
  });

  it("DROP updates leaf order and persists", () => {
    const services = makeServices();
    const actor = createActor(pageOrderToolMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    const leaves = [
      makeLeaf({ scan: 1 }),
      makeLeaf({ scan: 2 }),
      makeLeaf({ scan: 3 }),
    ];
    actor.send({
      type: "FOLIOS_DONE",
      leaves,
      runs: [makeRun()],
      totals: { total: 3, scanned: 3, outOfSeq: 0, gaps: 0, duplicates: 0 },
    });
    actor.send({ type: "DRAG_START", scan: 1 });
    actor.send({ type: "DRAG_OVER", scan: 3, after: true });
    actor.send({ type: "DROP", scan: 1 });
    const snap = actor.getSnapshot();
    expect(snap.matches({ workspace: { ledger: "browsing" } })).toBe(true);
    expect(services.persistOrder).toHaveBeenCalledOnce();
    actor.stop();
  });

  it("DROP action list includes emitOrderChanged stub (YAML coverage)", () => {
    // The YAML spec lists emitOrderChanged in the DROP actions. This test
    // confirms the machine does not throw or reject when DROP fires (the
    // emitOrderChanged no-op must be registered in the actions setup block).
    const services = makeServices();
    const actor = createActor(pageOrderToolMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    const leaves = [makeLeaf({ scan: 1 }), makeLeaf({ scan: 2 })];
    actor.send({
      type: "FOLIOS_DONE",
      leaves,
      runs: [makeRun()],
      totals: { total: 2, scanned: 2, outOfSeq: 0, gaps: 0, duplicates: 0 },
    });
    actor.send({ type: "DRAG_START", scan: 1 });
    actor.send({ type: "DRAG_OVER", scan: 2, after: true });
    // If emitOrderChanged is absent from the setup actions block, XState v5
    // warns / errors. This assertion verifies the machine remains in a valid
    // browsing state, meaning the action ran without crashing.
    expect(() => actor.send({ type: "DROP", scan: 1 })).not.toThrow();
    expect(
      actor.getSnapshot().matches({ workspace: { ledger: "browsing" } }),
    ).toBe(true);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 3: role / run assignment
// ---------------------------------------------------------------------------

describe("pageOrderTool — role and run assignment", () => {
  function enterWorkspace(services?: PageOrderToolServices) {
    const svc = services ?? makeServices();
    const actor = createActor(pageOrderToolMachine, {
      input: makeInput({ services: svc }),
    });
    actor.start();
    actor.send({
      type: "FOLIOS_DONE",
      leaves: [makeLeaf({ scan: 1 })],
      runs: [makeRun()],
      totals: { total: 1, scanned: 1, outOfSeq: 0, gaps: 0, duplicates: 0 },
    });
    return actor;
  }

  it("SET_ROLE patches leaf role and calls persistLeaf", () => {
    const services = makeServices();
    const actor = enterWorkspace(services);
    actor.send({ type: "SET_ROLE", scan: 1, role: "plate" });
    expect(actor.getSnapshot().context.leaves[0]!.role).toBe("plate");
    expect(services.persistLeaf).toHaveBeenCalledOnce();
    actor.stop();
  });

  it("SET_RUN patches leaf runId and calls persistLeaf", () => {
    const services = makeServices();
    const actor = enterWorkspace(services);
    actor.send({
      type: "SET_RUN",
      scan: 1,
      runId: "appendix",
    });
    expect(actor.getSnapshot().context.leaves[0]!.runId).toBe("appendix");
    expect(services.persistLeaf).toHaveBeenCalledOnce();
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 4: lens and view filters
// ---------------------------------------------------------------------------

describe("pageOrderTool — lens and view", () => {
  function enterWorkspace() {
    const actor = createActor(pageOrderToolMachine, { input: makeInput() });
    actor.start();
    actor.send({
      type: "FOLIOS_DONE",
      leaves: [makeLeaf()],
      runs: [makeRun()],
      totals: { total: 1, scanned: 1, outOfSeq: 0, gaps: 0, duplicates: 0 },
    });
    return actor;
  }

  it("SET_LENS updates context.lens", () => {
    const actor = enterWorkspace();
    actor.send({ type: "SET_LENS", value: "outOfSequence" });
    expect(actor.getSnapshot().context.lens).toBe("outOfSequence");
    actor.stop();
  });

  it("SET_VIEW updates context.view", () => {
    const actor = enterWorkspace();
    actor.send({ type: "SET_VIEW", value: "grid" });
    expect(actor.getSnapshot().context.view).toBe("grid");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 5: inspector open/close
// ---------------------------------------------------------------------------

describe("pageOrderTool — inspector", () => {
  function enterWorkspace() {
    const actor = createActor(pageOrderToolMachine, { input: makeInput() });
    actor.start();
    actor.send({
      type: "FOLIOS_DONE",
      leaves: [makeLeaf({ scan: 1 })],
      runs: [makeRun()],
      totals: { total: 1, scanned: 1, outOfSeq: 0, gaps: 0, duplicates: 0 },
    });
    return actor;
  }

  it("SELECT_LEAF opens the inspector", () => {
    const actor = enterWorkspace();
    actor.send({ type: "SELECT_LEAF", scan: 1 });
    expect(
      actor.getSnapshot().matches({ workspace: { inspector: "open" } }),
    ).toBe(true);
    expect(actor.getSnapshot().context.selectedLeaf).toBe(1);
    actor.stop();
  });

  it("CLOSE_INSPECTOR returns to closed", () => {
    const actor = enterWorkspace();
    actor.send({ type: "SELECT_LEAF", scan: 1 });
    actor.send({ type: "CLOSE_INSPECTOR" });
    expect(
      actor.getSnapshot().matches({ workspace: { inspector: "closed" } }),
    ).toBe(true);
    expect(actor.getSnapshot().context.selectedLeaf).toBeNull();
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 6: runs add / edit / remove
// ---------------------------------------------------------------------------

describe("pageOrderTool — runs region", () => {
  function enterWorkspace() {
    const actor = createActor(pageOrderToolMachine, { input: makeInput() });
    actor.start();
    actor.send({
      type: "FOLIOS_DONE",
      leaves: [makeLeaf()],
      runs: [makeRun({ id: "body", span: [1, 5] })],
      totals: { total: 1, scanned: 1, outOfSeq: 0, gaps: 0, duplicates: 0 },
    });
    return actor;
  }

  it("ADD_RUN transitions to adding state", () => {
    const actor = enterWorkspace();
    actor.send({ type: "ADD_RUN" });
    expect(actor.getSnapshot().matches({ workspace: { runs: "adding" } })).toBe(
      true,
    );
    actor.stop();
  });

  it("CONFIRM_ADD inserts run and returns to idle", () => {
    const actor = enterWorkspace();
    actor.send({ type: "ADD_RUN" });
    const newRun: Run = makeRun({
      id: "front",
      label: "Front matter",
      style: "roman",
      span: [0, 1],
    });
    actor.send({ type: "CONFIRM_ADD", run: newRun });
    const snap = actor.getSnapshot();
    expect(snap.matches({ workspace: { runs: "idle" } })).toBe(true);
    expect(snap.context.runs.some((r) => r.id === "front")).toBe(true);
    actor.stop();
  });

  it("CANCEL from adding returns to idle", () => {
    const actor = enterWorkspace();
    actor.send({ type: "ADD_RUN" });
    actor.send({ type: "CANCEL" });
    expect(actor.getSnapshot().matches({ workspace: { runs: "idle" } })).toBe(
      true,
    );
    actor.stop();
  });

  it("EDIT_RUN transitions to editing with runEdit set", () => {
    const actor = enterWorkspace();
    actor.send({ type: "EDIT_RUN", runId: "body" });
    expect(
      actor.getSnapshot().matches({ workspace: { runs: "editing" } }),
    ).toBe(true);
    expect(actor.getSnapshot().context.runEdit).toBe("body");
    actor.stop();
  });

  it("DONE from editing persists and returns to idle", () => {
    const services = makeServices();
    const actor = createActor(pageOrderToolMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    actor.send({
      type: "FOLIOS_DONE",
      leaves: [makeLeaf()],
      runs: [makeRun()],
      totals: { total: 1, scanned: 1, outOfSeq: 0, gaps: 0, duplicates: 0 },
    });
    actor.send({ type: "EDIT_RUN", runId: "body" });
    actor.send({ type: "DONE" });
    expect(actor.getSnapshot().matches({ workspace: { runs: "idle" } })).toBe(
      true,
    );
    expect(services.persistRuns).toHaveBeenCalledOnce();
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 7: naming
// ---------------------------------------------------------------------------

describe("pageOrderTool — naming", () => {
  it("SET_NAME_PART patches naming context and persists", () => {
    const services = makeServices();
    const actor = createActor(pageOrderToolMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    actor.send({
      type: "FOLIOS_DONE",
      leaves: [makeLeaf()],
      runs: [makeRun()],
      totals: { total: 1, scanned: 1, outOfSeq: 0, gaps: 0, duplicates: 0 },
    });
    actor.send({
      type: "SET_NAME_PART",
      patch: { digits: 4 },
    });
    const snap = actor.getSnapshot();
    expect(snap.context.naming?.digits).toBe(4);
    expect(services.persistNaming).toHaveBeenCalledOnce();
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 8: confirm advance / sequenceClean guard
// ---------------------------------------------------------------------------

describe("pageOrderTool — confirm advance", () => {
  it("CONFIRM_ADVANCE blocked when sequence not clean", () => {
    const actor = createActor(pageOrderToolMachine, { input: makeInput() });
    actor.start();
    actor.send({
      type: "FOLIOS_DONE",
      leaves: [makeLeaf()],
      runs: [makeRun()],
      totals: { total: 1, scanned: 1, outOfSeq: 1, gaps: 0, duplicates: 0 },
    });
    actor.send({ type: "CONFIRM_ADVANCE" });
    // Should still be in workspace (guard blocks)
    expect(actor.getSnapshot().matches("workspace")).toBe(true);
    actor.stop();
  });

  it("CONFIRM_ADVANCE proceeds to confirming when sequence is clean", async () => {
    const services = makeServices();
    const actor = createActor(pageOrderToolMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    actor.send({
      type: "FOLIOS_DONE",
      leaves: [makeLeaf()],
      runs: [makeRun()],
      totals: { total: 1, scanned: 1, outOfSeq: 0, gaps: 0, duplicates: 0 },
    });
    actor.send({ type: "CONFIRM_ADVANCE" });
    const snap = await waitForState(actor, (s) => s.matches("settled"));
    expect(snap.matches("settled")).toBe(true);
    expect(services.confirmStage).toHaveBeenCalledOnce();
    actor.stop();
  });

  it("confirmStage failure transitions back to workspace", async () => {
    const services = makeServices({
      confirmStage: vi.fn().mockRejectedValue(new Error("server error")),
    });
    const actor = createActor(pageOrderToolMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    actor.send({
      type: "FOLIOS_DONE",
      leaves: [makeLeaf()],
      runs: [makeRun()],
      totals: { total: 1, scanned: 1, outOfSeq: 0, gaps: 0, duplicates: 0 },
    });
    actor.send({ type: "CONFIRM_ADVANCE" });
    const snap = await waitForState(actor, (s) => s.matches("workspace"));
    expect(snap.context.error?.message).toBeTruthy();
    actor.stop();
  });

  it("W5.7: MANIFEST_PUSH accepted in settled state (refetch after confirm)", async () => {
    // W5.7: after confirming, the component refetches the manifest and sends
    // MANIFEST_PUSH. The machine must accept it in settled (not drop it).
    const services = makeServices();
    const actor = createActor(pageOrderToolMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    actor.send({
      type: "FOLIOS_DONE",
      leaves: [makeLeaf({ scan: 1, ocrFolio: null })],
      runs: [makeRun()],
      totals: { total: 1, scanned: 1, outOfSeq: 0, gaps: 0, duplicates: 0 },
    });
    actor.send({ type: "CONFIRM_ADVANCE" });
    await waitForState(actor, (s) => s.matches("settled"));

    // Send the post-confirm manifest with a real prefix
    actor.send({ type: "MANIFEST_PUSH", prefixes: { 1: "f001" } });

    const snap = actor.getSnapshot();
    expect(snap.matches("settled")).toBe(true);
    // assignPrefixes must have updated leaf.prefix in settled state (W5.7)
    const leaf = snap.context.leaves.find((l) => l.scan === 1);
    expect(leaf?.prefix).toBe("f001");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Suite 9: UPSTREAM_CHANGED from settled
// ---------------------------------------------------------------------------

describe("pageOrderTool — upstream changed", () => {
  it("UPSTREAM_CHANGED from settled resets to loading (W5.5)", async () => {
    const services = makeServices();
    const actor = createActor(pageOrderToolMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    // Use FOLIOS_DONE bypass to reach workspace quickly
    actor.send({
      type: "FOLIOS_DONE",
      leaves: [makeLeaf()],
      runs: [makeRun()],
      totals: { total: 1, scanned: 1, outOfSeq: 0, gaps: 0, duplicates: 0 },
    });
    actor.send({ type: "CONFIRM_ADVANCE" });
    await waitForState(actor, (s) => s.matches("settled"));
    actor.send({ type: "UPSTREAM_CHANGED" });
    // W5.5: resets to loading (was readingFolios)
    expect(actor.getSnapshot().matches("loading")).toBe(true);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 10 (W5.3): emitOrderChanged calls onOrderChanged callback
// ---------------------------------------------------------------------------

describe("pageOrderTool — emitOrderChanged (W5.3)", () => {
  it("calls onOrderChanged after DROP reorders leaves", () => {
    const onOrderChanged = vi.fn();
    const services = makeServices({ onOrderChanged });
    const actor = createActor(pageOrderToolMachine, {
      input: makeInput({ services }),
    });
    actor.start();

    // Transition to workspace with 3 leaves so we can reorder
    const leaves = [
      makeLeaf({ scan: 1 }),
      makeLeaf({ scan: 2 }),
      makeLeaf({ scan: 3 }),
    ];
    actor.send({
      type: "FOLIOS_DONE",
      leaves,
      runs: [makeRun()],
      totals: { total: 3, scanned: 3, outOfSeq: 0, gaps: 0, duplicates: 0 },
    });
    expect(actor.getSnapshot().matches("workspace")).toBe(true);

    // Perform a drag-reorder: drag scan 1 after scan 3
    actor.send({ type: "DRAG_START", scan: 1 });
    actor.send({ type: "DRAG_OVER", scan: 3, after: true });
    actor.send({ type: "DROP", scan: 3 });

    expect(onOrderChanged).toHaveBeenCalledTimes(1);
    actor.stop();
  });

  it("works without onOrderChanged (backward compat — no crash)", () => {
    // Services without onOrderChanged — should not throw
    const services = makeServices();
    const actor = createActor(pageOrderToolMachine, {
      input: makeInput({ services }),
    });
    actor.start();

    const leaves = [makeLeaf({ scan: 1 }), makeLeaf({ scan: 2 })];
    actor.send({
      type: "FOLIOS_DONE",
      leaves,
      runs: [makeRun()],
      totals: { total: 2, scanned: 2, outOfSeq: 0, gaps: 0, duplicates: 0 },
    });

    actor.send({ type: "DRAG_START", scan: 1 });
    actor.send({ type: "DRAG_OVER", scan: 2, after: true });
    expect(() => actor.send({ type: "DROP", scan: 2 })).not.toThrow();
    actor.stop();
  });
});
