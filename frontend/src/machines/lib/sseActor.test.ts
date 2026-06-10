/**
 * Tests for sseActor — XState actor wrapping an injected subscription function.
 *
 * We use a fake subscription that synchronously emits events to verify the
 * actor forwards them correctly as typed machine events.
 *
 * All tests are pure-logic (no DOM, no EventSource) — the actor accepts an
 * injected subscription function, so we inject a fake.
 */

import { describe, it, expect, vi } from "vitest";
import { createActor, setup, assign } from "xstate";
import { createSseActor } from "./sseActor";
import type { SseMachineEvent, SubscriptionFn } from "./sseActor";
import type {
  ProjectChannelEvent,
  PageChannelEvent,
  ProjectStageState,
  PageStageState,
} from "@/mocks/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal ProjectStageState fixture. */
function makeProjectStage(
  stageId: string,
  status: ProjectStageState["status"] = "not_run",
): ProjectStageState {
  return {
    project_id: "proj-1",
    stage_id: stageId,
    status,
    stage_version: 2,
    artifact_key: null,
    config_hash: null,
    input_hash: null,
    last_run_at: null,
    duration_ms: null,
    error_message: null,
    job_id: null,
  };
}

/** Build a minimal PageStageState fixture. */
function makePageStage(
  stageId: string,
  status: PageStageState["status"] = "not_run",
): PageStageState {
  return {
    page_id: "0000",
    stage_id: stageId,
    status,
    stage_version: 2,
    artifact_key: null,
    config_hash: null,
    input_hash: null,
    last_run_at: null,
    duration_ms: null,
    error_message: null,
    job_id: null,
  };
}

// ---------------------------------------------------------------------------
// Minimal parent machine that collects SseMachineEvents for assertions
// ---------------------------------------------------------------------------

function makeHarness(subscriptionFn: SubscriptionFn<ProjectChannelEvent>) {
  const received: SseMachineEvent[] = [];

  const machine = setup({
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    types: {} as {
      context: { events: SseMachineEvent[] };
      events: SseMachineEvent;
    },
    actors: {
      sseListener: createSseActor(subscriptionFn, "proj-1"),
    },
  }).createMachine({
    context: { events: [] },
    invoke: {
      id: "sse",
      src: "sseListener",
    },
    on: {
      STATUS_PUSH: {
        actions: assign({
          events: ({ context, event }) => [...context.events, event],
        }),
      },
      STAGE_PUSH: {
        actions: assign({
          events: ({ context, event }) => [...context.events, event],
        }),
      },
      PROGRESS_PUSH: {
        actions: assign({
          events: ({ context, event }) => [...context.events, event],
        }),
      },
    },
  });

  const actor = createActor(machine);
  actor.subscribe((snap) => {
    received.length = 0;
    received.push(...snap.context.events);
  });
  actor.start();
  return { actor, received };
}

// ---------------------------------------------------------------------------
// Helper: assert first received event matches expected type narrowing
// ---------------------------------------------------------------------------

/** Assert exactly one event was received, return it. */
function assertSingleEvent(received: SseMachineEvent[]): SseMachineEvent {
  expect(received).toHaveLength(1);
  const ev = received[0];
  expect(ev).toBeDefined();

  return ev!;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createSseActor", () => {
  it("calls the subscription function with the projectId on start", () => {
    const subscribe = vi.fn().mockReturnValue(() => undefined);
    const sseActorDef = createSseActor(
      subscribe as unknown as SubscriptionFn<ProjectChannelEvent>,
      "proj-abc",
    );
    const actor = createActor(sseActorDef);
    actor.start();
    expect(subscribe).toHaveBeenCalledWith("proj-abc", expect.any(Function));
    actor.stop();
  });

  it("calls the unsubscribe fn returned by the subscription when stopped", () => {
    const unsubscribe = vi.fn();
    const subscribe = vi.fn().mockReturnValue(unsubscribe);
    const sseActorDef = createSseActor(
      subscribe as unknown as SubscriptionFn<ProjectChannelEvent>,
      "proj-abc",
    );
    const actor = createActor(sseActorDef);
    actor.start();
    actor.stop();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("forwards project-snapshot as STATUS_PUSH snapshot", () => {
    let emit: ((event: ProjectChannelEvent) => void) | undefined;
    const subscribe = vi
      .fn()
      .mockImplementation(
        (_id: string, cb: (event: ProjectChannelEvent) => void) => {
          emit = cb;
          return () => undefined;
        },
      );

    const { received } = makeHarness(
      subscribe as SubscriptionFn<ProjectChannelEvent>,
    );

    const stages = [makeProjectStage("source", "clean")];
    emit!({ type: "project-snapshot", project_stages: stages });

    const ev = assertSingleEvent(received);
    expect(ev.type).toBe("STATUS_PUSH");
    if (ev.type === "STATUS_PUSH" && ev.variant === "snapshot") {
      expect(ev.project_stages).toEqual(stages);
    } else {
      throw new Error("Expected STATUS_PUSH/snapshot");
    }
  });

  it("forwards project-stage-status as STATUS_PUSH stage-status", () => {
    let emit: ((event: ProjectChannelEvent) => void) | undefined;
    const subscribe = vi
      .fn()
      .mockImplementation(
        (_id: string, cb: (event: ProjectChannelEvent) => void) => {
          emit = cb;
          return () => undefined;
        },
      );

    const { received } = makeHarness(
      subscribe as SubscriptionFn<ProjectChannelEvent>,
    );

    emit!({
      type: "project-stage-status",
      stage_id: "validation",
      status: "clean",
      job_id: null,
      error_message: null,
    });

    const ev = assertSingleEvent(received);
    expect(ev.type).toBe("STATUS_PUSH");
    if (ev.type === "STATUS_PUSH" && ev.variant === "stage-status") {
      expect(ev.stage_id).toBe("validation");
      expect(ev.status).toBe("clean");
    } else {
      throw new Error("Expected STATUS_PUSH/stage-status");
    }
  });

  it("forwards project-stage-progress as PROGRESS_PUSH", () => {
    let emit: ((event: ProjectChannelEvent) => void) | undefined;
    const subscribe = vi
      .fn()
      .mockImplementation(
        (_id: string, cb: (event: ProjectChannelEvent) => void) => {
          emit = cb;
          return () => undefined;
        },
      );

    const { received } = makeHarness(
      subscribe as SubscriptionFn<ProjectChannelEvent>,
    );

    emit!({
      type: "project-stage-progress",
      stage_id: "build_package",
      progress: 0.42,
      message: "Processing...",
    });

    const ev = assertSingleEvent(received);
    expect(ev.type).toBe("PROGRESS_PUSH");
    if (ev.type === "PROGRESS_PUSH") {
      expect(ev.stage_id).toBe("build_package");
      expect(ev.progress).toBe(0.42);
    } else {
      throw new Error("Expected PROGRESS_PUSH");
    }
  });

  it("forwards page-reorder as STATUS_PUSH page-reorder", () => {
    let emit: ((event: ProjectChannelEvent) => void) | undefined;
    const subscribe = vi
      .fn()
      .mockImplementation(
        (_id: string, cb: (event: ProjectChannelEvent) => void) => {
          emit = cb;
          return () => undefined;
        },
      );

    const { received } = makeHarness(
      subscribe as SubscriptionFn<ProjectChannelEvent>,
    );

    emit!({
      type: "page-reorder",
      new_order: ["0002", "0000", "0001"],
    });

    const ev = assertSingleEvent(received);
    expect(ev.type).toBe("STATUS_PUSH");
    if (ev.type === "STATUS_PUSH" && ev.variant === "page-reorder") {
      expect(ev.new_order).toEqual(["0002", "0000", "0001"]);
    } else {
      throw new Error("Expected STATUS_PUSH/page-reorder");
    }
  });

  it("forwards validation-updated as STATUS_PUSH validation-updated", () => {
    let emit: ((event: ProjectChannelEvent) => void) | undefined;
    const subscribe = vi
      .fn()
      .mockImplementation(
        (_id: string, cb: (event: ProjectChannelEvent) => void) => {
          emit = cb;
          return () => undefined;
        },
      );

    const { received } = makeHarness(
      subscribe as SubscriptionFn<ProjectChannelEvent>,
    );

    emit!({
      type: "validation-updated",
      blockers: 0,
      warnings: 2,
      status: "clean",
    });

    const ev = assertSingleEvent(received);
    expect(ev.type).toBe("STATUS_PUSH");
    if (ev.type === "STATUS_PUSH" && ev.variant === "validation-updated") {
      expect(ev.blockers).toBe(0);
      expect(ev.warnings).toBe(2);
    } else {
      throw new Error("Expected STATUS_PUSH/validation-updated");
    }
  });

  it("works with page channel events (stage-status → STAGE_PUSH)", () => {
    let emit: ((event: PageChannelEvent) => void) | undefined;
    const subscribe = vi
      .fn()
      .mockImplementation(
        (_id: string, cb: (event: PageChannelEvent) => void) => {
          emit = cb;
          return () => undefined;
        },
      );

    const received: SseMachineEvent[] = [];
    const sseActorDef = createSseActor(
      subscribe as SubscriptionFn<PageChannelEvent>,
      "proj-1",
    );

    const machine = setup({
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      types: {} as {
        context: { events: SseMachineEvent[] };
        events: SseMachineEvent;
      },
      actors: { sse: sseActorDef },
    }).createMachine({
      context: { events: [] },
      invoke: { id: "sse", src: "sse" },
      on: {
        STAGE_PUSH: {
          actions: assign({
            events: ({ context, event }) => [...context.events, event],
          }),
        },
      },
    });

    const actor = createActor(machine);
    actor.subscribe((snap) => {
      received.length = 0;
      received.push(...snap.context.events);
    });
    actor.start();

    emit!({
      type: "stage-status",
      stage_id: "grayscale",
      status: "clean",
      job_id: null,
      error_message: null,
    });

    const ev = assertSingleEvent(received);
    expect(ev.type).toBe("STAGE_PUSH");
    if (ev.type === "STAGE_PUSH" && ev.variant === "status") {
      expect(ev.stage_id).toBe("grayscale");
      expect(ev.status).toBe("clean");
    } else {
      throw new Error("Expected STAGE_PUSH/status");
    }
  });

  it("forwards stage-progress as STAGE_PUSH progress variant", () => {
    let emit: ((event: PageChannelEvent) => void) | undefined;
    const subscribe = vi
      .fn()
      .mockImplementation(
        (_id: string, cb: (event: PageChannelEvent) => void) => {
          emit = cb;
          return () => undefined;
        },
      );

    const received: SseMachineEvent[] = [];
    const sseActorDef = createSseActor(
      subscribe as SubscriptionFn<PageChannelEvent>,
      "proj-1",
    );

    const machine = setup({
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      types: {} as {
        context: { events: SseMachineEvent[] };
        events: SseMachineEvent;
      },
      actors: { sse: sseActorDef },
    }).createMachine({
      context: { events: [] },
      invoke: { id: "sse", src: "sse" },
      on: {
        STAGE_PUSH: {
          actions: assign({
            events: ({ context, event }) => [...context.events, event],
          }),
        },
      },
    });

    const actor = createActor(machine);
    actor.subscribe((snap) => {
      received.length = 0;
      received.push(...snap.context.events);
    });
    actor.start();

    emit!({
      type: "stage-progress",
      stage_id: "ocr",
      progress: 0.75,
      message: "Processing page 9/12",
    });

    const ev = assertSingleEvent(received);
    expect(ev.type).toBe("STAGE_PUSH");
    if (ev.type === "STAGE_PUSH" && ev.variant === "progress") {
      expect(ev.stage_id).toBe("ocr");
      expect(ev.progress).toBe(0.75);
    } else {
      throw new Error("Expected STAGE_PUSH/progress");
    }
  });

  it("forwards page-channel snapshot as STATUS_PUSH page-snapshot", () => {
    let emit: ((event: PageChannelEvent) => void) | undefined;
    const subscribe = vi
      .fn()
      .mockImplementation(
        (_id: string, cb: (event: PageChannelEvent) => void) => {
          emit = cb;
          return () => undefined;
        },
      );

    const received: SseMachineEvent[] = [];
    const sseActorDef = createSseActor(
      subscribe as SubscriptionFn<PageChannelEvent>,
      "proj-1",
    );

    const machine = setup({
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      types: {} as {
        context: { events: SseMachineEvent[] };
        events: SseMachineEvent;
      },
      actors: { sse: sseActorDef },
    }).createMachine({
      context: { events: [] },
      invoke: { id: "sse", src: "sse" },
      on: {
        STATUS_PUSH: {
          actions: assign({
            events: ({ context, event }) => [...context.events, event],
          }),
        },
      },
    });

    const actor = createActor(machine);
    actor.subscribe((snap) => {
      received.length = 0;
      received.push(...snap.context.events);
    });
    actor.start();

    const stages = [makePageStage("grayscale", "clean")];
    emit!({ type: "snapshot", stages });

    const ev = assertSingleEvent(received);
    expect(ev.type).toBe("STATUS_PUSH");
    if (ev.type === "STATUS_PUSH") {
      expect(ev.variant).toBe("page-snapshot");
    } else {
      throw new Error("Expected STATUS_PUSH/page-snapshot");
    }
  });
});
