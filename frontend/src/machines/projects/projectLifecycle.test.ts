/**
 * projectLifecycle invariant tests.
 *
 * Key invariants:
 * 1. STATUS_PUSH reconciles server authority (moves to any state).
 * 2. ARCHIVE available from all non-terminal states (queued/running/review/ready/submitted/error).
 * 3. DELETE only from archived state.
 * 4. restoring invoke: resolves to ready, review, or queued based on server response.
 * 5. Full lifecycle: queued → running → review → ready → submitted.
 * 6. Error state: RETRY clears error and returns to running.
 */

import { describe, it, expect, vi } from "vitest";
import { createActor } from "xstate";
import {
  projectLifecycleMachine,
  type ProjectLifecycleInput,
  type ProjectLifecycleServices,
  type ProjectStatus,
} from "./projectLifecycle";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeServices(
  overrides: Partial<ProjectLifecycleServices> = {},
): ProjectLifecycleServices {
  return {
    restoreProject: vi.fn().mockResolvedValue({
      status: "ready",
      currentStage: 20,
      flagged: 0,
    }),
    requestRun: vi.fn().mockResolvedValue(undefined),
    requestPause: vi.fn().mockResolvedValue(undefined),
    requestSubmit: vi.fn().mockResolvedValue(undefined),
    requestArchive: vi.fn().mockResolvedValue(undefined),
    requestDelete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<ProjectLifecycleInput> = {},
): ProjectLifecycleInput {
  return {
    projectId: "proj-1",
    initialStatus: "queued",
    initialStage: 0,
    services: makeServices(),
    ...overrides,
  };
}

function startActor(overrides: Partial<ProjectLifecycleInput> = {}) {
  const actor = createActor(projectLifecycleMachine, {
    input: makeInput(overrides),
  });
  actor.start();
  return actor;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe("projectLifecycle — initial state", () => {
  it("starts in queued state", () => {
    const actor = startActor();
    expect(actor.getSnapshot().value).toBe("queued");
    actor.stop();
  });

  it("context has correct initial values", () => {
    const actor = startActor();
    const ctx = actor.getSnapshot().context;
    expect(ctx.projectId).toBe("proj-1");
    expect(ctx.status).toBe("queued");
    expect(ctx.flagged).toBe(0);
    expect(ctx.lastError).toBeNull();
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// STATUS_PUSH — server authority reconciliation
// ---------------------------------------------------------------------------

describe("projectLifecycle — STATUS_PUSH reconciliation", () => {
  it("STATUS_PUSH updates context.status (context reconcile)", () => {
    const actor = startActor();
    actor.send({
      type: "STATUS_PUSH",
      status: "running",
      currentStage: 5,
      flagged: 2,
    });
    const ctx = actor.getSnapshot().context;
    expect(ctx.status).toBe("running");
    expect(ctx.currentStage).toBe(5);
    expect(ctx.flagged).toBe(2);
    actor.stop();
  });

  it("STATUS_PUSH from any non-terminal state records the new status", () => {
    // Test from running
    const actor = startActor();
    actor.send({ type: "RUN" });
    expect(actor.getSnapshot().value).toBe("running");
    actor.send({ type: "STATUS_PUSH", status: "error" });
    expect(actor.getSnapshot().context.status).toBe("error");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// ARCHIVE from all non-terminal states
// ---------------------------------------------------------------------------

describe("projectLifecycle — ARCHIVE from non-terminal states", () => {
  const nonTerminalStates: ProjectStatus[] = [
    "queued",
    "running",
    "review",
    "ready",
    "submitted",
    "error",
  ];

  for (const status of nonTerminalStates) {
    it(`ARCHIVE from ${status} transitions to archived`, () => {
      const actor = startActor();
      if (status !== "queued") {
        actor.send({ type: "STATUS_PUSH", status });
      }
      actor.send({ type: "ARCHIVE" });
      expect(actor.getSnapshot().value).toBe("archived");
      actor.stop();
    });
  }
});

// ---------------------------------------------------------------------------
// DELETE only from archived
// ---------------------------------------------------------------------------

describe("projectLifecycle — DELETE only from archived", () => {
  it("DELETE from archived → deleted (final)", () => {
    const actor = startActor();
    actor.send({ type: "STATUS_PUSH", status: "archived" });
    actor.send({ type: "ARCHIVE" }); // to reach archived state
    actor.send({ type: "DELETE" });
    expect(actor.getSnapshot().value).toBe("deleted");
    actor.stop();
  });

  it("DELETE from queued is NOT handled (stays in queued)", () => {
    const actor = startActor();
    actor.send({ type: "DELETE" });
    // DELETE is not on queued state — should be ignored
    expect(actor.getSnapshot().value).toBe("queued");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Running lifecycle
// ---------------------------------------------------------------------------

describe("projectLifecycle — running lifecycle", () => {
  it("RUN from queued → running", () => {
    const actor = startActor();
    actor.send({ type: "RUN" });
    expect(actor.getSnapshot().value).toBe("running");
    actor.stop();
  });

  it("STAGE_DONE without review need advances stage and stays running", () => {
    const actor = startActor();
    actor.send({ type: "RUN" });
    actor.send({ type: "STAGE_DONE", stage: "grayscale", flagged: 0 });
    expect(actor.getSnapshot().value).toBe("running");
    expect(actor.getSnapshot().context.currentStage).toBe(1);
    actor.stop();
  });

  it("STAGE_DONE with flagged pages → review", () => {
    const actor = startActor();
    actor.send({ type: "RUN" });
    actor.send({ type: "STAGE_DONE", stage: "ocr", flagged: 5 });
    expect(actor.getSnapshot().value).toBe("review");
    expect(actor.getSnapshot().context.flagged).toBe(5);
    actor.stop();
  });

  it("STAGE_DONE with text_review stage → review", () => {
    const actor = startActor();
    actor.send({ type: "RUN" });
    actor.send({ type: "STAGE_DONE", stage: "text_review", flagged: 0 });
    expect(actor.getSnapshot().value).toBe("review");
    actor.stop();
  });

  it("STAGE_FAILED → error with error details", () => {
    const actor = startActor();
    actor.send({ type: "RUN" });
    actor.send({ type: "STAGE_FAILED", stage: "ocr", message: "OOM" });
    expect(actor.getSnapshot().value).toBe("error");
    expect(actor.getSnapshot().context.lastError).toEqual({
      stage: "ocr",
      message: "OOM",
    });
    actor.stop();
  });

  it("PAUSE from running → queued", () => {
    const actor = startActor();
    actor.send({ type: "RUN" });
    actor.send({ type: "PAUSE" });
    expect(actor.getSnapshot().value).toBe("queued");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Review lifecycle
// ---------------------------------------------------------------------------

describe("projectLifecycle — review lifecycle", () => {
  function startAtReview() {
    const actor = startActor();
    actor.send({ type: "RUN" });
    actor.send({ type: "STAGE_DONE", stage: "text_review", flagged: 0 });
    return actor;
  }

  it("RESOLVE with hasRemainingStages=true → running", () => {
    const actor = startAtReview();
    actor.send({ type: "RESOLVE", hasRemainingStages: true });
    expect(actor.getSnapshot().value).toBe("running");
    actor.stop();
  });

  it("RESOLVE with hasRemainingStages=false → ready", () => {
    const actor = startAtReview();
    actor.send({ type: "RESOLVE", hasRemainingStages: false });
    expect(actor.getSnapshot().value).toBe("ready");
    actor.stop();
  });

  it("RESOLVE clears flagged count", () => {
    const actor = startActor();
    actor.send({ type: "RUN" });
    actor.send({ type: "STAGE_DONE", stage: "ocr", flagged: 5 });
    expect(actor.getSnapshot().context.flagged).toBe(5);
    actor.send({ type: "RESOLVE", hasRemainingStages: false });
    expect(actor.getSnapshot().context.flagged).toBe(0);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Ready lifecycle
// ---------------------------------------------------------------------------

describe("projectLifecycle — ready lifecycle", () => {
  it("SUBMIT from ready → submitted", () => {
    const actor = startActor();
    actor.send({ type: "STATUS_PUSH", status: "ready" });
    actor.send({ type: "ARCHIVE" }); // to archived
    // Start fresh in ready
    const actor2 = startActor();
    actor2.send({ type: "RUN" });
    actor2.send({ type: "STAGE_DONE", stage: "text_review", flagged: 0 });
    actor2.send({ type: "RESOLVE", hasRemainingStages: false });
    expect(actor2.getSnapshot().value).toBe("ready");
    actor2.send({ type: "SUBMIT" });
    expect(actor2.getSnapshot().value).toBe("submitted");
    actor2.stop();
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Error recovery
// ---------------------------------------------------------------------------

describe("projectLifecycle — error recovery", () => {
  it("RETRY from error → running + clears error", () => {
    const actor = startActor();
    actor.send({ type: "RUN" });
    actor.send({ type: "STAGE_FAILED", stage: "ocr", message: "OOM" });
    expect(actor.getSnapshot().value).toBe("error");
    actor.send({ type: "RETRY" });
    expect(actor.getSnapshot().value).toBe("running");
    expect(actor.getSnapshot().context.lastError).toBeNull();
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Restoring from archived
// ---------------------------------------------------------------------------

describe("projectLifecycle — restore from archived", () => {
  it("RESTORE from archived → restoring", async () => {
    const actor = startActor();
    actor.send({ type: "ARCHIVE" });
    expect(actor.getSnapshot().value).toBe("archived");
    actor.send({ type: "RESTORE" });
    // Should be in restoring (or if fast, already resolved to ready)
    await vi.waitFor(() => {
      const v = actor.getSnapshot().value;
      expect(
        v === "restoring" || v === "ready" || v === "review" || v === "queued",
      ).toBe(true);
    });
    actor.stop();
  });

  it("restoreProject resolves to ready → machine lands in ready", async () => {
    const services = makeServices({
      restoreProject: vi.fn().mockResolvedValue({
        status: "ready",
        currentStage: 20,
        flagged: 0,
      }),
    });
    const actor = startActor({ services });
    actor.send({ type: "ARCHIVE" });
    actor.send({ type: "RESTORE" });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().value).toBe("ready");
    });
    expect(actor.getSnapshot().context.currentStage).toBe(20);
    actor.stop();
  });

  it("restoreProject resolves to review → machine lands in review", async () => {
    const services = makeServices({
      restoreProject: vi.fn().mockResolvedValue({
        status: "review",
        currentStage: 15,
        flagged: 3,
      }),
    });
    const actor = startActor({ services });
    actor.send({ type: "ARCHIVE" });
    actor.send({ type: "RESTORE" });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().value).toBe("review");
    });
    expect(actor.getSnapshot().context.flagged).toBe(3);
    actor.stop();
  });

  it("restoreProject failure returns to archived with error", async () => {
    const services = makeServices({
      restoreProject: vi.fn().mockRejectedValue(new Error("restore failed")),
    });
    const actor = startActor({ services });
    actor.send({ type: "ARCHIVE" });
    actor.send({ type: "RESTORE" });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().value).toBe("archived");
    });
    expect(actor.getSnapshot().context.lastError?.stage).toBe("restore");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// stampArchivedOn
// ---------------------------------------------------------------------------

describe("projectLifecycle — stampArchivedOn", () => {
  it("archivedOn is set when entering archived state", () => {
    const actor = startActor();
    expect(actor.getSnapshot().context.archivedOn).toBeNull();
    actor.send({ type: "ARCHIVE" });
    expect(actor.getSnapshot().context.archivedOn).not.toBeNull();
    // Should be a date string
    expect(actor.getSnapshot().context.archivedOn).toMatch(
      /^\d{4}-\d{2}-\d{2}/,
    );
    actor.stop();
  });
});
