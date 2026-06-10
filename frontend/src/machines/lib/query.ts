/**
 * query.ts — canonical service-injection pattern for XState v5 machines.
 *
 * ## Pattern (F3–F5 copy this)
 *
 * 1. Define a `Services` interface listing every async operation the machine
 *    needs (fetches, mutations).  Types come from `@/mocks/types` (interim)
 *    and will flip to `frontend/src/api/types.gen.ts` at I1.
 *
 * 2. Machines receive a `services` object through `input` (XState v5 `input`
 *    is passed at `createActor(machine, { input: { services, stageId } })`).
 *    Inside `setup({ actors })`, each `invoke.src` is bound to a named actor
 *    that calls `context.services.xxx(...)`.
 *
 *    ```ts
 *    const myMachine = setup({
 *      types: {} as {
 *        input: { services: MyServices; stageId: string };
 *        context: { services: MyServices; stageId: string };
 *      },
 *      actors: {
 *        fetchData: fromPromise(({ input }: { input: MyServices }) =>
 *          input.fetchThing(input.stageId),
 *        ),
 *      },
 *    }).createMachine({ ... });
 *    ```
 *
 *    Machines NEVER hold cached server collections in context beyond what the
 *    YAML's `context:` block declares.  TanStack Query caches server data;
 *    machines only hold interaction/orchestration state.
 *
 * 3. In React components, use `wrapQueryClient(queryClient)` (below) to produce
 *    a services object that routes fetches through the query cache.
 *
 *    ```ts
 *    const services = useMemo(
 *      () => wrapQueryClient<StageRunnerServices>(queryClient, {
 *        runStage: (stageId) =>
 *          queryClient.fetchQuery({ queryKey: ['stage', stageId], queryFn: ... }),
 *      }),
 *      [queryClient],
 *    );
 *    ```
 *
 * 4. In tests, inject a mock services object directly — no QueryClient needed.
 *
 * ## XState ↔ TanStack division (spec §5.1, pinned)
 *
 * - XState owns interaction + orchestration state (modal steps, optimistic
 *   flags, inline editor, cursor, draft).
 * - TanStack Query owns the server cache (list data, project metadata).
 * - SSE pushes enter the machine as `STAGE_PUSH`/`STATUS_PUSH` events via
 *   `sseActor`; they are NOT written into the Query cache here.
 *
 * @see docs/specs/2026-06-10-statechart-convergence-design.md §5.1
 * @see docs/specs/api-v2-deltas.md §3
 */

import type { QueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Service injection helper
// ---------------------------------------------------------------------------

/**
 * Thin helper: given a `QueryClient` and a record of service functions, return
 * the same service record.  The QueryClient is available for callers that want
 * to route fetches through the cache (via `queryClient.fetchQuery`); it is not
 * used internally — machines don't know about it.
 *
 * This is intentionally minimal: its value is documentation (it makes the
 * pattern explicit) and type-safety (ensures the returned object satisfies the
 * machine's `Services` interface at compile time).
 *
 * Usage in a component:
 * ```ts
 * const qc = useQueryClient();
 * const services = useMemo(
 *   () => bindQueryClient<StageRunnerServices>(qc, {
 *     runStage: (stageId) =>
 *       qc.fetchQuery({
 *         queryKey: ['runStage', projectId, stageId],
 *         queryFn: () => api.runStage(projectId, stageId),
 *       }),
 *     // …
 *   }),
 *   [qc, projectId],
 * );
 * ```
 */
export function bindQueryClient<TServices>(
  _queryClient: QueryClient,
  services: TServices,
): TServices {
  // The QueryClient is available to the caller via closure; we don't capture
  // it here because machines must not reference the cache directly.
  return services;
}

// ---------------------------------------------------------------------------
// Service interface contracts (used by machines; injected at createActor time)
// ---------------------------------------------------------------------------

import type {
  PipelineSnapshot,
  PageStageState,
  ProjectStageState,
  StageRunRequest,
} from "@/mocks/types";

/**
 * Services consumed by `stageRunner`.
 *
 * Each function maps to one `invoke.src` actor in the machine setup.
 * Names match the YAML `services:` dictionary.
 */
export interface StageRunnerServices {
  /**
   * POST /api/projects/:pid/stages/:stageId/run (or project-stages/)
   * Resolves with the run outcome.
   * The actor streams PROGRESS events via a side-channel (TBD at I1);
   * for now it resolves with the final PageStageState / ProjectStageState.
   */
  runStage(
    projectId: string,
    stageId: string,
    request?: StageRunRequest,
  ): Promise<{
    status: string;
    flaggedPages?: PageRef[];
    artifactBytes?: number;
    code?: string;
  }>;
}

/**
 * Services consumed by `imageStageReview`.
 */
export interface ImageStageReviewServices {
  /**
   * GET /api/projects/:id/stages/:stageId/pages -> { rows, totals }
   */
  fetchStagePages(
    projectId: string,
    stageId: string,
  ): Promise<{ rows: PageRow[]; totals: Totals }>;

  /**
   * POST /api/projects/:id/stages/:stageId/rerun { params, pageIds } -> PageRow[]
   */
  reRunPages(
    projectId: string,
    stageId: string,
    draft: Record<string, unknown>,
    pageIds: string[],
  ): Promise<PageRow[]>;

  /**
   * POST /api/projects/:id/stages/:stageId/confirm -> { ok }
   */
  confirmStage(projectId: string, stageId: string): Promise<{ ok: boolean }>;
}

/**
 * Services consumed by `pageWorkbench`.
 */
export interface PageWorkbenchServices {
  /**
   * GET /api/projects/:id/stages/:stageId/pages/:pageId/bench
   * -> { params, pageStats, flagNote }
   */
  fetchBenchPage(
    projectId: string,
    stageId: string,
    pageId: string,
  ): Promise<{
    params: Record<string, unknown>;
    pageStats: Record<string, unknown> | null;
    flagNote: string | null;
  }>;

  /**
   * POST /api/projects/:id/stages/:stageId/pages/:pageId/detect
   * -> { pageStats, overlays }
   */
  redetect(
    pageId: string,
    stageId: string,
    params: Record<string, unknown>,
  ): Promise<{ pageStats: Record<string, unknown>; overlays?: unknown }>;

  /**
   * POST /api/projects/:id/stages/:stageId/pages/:pageId/apply -> PageRef
   */
  applyPage(
    pageId: string,
    stageId: string,
    params: Record<string, unknown>,
  ): Promise<PageRef>;
}

// ---------------------------------------------------------------------------
// Domain micro-types (shared by service interfaces; mirror the YAML)
// ---------------------------------------------------------------------------

/** Page reference as used in flagged/flagged-page aggregates. */
export interface PageRef {
  pageId: string;
  n: number;
  flagKind: string;
}

/** A row in the imageStageReview page grid. */
export interface PageRow {
  idx: string;
  prefix: string;
  state: "running" | "clean" | "flagged" | "reviewed" | "failed";
  flags?: string[];
  pageNumber: number;
  [key: string]: unknown;
}

/** Aggregate totals for the imageStageReview tool. */
export interface Totals {
  total: number;
  done: number;
  flagged: number;
  clean: number;
  reviewed: number;
  errors: number;
  running: number;
  rateHz?: number;
  [key: string]: unknown;
}

// Re-export for convenience
export type { PipelineSnapshot, PageStageState, ProjectStageState };
