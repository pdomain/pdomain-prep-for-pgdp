/**
 * projectSettings — XState v5 machine for the project-scoped settings panel.
 *
 * Ported from `docs/plans/design_handoff_pgdp_app/statecharts/project-settings.yaml`.
 *
 * ## Responsibilities
 *   • Left-rail group navigation (general / bib / pgdp / format / defaults /
 *     members / storage / danger).
 *   • Per-field autosave (FIELD_CHANGE → autosave → FIELD_SAVED/FAILED).
 *   • Automation toggles (TOGGLE_AUTOMATION → same autosave path).
 *   • Danger zone: confirm-gated destructive actions (reset / purge / delete)
 *     with a two-step ACKNOWLEDGE → CONFIRM gate.
 *
 * ## pipelineShell integration
 * Spawned by pipelineShell on OPEN_SETTINGS; stopped on CLOSE_SETTINGS.
 * pipelineShell reads ctx.automation back when closing to sync its own automation
 * toggles with whatever the user changed in settings.
 *
 * @see docs/plans/design_handoff_pgdp_app/statecharts/project-settings.yaml
 * @see src/machines/pipelineShell.ts — AutomationToggles type
 * @see src/machines/DIVERGENCES.md
 */

import { setup, assign, fromPromise } from "xstate";
import type { AutomationToggles } from "./pipelineShell";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SettingsGroup =
  | "general"
  | "bib"
  | "pgdp"
  | "format"
  | "defaults"
  | "members"
  | "storage"
  | "danger";

export type DestructiveAction = "reset" | "purge" | "delete";

export type ProjectSettingsValues = Record<string, unknown>;

export interface ProjectSettingsServices {
  /**
   * YAML: `fetchSettings: 'GET /api/projects/:id/settings -> { values, automation }'`
   */
  fetchSettings(projectId: string): Promise<{
    values: ProjectSettingsValues;
    automation: AutomationToggles;
  }>;

  /**
   * YAML: `autosaveField (SIDE EFFECT: PATCH settings field)`
   * Returns a promise; machine sends FIELD_SAVED / FIELD_FAILED on completion.
   */
  saveField(projectId: string, key: string, value: unknown): Promise<void>;

  /**
   * YAML: `autosaveAutomation (SIDE EFFECT: PATCH automation)`
   */
  saveAutomation(
    projectId: string,
    automation: AutomationToggles,
  ): Promise<void>;

  /**
   * YAML: `runDestructive: 'POST /api/projects/:id/settings/danger/:action -> result'`
   */
  runDestructive(
    projectId: string,
    action: DestructiveAction,
  ): Promise<{ ok: boolean; message?: string }>;
}

export interface ProjectSettingsInput {
  projectId: string;
  services: ProjectSettingsServices;
}

export interface ProjectSettingsContext {
  projectId: string;
  services: ProjectSettingsServices;
  group: SettingsGroup;
  values: ProjectSettingsValues;
  automation: AutomationToggles;
  /** Set of field keys currently being saved (optimistic dirty tracking). */
  dirtyFields: Set<string>;
  error: string | null;
  /**
   * Danger zone: pending destructive action (reset | purge | delete).
   */
  _pending: DestructiveAction | null;
  /** Danger zone: whether the user has acknowledged the warning. */
  _ack: boolean;
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type AutomationKey = keyof AutomationToggles;

export type ProjectSettingsEvent =
  | { type: "RETRY" }
  | { type: "SET_GROUP"; group: SettingsGroup }
  | { type: "FIELD_CHANGE"; key: string; value: unknown }
  | { type: "FIELD_SAVED"; key: string }
  | { type: "FIELD_FAILED"; key: string; error: string }
  | { type: "TOGGLE_AUTOMATION"; key: AutomationKey; value: boolean | number }
  | { type: "REQUEST_DESTRUCTIVE"; action: DestructiveAction }
  | { type: "ACKNOWLEDGE" }
  | { type: "CONFIRM" }
  | { type: "CANCEL" };

// ---------------------------------------------------------------------------
// Machine definition
// ---------------------------------------------------------------------------

export const projectSettingsMachine = setup({
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  types: {} as {
    context: ProjectSettingsContext;
    events: ProjectSettingsEvent;
    input: ProjectSettingsInput;
  },

  actors: {
    /**
     * YAML: `fetchSettings`
     */
    fetchSettings: fromPromise<
      { values: ProjectSettingsValues; automation: AutomationToggles },
      { projectId: string; services: ProjectSettingsServices }
    >(({ input }) => input.services.fetchSettings(input.projectId)),

    /**
     * YAML: `runDestructive`
     */
    runDestructive: fromPromise<
      { ok: boolean; message?: string },
      {
        projectId: string;
        action: DestructiveAction;
        services: ProjectSettingsServices;
      }
    >(({ input }) =>
      input.services.runDestructive(input.projectId, input.action),
    ),
  },

  guards: {
    /**
     * YAML: `acknowledged: ctx._ack === true`
     */
    acknowledged: ({ context }) => context._ack,
  },

  actions: {
    /** YAML: `assignSettings: ctx.values = event.data.values` */
    assignSettings: assign(
      (_args, params: { values: ProjectSettingsValues }) => ({
        values: params.values,
      }),
    ),

    /** YAML: `assignAutomation: ctx.automation = event.data.automation` */
    assignAutomation: assign(
      (_args, params: { automation: AutomationToggles }) => ({
        automation: params.automation,
      }),
    ),

    /** YAML: `assignGroup: ctx.group = event.group` */
    assignGroup: assign({
      group: ({ event }) => {
        if (event.type !== "SET_GROUP") return "general";
        return event.group;
      },
    }),

    /** YAML: `assignError` */
    assignError: assign((_args, params: { error: unknown }) => ({
      error:
        params.error instanceof Error
          ? params.error.message
          : typeof params.error === "string"
            ? params.error
            : "Unknown error",
    })),

    /** YAML: `clearError` */
    clearError: assign({ error: () => null }),

    /**
     * YAML: `markFieldDirty: ctx.dirtyFields[event.key] = true`
     * Immutably add the key to the dirty set.
     */
    markFieldDirty: assign({
      dirtyFields: ({ context, event }) => {
        if (event.type !== "FIELD_CHANGE") return context.dirtyFields;
        return new Set([...context.dirtyFields, event.key]);
      },
    }),

    /**
     * YAML: `clearFieldDirty: delete ctx.dirtyFields[event.key]`
     */
    clearFieldDirty: assign({
      dirtyFields: ({ context, event }) => {
        if (event.type !== "FIELD_SAVED" && event.type !== "FIELD_FAILED")
          return context.dirtyFields;
        const next = new Set(context.dirtyFields);
        next.delete(event.key);
        return next;
      },
    }),

    /**
     * YAML: `autosaveField — SIDE EFFECT: PATCH settings field`
     * Fires and forgets; the UI can show dirty state while saving.
     * On completion the component sends FIELD_SAVED / FIELD_FAILED.
     */
    autosaveField: ({ context, event }) => {
      if (event.type !== "FIELD_CHANGE") return;
      void context.services
        .saveField(context.projectId, event.key, event.value)
        .then(() => {
          // The consumer must send FIELD_SAVED back to the machine.
          // This side-effect fires and forgets — the machine does not
          // track the promise internally (no actor spawned for simplicity).
        })
        .catch(() => {
          // Same for errors.
        });
    },

    /**
     * YAML: `setAutomation: ctx.automation[event.key] = event.value`
     */
    setAutomation: assign({
      automation: ({ context, event }) => {
        if (event.type !== "TOGGLE_AUTOMATION") return context.automation;
        return { ...context.automation, [event.key]: event.value };
      },
    }),

    /**
     * YAML: `autosaveAutomation — SIDE EFFECT: PATCH automation`
     */
    autosaveAutomation: ({ context, event }) => {
      if (event.type !== "TOGGLE_AUTOMATION") return;
      void context.services.saveAutomation(context.projectId, {
        ...context.automation,
        [event.key]: event.value,
      });
    },

    /**
     * YAML: `flagFieldError: ctx.error = event.error`
     */
    flagFieldError: assign({
      error: ({ event }) => {
        if (event.type !== "FIELD_FAILED") return null;
        return event.error;
      },
    }),

    /**
     * YAML: `setPendingDestructive: ctx._pending = event.action`
     */
    setPendingDestructive: assign({
      _pending: ({ event }) => {
        if (event.type !== "REQUEST_DESTRUCTIVE") return null;
        return event.action;
      },
    }),

    /** YAML: `markAck: ctx._ack = true` */
    markAck: assign({ _ack: () => true }),

    /** YAML: `clearPending: ctx._pending = null; ctx._ack = false` */
    clearPending: assign({ _pending: () => null, _ack: () => false }),

    /** YAML: `applyDestructiveResult` — reflect result into values if needed */
    applyDestructiveResult: assign(
      (_args, params: { result: { ok: boolean; message?: string } }) => {
        void params.result; // result available for derived state if needed
        return {};
      },
    ),
  },
}).createMachine({
  id: "projectSettings",
  context: ({ input }) => ({
    projectId: input.projectId,
    services: input.services,
    group: "general",
    values: {},
    automation: {
      autoRunAfterIngest: true,
      rerunDownstreamOnStale: true,
      notifyOnError: true,
      pauseOnFlagPct: 10,
    },
    dirtyFields: new Set<string>(),
    error: null,
    _pending: null,
    _ack: false,
  }),

  initial: "loading",

  states: {
    loading: {
      invoke: {
        id: "fetchSettings",
        src: "fetchSettings",
        input: ({ context }) => ({
          projectId: context.projectId,
          services: context.services,
        }),
        onDone: {
          target: "ready",
          actions: [
            {
              type: "assignSettings",
              params: ({
                event,
              }: {
                event: {
                  output: {
                    values: ProjectSettingsValues;
                    automation: AutomationToggles;
                  };
                };
              }) => ({ values: event.output.values }),
            },
            {
              type: "assignAutomation",
              params: ({
                event,
              }: {
                event: {
                  output: {
                    values: ProjectSettingsValues;
                    automation: AutomationToggles;
                  };
                };
              }) => ({ automation: event.output.automation }),
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

    ready: {
      initial: "general",

      on: {
        /**
         * YAML: `SET_GROUP` — transitions the machine to the group sub-state.
         * Non-danger groups are all equivalent leaf states; danger has danger-zone sub-states.
         */
        SET_GROUP: [
          {
            guard: ({ event }) =>
              event.type === "SET_GROUP" && event.group === "general",
            target: ".general",
            actions: ["assignGroup"],
          },
          {
            guard: ({ event }) =>
              event.type === "SET_GROUP" && event.group === "bib",
            target: ".bib",
            actions: ["assignGroup"],
          },
          {
            guard: ({ event }) =>
              event.type === "SET_GROUP" && event.group === "pgdp",
            target: ".pgdp",
            actions: ["assignGroup"],
          },
          {
            guard: ({ event }) =>
              event.type === "SET_GROUP" && event.group === "format",
            target: ".format",
            actions: ["assignGroup"],
          },
          {
            guard: ({ event }) =>
              event.type === "SET_GROUP" && event.group === "defaults",
            target: ".defaults",
            actions: ["assignGroup"],
          },
          {
            guard: ({ event }) =>
              event.type === "SET_GROUP" && event.group === "members",
            target: ".members",
            actions: ["assignGroup"],
          },
          {
            guard: ({ event }) =>
              event.type === "SET_GROUP" && event.group === "storage",
            target: ".storage",
            actions: ["assignGroup"],
          },
          {
            guard: ({ event }) =>
              event.type === "SET_GROUP" && event.group === "danger",
            target: ".danger",
            actions: ["assignGroup"],
          },
        ],

        /** Autosave model: per-field PATCH. */
        FIELD_CHANGE: {
          actions: ["markFieldDirty", "autosaveField"],
        },
        FIELD_SAVED: {
          actions: ["clearFieldDirty"],
        },
        FIELD_FAILED: {
          actions: ["clearFieldDirty", "flagFieldError"],
        },

        /** Automation toggles — autosave + remember for close sync. */
        TOGGLE_AUTOMATION: {
          actions: ["setAutomation", "autosaveAutomation"],
        },
      },

      states: {
        /** Non-danger groups are plain autosave forms — modeled as leaf states. */
        general: {},
        bib: {},
        pgdp: {},
        format: {},
        defaults: {},
        members: {},
        storage: {},

        /**
         * Danger zone — confirm-gated destructive actions.
         * Sub-state: idle → confirming → armed → executing → idle
         *
         * Entered via `SET_GROUP { group: "danger" }` from any other group.
         * YAML: `danger.initial: idle`
         */
        danger: {
          initial: "idle",
          states: {
            idle: {
              on: {
                REQUEST_DESTRUCTIVE: {
                  target: "confirming",
                  actions: ["setPendingDestructive"],
                },
              },
            },
            confirming: {
              description:
                "High-friction confirm — cannot be undone (first acknowledgment).",
              on: {
                ACKNOWLEDGE: { target: "armed", actions: ["markAck"] },
                CANCEL: { target: "idle", actions: ["clearPending"] },
              },
            },
            armed: {
              on: {
                CONFIRM: {
                  target: "executing",
                  guard: "acknowledged",
                },
                CANCEL: { target: "idle", actions: ["clearPending"] },
              },
            },
            executing: {
              invoke: {
                id: "runDestructive",
                src: "runDestructive",
                input: ({ context }) => ({
                  projectId: context.projectId,
                  action: context._pending ?? "reset",
                  services: context.services,
                }),
                onDone: {
                  target: "idle",
                  actions: [
                    {
                      type: "applyDestructiveResult",
                      params: ({
                        event,
                      }: {
                        event: {
                          output: { ok: boolean; message?: string };
                        };
                      }) => ({ result: event.output }),
                    },
                    "clearPending",
                  ],
                },
                onError: {
                  target: "idle",
                  actions: [
                    {
                      type: "assignError",
                      params: ({ event }: { event: { error: unknown } }) => ({
                        error: event.error,
                      }),
                    },
                    "clearPending",
                  ],
                },
              },
            },
          },
        },
      },
    },
  },
});
