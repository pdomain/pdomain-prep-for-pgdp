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
 * W5.6: STAGE_DEPS and computeDownstream moved to `@/lib/stageDeps`.
 * Re-exported here for backward compatibility (tests import from fixtures).
 *
 * @see docs/specs/stage-registry-v2.md §2 for the authoritative stage list
 * @see docs/specs/api-v2-deltas.md §3 for schema shapes
 */

export { STAGE_DEPS, computeDownstream } from "@/lib/stageDeps";

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
// Project fixture
// ---------------------------------------------------------------------------

export const MOCK_PROJECT_ID = "proj-mock-0001";

export const MOCK_PROJECT: Project = {
  id: MOCK_PROJECT_ID,
  // Use `name` to match the real wire field on GET /pipeline (not `title`).
  name: "Mock Book",
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
