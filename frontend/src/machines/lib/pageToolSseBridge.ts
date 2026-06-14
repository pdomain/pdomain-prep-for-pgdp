/**
 * pageToolSseBridge — shared bridge from project-wide page-stage SSE channel to PAGE_PUSH.
 *
 * ## Integration point I1: "real SSE actor feeds PAGE_PUSH"
 *
 * The backend publishes ``stage-status: clean`` events to two broker keys:
 *   1. Per-page key ``{project_id}:{page_id}`` — subscribed per-page for other consumers.
 *   2. Project-wide key ``page-stages:{project_id}`` — subscribed HERE via a single
 *      EventSource at ``GET /projects/{id}/page-stages/events``.
 *
 * Page-workbench tool machines (grayscaleTool, ocrTool, …) expect ``PAGE_PUSH``
 * events to advance out of their ``converting`` / run-waiting states. This bridge
 * translates between the two with **one subscription per tool mount**, regardless
 * of page count.
 *
 * ## How it works
 *
 * 1. ``subscribePageChannelForTool`` opens ONE subscription to the project-wide
 *    page-stage channel via ``subscribeProjectPageStageChannel``.
 * 2. On a ``stage-status: clean`` event whose ``stage_id`` matches the watched
 *    stage, it calls the provided ``onPagePush`` callback with a constructed
 *    page object that carries:
 *      - ``id``        — zero-padded page index (``idx0`` from the event)
 *      - ``mode``      — determined by the ``getPageMode`` ref callback
 *      - ``lastRunAt`` — epoch seconds from the server event (``last_run_at``)
 *      - ``_total``    — set to ``totalPages`` on the page that completes the
 *                        full set, so the tool machine exits ``converting``
 * 3. Distinct-completion tracking via a ``Set`` ensures dedup-safe, order-independent
 *    counting across all pages.
 * 4. The bridge is generic: it accepts a ``stageId`` filter, a ``getPageMode``
 *    callback, and an ``onPagePush`` callback, so it serves any page-workbench
 *    tool machine that accepts ``PAGE_PUSH`` events.
 *
 * ## Usage
 *
 * ```ts
 * // Read-after-render ref so getPageMode sees the latest detected mode:
 * const detectedRef = useRef(snapshot.context.detected);
 * useEffect(() => { detectedRef.current = snapshot.context.detected; });
 *
 * // Inside a React component or hook that holds the machine actor:
 * const unsubscribe = subscribePageChannelForTool({
 *   projectId,
 *   stageId: "grayscale",
 *   totalPages,
 *   getPageMode: () => detectedRef.current?.mode ?? "perceptual",
 *   onPagePush: (page) => send({ type: "PAGE_PUSH", page }),
 * });
 * // cleanup:
 * unsubscribe();
 * ```
 *
 * @see docs/specs/2026-06-10-statechart-convergence-design.md §5.1
 * @see frontend/src/machines/tools/grayscaleTool.ts — PAGE_PUSH consumer
 * @see frontend/src/services/sse.ts — subscribeProjectPageStageChannel
 */

import { subscribeProjectPageStageChannel } from "@/services/sse";
import type { PageChannelEvent } from "@/types/pipeline";

// ---------------------------------------------------------------------------
// PAGE_PUSH page shape (minimal — matches GrayscalePage & friends)
// ---------------------------------------------------------------------------

/**
 * Minimal page object sent as ``PAGE_PUSH.page`` to tool machines.
 *
 * ``_total`` is the F5-2 sentinel: when present and equal to the total page
 * count, the ``isLastPage`` guard fires and the machine exits ``converting``.
 */
export interface ToolPagePush {
  /** Zero-padded page index string (e.g. "0000"). Matches the page_id convention. */
  id: string;
  /** Per-page mode — filled by ``getPageMode`` callback; tool-machine-specific. */
  mode: string;
  /** Epoch seconds when the stage committed; drives the artifact cache-buster. */
  lastRunAt?: number;
  /** Sentinel: set to ``totalPages`` on the last page so ``isLastPage`` fires. */
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
   * Total page count for the project. When the count of distinct pages that
   * have emitted a ``clean`` event equals ``totalPages``, ``_total`` is set on
   * the final page so the machine's ``isLastPage`` guard fires.
   */
  totalPages: number;
  /**
   * Called with the zero-based page index (int); returns the mode string for
   * the page. For grayscale: read ``detectedRef.current?.mode ?? "perceptual"``.
   * Must read from a ref (not a closure snapshot) so the current detected mode
   * is used even if detection resolved after the bridge was created.
   */
  getPageMode: (idx0: number) => string;
  /**
   * Called for each ``clean`` event that matches ``stageId``. The caller should
   * dispatch ``{ type: "PAGE_PUSH", page }`` into the tool machine.
   */
  onPagePush: (page: ToolPagePush) => void;
}

// ---------------------------------------------------------------------------
// Bridge factory
// ---------------------------------------------------------------------------

/**
 * Subscribe to the project-wide page-stage SSE channel and translate
 * ``stage-status: clean`` events for ``stageId`` into ``PAGE_PUSH``-ready page
 * objects.
 *
 * A single EventSource connection is opened for the project regardless of page
 * count. Events are filtered client-side by ``stageId``.
 *
 * The bridge tracks how many distinct pages have completed. On the page that
 * brings the total to ``config.totalPages``, it sets ``_total`` on the page
 * object so the machine's ``isLastPage`` guard can fire.
 *
 * @returns Unsubscribe function. Call on component unmount or actor stop.
 */
export function subscribePageChannelForTool(
  config: PageToolSseBridgeConfig,
): () => void {
  const { projectId, stageId, totalPages, getPageMode, onPagePush } = config;

  // Track completed page ids to count distinct completions (dedup-safe,
  // order-independent).
  const completedIds = new Set<string>();

  // Single subscription to the project-wide page-stage channel.
  // The backend fans every page-stage event to this key so we receive
  // completions for all pages without opening N connections.
  const unsubscribe = subscribeProjectPageStageChannel(
    projectId,
    (event: PageChannelEvent) => {
      if (event.type !== "stage-status") return;
      if (event.stage_id !== stageId) return;
      if (event.status !== "clean") return;

      // Use server-provided idx0 if available; fall back to 0 as a safe default.
      const resolvedIdx0 = event.idx0 !== undefined ? event.idx0 : 0;
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

  return unsubscribe;
}
