/**
 * sseActor — XState v5 actor factory wrapping an injected subscription function.
 *
 * ## Design
 *
 * The actor decouples machines from transport: it accepts a subscription
 * function `(projectId, cb) => unsubscribe` (the mock's `subscribeProject`
 * satisfies it; the real EventSource adapter comes at I1) and forwards
 * typed server events to the parent machine as `STAGE_PUSH`, `STATUS_PUSH`,
 * or `PROGRESS_PUSH` events.
 *
 * ## XState ↔ TanStack division (spec §5.1)
 *
 * Machines own interaction/orchestration state.
 * TanStack Query is the server cache for fetched data.
 * SSE pushes become machine events — they are NOT written into the Query cache
 * here; that wiring (if needed) lives in the component layer.
 *
 * ## Placement flag
 *
 * `createSseActor` is reusable by any XState machine in any pd-* SPA that
 * consumes a server-push channel with the same event-to-machine-event mapping
 * pattern. Flag for pdomain-ui consideration (see DIVERGENCES.md).
 *
 * @see docs/specs/api-v2-deltas.md §2 — SSE channel shapes
 * @see docs/specs/2026-06-10-statechart-convergence-design.md §5.1
 */

import { fromCallback } from "xstate";
import type {
  ProjectChannelEvent,
  PageChannelEvent,
  ProjectStageState,
  PageStageState,
  ProjectStageStatus,
  PageStageStatus,
} from "@/mocks/types";

// ---------------------------------------------------------------------------
// Machine-event types (what the actor emits to the parent machine)
// ---------------------------------------------------------------------------

/**
 * STATUS_PUSH — server-authoritative status update.
 *
 * Variants:
 *   - "snapshot"        — on-connect project-channel snapshot (all project stages)
 *   - "stage-status"    — project-scoped stage transition
 *   - "page-reorder"    — page order mutation
 *   - "validation-updated" — validation stage completed
 *   - "page-snapshot"   — on-connect per-page channel snapshot (all page stages)
 */
export interface StatusPushSnapshot {
  type: "STATUS_PUSH";
  variant: "snapshot";
  project_stages: ProjectStageState[];
}
export interface StatusPushStageStatus {
  type: "STATUS_PUSH";
  variant: "stage-status";
  stage_id: string;
  status: ProjectStageStatus;
  job_id: string | null;
  error_message: string | null;
}
export interface StatusPushPageReorder {
  type: "STATUS_PUSH";
  variant: "page-reorder";
  new_order: string[];
}
export interface StatusPushValidation {
  type: "STATUS_PUSH";
  variant: "validation-updated";
  blockers: number;
  warnings: number;
  status: ProjectStageStatus;
}
export interface StatusPushPageSnapshot {
  type: "STATUS_PUSH";
  variant: "page-snapshot";
  stages: PageStageState[];
}
export type StatusPushEvent =
  | StatusPushSnapshot
  | StatusPushStageStatus
  | StatusPushPageReorder
  | StatusPushValidation
  | StatusPushPageSnapshot;

/**
 * STAGE_PUSH — per-page stage lifecycle event from the page channel.
 *
 * Variants:
 *   - "status"   — stage status transition
 *   - "progress" — progress tick (0–1) while running
 */
export interface StagePushStatus {
  type: "STAGE_PUSH";
  variant: "status";
  stage_id: string;
  status: PageStageStatus;
  job_id: string | null;
  error_message: string | null;
}
export interface StagePushProgress {
  type: "STAGE_PUSH";
  variant: "progress";
  stage_id: string;
  progress: number;
  message: string;
}
export type StagePushEvent = StagePushStatus | StagePushProgress;

/** PROGRESS_PUSH — progress tick for long-running project stages. */
export interface ProgressPushEvent {
  type: "PROGRESS_PUSH";
  stage_id: string;
  progress: number;
  message: string;
}

/** Union of all events the sseActor emits to the parent machine. */
export type SseMachineEvent =
  | StatusPushEvent
  | StagePushEvent
  | ProgressPushEvent;

// ---------------------------------------------------------------------------
// Subscription function interface
// ---------------------------------------------------------------------------

/**
 * Subscription function interface accepted by the actor.
 * Matches both `subscribeProject` and `subscribePage` from the mock server,
 * and will match the real EventSource adapter at I1.
 */
export type SubscriptionFn<TEvent> = (
  projectId: string,
  cb: (event: TEvent) => void,
) => () => void;

// ---------------------------------------------------------------------------
// Mapping helpers: server event → machine event
// ---------------------------------------------------------------------------

function mapProjectEvent(event: ProjectChannelEvent): SseMachineEvent {
  switch (event.type) {
    case "project-snapshot":
      return {
        type: "STATUS_PUSH",
        variant: "snapshot",
        project_stages: event.project_stages,
      };
    case "project-stage-status":
      return {
        type: "STATUS_PUSH",
        variant: "stage-status",
        stage_id: event.stage_id,
        status: event.status,
        job_id: event.job_id,
        error_message: event.error_message,
      };
    case "project-stage-progress":
      return {
        type: "PROGRESS_PUSH",
        stage_id: event.stage_id,
        progress: event.progress,
        message: event.message,
      };
    case "page-reorder":
      return {
        type: "STATUS_PUSH",
        variant: "page-reorder",
        new_order: event.new_order,
      };
    case "validation-updated":
      return {
        type: "STATUS_PUSH",
        variant: "validation-updated",
        blockers: event.blockers,
        warnings: event.warnings,
        status: event.status,
      };
  }
}

function mapPageEvent(event: PageChannelEvent): SseMachineEvent {
  switch (event.type) {
    case "snapshot":
      return {
        type: "STATUS_PUSH",
        variant: "page-snapshot",
        stages: event.stages,
      };
    case "stage-status":
      return {
        type: "STAGE_PUSH",
        variant: "status",
        stage_id: event.stage_id,
        status: event.status,
        job_id: event.job_id,
        error_message: event.error_message,
      };
    case "stage-progress":
      return {
        type: "STAGE_PUSH",
        variant: "progress",
        stage_id: event.stage_id,
        progress: event.progress,
        message: event.message,
      };
  }
}

// ---------------------------------------------------------------------------
// Actor factory
// ---------------------------------------------------------------------------

/**
 * Create a `fromCallback`-style XState v5 actor that wraps a subscription
 * function and forwards server events to the parent as typed machine events.
 *
 * Usage:
 * ```ts
 * // In setup({ actors }):
 * projectSse: createSseActor(server.subscribeProject, projectId),
 * pageSse:    createSseActor(server.subscribePage, projectId),
 * ```
 *
 * For the real app (post-I1), replace `server.subscribeProject` /
 * `server.subscribePage` with an EventSource adapter that satisfies
 * `SubscriptionFn<ProjectChannelEvent>` / `SubscriptionFn<PageChannelEvent>`.
 *
 * @param subscriptionFn  Injected subscription: called once on actor start,
 *                        returns an unsubscribe function called on actor stop.
 * @param projectId       Passed through as the first arg to subscriptionFn.
 */
export function createSseActor<
  TEvent extends ProjectChannelEvent | PageChannelEvent,
>(subscriptionFn: SubscriptionFn<TEvent>, projectId: string) {
  return fromCallback<SseMachineEvent>(({ sendBack }) => {
    const unsubscribe = subscriptionFn(projectId, (event: TEvent) => {
      // Widen to the discriminated union so TypeScript narrows correctly in
      // both branches. The generic constraint guarantees TEvent is a subtype
      // of this union.
      const wide: ProjectChannelEvent | PageChannelEvent = event;
      const machineEvent = isProjectChannelEvent(wide)
        ? mapProjectEvent(wide)
        : mapPageEvent(wide);
      sendBack(machineEvent);
    });

    return () => {
      unsubscribe();
    };
  });
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

/**
 * Distinguish project-channel events from per-page channel events.
 * The function parameter uses the union so the narrowing works regardless
 * of which concrete TEvent the caller passes.
 */
function isProjectChannelEvent(
  event: ProjectChannelEvent | PageChannelEvent,
): event is ProjectChannelEvent {
  const t = event.type;
  return (
    t === "project-snapshot" ||
    t === "project-stage-status" ||
    t === "project-stage-progress" ||
    t === "page-reorder" ||
    t === "validation-updated"
  );
}
