/**
 * wordcheckTool — XState v5 machine for the Wordcheck / Scannocheck stage tool.
 *
 * Ported from `docs/plans/design_handoff_pgdp_app/statecharts/tool-wordcheck.yaml`
 * with the mechanical conventions in DIVERGENCES.md.
 *
 * Stage: scannocheck (project-scoped, Text group)
 *
 * ## Architecture
 * Parallel machine with two independent regions:
 *   - `suspects` — the per-token review queue (scan → reviewing → settled)
 *   - `listBuilder` — word-list candidate curation
 *
 * ## Suspects region
 * FIX and KEEP drop the suspect optimistically; `settleIfClear` auto-transitions
 * to `settled` when suspects.length === 0.
 *
 * ## List builder region
 * ADD_TO_LIST / SKIP_CANDIDATE / DEFER drive per-candidate decisions.
 * PROMOTE_TO_LIBRARY is the one cross-project write in the pipeline — guarded
 * server-side; client treats it as a normal invoke.
 *
 * @see docs/plans/design_handoff_pgdp_app/statecharts/tool-wordcheck.yaml
 * @see src/machines/DIVERGENCES.md — conventions
 */

import { setup, assign, fromPromise } from "xstate";
// W5.2 — import StageSettingsServices so WordcheckToolServices can extend it
import type { StageSettingsServices } from "./stageSettings";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type SuspectType =
  | "dictFail"
  | "stealth"
  | "runeTranspose"
  | "digitSub"
  | "common";

export interface Suspect {
  id: string;
  word: string;
  fix: string;
  ctxL: string;
  ctxR: string;
  type: SuspectType;
  page: string;
  line: number;
  rule: string;
  score: number;
  note?: string;
}

export interface SuspectTotals {
  total: number;
  done: number;
  suspects: number;
  stealth: number;
  flagged: number;
  reviewed: number;
  clean: number;
  rateHz?: number;
}

export type CandidateList = "good" | "bad";

export interface Candidate {
  id: string;
  token: string;
  fix?: string;
  list: CandidateList;
  stealth?: boolean;
  rule?: string;
  ev: string[];
  rank: number;
  deferred?: boolean;
}

export interface ListTotals {
  good: number;
  bad: number;
  bookGood: number;
  bookBad: number;
  libraryGood: number;
  libraryBad: number;
}

// ---------------------------------------------------------------------------
// Services interface
// ---------------------------------------------------------------------------

/** W5.2 — WordcheckToolServices extends StageSettingsServices (save-as-default/revert/reset). */
export interface WordcheckToolServices extends StageSettingsServices {
  /**
   * POST /api/projects/:id/stages/scannocheck/accept-dict -> { fixedIds }
   */
  acceptDictionaryFixes(projectId: string): Promise<{ fixedIds: string[] }>;

  /**
   * POST /api/projects/:id/stages/scannocheck/lists/accept-high -> { acceptedIds }
   */
  acceptHighConfidence(projectId: string): Promise<{ acceptedIds: string[] }>;

  /**
   * POST /api/projects/:id/stages/scannocheck/lists/promote -> ListTotals
   * CROSS-PROJECT WRITE — guarded server-side.
   */
  promoteToLibrary(projectId: string): Promise<ListTotals>;

  /**
   * POST /api/projects/:id/stages/scannocheck/confirm -> { ok }
   */
  confirmStage(projectId: string): Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// Input + Context
// ---------------------------------------------------------------------------

export interface WordcheckToolInput {
  projectId: string;
  stageIndex: number;
  services: WordcheckToolServices;
}

export interface WordcheckToolContext {
  projectId: string;
  stageIndex: number;
  services: WordcheckToolServices;

  // suspects region
  suspects: Suspect[];
  totals: SuspectTotals | null;
  suspectFilter: "all" | "stealth" | SuspectType;

  // listBuilder region
  candidates: Candidate[];
  listTotals: ListTotals | null;
  listFilter: "all" | "good" | "bad";

  error: { message: string } | null;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type WordcheckToolEvent =
  // suspects region — scanning phase
  | {
      type: "SCAN_PROGRESS";
      done: number;
      suspects: number;
    }
  | {
      type: "SCAN_DONE";
      suspects: Suspect[];
      totals: SuspectTotals;
    }
  // suspects region — reviewing
  | { type: "FIX"; suspectId: string }
  | { type: "KEEP"; suspectId: string }
  | { type: "VIEW_ON_PAGE"; suspectId: string }
  | { type: "ACCEPT_DICT_FIXES" }
  | { type: "SEND_CLEARED" }
  | {
      type: "SET_SUSPECT_FILTER";
      value: "all" | "stealth" | SuspectType;
    }
  | { type: "CONFIRM_ADVANCE" }
  // suspects region — settled
  | { type: "UPSTREAM_CHANGED" }
  | { type: "RERUN_CHECK" }
  // listBuilder region — curating
  | {
      type: "ADD_TO_LIST";
      candidateId: string;
      list: CandidateList;
    }
  | { type: "SKIP_CANDIDATE"; candidateId: string }
  | { type: "DEFER"; candidateId: string }
  | { type: "SET_LIST_FILTER"; value: "all" | "good" | "bad" }
  | { type: "ACCEPT_HIGH_CONFIDENCE" }
  | { type: "PROMOTE_TO_LIBRARY" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dropSuspect(suspects: Suspect[], id: string): Suspect[] {
  return suspects.filter((s) => s.id !== id);
}

function dropCandidate(candidates: Candidate[], id: string): Candidate[] {
  return candidates.filter((c) => c.id !== id);
}

function recountSuspects(suspects: Suspect[]): SuspectTotals {
  const stealth = suspects.filter((s) => s.type === "stealth").length;
  return {
    total: suspects.length,
    done: 0,
    suspects: suspects.length,
    stealth,
    flagged: 0,
    reviewed: 0,
    clean: 0,
  };
}

function recountLists(candidates: Candidate[]): ListTotals {
  const good = candidates.filter((c) => c.list === "good").length;
  const bad = candidates.filter((c) => c.list === "bad").length;
  return {
    good,
    bad,
    bookGood: good,
    bookBad: bad,
    libraryGood: 0,
    libraryBad: 0,
  };
}

// ---------------------------------------------------------------------------
// Machine
// ---------------------------------------------------------------------------

export const wordcheckToolMachine = setup({
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  types: {} as {
    context: WordcheckToolContext;
    events: WordcheckToolEvent;
    input: WordcheckToolInput;
  },

  actors: {
    /** YAML: `services.acceptDictionaryFixes` */
    acceptDictionaryFixes: fromPromise<
      { fixedIds: string[] },
      { projectId: string; services: WordcheckToolServices }
    >(({ input }) => input.services.acceptDictionaryFixes(input.projectId)),

    /** YAML: `services.acceptHighConfidence` */
    acceptHighConfidence: fromPromise<
      { acceptedIds: string[] },
      { projectId: string; services: WordcheckToolServices }
    >(({ input }) => input.services.acceptHighConfidence(input.projectId)),

    /**
     * YAML: `services.promoteToLibrary`
     * CROSS-PROJECT WRITE — guarded server-side (see F5.5 divergence).
     */
    promoteToLibrary: fromPromise<
      ListTotals,
      { projectId: string; services: WordcheckToolServices }
    >(({ input }) => input.services.promoteToLibrary(input.projectId)),

    /** YAML: `services.confirmStage` */
    confirmStage: fromPromise<
      { ok: boolean },
      { projectId: string; services: WordcheckToolServices }
    >(({ input }) => input.services.confirmStage(input.projectId)),
  },

  guards: {
    /**
     * YAML: `anySuspects: event.data.totals.suspects > 0`
     * Uses `event.output` per DIVERGENCES.md #3.
     */
    anySuspects: (
      _args,
      params: { output: { suspects: Suspect[]; totals: SuspectTotals } },
    ) => params.output.totals.suspects > 0,

    /**
     * YAML: `notRunning: ctx.totals.done === ctx.totals.total`
     * Guards CONFIRM_ADVANCE — all pages scanned.
     */
    notRunning: ({ context }) => {
      if (!context.totals) return false;
      return (
        context.totals.done === context.totals.total ||
        context.totals.total === 0
      );
    },

    /**
     * Internal: suspects queue is empty → settle.
     * Used as `always` guard in reviewing to auto-settle per DIVERGENCES.md #5.
     */
    suspectsCleared: ({ context }) => context.suspects.length === 0,
  },

  actions: {
    /** YAML: `assignScanProgress` */
    assignScanProgress: assign({
      totals: ({ context, event }) => {
        if (event.type !== "SCAN_PROGRESS") return context.totals;
        return context.totals
          ? {
              ...context.totals,
              done: event.done,
              suspects: event.suspects,
            }
          : null;
      },
    }),

    /**
     * YAML: `assignSuspects: ctx.suspects = event.data.suspects; ctx.totals = event.data.totals`
     * DIVERGENCES.md #3: uses event.output from the SCAN_DONE event (not an actor done).
     * At F5, SCAN_DONE is a direct event; output is on event itself.
     */
    assignSuspects: assign({
      suspects: ({ event }) => {
        if (event.type !== "SCAN_DONE") return [] as Suspect[];
        return event.suspects;
      },
      totals: ({ event }) => {
        if (event.type !== "SCAN_DONE") return null;
        return event.totals;
      },
    }),

    /** YAML: `applyFix: ctx.suspects = dropSuspect(ctx.suspects, event.suspectId)` */
    applyFix: assign({
      suspects: ({ context, event }) => {
        if (event.type !== "FIX") return context.suspects;
        return dropSuspect(context.suspects, event.suspectId);
      },
      totals: ({ context, event }) => {
        if (event.type !== "FIX") return context.totals;
        const next = dropSuspect(context.suspects, event.suspectId);
        return recountSuspects(next);
      },
    }),

    /** YAML: `keepAsIs: ctx.suspects = dropSuspect(ctx.suspects, event.suspectId)` */
    keepAsIs: assign({
      suspects: ({ context, event }) => {
        if (event.type !== "KEEP") return context.suspects;
        return dropSuspect(context.suspects, event.suspectId);
      },
      totals: ({ context, event }) => {
        if (event.type !== "KEEP") return context.totals;
        const next = dropSuspect(context.suspects, event.suspectId);
        return recountSuspects(next);
      },
    }),

    /**
     * YAML: `mergeBatchFixes: ctx.suspects = ctx.suspects.filter(s => !event.data.fixedIds.includes(s.id))`
     * DIVERGENCES.md #3: event.output on actor onDone.
     */
    mergeBatchFixes: assign({
      suspects: ({ context }, params: { output: { fixedIds: string[] } }) =>
        context.suspects.filter((s) => !params.output.fixedIds.includes(s.id)),
      totals: ({ context }, params: { output: { fixedIds: string[] } }) => {
        const next = context.suspects.filter(
          (s) => !params.output.fixedIds.includes(s.id),
        );
        return recountSuspects(next);
      },
    }),

    /** YAML: `assignSuspectFilter: ctx.suspectFilter = event.value` */
    assignSuspectFilter: assign({
      suspectFilter: ({ event }) => {
        if (event.type !== "SET_SUSPECT_FILTER") return "all" as const;
        return event.value;
      },
    }),

    /** YAML: `acceptCandidate: ctx.candidates = dropCandidate(...)` */
    acceptCandidate: assign({
      candidates: ({ context, event }) => {
        if (event.type !== "ADD_TO_LIST") return context.candidates;
        return dropCandidate(context.candidates, event.candidateId);
      },
      listTotals: ({ context, event }) => {
        if (event.type !== "ADD_TO_LIST") return context.listTotals;
        const next = dropCandidate(context.candidates, event.candidateId);
        return recountLists(next);
      },
    }),

    /** YAML: `dropCandidate: ctx.candidates = dropCandidate(...)` */
    dropCandidate: assign({
      candidates: ({ context, event }) => {
        if (event.type !== "SKIP_CANDIDATE") return context.candidates;
        return dropCandidate(context.candidates, event.candidateId);
      },
      listTotals: ({ context, event }) => {
        if (event.type !== "SKIP_CANDIDATE") return context.listTotals;
        const next = dropCandidate(context.candidates, event.candidateId);
        return recountLists(next);
      },
    }),

    /** YAML: `markDeferred` — candidate stays, marked deferred */
    markDeferred: assign({
      candidates: ({ context, event }) => {
        if (event.type !== "DEFER") return context.candidates;
        return context.candidates.map((c) =>
          c.id === event.candidateId ? { ...c, deferred: true } : c,
        );
      },
    }),

    /**
     * YAML: `mergeBatchAccepts: ctx.candidates = ctx.candidates.filter(...)`
     * DIVERGENCES.md #3: event.output on actor onDone.
     */
    mergeBatchAccepts: assign({
      candidates: (
        { context },
        params: { output: { acceptedIds: string[] } },
      ) =>
        context.candidates.filter(
          (c) => !params.output.acceptedIds.includes(c.id),
        ),
      listTotals: (
        { context },
        params: { output: { acceptedIds: string[] } },
      ) => {
        const next = context.candidates.filter(
          (c) => !params.output.acceptedIds.includes(c.id),
        );
        return recountLists(next);
      },
    }),

    /**
     * YAML: `assignListTotals: ctx.listTotals = event.data`
     * DIVERGENCES.md #3: event.output on actor onDone.
     */
    assignListTotals: assign({
      listTotals: (_args, params: { output: ListTotals }) => params.output,
    }),

    /** YAML: `assignListFilter: ctx.listFilter = event.value` */
    assignListFilter: assign({
      listFilter: ({ event }) => {
        if (event.type !== "SET_LIST_FILTER") return "all" as const;
        return event.value;
      },
    }),

    /** YAML: `assignError: ctx.error = event.error` */
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

    // ---- Side-effect slots — no-op at F5; wired at I1 ----------------------

    /** YAML: `persistDecision` — SIDE EFFECT: POST fix/keep { suspectId } */
    persistDecision: () => {
      // SIDE EFFECT: at I1, POST /api/projects/:id/stages/scannocheck/decisions
    },

    /** YAML: `persistListEntry` — SIDE EFFECT: POST book-list entry { token, list } */
    persistListEntry: () => {
      // SIDE EFFECT: at I1, POST /api/projects/:id/stages/scannocheck/lists
    },

    /** YAML: `forwardCleared` — SIDE EFFECT: release cleared pages to text_review */
    forwardCleared: () => {
      // SIDE EFFECT: at I1, POST .../scannocheck/forward-cleared
    },

    /** YAML: `requestRescan` — SIDE EFFECT: POST re-check */
    requestRescan: () => {
      // SIDE EFFECT: at I1, POST .../scannocheck/rescan
    },

    /** YAML: `emitResolved` — signal parent stageRunner */
    emitResolved: () => {
      // SIDE EFFECT: at I1, send RESOLVE to pipelineShell for scannocheck runner
    },

    /** YAML: `navigateToPage` — SIDE EFFECT: open page with suspect highlighted */
    navigateToPage: () => {
      // SIDE EFFECT: at I1, navigate to page with suspect highlighted
    },

    /**
     * YAML: `settleIfClear` — no-op here; handled by `always` guard on reviewing.
     * DIVERGENCES.md #5 pattern.
     */
    settleIfClear: () => {
      // no-op — always guard on reviewing.suspects handles auto-settle
    },

    /**
     * YAML: `recount` — DIVERGENCES.md #9: inlined in applyFix/keepAsIs.
     */
    recount: () => {
      // Inlined in applyFix, keepAsIs, mergeBatchFixes.
    },

    /**
     * YAML: `recountLists` — DIVERGENCES.md #9: inlined in acceptCandidate/dropCandidate.
     */
    recountLists: () => {
      // Inlined in acceptCandidate, dropCandidate, mergeBatchAccepts.
    },
  },
}).createMachine({
  id: "wordcheckTool",

  context: ({ input }) => ({
    projectId: input.projectId,
    stageIndex: input.stageIndex,
    services: input.services,
    suspects: [],
    totals: null,
    suspectFilter: "all",
    candidates: [],
    listTotals: null,
    listFilter: "all",
    error: null,
  }),

  /**
   * YAML: `type: parallel` — two independent regions run concurrently.
   */
  type: "parallel",

  states: {
    // =========================================================================
    // Region: suspects (stage lifecycle)
    // =========================================================================

    suspects: {
      initial: "scanning",

      states: {
        /**
         * YAML: `scanning` — "Scanning for scannos…" N/M pages · suspects counted live.
         */
        scanning: {
          on: {
            SCAN_PROGRESS: {
              actions: ["assignScanProgress"],
            },

            SCAN_DONE: [
              {
                target: "reviewing",
                guard: {
                  type: "anySuspects",
                  params: ({
                    event,
                  }: {
                    event: Extract<WordcheckToolEvent, { type: "SCAN_DONE" }>;
                  }) => ({ output: event }),
                },
                actions: ["assignSuspects"],
              },
              {
                target: "settled",
                actions: ["assignSuspects"],
              },
            ],
          },
        },

        /**
         * YAML: `reviewing` — suspects queue — each token in reading context.
         *
         * DIVERGENCES.md #5 pattern: `always` guard fires after FIX/KEEP clears
         * the last suspect, auto-transitioning to settled.
         */
        reviewing: {
          always: [
            {
              target: "confirming",
              guard: "suspectsCleared",
              actions: ["emitResolved"],
            },
          ],

          on: {
            FIX: {
              actions: ["applyFix", "persistDecision"],
            },
            KEEP: {
              actions: ["keepAsIs", "persistDecision"],
            },
            VIEW_ON_PAGE: {
              actions: ["navigateToPage"],
            },
            ACCEPT_DICT_FIXES: {
              target: "batchFixing",
            },
            SEND_CLEARED: {
              actions: ["forwardCleared"],
            },
            SET_SUSPECT_FILTER: {
              actions: ["assignSuspectFilter"],
            },
            CONFIRM_ADVANCE: {
              target: "confirming",
              guard: "notRunning",
            },
          },
        },

        /**
         * YAML: `batchFixing` — invoke acceptDictionaryFixes.
         */
        batchFixing: {
          invoke: {
            id: "acceptDictionaryFixes",
            src: "acceptDictionaryFixes" as const,
            input: ({ context }: { context: WordcheckToolContext }) => ({
              projectId: context.projectId,
              services: context.services,
            }),
            onDone: {
              target: "reviewing",
              actions: [
                {
                  type: "mergeBatchFixes",
                  params: ({
                    event,
                  }: {
                    event: { output: { fixedIds: string[] } };
                  }) => ({ output: event.output }),
                },
              ],
            },
            onError: {
              target: "reviewing",
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

        /**
         * YAML: `confirming` — invoke confirmStage.
         */
        confirming: {
          invoke: {
            id: "confirmStage",
            src: "confirmStage" as const,
            input: ({ context }: { context: WordcheckToolContext }) => ({
              projectId: context.projectId,
              services: context.services,
            }),
            onDone: {
              target: "settled",
              actions: ["emitResolved"],
            },
            onError: {
              target: "reviewing",
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

        /**
         * YAML: `settled` — no scannos outstanding; cleared text flows to Text review.
         */
        settled: {
          on: {
            UPSTREAM_CHANGED: {
              target: "scanning",
              actions: ["requestRescan"],
            },
            RERUN_CHECK: {
              target: "scanning",
              actions: ["requestRescan"],
            },
          },
        },
      },
    },

    // =========================================================================
    // Region: listBuilder (word-list curation)
    // =========================================================================

    listBuilder: {
      initial: "curating",

      states: {
        /**
         * YAML: `curating` — ranked candidates with evidence chips.
         */
        curating: {
          on: {
            ADD_TO_LIST: {
              actions: ["acceptCandidate", "persistListEntry"],
            },
            SKIP_CANDIDATE: {
              actions: ["dropCandidate"],
            },
            DEFER: {
              actions: ["markDeferred", "persistListEntry"],
            },
            SET_LIST_FILTER: {
              actions: ["assignListFilter"],
            },
            ACCEPT_HIGH_CONFIDENCE: {
              target: "batchAccepting",
            },
            PROMOTE_TO_LIBRARY: {
              target: "promoting",
            },
          },
        },

        /**
         * YAML: `batchAccepting` — invoke acceptHighConfidence.
         */
        batchAccepting: {
          invoke: {
            id: "acceptHighConfidence",
            src: "acceptHighConfidence" as const,
            input: ({ context }: { context: WordcheckToolContext }) => ({
              projectId: context.projectId,
              services: context.services,
            }),
            onDone: {
              target: "curating",
              actions: [
                {
                  type: "mergeBatchAccepts",
                  params: ({
                    event,
                  }: {
                    event: { output: { acceptedIds: string[] } };
                  }) => ({ output: event.output }),
                },
              ],
            },
            onError: {
              target: "curating",
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

        /**
         * YAML: `promoting` — invoke promoteToLibrary.
         * Cross-project write — guarded server-side.
         */
        promoting: {
          invoke: {
            id: "promoteToLibrary",
            src: "promoteToLibrary" as const,
            input: ({ context }: { context: WordcheckToolContext }) => ({
              projectId: context.projectId,
              services: context.services,
            }),
            onDone: {
              target: "curating",
              actions: [
                {
                  type: "assignListTotals",
                  params: ({ event }: { event: { output: ListTotals } }) => ({
                    output: event.output,
                  }),
                },
              ],
            },
            onError: {
              target: "curating",
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
  },
});
