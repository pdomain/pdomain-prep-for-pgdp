/**
 * railList — XState v5 machine for the 320px project rail.
 *
 * Ported from `statecharts/rail-list.yaml`.
 *
 * Owns: Active/Archived filter, freeform search, sort order, row selection.
 * Re-derives `visible` whenever any input changes.
 * Emits SELECT events upward to projectDetail (via `sendParent`-style callback).
 *
 * @see docs/plans/design_handoff_pgdp_app/statecharts/rail-list.yaml
 * @see docs/plans/design_handoff_pgdp_app/final/projects/projects.jsx
 * @see src/machines/DIVERGENCES.md
 */

import { setup, assign, fromPromise } from "xstate";
import type { ProjectRecord } from "@/mocks/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RailTab = "active" | "archived";
export type SortKey = "recent" | "title" | "pages" | "size";

export interface RailListServices {
  /** GET /api/projects → ProjectRecord[] */
  fetchProjects(): Promise<ProjectRecord[]>;
}

export interface RailListInput {
  services: RailListServices;
  /** Callback invoked when selection changes — parent wires this to its machine. */
  onSelect?: (id: string) => void;
}

export interface RailListContext {
  all: ProjectRecord[];
  visible: ProjectRecord[];
  railTab: RailTab;
  query: string;
  sort: SortKey;
  statusFilter: string; // 'all' | lifecycle status
  selectedId: string | null;
  counts: { active: number; archived: number };
  error: string | null;
  services: RailListServices;
  onSelect: ((id: string) => void) | undefined;
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type RailListEvent =
  | { type: "SET_RAIL_TAB"; tab: RailTab }
  | { type: "SET_SORT"; sort: SortKey }
  | { type: "SET_STATUS_FILTER"; value: string }
  | { type: "SELECT"; id: string }
  | { type: "SEARCH_INPUT"; value: string }
  | { type: "CLEAR_SEARCH" }
  | { type: "NEW_PROJECT" }
  | { type: "PROJECTS_CHANGED" }
  | { type: "RETRY" };

// ---------------------------------------------------------------------------
// Pure helpers (no side effects)
// ---------------------------------------------------------------------------

function matchesQuery(p: ProjectRecord, q: string): boolean {
  if (!q) return true;
  const lq = q.toLowerCase();
  return (
    p.title.toLowerCase().includes(lq) ||
    p.author.toLowerCase().includes(lq) ||
    p.id.toLowerCase().includes(lq)
  );
}

function sortProjects(
  projects: ProjectRecord[],
  sort: SortKey,
): ProjectRecord[] {
  const arr = [...projects];
  switch (sort) {
    case "title":
      return arr.sort((a, b) => a.title.localeCompare(b.title));
    case "pages":
      return arr.sort((a, b) => b.pages - a.pages);
    case "size":
      // Size is a string like "28.4 MB" — parse numerically
      return arr.sort((a, b) => {
        const numA = parseFloat(a.size) || 0;
        const numB = parseFloat(b.size) || 0;
        return numB - numA;
      });
    case "recent":
    default:
      // Keep original order (newest first from API)
      return arr;
  }
}

function deriveVisible(
  all: ProjectRecord[],
  railTab: RailTab,
  statusFilter: string,
  query: string,
  sort: SortKey,
): ProjectRecord[] {
  return sortProjects(
    all
      .filter((p) =>
        railTab === "archived" ? p.archived === true : !p.archived,
      )
      .filter((p) => statusFilter === "all" || p.status === statusFilter)
      .filter((p) => matchesQuery(p, query)),
    sort,
  );
}

function deriveCounts(all: ProjectRecord[]): {
  active: number;
  archived: number;
} {
  return {
    active: all.filter((p) => !p.archived).length,
    archived: all.filter((p) => p.archived === true).length,
  };
}

// ---------------------------------------------------------------------------
// Machine definition
// ---------------------------------------------------------------------------

export const railListMachine = setup({
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  types: {} as {
    context: RailListContext;
    events: RailListEvent;
    input: RailListInput;
  },
  actors: {
    fetchProjects: fromPromise<ProjectRecord[], { services: RailListServices }>(
      ({ input }) => input.services.fetchProjects(),
    ),
  },
  guards: {
    /** YAML: tabChanged: event.tab !== ctx.railTab */
    tabChanged: ({ context, event }) => {
      if (event.type !== "SET_RAIL_TAB") return false;
      return event.tab !== context.railTab;
    },

    /** YAML: rowExists: ctx.visible.some(p => p.id === event.id) */
    rowExists: ({ context, event }) => {
      if (event.type !== "SELECT") return false;
      return context.visible.some((p) => p.id === event.id);
    },

    /**
     * YAML: selectionHidden — the selected row is no longer in visible.
     * Used after filter/tab change.
     */
    selectionHidden: ({ context }) =>
      context.selectedId === null ||
      !context.visible.some((p) => p.id === context.selectedId),
  },
  actions: {
    /** YAML: assignAll + recomputeCounts + applyView + autoSelectFirst */
    assignAll: assign({
      all: (_args, params: { data: ProjectRecord[] }) => params.data,
      counts: (_args, params: { data: ProjectRecord[] }) =>
        deriveCounts(params.data),
    }),

    recomputeCounts: assign({
      counts: ({ context }) => deriveCounts(context.all),
    }),

    applyView: assign({
      visible: ({ context }) =>
        deriveVisible(
          context.all,
          context.railTab,
          context.statusFilter,
          context.query,
          context.sort,
        ),
    }),

    autoSelectFirst: assign(({ context }) => {
      if (context.selectedId !== null) return {};
      const first = context.visible[0];
      if (!first) return {};
      // Emit selection to parent callback
      context.onSelect?.(first.id);
      return { selectedId: first.id };
    }),

    /** YAML: assignRailTab */
    assignRailTab: assign({
      railTab: (_args, params: { tab: RailTab }) => params.tab,
    }),

    /** YAML: assignSort */
    assignSort: assign({
      sort: (_args, params: { sort: SortKey }) => params.sort,
    }),

    /** YAML: assignStatusFilter */
    assignStatusFilter: assign({
      statusFilter: (_args, params: { value: string }) => params.value,
    }),

    /** YAML: assignQuery */
    assignQuery: assign({
      query: (_args, params: { value: string }) => params.value,
    }),

    /** YAML: clearQuery */
    clearQuery: assign({ query: () => "" }),

    /** YAML: assignSelected */
    assignSelected: assign({
      selectedId: (_args, params: { id: string }) => params.id,
    }),

    /** YAML: assignError */
    assignError: assign({
      error: (_args, params: { error: unknown }) => {
        if (params.error instanceof Error) return params.error.message;
        return "Failed to load projects";
      },
    }),

    /**
     * YAML: selectIfSelectionHidden — if selection scrolled out, pick first
     * visible row and notify parent.
     */
    selectIfSelectionHidden: assign(({ context }) => {
      const hidden =
        context.selectedId === null ||
        !context.visible.some((p) => p.id === context.selectedId);
      if (!hidden) return {};
      const first = context.visible[0];
      if (!first) {
        context.onSelect?.("");
        return { selectedId: null };
      }
      context.onSelect?.(first.id);
      return { selectedId: first.id };
    }),

    /**
     * YAML: emitSelect — send SELECT to parent (projectDetail).
     * In XState v5 we call the injected onSelect callback.
     */
    emitSelect: ({ context, event }) => {
      if (event.type !== "SELECT") return;
      context.onSelect?.(event.id);
    },

    /**
     * YAML: startNewProject — SIDE EFFECT (routed to parent/router).
     * No-op in the machine; component wires the button directly.
     */
    startNewProject: () => {
      // SIDE EFFECT: parent component handles NEW_PROJECT routing
    },
  },
}).createMachine({
  id: "railList",
  context: ({ input }) => ({
    all: [],
    visible: [],
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    railTab: "active" as RailTab,
    query: "",
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    sort: "recent" as SortKey,
    statusFilter: "all",
    selectedId: null,
    counts: { active: 0, archived: 0 },
    error: null,
    services: input.services,
    onSelect: input.onSelect,
  }),

  initial: "loading",

  states: {
    /** YAML: loading — fetch the project set for the rail. */
    loading: {
      invoke: {
        id: "fetchProjects",
        src: "fetchProjects",
        input: ({ context }) => ({ services: context.services }),
        onDone: {
          target: "ready",
          actions: [
            {
              type: "assignAll",
              params: ({ event }: { event: { output: ProjectRecord[] } }) => ({
                data: event.output,
              }),
            },
            "recomputeCounts",
            "applyView",
            "autoSelectFirst",
          ],
        },
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

    /** YAML: error */
    error: {
      on: {
        RETRY: { target: "loading" },
      },
    },

    /**
     * YAML: ready — list rendered. Sub-states: idle (quiescent) | debouncing (search).
     */
    ready: {
      initial: "idle",
      on: {
        SET_RAIL_TAB: {
          guard: "tabChanged",
          actions: [
            {
              type: "assignRailTab",
              params: ({
                event,
              }: {
                event: Extract<RailListEvent, { type: "SET_RAIL_TAB" }>;
              }) => ({ tab: event.tab }),
            },
            "applyView",
            "selectIfSelectionHidden",
          ],
        },
        SET_SORT: {
          actions: [
            {
              type: "assignSort",
              params: ({
                event,
              }: {
                event: Extract<RailListEvent, { type: "SET_SORT" }>;
              }) => ({ sort: event.sort }),
            },
            "applyView",
          ],
        },
        SET_STATUS_FILTER: {
          actions: [
            {
              type: "assignStatusFilter",
              params: ({
                event,
              }: {
                event: Extract<RailListEvent, { type: "SET_STATUS_FILTER" }>;
              }) => ({ value: event.value }),
            },
            "applyView",
          ],
        },
        SELECT: {
          guard: "rowExists",
          actions: [
            {
              type: "assignSelected",
              params: ({
                event,
              }: {
                event: Extract<RailListEvent, { type: "SELECT" }>;
              }) => ({ id: event.id }),
            },
            "emitSelect",
          ],
        },
        NEW_PROJECT: {
          actions: ["startNewProject"],
        },
        PROJECTS_CHANGED: {
          target: "loading",
        },
      },
      states: {
        /** YAML: idle — no active search input. */
        idle: {
          on: {
            SEARCH_INPUT: {
              target: "debouncing",
              actions: [
                {
                  type: "assignQuery",
                  params: ({
                    event,
                  }: {
                    event: Extract<RailListEvent, { type: "SEARCH_INPUT" }>;
                  }) => ({ value: event.value }),
                },
              ],
            },
          },
        },

        /**
         * YAML: debouncing — debounce freeform search, reset timer on each keystroke.
         * after: 200ms → idle + applyView + selectIfSelectionHidden
         */
        debouncing: {
          after: {
            200: {
              target: "idle",
              actions: ["applyView", "selectIfSelectionHidden"],
            },
          },
          on: {
            SEARCH_INPUT: {
              target: "debouncing",
              actions: [
                {
                  type: "assignQuery",
                  params: ({
                    event,
                  }: {
                    event: Extract<RailListEvent, { type: "SEARCH_INPUT" }>;
                  }) => ({ value: event.value }),
                },
              ],
            },
            CLEAR_SEARCH: {
              target: "idle",
              actions: ["clearQuery", "applyView"],
            },
          },
        },
      },
    },
  },
});
