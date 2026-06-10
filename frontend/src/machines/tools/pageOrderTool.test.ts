/**
 * pageOrderTool.test.ts — invariant tests for the pageOrderTool machine.
 *
 * TDD invariants from tool-page-order.yaml:
 *
 * Suite 1 "folio reading lifecycle" — readingFolios → workspace via FOLIOS_DONE
 * Suite 2 "ledger: drag-reorder" — DRAG_START → reordering → DROP → browsing
 * Suite 3 "ledger: role / run assignment" — SET_ROLE, SET_RUN + persistLeaf
 * Suite 4 "ledger: lens + view filters" — SET_LENS, SET_VIEW
 * Suite 5 "inspector: open/close" — SELECT_LEAF → LEAF_SELECTED → open → CLOSE
 * Suite 6 "runs: add / edit / remove" — ADD_RUN → CONFIRM_ADD; EDIT_RUN → DONE
 * Suite 7 "naming" — SET_NAME_PART patches naming context
 * Suite 8 "confirm advance" — sequenceClean guard + confirming → settled
 * Suite 9 "UPSTREAM_CHANGED resets to readingFolios" from settled
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
// Suite 1: folio reading lifecycle
// ---------------------------------------------------------------------------

describe("pageOrderTool — folio reading lifecycle", () => {
  it("starts in readingFolios", () => {
    const actor = createActor(pageOrderToolMachine, { input: makeInput() });
    actor.start();
    expect(actor.getSnapshot().matches("readingFolios")).toBe(true);
    actor.stop();
  });

  it("FOLIO_PUSH merges a folio into leaves context", () => {
    const actor = createActor(pageOrderToolMachine, { input: makeInput() });
    actor.start();
    actor.send({ type: "FOLIO_PUSH", scan: 1, ocrFolio: "1" });
    const snap = actor.getSnapshot();
    expect(snap.context.partialLeaves).toHaveLength(1);
    expect(snap.context.partialLeaves[0]!.ocrFolio).toBe("1");
    actor.stop();
  });

  it("FOLIOS_DONE transitions to workspace and assigns model", () => {
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
});

// ---------------------------------------------------------------------------
// Suite 9: UPSTREAM_CHANGED from settled
// ---------------------------------------------------------------------------

describe("pageOrderTool — upstream changed", () => {
  it("UPSTREAM_CHANGED from settled resets to readingFolios", async () => {
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
    await waitForState(actor, (s) => s.matches("settled"));
    actor.send({ type: "UPSTREAM_CHANGED" });
    expect(actor.getSnapshot().matches("readingFolios")).toBe(true);
    actor.stop();
  });
});
