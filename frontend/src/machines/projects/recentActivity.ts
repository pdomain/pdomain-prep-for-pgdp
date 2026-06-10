/**
 * recentActivity — XState v5 machine for the Recent activity tab feed.
 *
 * Ported from `statecharts/recent-activity.yaml`.
 *
 * Keyed to the selected project. When the parent (projectDetail) changes
 * selection it should send PROJECT_CHANGED so the feed reloads.
 *
 * @see docs/plans/design_handoff_pgdp_app/statecharts/recent-activity.yaml
 * @see src/machines/DIVERGENCES.md
 */

import { setup, assign, fromPromise, raise } from "xstate";
import type { ActivityFeedResponse, ActivityEntry } from "@/mocks/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecentActivityServices {
  /**
   * GET /api/projects/:id/activity?limit=:limit
   * → { entries, totalCount, commentCount, stageCount }
   */
  fetchRecentActivity(
    projectId: string,
    limit: number,
  ): Promise<ActivityFeedResponse>;
}

export interface RecentActivityInput {
  projectId: string | null;
  services: RecentActivityServices;
  /** Called when user clicks "View all activity". */
  onViewAll?: (projectId: string) => void;
  /** Called when user clicks an activity entry. */
  onEntryClick?: (entry: ActivityEntry) => void;
}

export interface RecentActivityContext {
  projectId: string | null;
  limit: number;
  entries: ActivityEntry[];
  totalCount: number;
  commentCount: number;
  stageCount: number;
  error: string | null;
  lastFetchedAt: string | null;
  isLive: boolean;
  services: RecentActivityServices;
  onViewAll: ((projectId: string) => void) | undefined;
  onEntryClick: ((entry: ActivityEntry) => void) | undefined;
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type RecentActivityEvent =
  | { type: "LOAD"; projectId?: string }
  | { type: "CANCEL" }
  | { type: "REFRESH" }
  | { type: "PROJECT_CHANGED"; projectId: string }
  | { type: "VIEW_ALL" }
  | { type: "ENTRY_CLICK"; entry: ActivityEntry }
  | { type: "SET_LIVE"; isLive: boolean }
  | { type: "TICK" }
  | { type: "RETRY" };

// ---------------------------------------------------------------------------
// Machine definition
// ---------------------------------------------------------------------------

export const recentActivityMachine = setup({
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  types: {} as {
    context: RecentActivityContext;
    events: RecentActivityEvent;
    input: RecentActivityInput;
  },
  actors: {
    fetchRecentActivity: fromPromise<
      ActivityFeedResponse,
      {
        projectId: string;
        limit: number;
        services: RecentActivityServices;
      }
    >(({ input }) =>
      input.services.fetchRecentActivity(input.projectId, input.limit),
    ),
  },
  guards: {
    /** YAML: hasProjectId */
    hasProjectId: ({ context, event }) => {
      if (event.type === "LOAD" && event.projectId) return true;
      return context.projectId !== null;
    },

    /** YAML: resultIsEmpty: event.data.entries.length === 0 */
    resultIsEmpty: (_args, params: { output: ActivityFeedResponse }) =>
      params.output.entries.length === 0,

    /** YAML: isLive */
    isLive: ({ context }) => context.isLive,
  },
  actions: {
    /** YAML: assignProjectId */
    assignProjectId: assign({
      projectId: (
        _args,
        params: { projectId: string | undefined; ctxProjectId: string | null },
      ) => params.projectId ?? params.ctxProjectId,
    }),

    /** YAML: assignFeed */
    assignFeed: assign(
      (
        _args,
        params: { output: ActivityFeedResponse },
      ): Partial<RecentActivityContext> => ({
        entries: params.output.entries,
        totalCount: params.output.totalCount,
        commentCount: params.output.commentCount,
        stageCount: params.output.stageCount,
        lastFetchedAt: new Date().toISOString(),
      }),
    ),

    assignError: assign({
      error: (_args, params: { error: unknown }) => {
        if (params.error instanceof Error) return params.error.message;
        return "Failed to load activity";
      },
    }),

    clearError: assign({ error: () => null }),

    resetFeed: assign({
      entries: () => [],
      totalCount: () => 0,
      error: () => null,
    }),

    assignIsLive: assign({
      isLive: (_args, params: { isLive: boolean }) => params.isLive,
    }),

    /** YAML: flagStaleRefresh */
    flagStaleRefresh: assign({
      error: (_args, params: { error: unknown }) => {
        if (params.error instanceof Error) return params.error.message;
        return "Refresh failed";
      },
    }),

    /**
     * YAML: raiseRefresh — send REFRESH to self.
     * XState v5: use `raise` action.
     */
    raiseRefresh: raise({ type: "REFRESH" as const }),

    /** YAML: navigateToActivityLog — SIDE EFFECT, wired via callback. */
    navigateToActivityLog: ({ context }) => {
      if (context.projectId) {
        context.onViewAll?.(context.projectId);
      }
    },

    /** YAML: openEntryDetail — SIDE EFFECT, wired via callback. */
    openEntryDetail: ({ context }, params: { entry: ActivityEntry }) => {
      context.onEntryClick?.(params.entry);
    },

    /** YAML: startPollTimer — in XState v5, handled by `after` in active state. */
    startPollTimer: () => {
      // Handled by after: 10000 in loaded.polling.active
    },

    stopPollTimer: () => {
      // Handled by exit from active state
    },
  },
}).createMachine({
  id: "recentActivity",
  context: ({ input }) => ({
    projectId: input.projectId,
    limit: 3,
    entries: [],
    totalCount: 0,
    commentCount: 0,
    stageCount: 0,
    error: null,
    lastFetchedAt: null,
    isLive: false,
    services: input.services,
    onViewAll: input.onViewAll,
    onEntryClick: input.onEntryClick,
  }),

  initial: "idle",

  states: {
    /** YAML: idle — no project selected, or feed not yet requested. */
    idle: {
      on: {
        LOAD: {
          target: "loading",
          guard: "hasProjectId",
          actions: [
            {
              type: "assignProjectId",
              params: ({
                event,
                context,
              }: {
                event: Extract<RecentActivityEvent, { type: "LOAD" }>;
                context: RecentActivityContext;
              }) => ({
                projectId: event.projectId,
                ctxProjectId: context.projectId,
              }),
            },
          ],
        },
      },
    },

    /** YAML: loading — initial fetch, show skeleton rows. */
    loading: {
      invoke: {
        id: "fetchRecentActivity",
        src: "fetchRecentActivity",
        input: ({ context }) => ({
          projectId: context.projectId!,
          limit: context.limit,
          services: context.services,
        }),
        onDone: [
          {
            target: "loaded",
            // State paths use parallel "loaded.data.empty" or "loaded.data.list"
            // XState v5: target the parent state; initial sub-state is derived from guards in entry
            guard: {
              type: "resultIsEmpty",
              params: ({
                event,
              }: {
                event: { output: ActivityFeedResponse };
              }) => ({ output: event.output }),
            },
            actions: [
              {
                type: "assignFeed",
                params: ({
                  event,
                }: {
                  event: { output: ActivityFeedResponse };
                }) => ({ output: event.output }),
              },
              "clearError",
            ],
          },
          {
            target: "loaded",
            actions: [
              {
                type: "assignFeed",
                params: ({
                  event,
                }: {
                  event: { output: ActivityFeedResponse };
                }) => ({ output: event.output }),
              },
              "clearError",
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
      on: {
        CANCEL: { target: "idle" },
      },
    },

    /**
     * YAML: loaded — parallel regions: data (list|empty|refreshing) + polling (deciding|active|paused).
     */
    loaded: {
      type: "parallel",
      on: {
        PROJECT_CHANGED: {
          target: "loading",
          actions: [
            {
              type: "assignProjectId",
              params: ({
                event,
                context,
              }: {
                event: Extract<
                  RecentActivityEvent,
                  { type: "PROJECT_CHANGED" }
                >;
                context: RecentActivityContext;
              }) => ({
                projectId: event.projectId,
                ctxProjectId: context.projectId,
              }),
            },
            "resetFeed",
          ],
        },
        REFRESH: {
          target: ".data.refreshing",
        },
      },
      states: {
        /** YAML: Region A: the data itself */
        data: {
          initial: "list",
          states: {
            list: {
              on: {
                VIEW_ALL: { actions: ["navigateToActivityLog"] },
                ENTRY_CLICK: {
                  actions: [
                    {
                      type: "openEntryDetail",
                      params: ({
                        event,
                      }: {
                        event: Extract<
                          RecentActivityEvent,
                          { type: "ENTRY_CLICK" }
                        >;
                      }) => ({ entry: event.entry }),
                    },
                  ],
                },
              },
            },
            empty: {
              on: {
                VIEW_ALL: { actions: ["navigateToActivityLog"] },
              },
            },
            /** YAML: refreshing — silent background re-fetch, does NOT blank the list. */
            refreshing: {
              invoke: {
                id: "refreshActivity",
                src: "fetchRecentActivity",
                input: ({ context }) => ({
                  projectId: context.projectId!,
                  limit: context.limit,
                  services: context.services,
                }),
                onDone: [
                  {
                    target: "empty",
                    guard: {
                      type: "resultIsEmpty",
                      params: ({
                        event,
                      }: {
                        event: { output: ActivityFeedResponse };
                      }) => ({ output: event.output }),
                    },
                    actions: [
                      {
                        type: "assignFeed",
                        params: ({
                          event,
                        }: {
                          event: { output: ActivityFeedResponse };
                        }) => ({ output: event.output }),
                      },
                    ],
                  },
                  {
                    target: "list",
                    actions: [
                      {
                        type: "assignFeed",
                        params: ({
                          event,
                        }: {
                          event: { output: ActivityFeedResponse };
                        }) => ({ output: event.output }),
                      },
                      "clearError",
                    ],
                  },
                ],
                onError: {
                  target: "list",
                  actions: [
                    {
                      type: "flagStaleRefresh",
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
         * YAML: Region B: live polling cadence.
         * active: poll every 10s; paused: no polling.
         *
         * DIVERGENCE F3-1: YAML uses `startPollTimer`/`stopPollTimer` side-effect
         * actions. In XState v5 we use `after: 10000` in the `active` state
         * which auto-cancels on exit. The TICK event + raiseRefresh pattern from
         * the YAML is replaced by the `after` timer sending REFRESH directly.
         * See DIVERGENCES.md F3-1.
         */
        polling: {
          initial: "deciding",
          states: {
            deciding: {
              always: [
                { target: "active", guard: "isLive" },
                { target: "paused" },
              ],
            },
            active: {
              after: {
                10000: {
                  target: "deciding",
                  actions: ["raiseRefresh"],
                },
              },
              on: {
                SET_LIVE: {
                  target: "deciding",
                  actions: [
                    {
                      type: "assignIsLive",
                      params: ({
                        event,
                      }: {
                        event: Extract<
                          RecentActivityEvent,
                          { type: "SET_LIVE" }
                        >;
                      }) => ({ isLive: event.isLive }),
                    },
                  ],
                },
                TICK: { actions: ["raiseRefresh"] },
              },
            },
            paused: {
              on: {
                SET_LIVE: {
                  target: "deciding",
                  actions: [
                    {
                      type: "assignIsLive",
                      params: ({
                        event,
                      }: {
                        event: Extract<
                          RecentActivityEvent,
                          { type: "SET_LIVE" }
                        >;
                      }) => ({ isLive: event.isLive }),
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },

    /** YAML: error — initial load failed, no stale data. */
    error: {
      on: {
        RETRY: {
          target: "loading",
          actions: ["clearError"],
        },
        PROJECT_CHANGED: {
          target: "loading",
          actions: [
            {
              type: "assignProjectId",
              params: ({
                event,
                context,
              }: {
                event: Extract<
                  RecentActivityEvent,
                  { type: "PROJECT_CHANGED" }
                >;
                context: RecentActivityContext;
              }) => ({
                projectId: event.projectId,
                ctxProjectId: context.projectId,
              }),
            },
            "resetFeed",
          ],
        },
      },
    },
  },
});
