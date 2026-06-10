/**
 * projectDetail — XState v5 machine orchestrating the Projects page.
 *
 * Ported from `statecharts/project-detail.yaml`.
 *
 * Owns: project selection, the detail tab strip (activity/attributes/manage),
 * and the lifecycle of child machines (railList, recentActivity,
 * attributesPanel, manageActions) keyed to the selected project.
 *
 * Selection is the hinge: changing it re-keys all project-scoped children.
 * The machine models this as a parallel region (selection ‖ tab) so the two
 * are independent but both react to PROJECT_SELECTED / SELECT.
 *
 * DIVERGENCE F3-4: The YAML shows `ctx.children.rail/activity/attributes/manage`
 * as actor refs. In XState v5 we do not spawn child actors from the machine
 * state — spawning in context can cause issues with shallow serialization.
 * Instead we use the `spawnChild` approach via `setup({ actions })` or, more
 * idiomatically for this use case, delegate child re-keying to the React
 * component layer via the `onRespawn*` callbacks. The machine tracks state and
 * signals the component; the component owns the actor lifecycle.
 * See DIVERGENCES.md F3-4.
 *
 * @see docs/plans/design_handoff_pgdp_app/statecharts/project-detail.yaml
 * @see src/machines/DIVERGENCES.md
 */

import { setup, assign, fromPromise } from "xstate";
import type {
  ProjectRecord,
  ManageAction,
  ManageActionResult,
} from "@/mocks/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DetailTab = "activity" | "attributes" | "manage";

export interface ProjectDetailServices {
  /** GET /api/projects → ProjectRecord[] */
  fetchProjects(): Promise<ProjectRecord[]>;
}

export interface ProjectDetailInput {
  /** ID of the project to select initially (e.g. from URL param). */
  initialSelectedId?: string | null;
  services: ProjectDetailServices;
  /** Callbacks for side effects (router navigation, child re-spawn). */
  onOpenProject?: (projectId: string) => void;
  onOpenActivityLog?: (projectId: string) => void;
  onRespawnActivity?: (projectId: string) => void;
  onRespawnAttributes?: (projectId: string) => void;
  onRespawnManage?: (projectId: string, isArchived: boolean) => void;
  onStopChildren?: () => void;
  onRefreshRail?: () => void;
  onStartCreateFlow?: () => void;
  onStartPasteUrlFlow?: () => void;
  onStartImportFlow?: () => void;
}

export interface ProjectDetailContext {
  selectedId: string | null;
  selected: ProjectRecord | null;
  projects: ProjectRecord[];
  tab: DetailTab;
  emptyState: boolean;
  services: ProjectDetailServices;
  onOpenProject: ((projectId: string) => void) | undefined;
  onOpenActivityLog: ((projectId: string) => void) | undefined;
  onRespawnActivity: ((projectId: string) => void) | undefined;
  onRespawnAttributes: ((projectId: string) => void) | undefined;
  onRespawnManage:
    | ((projectId: string, isArchived: boolean) => void)
    | undefined;
  onStopChildren: (() => void) | undefined;
  onRefreshRail: (() => void) | undefined;
  onStartCreateFlow: (() => void) | undefined;
  onStartPasteUrlFlow: (() => void) | undefined;
  onStartImportFlow: (() => void) | undefined;
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type ProjectDetailEvent =
  | { type: "SELECT"; id: string }
  | { type: "CLEAR_SELECTION" }
  | { type: "SET_TAB"; tab: DetailTab }
  | { type: "OPEN_PROJECT" }
  | { type: "VIEW_ALL_ACTIVITY" }
  | { type: "PROJECTS_CHANGED" }
  | { type: "CREATE_PROJECT" }
  | { type: "PASTE_SOURCE_URL" }
  | { type: "IMPORT_ARCHIVE" }
  | {
      type: "PROJECT_MUTATED";
      action: ManageAction;
      result: ManageActionResult;
    }
  | { type: "RETRY" };

// ---------------------------------------------------------------------------
// Machine definition
// ---------------------------------------------------------------------------

export const projectDetailMachine = setup({
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  types: {} as {
    context: ProjectDetailContext;
    events: ProjectDetailEvent;
    input: ProjectDetailInput;
  },
  actors: {
    fetchProjects: fromPromise<
      ProjectRecord[],
      { services: ProjectDetailServices }
    >(({ input }) => input.services.fetchProjects()),
  },
  guards: {
    /** YAML: noProjects: event.data.length === 0 */
    noProjects: (_args, params: { data: ProjectRecord[] }) =>
      params.data.length === 0,

    /** YAML: selectionChanged: event.id !== ctx.selectedId */
    selectionChanged: ({ context, event }) => {
      if (event.type !== "SELECT") return false;
      return event.id !== context.selectedId;
    },

    /** YAML: tabIsActivity */
    tabIsActivity: (_args, params: { tab: DetailTab }) =>
      params.tab === "activity",

    /** YAML: tabIsAttributes */
    tabIsAttributes: (_args, params: { tab: DetailTab }) =>
      params.tab === "attributes",

    /** YAML: tabIsManage */
    tabIsManage: (_args, params: { tab: DetailTab }) => params.tab === "manage",
  },
  actions: {
    /** YAML: assignProjects */
    assignProjects: assign(
      (
        _args,
        params: { data: ProjectRecord[] },
      ): Partial<ProjectDetailContext> => ({
        projects: params.data,
        emptyState: false,
      }),
    ),

    /** YAML: markEmpty */
    markEmpty: assign({ emptyState: () => true }),

    /**
     * YAML: resolveInitialSelection — pick from URL param or first active project.
     * We check if an initialSelectedId was set; otherwise pick first active.
     */
    resolveInitialSelection: assign(
      ({ context }): Partial<ProjectDetailContext> => {
        if (context.projects.length === 0) return {};
        // Try the currently stored selectedId (set by assignSelection if present)
        const alreadySelected = context.selectedId
          ? context.projects.find((p) => p.id === context.selectedId)
          : null;
        if (alreadySelected) {
          return { selected: alreadySelected };
        }
        // Fall back to first active project
        const first =
          context.projects.find((p) => !p.archived) ?? context.projects[0];
        if (!first) return {};
        return { selectedId: first.id, selected: first };
      },
    ),

    /**
     * YAML: assignSelection — set selectedId + resolve `selected` + reset tab.
     * Called by railList SELECT events.
     */
    assignSelection: assign({
      selectedId: (_args, params: { id: string; projects: ProjectRecord[] }) =>
        params.id,
      selected: (_args, params: { id: string; projects: ProjectRecord[] }) =>
        params.projects.find((p) => p.id === params.id) ?? null,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      tab: () => "activity" as DetailTab, // reset tab on project switch
    }),

    clearSelection: assign({ selectedId: () => null, selected: () => null }),

    /**
     * YAML: syncRailTabToSelection — if selected is archived → tell rail to show Archived.
     * In XState v5 this is a side-effect signal; the component handles it.
     */
    syncRailTabToSelection: () => {
      // Component-level: sets railList.railTab if selected is archived
    },

    /** YAML: applyMutation — patch ctx.selected/projects from PROJECT_MUTATED event. */
    applyMutation: assign(
      ({ context, event }): Partial<ProjectDetailContext> => {
        if (event.type !== "PROJECT_MUTATED") return {};
        const { action, result } = event;
        // Update the project record in ctx.projects
        const updated = context.projects.map((p) => {
          if (p.id !== context.selectedId) return p;
          if (
            action === "archive" ||
            (action === "delete" && result.status === "archived")
          ) {
            return { ...p, status: "archived" as const, archived: true };
          }
          if (action === "restore" && result.status) {
            return { ...p, status: result.status, archived: false };
          }
          return p;
        });
        const newSelected =
          updated.find((p) => p.id === context.selectedId) ?? null;
        return { projects: updated, selected: newSelected };
      },
    ),

    /** YAML: respawnActivity */
    respawnActivity: ({ context }) => {
      if (context.selectedId) {
        context.onRespawnActivity?.(context.selectedId);
      }
    },

    /** YAML: respawnAttributes */
    respawnAttributes: ({ context }) => {
      if (context.selectedId) {
        context.onRespawnAttributes?.(context.selectedId);
      }
    },

    /** YAML: respawnManage */
    respawnManage: ({ context }) => {
      if (context.selectedId && context.selected) {
        context.onRespawnManage?.(
          context.selectedId,
          context.selected.archived === true,
        );
      }
    },

    /** YAML: stopChildren */
    stopChildren: ({ context }) => {
      context.onStopChildren?.();
    },

    /** YAML: ensureActivityLoaded — send LOAD to children.activity if idle. */
    ensureActivityLoaded: ({ context }) => {
      // Component: send LOAD to the activity child machine if it's in idle.
      if (context.selectedId) {
        context.onRespawnActivity?.(context.selectedId);
      }
    },

    /** YAML: ensureAttributesLoaded */
    ensureAttributesLoaded: ({ context }) => {
      if (context.selectedId) {
        context.onRespawnAttributes?.(context.selectedId);
      }
    },

    /** YAML: refreshRail */
    refreshRail: ({ context }) => {
      context.onRefreshRail?.();
    },

    /** YAML: openActivityLog — SIDE EFFECT: router.push */
    openActivityLog: ({ context }) => {
      if (context.selectedId) {
        context.onOpenActivityLog?.(context.selectedId);
      }
    },

    /** YAML: openProject — SIDE EFFECT: router.push pipeline */
    openProject: ({ context }) => {
      if (context.selectedId) {
        context.onOpenProject?.(context.selectedId);
      }
    },

    startCreateFlow: ({ context }) => {
      context.onStartCreateFlow?.();
    },

    startPasteUrlFlow: ({ context }) => {
      context.onStartPasteUrlFlow?.();
    },

    startImportFlow: ({ context }) => {
      context.onStartImportFlow?.();
    },
  },
}).createMachine({
  id: "projectDetail",
  context: ({ input }) => ({
    selectedId: input.initialSelectedId ?? null,
    selected: null,
    projects: [],
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    tab: "activity" as DetailTab,
    emptyState: false,
    services: input.services,
    onOpenProject: input.onOpenProject,
    onOpenActivityLog: input.onOpenActivityLog,
    onRespawnActivity: input.onRespawnActivity,
    onRespawnAttributes: input.onRespawnAttributes,
    onRespawnManage: input.onRespawnManage,
    onStopChildren: input.onStopChildren,
    onRefreshRail: input.onRefreshRail,
    onStartCreateFlow: input.onStartCreateFlow,
    onStartPasteUrlFlow: input.onStartPasteUrlFlow,
    onStartImportFlow: input.onStartImportFlow,
  }),

  initial: "booting",

  states: {
    /** YAML: booting — spawn the rail and resolve initial selection. */
    booting: {
      invoke: {
        id: "fetchProjects",
        src: "fetchProjects",
        input: ({ context }) => ({ services: context.services }),
        onDone: [
          {
            target: "empty",
            guard: {
              type: "noProjects",
              params: ({ event }: { event: { output: ProjectRecord[] } }) => ({
                data: event.output,
              }),
            },
            actions: [
              {
                type: "assignProjects",
                params: ({
                  event,
                }: {
                  event: { output: ProjectRecord[] };
                }) => ({ data: event.output }),
              },
              "markEmpty",
            ],
          },
          {
            target: "ready",
            actions: [
              {
                type: "assignProjects",
                params: ({
                  event,
                }: {
                  event: { output: ProjectRecord[] };
                }) => ({ data: event.output }),
              },
              "resolveInitialSelection",
            ],
          },
        ],
        onError: {
          target: "loadError",
        },
      },
      on: {
        // railList reports a default/auto selection during boot
        SELECT: {
          actions: [
            {
              type: "assignSelection",
              params: ({
                event,
                context,
              }: {
                event: Extract<ProjectDetailEvent, { type: "SELECT" }>;
                context: ProjectDetailContext;
              }) => ({ id: event.id, projects: context.projects }),
            },
          ],
        },
      },
    },

    loadError: {
      on: {
        RETRY: { target: "booting" },
      },
    },

    /** YAML: empty — no projects exist. Render the empty hero. */
    empty: {
      on: {
        CREATE_PROJECT: { actions: ["startCreateFlow"] },
        PASTE_SOURCE_URL: { actions: ["startPasteUrlFlow"] },
        IMPORT_ARCHIVE: { actions: ["startImportFlow"] },
        PROJECTS_CHANGED: { target: "booting" },
      },
    },

    /**
     * YAML: ready — rail + detail pane. Two independent parallel regions.
     */
    ready: {
      type: "parallel",
      on: {
        OPEN_PROJECT: { actions: ["openProject"] },
        PROJECTS_CHANGED: { target: "booting" },
      },
      states: {
        /**
         * YAML: Region A: selection
         */
        selection: {
          initial: "hasSelection",
          states: {
            hasSelection: {
              on: {
                SELECT: {
                  guard: "selectionChanged",
                  actions: [
                    {
                      type: "assignSelection",
                      params: ({
                        event,
                        context,
                      }: {
                        event: Extract<ProjectDetailEvent, { type: "SELECT" }>;
                        context: ProjectDetailContext;
                      }) => ({ id: event.id, projects: context.projects }),
                    },
                    "syncRailTabToSelection",
                    "respawnActivity",
                    "respawnAttributes",
                    "respawnManage",
                  ],
                },
                CLEAR_SELECTION: {
                  target: "noSelection",
                  actions: ["clearSelection", "stopChildren"],
                },
              },
            },

            noSelection: {
              on: {
                SELECT: {
                  target: "hasSelection",
                  actions: [
                    {
                      type: "assignSelection",
                      params: ({
                        event,
                        context,
                      }: {
                        event: Extract<ProjectDetailEvent, { type: "SELECT" }>;
                        context: ProjectDetailContext;
                      }) => ({ id: event.id, projects: context.projects }),
                    },
                    "respawnActivity",
                    "respawnAttributes",
                    "respawnManage",
                  ],
                },
              },
            },
          },
        },

        /**
         * YAML: Region B: detail tab strip
         */
        tab: {
          initial: "activity",
          states: {
            activity: {
              entry: ["ensureActivityLoaded"],
              on: {
                SET_TAB: [
                  {
                    target: "attributes",
                    guard: {
                      type: "tabIsAttributes",
                      params: ({
                        event,
                      }: {
                        event: Extract<ProjectDetailEvent, { type: "SET_TAB" }>;
                      }) => ({ tab: event.tab }),
                    },
                  },
                  {
                    target: "manage",
                    guard: {
                      type: "tabIsManage",
                      params: ({
                        event,
                      }: {
                        event: Extract<ProjectDetailEvent, { type: "SET_TAB" }>;
                      }) => ({ tab: event.tab }),
                    },
                  },
                ],
                VIEW_ALL_ACTIVITY: { actions: ["openActivityLog"] },
              },
            },

            attributes: {
              entry: ["ensureAttributesLoaded"],
              on: {
                SET_TAB: [
                  {
                    target: "activity",
                    guard: {
                      type: "tabIsActivity",
                      params: ({
                        event,
                      }: {
                        event: Extract<ProjectDetailEvent, { type: "SET_TAB" }>;
                      }) => ({ tab: event.tab }),
                    },
                  },
                  {
                    target: "manage",
                    guard: {
                      type: "tabIsManage",
                      params: ({
                        event,
                      }: {
                        event: Extract<ProjectDetailEvent, { type: "SET_TAB" }>;
                      }) => ({ tab: event.tab }),
                    },
                  },
                ],
              },
            },

            manage: {
              on: {
                SET_TAB: [
                  {
                    target: "activity",
                    guard: {
                      type: "tabIsActivity",
                      params: ({
                        event,
                      }: {
                        event: Extract<ProjectDetailEvent, { type: "SET_TAB" }>;
                      }) => ({ tab: event.tab }),
                    },
                  },
                  {
                    target: "attributes",
                    guard: {
                      type: "tabIsAttributes",
                      params: ({
                        event,
                      }: {
                        event: Extract<ProjectDetailEvent, { type: "SET_TAB" }>;
                      }) => ({ tab: event.tab }),
                    },
                  },
                ],
                PROJECT_MUTATED: {
                  actions: ["applyMutation", "refreshRail"],
                },
              },
            },
          },
        },
      },
    },
  },
});
