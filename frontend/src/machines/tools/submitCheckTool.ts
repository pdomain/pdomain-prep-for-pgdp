/**
 * submitCheckTool — XState v5 machine for the Submit Check stage tool.
 *
 * Ported from
 * `docs/plans/design_handoff_pgdp_app/statecharts/tool-submit-check.yaml`
 *
 * Dry-runs the PGDP submission end-to-end WITHOUT uploading, then gates a
 * MANUAL attestation on it. There is no live-upload API; submission is a
 * manual step: the user downloads the zip, uploads it to their dpscans
 * folder on pgdp.net, then confirms here ("Mark as submitted").
 *
 * The two-step SUBMIT confirm is the GateConfirmation event:
 *   SUBMIT → confirmingSubmit (guard: confirmOnSubmit) → CONFIRM → submitted
 *
 * Gate chain position: zip → submit_check → (SUBMIT gate) → submitted (final)
 *
 * ## Divergences from YAML
 *   - DIVERGENCE #3: `onDone` uses `event.output` (not `event.data`).
 *   - F5.6-8: SUBMIT from `ready` branches on `confirmOnSubmit` guard:
 *     true → `confirmingSubmit` (GateConfirmation pattern from spec);
 *     false → directly to `submitted`. The YAML models this as an array
 *     of guarded transitions — XState v5 evaluates them top-to-bottom, so
 *     the first matching guard wins.
 *   - F5.6-9: `submitted` is `type: "final"` — XState v5 final states stop
 *     processing events and signal to the parent that the machine is done.
 *     This is the terminal pipeline goal at the tool layer.
 *   - F5.6-10: `assignChecks` also updates `dryRunOk` inline (DIVERGENCES #9
 *     pattern — no separate recount action).
 *   - CT 2026-06-11: `liveSubmit` service replaced by manual attestation.
 *     There is no PGDP upload API; submission is always a manual step.
 *     The `submitting` invoke state is removed; CONFIRM transitions directly
 *     to `submitted` with an inline timestamp. Recorded in DIVERGENCES.md.
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

export interface SubmitCheckSettings {
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
  dryRun(projectId: string): Promise<SubmitCheck[]>;

  /**
   * Record the manual attestation that the user uploaded the zip to pgdp.net.
   * This is a local side-effect only (no network upload); it stores the
   * GateConfirmation event (gate="submit_confirm").
   * Returns the ISO timestamp of the attestation.
   */
  markAsSubmitted(projectId: string): Promise<{ at: string }>;
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
      }
    >(({ input }) => input.services.dryRun(input.projectId)),
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
    /**
     * Record the manual attestation timestamp when the user confirms they
     * have uploaded the zip to their dpscans folder on pgdp.net.
     * CT 2026-06-11: replaces async liveSubmit invoke with inline assignment.
     */
    assignSubmittedNow: assign(
      (): Partial<SubmitCheckToolContext> => ({
        submittedAt: new Date().toISOString(),
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
            // confirmOnSubmit=false → attest immediately (no dialog)
            target: "submitted",
            actions: "assignSubmittedNow",
          },
        ],
        RERUN_DRY: { target: "dryRunning" },
        UPSTREAM_CHANGED: { target: "dryRunning" },
      },
    },

    confirmingSubmit: {
      on: {
        CONFIRM: {
          target: "submitted",
          actions: "assignSubmittedNow",
        },
        CANCEL: { target: "ready" },
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
