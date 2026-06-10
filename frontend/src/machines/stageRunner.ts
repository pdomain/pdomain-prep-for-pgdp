/**
 * stageRunner — XState v5 machine for a single pipeline stage lifecycle.
 *
 * Ported from `docs/plans/design_handoff_pgdp_app/statecharts/stage-runner.yaml`
 * per the mechanical mapping in `statecharts/README.md §Porting to XState v5`.
 *
 * One definition, spawned ×23 by `pipelineShell` (one per stage 02–24).
 * Parameterized by `input: { stageId, index, group, projectId, pageScoped, services }`.
 *
 * ## State lifecycle
 *   notrun → queued → running → (clean | flagged | error)
 *   + stale (upstream re-ran or settings changed)
 *
 * ## Server authority
 * Optimistic RUN/RETRY intents; `STAGE_PUSH` reconciles to backend truth.
 *
 * ## Service injection
 * Services are injected via `input.services` (see `query.ts` pattern).
 *
 * @see docs/plans/design_handoff_pgdp_app/statecharts/stage-runner.yaml
 * @see docs/specs/machine-stage-map.md §3 — stageRunner ×23 (source excluded)
 * @see src/machines/lib/query.ts — service injection pattern
 * @see src/machines/DIVERGENCES.md — YAML vs contract divergences
 */

import { setup, assign, fromPromise } from "xstate";
import type { StagePushEvent } from "./lib/sseActor";
import type { PageRef } from "./lib/query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Run outcome resolved by the runStage actor. */
export interface RunStageOutcome {
  status: string;
  flaggedPages?: PageRef[];
  artifactBytes?: number;
  code?: string;
  message?: string;
}

export interface StageRunnerServices {
  /**
   * Execute the stage. Resolves with outcome.
   * Named `runStage` in the YAML `services:` dictionary.
   */
  runStage(
    projectId: string,
    stageId: string,
    request?: { force?: boolean },
  ): Promise<RunStageOutcome>;

  /** POST cancel intent (optimistic). */
  requestCancel(projectId: string, stageId: string): Promise<void>;

  /** POST pause intent (optimistic). */
  requestPause(projectId: string, stageId: string): Promise<void>;
}

export interface StageRunnerInput {
  stageId: string;
  index: number;
  group: string;
  projectId: string;
  pageScoped: boolean;
  services: StageRunnerServices;
}

export interface StageRunnerContext {
  stageId: string;
  index: number;
  group: string;
  projectId: string;
  pageScoped: boolean;
  services: StageRunnerServices;
  progress: number;
  flaggedPages: PageRef[];
  flaggedCount: number;
  staleReason: "upstream_changed" | "settings_changed" | null;
  /** Transient: stores the autoRerun flag from UPSTREAM_CHANGED for the always guard. */
  _pendingAutoRerun: boolean;
  startedAt: string | null;
  durationMs: number | null;
  artifactBytes: number | null;
  error: { message: string; code?: string } | null;
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type StageRunnerEvent =
  | { type: "RUN" }
  | { type: "START" }
  | { type: "CANCEL" }
  | { type: "PAUSE" }
  | { type: "RETRY" }
  | { type: "RERUN" }
  | { type: "PROGRESS"; value: number }
  | { type: "UPSTREAM_CHANGED"; autoRerun: boolean }
  | { type: "SETTINGS_CHANGED" }
  | { type: "RESOLVE"; resolvedIds: string[] }
  | StagePushEvent;

// ---------------------------------------------------------------------------
// Machine definition
// ---------------------------------------------------------------------------

export const stageRunnerMachine = setup({
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  types: {} as {
    context: StageRunnerContext;
    events: StageRunnerEvent;
    input: StageRunnerInput;
  },
  actors: {
    /**
     * YAML: `invoke.src: runStage`
     * Resolves with the run outcome.
     *
     * DIVERGENCE #1: YAML models runStage as a streaming service (PROGRESS
     * ticks + final resolve). XState v5 `fromPromise` only supports the
     * resolve path. PROGRESS events are sent separately from the PROGRESS_PUSH
     * SSE actor (at I1). See DIVERGENCES.md.
     */
    runStage: fromPromise<
      RunStageOutcome,
      { projectId: string; stageId: string; services: StageRunnerServices }
    >(({ input }) => input.services.runStage(input.projectId, input.stageId)),
  },
  guards: {
    /**
     * YAML: `outcomeFailed: event.data.status === 'error'`
     * XState v5: the onDone event carries `output` not `data`.
     * See DIVERGENCES.md #3.
     */
    outcomeFailed: (_args, params: { output: RunStageOutcome }) =>
      params.output.status === "error",

    /**
     * YAML: `outcomeHasFlags: (event.data.flaggedPages?.length ?? 0) > 0`
     */
    outcomeHasFlags: (_args, params: { output: RunStageOutcome }) =>
      (params.output.flaggedPages?.length ?? 0) > 0,

    /**
     * YAML: `allPagesResolved: ctx.flaggedPages.filter(...).length === 0`
     */
    allPagesResolved: ({ context, event }) => {
      if (event.type !== "RESOLVE") return false;
      const remaining = context.flaggedPages.filter(
        (p) => !event.resolvedIds.includes(p.pageId),
      );
      return remaining.length === 0;
    },

    /**
     * YAML: `autoRerunEnabled: ctx.staleReason != null && event?.autoRerun === true`
     *
     * DIVERGENCE #2: The YAML guard reads `event.autoRerun` from the
     * triggering UPSTREAM_CHANGED event. In XState v5, `always` transitions
     * fire on state entry with no current event — they can only read context.
     * We store the autoRerun flag in `_pendingAutoRerun` during `markStale`
     * and read it here. See DIVERGENCES.md.
     */
    autoRerunEnabled: ({ context }) =>
      context.staleReason !== null && context._pendingAutoRerun,
  },
  actions: {
    /** YAML: `assignProgress: ctx.progress = event.value` */
    assignProgress: assign({
      progress: ({ event }) => {
        if (event.type !== "PROGRESS") return 0;
        return event.value;
      },
    }),

    /** YAML: `stampStart: ctx.startedAt = now(); ctx.progress = 0` */
    stampStart: assign({
      startedAt: () => new Date().toISOString(),
      progress: () => 0,
    }),

    /** YAML: `stampDuration: ctx.durationMs = since(ctx.startedAt); ctx.progress = 1` */
    stampDuration: assign({
      durationMs: ({ context }) => {
        if (!context.startedAt) return 0;
        return Date.now() - new Date(context.startedAt).getTime();
      },
      progress: () => 1,
    }),

    /**
     * YAML: `assignFlagged: ctx.flaggedPages = ...; ctx.flaggedCount = ...; ctx.staleReason = null`
     * Receives the actor output via the `params` argument pattern.
     */
    assignFlagged: assign(
      ({ context }, params: { output: RunStageOutcome }) => ({
        flaggedPages: params.output.flaggedPages ?? [],
        flaggedCount: params.output.flaggedPages?.length ?? 0,
        artifactBytes: params.output.artifactBytes ?? context.artifactBytes,
        staleReason: null,
        _pendingAutoRerun: false,
      }),
    ),

    /** YAML: `clearFlagged: ctx.flaggedPages = []; ctx.flaggedCount = 0; ctx.staleReason = null` */
    clearFlagged: assign({
      flaggedPages: () => [] as PageRef[],
      flaggedCount: () => 0,
      staleReason: () => null,
      _pendingAutoRerun: () => false,
    }),

    /** YAML: `removeResolvedPages` */
    removeResolvedPages: assign({
      flaggedPages: ({ context, event }) => {
        if (event.type !== "RESOLVE") return context.flaggedPages;
        return context.flaggedPages.filter(
          (p) => !event.resolvedIds.includes(p.pageId),
        );
      },
      flaggedCount: ({ context, event }) => {
        if (event.type !== "RESOLVE") return context.flaggedCount;
        return context.flaggedPages.filter(
          (p) => !event.resolvedIds.includes(p.pageId),
        ).length;
      },
    }),

    /** YAML: `markStale: ctx.staleReason = 'upstream_changed'` */
    markStale: assign({
      staleReason: () => "upstream_changed" as const,
      /** Store autoRerun flag for the always guard in `stale`. See DIVERGENCES.md #2. */
      _pendingAutoRerun: ({ event }) => {
        if (event.type !== "UPSTREAM_CHANGED") return false;
        return event.autoRerun;
      },
    }),

    /** YAML: `markStaleSettings: ctx.staleReason = 'settings_changed'` */
    markStaleSettings: assign({
      staleReason: () => "settings_changed" as const,
      _pendingAutoRerun: () => false,
    }),

    /**
     * YAML: `assignError` — called from onDone(status=error).
     * Params carries the resolved outcome.
     */
    assignError: assign(
      (
        _args,
        params: { output: RunStageOutcome },
      ): Partial<StageRunnerContext> => {
        const err: { message: string; code?: string } = {
          message: params.output.message ?? "Stage failed",
        };
        if (params.output.code !== undefined) {
          err.code = params.output.code;
        }
        return { error: err };
      },
    ),

    /**
     * Like assignError but for onError (promise rejection).
     * Params carries the rejection reason.
     */
    assignErrorFromReject: assign(
      (_args, params: { error: unknown }): Partial<StageRunnerContext> => {
        let msg: string;
        if (params.error instanceof Error) {
          msg = params.error.message;
        } else if (typeof params.error === "string") {
          msg = params.error;
        } else {
          msg = "Unknown error";
        }
        return { error: { message: msg } };
      },
    ),

    /** YAML: `clearError: ctx.error = null` */
    clearError: assign({ error: () => null }),

    /**
     * YAML: `reconcile: // sync state + counts to backend truth`
     * Side effect slot — noop in tests; real impl at I1 navigates machine state.
     */
    reconcile: () => {
      // At I1: compare STAGE_PUSH payload against current state; navigate.
    },

    /**
     * YAML: `requestRun: // POST …/run`
     * The actual POST is handled by the runStage actor invocation in `running`.
     * This action is a no-op placeholder completing the YAML mapping.
     */
    requestRun: () => {
      // Handled by invoke.src: runStage
    },

    /** YAML: `requestCancel: // POST …/cancel` */
    requestCancel: ({ context }) => {
      void context.services.requestCancel(context.projectId, context.stageId);
    },

    /** YAML: `requestPause: // POST …/pause` */
    requestPause: ({ context }) => {
      void context.services.requestPause(context.projectId, context.stageId);
    },
  },
}).createMachine({
  id: "stageRunner",
  context: ({ input }) => ({
    stageId: input.stageId,
    index: input.index,
    group: input.group,
    projectId: input.projectId,
    pageScoped: input.pageScoped,
    services: input.services,
    progress: 0,
    flaggedPages: [],
    flaggedCount: 0,
    staleReason: null,
    _pendingAutoRerun: false,
    startedAt: null,
    durationMs: null,
    artifactBytes: null,
    error: null,
  }),

  initial: "notrun",

  states: {
    /** YAML: notrun — stage has never run */
    notrun: {
      on: {
        RUN: { target: "queued", actions: ["requestRun"] },
        STAGE_PUSH: { actions: ["reconcile"] },
      },
    },

    /** YAML: queued — waiting for a worker slot */
    queued: {
      on: {
        START: { target: "running", actions: ["stampStart"] },
        CANCEL: { target: "notrun", actions: ["requestCancel"] },
        STAGE_PUSH: { actions: ["reconcile"] },
      },
    },

    /**
     * YAML: running — worker is processing pages
     *
     * DIVERGENCE #1: invoke.src resolves with outcome; PROGRESS events come
     * separately from the SSE actor. The YAML describes runStage as a
     * streaming service; we split it into a promise actor (outcome) +
     * PROGRESS_PUSH events from the sseActor. See DIVERGENCES.md.
     */
    running: {
      invoke: {
        id: "runStage",
        src: "runStage",
        input: ({ context }) => ({
          projectId: context.projectId,
          stageId: context.stageId,
          services: context.services,
        }),
        onDone: [
          {
            target: "error",
            guard: {
              type: "outcomeFailed",
              params: ({ event }: { event: { output: RunStageOutcome } }) => ({
                output: event.output,
              }),
            },
            actions: [
              {
                type: "assignError",
                params: ({
                  event,
                }: {
                  event: { output: RunStageOutcome };
                }) => ({
                  output: event.output,
                }),
              },
              "stampDuration",
            ],
          },
          {
            target: "flagged",
            guard: {
              type: "outcomeHasFlags",
              params: ({ event }: { event: { output: RunStageOutcome } }) => ({
                output: event.output,
              }),
            },
            actions: [
              {
                type: "assignFlagged",
                params: ({
                  event,
                }: {
                  event: { output: RunStageOutcome };
                }) => ({
                  output: event.output,
                }),
              },
              "stampDuration",
            ],
          },
          {
            target: "clean",
            actions: ["clearFlagged", "stampDuration"],
          },
        ],
        onError: {
          target: "error",
          actions: [
            {
              type: "assignErrorFromReject",
              params: ({ event }: { event: { error: unknown } }) => ({
                error: event.error,
              }),
            },
            "stampDuration",
          ],
        },
      },
      on: {
        PROGRESS: { actions: ["assignProgress"] },
        PAUSE: { target: "queued", actions: ["requestPause"] },
        STAGE_PUSH: { actions: ["reconcile"] },
      },
    },

    /** YAML: clean — completed, no flags */
    clean: {
      on: {
        RERUN: { target: "queued", actions: ["requestRun"] },
        UPSTREAM_CHANGED: { target: "stale", actions: ["markStale"] },
        SETTINGS_CHANGED: { target: "stale", actions: ["markStaleSettings"] },
        STAGE_PUSH: { actions: ["reconcile"] },
      },
    },

    /** YAML: flagged — completed but pages need review */
    flagged: {
      on: {
        RESOLVE: [
          {
            target: "clean",
            guard: "allPagesResolved",
            actions: ["removeResolvedPages", "clearFlagged"],
          },
          {
            target: "flagged",
            actions: ["removeResolvedPages"],
          },
        ],
        RERUN: { target: "queued", actions: ["requestRun"] },
        UPSTREAM_CHANGED: { target: "stale", actions: ["markStale"] },
        STAGE_PUSH: { actions: ["reconcile"] },
      },
    },

    /**
     * YAML: stale — output out of date
     *
     * DIVERGENCE #2: `always` guard reads `_pendingAutoRerun` from context
     * instead of `event.autoRerun` (not available on always transitions in
     * XState v5). See DIVERGENCES.md.
     */
    stale: {
      always: [
        {
          target: "queued",
          guard: "autoRerunEnabled",
          actions: ["requestRun"],
        },
      ],
      on: {
        RUN: { target: "queued", actions: ["requestRun"] },
        STAGE_PUSH: { actions: ["reconcile"] },
      },
    },

    /** YAML: error — stage execution failed */
    error: {
      on: {
        RETRY: { target: "queued", actions: ["clearError", "requestRun"] },
        STAGE_PUSH: { actions: ["reconcile"] },
      },
    },
  },
});
