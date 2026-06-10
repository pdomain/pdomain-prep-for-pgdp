/**
 * projectLifecycle — XState v5 machine for the lifecycle status of one project.
 *
 * Ported from `statecharts/project-lifecycle.yaml`.
 *
 * Server-authoritative: the frontend reflects status via STATUS_PUSH and can
 * REQUEST transitions (run, submit, archive). STATUS badge tone and
 * PipelineMini color are DERIVED from the current state — never stored.
 *
 * @see docs/plans/design_handoff_pgdp_app/statecharts/project-lifecycle.yaml
 * @see docs/plans/design_handoff_pgdp_app/final/projects/projects.jsx STATUS
 * @see src/machines/DIVERGENCES.md
 */

import { setup, assign, fromPromise } from "xstate";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProjectStatus =
  | "queued"
  | "running"
  | "review"
  | "ready"
  | "submitted"
  | "error"
  | "archived"
  | "restoring"
  | "deleted";

/** Status → badge-tone mapping (authoritative source: projects.jsx STATUS). */
export const STATUS_TONE: Record<
  Exclude<ProjectStatus, "restoring" | "deleted">,
  string
> = {
  queued: "neutral",
  running: "running",
  review: "review",
  ready: "clean",
  submitted: "neutral",
  error: "failed",
  archived: "neutral",
};

export interface ProjectLifecycleServices {
  /** POST /api/projects/:id/restore → { status, currentStage, flagged } */
  restoreProject(projectId: string): Promise<{
    status: ProjectStatus;
    currentStage: number;
    flagged: number;
  }>;
  /** POST /api/projects/:id/run (optimistic) */
  requestRun(projectId: string): Promise<void>;
  /** POST /api/projects/:id/pause (optimistic) */
  requestPause(projectId: string): Promise<void>;
  /** POST /api/projects/:id/submit (optimistic) */
  requestSubmit(projectId: string): Promise<void>;
  /** POST /api/projects/:id/archive (optimistic) */
  requestArchive(projectId: string): Promise<void>;
  /** DELETE /api/projects/:id — only from archived. */
  requestDelete(projectId: string): Promise<void>;
}

export interface ProjectLifecycleInput {
  projectId: string;
  /** Initial status, typically "queued" on creation. */
  initialStatus?: ProjectStatus;
  initialStage?: number;
  services: ProjectLifecycleServices;
}

export interface ProjectLifecycleContext {
  projectId: string;
  status: ProjectStatus;
  currentStage: number;
  totalStages: number;
  flagged: number;
  lastError: { stage: string; message: string } | null;
  archivedOn: string | null;
  services: ProjectLifecycleServices;
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type ProjectLifecycleEvent =
  | { type: "RUN" }
  | { type: "PAUSE" }
  | { type: "SUBMIT" }
  | { type: "ARCHIVE" }
  | { type: "RESTORE" }
  | { type: "DELETE" }
  | { type: "REOPEN" }
  | { type: "RETRY" }
  | {
      type: "STAGE_DONE";
      stage: string;
      flagged?: number;
    }
  | { type: "STAGE_FAILED"; stage: string; message: string }
  | {
      type: "RESOLVE";
      hasRemainingStages: boolean;
    }
  | {
      type: "STATUS_PUSH";
      status: ProjectStatus;
      currentStage?: number;
      flagged?: number;
    };

// ---------------------------------------------------------------------------
// Machine definition
// ---------------------------------------------------------------------------

export const projectLifecycleMachine = setup({
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  types: {} as {
    context: ProjectLifecycleContext;
    events: ProjectLifecycleEvent;
    input: ProjectLifecycleInput;
  },
  actors: {
    restoreProject: fromPromise<
      { status: ProjectStatus; currentStage: number; flagged: number },
      { projectId: string; services: ProjectLifecycleServices }
    >(({ input }) => input.services.restoreProject(input.projectId)),
  },
  guards: {
    /** YAML: stageNeedsReview: event.stage === 'text_review' || event.flagged > 0 */
    stageNeedsReview: (
      _args,
      params: { stage: string; flagged: number | undefined },
    ) => params.stage === "text_review" || (params.flagged ?? 0) > 0,

    /** YAML: isFinalStage: ctx.currentStage >= ctx.totalStages - 2 (submit_check) */
    isFinalStage: ({ context }) =>
      context.currentStage >= context.totalStages - 2,

    /** YAML: hasRemainingStages: event.hasRemainingStages */
    hasRemainingStages: (_args, params: { hasRemainingStages: boolean }) =>
      params.hasRemainingStages,

    /** YAML: restoredToReady: event.data.status === 'ready' */
    restoredToReady: (
      _args,
      params: {
        output: {
          status: ProjectStatus;
          currentStage: number;
          flagged: number;
        };
      },
    ) => params.output.status === "ready",

    /** YAML: restoredToReview: event.data.status === 'review' */
    restoredToReview: (
      _args,
      params: {
        output: {
          status: ProjectStatus;
          currentStage: number;
          flagged: number;
        };
      },
    ) => params.output.status === "review",
  },
  actions: {
    /** YAML: advanceStage */
    advanceStage: assign({
      currentStage: ({ context }) =>
        Math.min(context.currentStage + 1, context.totalStages - 1),
    }),

    /** YAML: assignFlagged */
    assignFlagged: assign({
      flagged: (
        _args,
        params: { flagged: number | undefined; currentFlagged: number },
      ) => params.flagged ?? params.currentFlagged,
    }),

    /** YAML: clearFlagged */
    clearFlagged: assign({ flagged: () => 0 }),

    /** YAML: assignError */
    assignError: assign(
      (
        _args,
        params: { stage: string; message: string },
      ): Partial<ProjectLifecycleContext> => ({
        lastError: { stage: params.stage, message: params.message },
      }),
    ),

    /** YAML: clearError */
    clearError: assign({ lastError: () => null }),

    /** YAML: stampArchivedOn */
    stampArchivedOn: assign({
      archivedOn: () => new Date().toISOString().slice(0, 10),
    }),

    /**
     * YAML: reconcile — sync from STATUS_PUSH.
     * Server authority wins. Can move to ANY state.
     */
    reconcile: assign({
      status: (
        _args,
        params: {
          status: ProjectStatus;
          currentStage: number | undefined;
          flagged: number | undefined;
          ctxStage: number;
          ctxFlagged: number;
        },
      ) => params.status,
      currentStage: (
        _args,
        params: {
          status: ProjectStatus;
          currentStage: number | undefined;
          flagged: number | undefined;
          ctxStage: number;
          ctxFlagged: number;
        },
      ) => params.currentStage ?? params.ctxStage,
      flagged: (
        _args,
        params: {
          status: ProjectStatus;
          currentStage: number | undefined;
          flagged: number | undefined;
          ctxStage: number;
          ctxFlagged: number;
        },
      ) => params.flagged ?? params.ctxFlagged,
    }),

    /** Optimistic request actions — fire-and-forget. */
    requestRun: ({ context }) => {
      void context.services.requestRun(context.projectId);
    },
    requestPause: ({ context }) => {
      void context.services.requestPause(context.projectId);
    },
    requestSubmit: ({ context }) => {
      void context.services.requestSubmit(context.projectId);
    },
    requestArchive: ({ context }) => {
      void context.services.requestArchive(context.projectId);
    },
    requestRestore: ({ context }) => {
      void context.services.requestArchive(context.projectId);
    },
    requestDelete: ({ context }) => {
      void context.services.requestDelete(context.projectId);
    },

    /** Apply restored status/stage/flagged from restoreProject result. */
    applyRestored: assign(
      (
        _args,
        params: {
          output: {
            status: ProjectStatus;
            currentStage: number;
            flagged: number;
          };
        },
      ): Partial<ProjectLifecycleContext> => ({
        status: params.output.status,
        currentStage: params.output.currentStage,
        flagged: params.output.flagged,
      }),
    ),

    assignRestoreError: assign(
      (_args, params: { error: unknown }): Partial<ProjectLifecycleContext> => {
        const msg =
          params.error instanceof Error
            ? params.error.message
            : "Restore failed";
        return {
          lastError: { stage: "restore", message: msg },
        };
      },
    ),
  },
}).createMachine({
  id: "projectLifecycle",
  context: ({ input }) => ({
    projectId: input.projectId,
    status: input.initialStatus ?? "queued",
    currentStage: input.initialStage ?? 0,
    totalStages: 23,
    flagged: 0,
    lastError: null,
    archivedOn: null,
    services: input.services,
  }),

  initial: "queued",

  states: {
    /** YAML: queued — created/ingested, not yet processing. Badge: neutral. */
    queued: {
      on: {
        RUN: { target: "running", actions: ["requestRun"] },
        ARCHIVE: { target: "archived", actions: ["requestArchive"] },
        STATUS_PUSH: {
          actions: [
            {
              type: "reconcile",
              params: ({
                event,
                context,
              }: {
                event: Extract<ProjectLifecycleEvent, { type: "STATUS_PUSH" }>;
                context: ProjectLifecycleContext;
              }) => ({
                status: event.status,
                currentStage: event.currentStage,
                flagged: event.flagged,
                ctxStage: context.currentStage,
                ctxFlagged: context.flagged,
              }),
            },
          ],
        },
      },
    },

    /** YAML: running — a stage is actively processing. Badge: running. */
    running: {
      on: {
        STAGE_DONE: [
          {
            target: "review",
            guard: {
              type: "stageNeedsReview",
              params: ({
                event,
              }: {
                event: Extract<ProjectLifecycleEvent, { type: "STAGE_DONE" }>;
              }) => ({
                stage: event.stage,
                flagged: event.flagged,
              }),
            },
            actions: [
              "advanceStage",
              {
                type: "assignFlagged",
                params: ({
                  event,
                  context,
                }: {
                  event: Extract<ProjectLifecycleEvent, { type: "STAGE_DONE" }>;
                  context: ProjectLifecycleContext;
                }) => ({
                  flagged: event.flagged,
                  currentFlagged: context.flagged,
                }),
              },
            ],
          },
          {
            target: "ready",
            guard: "isFinalStage",
            actions: ["advanceStage"],
          },
          {
            target: "running",
            actions: ["advanceStage"],
          },
        ],
        STAGE_FAILED: {
          target: "error",
          actions: [
            {
              type: "assignError",
              params: ({
                event,
              }: {
                event: Extract<ProjectLifecycleEvent, { type: "STAGE_FAILED" }>;
              }) => ({
                stage: event.stage,
                message: event.message,
              }),
            },
          ],
        },
        PAUSE: { target: "queued", actions: ["requestPause"] },
        STATUS_PUSH: {
          actions: [
            {
              type: "reconcile",
              params: ({
                event,
                context,
              }: {
                event: Extract<ProjectLifecycleEvent, { type: "STATUS_PUSH" }>;
                context: ProjectLifecycleContext;
              }) => ({
                status: event.status,
                currentStage: event.currentStage,
                flagged: event.flagged,
                ctxStage: context.currentStage,
                ctxFlagged: context.flagged,
              }),
            },
          ],
        },
      },
    },

    /** YAML: review — awaiting human input. Badge: review. */
    review: {
      on: {
        RESOLVE: [
          {
            target: "running",
            guard: {
              type: "hasRemainingStages",
              params: ({
                event,
              }: {
                event: Extract<ProjectLifecycleEvent, { type: "RESOLVE" }>;
              }) => ({
                hasRemainingStages: event.hasRemainingStages,
              }),
            },
            actions: ["clearFlagged", "advanceStage"],
          },
          {
            target: "ready",
            actions: ["clearFlagged"],
          },
        ],
        RUN: { target: "running", actions: ["requestRun"] },
        STATUS_PUSH: {
          actions: [
            {
              type: "reconcile",
              params: ({
                event,
                context,
              }: {
                event: Extract<ProjectLifecycleEvent, { type: "STATUS_PUSH" }>;
                context: ProjectLifecycleContext;
              }) => ({
                status: event.status,
                currentStage: event.currentStage,
                flagged: event.flagged,
                ctxStage: context.currentStage,
                ctxFlagged: context.flagged,
              }),
            },
          ],
        },
      },
    },

    /** YAML: ready — pipeline complete; package ready. Badge: clean. */
    ready: {
      on: {
        SUBMIT: { target: "submitted", actions: ["requestSubmit"] },
        ARCHIVE: { target: "archived", actions: ["requestArchive"] },
        REOPEN: { target: "review" },
        STATUS_PUSH: {
          actions: [
            {
              type: "reconcile",
              params: ({
                event,
                context,
              }: {
                event: Extract<ProjectLifecycleEvent, { type: "STATUS_PUSH" }>;
                context: ProjectLifecycleContext;
              }) => ({
                status: event.status,
                currentStage: event.currentStage,
                flagged: event.flagged,
                ctxStage: context.currentStage,
                ctxFlagged: context.flagged,
              }),
            },
          ],
        },
      },
    },

    /** YAML: submitted — submitted to PG. Badge: neutral. */
    submitted: {
      on: {
        ARCHIVE: { target: "archived", actions: ["requestArchive"] },
        REOPEN: { target: "review" },
        STATUS_PUSH: {
          actions: [
            {
              type: "reconcile",
              params: ({
                event,
                context,
              }: {
                event: Extract<ProjectLifecycleEvent, { type: "STATUS_PUSH" }>;
                context: ProjectLifecycleContext;
              }) => ({
                status: event.status,
                currentStage: event.currentStage,
                flagged: event.flagged,
                ctxStage: context.currentStage,
                ctxFlagged: context.flagged,
              }),
            },
          ],
        },
      },
    },

    /** YAML: error — stage failed. Badge: failed. */
    error: {
      on: {
        RETRY: {
          target: "running",
          actions: ["clearError", "requestRun"],
        },
        ARCHIVE: { target: "archived", actions: ["requestArchive"] },
        STATUS_PUSH: {
          actions: [
            {
              type: "reconcile",
              params: ({
                event,
                context,
              }: {
                event: Extract<ProjectLifecycleEvent, { type: "STATUS_PUSH" }>;
                context: ProjectLifecycleContext;
              }) => ({
                status: event.status,
                currentStage: event.currentStage,
                flagged: event.flagged,
                ctxStage: context.currentStage,
                ctxFlagged: context.flagged,
              }),
            },
          ],
        },
      },
    },

    /** YAML: archived — zipped, read-only. Badge: neutral. Reversible via RESTORE. */
    archived: {
      entry: ["stampArchivedOn"],
      on: {
        RESTORE: { target: "restoring", actions: ["requestRestore"] },
        DELETE: { target: "deleted", actions: ["requestDelete"] },
        STATUS_PUSH: {
          actions: [
            {
              type: "reconcile",
              params: ({
                event,
                context,
              }: {
                event: Extract<ProjectLifecycleEvent, { type: "STATUS_PUSH" }>;
                context: ProjectLifecycleContext;
              }) => ({
                status: event.status,
                currentStage: event.currentStage,
                flagged: event.flagged,
                ctxStage: context.currentStage,
                ctxFlagged: context.flagged,
              }),
            },
          ],
        },
      },
    },

    /** YAML: restoring — transient, unzipping before re-entering the flow. */
    restoring: {
      invoke: {
        id: "restoreProject",
        src: "restoreProject",
        input: ({ context }) => ({
          projectId: context.projectId,
          services: context.services,
        }),
        onDone: [
          {
            target: "ready",
            guard: {
              type: "restoredToReady",
              params: ({
                event,
              }: {
                event: {
                  output: {
                    status: ProjectStatus;
                    currentStage: number;
                    flagged: number;
                  };
                };
              }) => ({ output: event.output }),
            },
            actions: [
              {
                type: "applyRestored",
                params: ({
                  event,
                }: {
                  event: {
                    output: {
                      status: ProjectStatus;
                      currentStage: number;
                      flagged: number;
                    };
                  };
                }) => ({ output: event.output }),
              },
            ],
          },
          {
            target: "review",
            guard: {
              type: "restoredToReview",
              params: ({
                event,
              }: {
                event: {
                  output: {
                    status: ProjectStatus;
                    currentStage: number;
                    flagged: number;
                  };
                };
              }) => ({ output: event.output }),
            },
            actions: [
              {
                type: "applyRestored",
                params: ({
                  event,
                }: {
                  event: {
                    output: {
                      status: ProjectStatus;
                      currentStage: number;
                      flagged: number;
                    };
                  };
                }) => ({ output: event.output }),
              },
            ],
          },
          {
            target: "queued",
            actions: [
              {
                type: "applyRestored",
                params: ({
                  event,
                }: {
                  event: {
                    output: {
                      status: ProjectStatus;
                      currentStage: number;
                      flagged: number;
                    };
                  };
                }) => ({ output: event.output }),
              },
            ],
          },
        ],
        onError: {
          target: "archived",
          actions: [
            {
              type: "assignRestoreError",
              params: ({ event }: { event: { error: unknown } }) => ({
                error: event.error,
              }),
            },
          ],
        },
      },
    },

    /** YAML: deleted — final, no transitions out. Frontend drops from rail. */
    deleted: {
      type: "final",
    },
  },
});
