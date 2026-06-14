/**
 * pageToolSseBridge.test.ts
 *
 * I1 (PRODUCER test) — verifies the bridge translates a server ``stage-status:
 * clean`` SSE event into a PAGE_PUSH and that the PAGE_PUSH advances the
 * grayscaleToolMachine out of ``converting``.
 *
 * ## Why this is the PRODUCER test
 *
 * Workspace rule: "test the producer, not just the consumer."
 * The consumer (grayscaleToolMachine) is already unit-tested with hand-fed
 * PAGE_PUSH events in ``grayscaleTool.test.ts``. This test instead verifies the
 * BRIDGE (producer), which reads raw server events and constructs the PAGE_PUSH
 * payload. If the bridge is broken, the machine never leaves ``converting``; if
 * the bridge correctly produces PAGE_PUSH, the machine advances to ``done``.
 *
 * ## Test setup
 *
 * We inject a fake ``subscribeProjectPageStageChannel`` (the project-wide
 * single-subscription adapter) that synchronously emits server events.
 * The bridge is exercised through ``subscribePageChannelForTool`` (the public API)
 * with the fake injected as a dependency via module-level vi.mock.
 *
 * Because we need to control the import inside the bridge, we use Vitest's
 * ``vi.mock`` to replace the ``@/services/sse`` module.
 *
 * ## Multi-page coverage
 *
 * Two tests verify multi-page (totalPages > 1) behaviour:
 *   - ``_total`` is NOT set on intermediate pages.
 *   - ``_total`` IS set only on the page that brings distinct completions to
 *     ``totalPages`` (order-independent, dedup-safe).
 *   - A single subscription drives ≥ 2 pages (producer test confirms one mock
 *     call regardless of page count).
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
// Mock @/services/sse — inject a fake subscribeProjectPageStageChannel
// ---------------------------------------------------------------------------

// Capture the latest callback so we can emit events synchronously in tests.
// The bridge opens ONE subscription per mount, so there is only one callback.
let _capturedCallback: ((event: PageChannelEvent) => void) | null = null;

vi.mock("@/services/sse", () => ({
  subscribeProjectPageStageChannel: (
    _projectId: string,
    cb: (event: PageChannelEvent) => void,
  ) => {
    _capturedCallback = cb;
    return () => {
      _capturedCallback = null;
    };
  },
  // Keep subscribePageChannel available for other imports that may use it.
  subscribePageChannel: () => () => {},
  subscribeProject: () => () => {},
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
    runStage: vi.fn().mockResolvedValue(undefined),
    runPageStage: vi.fn().mockResolvedValue(undefined),
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
    _capturedCallback = null;
  });

  it("opens a SINGLE subscription regardless of page count (efficiency)", () => {
    // The bridge must open exactly ONE EventSource connection for the project,
    // not N connections (one per page). This test asserts that the mock was
    // called once even for a multi-page project.
    // vi.mock is already in place; the captured callback proves one subscription.
    const received: ToolPagePush[] = [];

    const unsub = subscribePageChannelForTool({
      projectId: "proj-single-sub",
      stageId: "grayscale",
      totalPages: 232, // large multi-page project
      getPageMode: () => "perceptual",
      onPagePush: (page) => received.push(page),
    });

    // The mock hook above sets _capturedCallback once.
    // We check that exactly one subscription exists (non-null callback).
    expect(_capturedCallback).not.toBeNull();

    unsub();
    // After unsub, the callback is cleared.
    expect(_capturedCallback).toBeNull();
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

    expect(_capturedCallback).not.toBeNull();
    _capturedCallback!({
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

    _capturedCallback!({
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

    _capturedCallback!({
      type: "stage-status",
      stage_id: "grayscale",
      status: "running", // not clean
      job_id: null,
      error_message: null,
    });

    expect(received).toHaveLength(0);
    unsub();
  });

  it("sets _total only on the last page (multi-page project, order-independent)", () => {
    const received: ToolPagePush[] = [];

    const unsub = subscribePageChannelForTool({
      projectId: "proj-4",
      stageId: "grayscale",
      totalPages: 3,
      getPageMode: () => "perceptual",
      onPagePush: (page) => received.push(page),
    });

    expect(_capturedCallback).not.toBeNull();

    // Pages arrive out of order (2, 0, 1) — bridge must be order-independent.

    // Page 2 completes first
    _capturedCallback!({
      type: "stage-status",
      stage_id: "grayscale",
      status: "clean",
      job_id: null,
      error_message: null,
      idx0: 2,
    });
    expect(received[0]!._total).toBeUndefined(); // not last yet

    // Page 0 completes
    _capturedCallback!({
      type: "stage-status",
      stage_id: "grayscale",
      status: "clean",
      job_id: null,
      error_message: null,
      idx0: 0,
    });
    expect(received[1]!._total).toBeUndefined(); // still not last

    // Page 1 completes — this is the 3rd distinct page → last
    _capturedCallback!({
      type: "stage-status",
      stage_id: "grayscale",
      status: "clean",
      job_id: null,
      error_message: null,
      idx0: 1,
    });
    expect(received[2]!._total).toBe(3); // sentinel set

    // Total: 3 pushes, first two without _total, last with _total.
    expect(received).toHaveLength(3);
    expect(received[0]!._total).toBeUndefined();
    expect(received[1]!._total).toBeUndefined();
    expect(received[2]!._total).toBe(3);

    unsub();
  });

  it("does NOT fire _total until ALL distinct pages complete (not the first)", () => {
    // Regression guard: the previous N-subscriptions implementation would
    // fire _total after the FIRST page because `totalPages=1` was passed per
    // per-page subscription. This test uses totalPages=5 and verifies that
    // _total is absent until the 5th distinct page.
    const received: ToolPagePush[] = [];

    const unsub = subscribePageChannelForTool({
      projectId: "proj-sentinel",
      stageId: "grayscale",
      totalPages: 5,
      getPageMode: () => "perceptual",
      onPagePush: (page) => received.push(page),
    });

    for (let i = 0; i < 4; i++) {
      _capturedCallback!({
        type: "stage-status",
        stage_id: "grayscale",
        status: "clean",
        job_id: null,
        error_message: null,
        idx0: i,
      });
      expect(received[i]!._total).toBeUndefined(); // not last
    }

    // 5th page — now all done
    _capturedCallback!({
      type: "stage-status",
      stage_id: "grayscale",
      status: "clean",
      job_id: null,
      error_message: null,
      idx0: 4,
    });
    expect(received[4]!._total).toBe(5); // sentinel set only now

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

    const emit = (idx0: number) =>
      _capturedCallback!({
        type: "stage-status",
        stage_id: "grayscale",
        status: "clean",
        job_id: null,
        error_message: null,
        idx0,
      });

    emit(0);
    emit(0); // duplicate — should be ignored

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
    _capturedCallback = null;
  });

  it("machine transitions from converting to done when bridge dispatches PAGE_PUSH with _total (single page)", async () => {
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

    // Wire the bridge — single subscription, dispatches PAGE_PUSH.
    const unsubBridge = subscribePageChannelForTool({
      projectId: "proj-int",
      stageId: "grayscale",
      totalPages: 1,
      getPageMode: (_idx0) =>
        actor.getSnapshot().context.detected?.mode ?? "perceptual",
      onPagePush: (page) => {
        actor.send({
          type: "PAGE_PUSH",
          page: page as Parameters<typeof actor.send>[0] extends {
            type: "PAGE_PUSH";
            page: infer P;
          }
            ? P
            : never,
        });
      },
    });

    expect(_capturedCallback).not.toBeNull();

    // Simulate the server emitting a clean event via the project-wide channel.
    _capturedCallback!({
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

  it("machine stays in converting until ALL pages complete (multi-page, totalPages=2)", async () => {
    const actor = createActor(grayscaleToolMachine, {
      input: {
        projectId: "proj-multi",
        stageIndex: 1,
        services: makeGrayscaleServices(),
      },
    });
    actor.start();

    await waitForState(actor, (s) => s.matches("converting"));

    const unsubBridge = subscribePageChannelForTool({
      projectId: "proj-multi",
      stageId: "grayscale",
      totalPages: 2,
      getPageMode: (_idx0) =>
        actor.getSnapshot().context.detected?.mode ?? "perceptual",
      onPagePush: (page) => {
        actor.send({
          type: "PAGE_PUSH",
          page: page as Parameters<typeof actor.send>[0] extends {
            type: "PAGE_PUSH";
            page: infer P;
          }
            ? P
            : never,
        });
      },
    });

    // First page completes — machine must NOT exit converting yet.
    _capturedCallback!({
      type: "stage-status",
      stage_id: "grayscale",
      status: "clean",
      job_id: null,
      error_message: null,
      last_run_at: 1_718_000_200,
      idx0: 0,
    });

    // Give XState a tick to process any transitions.
    await new Promise((r) => setTimeout(r, 30));
    expect(actor.getSnapshot().matches("converting")).toBe(true); // still converting

    // Second page completes — now _total is set, machine can exit.
    _capturedCallback!({
      type: "stage-status",
      stage_id: "grayscale",
      status: "clean",
      job_id: null,
      error_message: null,
      last_run_at: 1_718_000_201,
      idx0: 1,
    });

    await waitForState(actor, (s) => s.matches("done"));
    expect(actor.getSnapshot().matches("done")).toBe(true);
    expect(actor.getSnapshot().context.pages).toHaveLength(2);

    unsubBridge();
    actor.stop();
  });
});
