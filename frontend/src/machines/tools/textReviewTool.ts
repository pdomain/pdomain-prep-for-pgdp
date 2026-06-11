/**
 * textReviewTool — XState v5 machine for the Text review stage tool.
 *
 * Ported from `docs/plans/design_handoff_pgdp_app/statecharts/tool-text-review.yaml`
 * with the mechanical conventions in DIVERGENCES.md.
 *
 * Stage: text_review (project-scoped, Text group)
 *
 * ## Named invariant: DISCUSSIONS-GATE
 * `CONFIRM_ADVANCE` is gated by `gateOpen`:
 *   ctx.totals.discuss === 0 &&
 *   (!ctx._settings.requireCommentsResolved || ctx.threads.every(t => t.status === 'resolved'))
 *
 * This invariant is TDD'd in textReviewTool.test.ts. The confirm gate MUST
 * block whenever any queue item is in 'discuss' status, regardless of settings.
 *
 * ## Architecture
 * Linear machine: assembling → reviewing → confirming → settled.
 * Queue items: approve / comment / resolve.
 * Settled may reopen via REOPEN event (sign-off rule changed).
 *
 * @see docs/plans/design_handoff_pgdp_app/statecharts/tool-text-review.yaml
 * @see src/machines/DIVERGENCES.md — conventions
 */

import { setup, assign, fromPromise } from "xstate";
// W5.2 — import StageSettingsServices so TextReviewToolServices can extend it
import type { StageSettingsServices } from "./stageSettings";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type QueueItemStatus = "pending" | "discuss";

export interface QueueItem {
  id: string;
  word: string;
  ctxL: string;
  ctxR: string;
  suggest?: string;
  reason: string;
  page: string;
  line: number;
  reviewer: string;
  comments: number;
  status: QueueItemStatus;
}

export type ThreadStatus = "open" | "resolved";

export interface Thread {
  id: string;
  author: string;
  page: string;
  folio: string;
  anchor: string;
  body: string;
  replies: number;
  status: ThreadStatus;
  /** The item this thread is anchored to (if any) */
  itemId?: string;
}

export interface ReviewTotals {
  total: number;
  queue: number;
  pending: number;
  discuss: number;
  approved: number;
  clean: number;
  comments: number;
  done?: number;
}

export interface TextReviewSettings {
  requireCommentsResolved: boolean;
}

// ---------------------------------------------------------------------------
// Services interface
// ---------------------------------------------------------------------------

/** W5.2 — TextReviewToolServices extends StageSettingsServices (save-as-default/revert/reset). */
export interface TextReviewToolServices extends StageSettingsServices {
  /**
   * POST /api/projects/:id/stages/text_review/approve-low-risk -> { approvedIds }
   */
  approveLowRisk(projectId: string): Promise<{ approvedIds: string[] }>;

  /**
   * POST /api/projects/:id/stages/text_review/confirm -> { ok }
   */
  confirmStage(projectId: string): Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// Input + Context
// ---------------------------------------------------------------------------

export interface TextReviewToolInput {
  projectId: string;
  stageIndex: number;
  services: TextReviewToolServices;
  /** Optional initial settings; defaults to requireCommentsResolved: false */
  settings?: Partial<TextReviewSettings>;
}

export interface TextReviewToolContext {
  projectId: string;
  stageIndex: number;
  services: TextReviewToolServices;

  queue: QueueItem[];
  threads: Thread[];
  totals: ReviewTotals | null;
  queueFilter: string;
  commentFilter: "all" | "open" | "resolved";
  me: string | null;

  /** Settings that affect the confirm gate */
  _settings: TextReviewSettings;

  error: { message: string } | null;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type TextReviewToolEvent =
  // assembling phase
  | { type: "QUEUE_PUSH"; done: number; queue: number }
  | {
      type: "QUEUE_READY";
      queue: QueueItem[];
      threads: Thread[];
      totals: ReviewTotals;
    }
  // per-item decisions
  | { type: "APPROVE_ITEM"; itemId: string }
  | { type: "OPEN_COMMENT"; itemId: string; body: string }
  | { type: "REPLY"; threadId: string; body: string }
  | { type: "RESOLVE_THREAD"; threadId: string }
  | { type: "VIEW_ON_PAGE"; itemId: string }
  // batch
  | { type: "APPROVE_LOW_RISK" }
  | { type: "SEND_APPROVED" }
  // filters
  | { type: "SET_QUEUE_FILTER"; value: string }
  | { type: "SET_COMMENT_FILTER"; value: "all" | "open" | "resolved" }
  // gate
  | { type: "CONFIRM_ADVANCE" }
  // settings
  | { type: "SET_REQUIRE_COMMENTS_RESOLVED"; value: boolean }
  // settled
  | { type: "REOPEN" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dropItem(queue: QueueItem[], id: string): QueueItem[] {
  return queue.filter((q) => q.id !== id);
}

function recountQueue(queue: QueueItem[], threads: Thread[]): ReviewTotals {
  const pending = queue.filter((q) => q.status === "pending").length;
  const discuss = queue.filter((q) => q.status === "discuss").length;
  const comments = threads.length;
  return {
    total: queue.length,
    queue: queue.length,
    pending,
    discuss,
    approved: 0,
    clean: 0,
    comments,
    done: pending + discuss,
  };
}

function patchThread(
  threads: Thread[],
  threadId: string,
  fn: (t: Thread) => Thread,
): Thread[] {
  return threads.map((t) => (t.id === threadId ? fn(t) : t));
}

function newThread(
  event: Extract<TextReviewToolEvent, { type: "OPEN_COMMENT" }>,
): Thread {
  return {
    id: `thread-${Date.now()}`,
    author: "me",
    page: "",
    folio: "",
    anchor: event.itemId,
    body: event.body,
    replies: 0,
    status: "open",
    itemId: event.itemId,
  };
}

// ---------------------------------------------------------------------------
// Machine
// ---------------------------------------------------------------------------

export const textReviewToolMachine = setup({
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  types: {} as {
    context: TextReviewToolContext;
    events: TextReviewToolEvent;
    input: TextReviewToolInput;
  },

  actors: {
    /** YAML: `services.approveLowRisk` */
    approveLowRisk: fromPromise<
      { approvedIds: string[] },
      { projectId: string; services: TextReviewToolServices }
    >(({ input }) => input.services.approveLowRisk(input.projectId)),

    /** YAML: `services.confirmStage` */
    confirmStage: fromPromise<
      { ok: boolean },
      { projectId: string; services: TextReviewToolServices }
    >(({ input }) => input.services.confirmStage(input.projectId)),
  },

  guards: {
    /**
     * YAML: `anythingQueued: event.data.totals.queue > 0`
     * DIVERGENCES.md #3: event.output.
     */
    anythingQueued: (
      _args,
      params: {
        output: { queue: QueueItem[]; threads: Thread[]; totals: ReviewTotals };
      },
    ) => params.output.totals.queue > 0,

    /**
     * NAMED INVARIANT: DISCUSSIONS-GATE
     *
     * YAML: `gateOpen: ctx.totals.discuss === 0 && (!settings.requireCommentsResolved || threads.every(open))`
     *
     * This is the primary correctness invariant for textReviewTool.
     * CONFIRM_ADVANCE MUST be blocked whenever:
     *   1. Any queue item has status 'discuss' (ctx.totals.discuss > 0), OR
     *   2. The 'requireCommentsResolved' setting is on AND any thread is still open.
     *
     * TDD coverage: see textReviewTool.test.ts "DISCUSSIONS-GATE invariant" suite.
     */
    gateOpen: ({ context }) => {
      if (!context.totals) return false;
      // Condition 1: no items in 'discuss' state
      if (context.totals.discuss > 0) return false;
      // Condition 2: if requireCommentsResolved is on, all threads must be resolved
      if (context._settings.requireCommentsResolved) {
        return context.threads.every((t) => t.status === "resolved");
      }
      return true;
    },

    /**
     * Internal: queue empty and gateOpen → auto-settle.
     * DIVERGENCES.md #5 pattern: `always` guard on reviewing.
     */
    queueClearAndGateOpen: ({ context }) => {
      if (!context.totals) return false;
      if (context.totals.queue > 0) return false;
      if (context.totals.discuss > 0) return false;
      if (context._settings.requireCommentsResolved) {
        return context.threads.every((t) => t.status === "resolved");
      }
      return true;
    },
  },

  actions: {
    /**
     * YAML: `mergeQueueProgress`
     */
    mergeQueueProgress: assign({
      totals: ({ context, event }) => {
        if (event.type !== "QUEUE_PUSH") return context.totals;
        return context.totals
          ? {
              ...context.totals,
              done: event.done,
              queue: event.queue,
            }
          : null;
      },
    }),

    /**
     * YAML: `assignQueue: ctx.queue = event.data.queue; ctx.threads = ...; ctx.totals = ...`
     * DIVERGENCES.md #3: QUEUE_READY is a direct event (not actor onDone).
     */
    assignQueue: assign({
      queue: ({ event }) => {
        if (event.type !== "QUEUE_READY") return [] as QueueItem[];
        return event.queue;
      },
      threads: ({ event }) => {
        if (event.type !== "QUEUE_READY") return [] as Thread[];
        return event.threads;
      },
      totals: ({ event }) => {
        if (event.type !== "QUEUE_READY") return null;
        return event.totals;
      },
    }),

    /**
     * YAML: `markApproved: ctx.queue = dropItem(ctx.queue, event.itemId)`
     * Inline recount per DIVERGENCES.md #9.
     */
    markApproved: assign({
      queue: ({ context, event }) => {
        if (event.type !== "APPROVE_ITEM") return context.queue;
        return dropItem(context.queue, event.itemId);
      },
      totals: ({ context, event }) => {
        if (event.type !== "APPROVE_ITEM") return context.totals;
        const next = dropItem(context.queue, event.itemId);
        return recountQueue(next, context.threads);
      },
    }),

    /**
     * YAML: `beginThread: ctx.threads = [...ctx.threads, newThread(event)]; setItemStatus(..., 'discuss')`
     */
    beginThread: assign({
      threads: ({ context, event }) => {
        if (event.type !== "OPEN_COMMENT") return context.threads;
        return [...context.threads, newThread(event)];
      },
      queue: ({ context, event }) => {
        if (event.type !== "OPEN_COMMENT") return context.queue;
        return context.queue.map((q) =>
          q.id === event.itemId ? { ...q, status: "discuss" as const } : q,
        );
      },
      totals: ({ context, event }) => {
        if (event.type !== "OPEN_COMMENT") return context.totals;
        const newThreads = [...context.threads, newThread(event)];
        const nextQueue = context.queue.map((q) =>
          q.id === event.itemId ? { ...q, status: "discuss" as const } : q,
        );
        return recountQueue(nextQueue, newThreads);
      },
    }),

    /** YAML: `appendReply` */
    appendReply: assign({
      threads: ({ context, event }) => {
        if (event.type !== "REPLY") return context.threads;
        return patchThread(context.threads, event.threadId, (t) => ({
          ...t,
          replies: t.replies + 1,
        }));
      },
    }),

    /**
     * YAML: `resolveThread: ctx.threads = patchThread(..., t => ({ ...t, status: 'resolved' }))`
     */
    resolveThread: assign({
      threads: ({ context, event }) => {
        if (event.type !== "RESOLVE_THREAD") return context.threads;
        return patchThread(context.threads, event.threadId, (t) => ({
          ...t,
          status: "resolved" as const,
        }));
      },
    }),

    /**
     * YAML: `maybeUnblockItem` — if thread's item has no other open threads → status back to 'pending'
     */
    maybeUnblockItem: assign({
      queue: ({ context, event }) => {
        if (event.type !== "RESOLVE_THREAD") return context.queue;
        // Find the thread being resolved
        const thread = context.threads.find((t) => t.id === event.threadId);
        if (!thread?.itemId) return context.queue;
        const itemId = thread.itemId;
        // Check if any OTHER open thread is anchored to the same item
        const hasOtherOpenThreads = context.threads.some(
          (t) =>
            t.id !== event.threadId &&
            t.itemId === itemId &&
            t.status === "open",
        );
        if (hasOtherOpenThreads) return context.queue;
        // Unblock: set item back to 'pending'
        return context.queue.map((q) =>
          q.id === itemId ? { ...q, status: "pending" as const } : q,
        );
      },
      totals: ({ context, event }) => {
        if (event.type !== "RESOLVE_THREAD") return context.totals;
        const thread = context.threads.find((t) => t.id === event.threadId);
        if (!thread?.itemId) return context.totals;
        const itemId = thread.itemId;
        const hasOtherOpenThreads = context.threads.some(
          (t) =>
            t.id !== event.threadId &&
            t.itemId === itemId &&
            t.status === "open",
        );
        const nextQueue = hasOtherOpenThreads
          ? context.queue
          : context.queue.map((q) =>
              q.id === itemId ? { ...q, status: "pending" as const } : q,
            );
        const nextThreads = patchThread(
          context.threads,
          event.threadId,
          (t) => ({ ...t, status: "resolved" as const }),
        );
        return recountQueue(nextQueue, nextThreads);
      },
    }),

    /**
     * YAML: `mergeBatchApprovals`
     * DIVERGENCES.md #3: event.output on actor onDone.
     */
    mergeBatchApprovals: assign({
      queue: ({ context }, params: { output: { approvedIds: string[] } }) =>
        context.queue.filter((q) => !params.output.approvedIds.includes(q.id)),
      totals: ({ context }, params: { output: { approvedIds: string[] } }) => {
        const next = context.queue.filter(
          (q) => !params.output.approvedIds.includes(q.id),
        );
        return recountQueue(next, context.threads);
      },
    }),

    /** YAML: `assignQueueFilter` */
    assignQueueFilter: assign({
      queueFilter: ({ event }) => {
        if (event.type !== "SET_QUEUE_FILTER") return "all";
        return event.value;
      },
    }),

    /** YAML: `assignCommentFilter` */
    assignCommentFilter: assign({
      commentFilter: ({ event }) => {
        if (event.type !== "SET_COMMENT_FILTER") return "all" as const;
        return event.value;
      },
    }),

    /** YAML: `assignError` */
    assignError: assign((_args, params: { error: unknown }) => {
      let msg: string;
      if (params.error instanceof Error) {
        msg = params.error.message;
      } else if (typeof params.error === "string") {
        msg = params.error;
      } else {
        msg = "Unknown error";
      }
      return { error: { message: msg } };
    }),

    /**
     * `setRequireCommentsResolved` — update the settings flag.
     * Machine-level per DIVERGENCES.md #7 (display preference available throughout).
     */
    setRequireCommentsResolved: assign({
      _settings: ({ context, event }) => {
        if (event.type !== "SET_REQUIRE_COMMENTS_RESOLVED")
          return context._settings;
        return { ...context._settings, requireCommentsResolved: event.value };
      },
    }),

    // ---- Side-effect slots — no-op at F5; wired at I1 ----------------------

    /** YAML: `persistDecision` — POST approve { itemId } */
    persistDecision: () => {
      // SIDE EFFECT: at I1, POST /api/projects/:id/stages/text_review/decisions
    },

    /** YAML: `persistReply` — POST reply */
    persistReply: () => {
      // SIDE EFFECT: at I1, POST .../text_review/threads/:id/replies
    },

    /** YAML: `forwardApproved` — release approved pages downstream */
    forwardApproved: () => {
      // SIDE EFFECT: at I1, POST .../text_review/forward-approved
    },

    /** YAML: `navigateToPage` — open page with concern highlighted */
    navigateToPage: () => {
      // SIDE EFFECT: navigate to page at I1
    },

    /** YAML: `reopenPages` — re-enqueue pages affected by rule change */
    reopenPages: () => {
      // SIDE EFFECT: at I1, POST .../text_review/reopen
    },

    /**
     * YAML: `settleIfClear` — no-op; handled by `always` guard.
     * DIVERGENCES.md #5 pattern.
     */
    settleIfClear: () => {
      // no-op — always guard on reviewing handles auto-settle
    },

    /**
     * YAML: `recount` — DIVERGENCES.md #9: inlined in decision actions.
     */
    recount: () => {
      // Inlined in markApproved, beginThread, etc.
    },

    /** YAML: `emitResolved` — signal parent stageRunner */
    emitResolved: () => {
      // SIDE EFFECT: at I1, send RESOLVE to pipelineShell for text_review runner
    },
  },
}).createMachine({
  id: "textReviewTool",

  context: ({ input }) => ({
    projectId: input.projectId,
    stageIndex: input.stageIndex,
    services: input.services,
    queue: [],
    threads: [],
    totals: null,
    queueFilter: "all",
    commentFilter: "all",
    me: null,
    _settings: {
      requireCommentsResolved: input.settings?.requireCommentsResolved ?? false,
    },
    error: null,
  }),

  initial: "assembling",

  /**
   * Machine-level events — settings available throughout per DIVERGENCES.md #7.
   */
  on: {
    SET_REQUIRE_COMMENTS_RESOLVED: {
      actions: ["setRequireCommentsResolved"],
    },
  },

  states: {
    /**
     * YAML: `assembling` — "Assembling the review queue…"
     */
    assembling: {
      on: {
        QUEUE_PUSH: {
          actions: ["mergeQueueProgress"],
        },

        QUEUE_READY: [
          {
            target: "reviewing",
            guard: {
              type: "anythingQueued",
              params: ({
                event,
              }: {
                event: Extract<TextReviewToolEvent, { type: "QUEUE_READY" }>;
              }) => ({ output: event }),
            },
            actions: ["assignQueue"],
          },
          {
            target: "settled",
            actions: ["assignQueue"],
          },
        ],
      },
    },

    /**
     * YAML: `reviewing` — items await a human.
     *
     * DIVERGENCES.md #5: `always` guard auto-settles when queueClearAndGateOpen.
     */
    reviewing: {
      always: [
        {
          target: "confirming",
          guard: "queueClearAndGateOpen",
          actions: ["emitResolved"],
        },
      ],

      on: {
        APPROVE_ITEM: {
          actions: ["markApproved", "persistDecision"],
        },
        OPEN_COMMENT: {
          actions: ["beginThread"],
        },
        REPLY: {
          actions: ["appendReply", "persistReply"],
        },
        RESOLVE_THREAD: {
          actions: ["resolveThread", "maybeUnblockItem"],
        },
        VIEW_ON_PAGE: {
          actions: ["navigateToPage"],
        },

        APPROVE_LOW_RISK: {
          target: "batchApproving",
        },
        SEND_APPROVED: {
          actions: ["forwardApproved"],
        },

        SET_QUEUE_FILTER: {
          actions: ["assignQueueFilter"],
        },
        SET_COMMENT_FILTER: {
          actions: ["assignCommentFilter"],
        },

        CONFIRM_ADVANCE: {
          target: "confirming",
          guard: "gateOpen",
        },
      },
    },

    /**
     * YAML: `batchApproving` — invoke approveLowRisk.
     */
    batchApproving: {
      invoke: {
        id: "approveLowRisk",
        src: "approveLowRisk" as const,
        input: ({ context }: { context: TextReviewToolContext }) => ({
          projectId: context.projectId,
          services: context.services,
        }),
        onDone: {
          target: "reviewing",
          actions: [
            {
              type: "mergeBatchApprovals",
              params: ({
                event,
              }: {
                event: { output: { approvedIds: string[] } };
              }) => ({ output: event.output }),
            },
          ],
        },
        onError: {
          target: "reviewing",
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

    /**
     * YAML: `confirming` — invoke confirmStage.
     */
    confirming: {
      invoke: {
        id: "confirmStage",
        src: "confirmStage" as const,
        input: ({ context }: { context: TextReviewToolContext }) => ({
          projectId: context.projectId,
          services: context.services,
        }),
        onDone: {
          target: "settled",
          actions: ["emitResolved"],
        },
        onError: {
          target: "reviewing",
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

    /**
     * YAML: `settled` — every page signed off.
     */
    settled: {
      on: {
        REOPEN: {
          target: "reviewing",
          actions: ["reopenPages"],
        },
      },
    },
  },
});
