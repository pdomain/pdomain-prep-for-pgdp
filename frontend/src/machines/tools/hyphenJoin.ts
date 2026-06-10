/**
 * hyphenJoin — XState v5 machine for the Hyphen join stage tool.
 *
 * Ported from `docs/plans/design_handoff_pgdp_app/statecharts/tool-hyphen-join.yaml`
 * with the mechanical conventions in DIVERGENCES.md.
 *
 * Stage: hyphen_join (project-scoped, Text group)
 *
 * ## Architecture
 * Linear machine: scanning → reviewing → settled | failed.
 * Three review tabs over the same case set (queue/joined/mismatch).
 *
 * ## Decision verbs (status-dependent, not mode-dependent)
 * - undecided | flagged → ACCEPT_JOIN | KEEP_HYPHEN
 * - joined | crosspage (not validated) → VALIDATE_JOIN
 * - mismatch → FIX_MISMATCH
 * - any decided → REVERT_DECISION
 *
 * ## settleIfClear
 * DIVERGENCES.md #5: `always` guard on `reviewing` auto-transitions to `settled`
 * when there are no more undecided/flagged/unvalidated/mismatch cases.
 *
 * @see docs/plans/design_handoff_pgdp_app/statecharts/tool-hyphen-join.yaml
 * @see src/machines/DIVERGENCES.md — conventions
 */

import { setup, assign, fromPromise } from "xstate";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type HyphenCaseStatus =
  | "joined"
  | "validated"
  | "undecided"
  | "flagged"
  | "crosspage"
  | "mismatch";

export type HyphenCaseKind = "auto" | "crosspage" | "manual" | "mismatch";

export interface HyphenCase {
  caseId: string;
  kind: HyphenCaseKind;
  head: string;
  tail: string;
  line: number;
  page: string;
  status: HyphenCaseStatus;
  validated: boolean;
  conf: number;
  rule?: string;
  book: {
    inBody: boolean;
    joinedElsewhere: boolean;
    mismatch: boolean;
  };
}

export interface HyphenTotals {
  total: number;
  joined: number;
  validated: number;
  undecided: number;
  flagged: number;
  crosspage: number;
  mismatch: number;
  unvalidated: number;
}

export type HyphenMode = "queue" | "joined" | "mismatch";

// ---------------------------------------------------------------------------
// Services interface
// ---------------------------------------------------------------------------

export interface HyphenJoinServices {
  /**
   * POST /api/projects/:id/stages/hyphen_join/scan -> { cases, totals }
   */
  scanHyphenation(
    projectId: string,
  ): Promise<{ cases: HyphenCase[]; totals: HyphenTotals }>;
}

// ---------------------------------------------------------------------------
// Input + Context
// ---------------------------------------------------------------------------

export interface HyphenJoinInput {
  projectId: string;
  stageIndex: number;
  services: HyphenJoinServices;
}

export interface HyphenJoinContext {
  projectId: string;
  stageIndex: number;
  services: HyphenJoinServices;

  cases: HyphenCase[];
  totals: HyphenTotals | null;
  mode: HyphenMode;
  cursor: number;
  pageId: string | null;

  error: { message: string } | null;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type HyphenJoinEvent =
  // navigation
  | { type: "SET_MODE"; mode: HyphenMode }
  | { type: "NEXT_CASE" }
  | { type: "PREV_CASE" }
  | { type: "SELECT_CASE"; index: number }
  // decisions
  | { type: "ACCEPT_JOIN"; caseId: string }
  | { type: "KEEP_HYPHEN"; caseId: string }
  | { type: "VALIDATE_JOIN"; caseId: string }
  | { type: "FIX_MISMATCH"; caseId: string }
  | { type: "REVERT_DECISION"; caseId: string }
  // bulk
  | { type: "VALIDATE_WORD_GROUP"; word: string }
  // page workbench
  | { type: "OPEN_PAGE"; pageId: string }
  | { type: "CLOSE_PAGE" }
  | { type: "PREV_PAGE" }
  | { type: "NEXT_PAGE" }
  | { type: "APPLY_CONTINUE" }
  // rule library
  | { type: "ADD_WORD_RULE"; rule: string; join: boolean }
  | { type: "OPEN_GLOBAL_LIBRARY" }
  // lifecycle
  | { type: "UPSTREAM_CHANGED" }
  | { type: "SETTINGS_CHANGED" }
  | { type: "RETRY" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function recountCases(cases: HyphenCase[]): HyphenTotals {
  const joined = cases.filter((c) => c.status === "joined").length;
  const validated = cases.filter((c) => c.status === "validated").length;
  const undecided = cases.filter((c) => c.status === "undecided").length;
  const flagged = cases.filter((c) => c.status === "flagged").length;
  const crosspage = cases.filter((c) => c.status === "crosspage").length;
  const mismatch = cases.filter((c) => c.status === "mismatch").length;
  const unvalidated = cases.filter(
    (c) => (c.status === "joined" || c.status === "crosspage") && !c.validated,
  ).length;

  return {
    total: cases.length,
    joined,
    validated,
    undecided,
    flagged,
    crosspage,
    mismatch,
    unvalidated,
  };
}

function modeList(cases: HyphenCase[], mode: HyphenMode): HyphenCase[] {
  if (mode === "queue") {
    return cases.filter(
      (c) => c.status === "undecided" || c.status === "flagged",
    );
  }
  if (mode === "joined") {
    return cases.filter(
      (c) => c.status === "joined" || c.status === "crosspage",
    );
  }
  // mismatch
  return cases.filter((c) => c.status === "mismatch");
}

function hasNothingToDecide(totals: HyphenTotals): boolean {
  return (
    totals.undecided === 0 &&
    totals.flagged === 0 &&
    totals.unvalidated === 0 &&
    totals.mismatch === 0
  );
}

function patchCase(
  cases: HyphenCase[],
  caseId: string,
  fn: (c: HyphenCase) => HyphenCase,
): HyphenCase[] {
  return cases.map((c) => (c.caseId === caseId ? fn(c) : c));
}

// ---------------------------------------------------------------------------
// Machine
// ---------------------------------------------------------------------------

export const hyphenJoinMachine = setup({
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  types: {} as {
    context: HyphenJoinContext;
    events: HyphenJoinEvent;
    input: HyphenJoinInput;
  },

  actors: {
    /** YAML: `services.scanHyphenation` */
    scanHyphenation: fromPromise<
      { cases: HyphenCase[]; totals: HyphenTotals },
      { projectId: string; services: HyphenJoinServices }
    >(({ input }) => input.services.scanHyphenation(input.projectId)),
  },

  guards: {
    /**
     * YAML: `anythingToDecide: totals.undecided + totals.flagged + totals.unvalidated + totals.mismatch > 0`
     * DIVERGENCES.md #3: uses event.output.
     */
    anythingToDecide: (
      _args,
      params: {
        output: { cases: HyphenCase[]; totals: HyphenTotals };
      },
    ) => !hasNothingToDecide(params.output.totals),

    /**
     * YAML: `isDecidable: ['undecided', 'flagged'].includes(currentCase(ctx).status)`
     * Checks cursor-indexed case.
     */
    isDecidable: ({ context, event }) => {
      const targetId =
        event.type === "ACCEPT_JOIN" ||
        event.type === "KEEP_HYPHEN" ||
        event.type === "REVERT_DECISION"
          ? event.caseId
          : null;
      if (!targetId) return false;
      const c = context.cases.find((x) => x.caseId === targetId);
      if (!c) return false;
      return c.status === "undecided" || c.status === "flagged";
    },

    /**
     * YAML: `isUnvalidatedJoin: ['joined', 'crosspage'].includes(status) && !validated`
     */
    isUnvalidatedJoin: ({ context, event }) => {
      if (event.type !== "VALIDATE_JOIN") return false;
      const c = context.cases.find((x) => x.caseId === event.caseId);
      if (!c) return false;
      return (
        (c.status === "joined" || c.status === "crosspage") && !c.validated
      );
    },

    /**
     * YAML: `isMismatch: currentCase(ctx).status === 'mismatch'`
     */
    isMismatch: ({ context, event }) => {
      if (event.type !== "FIX_MISMATCH") return false;
      const c = context.cases.find((x) => x.caseId === event.caseId);
      return c?.status === "mismatch" || false;
    },

    /**
     * Internal: settled when nothing left to decide.
     * DIVERGENCES.md #5 pattern: `always` guard on `reviewing`.
     */
    allDecided: ({ context }) => {
      if (!context.totals) return false;
      return hasNothingToDecide(context.totals);
    },
  },

  actions: {
    /**
     * YAML: `assignCases: ctx.cases = event.data.cases; ctx.totals = event.data.totals`
     * DIVERGENCES.md #3: event.output.
     */
    assignCases: assign({
      cases: (
        _args,
        params: { output: { cases: HyphenCase[]; totals: HyphenTotals } },
      ) => params.output.cases,
      totals: (
        _args,
        params: { output: { cases: HyphenCase[]; totals: HyphenTotals } },
      ) => params.output.totals,
    }),

    /** YAML: `assignMode: ctx.mode = event.mode` */
    assignMode: assign({
      mode: ({ event }) => {
        if (event.type !== "SET_MODE") return "queue" as const;
        return event.mode;
      },
    }),

    /** YAML: `resetCursor: ctx.cursor = 0` */
    resetCursor: assign({ cursor: () => 0 }),

    /** YAML: `moveNext` */
    moveNext: assign({
      cursor: ({ context }) => {
        const list = modeList(context.cases, context.mode);
        return Math.min(context.cursor + 1, list.length - 1);
      },
    }),

    /** YAML: `movePrev` */
    movePrev: assign({
      cursor: ({ context }) => Math.max(context.cursor - 1, 0),
    }),

    /** YAML: `moveTo: ctx.cursor = event.index` */
    moveTo: assign({
      cursor: ({ event }) => {
        if (event.type !== "SELECT_CASE") return 0;
        return event.index;
      },
    }),

    /**
     * YAML: `setVerifiedJoin` — case → status 'joined', validated:true.
     * Inline recount per DIVERGENCES.md #9.
     */
    setVerifiedJoin: assign({
      cases: ({ context, event }) => {
        if (event.type !== "ACCEPT_JOIN") return context.cases;
        return patchCase(context.cases, event.caseId, (c) => ({
          ...c,
          status: "joined" as const,
          validated: true,
        }));
      },
      totals: ({ context, event }) => {
        if (event.type !== "ACCEPT_JOIN") return context.totals;
        const next = patchCase(context.cases, event.caseId, (c) => ({
          ...c,
          status: "joined" as const,
          validated: true,
        }));
        return recountCases(next);
      },
    }),

    /**
     * YAML: `setVerifiedKeep` — verified keep; hyphen stays.
     */
    setVerifiedKeep: assign({
      cases: ({ context, event }) => {
        if (event.type !== "KEEP_HYPHEN") return context.cases;
        return patchCase(context.cases, event.caseId, (c) => ({
          ...c,
          status: "validated" as const,
          validated: true,
        }));
      },
      totals: ({ context, event }) => {
        if (event.type !== "KEEP_HYPHEN") return context.totals;
        const next = patchCase(context.cases, event.caseId, (c) => ({
          ...c,
          status: "validated" as const,
          validated: true,
        }));
        return recountCases(next);
      },
    }),

    /**
     * YAML: `markValidated` — case.validated = true.
     */
    markValidated: assign({
      cases: ({ context, event }) => {
        if (event.type !== "VALIDATE_JOIN") return context.cases;
        return patchCase(context.cases, event.caseId, (c) => ({
          ...c,
          validated: true,
        }));
      },
      totals: ({ context, event }) => {
        if (event.type !== "VALIDATE_JOIN") return context.totals;
        const next = patchCase(context.cases, event.caseId, (c) => ({
          ...c,
          validated: true,
        }));
        return recountCases(next);
      },
    }),

    /**
     * YAML: `applyDashFix` — corrected hyphen form.
     */
    applyDashFix: assign({
      cases: ({ context, event }) => {
        if (event.type !== "FIX_MISMATCH") return context.cases;
        return patchCase(context.cases, event.caseId, (c) => ({
          ...c,
          status: "validated" as const,
          validated: true,
        }));
      },
      totals: ({ context, event }) => {
        if (event.type !== "FIX_MISMATCH") return context.totals;
        const next = patchCase(context.cases, event.caseId, (c) => ({
          ...c,
          status: "validated" as const,
          validated: true,
        }));
        return recountCases(next);
      },
    }),

    /**
     * YAML: `revertCase` — restore rule library's original status.
     */
    revertCase: assign({
      cases: ({ context, event }) => {
        if (event.type !== "REVERT_DECISION") return context.cases;
        return patchCase(context.cases, event.caseId, (c) => ({
          ...c,
          status: "undecided" as const,
          validated: false,
        }));
      },
      totals: ({ context, event }) => {
        if (event.type !== "REVERT_DECISION") return context.totals;
        const next = patchCase(context.cases, event.caseId, (c) => ({
          ...c,
          status: "undecided" as const,
          validated: false,
        }));
        return recountCases(next);
      },
    }),

    /**
     * YAML: `validateGroup` — validate all auto-joined instances of one word.
     */
    validateGroup: assign({
      cases: ({ context, event }) => {
        if (event.type !== "VALIDATE_WORD_GROUP") return context.cases;
        const word = event.word;
        return context.cases.map((c) =>
          (c.head + c.tail === word || c.head === word) &&
          !c.validated &&
          (c.status === "joined" || c.status === "crosspage")
            ? { ...c, validated: true }
            : c,
        );
      },
      totals: ({ context, event }) => {
        if (event.type !== "VALIDATE_WORD_GROUP") return context.totals;
        const word = event.word;
        const next = context.cases.map((c) =>
          (c.head + c.tail === word || c.head === word) &&
          !c.validated &&
          (c.status === "joined" || c.status === "crosspage")
            ? { ...c, validated: true }
            : c,
        );
        return recountCases(next);
      },
    }),

    /**
     * YAML: `advance` — moveNext within the active mode.
     */
    advance: assign({
      cursor: ({ context }) => {
        const list = modeList(context.cases, context.mode);
        return Math.min(context.cursor + 1, list.length - 1);
      },
    }),

    /**
     * YAML: `recount` — DIVERGENCES.md #9: inlined in decision actions.
     */
    recount: () => {
      // Inlined in decision actions.
    },

    /** YAML: `assignPage: ctx.pageId = event.pageId` */
    assignPage: assign({
      pageId: ({ event }) => {
        if (event.type !== "OPEN_PAGE") return null;
        return event.pageId;
      },
    }),

    /** YAML: `clearPage: ctx.pageId = null` */
    clearPage: assign({ pageId: () => null }),

    /** YAML: `assignError` */
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

    clearError: assign({ error: () => null }),

    // ---- Side-effect slots — no-op at F5; wired at I1 ----------------------

    /** YAML: `persistDecision` — SIDE EFFECT: POST decision { caseId, verdict } */
    persistDecision: () => {
      // SIDE EFFECT: at I1, POST /api/projects/:id/stages/hyphen_join/decisions
    },

    /** YAML: `persistGroup` — SIDE EFFECT: POST group validation { word } */
    persistGroup: () => {
      // SIDE EFFECT: at I1, POST .../hyphen_join/validate-group
    },

    /** YAML: `persistPage` — SIDE EFFECT: commit page's decisions */
    persistPage: () => {
      // SIDE EFFECT: at I1, POST .../hyphen_join/pages/:id/commit
    },

    /** YAML: `persistRule` — SIDE EFFECT: POST word rule */
    persistRule: () => {
      // SIDE EFFECT: at I1, POST .../hyphen_join/rules
    },

    /** YAML: `appendRule` — add word rule (always-join / never-join) */
    appendRule: () => {
      // no-op at F5 (affects future scans at I1)
    },

    /** YAML: `stepPage` — prev/next page with cases */
    stepPage: () => {
      // no-op at F5; navigates page at I1
    },

    /** YAML: `navigateToLibrary` — SIDE EFFECT: open global word library */
    navigateToLibrary: () => {
      // SIDE EFFECT: navigate to cross-project library at I1
    },

    /**
     * YAML: `settleIfClear` — no-op here; handled by `always` guard.
     * DIVERGENCES.md #5 pattern.
     */
    settleIfClear: () => {
      // no-op — always guard on reviewing handles auto-settle
    },

    /** YAML: `emitResolved` — signal parent stageRunner */
    emitResolved: () => {
      // SIDE EFFECT: at I1, send RESOLVE to pipelineShell for hyphen_join runner
    },
  },
}).createMachine({
  id: "hyphenJoin",

  context: ({ input }) => ({
    projectId: input.projectId,
    stageIndex: input.stageIndex,
    services: input.services,
    cases: [],
    totals: null,
    mode: "queue",
    cursor: 0,
    pageId: null,
    error: null,
  }),

  initial: "scanning",

  states: {
    /**
     * YAML: `scanning` — rule library runs over corpus; auto-joins + flags collect.
     */
    scanning: {
      invoke: {
        id: "scanHyphenation",
        src: "scanHyphenation" as const,
        input: ({ context }: { context: HyphenJoinContext }) => ({
          projectId: context.projectId,
          services: context.services,
        }),
        onDone: [
          {
            target: "reviewing",
            guard: {
              type: "anythingToDecide",
              params: ({
                event,
              }: {
                event: {
                  output: { cases: HyphenCase[]; totals: HyphenTotals };
                };
              }) => ({ output: event.output }),
            },
            actions: [
              {
                type: "assignCases",
                params: ({
                  event,
                }: {
                  event: {
                    output: { cases: HyphenCase[]; totals: HyphenTotals };
                  };
                }) => ({ output: event.output }),
              },
            ],
          },
          {
            target: "settled",
            actions: [
              {
                type: "assignCases",
                params: ({
                  event,
                }: {
                  event: {
                    output: { cases: HyphenCase[]; totals: HyphenTotals };
                  };
                }) => ({ output: event.output }),
              },
            ],
          },
        ],
        onError: {
          target: "failed",
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
     * YAML: `reviewing` — cases await decisions across three modes.
     *
     * DIVERGENCES.md #5: `always` guard auto-settles when allDecided.
     */
    reviewing: {
      always: [
        {
          target: "settled",
          guard: "allDecided",
          actions: ["emitResolved"],
        },
      ],

      on: {
        SET_MODE: {
          actions: ["assignMode", "resetCursor"],
        },
        NEXT_CASE: { actions: ["moveNext"] },
        PREV_CASE: { actions: ["movePrev"] },
        SELECT_CASE: { actions: ["moveTo"] },

        ACCEPT_JOIN: {
          guard: "isDecidable",
          actions: ["setVerifiedJoin", "persistDecision", "advance"],
        },
        KEEP_HYPHEN: {
          guard: "isDecidable",
          actions: ["setVerifiedKeep", "persistDecision", "advance"],
        },
        VALIDATE_JOIN: {
          guard: "isUnvalidatedJoin",
          actions: ["markValidated", "persistDecision", "advance"],
        },
        FIX_MISMATCH: {
          guard: "isMismatch",
          actions: ["applyDashFix", "persistDecision", "advance"],
        },
        REVERT_DECISION: {
          actions: ["revertCase", "persistDecision"],
        },
        VALIDATE_WORD_GROUP: {
          actions: ["validateGroup", "persistGroup"],
        },

        OPEN_PAGE: { actions: ["assignPage"] },
        CLOSE_PAGE: { actions: ["clearPage"] },
        PREV_PAGE: { actions: ["stepPage"] },
        NEXT_PAGE: { actions: ["stepPage"] },
        APPLY_CONTINUE: { actions: ["persistPage", "stepPage"] },

        ADD_WORD_RULE: { actions: ["appendRule", "persistRule"] },
        OPEN_GLOBAL_LIBRARY: { actions: ["navigateToLibrary"] },
      },
    },

    /**
     * YAML: `settled` — every case decided/validated; text flows to Wordcheck.
     */
    settled: {
      entry: ["emitResolved"],

      on: {
        UPSTREAM_CHANGED: { target: "scanning" },
        SETTINGS_CHANGED: { target: "scanning" },
      },
    },

    /**
     * YAML: `failed` — scan error with retry.
     */
    failed: {
      on: {
        RETRY: { target: "scanning", actions: ["clearError"] },
      },
    },
  },
});
