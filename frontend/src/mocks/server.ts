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
  };

  return server;
}
