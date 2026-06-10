/**
 * Deterministic fixture data for the v2 mock server.
 *
 * One project ("Mock Book") with 12 pages and the full 24-stage state matrix:
 * - 16 page-scoped stages × 12 pages = 192 PageStageState rows
 * - 8 project-scoped stage rows
 *
 * No Math.random() or Date.now() — all timestamps and IDs are literal
 * constants so tests are reproducible.
 *
 * @see docs/specs/stage-registry-v2.md §2 for the authoritative stage list
 * @see docs/specs/api-v2-deltas.md §3 for schema shapes
 */

import type {
  Project,
  PageStageState,
  ProjectStageState,
  ProjectAutomation,
  PageStageStatus,
  ProjectStageStatus,
} from "./types";

// ---------------------------------------------------------------------------
// Stage ID constants
// ---------------------------------------------------------------------------

/** 16 page-scoped v2 stage IDs in topological order.
 *
 * Order is derived from STAGE_DEPS (Kahn's algorithm):
 *   grayscale, illustrations — roots (only depend on project-scoped `source`)
 *   crop → threshold → deskew → denoise → dewarp → post_transform_crop
 *   canvas_map and text_zones both depend on post_transform_crop
 *   post_ocr_crop depends on canvas_map; ocr depends on post_ocr_crop
 *   wordcheck → hyphen_join → regex → text_review
 *
 * The corrected cluster vs the previous (wrong) ordering:
 *   … post_transform_crop, canvas_map, text_zones, post_ocr_crop, ocr …
 */
export const PAGE_STAGE_IDS = [
  "grayscale",
  "illustrations",
  "crop",
  "threshold",
  "deskew",
  "denoise",
  "dewarp",
  "post_transform_crop",
  "canvas_map",
  "text_zones",
  "post_ocr_crop",
  "ocr",
  "wordcheck",
  "hyphen_join",
  "regex",
  "text_review",
] as const;

/** 8 project-scoped v2 stage IDs in topological order. */
export const PROJECT_STAGE_IDS = [
  "source",
  "page_order",
  "validation",
  "proof_pack",
  "build_package",
  "zip",
  "submit_check",
  "archive",
] as const;

export type PageStageId = (typeof PAGE_STAGE_IDS)[number];
export type ProjectStageId = (typeof PROJECT_STAGE_IDS)[number];

// ---------------------------------------------------------------------------
// Dependency graph
// Hand-transcribed from stage-registry-v2.md §2.1 "Upstream deps" column.
// The graph encodes dirty propagation edges: re-running stage X marks all
// reachable descendants stale.
//
// Key: stage_id → direct upstream deps (what this stage depends on).
// To compute descendants stale from a re-run, invert the graph.
// ---------------------------------------------------------------------------

/** Adjacency map: stage → its direct upstream dependencies. */
export const STAGE_DEPS: Record<string, string[]> = {
  // Project-scoped
  source: [],
  page_order: ["source", "text_zones"], // cross-scope: text_zones all pages
  // Page-scoped
  grayscale: ["source"],
  crop: ["grayscale"],
  threshold: ["crop"],
  deskew: ["threshold"],
  denoise: ["deskew"],
  dewarp: ["denoise"],
  post_transform_crop: ["dewarp"],
  text_zones: ["post_transform_crop"],
  ocr: ["post_ocr_crop"],
  canvas_map: ["post_transform_crop"], // also blank_proof_synth alt (internal)
  post_ocr_crop: ["canvas_map"],
  wordcheck: ["ocr"],
  hyphen_join: ["wordcheck"],
  regex: ["hyphen_join"],
  text_review: ["hyphen_join", "regex"],
  illustrations: ["source"], // cross-scope: uses source thumbnail
  // Project-scoped tail
  validation: ["text_review", "illustrations", "page_order"],
  proof_pack: ["validation"],
  build_package: ["proof_pack"],
  zip: ["build_package"],
  submit_check: ["zip"],
  archive: ["submit_check"],
};

/**
 * Compute descendants of `stageId` (all transitively reachable stages
 * when `stageId` is re-run, i.e. stages that become stale).
 *
 * Uses the inverted graph: for each stage, which stages depend on it.
 *
 * This is pure logic — no side effects. Used by the mock server to propagate
 * stale state and by tests to assert fan-out.
 */
export function computeDownstream(startStageId: string): string[] {
  // Build reverse adjacency (dependents of each stage)
  const dependents = new Map<string, string[]>();
  for (const [stage, deps] of Object.entries(STAGE_DEPS)) {
    for (const dep of deps) {
      const existing = dependents.get(dep) ?? [];
      existing.push(stage);
      dependents.set(dep, existing);
    }
  }

  // BFS from startStageId
  const visited = new Set<string>();
  const queue = [startStageId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const dependent of dependents.get(current) ?? []) {
      if (!visited.has(dependent)) {
        visited.add(dependent);
        queue.push(dependent);
      }
    }
  }
  return Array.from(visited);
}

// ---------------------------------------------------------------------------
// Project fixture
// ---------------------------------------------------------------------------

export const MOCK_PROJECT_ID = "proj-mock-0001";

export const MOCK_PROJECT: Project = {
  id: MOCK_PROJECT_ID,
  title: "Mock Book",
  registry_version: 2,
  created_at: 1749513600, // 2025-06-10T00:00:00Z (deterministic literal)
  page_count: 12,
  user_id: "user-default",
};

// ---------------------------------------------------------------------------
// Page IDs
// ---------------------------------------------------------------------------

/** 12 pages with zero-padded idx0 strings matching the API convention. */
export const MOCK_PAGE_IDS: string[] = [
  "0000",
  "0001",
  "0002",
  "0003",
  "0004",
  "0005",
  "0006",
  "0007",
  "0008",
  "0009",
  "0010",
  "0011",
];

// ---------------------------------------------------------------------------
// Designated pages for special behaviour (used by the mock server).
// ---------------------------------------------------------------------------

/** Page that returns "flagged" when the `ocr` stage is run. */
export const FLAGGED_PAGE_ID = "0003";

/** Page that returns "failed" when the `ocr` stage is run. */
export const FAILED_PAGE_ID = "0007";

/** Stage that triggers the flagged/failed designations above. */
export const DESIGNATED_STAGE_ID = "ocr";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePageStageState(
  pageId: string,
  stageId: string,
  status: PageStageStatus = "not_run",
): PageStageState {
  return {
    page_id: pageId,
    stage_id: stageId,
    status,
    stage_version: 2,
    artifact_key: null,
    config_hash: null,
    input_hash: null,
    last_run_at: null,
    duration_ms: null,
    error_message: null,
    job_id: null,
  };
}

function makeProjectStageState(
  stageId: string,
  status: ProjectStageStatus = "not_run",
  extra?: Partial<ProjectStageState>,
): ProjectStageState {
  return {
    project_id: MOCK_PROJECT_ID,
    stage_id: stageId,
    status,
    stage_version: 2,
    artifact_key: null,
    config_hash: null,
    input_hash: null,
    last_run_at: null,
    duration_ms: null,
    error_message: null,
    job_id: null,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Initial page-stage state matrix
// 16 stages × 12 pages = 192 rows.
//
// `source` is already "clean" because the project exists (pages were ingested).
// All page-scoped stages start as "not_run".
// ---------------------------------------------------------------------------

/** Returns a fresh (deep-cloned) 16×12 matrix of page-stage states. */
export function makeFreshPageStages(): Map<
  string,
  Map<string, PageStageState>
> {
  // Outer key: page_id, inner key: stage_id
  const matrix = new Map<string, Map<string, PageStageState>>();
  for (const pageId of MOCK_PAGE_IDS) {
    const row = new Map<string, PageStageState>();
    for (const stageId of PAGE_STAGE_IDS) {
      row.set(stageId, makePageStageState(pageId, stageId, "not_run"));
    }
    matrix.set(pageId, row);
  }
  return matrix;
}

/** Returns fresh project-stage state (8 rows). source starts clean. */
export function makeFreshProjectStages(): Map<string, ProjectStageState> {
  const stages = new Map<string, ProjectStageState>();
  for (const stageId of PROJECT_STAGE_IDS) {
    const status: ProjectStageStatus =
      stageId === "source" ? "clean" : "not_run";
    stages.set(stageId, makeProjectStageState(stageId, status));
  }
  // Give source a deterministic artifact_key and last_run_at
  stages.set(
    "source",
    makeProjectStageState("source", "clean", {
      artifact_key: `projects/${MOCK_PROJECT_ID}/stages/source/output.json`,
      last_run_at: 1749513601,
      duration_ms: 4200,
    }),
  );
  return stages;
}

// ---------------------------------------------------------------------------
// Automation defaults
// ---------------------------------------------------------------------------

export const MOCK_AUTOMATION: ProjectAutomation = {
  auto_run_after_ingest: false,
  rerun_downstream_on_stale: false,
  notify_on_error: true,
  pause_on_flag_pct: 20,
};
