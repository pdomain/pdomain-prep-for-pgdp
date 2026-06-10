/**
 * imageStageReview — XState v5 machine for the shared image-stage review tool.
 *
 * Ported from `docs/plans/design_handoff_pgdp_app/statecharts/tool-image-stage-review.yaml`
 *
 * SHARED ×7 — one definition, instantiated per stage (threshold, deskew,
 * denoise, dewarp, post_transform_crop, post_ocr_crop, canvas_map).
 * Parameterized by `input: { stageId, stageIndex, projectId, services }`.
 *
 * ## State hierarchy
 *   loading → running | review | settled | confirming | loadError
 *   review: { browsing | selecting | editing | rerunning }
 *
 * ## Inline ReviewEditor invariant
 *   Only one row can be open in the editor at a time (OPEN_EDITOR always
 *   replaces any previous editing idx). Modeled by a single `editing` context
 *   field; OPEN_EDITOR transitions to the `editing` sub-state unconditionally.
 *
 * ## Confirm gate
 *   CONFIRM_ADVANCE is guarded by `allFlagsReviewed` — enabled only when
 *   totals.flagged === 0 || totals.flagged === totals.reviewed.
 *
 * @see docs/plans/design_handoff_pgdp_app/statecharts/tool-image-stage-review.yaml
 * @see src/machines/lib/query.ts — service injection pattern
 * @see src/machines/DIVERGENCES.md — YAML vs contract divergences
 */

import { setup, assign, fromPromise } from "xstate";

// ---------------------------------------------------------------------------
// Domain types (re-exported for consumers)
// ---------------------------------------------------------------------------

/** A row in the imageStageReview page grid. */
export interface PageRow {
  idx: string;
  prefix: string;
  state: "running" | "clean" | "flagged" | "reviewed" | "failed";
  flags?: string[];
  pageNumber: number;
  [key: string]: unknown;
}

/** Aggregate totals for the review banner. */
export interface Totals {
  total: number;
  done: number;
  flagged: number;
  clean: number;
  reviewed: number;
  errors: number;
  running: number;
  rateHz?: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface ImageStageReviewServices {
  /**
   * GET /api/projects/:id/stages/:stageId/pages -> { rows, totals }
   */
  fetchStagePages(
    projectId: string,
    stageId: string,
  ): Promise<{ rows: PageRow[]; totals: Totals }>;

  /**
   * POST /api/projects/:id/stages/:stageId/rerun { params, pageIds } -> PageRow[]
   */
  reRunPages(
    projectId: string,
    stageId: string,
    draft: Record<string, unknown>,
    pageIds: string[],
  ): Promise<PageRow[]>;

  /**
   * POST /api/projects/:id/stages/:stageId/confirm -> { ok }
   */
  confirmStage(projectId: string, stageId: string): Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// Input + Context
// ---------------------------------------------------------------------------

export interface ImageStageReviewInput {
  projectId: string;
  stageId: string;
  stageIndex: number;
  services: ImageStageReviewServices;
}

export interface ImageStageReviewContext {
  projectId: string;
  stageId: string;
  stageIndex: number;
  services: ImageStageReviewServices;
  rows: PageRow[];
  totals: Totals | null;
  filter: string; // 'all' | 'flagged' | 'clean' | <flagKind>
  density: "S" | "M" | "L";
  selected: string[];
  editing: string | null;
  draft: Record<string, unknown> | null;
  applyTo: "this" | "selected" | "sameIssue";
  stale: boolean;
  error: { message: string } | null;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type ImageStageReviewEvent =
  | { type: "RETRY" }
  | { type: "PAGE_PUSH"; row: PageRow }
  | { type: "SELECT_PAGE"; idx: string }
  | { type: "CLEAR_SELECTION" }
  | { type: "BULK_ACCEPT" }
  | { type: "BULK_RERUN" }
  | { type: "OPEN_EDITOR"; idx: string }
  | { type: "DRAG_WIPE"; pct: number }
  | { type: "SET_PARAM"; patch: Record<string, unknown> }
  | { type: "SET_APPLY_TO"; value: "this" | "selected" | "sameIssue" }
  | { type: "ACCEPT_AS_IS" }
  | { type: "RERUN" }
  | { type: "CANCEL" }
  | { type: "SET_FILTER"; value: string }
  | { type: "SET_DENSITY"; value: "S" | "M" | "L" }
  | { type: "UPSTREAM_CHANGED" }
  | { type: "RERUN_STAGE" }
  | { type: "REDERIVE" }
  | { type: "CONFIRM_ADVANCE" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function recount(rows: PageRow[]): Totals {
  const total = rows.length;
  const running = rows.filter((r) => r.state === "running").length;
  const flagged = rows.filter((r) => r.state === "flagged").length;
  const clean = rows.filter((r) => r.state === "clean").length;
  const reviewed = rows.filter((r) => r.state === "reviewed").length;
  const errors = rows.filter((r) => r.state === "failed").length;
  const done = total - running;
  return { total, done, flagged, clean, reviewed, errors, running };
}

function upsertRow(rows: PageRow[], row: PageRow): PageRow[] {
  const idx = rows.findIndex((r) => r.idx === row.idx);
  if (idx === -1) return [...rows, row];
  return rows.map((r, i) => (i === idx ? row : r));
}

function setRowState(
  rows: PageRow[],
  idxList: string[],
  state: PageRow["state"],
): PageRow[] {
  return rows.map((r) => (idxList.includes(r.idx) ? { ...r, state } : r));
}

function toggleXor(arr: string[], item: string): string[] {
  if (arr.includes(item)) return arr.filter((x) => x !== item);
  return [...arr, item];
}

// ---------------------------------------------------------------------------
// Machine
// ---------------------------------------------------------------------------

export const imageStageReviewMachine = setup({
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  types: {} as {
    context: ImageStageReviewContext;
    events: ImageStageReviewEvent;
    input: ImageStageReviewInput;
  },

  actors: {
    /**
     * YAML: `invoke.src: fetchStagePages`
     * DIVERGENCE #3: XState v5 onDone carries `output` not `data`. Guards/actions
     * use the params pattern. See DIVERGENCES.md.
     */
    fetchStagePages: fromPromise<
      { rows: PageRow[]; totals: Totals },
      { projectId: string; stageId: string; services: ImageStageReviewServices }
    >(({ input }) =>
      input.services.fetchStagePages(input.projectId, input.stageId),
    ),

    /**
     * YAML: `invoke.src: reRunPages`
     * Resolves with updated PageRow[] for the re-run scope.
     */
    reRunPages: fromPromise<
      PageRow[],
      {
        projectId: string;
        stageId: string;
        services: ImageStageReviewServices;
        draft: Record<string, unknown>;
        pageIds: string[];
      }
    >(({ input }) =>
      input.services.reRunPages(
        input.projectId,
        input.stageId,
        input.draft,
        input.pageIds,
      ),
    ),

    /**
     * YAML: `invoke.src: confirmStage`
     */
    confirmStage: fromPromise<
      { ok: boolean },
      { projectId: string; stageId: string; services: ImageStageReviewServices }
    >(({ input }) =>
      input.services.confirmStage(input.projectId, input.stageId),
    ),
  },

  guards: {
    /** YAML: `anyRunning: event.data.totals.running > 0` */
    anyRunning: (
      _args,
      params: { output: { rows: PageRow[]; totals: Totals } },
    ) => params.output.totals.running > 0,

    /** YAML: `anyFlagged: event.data.totals.flagged > 0` */
    anyFlagged: (
      _args,
      params: { output: { rows: PageRow[]; totals: Totals } },
    ) => params.output.totals.flagged > 0,

    /**
     * YAML: `runCompleteWithFlags: ctx.totals.running === 1 && flagged > 0`
     *
     * DIVERGENCE #4: PAGE_PUSH guard reads context (current running count) and
     * event (incoming row state). We check if this is the last running page
     * (running === 1 after merge) AND any flagged exist. See DIVERGENCES.md.
     */
    runCompleteWithFlags: ({ context, event }) => {
      if (event.type !== "PAGE_PUSH") return false;
      const updatedRows = upsertRow(context.rows, event.row);
      const running = updatedRows.filter((r) => r.state === "running").length;
      const flagged = updatedRows.filter((r) => r.state === "flagged").length;
      return running === 0 && flagged > 0;
    },

    /** YAML: `runCompleteClean: ctx.totals.running === 1 && flagged === 0 && row.state !== 'flagged'` */
    runCompleteClean: ({ context, event }) => {
      if (event.type !== "PAGE_PUSH") return false;
      const updatedRows = upsertRow(context.rows, event.row);
      const running = updatedRows.filter((r) => r.state === "running").length;
      const flagged = updatedRows.filter((r) => r.state === "flagged").length;
      return running === 0 && flagged === 0;
    },

    /**
     * YAML: `allFlagsReviewed: totals.flagged === 0 || totals.flagged === totals.reviewed`
     * Guards CONFIRM_ADVANCE — enabled only when every flagged page has been reviewed.
     */
    allFlagsReviewed: ({ context }) => {
      if (!context.totals) return false;
      return (
        context.totals.flagged === 0 ||
        context.totals.flagged === context.totals.reviewed
      );
    },
  },

  actions: {
    /** YAML: `assignRows` */
    assignRows: assign(
      (_args, params: { output: { rows: PageRow[]; totals: Totals } }) => ({
        rows: params.output.rows,
        totals: params.output.totals,
      }),
    ),

    /** YAML: `assignError` (from onError) */
    assignError: assign((_args, params: { error: unknown }) => {
      let msg: string;
      if (params.error instanceof Error) {
        msg = params.error.message;
      } else if (typeof params.error === "string") {
        msg = params.error;
      } else {
        msg = "Unknown error";
      }
      return { error: { message: msg } };
    }),

    /** YAML: `clearError` */
    clearError: assign({ error: () => null }),

    /** YAML: `assignFilter` */
    assignFilter: assign({
      filter: ({ event }) => {
        if (event.type !== "SET_FILTER") return "all";
        return event.value;
      },
    }),

    /** YAML: `assignDensity` */
    assignDensity: assign({
      density: ({ event }) => {
        if (event.type !== "SET_DENSITY") return "M" as const;
        return event.value;
      },
    }),

    /** YAML: `addToSelection` */
    addToSelection: assign({
      selected: ({ event }) => {
        if (event.type !== "SELECT_PAGE") return [];
        return [event.idx];
      },
    }),

    /** YAML: `toggleSelection` */
    toggleSelection: assign({
      selected: ({ context, event }) => {
        if (event.type !== "SELECT_PAGE") return context.selected;
        return toggleXor(context.selected, event.idx);
      },
    }),

    /** YAML: `emptySelection` */
    emptySelection: assign({ selected: () => [] as string[] }),

    /** YAML: `assignEditing` */
    assignEditing: assign({
      editing: ({ event }) => {
        if (event.type !== "OPEN_EDITOR") return null;
        return event.idx;
      },
    }),

    /** YAML: `clearEditing` */
    clearEditing: assign({ editing: () => null }),

    /** YAML: `beginDraft — ctx.draft = pickStageParams(ctx.rows[event.idx])` */
    beginDraft: assign({
      draft: ({ context, event }) => {
        if (event.type !== "OPEN_EDITOR") return null;
        const row = context.rows.find((r) => r.idx === event.idx);
        if (!row) return {};
        // Extract stage params from the row (all fields beyond base PageRow fields)
        const {
          idx: _idx,
          prefix: _prefix,
          state: _state,
          flags: _flags,
          pageNumber: _pn,
          ...params
        } = row;
        return params;
      },
    }),

    /** YAML: `patchDraft` */
    patchDraft: assign({
      draft: ({ context, event }) => {
        if (event.type !== "SET_PARAM") return context.draft;
        return { ...(context.draft ?? {}), ...event.patch };
      },
    }),

    /** YAML: `clearDraft` */
    clearDraft: assign({ draft: () => null }),

    /** YAML: `assignApplyTo` */
    assignApplyTo: assign({
      applyTo: ({ event }) => {
        if (event.type !== "SET_APPLY_TO") return "this" as const;
        return event.value;
      },
    }),

    /** YAML: `markReviewed — ctx.rows = setState(ctx.rows, [ctx.editing], 'reviewed')` */
    markReviewed: assign({
      rows: ({ context }) => {
        if (!context.editing) return context.rows;
        return setRowState(context.rows, [context.editing], "reviewed");
      },
      totals: ({ context }) => {
        if (!context.editing) return context.totals;
        const newRows = setRowState(
          context.rows,
          [context.editing],
          "reviewed",
        );
        return recount(newRows);
      },
    }),

    /** YAML: `acceptSelected` */
    acceptSelected: assign({
      rows: ({ context }) =>
        setRowState(context.rows, context.selected, "reviewed"),
      totals: ({ context }) => {
        const newRows = setRowState(context.rows, context.selected, "reviewed");
        return recount(newRows);
      },
      selected: () => [] as string[],
    }),

    /** YAML: `queueSelected` — marks selected as running for bulk rerun */
    queueSelected: assign({
      rows: ({ context }) =>
        setRowState(context.rows, context.selected, "running"),
      totals: ({ context }) => {
        const newRows = setRowState(context.rows, context.selected, "running");
        return recount(newRows);
      },
      selected: () => [] as string[],
    }),

    /** YAML: `mergePageResult` — upsert event.row into rows; recount totals */
    mergePageResult: assign({
      rows: ({ context, event }) => {
        if (event.type !== "PAGE_PUSH") return context.rows;
        return upsertRow(context.rows, event.row);
      },
      totals: ({ context, event }) => {
        if (event.type !== "PAGE_PUSH") return context.totals;
        const newRows = upsertRow(context.rows, event.row);
        return recount(newRows);
      },
    }),

    /** YAML: `mergeReRunResults` — upsert rerun result rows; recount */
    mergeReRunResults: assign(
      (
        { context },
        params: { output: PageRow[] },
      ): Partial<ImageStageReviewContext> => {
        let rows = context.rows;
        for (const row of params.output) {
          rows = upsertRow(rows, row);
        }
        return { rows, totals: recount(rows) };
      },
    ),

    /** YAML: `markStale` */
    markStale: assign({ stale: () => true }),

    /**
     * YAML: `settleIfClear` — if totals.flagged === 0, raise an internal settle.
     * DIVERGENCE #5: YAML describes this as raising a SETTLED internal event.
     * In XState v5 we handle settling via `always` transitions in the review
     * state that check if flagged === 0 after editing/rerunning complete.
     * The review state does not have an `always` guard — instead we rely on the
     * fact that `mergeReRunResults` + `recountTotals` update context, and the
     * rerunning/editing onDone transitions lead to browsing. The settleIfClear
     * behavior (auto-transition to settled) is handled via an `always` in
     * review. See DIVERGENCES.md.
     */
    settleIfClear: () => {
      // Slot for DIVERGENCE #5 — see DIVERGENCES.md; actual settle handled
      // via always transition in review state.
    },

    /** Side-effect slots — no-op at F2; wired at I1. */
    persistAccepts: () => {
      // SIDE EFFECT: PATCH accepted page states (batch) — at I1
    },
    requestReRun: () => {
      // SIDE EFFECT: POST re-run for selected pages (current params) — at I1
    },
    requestStageRun: () => {
      // SIDE EFFECT: POST run whole stage — at I1
    },
    requestRederive: () => {
      // SIDE EFFECT: POST re-derive + re-run all pages — at I1
    },
    emitStaleDownstream: () => {
      // SIDE EFFECT: send parent UPSTREAM_CHANGED from this stageIndex — at I1
    },
    emitResolved: () => {
      // SIDE EFFECT: send parent PAGES_RESOLVED — at I1
    },
  },
}).createMachine({
  id: "imageStageReview",

  context: ({ input }) => ({
    projectId: input.projectId,
    stageId: input.stageId,
    stageIndex: input.stageIndex,
    services: input.services,
    rows: [],
    totals: null,
    filter: "all",
    density: "M",
    selected: [],
    editing: null,
    draft: null,
    applyTo: "this",
    stale: false,
    error: null,
  }),

  initial: "loading",

  // Global events — available in all states (except where overridden by child)
  on: {
    UPSTREAM_CHANGED: { actions: ["markStale"] },
    RERUN_STAGE: { target: ".running", actions: ["requestStageRun"] },
    REDERIVE: { target: ".running", actions: ["requestRederive"] },
    CONFIRM_ADVANCE: {
      target: ".confirming",
      guard: "allFlagsReviewed",
    },
    SET_FILTER: { actions: ["assignFilter"] },
    SET_DENSITY: { actions: ["assignDensity"] },
  },

  states: {
    loading: {
      invoke: {
        id: "fetchStagePages",
        src: "fetchStagePages",
        input: ({ context }) => ({
          projectId: context.projectId,
          stageId: context.stageId,
          services: context.services,
        }),
        onDone: [
          {
            target: "running",
            guard: {
              type: "anyRunning",
              params: ({
                event,
              }: {
                event: {
                  output: { rows: PageRow[]; totals: Totals };
                };
              }) => ({ output: event.output }),
            },
            actions: [
              {
                type: "assignRows",
                params: ({
                  event,
                }: {
                  event: {
                    output: { rows: PageRow[]; totals: Totals };
                  };
                }) => ({ output: event.output }),
              },
            ],
          },
          {
            target: "review",
            guard: {
              type: "anyFlagged",
              params: ({
                event,
              }: {
                event: {
                  output: { rows: PageRow[]; totals: Totals };
                };
              }) => ({ output: event.output }),
            },
            actions: [
              {
                type: "assignRows",
                params: ({
                  event,
                }: {
                  event: {
                    output: { rows: PageRow[]; totals: Totals };
                  };
                }) => ({ output: event.output }),
              },
            ],
          },
          {
            target: "settled",
            actions: [
              {
                type: "assignRows",
                params: ({
                  event,
                }: {
                  event: {
                    output: { rows: PageRow[]; totals: Totals };
                  };
                }) => ({ output: event.output }),
              },
            ],
          },
        ],
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

    running: {
      on: {
        PAGE_PUSH: [
          {
            target: "review",
            guard: "runCompleteWithFlags",
            actions: ["mergePageResult"],
          },
          {
            target: "settled",
            guard: "runCompleteClean",
            actions: ["mergePageResult"],
          },
          {
            actions: ["mergePageResult"],
          },
        ],
      },
    },

    review: {
      initial: "browsing",

      states: {
        browsing: {
          // `always` transition: if we reach browsing with no remaining flagged
          // pages, auto-settle. (settleIfClear DIVERGENCE #5 handling.)
          always: [
            {
              target: "#imageStageReview.settled",
              guard: ({ context }) =>
                context.totals !== null &&
                context.totals.flagged === 0 &&
                context.totals.running === 0 &&
                context.rows.length > 0,
            },
          ],
          on: {
            SELECT_PAGE: { target: "selecting", actions: ["addToSelection"] },
            OPEN_EDITOR: {
              target: "editing",
              actions: ["assignEditing", "beginDraft"],
            },
          },
        },

        selecting: {
          on: {
            SELECT_PAGE: { actions: ["toggleSelection"] },
            BULK_ACCEPT: { actions: ["acceptSelected", "persistAccepts"] },
            BULK_RERUN: {
              target: "#imageStageReview.running",
              actions: ["queueSelected", "requestReRun"],
            },
            CLEAR_SELECTION: {
              target: "browsing",
              actions: ["emptySelection"],
            },
            OPEN_EDITOR: {
              target: "editing",
              actions: ["assignEditing", "beginDraft"],
            },
          },
        },

        editing: {
          on: {
            DRAG_WIPE: {},
            SET_PARAM: { actions: ["patchDraft"] },
            SET_APPLY_TO: { actions: ["assignApplyTo"] },
            ACCEPT_AS_IS: {
              target: "browsing",
              actions: [
                "markReviewed",
                "persistAccepts",
                "clearEditing",
                "settleIfClear",
              ],
            },
            RERUN: { target: "rerunning" },
            CANCEL: {
              target: "browsing",
              actions: ["clearEditing", "clearDraft"],
            },
          },
        },

        rerunning: {
          invoke: {
            id: "reRunPages",
            src: "reRunPages",
            input: ({ context }) => ({
              projectId: context.projectId,
              stageId: context.stageId,
              services: context.services,
              draft: context.draft ?? {},
              pageIds: context.editing ? [context.editing] : context.selected,
            }),
            onDone: [
              {
                target: "browsing",
                actions: [
                  {
                    type: "mergeReRunResults",
                    params: ({ event }: { event: { output: PageRow[] } }) => ({
                      output: event.output,
                    }),
                  },
                  "clearEditing",
                  "clearDraft",
                  "settleIfClear",
                  "emitStaleDownstream",
                ],
              },
            ],
            onError: {
              target: "editing",
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

    settled: {
      entry: ["emitResolved"],
      on: {
        OPEN_EDITOR: {
          target: "review.editing",
          actions: ["assignEditing", "beginDraft"],
        },
      },
    },

    confirming: {
      invoke: {
        id: "confirmStage",
        src: "confirmStage",
        input: ({ context }) => ({
          projectId: context.projectId,
          stageId: context.stageId,
          services: context.services,
        }),
        onDone: {
          target: "settled",
          actions: ["emitResolved"],
        },
        onError: {
          target: "review",
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
