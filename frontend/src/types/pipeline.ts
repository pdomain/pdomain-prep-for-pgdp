/**
 * pipeline.ts — shared pipeline domain types.
 *
 * Canonical home for types previously duplicated in `@/mocks/types`.
 * These mirror the Pydantic schemas in `docs/specs/api-v2-deltas.md §3`
 * and `stage-registry-v2.md §5.4`.
 *
 * W5.6: moved from `@/mocks/types` so machines and non-mock code do not import
 * from the mock directory. `@/mocks/types` re-exports everything from here for
 * test backward compatibility.
 *
 * @see docs/specs/api-v2-deltas.md §3
 * @see docs/specs/stage-registry-v2.md §2, §5.4
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Status values for page-scoped stages (16 stages). */
export type PageStageStatus =
  | "not_run"
  | "running"
  | "clean"
  | "flagged"
  | "failed"
  | "dirty"
  | "not_applicable";

/**
 * Status values for project-scoped stages (8 stages).
 * Distinct from PageStageStatus — no `not_applicable` value.
 * @see api-v2-deltas.md §3
 */
export type ProjectStageStatus =
  | "not_run"
  | "running"
  | "clean"
  | "dirty"
  | "failed";

// ---------------------------------------------------------------------------
// Page-scoped stage state
// ---------------------------------------------------------------------------

/** One row from `page_stages` for a single page + stage combination. */
export interface PageStageState {
  page_id: string;
  stage_id: string;
  status: PageStageStatus;
  stage_version: number;
  artifact_key: string | null;
  config_hash: string | null;
  input_hash: string | null;
  last_run_at: number | null; // epoch seconds
  duration_ms: number | null;
  error_message: string | null;
  job_id: string | null;
}

// ---------------------------------------------------------------------------
// Project-scoped stage state
// ---------------------------------------------------------------------------

/** One row from `project_stages`. Mirrors PageStageState without page_id. */
export interface ProjectStageState {
  project_id: string;
  stage_id: string;
  status: ProjectStageStatus;
  stage_version: number;
  artifact_key: string | null;
  config_hash: string | null;
  input_hash: string | null;
  last_run_at: number | null; // epoch seconds
  duration_ms: number | null;
  error_message: string | null;
  job_id: string | null;
}

// ---------------------------------------------------------------------------
// Pipeline hydration (GET /projects/{id}/pipeline)
// ---------------------------------------------------------------------------

/** Per-stage-ID aggregate across all pages — for `PipelineSnapshot`. */
export interface PageStageSummary {
  stage_id: string;
  /** Worst status across all pages for this stage. */
  worst_status: PageStageStatus;
  /** Count of pages where this stage is stale/dirty. */
  stale_count: number;
  /** Count of pages where this stage is flagged. */
  flagged_count: number;
}

/** Automation toggles embedded in PipelineSnapshot and project settings. */
export interface ProjectAutomation {
  auto_run_after_ingest: boolean;
  rerun_downstream_on_stale: boolean;
  notify_on_error: boolean;
  pause_on_flag_pct: number;
}

/** Project record (subset of full project model used in PipelineSnapshot). */
export interface Project {
  id: string;
  title: string;
  registry_version: number;
  created_at: number; // epoch seconds
  page_count: number;
  user_id: string;
}

/** Response for GET /api/data/projects/{id}/pipeline. */
export interface PipelineSnapshot {
  project: Project;
  /** One entry per page-scoped stage_id (16 entries). Aggregated across pages. */
  page_stages_summary: PageStageSummary[];
  /** One entry per project-scoped stage_id (8 entries). */
  project_stages: ProjectStageState[];
  automation: ProjectAutomation;
}

// ---------------------------------------------------------------------------
// Stage run request
// ---------------------------------------------------------------------------

/** Request body for POST .../stages/{stage_id}/run and .../project-stages/{stage_id}/run. */
export interface StageRunRequest {
  force?: boolean;
  /** `async` in the wire format. Always true for project-scoped stages. */
  async?: boolean;
}

// ---------------------------------------------------------------------------
// Page order
// ---------------------------------------------------------------------------

/** Stored artifact + event payload for the page_order stage. */
export interface PageOrderUpdate {
  new_order: string[]; // ordered page idx0 strings
  previous_order: string[];
  actor_id: string;
  timestamp: string; // ISO datetime
}

// ---------------------------------------------------------------------------
// Validation report
// ---------------------------------------------------------------------------

export interface ValidationBlocker {
  page_id: string | null;
  stage_id: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  page_id: string | null;
  stage_id: string;
  message: string;
  code: string;
}

export interface ValidationReport {
  project_id: string;
  run_at: string; // ISO datetime
  blockers: ValidationBlocker[];
  warnings: ValidationWarning[];
  blocker_count: number;
  warning_count: number;
  passed: boolean;
}

// ---------------------------------------------------------------------------
// Submit-check report
// ---------------------------------------------------------------------------

export interface SubmitCheckReport {
  project_id: string;
  run_at: string; // ISO datetime
  zip_sha256: string;
  zip_size_bytes: number;
  file_count: number;
  issues: string[];
  passed: boolean;
}

// ---------------------------------------------------------------------------
// SSE event payloads (project channel)
// @see stage-registry-v2.md §5.4
// ---------------------------------------------------------------------------

/** First frame on the project SSE channel. */
export interface ProjectSnapshotEvent {
  type: "project-snapshot";
  project_stages: ProjectStageState[];
}

/** Project-scoped stage lifecycle transition. */
export interface ProjectStageStatusEvent {
  type: "project-stage-status";
  stage_id: string;
  status: ProjectStageStatus;
  job_id: string | null;
  error_message: string | null;
}

/** Progress tick for long-running project stages. */
export interface ProjectStageProgressEvent {
  type: "project-stage-progress";
  stage_id: string;
  progress: number; // 0–1
  message: string;
}

/** Broadcast when a page reorder mutation is applied. */
export interface PageReorderEvent {
  type: "page-reorder";
  new_order: string[]; // ordered page idx0 strings
}

/** Pushed when validation stage re-runs. */
export interface ValidationUpdatedEvent {
  type: "validation-updated";
  blockers: number;
  warnings: number;
  status: ProjectStageStatus;
}

/** SSE events from the per-page channel (unchanged from v1). */
export interface StageStatusEvent {
  type: "stage-status";
  stage_id: string;
  status: PageStageStatus;
  job_id: string | null;
  error_message: string | null;
}

export interface StageProgressEvent {
  type: "stage-progress";
  stage_id: string;
  progress: number;
  message: string;
}

/** On-connect snapshot for the per-page channel. */
export interface PageSnapshotEvent {
  type: "snapshot";
  stages: PageStageState[];
}

export type ProjectChannelEvent =
  | ProjectSnapshotEvent
  | ProjectStageStatusEvent
  | ProjectStageProgressEvent
  | PageReorderEvent
  | ValidationUpdatedEvent;

export type PageChannelEvent =
  | PageSnapshotEvent
  | StageStatusEvent
  | StageProgressEvent;

// ---------------------------------------------------------------------------
// Projects list API (GET /api/projects)
// ---------------------------------------------------------------------------

/**
 * Project status in the lifecycle taxonomy.
 */
export type ProjectLifecycleStatus =
  | "queued"
  | "running"
  | "review"
  | "ready"
  | "submitted"
  | "error"
  | "archived";

/** Full project record as returned by GET /api/projects. */
export interface ProjectRecord {
  id: string;
  title: string;
  author: string;
  pages: number;
  totalStages: number;
  currentStage: number;
  status: ProjectLifecycleStatus;
  flagged?: number;
  archived?: boolean;
  archivedOn?: string;
  updatedRel: string;
  updatedAbs: string;
  created: string;
  size: string;
  registry_version: number;
}

/** Badge tone derived from project status (server-authoritative). */
export type StatusTone = "neutral" | "running" | "review" | "clean" | "failed";

// ---------------------------------------------------------------------------
// Activity feed API (GET /api/projects/:id/activity)
// ---------------------------------------------------------------------------

export type ActivityEntryKind = "stage" | "comment" | "system";

export interface ActivityEntry {
  id: string;
  stage: string;
  description: string;
  at: string; // ISO
  kind: ActivityEntryKind;
}

export interface ActivityFeedResponse {
  entries: ActivityEntry[];
  totalCount: number;
  commentCount: number;
  stageCount: number;
}

// ---------------------------------------------------------------------------
// Attributes API (GET/PATCH /api/projects/:id/attributes)
// ---------------------------------------------------------------------------

export type AttributeSection = "bib" | "pgdp" | "fmt" | "comments";

export interface AttributeRecord {
  bib: Record<string, string>;
  pgdp: Record<string, string>;
  fmt: Record<string, string>;
  comments: string;
}

// ---------------------------------------------------------------------------
// Manage actions API (POST /api/projects/:id/*)
// ---------------------------------------------------------------------------

export type ManageAction =
  | "clean"
  | "archive"
  | "saveCopy"
  | "delete"
  | "restore";

export interface ManageActionResult {
  action: ManageAction;
  status?: ProjectLifecycleStatus;
  reclaimedBytes?: number;
  zippedSize?: number;
  downloadUrl?: string;
  deleted?: boolean;
}

// ---------------------------------------------------------------------------
// Import job types (used by postImport machine)
// ---------------------------------------------------------------------------

export type ImportJobState = "running" | "done" | "cancelled";

export interface ImportJob {
  id: string;
  project: string;
  projectId: string;
  phase: string;
  pct: number;
  state: ImportJobState;
  cancelable?: boolean;
}
