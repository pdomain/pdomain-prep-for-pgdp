/**
 * postImport — XState v5 machine for the post-import flow.
 *
 * Ported from `statecharts/post-import.yaml`.
 *
 * Owns the moment between "Start" in the new-project flow and the project
 * being ready. Three parallel regions:
 *   1. placement — Pa (auto-redirect) vs Pb (anchored on previous project)
 *   2. importJob — thumbnails → ingest → done lifecycle
 *   3. jobsDrawer — expanded/collapsed state
 *   4. jobsPill — header popover open/closed
 *
 * On settles: emits PROJECT_MUTATED so railList re-fetches.
 *
 * @see docs/plans/design_handoff_pgdp_app/statecharts/post-import.yaml
 * @see docs/plans/design_handoff_pgdp_app/final/projects/post-import.jsx
 * @see src/machines/DIVERGENCES.md
 */

import { setup, assign } from "xstate";
import type { ImportJob } from "@/mocks/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Toast {
  id: string;
  project: string;
  message: string;
}

export interface PostImportInput {
  projectId: string;
  initialJob: ImportJob;
  otherJobs?: ImportJob[];
  /** true when the folder index finished in < 1500ms (Pa scenario). */
  indexWasFast?: boolean;
  anchorId?: string | null;
  /** Called when the job settles (PROJECT_MUTATED equivalent). */
  onProjectMutated?: () => void;
  /** Called to navigate to a project's pipeline view. */
  onNavigateToProject?: (projectId: string) => void;
  /** Called to navigate back to the projects list. */
  onBackToProjects?: () => void;
}

export interface PostImportContext {
  projectId: string;
  job: ImportJob;
  otherJobs: ImportJob[];
  anchorId: string | null;
  toasts: Toast[];
  /** Transient: indexMs < 1500 means fast-index → Pa redirect. */
  _indexWasFast: boolean;
  onProjectMutated: (() => void) | undefined;
  onNavigateToProject: ((projectId: string) => void) | undefined;
  onBackToProjects: (() => void) | undefined;
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type PostImportEvent =
  | { type: "BACK_TO_PROJECTS" }
  | { type: "OPEN_PROJECT"; projectId?: string }
  | { type: "SELECT_PROJECT"; projectId: string }
  | { type: "OPEN_IMPORTING_ROW" }
  | { type: "JOB_PROGRESS"; pct: number; phase: string }
  | { type: "PHASE_PUSH"; phase: string; state?: string; pct?: number }
  | { type: "CANCEL_JOB"; jobId: string }
  | { type: "DISMISS_TOAST"; toastId: string }
  | { type: "COLLAPSE_DRAWER" }
  | { type: "EXPAND_DRAWER" }
  | { type: "OPEN_JOBS" }
  | { type: "CLOSE_JOBS" };

// ---------------------------------------------------------------------------
// Machine definition
// ---------------------------------------------------------------------------

let _toastCounter = 0;
function makeToastId(): string {
  _toastCounter += 1;
  return `toast-${_toastCounter.toString()}`;
}

export const postImportMachine = setup({
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  types: {} as {
    context: PostImportContext;
    events: PostImportEvent;
    input: PostImportInput;
  },
  actors: {},
  guards: {
    /** YAML: indexWasFast: ctx._indexMs < 1500 → Pa redirect */
    indexWasFast: ({ context }) => context._indexWasFast,

    /** YAML: jobDone: ctx.job.state === 'done' */
    jobDone: ({ context }) => context.job.state === "done",

    /**
     * YAML: isCancelable: jobOf(ctx, event.jobId).cancelable === true
     * We check the main job first, then otherJobs.
     */
    isCancelable: ({ context, event }) => {
      if (event.type !== "CANCEL_JOB" && event.type !== "OPEN_JOBS")
        return false;
      if (event.type !== "CANCEL_JOB") return false;
      if (context.job.id === event.jobId)
        return context.job.cancelable === true;
      const other = context.otherJobs.find((j) => j.id === event.jobId);
      return other?.cancelable === true;
    },

    /** YAML: isIngestPhase: event.phase.startsWith('ingest') */
    isIngestPhase: (_args, params: { phase: string }) =>
      params.phase.startsWith("ingest"),

    /** YAML: isDonePhase: event.state === 'done' */
    isDonePhase: (_args, params: { state?: string }) => params.state === "done",
  },
  actions: {
    assignJobProgress: assign({
      job: ({ context }, params: { pct: number; phase: string }) => ({
        ...context.job,
        pct: params.pct,
        phase: params.phase,
      }),
    }),

    assignJobPhase: assign({
      job: ({ context }, params: { phase: string; pct?: number }) => ({
        ...context.job,
        phase: params.phase,
        pct: params.pct ?? context.job.pct,
      }),
    }),

    markJobDone: assign({
      job: ({ context }) => ({
        ...context.job,
        state: "done" as const,
        pct: 100,
      }),
    }),

    pushCompletionToast: assign({
      toasts: ({ context }) => [
        ...context.toasts,
        {
          id: makeToastId(),
          project: context.job.project,
          message: `Import complete · ${context.job.phase}`,
        },
      ],
    }),

    removeToast: assign({
      toasts: ({ context }, params: { toastId: string }) =>
        context.toasts.filter((t) => t.id !== params.toastId),
    }),

    assignAnchor: assign({
      anchorId: (_args, params: { projectId: string }) => params.projectId,
    }),

    assignAnchorToList: assign({ anchorId: () => null }),

    removeJobRow: ({ context }) => {
      // SIDE EFFECT: parent notifies rail to remove the pseudo-row
      context.onProjectMutated?.();
    },

    emitProjectMutated: ({ context }) => {
      // Rail re-fetches; importing pseudo-row becomes a real row
      context.onProjectMutated?.();
    },

    navigateToProject: ({ context, event }) => {
      const projectId =
        event.type === "OPEN_PROJECT" && event.projectId
          ? event.projectId
          : context.projectId;
      context.onNavigateToProject?.(projectId);
    },

    requestCancel: () => {
      // SIDE EFFECT: POST /api/jobs/:jobId/cancel
      // Optimistic; PHASE_PUSH reconciles
    },
  },
}).createMachine({
  id: "postImport",
  context: ({ input }) => ({
    projectId: input.projectId,
    job: input.initialJob,
    otherJobs: input.otherJobs ?? [],
    anchorId: input.anchorId ?? null,
    toasts: [],
    _indexWasFast: input.indexWasFast ?? false,
    onProjectMutated: input.onProjectMutated,
    onNavigateToProject: input.onNavigateToProject,
    onBackToProjects: input.onBackToProjects,
  }),

  type: "parallel",

  states: {
    /**
     * YAML: Region placement — Pa (redirected) vs Pb (anchored).
     */
    placement: {
      initial: "deciding",
      states: {
        deciding: {
          always: [
            { target: "redirected", guard: "indexWasFast" },
            { target: "anchored" },
          ],
        },

        redirected: {
          on: {
            BACK_TO_PROJECTS: {
              target: "anchored",
              actions: ["assignAnchorToList"],
            },
            OPEN_PROJECT: {
              guard: "jobDone",
              actions: ["navigateToProject"],
            },
          },
        },

        anchored: {
          on: {
            SELECT_PROJECT: {
              actions: [
                {
                  type: "assignAnchor",
                  params: ({
                    event,
                  }: {
                    event: Extract<PostImportEvent, { type: "SELECT_PROJECT" }>;
                  }) => ({ projectId: event.projectId }),
                },
              ],
            },
            OPEN_IMPORTING_ROW: { target: "redirected" },
            OPEN_PROJECT: { actions: ["navigateToProject"] },
          },
        },
      },
    },

    /**
     * YAML: Region importJob — thumbnails → ingest → done.
     */
    importJob: {
      initial: "thumbnails",
      states: {
        thumbnails: {
          on: {
            JOB_PROGRESS: {
              actions: [
                {
                  type: "assignJobProgress",
                  params: ({
                    event,
                  }: {
                    event: Extract<PostImportEvent, { type: "JOB_PROGRESS" }>;
                  }) => ({ pct: event.pct, phase: event.phase }),
                },
              ],
            },
            PHASE_PUSH: {
              target: "ingest",
              guard: {
                type: "isIngestPhase",
                params: ({
                  event,
                }: {
                  event: Extract<PostImportEvent, { type: "PHASE_PUSH" }>;
                }) => ({ phase: event.phase }),
              },
              actions: [
                {
                  type: "assignJobPhase",
                  params: ({
                    event,
                  }: {
                    event: Extract<PostImportEvent, { type: "PHASE_PUSH" }>;
                  }) => ({
                    phase: event.phase,
                    ...(event.pct !== undefined ? { pct: event.pct } : {}),
                  }),
                },
              ],
            },
            CANCEL_JOB: {
              target: "cancelled",
              guard: "isCancelable",
              actions: ["requestCancel"],
            },
          },
        },

        ingest: {
          on: {
            JOB_PROGRESS: {
              actions: [
                {
                  type: "assignJobProgress",
                  params: ({
                    event,
                  }: {
                    event: Extract<PostImportEvent, { type: "JOB_PROGRESS" }>;
                  }) => ({ pct: event.pct, phase: event.phase }),
                },
              ],
            },
            PHASE_PUSH: {
              target: "done",
              guard: {
                type: "isDonePhase",
                params: ({
                  event,
                }: {
                  event: Extract<PostImportEvent, { type: "PHASE_PUSH" }>;
                }) => ({
                  ...(event.state !== undefined ? { state: event.state } : {}),
                }),
              },
              actions: [
                {
                  type: "assignJobPhase",
                  params: ({
                    event,
                  }: {
                    event: Extract<PostImportEvent, { type: "PHASE_PUSH" }>;
                  }) => ({
                    phase: event.phase,
                    ...(event.pct !== undefined ? { pct: event.pct } : {}),
                  }),
                },
              ],
            },
            CANCEL_JOB: {
              target: "cancelled",
              guard: "isCancelable",
              actions: ["requestCancel"],
            },
          },
        },

        done: {
          entry: ["markJobDone", "pushCompletionToast"],
          on: {
            DISMISS_TOAST: {
              target: "settled",
              actions: [
                {
                  type: "removeToast",
                  params: ({
                    event,
                  }: {
                    event: Extract<PostImportEvent, { type: "DISMISS_TOAST" }>;
                  }) => ({ toastId: event.toastId }),
                },
              ],
            },
            OPEN_PROJECT: {
              target: "settled",
              actions: ["navigateToProject"],
            },
          },
        },

        cancelled: {
          type: "final",
          entry: ["removeJobRow"],
        },

        settled: {
          type: "final",
          entry: ["emitProjectMutated"],
        },
      },
    },

    /**
     * YAML: Region jobsDrawer — bottom-right, Pb only visually.
     */
    jobsDrawer: {
      initial: "expanded",
      states: {
        expanded: {
          on: {
            COLLAPSE_DRAWER: { target: "collapsed" },
          },
        },
        collapsed: {
          on: {
            EXPAND_DRAWER: { target: "expanded" },
          },
        },
      },
    },

    /**
     * YAML: Region jobsPill — header popover, mirrors all running jobs.
     */
    jobsPill: {
      initial: "closed",
      states: {
        closed: {
          on: {
            OPEN_JOBS: { target: "open" },
          },
        },
        open: {
          on: {
            CLOSE_JOBS: { target: "closed" },
            CANCEL_JOB: {
              guard: "isCancelable",
              actions: ["requestCancel"],
            },
          },
        },
      },
    },
  },
});
