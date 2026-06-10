/**
 * pageWorkbench — XState v5 machine for the per-page workbench surface.
 *
 * Ported from `docs/plans/design_handoff_pgdp_app/statecharts/page-workbench.yaml`
 *
 * ONE machine, instantiated with a stageId. Stage-specific control panels are
 * picked from WB_MAP (configuration, not state).
 *
 * ## State hierarchy
 *   loading → bench (parallel) | applying | loadError
 *   bench:
 *     params: { pristine | dirty | redetecting }
 *     viewer: { single | comparing }
 *
 * ## Key invariants
 * - APPLY is only accepted from the `bench` super-state (not from `applying`
 *   or `loading`). A guard blocks it while `params` is in `redetecting`.
 * - Apply-&-Continue: if there's a next page, cursor advances and machine
 *   reloads. On the last page, stays in bench.
 * - Navigation (PREV/NEXT/JUMP) clears draft and reloads.
 *
 * @see docs/plans/design_handoff_pgdp_app/statecharts/page-workbench.yaml
 * @see src/machines/lib/query.ts — service injection pattern
 * @see src/machines/DIVERGENCES.md — YAML vs contract divergences
 */

import { setup, assign, fromPromise } from "xstate";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/** A page reference in the strip. */
export interface PageRef {
  pageId: string;
  stem: string;
  idx: number;
  flagged: boolean;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface PageWorkbenchServices {
  /**
   * GET /api/projects/:id/stages/:stageId/pages/:pageId/bench
   * -> { params, pageStats, flagNote }
   */
  fetchBenchPage(
    projectId: string,
    stageId: string,
    pageId: string,
  ): Promise<{
    params: Record<string, unknown>;
    pageStats: Record<string, unknown> | null;
    flagNote: string | null;
  }>;

  /**
   * POST /api/projects/:id/stages/:stageId/pages/:pageId/detect
   * -> { pageStats, overlays }
   */
  redetect(
    pageId: string,
    stageId: string,
    params: Record<string, unknown>,
  ): Promise<{ pageStats: Record<string, unknown>; overlays?: unknown }>;

  /**
   * POST /api/projects/:id/stages/:stageId/pages/:pageId/apply -> PageRef
   */
  applyPage(
    pageId: string,
    stageId: string,
    params: Record<string, unknown>,
  ): Promise<PageRef>;
}

// ---------------------------------------------------------------------------
// Input + Context
// ---------------------------------------------------------------------------

export interface PageWorkbenchInput {
  projectId: string;
  stageId: string;
  stageIndex: number;
  pages: PageRef[];
  cursor: number;
  services: PageWorkbenchServices;
}

export interface PageWorkbenchContext {
  projectId: string;
  stageId: string;
  stageIndex: number;
  pages: PageRef[];
  cursor: number;
  params: Record<string, unknown> | null;
  draft: Record<string, unknown> | null;
  pageStats: Record<string, unknown> | null;
  flagNote: string | null;
  compare: boolean;
  services: PageWorkbenchServices;
  error: { message: string } | null;
  /** Transient: true while params region is in redetecting. Guards APPLY. */
  _redetecting: boolean;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type PageWorkbenchEvent =
  | { type: "RETRY" }
  | { type: "SET_PARAM"; patch: Record<string, unknown> }
  | { type: "RESET" }
  | { type: "REDETECT" }
  | { type: "COMPARE" }
  | { type: "DRAG_SPLIT"; pct: number }
  | { type: "FIT" }
  | { type: "PREV_PAGE" }
  | { type: "NEXT_PAGE" }
  | { type: "JUMP_PAGE"; index: number }
  | { type: "APPLY" };

// ---------------------------------------------------------------------------
// Machine
// ---------------------------------------------------------------------------

export const pageWorkbenchMachine = setup({
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  types: {} as {
    context: PageWorkbenchContext;
    events: PageWorkbenchEvent;
    input: PageWorkbenchInput;
  },

  actors: {
    /**
     * YAML: `invoke.src: fetchBenchPage`
     * DIVERGENCE #3: XState v5 onDone carries `output` not `data`.
     */
    fetchBenchPage: fromPromise<
      {
        params: Record<string, unknown>;
        pageStats: Record<string, unknown> | null;
        flagNote: string | null;
      },
      {
        projectId: string;
        stageId: string;
        pageId: string;
        services: PageWorkbenchServices;
      }
    >(({ input }) =>
      input.services.fetchBenchPage(
        input.projectId,
        input.stageId,
        input.pageId,
      ),
    ),

    /**
     * YAML: `invoke.src: redetect`
     */
    redetect: fromPromise<
      { pageStats: Record<string, unknown>; overlays?: unknown },
      {
        pageId: string;
        stageId: string;
        params: Record<string, unknown>;
        services: PageWorkbenchServices;
      }
    >(({ input }) =>
      input.services.redetect(input.pageId, input.stageId, input.params),
    ),

    /**
     * YAML: `invoke.src: applyPage`
     */
    applyPage: fromPromise<
      PageRef,
      {
        pageId: string;
        stageId: string;
        params: Record<string, unknown>;
        services: PageWorkbenchServices;
      }
    >(({ input }) =>
      input.services.applyPage(input.pageId, input.stageId, input.params),
    ),
  },

  guards: {
    /** YAML: `hasNextPage: ctx.cursor < ctx.pages.length - 1` */
    hasNextPage: ({ context }) => context.cursor < context.pages.length - 1,

    /** YAML: `notFirst: ctx.cursor > 0` */
    notFirst: ({ context }) => context.cursor > 0,

    /** YAML: `notLast: ctx.cursor < ctx.pages.length - 1` */
    notLast: ({ context }) => context.cursor < context.pages.length - 1,

    /** YAML: `indexInRange: event.index >= 0 && event.index < ctx.pages.length` */
    indexInRange: ({ context, event }) => {
      if (event.type !== "JUMP_PAGE") return false;
      return event.index >= 0 && event.index < context.pages.length;
    },

    /**
     * DIVERGENCE #6: The YAML does not guard APPLY explicitly against
     * `params.redetecting`; it is structurally implied (APPLY is on the
     * top-level, and `redetecting` is a parallel region sub-state). XState v5
     * top-level `on.APPLY` fires even while a parallel region is in a child
     * state; we track `_redetecting` in context and guard APPLY with it.
     * See DIVERGENCES.md.
     */
    notRedetecting: ({ context }) => !context._redetecting,
  },

  actions: {
    /** YAML: `assignBench` */
    assignBench: assign(
      (
        _args,
        params: {
          output: {
            params: Record<string, unknown>;
            pageStats: Record<string, unknown> | null;
            flagNote: string | null;
          };
        },
      ): Partial<PageWorkbenchContext> => ({
        params: params.output.params,
        pageStats: params.output.pageStats,
        flagNote: params.output.flagNote,
      }),
    ),

    /** YAML: `assignStats` */
    assignStats: assign(
      (
        _args,
        params: { output: { pageStats: Record<string, unknown> } },
      ): Partial<PageWorkbenchContext> => ({
        pageStats: params.output.pageStats,
      }),
    ),

    /** YAML: `assignError` */
    assignError: assign(
      (_args, params: { error: unknown }): Partial<PageWorkbenchContext> => {
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

    /** YAML: `clearError` */
    clearError: assign({ error: () => null }),

    /** YAML: `beginDraft: ctx.draft = clone(ctx.params)` */
    beginDraft: assign({
      draft: ({ context }) => ({ ...(context.params ?? {}) }),
    }),

    /** YAML: `patchDraft` */
    patchDraft: assign({
      draft: ({ context, event }) => {
        if (event.type !== "SET_PARAM") return context.draft;
        return { ...(context.draft ?? context.params ?? {}), ...event.patch };
      },
    }),

    /** YAML: `clearDraft` */
    clearDraft: assign({ draft: () => null }),

    /** YAML: `stepPrev: ctx.cursor -= 1` */
    stepPrev: assign({
      cursor: ({ context }) => context.cursor - 1,
    }),

    /** YAML: `stepNext: ctx.cursor += 1` */
    stepNext: assign({
      cursor: ({ context }) => context.cursor + 1,
    }),

    /** YAML: `moveTo: ctx.cursor = event.index` */
    moveTo: assign({
      cursor: ({ event }) => {
        if (event.type !== "JUMP_PAGE") return 0;
        return event.index;
      },
    }),

    /**
     * YAML: `commitPage — merge event.data into ctx.pages[cursor]; params ← applied draft`
     * At F2: updates params to the applied draft value (draft ?? params).
     */
    commitPage: assign({
      params: ({ context }) => context.draft ?? context.params,
    }),

    /** YAML: `emitResolvedMaybe` — side effect slot, no-op at F2 */
    emitResolvedMaybe: () => {
      // SIDE EFFECT: send parent PAGES_RESOLVED if page was flagged — at I1
    },

    /** Set _redetecting flag when entering the redetecting sub-state. */
    setRedetecting: assign({ _redetecting: () => true }),

    /** Clear _redetecting flag when leaving the redetecting sub-state. */
    clearRedetecting: assign({ _redetecting: () => false }),
  },
}).createMachine({
  id: "pageWorkbench",

  context: ({ input }) => ({
    projectId: input.projectId,
    stageId: input.stageId,
    stageIndex: input.stageIndex,
    pages: input.pages,
    cursor: input.cursor,
    params: null,
    draft: null,
    pageStats: null,
    flagNote: null,
    compare: false,
    services: input.services,
    error: null,
    _redetecting: false,
  }),

  initial: "loading",

  // Global events — available from bench (APPLY blocked when redetecting)
  on: {
    PREV_PAGE: {
      target: ".loading",
      guard: "notFirst",
      actions: ["stepPrev", "clearDraft"],
    },
    NEXT_PAGE: {
      target: ".loading",
      guard: "notLast",
      actions: ["stepNext", "clearDraft"],
    },
    JUMP_PAGE: {
      target: ".loading",
      guard: "indexInRange",
      actions: ["moveTo", "clearDraft"],
    },
    APPLY: {
      target: ".applying",
      guard: "notRedetecting",
    },
  },

  states: {
    loading: {
      invoke: {
        id: "fetchBenchPage",
        src: "fetchBenchPage",
        input: ({ context }) => {
          const page = context.pages[context.cursor];
          return {
            projectId: context.projectId,
            stageId: context.stageId,
            pageId: page?.pageId ?? "",
            services: context.services,
          };
        },
        onDone: {
          target: "bench",
          actions: [
            {
              type: "assignBench",
              params: ({
                event,
              }: {
                event: {
                  output: {
                    params: Record<string, unknown>;
                    pageStats: Record<string, unknown> | null;
                    flagNote: string | null;
                  };
                };
              }) => ({ output: event.output }),
            },
          ],
        },
        onError: {
          target: "loadError",
          actions: [
            {
              type: "assignError",
              params: ({ event }: { event: { error: unknown } }) => ({
                error: event.error,
              }),
            },
          ],
        },
      },
    },

    loadError: {
      on: {
        RETRY: { target: "loading", actions: ["clearError"] },
      },
    },

    bench: {
      type: "parallel",
      states: {
        // ---- Region: params (the left control drawer) ----------------------
        params: {
          initial: "pristine",
          on: {
            REDETECT: { target: ".redetecting" },
          },
          states: {
            pristine: {
              on: {
                SET_PARAM: {
                  target: "dirty",
                  actions: ["beginDraft", "patchDraft"],
                },
              },
            },
            dirty: {
              on: {
                SET_PARAM: { actions: ["patchDraft"] },
                RESET: { target: "pristine", actions: ["clearDraft"] },
              },
            },
            redetecting: {
              entry: ["setRedetecting"],
              exit: ["clearRedetecting"],
              invoke: {
                id: "redetect",
                src: "redetect",
                input: ({ context }) => {
                  const page = context.pages[context.cursor];
                  return {
                    pageId: page?.pageId ?? "",
                    stageId: context.stageId,
                    params: context.draft ?? context.params ?? {},
                    services: context.services,
                  };
                },
                onDone: {
                  target: "dirty",
                  actions: [
                    {
                      type: "assignStats",
                      params: ({
                        event,
                      }: {
                        event: {
                          output: { pageStats: Record<string, unknown> };
                        };
                      }) => ({ output: event.output }),
                    },
                  ],
                },
                onError: {
                  target: "dirty",
                  actions: [
                    {
                      type: "assignError",
                      params: ({ event }: { event: { error: unknown } }) => ({
                        error: event.error,
                      }),
                    },
                  ],
                },
              },
            },
          },
        },

        // ---- Region: viewer (right pane) -----------------------------------
        viewer: {
          initial: "single",
          on: {
            FIT: {},
          },
          states: {
            single: {
              on: {
                COMPARE: { target: "comparing" },
              },
            },
            comparing: {
              on: {
                DRAG_SPLIT: {},
                COMPARE: { target: "single" },
              },
            },
          },
        },
      },
    },

    // ---- Apply & Continue --------------------------------------------------
    applying: {
      invoke: {
        id: "applyPage",
        src: "applyPage",
        input: ({ context }) => {
          const page = context.pages[context.cursor];
          return {
            pageId: page?.pageId ?? "",
            stageId: context.stageId,
            params: context.draft ?? context.params ?? {},
            services: context.services,
          };
        },
        onDone: [
          {
            target: "loading",
            guard: "hasNextPage",
            actions: [
              "commitPage",
              "emitResolvedMaybe",
              "stepNext",
              "clearDraft",
            ],
          },
          {
            target: "bench",
            actions: ["commitPage", "emitResolvedMaybe", "clearDraft"],
          },
        ],
        onError: {
          target: "bench",
          actions: [
            {
              type: "assignError",
              params: ({ event }: { event: { error: unknown } }) => ({
                error: event.error,
              }),
            },
          ],
        },
      },
    },
  },
});
