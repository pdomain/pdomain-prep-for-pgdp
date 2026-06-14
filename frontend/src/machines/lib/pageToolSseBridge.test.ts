/**
 * pageToolSseBridge.test.ts
 *
 * I1 (PRODUCER test) — verifies the bridge translates a server `stage-status:
 * clean` SSE event into a PAGE_PUSH and that the PAGE_PUSH advances the
 * grayscaleToolMachine out of `converting`.
 *
 * ## Why this is the PRODUCER test
 *
 * Workspace rule: "test the producer, not just the consumer."
 * The consumer (grayscaleToolMachine) is already unit-tested with hand-fed
 * PAGE_PUSH events in `grayscaleTool.test.ts`. This test instead verifies the
 * BRIDGE (producer), which reads raw server events and constructs the PAGE_PUSH
 * payload. If the bridge is broken, the machine never leaves `converting`; if
 * the bridge correctly produces PAGE_PUSH, the machine advances to `done`.
 *
 * ## Test setup
 *
 * We inject a fake `subscribePageChannel` that synchronously emits server events.
 * The bridge is exercised through `subscribePageChannelForTool` (the public API)
 * with the fake injected as a dependency via module-level vi.mock.
 *
 * Because we need to control the `subscribePageChannel` import inside the bridge,
 * we use Vitest's `vi.mock` to replace the `@/services/sse` module.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createActor } from "xstate";
import {
  grayscaleToolMachine,
  type GrayscaleToolServices,
} from "../tools/grayscaleTool";
import { stubStageSettingsServices } from "../tools/stageSettings";
import type { PageChannelEvent } from "@/types/pipeline";

// ---------------------------------------------------------------------------
// Mock @/services/sse — inject a fake subscribePageChannel
// ---------------------------------------------------------------------------

// Capture the callback so we can emit events synchronously in tests.
const _capturedPageCallbacks = new Map<
  string,
  (event: PageChannelEvent) => void
>();

vi.mock("@/services/sse", () => ({
  subscribePageChannel: (
    projectId: string,
    pageId: string,
    cb: (event: PageChannelEvent) => void,
  ) => {
    const key = `${projectId}:${pageId}`;
    _capturedPageCallbacks.set(key, cb);
    return () => {
      _capturedPageCallbacks.delete(key);
    };
  },
}));

// Import the bridge AFTER the mock is set up.
import {
  subscribePageChannelForTool,
  type ToolPagePush,
} from "./pageToolSseBridge";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGrayscaleServices(
  overrides: Partial<GrayscaleToolServices> = {},
): GrayscaleToolServices {
  return {
    ...stubStageSettingsServices(),
    detectProfile: vi.fn().mockResolvedValue({
      mode: "perceptual",
      why: "test",
      backend: "cpu",
    }),
    ...overrides,
  };
}

async function waitForState(
  actor: ReturnType<typeof createActor<typeof grayscaleToolMachine>>,
  predicate: (s: ReturnType<typeof actor.getSnapshot>) => boolean,
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
// Tests
// ---------------------------------------------------------------------------

describe("pageToolSseBridge — subscribePageChannelForTool", () => {
  beforeEach(() => {
    _capturedPageCallbacks.clear();
  });

  it("calls onPagePush when a stage-status:clean event arrives for the watched stage", () => {
    const received: ToolPagePush[] = [];

    const unsub = subscribePageChannelForTool({
      projectId: "proj-1",
      stageId: "grayscale",
      totalPages: 1,
      getPageMode: (_idx0) => "perceptual",
      onPagePush: (page) => received.push(page),
    });

    // Simulate the server emitting a clean event for page 0.
    const cb = _capturedPageCallbacks.get("proj-1:0");
    expect(cb).toBeDefined();
    cb!({
      type: "stage-status",
      stage_id: "grayscale",
      status: "clean",
      job_id: null,
      error_message: null,
      last_run_at: 1_718_000_000,
      idx0: 0,
    });

    expect(received).toHaveLength(1);
    const page = received[0]!;
    expect(page.id).toBe("0000");
    expect(page.mode).toBe("perceptual");
    expect(page.lastRunAt).toBe(1_718_000_000);
    // totalPages=1, so _total should be set to signal the last page.
    expect(page._total).toBe(1);

    unsub();
  });

  it("does NOT call onPagePush for a different stage_id", () => {
    const received: ToolPagePush[] = [];

    const unsub = subscribePageChannelForTool({
      projectId: "proj-2",
      stageId: "grayscale",
      totalPages: 1,
      getPageMode: () => "standard",
      onPagePush: (page) => received.push(page),
    });

    const cb = _capturedPageCallbacks.get("proj-2:0");
    expect(cb).toBeDefined();
    cb!({
      type: "stage-status",
      stage_id: "crop", // different stage — should be ignored
      status: "clean",
      job_id: null,
      error_message: null,
    });

    expect(received).toHaveLength(0);
    unsub();
  });

  it("does NOT call onPagePush for non-clean status", () => {
    const received: ToolPagePush[] = [];

    const unsub = subscribePageChannelForTool({
      projectId: "proj-3",
      stageId: "grayscale",
      totalPages: 1,
      getPageMode: () => "perceptual",
      onPagePush: (page) => received.push(page),
    });

    const cb = _capturedPageCallbacks.get("proj-3:0");
    expect(cb).toBeDefined();
    cb!({
      type: "stage-status",
      stage_id: "grayscale",
      status: "running", // not clean
      job_id: null,
      error_message: null,
    });

    expect(received).toHaveLength(0);
    unsub();
  });

  it("sets _total only on the last page (multi-page project)", () => {
    const received: ToolPagePush[] = [];

    const unsub = subscribePageChannelForTool({
      projectId: "proj-4",
      stageId: "grayscale",
      totalPages: 3,
      getPageMode: () => "perceptual",
      onPagePush: (page) => received.push(page),
    });

    // Page 0 completes
    _capturedPageCallbacks.get("proj-4:0")!({
      type: "stage-status",
      stage_id: "grayscale",
      status: "clean",
      job_id: null,
      error_message: null,
      idx0: 0,
    });
    expect(received[0]!._total).toBeUndefined(); // not last

    // Page 1 completes
    _capturedPageCallbacks.get("proj-4:1")!({
      type: "stage-status",
      stage_id: "grayscale",
      status: "clean",
      job_id: null,
      error_message: null,
      idx0: 1,
    });
    expect(received[1]!._total).toBeUndefined(); // not last

    // Page 2 completes — this is the last
    _capturedPageCallbacks.get("proj-4:2")!({
      type: "stage-status",
      stage_id: "grayscale",
      status: "clean",
      job_id: null,
      error_message: null,
      idx0: 2,
    });
    expect(received[2]!._total).toBe(3); // sentinel set

    unsub();
  });

  it("deduplicates duplicate clean events for the same page", () => {
    const received: ToolPagePush[] = [];

    const unsub = subscribePageChannelForTool({
      projectId: "proj-5",
      stageId: "grayscale",
      totalPages: 1,
      getPageMode: () => "perceptual",
      onPagePush: (page) => received.push(page),
    });

    const cb = _capturedPageCallbacks.get("proj-5:0")!;
    cb({
      type: "stage-status",
      stage_id: "grayscale",
      status: "clean",
      job_id: null,
      error_message: null,
      idx0: 0,
    });
    cb({
      type: "stage-status",
      stage_id: "grayscale",
      status: "clean",
      job_id: null,
      error_message: null,
      idx0: 0,
    });

    // Second event should be ignored (deduplication).
    expect(received).toHaveLength(1);
    unsub();
  });
});

// ---------------------------------------------------------------------------
// Integration test: bridge → PAGE_PUSH → grayscaleToolMachine exits converting
// ---------------------------------------------------------------------------

describe("pageToolSseBridge — integration: grayscaleToolMachine advances out of converting", () => {
  beforeEach(() => {
    _capturedPageCallbacks.clear();
  });

  it("machine transitions from converting to done when bridge dispatches PAGE_PUSH with _total", async () => {
    const actor = createActor(grayscaleToolMachine, {
      input: {
        projectId: "proj-int",
        stageIndex: 1,
        services: makeGrayscaleServices(),
      },
    });
    actor.start();

    // Wait until the machine is in `converting` (after detectProfile resolves).
    await waitForState(actor, (s) => s.matches("converting"));
    expect(actor.getSnapshot().matches("converting")).toBe(true);

    // Wire the bridge — subscribe to page channel and dispatch PAGE_PUSH.
    const unsubBridge = subscribePageChannelForTool({
      projectId: "proj-int",
      stageId: "grayscale",
      totalPages: 1,
      getPageMode: (_idx0) =>
        actor.getSnapshot().context.detected?.mode ?? "perceptual",
      onPagePush: (page) => {
        actor.send({
          type: "PAGE_PUSH",
          // Cast to GrayscalePage — bridge ToolPagePush is structurally compatible.
          page: page as Parameters<typeof actor.send>[0] extends {
            type: "PAGE_PUSH";
            page: infer P;
          }
            ? P
            : never,
        });
      },
    });

    // Simulate the server emitting a clean event.
    const cb = _capturedPageCallbacks.get("proj-int:0");
    expect(cb).toBeDefined();
    cb!({
      type: "stage-status",
      stage_id: "grayscale",
      status: "clean",
      job_id: null,
      error_message: null,
      last_run_at: 1_718_000_100,
      idx0: 0,
    });

    // Machine should now be in `done`.
    await waitForState(actor, (s) => s.matches("done"));
    expect(actor.getSnapshot().matches("done")).toBe(true);

    // pages array should contain the one completed page.
    const ctx = actor.getSnapshot().context;
    expect(ctx.pages).toHaveLength(1);
    expect(ctx.pages[0]!.id).toBe("0000");
    expect(ctx.pages[0]!.mode).toBe("perceptual");

    unsubBridge();
    actor.stop();
  });
});
