/**
 * submitCheckTool — XState v5 machine for the Submit Check stage tool.
 *
 * Ported from
 * `docs/plans/design_handoff_pgdp_app/statecharts/tool-submit-check.yaml`
 *
 * Dry-runs the PGDP submission end-to-end WITHOUT uploading, then gates
 * the live submit on it. The two-step SUBMIT confirm is the GateConfirmation
 * event: SUBMIT → confirmingSubmit (guard: confirmOnSubmit) → CONFIRM → submitting.
 *
 * Gate chain position: zip → submit_check → (SUBMIT gate) → submitted (final)
 *
 * ## Divergences from YAML
 *   - DIVERGENCE #3: `onDone` uses `event.output` (not `event.data`).
 *   - F5.6-8: SUBMIT from `ready` branches on `confirmOnSubmit` guard:
 *     true → `confirmingSubmit` (GateConfirmation pattern from spec);
 *     false → directly to `submitting`. The YAML models this as an array
 *     of guarded transitions — XState v5 evaluates them top-to-bottom, so
 *     the first matching guard wins.
 *   - F5.6-9: `submitted` is `type: "final"` — XState v5 final states stop
 *     processing events and signal to the parent that the machine is done.
 *     This is the terminal pipeline goal at the tool layer.
 *   - F5.6-10: `assignChecks` also updates `dryRunOk` inline (DIVERGENCES #9
 *     pattern — no separate recount action).
 *
 * @see docs/plans/design_handoff_pgdp_app/statecharts/tool-submit-check.yaml
 * @see src/machines/DIVERGENCES.md
 */

import { setup, assign, fromPromise } from "xstate";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface SubmitCheck {
  ok: boolean;
  label: string;
}

export type SubmitTarget = "production" | "sandbox";

export interface SubmitCheckSettings {
  target: SubmitTarget;
  alwaysDryRunFirst: boolean;
  confirmOnSubmit: boolean;
}

// ---------------------------------------------------------------------------
// Services interface
// ---------------------------------------------------------------------------

export interface SubmitCheckToolServices {
  /**
   * POST /api/projects/:id/stages/submit_check/dry-run
   * -> Check[]
   */
  dryRun(projectId: string, target: SubmitTarget): Promise<SubmitCheck[]>;

  /**
   * POST /api/projects/:id/stages/submit_check/submit
   * { target } -> { at: string }
   */
  liveSubmit(projectId: string, target: SubmitTarget): Promise<{ at: string }>;
}

// ---------------------------------------------------------------------------
// Input + Context
// ---------------------------------------------------------------------------

export interface SubmitCheckToolInput {
  projectId: string;
  stageIndex: number;
  services: SubmitCheckToolServices;
  settings?: Partial<SubmitCheckSettings>;
}

export interface SubmitCheckToolContext {
  projectId: string;
  stageIndex: number;
  services: SubmitCheckToolServices;
  checks: SubmitCheck[];
  target: SubmitTarget;
  dryRunOk: boolean;
  confirmOnSubmit: boolean;
  submittedAt: string | null;
  error: Error | null;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type SubmitCheckToolEvent =
  | { type: "SUBMIT" }
  | { type: "CONFIRM" }
  | { type: "CANCEL" }
  | { type: "RERUN_DRY" }
  | { type: "UPSTREAM_CHANGED" }
  | { type: "OPEN_BLOCKER"; checkIdx: number }
  | { type: "RETRY" };

// ---------------------------------------------------------------------------
// Machine
// ---------------------------------------------------------------------------

export const submitCheckToolMachine = setup({
  types: {
    input: {} as SubmitCheckToolInput,
    context: {} as SubmitCheckToolContext,
    events: {} as SubmitCheckToolEvent,
  },
  actors: {
    dryRun: fromPromise<
      SubmitCheck[],
      {
        projectId: string;
        services: SubmitCheckToolServices;
        target: SubmitTarget;
      }
    >(({ input }) => input.services.dryRun(input.projectId, input.target)),

    liveSubmit: fromPromise<
      { at: string },
      {
        projectId: string;
        services: SubmitCheckToolServices;
        target: SubmitTarget;
      }
    >(({ input }) => input.services.liveSubmit(input.projectId, input.target)),
  },
  guards: {
    /**
     * Receives params extracted in the transition:
     *   `params: ({ event }) => ({ checks: event.output })`
     * Returns true when every check passes.
     */
    allChecksPass: (_args: unknown, params: { checks: SubmitCheck[] }) =>
      params.checks.every((c) => c.ok),
    confirmOnSubmit: ({ context }: { context: SubmitCheckToolContext }) =>
      context.confirmOnSubmit,
  },
  actions: {
    /**
     * DIVERGENCE #3: event.output (not event.data). params pattern.
     * F5.6-10: also updates dryRunOk inline (no separate recount action).
     */
    assignChecks: assign(
      (
        _args,
        params: { output: SubmitCheck[] },
      ): Partial<SubmitCheckToolContext> => ({
        checks: params.output,
        dryRunOk: params.output.every((c) => c.ok),
      }),
    ),
    assignSubmitted: assign(
      (
        _args,
        params: { output: { at: string } },
      ): Partial<SubmitCheckToolContext> => ({
        submittedAt: params.output.at,
      }),
    ),
    assignError: assign(
      (_args, params: { error: unknown }): Partial<SubmitCheckToolContext> => ({
        error:
          params.error instanceof Error
            ? params.error
            : new Error(String(params.error)),
      }),
    ),
    clearError: assign({ error: null }),
    // Side effect — navigates to the failing check's owner
    navigateToBlocker: () => {
      // SIDE EFFECT: route to failing check owner — at I1
    },
  },
}).createMachine({
  id: "submitCheckTool",
  context: ({ input }: { input: SubmitCheckToolInput }) => ({
    projectId: input.projectId,
    stageIndex: input.stageIndex,
    services: input.services,
    checks: [],
    target: input.settings?.target ?? "production",
    dryRunOk: false,
    confirmOnSubmit: input.settings?.confirmOnSubmit ?? true,
    submittedAt: null,
    error: null,
  }),
  initial: "dryRunning",
  states: {
    dryRunning: {
      invoke: {
        src: "dryRun",
        input: ({ context }: { context: SubmitCheckToolContext }) => ({
          projectId: context.projectId,
          services: context.services,
          target: context.target,
        }),
        onDone: [
          {
            target: "ready",
            guard: {
              type: "allChecksPass",
              params: ({ event }: { event: { output: SubmitCheck[] } }) => ({
                checks: event.output,
              }),
            },
            actions: [
              {
                type: "assignChecks",
                params: ({ event }: { event: { output: SubmitCheck[] } }) => ({
                  output: event.output,
                }),
              },
            ],
          },
          {
            target: "blocked",
            actions: [
              {
                type: "assignChecks",
                params: ({ event }: { event: { output: SubmitCheck[] } }) => ({
                  output: event.output,
                }),
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

    blocked: {
      on: {
        OPEN_BLOCKER: { actions: "navigateToBlocker" },
        RERUN_DRY: { target: "dryRunning" },
        UPSTREAM_CHANGED: { target: "dryRunning" },
      },
    },

    ready: {
      on: {
        SUBMIT: [
          {
            target: "confirmingSubmit",
            guard: "confirmOnSubmit",
          },
          {
            target: "submitting",
          },
        ],
        RERUN_DRY: { target: "dryRunning" },
        UPSTREAM_CHANGED: { target: "dryRunning" },
      },
    },

    confirmingSubmit: {
      on: {
        CONFIRM: { target: "submitting" },
        CANCEL: { target: "ready" },
      },
    },

    submitting: {
      invoke: {
        src: "liveSubmit",
        input: ({ context }: { context: SubmitCheckToolContext }) => ({
          projectId: context.projectId,
          services: context.services,
          target: context.target,
        }),
        onDone: {
          target: "submitted",
          actions: [
            {
              type: "assignSubmitted",
              params: ({ event }: { event: { output: { at: string } } }) => ({
                output: event.output,
              }),
            },
          ],
        },
        onError: {
          target: "ready",
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

    submitted: {
      type: "final",
    },

    failed: {
      on: {
        RETRY: { target: "dryRunning", actions: "clearError" },
      },
    },
  },
});
