/**
 * runAllStale machine test suite.
 *
 * Tests per Task F4 specification:
 * 1. queue building and ordering
 * 2. sequential dispatch + STAGE_DONE sequencing
 * 3. abort / cancellation
 * 4. halt-on-error + retry + skip
 * 5. empty queue → done immediately
 */

import { describe, it, expect, vi } from "vitest";
import { createActor } from "xstate";
import {
  runAllStaleMachine,
  type RunAllStaleInput,
  type RunAllStaleServices,
} from "./runAllStale";
import type { StageRunnerRef } from "./pipelineShell";
import { stageRunnerMachine } from "./stageRunner";
import { createActor as createStageRunner } from "xstate";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRunnerRef(stageId: string): StageRunnerRef {
  const actor = createStageRunner(stageRunnerMachine, {
    input: {
      stageId,
      index: 0,
      group: "Image",
      projectId: "proj-1",
      pageScoped: true,
      services: {
        runStage: vi
          .fn()
          .mockResolvedValue({ status: "clean", flaggedPages: [] }),
        requestCancel: vi.fn().mockResolvedValue(undefined),
        requestPause: vi.fn().mockResolvedValue(undefined),
      },
    },
  });
  actor.start();
  return actor;
}

function makeServices(
  overrides: Partial<RunAllStaleServices> = {},
): RunAllStaleServices {
  return {
    cancelInFlight: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<RunAllStaleInput> = {},
): RunAllStaleInput {
  const runners = [
    makeRunnerRef("grayscale"),
    makeRunnerRef("crop"),
    makeRunnerRef("threshold"),
  ];
  return {
    staleIndices: [0, 1, 2],
    projectId: "proj-1",
    runners,
    services: makeServices(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Empty queue
// ---------------------------------------------------------------------------

describe("runAllStale — empty queue", () => {
  it("empty staleIndices → immediately enters done (final)", async () => {
    const onDone = vi.fn();
    const actor = createActor(runAllStaleMachine, {
      input: makeInput({ staleIndices: [], onDone }),
    });
    actor.start();
    // always guard in collecting fires synchronously
    expect(actor.getSnapshot().matches("done")).toBe(true);
    actor.stop();
  });

  it("empty queue calls onDone(0)", async () => {
    const onDone = vi.fn();
    const actor = createActor(runAllStaleMachine, {
      input: makeInput({ staleIndices: [], onDone }),
    });
    actor.start();
    expect(onDone).toHaveBeenCalledWith(0);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Confirmation step
// ---------------------------------------------------------------------------

describe("runAllStale — confirming step", () => {
  it("non-empty queue starts in collecting → confirming", () => {
    const actor = createActor(runAllStaleMachine, {
      input: makeInput({ staleIndices: [0] }),
    });
    actor.start();
    expect(actor.getSnapshot().matches("confirming")).toBe(true);
    actor.stop();
  });

  it("CANCEL from confirming → cancelled (final)", () => {
    const onCancelled = vi.fn();
    const actor = createActor(runAllStaleMachine, {
      input: makeInput({ staleIndices: [0], onCancelled }),
    });
    actor.start();
    actor.send({ type: "CANCEL" });
    expect(actor.getSnapshot().matches("cancelled")).toBe(true);
    expect(onCancelled).toHaveBeenCalled();
    actor.stop();
  });

  it("CONFIRM from confirming → running", () => {
    const actor = createActor(runAllStaleMachine, {
      input: makeInput({ staleIndices: [0] }),
    });
    actor.start();
    actor.send({ type: "CONFIRM" });
    expect(actor.getSnapshot().matches("running")).toBe(true);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Queue ordering
// ---------------------------------------------------------------------------

describe("runAllStale — queue ordering", () => {
  it("staleIndices are sorted ascending in buildQueue", () => {
    const actor = createActor(runAllStaleMachine, {
      input: makeInput({ staleIndices: [2, 0, 1] }),
    });
    actor.start();
    // Queue should be sorted: [0, 1, 2]
    const ctx = actor.getSnapshot().context;
    expect(ctx.queue).toEqual([0, 1, 2]);
    actor.stop();
  });

  it("total is set to initial queue length", () => {
    const actor = createActor(runAllStaleMachine, {
      input: makeInput({ staleIndices: [0, 1, 2] }),
    });
    actor.start();
    expect(actor.getSnapshot().context.total).toBe(3);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Sequential dispatch
// ---------------------------------------------------------------------------

describe("runAllStale — sequential dispatch", () => {
  it("STAGE_DONE(clean) advances the queue and continues", () => {
    const actor = createActor(runAllStaleMachine, {
      input: makeInput({ staleIndices: [0, 1, 2] }),
    });
    actor.start();
    actor.send({ type: "CONFIRM" });

    // First stage done
    actor.send({ type: "STAGE_DONE", stageIndex: 0, status: "clean" });
    const ctx = actor.getSnapshot().context;
    expect(ctx.completed).toContain(0);
    expect(ctx.queue).toEqual([2]); // 0 consumed, 1 consumed (advance), 2 remains
    actor.stop();
  });

  it("STAGE_DONE for all stages → done (final)", () => {
    const actor = createActor(runAllStaleMachine, {
      input: makeInput({ staleIndices: [0, 1] }),
    });
    actor.start();
    actor.send({ type: "CONFIRM" });
    actor.send({ type: "STAGE_DONE", stageIndex: 0, status: "clean" });
    actor.send({ type: "STAGE_DONE", stageIndex: 1, status: "clean" });
    expect(actor.getSnapshot().matches("done")).toBe(true);
    actor.stop();
  });

  it("STAGE_PROGRESS updates currentProgress", () => {
    const actor = createActor(runAllStaleMachine, {
      input: makeInput({ staleIndices: [0] }),
    });
    actor.start();
    actor.send({ type: "CONFIRM" });
    actor.send({ type: "STAGE_PROGRESS", stageIndex: 0, progress: 0.6 });
    expect(actor.getSnapshot().context.currentProgress).toBe(0.6);
    actor.stop();
  });

  it("onDone is called with completed count", () => {
    const onDone = vi.fn();
    const actor = createActor(runAllStaleMachine, {
      input: makeInput({ staleIndices: [0, 1], onDone }),
    });
    actor.start();
    actor.send({ type: "CONFIRM" });
    actor.send({ type: "STAGE_DONE", stageIndex: 0, status: "clean" });
    actor.send({ type: "STAGE_DONE", stageIndex: 1, status: "clean" });
    expect(onDone).toHaveBeenCalledWith(2);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Halt on error
// ---------------------------------------------------------------------------

describe("runAllStale — halt on error", () => {
  it("STAGE_DONE(error) with haltOnError=true → halted state", () => {
    const actor = createActor(runAllStaleMachine, {
      input: makeInput({ staleIndices: [0, 1], haltOnError: true }),
    });
    actor.start();
    actor.send({ type: "CONFIRM" });
    actor.send({ type: "STAGE_DONE", stageIndex: 0, status: "error" });
    expect(actor.getSnapshot().matches("halted")).toBe(true);
    expect(actor.getSnapshot().context.failedIndex).toBe(0);
    actor.stop();
  });

  it("STAGE_DONE(error) with haltOnError=false → continues queue", () => {
    const actor = createActor(runAllStaleMachine, {
      input: makeInput({ staleIndices: [0, 1], haltOnError: false }),
    });
    actor.start();
    actor.send({ type: "CONFIRM" });
    actor.send({ type: "STAGE_DONE", stageIndex: 0, status: "error" });
    // Should continue to next stage (dispatch), not halt
    expect(actor.getSnapshot().matches("halted")).toBe(false);
    expect(actor.getSnapshot().matches("running")).toBe(true);
    actor.stop();
  });

  it("RETRY from halted requeues the failed stage", () => {
    const actor = createActor(runAllStaleMachine, {
      input: makeInput({ staleIndices: [0, 1], haltOnError: true }),
    });
    actor.start();
    actor.send({ type: "CONFIRM" });
    actor.send({ type: "STAGE_DONE", stageIndex: 0, status: "error" });
    expect(actor.getSnapshot().context.failedIndex).toBe(0);

    actor.send({ type: "RETRY" });
    expect(actor.getSnapshot().matches("running")).toBe(true);
    // failedIndex should be cleared and requeued
    expect(actor.getSnapshot().context.failedIndex).toBeNull();
    actor.stop();
  });

  it("SKIP from halted clears failedIndex and continues", () => {
    const actor = createActor(runAllStaleMachine, {
      input: makeInput({ staleIndices: [0, 1], haltOnError: true }),
    });
    actor.start();
    actor.send({ type: "CONFIRM" });
    actor.send({ type: "STAGE_DONE", stageIndex: 0, status: "error" });

    actor.send({ type: "SKIP" });
    expect(actor.getSnapshot().context.failedIndex).toBeNull();
    expect(actor.getSnapshot().matches("running")).toBe(true);
    actor.stop();
  });

  it("CANCEL from halted → cancelled", () => {
    const actor = createActor(runAllStaleMachine, {
      input: makeInput({ staleIndices: [0], haltOnError: true }),
    });
    actor.start();
    actor.send({ type: "CONFIRM" });
    actor.send({ type: "STAGE_DONE", stageIndex: 0, status: "error" });

    actor.send({ type: "CANCEL" });
    expect(actor.getSnapshot().matches("cancelled")).toBe(true);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Cancellation while running
// ---------------------------------------------------------------------------

describe("runAllStale — cancellation while running", () => {
  it("CANCEL while running → cancelling state", () => {
    const actor = createActor(runAllStaleMachine, {
      input: makeInput({ staleIndices: [0, 1, 2] }),
    });
    actor.start();
    actor.send({ type: "CONFIRM" });
    actor.send({ type: "CANCEL" });
    expect(actor.getSnapshot().matches("cancelling")).toBe(true);
    actor.stop();
  });

  it("cancelling resolves to cancelled", async () => {
    const onCancelled = vi.fn();
    const actor = createActor(runAllStaleMachine, {
      input: makeInput({ staleIndices: [0, 1], onCancelled }),
    });
    actor.start();
    actor.send({ type: "CONFIRM" });
    actor.send({ type: "CANCEL" });
    // cancelInFlight is a mock that resolves immediately
    await new Promise((r) => setTimeout(r, 0));
    expect(actor.getSnapshot().matches("cancelled")).toBe(true);
    expect(onCancelled).toHaveBeenCalled();
    actor.stop();
  });
});
