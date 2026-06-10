/**
 * stageRunner invariant test suite.
 *
 * Tests per Task F2 specification:
 * 1. Full lifecycle: notrun→queued→running→(clean|flagged|error)
 * 2. Stale flag behavior
 * 3. Server-authoritative reconciliation (optimistic RUN then STAGE_PUSH wins)
 * 4. Staleness fan-out: UPSTREAM_CHANGED → stale; auto-queue only when autoRerun=true
 *
 * All tests use createActor + simulated events. No DOM.
 */

import { describe, it, expect, vi } from "vitest";
import { createActor } from "xstate";
import {
  stageRunnerMachine,
  type StageRunnerInput,
  type StageRunnerServices,
} from "./stageRunner";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeServices(
  overrides: Partial<StageRunnerServices> = {},
): StageRunnerServices {
  return {
    runStage: vi.fn().mockResolvedValue({
      status: "clean",
      flaggedPages: [],
      artifactBytes: 1000,
    }),
    requestCancel: vi.fn().mockResolvedValue(undefined),
    requestPause: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<StageRunnerInput> = {},
): StageRunnerInput {
  return {
    stageId: "grayscale",
    index: 1,
    group: "Image",
    projectId: "proj-1",
    pageScoped: true,
    services: makeServices(),
    ...overrides,
  };
}

function startRunner(input?: Partial<StageRunnerInput>) {
  const actor = createActor(stageRunnerMachine, { input: makeInput(input) });
  actor.start();
  return actor;
}

// ---------------------------------------------------------------------------
// Full lifecycle: notrun → queued → running → clean
// ---------------------------------------------------------------------------

describe("stageRunner — full lifecycle", () => {
  it("starts in notrun state", () => {
    const actor = startRunner();
    expect(actor.getSnapshot().value).toBe("notrun");
    actor.stop();
  });

  it("transitions notrun → queued on RUN", () => {
    const actor = startRunner();
    actor.send({ type: "RUN" });
    expect(actor.getSnapshot().value).toBe("queued");
    actor.stop();
  });

  it("transitions queued → running on START", () => {
    const actor = startRunner();
    actor.send({ type: "RUN" });
    actor.send({ type: "START" });
    expect(actor.getSnapshot().value).toBe("running");
    actor.stop();
  });

  it("transitions queued → notrun on CANCEL", () => {
    const actor = startRunner();
    actor.send({ type: "RUN" });
    actor.send({ type: "CANCEL" });
    expect(actor.getSnapshot().value).toBe("notrun");
    actor.stop();
  });

  it("transitions running → clean when runStage resolves with status=clean", async () => {
    const services = makeServices({
      runStage: vi.fn().mockResolvedValue({
        status: "clean",
        flaggedPages: [],
        artifactBytes: 5000,
      }),
    });
    const actor = startRunner({ services });
    actor.send({ type: "RUN" });
    actor.send({ type: "START" });
    // Wait for the promise to resolve
    await new Promise((r) => setTimeout(r, 0));
    expect(actor.getSnapshot().value).toBe("clean");
    actor.stop();
  });

  it("transitions running → flagged when runStage resolves with flaggedPages", async () => {
    const services = makeServices({
      runStage: vi.fn().mockResolvedValue({
        status: "flagged",
        flaggedPages: [{ pageId: "0003", n: 3, flagKind: "binarization" }],
        artifactBytes: 2000,
      }),
    });
    const actor = startRunner({ services });
    actor.send({ type: "RUN" });
    actor.send({ type: "START" });
    await new Promise((r) => setTimeout(r, 0));
    expect(actor.getSnapshot().value).toBe("flagged");
    const ctx = actor.getSnapshot().context;
    expect(ctx.flaggedPages).toHaveLength(1);
    expect(ctx.flaggedCount).toBe(1);
    actor.stop();
  });

  it("transitions running → error when runStage resolves with status=error", async () => {
    const services = makeServices({
      runStage: vi.fn().mockResolvedValue({ status: "error", code: "timeout" }),
    });
    const actor = startRunner({ services });
    actor.send({ type: "RUN" });
    actor.send({ type: "START" });
    await new Promise((r) => setTimeout(r, 0));
    expect(actor.getSnapshot().value).toBe("error");
    actor.stop();
  });

  it("transitions running → error when runStage rejects", async () => {
    const services = makeServices({
      runStage: vi.fn().mockRejectedValue(new Error("Network failure")),
    });
    const actor = startRunner({ services });
    actor.send({ type: "RUN" });
    actor.send({ type: "START" });
    await new Promise((r) => setTimeout(r, 0));
    expect(actor.getSnapshot().value).toBe("error");
    actor.stop();
  });

  it("transitions error → queued on RETRY", async () => {
    const services = makeServices({
      runStage: vi.fn().mockRejectedValue(new Error("fail")),
    });
    const actor = startRunner({ services });
    actor.send({ type: "RUN" });
    actor.send({ type: "START" });
    await new Promise((r) => setTimeout(r, 0));
    expect(actor.getSnapshot().value).toBe("error");
    actor.send({ type: "RETRY" });
    expect(actor.getSnapshot().value).toBe("queued");
    actor.stop();
  });

  it("transitions clean → queued on RERUN", async () => {
    const services = makeServices({
      runStage: vi
        .fn()
        .mockResolvedValue({ status: "clean", flaggedPages: [] }),
    });
    const actor = startRunner({ services });
    actor.send({ type: "RUN" });
    actor.send({ type: "START" });
    await new Promise((r) => setTimeout(r, 0));
    actor.send({ type: "RERUN" });
    expect(actor.getSnapshot().value).toBe("queued");
    actor.stop();
  });

  it("updates progress context on PROGRESS event while running", () => {
    const actor = startRunner();
    actor.send({ type: "RUN" });
    actor.send({ type: "START" });
    actor.send({ type: "PROGRESS", value: 0.5 });
    expect(actor.getSnapshot().context.progress).toBe(0.5);
    actor.stop();
  });

  it("stamps startedAt on START", () => {
    const actor = startRunner();
    actor.send({ type: "RUN" });
    actor.send({ type: "START" });
    expect(actor.getSnapshot().context.startedAt).not.toBeNull();
    actor.stop();
  });

  it("stamps durationMs after clean transition", async () => {
    const services = makeServices({
      runStage: vi
        .fn()
        .mockResolvedValue({ status: "clean", flaggedPages: [] }),
    });
    const actor = startRunner({ services });
    actor.send({ type: "RUN" });
    actor.send({ type: "START" });
    await new Promise((r) => setTimeout(r, 0));
    expect(actor.getSnapshot().context.durationMs).not.toBeNull();
    actor.stop();
  });

  it("resolves flagged → clean when all pages resolved via RESOLVE", async () => {
    const services = makeServices({
      runStage: vi.fn().mockResolvedValue({
        status: "flagged",
        flaggedPages: [{ pageId: "0003", n: 3, flagKind: "thresh" }],
      }),
    });
    const actor = startRunner({ services });
    actor.send({ type: "RUN" });
    actor.send({ type: "START" });
    await new Promise((r) => setTimeout(r, 0));
    expect(actor.getSnapshot().value).toBe("flagged");

    actor.send({ type: "RESOLVE", resolvedIds: ["0003"] });
    expect(actor.getSnapshot().value).toBe("clean");
    expect(actor.getSnapshot().context.flaggedPages).toHaveLength(0);
    actor.stop();
  });

  it("stays flagged when only some pages resolved", async () => {
    const services = makeServices({
      runStage: vi.fn().mockResolvedValue({
        status: "flagged",
        flaggedPages: [
          { pageId: "0003", n: 3, flagKind: "thresh" },
          { pageId: "0004", n: 4, flagKind: "thresh" },
        ],
      }),
    });
    const actor = startRunner({ services });
    actor.send({ type: "RUN" });
    actor.send({ type: "START" });
    await new Promise((r) => setTimeout(r, 0));

    actor.send({ type: "RESOLVE", resolvedIds: ["0003"] });
    expect(actor.getSnapshot().value).toBe("flagged");
    expect(actor.getSnapshot().context.flaggedPages).toHaveLength(1);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Stale behavior
// ---------------------------------------------------------------------------

describe("stageRunner — stale behavior", () => {
  it("transitions clean → stale on UPSTREAM_CHANGED", async () => {
    const services = makeServices({
      runStage: vi
        .fn()
        .mockResolvedValue({ status: "clean", flaggedPages: [] }),
    });
    const actor = startRunner({ services });
    actor.send({ type: "RUN" });
    actor.send({ type: "START" });
    await new Promise((r) => setTimeout(r, 0));

    actor.send({ type: "UPSTREAM_CHANGED", autoRerun: false });
    expect(actor.getSnapshot().value).toBe("stale");
    expect(actor.getSnapshot().context.staleReason).toBe("upstream_changed");
    actor.stop();
  });

  it("transitions flagged → stale on UPSTREAM_CHANGED", async () => {
    const services = makeServices({
      runStage: vi.fn().mockResolvedValue({
        status: "flagged",
        flaggedPages: [{ pageId: "0001", n: 1, flagKind: "skew" }],
      }),
    });
    const actor = startRunner({ services });
    actor.send({ type: "RUN" });
    actor.send({ type: "START" });
    await new Promise((r) => setTimeout(r, 0));

    actor.send({ type: "UPSTREAM_CHANGED", autoRerun: false });
    expect(actor.getSnapshot().value).toBe("stale");
    actor.stop();
  });

  it("transitions clean → stale on SETTINGS_CHANGED with reason=settings_changed", async () => {
    const services = makeServices({
      runStage: vi
        .fn()
        .mockResolvedValue({ status: "clean", flaggedPages: [] }),
    });
    const actor = startRunner({ services });
    actor.send({ type: "RUN" });
    actor.send({ type: "START" });
    await new Promise((r) => setTimeout(r, 0));

    actor.send({ type: "SETTINGS_CHANGED" });
    expect(actor.getSnapshot().value).toBe("stale");
    expect(actor.getSnapshot().context.staleReason).toBe("settings_changed");
    actor.stop();
  });

  it("stale stays stale (no auto-queue) when autoRerun=false on UPSTREAM_CHANGED", async () => {
    const services = makeServices({
      runStage: vi
        .fn()
        .mockResolvedValue({ status: "clean", flaggedPages: [] }),
    });
    const actor = startRunner({ services });
    actor.send({ type: "RUN" });
    actor.send({ type: "START" });
    await new Promise((r) => setTimeout(r, 0));

    actor.send({ type: "UPSTREAM_CHANGED", autoRerun: false });
    // must stay stale, not auto-advance to queued
    expect(actor.getSnapshot().value).toBe("stale");
    actor.stop();
  });

  it("stale auto-queues when autoRerun=true on UPSTREAM_CHANGED", async () => {
    const services = makeServices({
      runStage: vi
        .fn()
        .mockResolvedValue({ status: "clean", flaggedPages: [] }),
    });
    const actor = startRunner({ services });
    actor.send({ type: "RUN" });
    actor.send({ type: "START" });
    await new Promise((r) => setTimeout(r, 0));

    actor.send({ type: "UPSTREAM_CHANGED", autoRerun: true });
    // should auto-advance to queued via the always guard
    expect(actor.getSnapshot().value).toBe("queued");
    actor.stop();
  });

  it("can RUN from stale", async () => {
    const services = makeServices({
      runStage: vi
        .fn()
        .mockResolvedValue({ status: "clean", flaggedPages: [] }),
    });
    const actor = startRunner({ services });
    actor.send({ type: "RUN" });
    actor.send({ type: "START" });
    await new Promise((r) => setTimeout(r, 0));

    actor.send({ type: "UPSTREAM_CHANGED", autoRerun: false });
    actor.send({ type: "RUN" });
    expect(actor.getSnapshot().value).toBe("queued");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Server-authoritative reconciliation (STAGE_PUSH)
// Reconcile is implemented as of F4 — push wins over optimistic local state.
// ---------------------------------------------------------------------------

describe("stageRunner — server reconciliation (STAGE_PUSH)", () => {
  it("STAGE_PUSH calls reconcile action in notrun state", () => {
    const actor = startRunner();
    // Just verifying it doesn't throw; reconcile is a side-effect action
    expect(() => {
      actor.send({
        type: "STAGE_PUSH",
        variant: "status" as const,
        stage_id: "grayscale",
        status: "clean",
        job_id: null,
        error_message: null,
      });
    }).not.toThrow();
    actor.stop();
  });

  it("STAGE_PUSH calls reconcile action while queued", () => {
    const actor = startRunner();
    actor.send({ type: "RUN" });
    expect(() => {
      actor.send({
        type: "STAGE_PUSH",
        variant: "status" as const,
        stage_id: "grayscale",
        status: "running",
        job_id: "j1",
        error_message: null,
      });
    }).not.toThrow();
    actor.stop();
  });

  it("STAGE_PUSH calls reconcile action while running", () => {
    const actor = startRunner();
    actor.send({ type: "RUN" });
    actor.send({ type: "START" });
    expect(() => {
      actor.send({
        type: "STAGE_PUSH",
        variant: "status" as const,
        stage_id: "grayscale",
        status: "running",
        job_id: "j1",
        error_message: null,
      });
    }).not.toThrow();
    actor.stop();
  });

  it("STAGE_PUSH while running doesn't change the running state itself", () => {
    const actor = startRunner();
    actor.send({ type: "RUN" });
    actor.send({ type: "START" });
    actor.send({
      type: "STAGE_PUSH",
      variant: "status" as const,
      stage_id: "grayscale",
      status: "running",
      job_id: "j1",
      error_message: null,
    });
    expect(actor.getSnapshot().value).toBe("running");
    actor.stop();
  });

  it("STAGE_PUSH while stale keeps stale state", async () => {
    const services = makeServices({
      runStage: vi
        .fn()
        .mockResolvedValue({ status: "clean", flaggedPages: [] }),
    });
    const actor = startRunner({ services });
    actor.send({ type: "RUN" });
    actor.send({ type: "START" });
    await new Promise((r) => setTimeout(r, 0));
    actor.send({ type: "UPSTREAM_CHANGED", autoRerun: false });
    expect(actor.getSnapshot().value).toBe("stale");

    actor.send({
      type: "STAGE_PUSH",
      variant: "status" as const,
      stage_id: "grayscale",
      status: "dirty",
      job_id: null,
      error_message: null,
    });
    expect(actor.getSnapshot().value).toBe("stale");
    actor.stop();
  });

  // -------------------------------------------------------------------------
  // Push-wins tests (F4 — reconcile now implemented)
  // -------------------------------------------------------------------------

  it("STAGE_PUSH(status=clean) while machine is running → reconcile sets clean context (push wins)", () => {
    // Server says clean while machine is still running (optimistic run in flight).
    // reconcile assigns clean context — machine state stays "running" until the
    // runStage actor resolves, but context is already push-wins authoritative.
    const actor = startRunner();
    actor.send({ type: "RUN" });
    actor.send({ type: "START" });
    expect(actor.getSnapshot().value).toBe("running");

    actor.send({
      type: "STAGE_PUSH",
      variant: "status" as const,
      stage_id: "grayscale",
      status: "clean",
      job_id: null,
      error_message: null,
    });

    // State is still "running" (actor hasn't resolved), but context reflects clean
    expect(actor.getSnapshot().value).toBe("running");
    // Push-wins: flaggedPages cleared, progress set to 1, error cleared
    const ctx = actor.getSnapshot().context;
    expect(ctx.flaggedPages).toHaveLength(0);
    expect(ctx.progress).toBe(1);
    expect(ctx.error).toBeNull();
    actor.stop();
  });

  it("STAGE_PUSH(status=failed) while machine is running → reconcile sets error context (push wins)", () => {
    const actor = startRunner();
    actor.send({ type: "RUN" });
    actor.send({ type: "START" });

    actor.send({
      type: "STAGE_PUSH",
      variant: "status" as const,
      stage_id: "grayscale",
      status: "failed",
      job_id: null,
      error_message: "GPU OOM",
    });

    const ctx = actor.getSnapshot().context;
    expect(ctx.error).not.toBeNull();
    expect(ctx.error?.message).toBe("GPU OOM");
    actor.stop();
  });

  it("STAGE_PUSH(status=failed) with null error_message uses fallback message", () => {
    const actor = startRunner();
    actor.send({ type: "RUN" });
    actor.send({ type: "START" });

    actor.send({
      type: "STAGE_PUSH",
      variant: "status" as const,
      stage_id: "grayscale",
      status: "failed",
      job_id: null,
      error_message: null,
    });

    const ctx = actor.getSnapshot().context;
    expect(ctx.error?.message).toContain("failed");
    actor.stop();
  });

  it("STAGE_PUSH(progress) updates context.progress (push wins)", () => {
    const actor = startRunner();
    actor.send({ type: "RUN" });
    actor.send({ type: "START" });

    actor.send({
      type: "STAGE_PUSH",
      variant: "progress" as const,
      stage_id: "grayscale",
      progress: 0.55,
      message: "55% done",
    });

    expect(actor.getSnapshot().context.progress).toBe(0.55);
    actor.stop();
  });

  it("STAGE_PUSH(status=clean) while flagged → clears flaggedPages (push wins)", async () => {
    const services = makeServices({
      runStage: vi.fn().mockResolvedValue({
        status: "flagged",
        flaggedPages: [{ pageId: "0003", n: 3, flagKind: "thresh" }],
      }),
    });
    const actor = startRunner({ services });
    actor.send({ type: "RUN" });
    actor.send({ type: "START" });
    await new Promise((r) => setTimeout(r, 0));
    expect(actor.getSnapshot().value).toBe("flagged");
    expect(actor.getSnapshot().context.flaggedPages).toHaveLength(1);

    // Server push says clean — push wins
    actor.send({
      type: "STAGE_PUSH",
      variant: "status" as const,
      stage_id: "grayscale",
      status: "clean",
      job_id: null,
      error_message: null,
    });

    const ctx = actor.getSnapshot().context;
    expect(ctx.flaggedPages).toHaveLength(0);
    expect(ctx.flaggedCount).toBe(0);
    expect(ctx.progress).toBe(1);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Staleness fan-out (orchestration seam)
// ---------------------------------------------------------------------------

describe("stageRunner — staleness fan-out at orchestration seam", () => {
  /**
   * Simulate a parent (test harness) reacting to UPSTREAM_CHANGED by sending
   * STALE to downstream runners, asserting auto-queue only when automation=on.
   *
   * In the real app, pipelineShell.fanOutStale dispatches UPSTREAM_CHANGED to
   * all downstream stageRunners. Here we simulate that directly.
   */

  it("notrun stage ignores UPSTREAM_CHANGED (no stale transition for not-yet-run stages)", () => {
    // YAML says only clean + flagged listen to UPSTREAM_CHANGED (not notrun).
    // notrun has no UPSTREAM_CHANGED handler — confirm it stays notrun.
    const actor = startRunner();
    expect(actor.getSnapshot().value).toBe("notrun");
    // notrun has no UPSTREAM_CHANGED transition — send is silently ignored
    actor.send({ type: "UPSTREAM_CHANGED", autoRerun: false });
    expect(actor.getSnapshot().value).toBe("notrun");
    actor.stop();
  });

  it("downstream runner auto-queues when autoRerun flag is on", async () => {
    // Simulate "downstream" stage that was clean, then receives UPSTREAM_CHANGED
    // with autoRerun=true from the orchestrator.
    const services = makeServices({
      runStage: vi
        .fn()
        .mockResolvedValue({ status: "clean", flaggedPages: [] }),
    });
    const downstreamActor = startRunner({
      stageId: "threshold",
      index: 3,
      services,
    });

    // Drive it to clean first
    downstreamActor.send({ type: "RUN" });
    downstreamActor.send({ type: "START" });
    await new Promise((r) => setTimeout(r, 0));
    expect(downstreamActor.getSnapshot().value).toBe("clean");

    // Orchestrator sends UPSTREAM_CHANGED with autoRerun=true
    downstreamActor.send({ type: "UPSTREAM_CHANGED", autoRerun: true });
    expect(downstreamActor.getSnapshot().value).toBe("queued");
    downstreamActor.stop();
  });

  it("downstream runner stays stale when autoRerun flag is off", async () => {
    const services = makeServices({
      runStage: vi
        .fn()
        .mockResolvedValue({ status: "clean", flaggedPages: [] }),
    });
    const downstreamActor = startRunner({
      stageId: "threshold",
      index: 3,
      services,
    });

    downstreamActor.send({ type: "RUN" });
    downstreamActor.send({ type: "START" });
    await new Promise((r) => setTimeout(r, 0));

    downstreamActor.send({ type: "UPSTREAM_CHANGED", autoRerun: false });
    expect(downstreamActor.getSnapshot().value).toBe("stale");
    downstreamActor.stop();
  });

  it("multiple downstream runners can be fanned-out independently", async () => {
    const services1 = makeServices({
      runStage: vi
        .fn()
        .mockResolvedValue({ status: "clean", flaggedPages: [] }),
    });
    const services2 = makeServices({
      runStage: vi
        .fn()
        .mockResolvedValue({ status: "clean", flaggedPages: [] }),
    });

    // Two "downstream" runners (deskew, denoise)
    const runner1 = startRunner({
      stageId: "deskew",
      index: 4,
      services: services1,
    });
    const runner2 = startRunner({
      stageId: "denoise",
      index: 5,
      services: services2,
    });

    // Drive both to clean
    for (const r of [runner1, runner2]) {
      r.send({ type: "RUN" });
      r.send({ type: "START" });
    }
    await new Promise((r) => setTimeout(r, 0));

    // Fan out: runner1 auto-rerun ON, runner2 auto-rerun OFF
    runner1.send({ type: "UPSTREAM_CHANGED", autoRerun: true });
    runner2.send({ type: "UPSTREAM_CHANGED", autoRerun: false });

    expect(runner1.getSnapshot().value).toBe("queued");
    expect(runner2.getSnapshot().value).toBe("stale");

    runner1.stop();
    runner2.stop();
  });
});
