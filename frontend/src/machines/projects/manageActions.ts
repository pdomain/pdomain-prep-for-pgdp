/**
 * manageActions — XState v5 machine for the Manage tab action set.
 *
 * Ported from `statecharts/manage-actions.yaml`.
 *
 * Key domain rule — TWO-STEP DELETE:
 *   • DELETE on ACTIVE project = clean + archive (reversible). Routes to
 *     `confirming` with a "step 1 of 2 → archives" copy.
 *   • DELETE on ARCHIVED project = permanent (irreversible). Routes to
 *     `confirmingDanger` which requires ACKNOWLEDGE before CONFIRM.
 *
 * On success emits PROJECT_MUTATED so projectDetail re-syncs.
 *
 * @see docs/plans/design_handoff_pgdp_app/statecharts/manage-actions.yaml
 * @see src/machines/DIVERGENCES.md
 */

import { setup, assign, fromPromise } from "xstate";
import type { ManageAction, ManageActionResult } from "@/mocks/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { ManageAction };

export interface ManageActionsServices {
  /**
   * Execute a manage action.
   * delete step 1 → POST /archive; delete step 2 → DELETE /?permanent=true
   */
  runManageAction(
    projectId: string,
    action: ManageAction,
    step?: 1 | 2,
  ): Promise<ManageActionResult>;
}

export interface ManageActionsInput {
  projectId: string;
  isArchived: boolean;
  services: ManageActionsServices;
  /** Callback for PROJECT_MUTATED — parent wires this to its own logic. */
  onMutated?: (action: ManageAction, result: ManageActionResult) => void;
}

export interface ManageActionsContext {
  projectId: string;
  isArchived: boolean;
  pendingAction: ManageAction | null;
  /** 1 = delete-step-1 (archives); 2 = delete-step-2 (permanent) */
  _step: 1 | 2 | null;
  /** true after ACKNOWLEDGE in confirmingDanger.armed */
  _ack: boolean;
  result: ManageActionResult | null;
  error: string | null;
  services: ManageActionsServices;
  onMutated:
    | ((action: ManageAction, result: ManageActionResult) => void)
    | undefined;
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type ManageActionsEvent =
  | { type: "CLEAN" }
  | { type: "ARCHIVE" }
  | { type: "SAVE_COPY" }
  | { type: "DELETE" }
  | { type: "RESTORE" }
  | { type: "CONFIRM" }
  | { type: "CANCEL" }
  | { type: "ACKNOWLEDGE" }
  | { type: "RETRY" }
  | { type: "DISMISS" };

// ---------------------------------------------------------------------------
// Machine definition
// ---------------------------------------------------------------------------

export const manageActionsMachine = setup({
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  types: {} as {
    context: ManageActionsContext;
    events: ManageActionsEvent;
    input: ManageActionsInput;
  },
  actors: {
    runManageAction: fromPromise<
      ManageActionResult,
      {
        projectId: string;
        action: ManageAction;
        step: 1 | 2 | null;
        services: ManageActionsServices;
      }
    >(({ input }) =>
      input.services.runManageAction(
        input.projectId,
        input.action,
        input.step ?? undefined,
      ),
    ),
  },
  guards: {
    /** YAML: isArchived: ctx.isArchived === true */
    isArchived: ({ context }) => context.isArchived,

    /** YAML: deleteAcknowledged: ctx._ack === true */
    deleteAcknowledged: ({ context }) => context._ack,
  },
  actions: {
    setPendingClean: assign({
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      pendingAction: () => "clean" as ManageAction,
      _step: () => null,
    }),
    setPendingArchive: assign({
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      pendingAction: () => "archive" as ManageAction,
      _step: () => null,
    }),
    setPendingSaveCopy: assign({
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      pendingAction: () => "saveCopy" as ManageAction,
      _step: () => null,
    }),
    /** YAML: setPendingDeleteStep1 — step 1 → archives */
    setPendingDeleteStep1: assign({
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      pendingAction: () => "delete" as ManageAction,
      _step: () => 1 as const,
    }),
    /** YAML: setPendingDeletePermanent — step 2 → removes permanently */
    setPendingDeletePermanent: assign({
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      pendingAction: () => "delete" as ManageAction,
      _step: () => 2 as const,
    }),
    setPendingRestore: assign({
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      pendingAction: () => "restore" as ManageAction,
      _step: () => null,
    }),

    markAcknowledged: assign({ _ack: () => true }),

    clearPending: assign({
      pendingAction: () => null,
      _ack: () => false,
      _step: () => null,
    }),

    assignResult: assign({
      result: (_args, params: { output: ManageActionResult }) => params.output,
    }),

    assignError: assign({
      error: (_args, params: { error: unknown }) => {
        if (params.error instanceof Error) return params.error.message;
        return "Action failed";
      },
    }),

    clearError: assign({ error: () => null }),

    /**
     * YAML: emitMutation — notify parent so projectDetail can patch + refresh rail.
     * XState v5: call the injected onMutated callback.
     */
    emitMutation: ({ context }, params: { output: ManageActionResult }) => {
      if (context.pendingAction && context.onMutated) {
        context.onMutated(context.pendingAction, params.output);
      }
    },
  },
}).createMachine({
  id: "manageActions",
  context: ({ input }) => ({
    projectId: input.projectId,
    isArchived: input.isArchived,
    pendingAction: null,
    _step: null,
    _ack: false,
    result: null,
    error: null,
    services: input.services,
    onMutated: input.onMutated,
  }),

  initial: "deciding",

  states: {
    /**
     * YAML: deciding — pick the action set from project state.
     * Re-entered whenever the parent re-keys this machine.
     */
    deciding: {
      always: [
        { target: "archivedActions", guard: "isArchived" },
        { target: "activeActions" },
      ],
    },

    // ---- ACTIVE project action set ------------------------------------------

    activeActions: {
      initial: "list",
      states: {
        list: {
          on: {
            CLEAN: {
              target: "#manageActions.confirming",
              actions: ["setPendingClean"],
            },
            ARCHIVE: {
              target: "#manageActions.confirming",
              actions: ["setPendingArchive"],
            },
            SAVE_COPY: {
              // Non-destructive: skip the confirm gate, go straight to executing
              target: "#manageActions.executing",
              actions: ["setPendingSaveCopy"],
            },
            DELETE: {
              // Step 1 of 2 — only ARCHIVES. Confirm dialog explains that.
              target: "#manageActions.confirming",
              actions: ["setPendingDeleteStep1"],
            },
          },
        },
      },
    },

    // ---- ARCHIVED project action set ----------------------------------------

    archivedActions: {
      initial: "list",
      states: {
        list: {
          on: {
            RESTORE: {
              target: "#manageActions.confirming",
              actions: ["setPendingRestore"],
            },
            SAVE_COPY: {
              target: "#manageActions.executing",
              actions: ["setPendingSaveCopy"],
            },
            DELETE: {
              // Step 2 of 2 — PERMANENT. Routes to danger confirm.
              target: "#manageActions.confirmingDanger",
              actions: ["setPendingDeletePermanent"],
            },
          },
        },
      },
    },

    // ---- Shared confirm gate (non-danger) ------------------------------------

    confirming: {
      id: "confirming",
      on: {
        CONFIRM: { target: "executing" },
        CANCEL: {
          target: "deciding",
          actions: ["clearPending"],
        },
      },
    },

    // ---- Danger confirm gate (permanent delete only) -------------------------

    confirmingDanger: {
      initial: "armed",
      states: {
        armed: {
          on: {
            ACKNOWLEDGE: {
              target: "ready",
              actions: ["markAcknowledged"],
            },
            CANCEL: {
              target: "#manageActions.deciding",
              actions: ["clearPending"],
            },
          },
        },
        ready: {
          on: {
            CONFIRM: {
              target: "#manageActions.executing",
              guard: "deleteAcknowledged",
            },
            CANCEL: {
              target: "#manageActions.deciding",
              actions: ["clearPending"],
            },
          },
        },
      },
    },

    // ---- Execute the pending action -----------------------------------------

    executing: {
      invoke: {
        id: "runManageAction",
        src: "runManageAction",
        input: ({ context }) => ({
          projectId: context.projectId,
          action: context.pendingAction!,
          step: context._step,
          services: context.services,
        }),
        onDone: {
          target: "done",
          actions: [
            {
              type: "assignResult",
              params: ({
                event,
              }: {
                event: { output: ManageActionResult };
              }) => ({ output: event.output }),
            },
            {
              type: "emitMutation",
              params: ({
                event,
              }: {
                event: { output: ManageActionResult };
              }) => ({ output: event.output }),
            },
          ],
        },
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

    // ---- Done — brief confirmation then settle --------------------------------

    done: {
      after: {
        1500: { target: "deciding", actions: ["clearPending"] },
      },
      on: {
        DISMISS: { target: "deciding", actions: ["clearPending"] },
      },
    },

    // ---- Failed — offer Retry ------------------------------------------------

    failed: {
      on: {
        RETRY: { target: "executing", actions: ["clearError"] },
        CANCEL: {
          target: "deciding",
          actions: ["clearPending", "clearError"],
        },
      },
    },
  },
});
