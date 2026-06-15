/**
 * Real EventSource adapters satisfying the `SubscriptionFn<T>` interface used
 * by `createSseActor` in `machines/lib/sseActor.ts`.
 *
 * At I1, these replace the mock `subscribeProject` / `subscribePage` callbacks.
 *
 * ## Event parsing
 *
 * The FastAPI SSE routes emit JSON lines prefixed with `data: `.
 * Each message is parsed with `JSON.parse(event.data)` and forwarded to the
 * subscriber callback as the typed channel event.
 *
 * ## Reconnection
 *
 * `EventSource` reconnects automatically on transport errors. No explicit
 * retry logic is needed here.
 *
 * @see docs/specs/api-v2-deltas.md §2 — SSE channel shapes
 * @see frontend/src/machines/lib/sseActor.ts — SubscriptionFn<T> interface
 */

import type { ProjectChannelEvent, PageChannelEvent } from "@/types/pipeline";

// ---------------------------------------------------------------------------
// Project-level SSE channel
// GET /api/data/projects/{project_id}/events
// ---------------------------------------------------------------------------

/**
 * Subscription function for the project-level SSE channel.
 * Satisfies `SubscriptionFn<ProjectChannelEvent>`.
 *
 * Usage:
 *   createSseActor(subscribeProject, projectId)
 */
export function subscribeProject(
  projectId: string,
  cb: (event: ProjectChannelEvent) => void,
): () => void {
  const url = `/api/data/projects/${encodeURIComponent(projectId)}/events`;
  const es = new EventSource(url, { withCredentials: true });

  // Backend emits named SSE event types:
  //   project-snapshot, project-stage-status, project-stage-progress,
  //   page-reorder, validation-updated
  // When `event:` is set, the browser fires a custom event — NOT `message`.
  // Use addEventListener for each type. See subscribeProjectPageStageChannel
  // comment for the detailed rationale.
  const _handleFrame = (evt: MessageEvent) => {
    try {
      const data = JSON.parse(evt.data as string) as ProjectChannelEvent;
      cb(data);
    } catch {
      // Malformed SSE frame — ignore
    }
  };

  const _eventTypes = [
    "project-snapshot",
    "project-stage-status",
    "project-stage-progress",
    "page-reorder",
    "validation-updated",
  ];
  for (const t of _eventTypes) {
    es.addEventListener(t, _handleFrame);
  }
  es.onmessage = _handleFrame;

  es.onerror = (_err) => {
    // EventSource auto-reconnects on error; no manual retry needed.
    // Log at debug level if needed for diagnostics.
  };

  return () => {
    for (const t of _eventTypes) {
      es.removeEventListener(t, _handleFrame);
    }
    es.close();
  };
}

// ---------------------------------------------------------------------------
// Per-page SSE channel
// GET /api/data/projects/{project_id}/pages/{idx0}/events
// ---------------------------------------------------------------------------

/**
 * Subscription function for the per-page SSE channel.
 * Satisfies `SubscriptionFn<PageChannelEvent>`.
 *
 * Note: the sseActor factory signature is `(projectId, cb) => unsubscribe`.
 * For the page channel we need `pageId` too — use `subscribePageChannel`
 * directly (curried with the pageId) or bind it:
 *
 *   createSseActor(
 *     (projectId, cb) => subscribePageChannel(projectId, idx0, cb),
 *     projectId
 *   )
 *
 * @internal — Wired to per-page tool components at I2.
 */
export function subscribePageChannel(
  projectId: string,
  idx0: string,
  cb: (event: PageChannelEvent) => void,
): () => void {
  const url = `/api/data/projects/${encodeURIComponent(projectId)}/pages/${encodeURIComponent(idx0)}/events`;
  const es = new EventSource(url, { withCredentials: true });

  // Backend emits `event: stage-status` and `event: stage-progress` frames.
  // Use addEventListener instead of onmessage — see subscribeProjectPageStageChannel
  // comment for the detailed rationale.
  const _handleFrame = (evt: MessageEvent) => {
    try {
      const data = JSON.parse(evt.data as string) as PageChannelEvent;
      cb(data);
    } catch {
      // Malformed SSE frame — ignore
    }
  };

  es.addEventListener("stage-status", _handleFrame);
  es.addEventListener("stage-progress", _handleFrame);
  es.onmessage = _handleFrame;

  es.onerror = (_err) => {
    // EventSource auto-reconnects on error.
  };

  return () => {
    es.removeEventListener("stage-status", _handleFrame);
    es.removeEventListener("stage-progress", _handleFrame);
    es.close();
  };
}

// ---------------------------------------------------------------------------
// Project-wide page-stage SSE channel
// GET /api/data/projects/{project_id}/page-stages/events
// ---------------------------------------------------------------------------

/**
 * Subscription function for the project-wide page-stage SSE channel.
 *
 * Subscribes to a single EventSource that receives ``stage-status`` events for
 * **all** pages in the project. The backend fans every page-stage event to both
 * the per-page key and this project-wide key, so a single connection replaces
 * the N-connection-per-page approach.
 *
 * Usage in the bridge:
 *   subscribeProjectPageStageChannel(projectId, (ev) => {
 *     // ev is a PageChannelEvent — filter by stage_id client-side
 *   })
 *
 * @see frontend/src/machines/lib/pageToolSseBridge.ts
 */
export function subscribeProjectPageStageChannel(
  projectId: string,
  cb: (event: PageChannelEvent) => void,
): () => void {
  const url = `/api/data/projects/${encodeURIComponent(projectId)}/page-stages/events`;
  const es = new EventSource(url, { withCredentials: true });

  // The backend emits frames with `event: stage-status` (and `event: stage-progress`).
  // When the SSE `event:` field is set to anything other than the default "message",
  // the browser fires a custom event with that name — NOT the generic `message` event.
  // `es.onmessage` only handles the default `message` event, so we must use
  // `addEventListener` for each named event type the backend emits.
  //
  // Event types emitted by stream_project_page_stage_events:
  //   stage-status    — stage status transitions (running → clean / failed)
  //   stage-progress  — in-progress progress updates (optional, less critical)
  const _handleFrame = (evt: MessageEvent) => {
    try {
      const data = JSON.parse(evt.data as string) as PageChannelEvent;
      cb(data);
    } catch {
      // Malformed SSE frame — ignore
    }
  };

  es.addEventListener("stage-status", _handleFrame);
  es.addEventListener("stage-progress", _handleFrame);
  // Fallback: also handle the default `message` event in case the server
  // omits the `event:` field (e.g., during development or after a refactor).
  es.onmessage = _handleFrame;

  es.onerror = (_err) => {
    // EventSource auto-reconnects on error.
  };

  return () => {
    es.removeEventListener("stage-status", _handleFrame);
    es.removeEventListener("stage-progress", _handleFrame);
    es.close();
  };
}
