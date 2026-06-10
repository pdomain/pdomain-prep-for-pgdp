/**
 * validationTool — XState v5 machine for the Validation stage tool.
 *
 * Ported from
 * `docs/plans/design_handoff_pgdp_app/statecharts/tool-validation.yaml`
 *
 * Pre-flight gate before Build package: 8 rules run over the project.
 * Rule levels: pass | warn | error. ERRORS BLOCK THE BUILD.
 * Warnings can be waived with a note (if "Allow waivers" setting is on).
 *
 * Gate chain position: validation → (gates) → build_package
 *
 * ## Divergences from YAML
 *   - DIVERGENCE #3: `onDone` uses `event.output` (not `event.data`). params pattern.
 *   - F5.6-1: `recount` is not a separate action. After applyWaiver the
 *     counts are recomputed inline and `ALL_CLEAR` is raised synchronously
 *     via the `always` guard pattern when blocker count hits 0.
 *   - F5.6-2: `ALL_CLEAR` is NOT a separate event raised by `recount`.
 *     Instead, an `always` guard in `blocked` transitions to `passed` when
 *     `blockerCount(ctx.counts, ctx.strictness) === 0`. This avoids the
 *     `raise()` ordering hazard from DIVERGENCES.md #5.
 *
 * @see docs/plans/design_handoff_pgdp_app/statecharts/tool-validation.yaml
 * @see src/machines/DIVERGENCES.md
 */

import { setup, assign, fromPromise } from "xstate";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type RuleLevel = "pass" | "warn" | "error";

export interface ValidationRule {
  id: string;
  name: string;
  level: RuleLevel;
  detail: string;
  waiver?: string;
}

export interface ValidationCounts {
  pass: number;
  warn: number;
  error: number;
}

export interface WaiverDraft {
  ruleId: string;
  note: string;
}

export type StrictnessMode = "advisory" | "block" | "custom";

export interface ValidationSettings {
  strictness: StrictnessMode;
  requireMetadataComplete: boolean;
  requireZeroScannos: boolean;
  allowWaivers: boolean;
}

// ---------------------------------------------------------------------------
// Services interface
// ---------------------------------------------------------------------------

export interface ValidationToolServices {
  /**
   * POST /api/projects/:id/stages/validation/run
   * -> { rules: ValidationRule[], counts: ValidationCounts }
   */
  runChecks(projectId: string): Promise<{
    rules: ValidationRule[];
    counts: ValidationCounts;
  }>;

  /**
   * POST /api/projects/:id/stages/validation/waive
   * { ruleId, note } -> { ok }
   */
  persistWaiver(
    projectId: string,
    ruleId: string,
    note: string,
  ): Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// Input + Context
// ---------------------------------------------------------------------------

export interface ValidationToolInput {
  projectId: string;
  stageIndex: number;
  services: ValidationToolServices;
  settings?: Partial<ValidationSettings>;
}

export interface ValidationToolContext {
  projectId: string;
  stageIndex: number;
  services: ValidationToolServices;
  rules: ValidationRule[];
  counts: ValidationCounts | null;
  waiverDraft: WaiverDraft | null;
  strictness: StrictnessMode;
  allowWaivers: boolean;
  error: Error | null;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type ValidationToolEvent =
  | { type: "RETRY" }
  | { type: "RERUN_CHECKS" }
  | { type: "FIX"; ruleId: string }
  | { type: "WAIVE"; ruleId: string }
  | { type: "SET_NOTE"; note: string }
  | { type: "CONFIRM_WAIVE" }
  | { type: "CANCEL" }
  | { type: "UPSTREAM_CHANGED" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Count the number of blocking rules given the current strictness setting.
 * - advisory: only errors block
 * - block: errors + warnings block
 * - custom: errors always block; warnings follow per-rule settings (simplified
 *   here as advisory — custom is fully implemented at I1)
 */
export function blockerCount(
  counts: ValidationCounts | null,
  strictness: StrictnessMode,
): number {
  if (!counts) return 0;
  if (strictness === "advisory") return counts.error;
  if (strictness === "block") return counts.error + counts.warn;
  // custom — treat like advisory at F5
  return counts.error;
}

function recomputeCounts(rules: ValidationRule[]): ValidationCounts {
  const counts: ValidationCounts = { pass: 0, warn: 0, error: 0 };
  for (const rule of rules) {
    // Waived rules no longer contribute to warn/error counts (they become advisory pass)
    if (rule.waiver) {
      counts.pass += 1;
    } else {
      counts[rule.level] += 1;
    }
  }
  return counts;
}

function patchRule(
  rules: ValidationRule[],
  ruleId: string,
  patcher: (r: ValidationRule) => ValidationRule,
): ValidationRule[] {
  return rules.map((r) => (r.id === ruleId ? patcher(r) : r));
}

// ---------------------------------------------------------------------------
// Machine
// ---------------------------------------------------------------------------

export const validationToolMachine = setup({
  types: {
    input: {} as ValidationToolInput,
    context: {} as ValidationToolContext,
    events: {} as ValidationToolEvent,
  },
  actors: {
    runChecks: fromPromise<
      { rules: ValidationRule[]; counts: ValidationCounts },
      { projectId: string; services: ValidationToolServices }
    >(({ input }) => input.services.runChecks(input.projectId)),

    persistWaiver: fromPromise<
      { ok: boolean },
      {
        projectId: string;
        services: ValidationToolServices;
        ruleId: string;
        note: string;
      }
    >(({ input }) =>
      input.services.persistWaiver(input.projectId, input.ruleId, input.note),
    ),
  },
  guards: {
    /**
     * Receives params extracted from the event in the transition:
     *   `params: ({ context, event }) => ({ counts: event.output.counts, strictness: context.strictness })`
     * Returns true when there are blocker rules (count > 0).
     */
    hasBlockers: (
      _args: unknown,
      params: { counts: ValidationCounts; strictness: StrictnessMode },
    ) => blockerCount(params.counts, params.strictness) > 0,
    waiversAllowed: ({
      context,
      event,
    }: {
      context: ValidationToolContext;
      event: ValidationToolEvent;
    }) => {
      if (event.type !== "WAIVE") return false;
      const rule = context.rules.find((r) => r.id === event.ruleId);
      return context.allowWaivers && rule?.level === "warn";
    },
    noBlockersRemain: ({ context }: { context: ValidationToolContext }) =>
      blockerCount(context.counts, context.strictness) === 0,
  },
  actions: {
    /**
     * DIVERGENCE #3: event.output (not event.data). params pattern.
     */
    assignRules: assign(
      (
        _args,
        params: {
          output: { rules: ValidationRule[]; counts: ValidationCounts };
        },
      ): Partial<ValidationToolContext> => ({
        rules: params.output.rules,
        counts: params.output.counts,
      }),
    ),
    assignError: assign(
      (_args, params: { error: unknown }): Partial<ValidationToolContext> => ({
        error:
          params.error instanceof Error
            ? params.error
            : new Error(String(params.error)),
      }),
    ),
    clearError: assign({ error: null }),
    beginWaiver: assign({
      waiverDraft: ({ event }: { event: ValidationToolEvent }) => {
        if (event.type !== "WAIVE") return null;
        return { ruleId: event.ruleId, note: "" };
      },
    }),
    patchWaiver: assign({
      waiverDraft: ({
        context,
        event,
      }: {
        context: ValidationToolContext;
        event: ValidationToolEvent;
      }) => {
        if (event.type !== "SET_NOTE" || !context.waiverDraft)
          return context.waiverDraft;
        return { ...context.waiverDraft, note: event.note };
      },
    }),
    applyWaiver: assign({
      rules: ({ context }: { context: ValidationToolContext }) => {
        if (!context.waiverDraft) return context.rules;
        const { ruleId, note } = context.waiverDraft;
        return patchRule(context.rules, ruleId, (r) => ({
          ...r,
          waiver: note,
        }));
      },
      counts: ({ context }: { context: ValidationToolContext }) => {
        if (!context.waiverDraft) return context.counts;
        const { ruleId, note } = context.waiverDraft;
        const updated = patchRule(context.rules, ruleId, (r) => ({
          ...r,
          waiver: note,
        }));
        return recomputeCounts(updated);
      },
      waiverDraft: null,
    }),
    clearWaiver: assign({ waiverDraft: null }),
    // navigateToFix is a side-effect — not tracked in machine context at F5
    navigateToFix: () => {
      // SIDE EFFECT: route to owning stage — implemented at I1
    },
  },
}).createMachine({
  id: "validationTool",
  context: ({ input }: { input: ValidationToolInput }) => ({
    projectId: input.projectId,
    stageIndex: input.stageIndex,
    services: input.services,
    rules: [],
    counts: null,
    waiverDraft: null,
    strictness: input.settings?.strictness ?? "advisory",
    allowWaivers: input.settings?.allowWaivers ?? true,
    error: null,
  }),
  initial: "checking",
  states: {
    checking: {
      invoke: {
        src: "runChecks",
        input: ({ context }: { context: ValidationToolContext }) => ({
          projectId: context.projectId,
          services: context.services,
        }),
        onDone: [
          {
            target: "blocked",
            guard: {
              type: "hasBlockers",
              params: ({
                context,
                event,
              }: {
                context: ValidationToolContext;
                event: {
                  output: { rules: ValidationRule[]; counts: ValidationCounts };
                };
              }) => ({
                counts: event.output.counts,
                strictness: context.strictness,
              }),
            },
            actions: [
              {
                type: "assignRules",
                params: ({
                  event,
                }: {
                  event: {
                    output: {
                      rules: ValidationRule[];
                      counts: ValidationCounts;
                    };
                  };
                }) => ({ output: event.output }),
              },
            ],
          },
          {
            target: "passed",
            actions: [
              {
                type: "assignRules",
                params: ({
                  event,
                }: {
                  event: {
                    output: {
                      rules: ValidationRule[];
                      counts: ValidationCounts;
                    };
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
        RETRY: { target: "checking", actions: "clearError" },
      },
    },

    blocked: {
      always: [
        {
          guard: "noBlockersRemain",
          target: "passed",
        },
      ],
      initial: "idle",
      states: {
        idle: {
          on: {
            FIX: { actions: "navigateToFix" },
            WAIVE: {
              target: "waiving",
              guard: "waiversAllowed",
              actions: "beginWaiver",
            },
          },
        },
        waiving: {
          on: {
            SET_NOTE: { actions: "patchWaiver" },
            CONFIRM_WAIVE: {
              target: "idle",
              actions: "applyWaiver",
            },
            CANCEL: { target: "idle", actions: "clearWaiver" },
          },
        },
      },
      on: {
        RERUN_CHECKS: { target: "checking" },
      },
    },

    passed: {
      on: {
        RERUN_CHECKS: { target: "checking" },
        UPSTREAM_CHANGED: { target: "checking" },
      },
    },
  },
});
