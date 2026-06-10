/**
 * regexPass — XState v5 machine for the Regex pass stage tool.
 *
 * Ported from `docs/plans/design_handoff_pgdp_app/statecharts/tool-regex.yaml`
 * with the mechanical conventions in DIVERGENCES.md.
 *
 * Stage: regex (project-scoped, Text group)
 *
 * ## Architecture
 * loading → reviewing (idle ↔ previewing, runningRule) | clean | error
 *
 * ## Rule lifecycle
 * Rules have status: 'applied' | 'review' | 'pending'.
 * 'review' rules must show before/after hunks before committing.
 * Reordering / toggling after a clean pass re-opens reviewing.
 *
 * ## Snapshot
 * A snapshot (restore point) is taken before the first run, enabling ROLLBACK.
 *
 * @see docs/plans/design_handoff_pgdp_app/statecharts/tool-regex.yaml
 * @see src/machines/DIVERGENCES.md — conventions
 */

import { setup, assign, fromPromise } from "xstate";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type RuleStatus = "applied" | "review" | "pending";
export type RuleScope = "all" | "selected" | "page";

export interface RegexRule {
  id: string;
  name: string;
  find: string;
  repl: string;
  flags: string;
  scope: RuleScope;
  status: RuleStatus;
  enabled: boolean;
  matches: number;
}

export interface RegexCounts {
  rules: number;
  applied: number;
  review: number;
  pending: number;
  matches: number;
}

export interface HunkEntry {
  page: string;
  before: string;
  after: string;
  warn?: boolean;
}

export type ListFilter = "all" | "applied" | "review" | "disabled";

// ---------------------------------------------------------------------------
// Services interface
// ---------------------------------------------------------------------------

export interface RegexPassServices {
  /**
   * GET /api/projects/:id/stages/regex/rules -> { rules, counts, snapshotId }
   */
  fetchRules(projectId: string): Promise<{
    rules: RegexRule[];
    counts: RegexCounts;
    snapshotId: string | null;
  }>;

  /**
   * POST /api/projects/:id/stages/regex/rules/:ruleId/apply -> { rule, counts }
   */
  applyRule(
    projectId: string,
    ruleId: string,
  ): Promise<{ rule: RegexRule; counts: RegexCounts }>;
}

// ---------------------------------------------------------------------------
// Input + Context
// ---------------------------------------------------------------------------

export interface RegexPassInput {
  projectId: string;
  stageIndex: number;
  services: RegexPassServices;
  /** If true, rules in 'review' state require preview before committing. */
  requirePreviewToCommit?: boolean;
  /** If true, machine re-opens reviewing on TEXT_CHANGED. */
  rerunOnTextChange?: boolean;
}

export interface RegexPassContext {
  projectId: string;
  stageIndex: number;
  services: RegexPassServices;

  rules: RegexRule[];
  counts: RegexCounts | null;
  previewRule: string | null;
  hunks: HunkEntry[];
  listFilter: ListFilter;
  snapshotId: string | null;

  /** Settings that gate behavior */
  _settings: {
    requirePreviewToCommit: boolean;
    rerunOnTextChange: boolean;
  };

  error: { message: string } | null;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type RegexPassEvent =
  // rule management
  | { type: "TOGGLE_RULE"; ruleId: string }
  | {
      type: "ADD_RULE";
      fields: Omit<RegexRule, "id" | "status" | "matches">;
    }
  | { type: "REORDER_RULE"; from: number; to: number }
  | { type: "LOAD_PRESET" }
  | { type: "SET_LIST_FILTER"; value: ListFilter }
  // review flow
  | { type: "OPEN_PREVIEW"; ruleId: string }
  | { type: "COMMIT_RULE" }
  | { type: "SKIP_RULE" }
  | { type: "CLOSE" }
  | { type: "RUN_RULE"; ruleId: string }
  // clean state
  | { type: "ROLLBACK" }
  | { type: "TEXT_CHANGED" }
  // error state
  | { type: "RETRY" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function patchRule(
  rules: RegexRule[],
  id: string,
  fn: (r: RegexRule) => RegexRule,
): RegexRule[] {
  return rules.map((r) => (r.id === id ? fn(r) : r));
}

function reorder<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr];
  const [item] = next.splice(from, 1);
  if (item !== undefined) {
    next.splice(to, 0, item);
  }
  return next;
}

function newRule(
  fields: Omit<RegexRule, "id" | "status" | "matches">,
): RegexRule {
  return {
    ...fields,
    id: `rule-${Date.now()}`,
    status: "pending",
    matches: 0,
  };
}

function recountRules(rules: RegexRule[]): RegexCounts {
  const applied = rules.filter(
    (r) => r.status === "applied" && r.enabled,
  ).length;
  const review = rules.filter((r) => r.status === "review" && r.enabled).length;
  const pending = rules.filter(
    (r) => r.status === "pending" && r.enabled,
  ).length;
  const matches = rules.reduce((s, r) => s + r.matches, 0);
  return {
    rules: rules.length,
    applied,
    review,
    pending,
    matches,
  };
}

// ---------------------------------------------------------------------------
// Machine
// ---------------------------------------------------------------------------

export const regexPassMachine = setup({
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  types: {} as {
    context: RegexPassContext;
    events: RegexPassEvent;
    input: RegexPassInput;
  },

  actors: {
    /** YAML: `services.fetchRules` */
    fetchRules: fromPromise<
      { rules: RegexRule[]; counts: RegexCounts; snapshotId: string | null },
      { projectId: string; services: RegexPassServices }
    >(({ input }) => input.services.fetchRules(input.projectId)),

    /** YAML: `services.applyRule` */
    applyRule: fromPromise<
      { rule: RegexRule; counts: RegexCounts },
      { projectId: string; ruleId: string; services: RegexPassServices }
    >(({ input }) => input.services.applyRule(input.projectId, input.ruleId)),
  },

  guards: {
    /**
     * YAML: `nothingPending: event.data.counts.review + event.data.counts.pending === 0`
     * DIVERGENCES.md #3: event.output.
     */
    nothingPending: (
      _args,
      params: {
        output: {
          rules: RegexRule[];
          counts: RegexCounts;
          snapshotId: string | null;
        };
      },
    ) => params.output.counts.review + params.output.counts.pending === 0,

    /**
     * YAML: `nothingPendingAfter: ctx.counts.review + ctx.counts.pending === 0`
     * Guards transition after applyRule completes.
     *
     * DIVERGENCES.md #3: XState v5 fires guards BEFORE actions, so context.counts
     * still holds pre-merge values here. Use params (event.output.counts) for the
     * post-apply count check.
     */
    nothingPendingAfter: (
      _args,
      params: { output: { rule: RegexRule; counts: RegexCounts } },
    ) => params.output.counts.review + params.output.counts.pending === 0,

    /**
     * YAML: `ruleIsPending: ruleOf(ctx, event.ruleId).status === 'pending'`
     */
    ruleIsPending: ({ context, event }) => {
      if (event.type !== "RUN_RULE") return false;
      const rule = context.rules.find((r) => r.id === event.ruleId);
      return rule?.status === "pending" || false;
    },

    /**
     * YAML: `rerunOnChangeEnabled: ctx._settings.rerunOnTextChange === true`
     */
    rerunOnChangeEnabled: ({ context }) => context._settings.rerunOnTextChange,
  },

  actions: {
    /**
     * YAML: `assignRules: ctx.rules = event.data.rules; ctx.counts = ...; ctx.snapshotId = ...`
     * DIVERGENCES.md #3: event.output.
     */
    assignRules: assign({
      rules: (
        _args,
        params: {
          output: {
            rules: RegexRule[];
            counts: RegexCounts;
            snapshotId: string | null;
          };
        },
      ) => params.output.rules,
      counts: (
        _args,
        params: {
          output: {
            rules: RegexRule[];
            counts: RegexCounts;
            snapshotId: string | null;
          };
        },
      ) => params.output.counts,
      snapshotId: (
        _args,
        params: {
          output: {
            rules: RegexRule[];
            counts: RegexCounts;
            snapshotId: string | null;
          };
        },
      ) => params.output.snapshotId,
    }),

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

    /** YAML: `assignPreviewRule: ctx.previewRule = event.ruleId` */
    assignPreviewRule: assign({
      previewRule: ({ event }) => {
        if (event.type !== "OPEN_PREVIEW") return null;
        return event.ruleId;
      },
    }),

    /** YAML: `clearPreview: ctx.previewRule = null; ctx.hunks = []` */
    clearPreview: assign({
      previewRule: () => null,
      hunks: () => [] as HunkEntry[],
    }),

    /**
     * YAML: `markSkipped` — rule stays in 'review'; record skip.
     * At F5: no-op (the skip is ephemeral in UI state at I1).
     */
    markSkipped: () => {
      // no-op at F5; at I1 updates skip state in UI
    },

    /**
     * YAML: `mergeRule` — upsert event.data.rule; ctx.counts = event.data.counts
     * DIVERGENCES.md #3: event.output; #9: recount inlined.
     */
    mergeRule: assign({
      rules: (
        { context },
        params: { output: { rule: RegexRule; counts: RegexCounts } },
      ) => {
        const idx = context.rules.findIndex(
          (r) => r.id === params.output.rule.id,
        );
        if (idx === -1) return [...context.rules, params.output.rule];
        return context.rules.map((r, i) =>
          i === idx ? params.output.rule : r,
        );
      },
      counts: (
        _args,
        params: { output: { rule: RegexRule; counts: RegexCounts } },
      ) => params.output.counts,
    }),

    /** YAML: `toggleEnabled: ctx.rules = patchRule(ctx.rules, event.ruleId, r => ({ ...r, enabled: !r.enabled }))` */
    toggleEnabled: assign({
      rules: ({ context, event }) => {
        if (event.type !== "TOGGLE_RULE") return context.rules;
        const next = patchRule(context.rules, event.ruleId, (r) => ({
          ...r,
          enabled: !r.enabled,
        }));
        return next;
      },
      counts: ({ context, event }) => {
        if (event.type !== "TOGGLE_RULE") return context.counts;
        const next = patchRule(context.rules, event.ruleId, (r) => ({
          ...r,
          enabled: !r.enabled,
        }));
        return recountRules(next);
      },
    }),

    /** YAML: `appendRule: ctx.rules = [...ctx.rules, newRule(event.fields)]` */
    appendRule: assign({
      rules: ({ context, event }) => {
        if (event.type !== "ADD_RULE") return context.rules;
        return [...context.rules, newRule(event.fields)];
      },
      counts: ({ context, event }) => {
        if (event.type !== "ADD_RULE") return context.counts;
        const next = [...context.rules, newRule(event.fields)];
        return recountRules(next);
      },
    }),

    /** YAML: `moveRule: ctx.rules = reorder(ctx.rules, event.from, event.to)` */
    moveRule: assign({
      rules: ({ context, event }) => {
        if (event.type !== "REORDER_RULE") return context.rules;
        return reorder(context.rules, event.from, event.to);
      },
    }),

    /**
     * YAML: `invalidateDownstreamRules` — rules after moved index with 'applied' → 'review'.
     */
    invalidateDownstreamRules: assign({
      rules: ({ context, event }) => {
        if (event.type !== "REORDER_RULE") return context.rules;
        const movedTo = event.to;
        return context.rules.map((r, i) =>
          i > movedTo && r.status === "applied"
            ? { ...r, status: "review" as const }
            : r,
        );
      },
      counts: ({ context, event }) => {
        if (event.type !== "REORDER_RULE") return context.counts;
        const movedTo = event.to;
        const next = context.rules.map((r, i) =>
          i > movedTo && r.status === "applied"
            ? { ...r, status: "review" as const }
            : r,
        );
        return recountRules(next);
      },
    }),

    /** YAML: `invalidateAllRules` — applied → review (text changed under them) */
    invalidateAllRules: assign({
      rules: ({ context }) =>
        context.rules.map((r) =>
          r.status === "applied" ? { ...r, status: "review" as const } : r,
        ),
      counts: ({ context }) => {
        const next = context.rules.map((r) =>
          r.status === "applied" ? { ...r, status: "review" as const } : r,
        );
        return recountRules(next);
      },
    }),

    /** YAML: `assignListFilter: ctx.listFilter = event.value` */
    assignListFilter: assign({
      listFilter: ({ event }) => {
        if (event.type !== "SET_LIST_FILTER") return "all" as const;
        return event.value;
      },
    }),

    // ---- Side-effect slots — no-op at F5; wired at I1 ----------------------

    /** YAML: `loadHunks` — GET preview hunks for ruleId → ctx.hunks */
    loadHunks: () => {
      // SIDE EFFECT: at I1, GET .../regex/rules/:ruleId/preview
    },

    /** YAML: `persistRule` — PATCH rule */
    persistRule: () => {
      // SIDE EFFECT: at I1, PATCH .../regex/rules/:id
    },

    /** YAML: `persistOrder` — PUT rule order */
    persistOrder: () => {
      // SIDE EFFECT: at I1, PUT .../regex/rules/order
    },

    /** YAML: `requestPreset` — load rule preset */
    requestPreset: () => {
      // SIDE EFFECT: at I1, POST .../regex/preset
    },

    /** YAML: `requestRollback` — POST restore snapshotId */
    requestRollback: () => {
      // SIDE EFFECT: at I1, POST .../regex/rollback { snapshotId }
    },

    /** YAML: `emitResolved` — signal parent stageRunner */
    emitResolved: () => {
      // SIDE EFFECT: at I1, send RESOLVE to pipelineShell for regex runner
    },
  },
}).createMachine({
  id: "regexPass",

  context: ({ input }) => ({
    projectId: input.projectId,
    stageIndex: input.stageIndex,
    services: input.services,
    rules: [],
    counts: null,
    previewRule: null,
    hunks: [],
    listFilter: "all",
    snapshotId: null,
    _settings: {
      requirePreviewToCommit: input.requirePreviewToCommit ?? false,
      rerunOnTextChange: input.rerunOnTextChange ?? false,
    },
    error: null,
  }),

  initial: "loading",

  states: {
    /**
     * YAML: `loading` — fetch rules from server.
     */
    loading: {
      invoke: {
        id: "fetchRules",
        src: "fetchRules" as const,
        input: ({ context }: { context: RegexPassContext }) => ({
          projectId: context.projectId,
          services: context.services,
        }),
        onDone: [
          {
            target: "clean",
            guard: {
              type: "nothingPending",
              params: ({
                event,
              }: {
                event: {
                  output: {
                    rules: RegexRule[];
                    counts: RegexCounts;
                    snapshotId: string | null;
                  };
                };
              }) => ({ output: event.output }),
            },
            actions: [
              {
                type: "assignRules",
                params: ({
                  event,
                }: {
                  event: {
                    output: {
                      rules: RegexRule[];
                      counts: RegexCounts;
                      snapshotId: string | null;
                    };
                  };
                }) => ({ output: event.output }),
              },
            ],
          },
          {
            target: "reviewing",
            actions: [
              {
                type: "assignRules",
                params: ({
                  event,
                }: {
                  event: {
                    output: {
                      rules: RegexRule[];
                      counts: RegexCounts;
                      snapshotId: string | null;
                    };
                  };
                }) => ({ output: event.output }),
              },
            ],
          },
        ],
        onError: {
          target: "error",
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
     * YAML: `reviewing` — "N rules awaiting a decision."
     * Initial: idle; can open preview or run a pending rule directly.
     */
    reviewing: {
      initial: "idle",

      on: {
        TOGGLE_RULE: { actions: ["toggleEnabled", "persistRule"] },
        ADD_RULE: { actions: ["appendRule", "persistRule"] },
        REORDER_RULE: {
          actions: ["moveRule", "persistOrder", "invalidateDownstreamRules"],
        },
        LOAD_PRESET: { target: "loading", actions: ["requestPreset"] },
        SET_LIST_FILTER: { actions: ["assignListFilter"] },
      },

      states: {
        /**
         * YAML: `idle` — rule list; open preview or run pending rules.
         */
        idle: {
          on: {
            OPEN_PREVIEW: {
              target: "previewing",
              actions: ["assignPreviewRule", "loadHunks"],
            },
            RUN_RULE: {
              target: "runningRule",
              guard: "ruleIsPending",
            },
          },
        },

        /**
         * YAML: `previewing` — before/after hunks for one rule; commit or skip.
         */
        previewing: {
          on: {
            COMMIT_RULE: {
              target: "runningRule",
            },
            SKIP_RULE: {
              target: "idle",
              actions: ["markSkipped", "clearPreview"],
            },
            CLOSE: {
              target: "idle",
              actions: ["clearPreview"],
            },
          },
        },

        /**
         * YAML: `runningRule` — invoke applyRule; on done check nothingPendingAfter.
         */
        runningRule: {
          invoke: {
            id: "applyRule",
            src: "applyRule" as const,
            input: ({ context }: { context: RegexPassContext }) => ({
              projectId: context.projectId,
              // Apply the previewed rule or the last OPEN_PREVIEW target.
              // At F5, use previewRule if set; otherwise apply the first pending rule.
              ruleId:
                context.previewRule ??
                context.rules.find((r) => r.status === "pending")?.id ??
                "",
              services: context.services,
            }),
            onDone: [
              {
                target: "#regexPass.clean",
                guard: {
                  type: "nothingPendingAfter",
                  // Guard reads context AFTER mergeRule fires.
                  // XState fires guard before action, so we compute post-merge inline.
                  // Actual check in the guard impl uses context.counts which is
                  // updated by mergeRule action simultaneously.
                  // Use params to pass the event.output for inline check.
                  params: ({
                    event,
                  }: {
                    event: { output: { rule: RegexRule; counts: RegexCounts } };
                  }) => ({ output: event.output }),
                },
                actions: [
                  {
                    type: "mergeRule",
                    params: ({
                      event,
                    }: {
                      event: {
                        output: { rule: RegexRule; counts: RegexCounts };
                      };
                    }) => ({ output: event.output }),
                  },
                  "emitResolved",
                  "clearPreview",
                ],
              },
              {
                target: "idle",
                actions: [
                  {
                    type: "mergeRule",
                    params: ({
                      event,
                    }: {
                      event: {
                        output: { rule: RegexRule; counts: RegexCounts };
                      };
                    }) => ({ output: event.output }),
                  },
                  "clearPreview",
                ],
              },
            ],
            onError: {
              target: "idle",
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

    /**
     * YAML: `clean` — all enabled rules applied; pass snapshotted and reversible.
     */
    clean: {
      on: {
        ROLLBACK: {
          target: "loading",
          actions: ["requestRollback"],
        },
        ADD_RULE: {
          target: "reviewing",
          actions: ["appendRule", "persistRule"],
        },
        TOGGLE_RULE: {
          target: "reviewing",
          actions: ["toggleEnabled", "persistRule"],
        },
        TEXT_CHANGED: {
          target: "reviewing",
          guard: "rerunOnChangeEnabled",
          actions: ["invalidateAllRules"],
        },
      },
    },

    /**
     * YAML: `error` — load failure with retry.
     */
    error: {
      on: {
        RETRY: { target: "loading", actions: ["clearError"] },
      },
    },
  },
});
