/**
 * In-memory v2 API mock server for the frontend track.
 *
 * Implements the v2 API surface the frontend needs during Track F development
 * (before Track B ships the real routes). Framework-free: uses plain
 * EventTarget-style callbacks and async-shaped promises. No msw dependency —
 * the mock is exercised directly in unit tests and can be injected as the
 * service interface for machines.
 *
 * Key behaviours:
 * - Deterministic fixture data (12 pages, all 24 stages).
 * - Stage run: not_run → running (emitted) → clean | flagged | failed (emitted).
 *   Designated page+stage combinations return flagged/failed (see fixtures.ts).
 * - Downstream stale propagation: on re-run, all transitive descendants
 *   of the run stage are marked dirty.
 * - Page reorder: updates order, marks page_order project stage dirty,
 *   propagates dirty to the downstream project chain.
 * - SSE simulation: subscribe(projectId) emits project-snapshot immediately
 *   then incremental events on mutations.
 * - Each createMockServer() call produces isolated mutable state — no global
 *   side effects between test cases.
 *
 * @see docs/specs/api-v2-deltas.md
 * @see docs/specs/stage-registry-v2.md
 */

import type {
  Project,
  PageStageState,
  ProjectStageState,
  PipelineSnapshot,
  PageStageSummary,
  PageStageStatus,
  ProjectChannelEvent,
  PageChannelEvent,
  StageRunRequest,
  ProjectRecord,
  ManageAction,
  ManageActionResult,
  ActivityFeedResponse,
  AttributeRecord,
  AttributeSection,
} from "./types";

// ---------------------------------------------------------------------------
// F5.3: OCR group tool types (inline — moved to api types at I1)
// ---------------------------------------------------------------------------

/** A detected layout zone on a page. */
export interface ZoneItem {
  id: string;
  type:
    | "body"
    | "heading"
    | "header"
    | "footer"
    | "caption"
    | "footnote"
    | "illustration"
    | "table"
    | "marginalia";
  x: number;
  y: number;
  w: number;
  h: number;
  order: number | null;
}

export interface SplitDraft {
  axis: "col" | "row";
  into: 2;
  gutter: number;
  conf: number;
}

/** Row in the text_zones page grid. */
export interface ZonePageRow {
  idx: string;
  prefix: string;
  state: "running" | "clean" | "flagged" | "reviewed" | "split" | "failed";
  flags?: string[];
  layoutKind?: string;
  zones?: number;
  lines?: number;
  words?: number;
  pageNumber?: number;
  split?: SplitDraft & { applied?: boolean };
  [key: string]: unknown;
}

export interface ZoneTotals {
  total: number;
  done: number;
  clean: number;
  flagged: number;
  reviewed: number;
  splits: number;
  rateHz?: number;
  zonesAvg?: number;
}

export interface SplitResult {
  parentRow: ZonePageRow;
  childRows: [ZonePageRow, ZonePageRow];
}

/** Low-confidence OCR token with suggested correction. */
export interface OcrToken {
  id: string;
  word: string;
  suggest: string;
  conf: number;
}

import {
  MOCK_PROJECT,
  MOCK_PAGE_IDS,
  PAGE_STAGE_IDS,
  PROJECT_STAGE_IDS,
  MOCK_AUTOMATION,
  FLAGGED_PAGE_ID,
  FAILED_PAGE_ID,
  DESIGNATED_STAGE_ID,
  computeDownstream,
  makeFreshPageStages,
  makeFreshProjectStages,
} from "./fixtures";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Callback for project-channel SSE events. Returns an unsubscribe fn. */
type ProjectSubscriber = (event: ProjectChannelEvent) => void;

/** Callback for per-page SSE events. Returns an unsubscribe fn. */
type PageSubscriber = (event: PageChannelEvent) => void;

export interface MockServer {
  // Project queries
  getProject(projectId: string): Project | undefined;
  getPipelineSnapshot(projectId: string): Promise<PipelineSnapshot>;

  // Page stage queries + mutations
  listPageStages(projectId: string, pageId: string): Promise<PageStageState[]>;
  runPageStage(
    projectId: string,
    pageId: string,
    stageId: string,
    opts?: Partial<StageRunRequest>,
  ): Promise<PageStageState>;

  // Project stage queries + mutations
  runProjectStage(
    projectId: string,
    stageId: string,
    opts?: Partial<StageRunRequest>,
  ): Promise<ProjectStageState>;

  // Page order
  reorderPages(projectId: string, newOrder: string[]): Promise<void>;
  getPageOrder(projectId: string): string[];

  // ---- Projects-list API (F3) -----------------------------------------------
  /** GET /api/projects — list all projects for the current user. */
  listProjects(): Promise<ProjectRecord[]>;

  /** GET /api/projects/:id/activity — recent activity entries. */
  fetchActivity(
    projectId: string,
    limit?: number,
  ): Promise<ActivityFeedResponse>;

  /** GET /api/projects/:id/attributes — full attribute record. */
  fetchAttributes(projectId: string): Promise<AttributeRecord>;

  /** PATCH /api/projects/:id/attributes/:section — update one section. */
  saveAttributes(
    projectId: string,
    section: AttributeSection,
    draft: Record<string, string>,
  ): Promise<AttributeRecord>;

  /** Execute a manage action (clean/archive/saveCopy/delete/restore). */
  runManageAction(
    projectId: string,
    action: ManageAction,
    step?: 1 | 2,
  ): Promise<ManageActionResult>;

  // SSE subscriptions
  subscribeProject(
    projectId: string,
    subscriber: ProjectSubscriber,
  ): () => void;
  subscribePage(
    projectId: string,
    pageId: string,
    subscriber: PageSubscriber,
  ): () => void;

  // ---- Stage settings API (F5 — §1.8) ----------------------------------------

  /**
   * GET .../pages/{idx0}/stages/{stage_id}/settings
   * Returns effective settings (override > saved default > registry default).
   */
  getStageSettings(
    projectId: string,
    stageId: string,
  ): Promise<Record<string, unknown>>;

  /**
   * PUT .../pages/{idx0}/stages/{stage_id}/settings
   * Saves a project override (not persisted as "my default").
   */
  putStageSettings(
    projectId: string,
    stageId: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;

  /**
   * POST .../stages/{stage_id}/settings/save-as-default
   * Persists the body as the project-level default for this stage.
   */
  saveStageSettingsAsDefault(
    projectId: string,
    stageId: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;

  /**
   * POST .../stages/{stage_id}/settings/revert
   * Deletes the override; reverts to saved default or registry default.
   */
  revertStageSettings(
    projectId: string,
    stageId: string,
  ): Promise<Record<string, unknown>>;

  /**
   * POST .../stages/{stage_id}/settings/reset
   * Deletes both override and saved default; reverts to registry default.
   */
  resetStageSettings(
    projectId: string,
    stageId: string,
  ): Promise<Record<string, unknown>>;

  // ---- Source stage API (F5.1) -----------------------------------------------

  /**
   * POST .../project-stages/source/confirm
   * Commits the page file set; returns { pages: N }.
   */
  confirmSourceSelection(
    projectId: string,
    files: { idx: number; state: string }[],
  ): Promise<{ pages: number }>;
  // ---- F5.3: OCR group — text_zones + ocr tool endpoints ------------------

  /**
   * GET /api/projects/:id/stages/text_zones/pages
   * Returns zone page rows + totals for the text_zones stage tool.
   */
  fetchZonePages(projectId: string): Promise<{
    rows: ZonePageRow[];
    totals: ZoneTotals;
  }>;

  /**
   * POST /api/projects/:id/stages/text_zones/pages/:pageId/split
   * Applies a column or row split, producing 2 sibling child pages.
   *
   * CRITICAL APPLY_SPLIT invariant:
   *   - Mutates the page set: 1 page → 2 sibling pages (new page_ids)
   *   - Fans staleness NARROW: page_order + canvas_map for each child
   *   - Does NOT stale: ocr (sibling DAG path)
   */
  applySplit(
    projectId: string,
    pageId: string,
    draft: SplitDraft,
  ): Promise<SplitResult>;

  /**
   * POST /api/projects/:id/stages/text_zones/pages/:pageId/detect
   * Re-runs layout detection for one page, returning detected zones.
   */
  redetectLayout(
    projectId: string,
    pageId: string,
    currentDraft: ZoneItem[] | null,
  ): Promise<{ zones: ZoneItem[] }>;

  /**
   * PUT /api/projects/:id/stages/text_zones/pages/:pageId/layout
   * Persists the zone draft (or dismissed split) for one page.
   */
  persistLayout(
    projectId: string,
    pageId: string,
    data: { zones?: ZoneItem[]; dismissed?: boolean },
  ): Promise<{ ok: boolean }>;

  /**
   * GET /api/projects/:id/stages/ocr/pages/:pageId/tokens
   * Returns low-confidence OCR tokens for one page.
   */
  fetchPageTokens(
    projectId: string,
    pageId: string,
  ): Promise<{ tokens: OcrToken[] }>;

  /**
   * POST /api/projects/:id/stages/text_zones/confirm
   * Confirms the text_zones stage, forwarding zones to OCR.
   */
  confirmTextZones(projectId: string): Promise<{ ok: boolean }>;

  /**
   * POST /api/projects/:id/stages/ocr/confirm
   * Confirms the OCR stage, forwarding results to Page order.
   */
  confirmOcr(projectId: string): Promise<{ ok: boolean }>;

  // ---- F5.5: Text group — wordcheck/scannocheck/hyphen_join/text_review/regex --

  /**
   * POST /api/projects/:id/stages/scannocheck/accept-dict
   * Auto-applies dictionary-suggested fixes; returns list of fixed suspect IDs.
   */
  acceptDictionaryFixes(projectId: string): Promise<{ fixedIds: string[] }>;

  /**
   * POST /api/projects/:id/stages/scannocheck/lists/accept-high
   * Accepts all high-confidence suspects into the good word list.
   */
  acceptHighConfidence(projectId: string): Promise<{ acceptedIds: string[] }>;

  /**
   * POST /api/projects/:id/stages/scannocheck/lists/promote
   * Promotes curated good/bad candidates into the project library.
   */
  promoteToLibrary(projectId: string): Promise<{
    good: number;
    bad: number;
    bookGood: number;
    bookBad: number;
    libraryGood: number;
    libraryBad: number;
  }>;

  /**
   * POST /api/projects/:id/stages/scannocheck/confirm
   * Confirms the scannocheck/wordcheck stage.
   */
  confirmWordcheck(projectId: string): Promise<{ ok: boolean }>;

  /**
   * POST /api/projects/:id/stages/hyphen_join/scan
   * Scans the book for hyphenation cases; returns { cases, totals }.
   */
  scanHyphenation(projectId: string): Promise<{
    cases: {
      caseId: string;
      kind: "auto" | "mismatch";
      head: string;
      tail: string;
      line: number;
      page: string;
      status:
        | "undecided"
        | "flagged"
        | "joined"
        | "crosspage"
        | "validated"
        | "mismatch";
      validated: boolean;
      conf: number;
      book: { inBody: boolean; joinedElsewhere: boolean; mismatch: boolean };
    }[];
    totals: {
      total: number;
      joined: number;
      validated: number;
      undecided: number;
      flagged: number;
      crosspage: number;
      mismatch: number;
      unvalidated: number;
    };
  }>;

  /**
   * POST /api/projects/:id/stages/text_review/approve-low-risk
   * Bulk-approves all low-risk items; returns their IDs.
   */
  approveLowRisk(projectId: string): Promise<{ approvedIds: string[] }>;

  /**
   * POST /api/projects/:id/stages/text_review/confirm
   * Confirms the text_review stage.
   */
  confirmTextReview(projectId: string): Promise<{ ok: boolean }>;

  /**
   * GET /api/projects/:id/stages/regex/rules
   * Returns the full rule set + current apply counts + snapshotId for rollback.
   */
  fetchRegexRules(projectId: string): Promise<{
    rules: {
      id: string;
      label: string;
      pattern: string;
      replacement: string;
      status: "applied" | "review" | "pending" | "disabled";
      matchCount: number;
      previewHunks?: { before: string; after: string; page: string }[];
    }[];
    counts: {
      applied: number;
      review: number;
      pending: number;
      disabled: number;
    };
    snapshotId: string | null;
  }>;

  /**
   * POST /api/projects/:id/stages/regex/rules/:ruleId/apply
   * Applies a single regex rule; returns the updated rule + counts.
   */
  applyRegexRule(
    projectId: string,
    ruleId: string,
  ): Promise<{
    rule: {
      id: string;
      label: string;
      pattern: string;
      replacement: string;
      status: "applied" | "review" | "pending" | "disabled";
      matchCount: number;
    };
    counts: {
      applied: number;
      review: number;
      pending: number;
      disabled: number;
    };
  }>;
  // ---- F5.6: Pack group tool endpoints ----------------------------------------

  /**
   * POST /api/projects/:id/stages/validation/run
   * -> { rules: ValidationRule[], counts: ValidationCounts }
   * Blocks build_package when blockerCount > 0.
   */
  runValidationChecks(projectId: string): Promise<{
    rules: PackValidationRule[];
    counts: PackValidationCounts;
  }>;

  /**
   * POST /api/projects/:id/stages/validation/waive
   * { ruleId, note } -> { ok }
   */
  waiveValidationRule(
    projectId: string,
    ruleId: string,
    note: string,
  ): Promise<{ ok: boolean }>;

  /**
   * POST /api/projects/:id/stages/proof_pack/assemble
   * -> { tree, completeness }
   * Gate: all page stages must be clean.
   */
  assembleProofPack(
    projectId: string,
    include: { images: boolean; text: boolean; illustrations: boolean },
  ): Promise<{
    tree: PackTreeRow[];
    completeness: { complete: number; total: number };
  }>;

  /**
   * POST /api/projects/:id/stages/build_package/build
   * -> { deliverable, manifest }
   * Gate: validation must have passed (no blockers).
   */
  buildPackageArtifacts(
    projectId: string,
    checksumAlgo: string,
  ): Promise<{
    deliverable: { files: PackTreeRow[]; count: number };
    manifest: PackManifest;
  }>;

  /**
   * POST /api/projects/:id/stages/submit_check/dry-run
   * -> SubmitCheckItem[]  (no upload)
   */
  dryRunSubmitCheck(projectId: string): Promise<SubmitCheckItem[]>;

  /**
   * POST /api/projects/:id/stages/submit_check/confirm
   * { gate: "submit_confirm" } -> { at: string }
   * Records manual attestation that the user uploaded the zip to their
   * dpscans folder on pgdp.net. There is no PGDP upload API; submission
   * is always a manual step.
   * CT 2026-06-11: replaces liveSubmit per manual attestation directive.
   */
  markAsSubmitted(projectId: string): Promise<{ at: string }>;

  /**
   * POST /api/projects/:id/stages/archive/run
   * -> { kept, dropped }
   * Terminal stage — cold storage handoff.
   */
  archiveProject(
    projectId: string,
    keepNames: string[],
    destination: string,
    retention: string,
  ): Promise<{ kept: string; dropped: string }>;
}

// ---- F5.6 pack group types --------------------------------------------------

export interface PackValidationRule {
  id: string;
  name: string;
  level: "pass" | "warn" | "error";
  detail: string;
  waiver?: string;
}

export interface PackValidationCounts {
  pass: number;
  warn: number;
  error: number;
}

export interface PackTreeRow {
  name: string;
  dir?: boolean;
  d?: number;
  meta?: string;
}

export interface PackManifest {
  project: string;
  pages: number;
  canvas: string;
  built: string;
  pipeline: string;
  files: number;
  sha256: string;
}

export interface SubmitCheckItem {
  ok: boolean;
  label: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a new isolated mock server instance with fresh mutable state.
 * Suitable for `beforeEach` test setup — no shared global state.
 */
export function createMockServer(): MockServer {
  // -------------------------------------------------------------------------
  // Mutable state (isolated per server instance)
  // -------------------------------------------------------------------------

  const project: Project = { ...MOCK_PROJECT };

  // page stage matrix: pageId → stageId → state
  const pageStages = makeFreshPageStages();

  // project stage map: stageId → state
  const projectStages = makeFreshProjectStages();

  // page ordering
  let pageOrder: string[] = [...MOCK_PAGE_IDS];

  // SSE subscribers
  const projectSubs = new Set<ProjectSubscriber>();
  const pageSubs = new Map<string, Set<PageSubscriber>>(); // key: `${projectId}:${pageId}`

  // Stage settings: override and saved-default layers (F5 §1.8)
  // key: `${projectId}:${stageId}`
  const stageSettingsOverrides = new Map<string, Record<string, unknown>>();
  const stageSettingsDefaults = new Map<string, Record<string, unknown>>();

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  function emitProject(event: ProjectChannelEvent): void {
    for (const sub of projectSubs) {
      sub(event);
    }
  }

  function emitPage(
    projectId: string,
    pageId: string,
    event: PageChannelEvent,
  ): void {
    const key = `${projectId}:${pageId}`;
    const subs = pageSubs.get(key);
    if (subs) {
      for (const sub of subs) {
        sub(event);
      }
    }
  }

  function getPageStage(
    pageId: string,
    stageId: string,
  ): PageStageState | undefined {
    return pageStages.get(pageId)?.get(stageId);
  }

  function setPageStage(
    pageId: string,
    stageId: string,
    state: PageStageState,
  ): void {
    pageStages.get(pageId)?.set(stageId, state);
  }

  /**
   * Mark all downstream page-scoped stage rows for a given page as dirty.
   * Project-scoped downstream stages are also marked dirty.
   *
   * All downstream stages are marked dirty regardless of their prior status.
   * This includes "not_run" stages — a dirty/stale mark on a not_run stage
   * signals that inputs have changed and it should be run fresh when ready.
   */
  function propagateStalePageStage(
    _projectId: string,
    pageId: string,
    fromStageId: string,
  ): void {
    const downstream = computeDownstream(fromStageId);
    const isProjectStageId = (
      s: string,
    ): s is (typeof PROJECT_STAGE_IDS)[number] =>
      PROJECT_STAGE_IDS.includes(s as (typeof PROJECT_STAGE_IDS)[number]);
    const isPageStageId = (s: string): s is (typeof PAGE_STAGE_IDS)[number] =>
      PAGE_STAGE_IDS.includes(s as (typeof PAGE_STAGE_IDS)[number]);

    for (const stageId of downstream) {
      if (isPageStageId(stageId)) {
        const state = getPageStage(pageId, stageId);
        if (state) {
          setPageStage(pageId, stageId, { ...state, status: "dirty" });
        }
      } else if (isProjectStageId(stageId)) {
        const state = projectStages.get(stageId);
        if (state) {
          projectStages.set(stageId, { ...state, status: "dirty" });
        }
      }
    }
  }

  /**
   * Mark all downstream project-scoped stages dirty (regardless of prior status).
   */
  function propagateStaleProjectStage(fromStageId: string): void {
    const downstream = computeDownstream(fromStageId);
    const isProjectStageId = (
      s: string,
    ): s is (typeof PROJECT_STAGE_IDS)[number] =>
      PROJECT_STAGE_IDS.includes(s as (typeof PROJECT_STAGE_IDS)[number]);

    for (const stageId of downstream) {
      if (isProjectStageId(stageId)) {
        const state = projectStages.get(stageId);
        if (state) {
          projectStages.set(stageId, { ...state, status: "dirty" });
        }
      }
    }
  }

  /** Compute PipelineSnapshot from current state. */
  function buildSnapshot(): PipelineSnapshot {
    // Aggregate page stages: for each stage_id, compute worst_status,
    // stale_count, flagged_count across all pages.
    const summaryMap = new Map<string, PageStageSummary>();
    for (const stageId of PAGE_STAGE_IDS) {
      summaryMap.set(stageId, {
        stage_id: stageId,
        worst_status: "not_run",
        stale_count: 0,
        flagged_count: 0,
      });
    }

    for (const pageId of MOCK_PAGE_IDS) {
      for (const stageId of PAGE_STAGE_IDS) {
        const state = getPageStage(pageId, stageId);
        if (!state) continue;
        const summary = summaryMap.get(stageId)!;

        if (state.status === "flagged") {
          summary.flagged_count += 1;
        }
        if (state.status === "dirty") {
          summary.stale_count += 1;
        }
        // worst_status priority: failed > dirty > flagged > running > clean > not_run
        summary.worst_status = worstStatus(summary.worst_status, state.status);
      }
    }

    return {
      project,
      page_stages_summary: Array.from(summaryMap.values()),
      project_stages: Array.from(projectStages.values()),
      automation: { ...MOCK_AUTOMATION },
    };
  }

  // Status priority ordering (higher index = worse)
  const STATUS_PRIORITY: PageStageStatus[] = [
    "not_run",
    "not_applicable",
    "clean",
    "running",
    "flagged",
    "dirty",
    "failed",
  ];

  function worstStatus(
    a: PageStageStatus,
    b: PageStageStatus,
  ): PageStageStatus {
    const ai = STATUS_PRIORITY.indexOf(a);
    const bi = STATUS_PRIORITY.indexOf(b);
    return ai >= bi ? a : b;
  }

  /** Determine outcome status for a page stage run. */
  function outcomeForPageRun(pageId: string, stageId: string): PageStageStatus {
    if (pageId === FLAGGED_PAGE_ID && stageId === DESIGNATED_STAGE_ID) {
      return "flagged";
    }
    if (pageId === FAILED_PAGE_ID && stageId === DESIGNATED_STAGE_ID) {
      return "failed";
    }
    return "clean";
  }

  // -------------------------------------------------------------------------
  // Public interface
  // -------------------------------------------------------------------------

  const server: MockServer = {
    getProject(_projectId) {
      return project;
    },

    async getPipelineSnapshot(_projectId) {
      return buildSnapshot();
    },

    async listPageStages(_projectId, pageId) {
      const row = pageStages.get(pageId);
      if (!row) return [];
      return Array.from(row.values());
    },

    async runPageStage(projectId, pageId, stageId, _opts?) {
      const current = getPageStage(pageId, stageId);
      if (!current) {
        throw new Error(`Unknown page stage: ${pageId}/${stageId}`);
      }

      // Emit running status
      const runningState: PageStageState = {
        ...current,
        status: "running",
        job_id: `job-${stageId}-${pageId}-running`,
      };
      setPageStage(pageId, stageId, runningState);
      emitPage(projectId, pageId, {
        type: "stage-status",
        stage_id: stageId,
        status: "running",
        job_id: runningState.job_id,
        error_message: null,
      });

      // Compute outcome
      const outcome = outcomeForPageRun(pageId, stageId);
      const finalState: PageStageState = {
        ...runningState,
        status: outcome,
        job_id: null,
        last_run_at: 1749513700, // deterministic timestamp
        duration_ms: 1200,
        artifact_key:
          outcome !== "failed"
            ? `projects/${project.id}/pages/${pageId}/stages/${stageId}/output.png`
            : null,
        error_message:
          outcome === "failed" ? `Mock failure for stage ${stageId}` : null,
      };
      setPageStage(pageId, stageId, finalState);

      // Emit final status
      emitPage(projectId, pageId, {
        type: "stage-status",
        stage_id: stageId,
        status: outcome,
        job_id: null,
        error_message: finalState.error_message,
      });

      // Propagate stale to downstream stages
      if (outcome !== "failed") {
        propagateStalePageStage(projectId, pageId, stageId);
      }

      return finalState;
    },

    async runProjectStage(_projectId, stageId, _opts?) {
      const current = projectStages.get(stageId);
      if (!current) {
        throw new Error(`Unknown project stage: ${stageId}`);
      }

      // Emit running
      const runningState: ProjectStageState = {
        ...current,
        status: "running",
        job_id: `job-proj-${stageId}-running`,
      };
      projectStages.set(stageId, runningState);
      emitProject({
        type: "project-stage-status",
        stage_id: stageId,
        status: "running",
        job_id: runningState.job_id,
        error_message: null,
      });

      // All project stages return clean in the mock
      const finalState: ProjectStageState = {
        ...runningState,
        status: "clean",
        job_id: null,
        last_run_at: 1749513800,
        duration_ms: 2500,
        artifact_key: `projects/${project.id}/stages/${stageId}/output.json`,
        error_message: null,
      };
      projectStages.set(stageId, finalState);

      emitProject({
        type: "project-stage-status",
        stage_id: stageId,
        status: "clean",
        job_id: null,
        error_message: null,
      });

      // Propagate stale
      propagateStaleProjectStage(stageId);

      // Special: if validation ran clean, emit validation-updated
      if (stageId === "validation") {
        emitProject({
          type: "validation-updated",
          blockers: 0,
          warnings: 0,
          status: "clean",
        });
      }

      return finalState;
    },

    async reorderPages(_projectId, newOrder) {
      pageOrder = [...newOrder];

      // Mark page_order project stage dirty (it was already set or not_run;
      // only transition if it had been run before, but mark dirty regardless
      // of prior status to flag that a reorder happened)
      const poState = projectStages.get("page_order");
      if (poState) {
        const updated: ProjectStageState = {
          ...poState,
          status: "dirty",
        };
        projectStages.set("page_order", updated);
      }

      // Propagate dirty to downstream project stages
      propagateStaleProjectStage("page_order");

      // Emit page-reorder event
      emitProject({
        type: "page-reorder",
        new_order: newOrder,
      });
    },

    getPageOrder(_projectId) {
      return [...pageOrder];
    },

    // ---- Projects-list API (F3 additions) -----------------------------------

    async listProjects() {
      // Deterministic mock: return 3 fixture projects with different statuses
      const records: ProjectRecord[] = [
        {
          id: project.id,
          title: project.title,
          author: "Mock Author",
          pages: project.page_count,
          totalStages: 23,
          currentStage: 10,
          status: "running",
          flagged: 0,
          archived: false,
          updatedRel: "just now",
          updatedAbs: "Jun 10, 09:00",
          created: "Jun 10, 2026",
          size: "12.4 MB",
          registry_version: project.registry_version,
        },
        {
          id: "proj-mock-archived",
          title: "Archived Book",
          author: "Past Author",
          pages: 218,
          totalStages: 23,
          currentStage: 22,
          status: "archived",
          archived: true,
          archivedOn: "May 02, 2026",
          updatedRel: "May 02",
          updatedAbs: "May 02, 11:45",
          created: "Apr 22, 2026",
          size: "15.2 MB",
          registry_version: 2,
        },
        {
          id: "proj-mock-ready",
          title: "Ready Book",
          author: "Ready Author",
          pages: 387,
          totalStages: 23,
          currentStage: 22,
          status: "ready",
          archived: false,
          updatedRel: "2h ago",
          updatedAbs: "Jun 10, 07:00",
          created: "Jun 01, 2026",
          size: "28.4 MB",
          registry_version: 2,
        },
      ];
      return records;
    },

    async fetchActivity(_projectId, limit = 3) {
      // Return deterministic activity entries
      const entries = [
        {
          id: "act-1",
          stage: "ocr",
          description: "completed · 12 pages · 6m 12s",
          at: "2026-06-10T08:00:00Z",
          kind: "stage" as const,
        },
        {
          id: "act-2",
          stage: "wordcheck",
          description: "4 dictionary mismatches",
          at: "2026-06-10T07:45:00Z",
          kind: "stage" as const,
        },
        {
          id: "act-3",
          stage: "grayscale",
          description: "completed · 12 pages",
          at: "2026-06-10T07:30:00Z",
          kind: "stage" as const,
        },
      ];
      return {
        entries: entries.slice(0, limit),
        totalCount: 12,
        commentCount: 3,
        stageCount: 9,
      };
    },

    async fetchAttributes(_projectId) {
      return {
        bib: {
          Title: project.title,
          Author: "Mock Author",
          Language: "English",
          "Original year": "1890",
          Edition: "First Edition",
          "Source archive": "archive.org · mock-book-1890",
        },
        pgdp: {
          "Project ID": project.id,
          Difficulty: "B1 · Beginners welcome",
          Genre: "Fiction",
          "Forum category": "Literature",
          Round: "P1 (initial proofread)",
          "Format version": "pgdp-format-2024.3",
        },
        fmt: {
          "Page format": "smooth-reading",
          Illustrations: "none",
          Footnotes: "none",
          "Word lists": "+ 0 custom",
          "Special chars": "—",
          "PG submission": "not yet",
        },
        comments: "No special comments.",
      };
    },

    async saveAttributes(_projectId, _section, _draft) {
      // Return the current attributes (mock: no-op save)
      return server.fetchAttributes(_projectId);
    },

    async runManageAction(projectId, action, step) {
      switch (action) {
        case "clean":
          return { action, reclaimedBytes: 1_620_000_000 };
        case "archive":
          return {
            action,
            status: "archived" as const,
            zippedSize: 24_800_000,
          };
        case "saveCopy":
          return {
            action,
            downloadUrl: `/api/projects/${projectId}/export/download`,
          };
        case "delete":
          if (step === 2) {
            return { action, deleted: true };
          }
          return {
            action,
            status: "archived" as const,
            zippedSize: 24_800_000,
          };
        case "restore":
          return { action, status: "queued" as const };
      }
    },

    subscribeProject(_projectId, subscriber) {
      projectSubs.add(subscriber);

      // Immediately emit project-snapshot (mirrors the on-connect SSE frame)
      const snapshot = buildSnapshot();
      subscriber({
        type: "project-snapshot",
        project_stages: snapshot.project_stages,
      });

      // Return unsubscribe function
      return () => {
        projectSubs.delete(subscriber);
      };
    },

    subscribePage(projectId, pageId, subscriber) {
      const key = `${projectId}:${pageId}`;
      let subs = pageSubs.get(key);
      if (!subs) {
        subs = new Set<PageSubscriber>();
        pageSubs.set(key, subs);
      }
      subs.add(subscriber);

      // Emit on-connect snapshot for this page
      const row = pageStages.get(pageId);
      if (row) {
        subscriber({
          type: "snapshot",
          stages: Array.from(row.values()),
        });
      }

      return () => {
        const s = pageSubs.get(key);
        if (s) {
          s.delete(subscriber);
        }
      };
    },

    // ---- Stage settings (F5 §1.8) -------------------------------------------

    async getStageSettings(_projectId, stageId) {
      // Registry defaults for known stages (empty dict = use built-in defaults)
      return (
        stageSettingsOverrides.get(`${_projectId}:${stageId}`) ??
        stageSettingsDefaults.get(`${_projectId}:${stageId}`) ??
        {}
      );
    },

    async putStageSettings(_projectId, stageId, body) {
      const key = `${_projectId}:${stageId}`;
      stageSettingsOverrides.set(key, { ...body });
      return server.getStageSettings(_projectId, stageId);
    },

    async saveStageSettingsAsDefault(_projectId, stageId, body) {
      const key = `${_projectId}:${stageId}`;
      stageSettingsDefaults.set(key, { ...body });
      stageSettingsOverrides.delete(key);
      return server.getStageSettings(_projectId, stageId);
    },

    async revertStageSettings(_projectId, stageId) {
      const key = `${_projectId}:${stageId}`;
      stageSettingsOverrides.delete(key);
      return server.getStageSettings(_projectId, stageId);
    },

    async resetStageSettings(_projectId, stageId) {
      const key = `${_projectId}:${stageId}`;
      stageSettingsOverrides.delete(key);
      stageSettingsDefaults.delete(key);
      return {};
    },

    // ---- Source stage API (F5.1) -------------------------------------------

    async confirmSourceSelection(_projectId, files) {
      const pages = files.filter(
        (f) => f.state === "page" || f.state === "inserted",
      ).length;
      // Mark the source project stage as clean
      const sourceState = projectStages.get("source");
      if (sourceState) {
        projectStages.set("source", {
          ...sourceState,
          status: "clean",
          last_run_at: 1749513900,
          duration_ms: 800,
        });
        emitProject({
          type: "project-stage-status",
          stage_id: "source",
          status: "clean",
          job_id: null,
          error_message: null,
        });
        // Propagate stale to downstream project stages
        propagateStaleProjectStage("source");
      }
      return { pages };
    },

    // ---- F5.3: OCR group tool endpoints -------------------------------------

    async fetchZonePages(_projectId) {
      // Deterministic fixture: 3 pages with zone data
      const [pid0, pid1, pid2] = [
        MOCK_PAGE_IDS[0] ?? "page-0001",
        MOCK_PAGE_IDS[1] ?? "page-0002",
        MOCK_PAGE_IDS[2] ?? "page-0003",
      ];
      const rows: ZonePageRow[] = [
        {
          idx: pid0,
          prefix: "p0001",
          state: "flagged",
          flags: ["splitSuggested"],
          zones: 4,
          lines: 42,
          words: 310,
          pageNumber: 1,
          layoutKind: "double",
          split: { axis: "col", into: 2, gutter: 0.49, conf: 0.92 },
        },
        {
          idx: pid1,
          prefix: "p0002",
          state: "clean",
          zones: 3,
          lines: 38,
          words: 285,
          pageNumber: 2,
          layoutKind: "single",
        },
        {
          idx: pid2,
          prefix: "p0003",
          state: "flagged",
          flags: ["mergedBlocks"],
          zones: 5,
          lines: 44,
          words: 330,
          pageNumber: 3,
          layoutKind: "single",
        },
      ];
      const totals: ZoneTotals = {
        total: rows.length,
        done: rows.length,
        clean: rows.filter((r) => r.state === "clean").length,
        flagged: rows.filter((r) => r.state === "flagged").length,
        reviewed: 0,
        splits: rows.filter((r) => (r.flags ?? []).includes("splitSuggested"))
          .length,
      };
      return { rows, totals };
    },

    async applySplit(_projectId, pageId, draft) {
      /**
       * APPLY_SPLIT — critical page-set mutation.
       *
       * Narrow stale fan-out:
       *   page_order → dirty (new pages change sequence)
       *   canvas_map for each child page → dirty (crop-edge margins)
       *   ocr → NOT dirty (sibling DAG path)
       *
       * The server returns parentRow (state:'split') + 2 child rows.
       * The shell (pipelineShell) must receive PAGE_SET_CHANGED and mark
       * page_order + canvas_map(children) dirty; ocr is NOT staled.
       */

      // Produce deterministic child IDs
      const childAId = `${pageId}-split-a`;
      const childBId = `${pageId}-split-b`;

      // Add child pages to the page stage matrix
      // Both children need canvas_map re-run (stale); ocr is NOT touched.
      for (const childId of [childAId, childBId]) {
        const freshStages = makeFreshPageStages();
        const templatePageId = MOCK_PAGE_IDS[0] ?? pageId;
        const childRow = freshStages.get(templatePageId); // template from first page
        if (childRow) {
          // Canvas_map is dirty for child pages (narrow stale)
          const canvasMapState = childRow.get("canvas_map");
          if (canvasMapState) {
            childRow.set("canvas_map", { ...canvasMapState, status: "dirty" });
          }
          // OCR is NOT staled (sibling DAG path)
          pageStages.set(childId, childRow);
        }
      }

      // Mark page_order as dirty (sequence changed)
      const poState = projectStages.get("page_order");
      if (poState) {
        projectStages.set("page_order", { ...poState, status: "dirty" });
      }

      const parentRow: ZonePageRow = {
        idx: pageId,
        prefix: `p${pageId}`,
        state: "split",
        layoutKind: draft.axis === "col" ? "double" : "stacked",
        split: { ...draft, applied: true },
      };

      const childRows: [ZonePageRow, ZonePageRow] = [
        {
          idx: childAId,
          prefix: `p${pageId}a`,
          state: "clean",
          zones: 3,
          lines: 22,
          words: 160,
          layoutKind: "single",
        },
        {
          idx: childBId,
          prefix: `p${pageId}b`,
          state: "clean",
          zones: 2,
          lines: 20,
          words: 150,
          layoutKind: "single",
        },
      ];

      // Emit page-reorder event so the shell re-keys the page set
      const updatedOrder = [...pageOrder];
      const parentIdx = updatedOrder.indexOf(pageId);
      if (parentIdx !== -1) {
        updatedOrder.splice(parentIdx, 1, childAId, childBId);
        pageOrder = updatedOrder;
      }

      emitProject({
        type: "page-reorder",
        new_order: pageOrder,
      });

      return { parentRow, childRows };
    },

    async redetectLayout(_projectId, _pageId, _currentDraft) {
      // Return a minimal schematic zone set
      const zones: ZoneItem[] = [
        {
          id: "z1",
          type: "body",
          x: 0.08,
          y: 0.08,
          w: 0.84,
          h: 0.68,
          order: 1,
        },
        {
          id: "z2",
          type: "footer",
          x: 0.08,
          y: 0.84,
          w: 0.84,
          h: 0.08,
          order: null,
        },
      ];
      return { zones };
    },

    async persistLayout(_projectId, _pageId, _data) {
      // No-op at F5; marks page_stage row as clean at I1
      return { ok: true };
    },

    async fetchPageTokens(_projectId, _pageId) {
      // Deterministic low-conf token fixture
      const tokens: OcrToken[] = [
        { id: "t1", word: "tbe", suggest: "the", conf: 0.71 },
        { id: "t2", word: "ligbt", suggest: "light", conf: 0.64 },
        { id: "t3", word: "ond", suggest: "and", conf: 0.68 },
        { id: "t4", word: "Wben", suggest: "When", conf: 0.73 },
      ];
      return { tokens };
    },

    async confirmTextZones(_projectId) {
      return { ok: true };
    },

    async confirmOcr(_projectId) {
      return { ok: true };
    },

    // ---- F5.5: Text group -------------------------------------------------------

    async acceptDictionaryFixes(_projectId) {
      return { fixedIds: ["s1"] };
    },

    async acceptHighConfidence(_projectId) {
      return { acceptedIds: ["s2"] };
    },

    async promoteToLibrary(_projectId) {
      return {
        good: 3,
        bad: 1,
        bookGood: 3,
        bookBad: 1,
        libraryGood: 12,
        libraryBad: 4,
      };
    },

    async confirmWordcheck(_projectId) {
      return { ok: true };
    },

    async scanHyphenation(_projectId) {
      return {
        cases: [
          {
            caseId: "hc1",
            kind: "auto" as const,
            head: "house",
            tail: "hold",
            line: 22,
            page: "p0004",
            status: "undecided" as const,
            validated: false,
            conf: 0.88,
            book: { inBody: true, joinedElsewhere: true, mismatch: false },
          },
          {
            caseId: "hc2",
            kind: "auto" as const,
            head: "break",
            tail: "fast",
            line: 7,
            page: "p0005",
            status: "joined" as const,
            validated: false,
            conf: 0.91,
            book: { inBody: true, joinedElsewhere: false, mismatch: false },
          },
          {
            caseId: "hc3",
            kind: "mismatch" as const,
            head: "over",
            tail: "coat",
            line: 14,
            page: "p0006",
            status: "mismatch" as const,
            validated: false,
            conf: 0.77,
            book: { inBody: false, joinedElsewhere: true, mismatch: true },
          },
        ],
        totals: {
          total: 3,
          joined: 1,
          validated: 0,
          undecided: 1,
          flagged: 0,
          crosspage: 0,
          mismatch: 1,
          unvalidated: 1,
        },
      };
    },

    async approveLowRisk(_projectId) {
      return { approvedIds: ["qi1", "qi2"] };
    },

    async confirmTextReview(_projectId) {
      return { ok: true };
    },

    async fetchRegexRules(_projectId) {
      return {
        rules: [
          {
            id: "r1",
            label: "Fix 'tbe' → 'the'",
            pattern: "\\btbe\\b",
            replacement: "the",
            status: "applied" as const,
            matchCount: 12,
          },
          {
            id: "r2",
            label: "Fix 'arid' → 'and'",
            pattern: "\\barid\\b",
            replacement: "and",
            status: "review" as const,
            matchCount: 4,
            previewHunks: [
              { before: "land arid sea", after: "land and sea", page: "p0003" },
            ],
          },
          {
            id: "r3",
            label: "Smart-quote fix",
            pattern: '"',
            replacement: "“",
            status: "pending" as const,
            matchCount: 0,
          },
        ],
        counts: { applied: 1, review: 1, pending: 1, disabled: 0 },
        snapshotId: "snap-001",
      };
    },

    async applyRegexRule(_projectId, ruleId) {
      return {
        rule: {
          id: ruleId,
          label: "Applied rule",
          pattern: ".*",
          replacement: "",
          status: "applied" as const,
          matchCount: 5,
        },
        counts: { applied: 2, review: 0, pending: 1, disabled: 0 },
      };
    },

    // ---- F5.6: Pack group tool endpoints ----------------------------------------

    async runValidationChecks(_projectId) {
      const rules: PackValidationRule[] = [
        {
          id: "r-image-res",
          name: "Image resolution",
          level: "pass",
          detail: "All 12 pages meet minimum 300 dpi requirement.",
        },
        {
          id: "r-utf8",
          name: "Text encoding",
          level: "pass",
          detail: "All OCR output files are valid UTF-8.",
        },
        {
          id: "r-missing-ocr",
          name: "OCR coverage",
          level: "warn",
          detail:
            "Page p0003 has low OCR confidence (0.64 avg). Review recommended.",
        },
        {
          id: "r-page-count",
          name: "Page count parity",
          level: "error",
          detail:
            "Image count (12) does not match OCR file count (11). One text file missing.",
        },
        {
          id: "r-filename",
          name: "Filename conventions",
          level: "pass",
          detail: "All files follow pgdp_{title}_{nnn}.png convention.",
        },
      ];
      const counts: PackValidationCounts = {
        pass: rules.filter((r) => r.level === "pass").length,
        warn: rules.filter((r) => r.level === "warn").length,
        error: rules.filter((r) => r.level === "error").length,
      };
      return { rules, counts };
    },

    async waiveValidationRule(_projectId, ruleId, note) {
      // The mock simply accepts the waiver — the machine patches counts client-side
      // A real server would persist the waiver record.
      void ruleId;
      void note;
      return { ok: true };
    },

    async assembleProofPack(_projectId, _include) {
      const tree: PackTreeRow[] = [
        { name: "images/", dir: true, d: 0 },
        { name: "pgdp_title_001.png", d: 1, meta: "300 dpi · 2.1 MB" },
        { name: "pgdp_title_002.png", d: 1, meta: "300 dpi · 1.9 MB" },
        { name: "pgdp_title_003.png", d: 1, meta: "300 dpi · 2.3 MB" },
        { name: "text/", dir: true, d: 0 },
        { name: "pgdp_title_001.txt", d: 1, meta: "1.4 kB" },
        { name: "pgdp_title_002.txt", d: 1, meta: "1.2 kB" },
        { name: "pgdp_title_003.txt", d: 1, meta: "1.6 kB" },
        { name: "illustrations/", dir: true, d: 0 },
        { name: "illus_001.png", d: 1, meta: "72 dpi · 0.4 MB" },
      ];
      return {
        tree,
        completeness: { complete: 10, total: 12 },
      };
    },

    async buildPackageArtifacts(_projectId, _checksumAlgo) {
      const files: PackTreeRow[] = [
        { name: "pgdp_submission/", dir: true, d: 0 },
        { name: "images/", dir: true, d: 1 },
        { name: "pgdp_title_001.png", d: 2, meta: "300 dpi" },
        { name: "pgdp_title_002.png", d: 2, meta: "300 dpi" },
        { name: "pgdp_title_003.png", d: 2, meta: "300 dpi" },
        { name: "text/", dir: true, d: 1 },
        { name: "pgdp_title_001.txt", d: 2, meta: "UTF-8" },
        { name: "pgdp_title_002.txt", d: 2, meta: "UTF-8" },
        { name: "pgdp_title_003.txt", d: 2, meta: "UTF-8" },
        { name: "manifest.json", d: 1, meta: "SHA-256 verified" },
        { name: "metadata.xml", d: 1, meta: "Dublin Core" },
      ];
      const manifest: PackManifest = {
        project: "mock-project-001",
        pages: 12,
        canvas: "300dpi",
        built: new Date().toISOString(),
        pipeline: "v2.0.0",
        files: 11,
        sha256:
          "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
      };
      return { deliverable: { files, count: 11 }, manifest };
    },

    async dryRunSubmitCheck(_projectId) {
      const checks: SubmitCheckItem[] = [
        { ok: true, label: "Project ID registered at pgdp.net" },
        {
          ok: true,
          label: "Image count matches pgdp.net expectation (12 pages)",
        },
        { ok: true, label: "ZIP integrity — no corrupt entries" },
        { ok: true, label: "Manifest SHA-256 verified" },
        { ok: true, label: "Package size within 500 MB limit (42 MB)" },
      ];
      return checks;
    },

    async markAsSubmitted(_projectId) {
      // Records manual attestation that the user uploaded the zip to their
      // dpscans folder on pgdp.net. No actual upload occurs here.
      return { at: new Date().toISOString() };
    },

    async archiveProject(_projectId, keepNames, _destination, _retention) {
      const dropped = DEFAULT_ARCHIVE_ITEMS_LIST.filter(
        (n) => !keepNames.includes(n),
      );
      return {
        kept: `${keepNames.length} items`,
        dropped: `${dropped.length} items`,
      };
    },
  };

  return server;
}

// Matches ArchiveTool DEFAULT_ARCHIVE_ITEMS names (used by archiveProject mock)
const DEFAULT_ARCHIVE_ITEMS_LIST = [
  "final-zip",
  "source-images",
  "ocr-text",
  "manifest",
  "activity-log",
  "temp-files",
];
