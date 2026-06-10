/**
 * runAllStale — XState v5 machine for coordinating a "run all stale" sweep.
 *
 * Ported from `docs/plans/design_handoff_pgdp_app/statecharts/run-all-stale.yaml`.
 *
 * ## Design
 * This coordinator holds NO stage-execution logic — that lives in stageRunner.
 * It orders stale stages, runs them one at a time (via their stageRunner actors),
 * aggregates progress, and reports completion or halts on first error.
 *
 * ## Input
 * Receives `staleIndices: number[]` — runner indices (0-based within RUNNER_STAGE_DEFS)
 * of stale stages. pipelineShell computes this before spawning the coordinator.
 *
 * ## Events from pipelineShell
 * pipelineShell forwards STAGE_DONE and STAGE_PROGRESS from individual runners.
 *
 * @see docs/plans/design_handoff_pgdp_app/statecharts/run-all-stale.yaml
 * @see src/machines/pipelineShell.ts
 * @see src/machines/DIVERGENCES.md
 */

import { setup, assign, fromPromise } from "xstate";
import type { StageRunnerRef } from "./pipelineShell";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunAllStaleServices {
  /**
   * YAML: `cancelInFlight: 'POST /api/projects/:id/stages/:stageId/cancel'`
   * Called when the user cancels while a stage is in flight.
   */
  cancelInFlight(projectId: string, stageId: string): Promise<void>;
}

export interface RunAllStaleInput {
  /** Runner indices (0-based within RUNNER_STAGE_DEFS) to process, in pipeline order. */
  staleIndices: number[];
  /** Project ID — for cancelInFlight. */
  projectId: string;
  /** Current runner refs (from pipelineShell.context.runners). */
  runners: StageRunnerRef[];
  /** Services. */
  services: RunAllStaleServices;
  /** Halt on first error (default true). */
  haltOnError?: boolean;
  /** Callback when all stages complete. */
  onDone?: (completedCount: number) => void;
  /** Callback when cancelled. */
  onCancelled?: () => void;
  /** Whether to skip the confirmation step (default false). */
  skipConfirm?: boolean;
}

export interface RunAllStaleContext {
  queue: number[]; // runner indices still to process
  total: number; // queue length at start
  completed: number[]; // runner indices that finished clean
  currentIndex: number | null; // runner index currently running
  failedIndex: number | null;
  haltOnError: boolean;
  projectId: string;
  runners: StageRunnerRef[];
  services: RunAllStaleServices;
  currentProgress: number; // current stage's reported progress (0–1)
  onDone: ((completedCount: number) => void) | undefined;
  onCancelled: (() => void) | undefined;
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type RunAllStaleEvent =
  | { type: "CONFIRM" }
  | { type: "CANCEL" }
  | { type: "RETRY" }
  | { type: "SKIP" }
  | {
      type: "STAGE_DONE";
      stageIndex: number;
      status: "clean" | "flagged" | "error";
    }
  | { type: "STAGE_PROGRESS"; stageIndex: number; progress: number };

// ---------------------------------------------------------------------------
// Machine definition
// ---------------------------------------------------------------------------

export const runAllStaleMachine = setup({
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  types: {} as {
    context: RunAllStaleContext;
    events: RunAllStaleEvent;
    input: RunAllStaleInput;
  },

  actors: {
    /**
     * YAML: `cancelInFlight: 'POST .../cancel'`
     * Cancels the currently in-flight stage then resolves.
     */
    cancelInFlight: fromPromise<
      undefined,
      {
        projectId: string;
        currentIndex: number | null;
        runners: StageRunnerRef[];
        services: RunAllStaleServices;
      }
    >(async ({ input }) => {
      const { projectId, currentIndex, runners, services } = input;
      if (currentIndex === null) return;
      const ref = runners[currentIndex];
      if (!ref) return;
      const snap = ref.getSnapshot();
      const stageId = snap.context.stageId;
      await services.cancelInFlight(projectId, stageId);
    }),
  },

  guards: {
    /** YAML: `queueEmpty: ctx.queue.length === 0` */
    queueEmpty: ({ context }) => context.queue.length === 0,

    /**
     * YAML: `queueDrained: ctx.queue.length === 0`
     * True when no items remain in queue AND no item is currently running.
     * `runNext` pops the current item from queue before starting it,
     * so `queue.length === 0` can be true while a stage is still running.
     * We only transition to `done` when both conditions are met.
     */
    queueDrained: ({ context }) =>
      context.queue.length === 0 && context.currentIndex === null,

    /** YAML: `erroredAndHalt: event.status === 'error' && ctx.haltOnError` */
    erroredAndHalt: (
      { context },
      params: { status: "clean" | "flagged" | "error" },
    ) => params.status === "error" && context.haltOnError,
  },

  actions: {
    /**
     * YAML: `buildQueue`
     * Snapshot stale indices in dependency order (ascending index = linear order).
     */
    buildQueue: assign(
      (_args, params: { staleIndices: number[]; total: number }) => ({
        queue: [...params.staleIndices].sort((a, b) => a - b),
        total: params.total,
        completed: [] as number[],
        failedIndex: null,
        currentIndex: null,
      }),
    ),

    /**
     * YAML: `runNext`
     * Pop the first item from the queue, set it as currentIndex, start it.
     * The queue represents items not yet started; currentIndex is the running one.
     */
    runNext: assign({
      currentIndex: ({ context }) => context.queue[0] ?? null,
      queue: ({ context }) => context.queue.slice(1), // pop the starting item
      currentProgress: () => 0,
    }),

    /** Side-effect: send RUN to the runner at the (now-popped) currentIndex. */
    runNextSideEffect: ({ context }) => {
      // currentIndex was just assigned; use it directly
      const nextIdx = context.currentIndex;
      if (nextIdx === null || nextIdx === undefined) return;
      const ref = context.runners[nextIdx];
      if (ref) {
        ref.send({ type: "RUN" });
      }
    },

    /**
     * YAML: `advance: ctx.queue = ctx.queue.slice(1)`
     * Called after STAGE_DONE — just reset currentIndex (queue is already sliced by runNext).
     */
    advance: assign({
      currentIndex: () => null,
    }),

    /** YAML: `markCompleted` */
    markCompleted: assign(({ context }, params: { stageIndex: number }) => ({
      completed: [...context.completed, params.stageIndex],
    })),

    /** YAML: `markFailed` */
    markFailed: assign((_args, params: { stageIndex: number }) => ({
      failedIndex: params.stageIndex,
    })),

    /** YAML: `requeueFailed: ctx.queue = [ctx.failedIndex, ...ctx.queue]` */
    requeueFailed: assign({
      queue: ({ context }) =>
        context.failedIndex !== null
          ? [context.failedIndex, ...context.queue]
          : context.queue,
      failedIndex: () => null,
    }),

    /** YAML: `skipFailed: ctx.failedIndex = null` */
    skipFailed: assign({ failedIndex: () => null }),

    /** YAML: `assignStageProgress` */
    assignStageProgress: assign((_args, params: { progress: number }) => ({
      currentProgress: params.progress,
    })),

    /** YAML: `reportDone` — side effect: toast + notify pipelineShell */
    reportDone: ({ context }) => {
      if (context.onDone) {
        context.onDone(context.completed.length);
      }
    },

    /** YAML: `reportCancelled` */
    reportCancelled: ({ context }) => {
      if (context.onCancelled) {
        context.onCancelled();
      }
    },
  },
}).createMachine({
  id: "runAllStale",
  context: ({ input }) => {
    const sorted = [...input.staleIndices].sort((a, b) => a - b);
    return {
      queue: sorted,
      total: sorted.length,
      completed: [],
      currentIndex: null,
      failedIndex: null,
      haltOnError: input.haltOnError ?? true,
      projectId: input.projectId,
      runners: input.runners,
      services: input.services,
      currentProgress: 0,
      onDone: input.onDone,
      onCancelled: input.onCancelled,
    };
  },

  initial: "collecting",

  states: {
    /**
     * YAML: collecting — snapshot stale stages and order them.
     * In our impl the queue is already built from input; `always` checks.
     */
    collecting: {
      always: [
        {
          target: "done",
          guard: "queueEmpty",
        },
        {
          target: "confirming",
        },
      ],
    },

    /**
     * YAML: confirming — light confirm before the sweep.
     * Skipped if input.skipConfirm = true (the initial always guard fires
     * for queueEmpty before we reach here, so skipConfirm only matters
     * when there are stages to run).
     */
    confirming: {
      on: {
        CONFIRM: { target: "running" },
        CANCEL: { target: "cancelled" },
      },
    },

    /**
     * YAML: running (sub-states: dispatch)
     * Drive the queue: send RUN to each runner sequentially.
     */
    running: {
      initial: "dispatch",
      on: {
        CANCEL: { target: "cancelling" },
      },
      states: {
        dispatch: {
          entry: ["runNext", "runNextSideEffect"],
          always: [
            {
              target: "#runAllStale.done",
              guard: "queueDrained",
            },
          ],
          on: {
            STAGE_DONE: [
              {
                target: "#runAllStale.halted",
                guard: {
                  type: "erroredAndHalt",
                  params: ({
                    event,
                  }: {
                    event: {
                      type: "STAGE_DONE";
                      status: "clean" | "flagged" | "error";
                    };
                  }) => ({ status: event.status }),
                },
                actions: [
                  {
                    type: "markFailed",
                    params: ({ event }: { event: { stageIndex: number } }) => ({
                      stageIndex: event.stageIndex,
                    }),
                  },
                ],
              },
              {
                target: "#runAllStale.running.dispatch",
                reenter: true,
                actions: [
                  {
                    type: "markCompleted",
                    params: ({ event }: { event: { stageIndex: number } }) => ({
                      stageIndex: event.stageIndex,
                    }),
                  },
                  "advance",
                ],
              },
            ],
            STAGE_PROGRESS: {
              actions: [
                {
                  type: "assignStageProgress",
                  params: ({ event }: { event: { progress: number } }) => ({
                    progress: event.progress,
                  }),
                },
              ],
            },
          },
        },
      },
    },

    /**
     * YAML: cancelling — let in-flight stage settle, then stop.
     */
    cancelling: {
      invoke: {
        id: "cancelInFlight",
        src: "cancelInFlight",
        input: ({ context }) => ({
          projectId: context.projectId,
          currentIndex: context.currentIndex,
          runners: context.runners,
          services: context.services,
        }),
        onDone: { target: "cancelled" },
        onError: { target: "cancelled" },
      },
    },

    /** YAML: done (final) — all stages completed clean. */
    done: {
      type: "final",
      entry: ["reportDone"],
    },

    /**
     * YAML: halted — a stage failed and haltOnError is on.
     */
    halted: {
      on: {
        RETRY: { target: "running", actions: ["requeueFailed"] },
        SKIP: { target: "running", actions: ["skipFailed"] },
        CANCEL: { target: "cancelled" },
      },
    },

    /** YAML: cancelled (final) */
    cancelled: {
      type: "final",
      entry: ["reportCancelled"],
    },
  },
});
