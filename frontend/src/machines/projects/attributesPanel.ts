/**
 * attributesPanel — XState v5 machine for the Attributes tab.
 *
 * Ported from `statecharts/attributes-panel.yaml`.
 *
 * Two parallel concerns:
 *   1. collapse — per-section open/closed (independent)
 *   2. editing  — exclusive inline-edit (one section at a time)
 *
 * @see docs/plans/design_handoff_pgdp_app/statecharts/attributes-panel.yaml
 * @see src/machines/DIVERGENCES.md
 */

import { setup, assign, fromPromise } from "xstate";
import type { AttributeRecord, AttributeSection } from "@/mocks/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { AttributeSection };

export interface AttributesPanelServices {
  /** GET /api/projects/:id/attributes → AttributeRecord */
  fetchAttributes(projectId: string): Promise<AttributeRecord>;
  /** PATCH /api/projects/:id/attributes/:section → AttributeRecord */
  saveAttributes(
    projectId: string,
    section: AttributeSection,
    draft: Record<string, string>,
  ): Promise<AttributeRecord>;
}

export interface AttributesPanelInput {
  projectId: string;
  services: AttributesPanelServices;
}

export interface AttributesPanelContext {
  projectId: string;
  fields: AttributeRecord | null;
  open: {
    bib: boolean;
    pgdp: boolean;
    fmt: boolean;
    comments: boolean;
  };
  editingSection: AttributeSection | null;
  draft: Record<string, string> | null;
  errors: Record<string, string>;
  error: string | null;
  services: AttributesPanelServices;
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type AttributesPanelEvent =
  | { type: "TOGGLE_BIB" }
  | { type: "TOGGLE_PGDP" }
  | { type: "TOGGLE_FMT" }
  | { type: "TOGGLE_COMMENTS" }
  | { type: "EDIT"; section: AttributeSection }
  | { type: "CHANGE"; field: string; value: string }
  | { type: "SAVE" }
  | { type: "CANCEL" }
  | { type: "DISCARD" }
  | { type: "KEEP" }
  | { type: "RETRY" };

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function getSectionFields(
  fields: AttributeRecord,
  section: AttributeSection,
): Record<string, string> {
  if (section === "comments") {
    return { text: fields.comments };
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return { ...(fields[section] as Record<string, string>) };
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// Machine definition
// ---------------------------------------------------------------------------

export const attributesPanelMachine = setup({
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  types: {} as {
    context: AttributesPanelContext;
    events: AttributesPanelEvent;
    input: AttributesPanelInput;
  },
  actors: {
    fetchAttributes: fromPromise<
      AttributeRecord,
      { projectId: string; services: AttributesPanelServices }
    >(({ input }) => input.services.fetchAttributes(input.projectId)),

    saveAttributes: fromPromise<
      AttributeRecord,
      {
        projectId: string;
        section: AttributeSection;
        draft: Record<string, string>;
        services: AttributesPanelServices;
      }
    >(({ input }) =>
      input.services.saveAttributes(
        input.projectId,
        input.section,
        input.draft,
      ),
    ),
  },
  guards: {
    /**
     * YAML: isDirty: ctx.draft != null && !deepEqual(ctx.draft, sectionOf(ctx.fields, ctx.editingSection))
     *
     * DIVERGENCE F3-2: The YAML uses an inline expression referencing ctx.fields.
     * In XState v5 guards receive context directly — we compute the comparison
     * here rather than calling a named helper function in the YAML.
     * See DIVERGENCES.md F3-2.
     */
    isDirty: ({ context }) => {
      if (!context.draft || !context.fields || !context.editingSection)
        return false;
      const original = getSectionFields(context.fields, context.editingSection);
      return !deepEqual(context.draft, original);
    },

    /** YAML: isValid: Object.keys(ctx.errors).length === 0 */
    isValid: ({ context }) => Object.keys(context.errors).length === 0,
  },
  actions: {
    assignFields: assign({
      fields: (_args, params: { output: AttributeRecord }) => params.output,
    }),

    assignError: assign({
      error: (_args, params: { error: unknown }) => {
        if (params.error instanceof Error) return params.error.message;
        return "Failed to load attributes";
      },
    }),

    clearError: assign({ error: () => null }),

    /**
     * YAML: syncOpen — mirror the active state back into ctx.open.
     * XState v5: we toggle the boolean directly.
     */
    syncOpen: assign({
      open: ({ context, event }): AttributesPanelContext["open"] => {
        const o = { ...context.open };
        switch (event.type) {
          case "TOGGLE_BIB":
            return { ...o, bib: !o.bib };
          case "TOGGLE_PGDP":
            return { ...o, pgdp: !o.pgdp };
          case "TOGGLE_FMT":
            return { ...o, fmt: !o.fmt };
          case "TOGGLE_COMMENTS":
            return { ...o, comments: !o.comments };
          default:
            return o;
        }
      },
    }),

    /**
     * YAML: ensureSectionOpen — force ctx.open[editingSection] = true.
     * Called on EDIT to auto-expand the section being edited.
     */
    ensureSectionOpen: assign({
      open: ({ context }): AttributesPanelContext["open"] => {
        if (!context.editingSection) return context.open;
        return { ...context.open, [context.editingSection]: true };
      },
    }),

    /**
     * YAML: beginEdit — set editingSection + clone draft + clear errors.
     */
    beginEdit: assign(
      (
        { context },
        params: { section: AttributeSection },
      ): Partial<AttributesPanelContext> => {
        if (!context.fields) return {};
        return {
          editingSection: params.section,
          draft: getSectionFields(context.fields, params.section),
          errors: {},
        };
      },
    ),

    /** YAML: updateDraft */
    updateDraft: assign({
      draft: (
        { context },
        params: { field: string; value: string },
      ): Record<string, string> | null => {
        if (!context.draft) return context.draft;
        return { ...context.draft, [params.field]: params.value };
      },
    }),

    /**
     * YAML: validateField — populate/clear ctx.errors[field].
     * Mock: no validations fail. Real implementation extends this.
     */
    validateField: assign({
      errors: ({ context }) => ({ ...context.errors }),
    }),

    clearDraft: assign({
      editingSection: () => null,
      draft: () => null,
      errors: () => ({}),
    }),

    /**
     * YAML: commitDraft — merge saved section back into ctx.fields.
     * The onDone result (updated AttributeRecord) is the authority.
     */
    commitDraft: assign(
      (
        _args,
        params: { output: AttributeRecord },
      ): Partial<AttributesPanelContext> => ({
        fields: params.output,
        editingSection: null,
        draft: null,
        errors: {},
      }),
    ),

    assignSaveError: assign({
      error: (_args, params: { error: unknown }) => {
        if (params.error instanceof Error) return params.error.message;
        return "Save failed";
      },
    }),
  },
}).createMachine({
  id: "attributesPanel",
  context: ({ input }) => ({
    projectId: input.projectId,
    fields: null,
    open: { bib: true, pgdp: true, fmt: true, comments: true },
    editingSection: null,
    draft: null,
    errors: {},
    error: null,
    services: input.services,
  }),

  initial: "loading",

  states: {
    /** YAML: loading */
    loading: {
      invoke: {
        id: "fetchAttributes",
        src: "fetchAttributes",
        input: ({ context }) => ({
          projectId: context.projectId,
          services: context.services,
        }),
        onDone: {
          target: "viewing",
          actions: [
            {
              type: "assignFields",
              params: ({ event }: { event: { output: AttributeRecord } }) => ({
                output: event.output,
              }),
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

    /** YAML: loadError */
    loadError: {
      on: {
        RETRY: { target: "loading", actions: ["clearError"] },
      },
    },

    /**
     * YAML: viewing — parallel regions: collapse + editing.
     */
    viewing: {
      type: "parallel",
      states: {
        /**
         * YAML: Region A: collapse — four independent section binary regions.
         *
         * DIVERGENCE F3-3: The YAML models each section as its own binary parallel
         * region (bib.open/closed, pgdp.open/closed, fmt.open/closed, comments.open/closed).
         * In XState v5, four independent parallel machines would create excessive
         * snapshot complexity with no guard benefit. We consolidate into a single
         * `collapse` state with `syncOpen` action that toggling `ctx.open[key]`.
         * Behavior is identical; the TOGGLE_* events are preserved.
         * See DIVERGENCES.md F3-3.
         */
        collapse: {
          initial: "tracking",
          states: {
            tracking: {
              on: {
                TOGGLE_BIB: { actions: ["syncOpen"] },
                TOGGLE_PGDP: { actions: ["syncOpen"] },
                TOGGLE_FMT: { actions: ["syncOpen"] },
                TOGGLE_COMMENTS: { actions: ["syncOpen"] },
              },
            },
          },
        },

        /**
         * YAML: Region B: editing — exclusive inline-edit flow.
         */
        editing: {
          initial: "idle",
          states: {
            idle: {
              on: {
                EDIT: {
                  target: "active",
                  actions: [
                    {
                      type: "beginEdit",
                      params: ({
                        event,
                      }: {
                        event: Extract<AttributesPanelEvent, { type: "EDIT" }>;
                      }) => ({ section: event.section }),
                    },
                    "ensureSectionOpen",
                  ],
                },
              },
            },

            active: {
              initial: "clean",
              on: {
                CHANGE: {
                  target: ".dirty",
                  actions: [
                    {
                      type: "updateDraft",
                      params: ({
                        event,
                      }: {
                        event: Extract<
                          AttributesPanelEvent,
                          { type: "CHANGE" }
                        >;
                      }) => ({
                        field: event.field,
                        value: event.value,
                      }),
                    },
                    "validateField",
                  ],
                },
                CANCEL: [
                  {
                    target: "#attributesPanel.viewing.editing.confirmDiscard",
                    guard: "isDirty",
                  },
                  {
                    target: "idle",
                    actions: ["clearDraft"],
                  },
                ],
              },
              states: {
                clean: {},
                dirty: {
                  on: {
                    SAVE: {
                      target: "#attributesPanel.viewing.editing.saving",
                      guard: "isValid",
                    },
                  },
                },
              },
            },

            saving: {
              invoke: {
                id: "saveAttributes",
                src: "saveAttributes",
                input: ({ context }) => ({
                  projectId: context.projectId,
                  section: context.editingSection!,
                  draft: context.draft!,
                  services: context.services,
                }),
                onDone: {
                  target: "idle",
                  actions: [
                    {
                      type: "commitDraft",
                      params: ({
                        event,
                      }: {
                        event: { output: AttributeRecord };
                      }) => ({ output: event.output }),
                    },
                  ],
                },
                onError: {
                  target: "active",
                  actions: [
                    {
                      type: "assignSaveError",
                      params: ({ event }: { event: { error: unknown } }) => ({
                        error: event.error,
                      }),
                    },
                  ],
                },
              },
            },

            confirmDiscard: {
              on: {
                DISCARD: { target: "idle", actions: ["clearDraft"] },
                KEEP: { target: "active" },
              },
            },
          },
        },
      },
    },
  },
});
