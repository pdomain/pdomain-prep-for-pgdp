/**
 * pageToolSseBridge — shared bridge from per-page SSE channel to PAGE_PUSH.
 *
 * ## Integration point I1: "real SSE actor feeds PAGE_PUSH"
 *
 * The per-page SSE channel emits `stage-status: clean` events when a
 * stage completes. Page-workbench tool machines (grayscaleTool, ocrTool, …)
 * expect `PAGE_PUSH` events to advance out of their `converting` / run-
 * waiting states. This bridge translates between the two.
 *
 * ## How it works
 *
 * 1. `subscribePageChannelForTool` subscribes to the real per-page SSE channel
 *    via `subscribePageChannel` (from `@/services/sse`).
 * 2. On a `stage-status: clean` event whose `stage_id` matches the watched
 *    stage, it calls the provided `onPagePush` callback with a constructed
 *    page object that carries:
 *      - `id`         — zero-padded page index (`idx0` or derived from page_id)
 *      - `mode`       — determined by the `getPageMode` callback
 *      - `lastRunAt`  — epoch seconds from the server event (`last_run_at`)
 *      - `_total`     — when `pagesRemaining` reaches 0, the sentinel is set
 *                       so the tool machine exits `converting`
 *
 * 3. The bridge is generic: it accepts a `stageId` filter, a `getPageMode`
 *    callback, and an `onPagePush` callback, so it serves any page-workbench
 *    tool machine that accepts `PAGE_PUSH` events.
 *
 * ## Usage
 *
 * ```ts
 * // Inside a React component or hook that holds the machine actor:
 * const unsubscribe = subscribePageChannelForTool({
 *   projectId,
 *   stageId: "grayscale",
 *   totalPages,
 *   getPageMode: (idx0) => detectedMode ?? "perceptual",
 *   onPagePush: (page) => send({ type: "PAGE_PUSH", page }),
 * });
 * // cleanup:
 * unsubscribe();
 * ```
 *
 * @see docs/specs/2026-06-10-statechart-convergence-design.md §5.1
 * @see frontend/src/machines/tools/grayscaleTool.ts — PAGE_PUSH consumer
 * @see frontend/src/services/sse.ts — subscribePageChannel
 */

import { subscribePageChannel } from "@/services/sse";
import type { PageChannelEvent } from "@/types/pipeline";

// ---------------------------------------------------------------------------
// PAGE_PUSH page shape (minimal — matches GrayscalePage & friends)
// ---------------------------------------------------------------------------

/**
 * Minimal page object sent as `PAGE_PUSH.page` to tool machines.
 *
 * `_total` is the F5-2 sentinel: when present and equal to the total page
 * count, the `isLastPage` guard fires and the machine exits `converting`.
 */
export interface ToolPagePush {
  /** Zero-padded page index string (e.g. "0000"). Matches the page_id convention. */
  id: string;
  /** Per-page mode — filled by `getPageMode` callback; tool-machine-specific. */
  mode: string;
  /** Epoch seconds when the stage committed; drives the artifact cache-buster. */
  lastRunAt?: number;
  /** Sentinel: set to `totalPages` on the last page so `isLastPage` fires. */
  _total?: number;
  /** Allow extra tool-specific fields. */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Bridge config
// ---------------------------------------------------------------------------

export interface PageToolSseBridgeConfig {
  /** Project to subscribe to. */
  projectId: string;
  /** Stage ID to filter on (e.g. "grayscale"). */
  stageId: string;
  /**
   * Total page count for the project. When a `clean` event arrives and the
   * count of pages seen so far equals `totalPages`, `_total` is set on the
   * page so the machine's `isLastPage` guard fires.
   */
  totalPages: number;
  /**
   * Called with the zero-based page index (int); returns the mode string for
   * the page. For grayscale: return `detected.mode ?? "perceptual"`.
   */
  getPageMode: (idx0: number) => string;
  /**
   * Called for each `clean` event that matches `stageId`. The caller should
   * dispatch `{ type: "PAGE_PUSH", page }` into the tool machine.
   */
  onPagePush: (page: ToolPagePush) => void;
}

// ---------------------------------------------------------------------------
// Bridge factory
// ---------------------------------------------------------------------------

/**
 * Subscribe to the per-page SSE channel and translate `stage-status: clean`
 * events for `stageId` into `PAGE_PUSH`-ready page objects.
 *
 * The bridge tracks how many distinct pages have completed. On the page that
 * brings the total to `config.totalPages`, it sets `_total` on the page
 * object so the machine's `isLastPage` guard can fire.
 *
 * @returns Unsubscribe function. Call on component unmount or actor stop.
 */
export function subscribePageChannelForTool(
  config: PageToolSseBridgeConfig,
): () => void {
  const { projectId, stageId, totalPages, getPageMode, onPagePush } = config;

  // Track completed page ids to count distinct completions.
  const completedIds = new Set<string>();

  // The bridge subscribes to ALL pages via the project channel.
  // Per-page SSE is at /api/data/projects/{id}/pages/{idx0}/events — but we
  // don't know which page will complete first. The project-level grayscale
  // SSE is per-page (one channel per page). We subscribe to a sentinel page
  // channel at idx0=0 just to receive events that the backend fans out.
  //
  // NOTE: The backend emits per-page stage events on the page's own channel
  // (keyed by project_id:page_id). For a multi-page project, the component
  // must either:
  //   a) Subscribe to all N page channels, OR
  //   b) Use the project-level SSE channel.
  //
  // For I1 (single-page projects or "run all" that completes each page in
  // sequence), we subscribe to ALL page channels by listening to the
  // project-level channel. The project SSE carries `page-reorder` events but
  // NOT per-page stage events. We therefore subscribe to each page's channel
  // individually via N subscriptions. However, since `totalPages` may be
  // large, the bridge takes a simpler approach: subscribe to idx0=0 … N-1.
  //
  // I1 simplification: subscribe to all page channels from 0 to totalPages-1.
  const unsubscribers: (() => void)[] = [];

  for (let idx0 = 0; idx0 < totalPages; idx0++) {
    const pageId = String(idx0);
    const unsub = subscribePageChannel(
      projectId,
      pageId,
      (event: PageChannelEvent) => {
        if (event.type !== "stage-status") return;
        if (event.stage_id !== stageId) return;
        if (event.status !== "clean") return;

        // Use server-provided idx0 if available; fall back to subscription idx0.
        const resolvedIdx0 = event.idx0 !== undefined ? event.idx0 : idx0;
        const pageIdStr = String(resolvedIdx0).padStart(4, "0");

        // Deduplicate: ignore if already counted.
        if (completedIds.has(pageIdStr)) return;
        completedIds.add(pageIdStr);

        const doneCount = completedIds.size;
        const isLast = doneCount >= totalPages;

        const page: ToolPagePush = {
          id: pageIdStr,
          mode: getPageMode(resolvedIdx0),
          ...(event.last_run_at !== undefined
            ? { lastRunAt: event.last_run_at }
            : {}),
          ...(isLast ? { _total: totalPages } : {}),
        };

        onPagePush(page);
      },
    );
    unsubscribers.push(unsub);
  }

  return () => {
    for (const unsub of unsubscribers) {
      unsub();
    }
  };
}
