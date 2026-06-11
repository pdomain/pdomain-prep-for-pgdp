/**
 * projects.ts — Real service implementations for ProjectsPage machines.
 *
 * Implements:
 *   - RailListServices / ProjectDetailServices (fetchProjects)
 *   - RecentActivityServices (fetchRecentActivity)
 *   - AttributesPanelServices (fetchAttributes, saveAttributes)
 *   - ManageActionsServices (runManageAction)
 *
 * ## ProjectRecord adapter
 *
 * The backend returns `Project` objects (snake_case, backend lifecycle status).
 * The frontend machines expect `ProjectRecord` (view-model with computed fields).
 * `adaptProject` bridges the two shapes.
 *
 * Backend ProjectStatus:  ingesting | configuring | processing | reviewing | packaging | complete
 * Frontend ProjectLifecycleStatus: queued | running | review | ready | submitted | error | archived
 *
 * @see frontend/src/machines/projects/railList.ts
 * @see frontend/src/machines/projects/recentActivity.ts
 * @see frontend/src/machines/projects/attributesPanel.ts
 * @see frontend/src/machines/projects/manageActions.ts
 * @see frontend/src/mocks/types.ts — ProjectRecord, ActivityFeedResponse, etc.
 */

import { api } from "@/api/client";
import type { RailListServices } from "@/machines/projects/railList";
import type { RecentActivityServices } from "@/machines/projects/recentActivity";
import type {
  AttributesPanelServices,
  AttributeSection,
} from "@/machines/projects/attributesPanel";
import type { ManageActionsServices } from "@/machines/projects/manageActions";
import type {
  ProjectRecord,
  ActivityFeedResponse,
  AttributeRecord,
  ManageAction,
  ManageActionResult,
  ProjectLifecycleStatus,
} from "@/mocks/types";

// ---------------------------------------------------------------------------
// Backend Project shape (from /api/data/projects)
// ---------------------------------------------------------------------------

interface BackendProject {
  id: string;
  name: string;
  owner_id: string;
  created_at: string; // ISO datetime
  updated_at: string; // ISO datetime
  status:
    | "ingesting"
    | "configuring"
    | "processing"
    | "reviewing"
    | "packaging"
    | "complete";
  page_count: number;
  proof_page_count: number;
  archived: boolean;
  stage_artifacts_bytes: number;
  source_zip_bytes: number;
  registry_version: number;
  config: {
    book_name?: string;
    author?: string;
    [key: string]: unknown;
  };
}

// ---------------------------------------------------------------------------
// Project adapter: BackendProject → ProjectRecord
// ---------------------------------------------------------------------------

/** Map backend ProjectStatus to frontend ProjectLifecycleStatus. */
function mapStatus(
  backendStatus: BackendProject["status"],
  archived: boolean,
): ProjectLifecycleStatus {
  if (archived) return "archived";
  switch (backendStatus) {
    case "ingesting":
      return "queued";
    case "configuring":
      return "queued";
    case "processing":
      return "running";
    case "reviewing":
      return "review";
    case "packaging":
      return "running";
    case "complete":
      return "ready";
    default:
      return "queued";
  }
}

/** Format bytes to a human-readable size string. */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Format a datetime string to a relative string like "2h ago", "May 02". */
function formatDateRel(iso: string): string {
  try {
    const dt = new Date(iso);
    const now = Date.now();
    const diffMs = now - dt.getTime();
    const diffMins = Math.floor(diffMs / 60_000);
    if (diffMins < 2) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    const diffDays = Math.floor(diffHrs / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    // Fall through to absolute format
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

/** Format a datetime string to an absolute display string like "Jun 10, 09:00". */
function formatDateAbs(iso: string): string {
  try {
    const dt = new Date(iso);
    return dt.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

/** Adapt a backend Project to the frontend ProjectRecord view-model. */
export function adaptProject(p: BackendProject): ProjectRecord {
  const totalBytes = p.stage_artifacts_bytes + p.source_zip_bytes;
  const base: ProjectRecord = {
    id: p.id,
    title: p.name,
    author: p.config.author ?? "—",
    pages: p.page_count,
    totalStages: 23, // fixed: 23 runner stages (24 stages minus source)
    currentStage: 0, // computed from stage progress — simplified at I1
    status: mapStatus(p.status, p.archived),
    archived: p.archived,
    updatedRel: formatDateRel(p.updated_at),
    updatedAbs: formatDateAbs(p.updated_at),
    created: formatDateAbs(p.created_at),
    size: formatBytes(totalBytes),
    registry_version: p.registry_version,
  };
  // Only set archivedOn when archived (exactOptionalPropertyTypes: omit rather than undefined)
  if (p.archived) {
    base.archivedOn = formatDateAbs(p.updated_at);
  }
  return base;
}

// ---------------------------------------------------------------------------
// fetchProjects — shared by RailListServices and ProjectDetailServices
// ---------------------------------------------------------------------------

/**
 * Fetch all projects for the current user.
 * GET /api/data/projects?include_archived=true
 *
 * Returns ProjectRecord[] (adapted from backend Project[]).
 */
export async function fetchProjects(): Promise<ProjectRecord[]> {
  const backendProjects = await api.get<BackendProject[]>(
    "/api/data/projects?include_archived=true",
  );
  return backendProjects.map(adaptProject);
}

// ---------------------------------------------------------------------------
// RecentActivityServices
// ---------------------------------------------------------------------------

interface BackendActivityEntry {
  id: string;
  event_type: string;
  stage_id?: string | null;
  description?: string | null;
  created_at: string;
}

/**
 * Fetch recent activity for a project.
 *
 * Route: GET /api/data/projects/{id}/activity (W4 Group 4 — real route).
 * Returns the project event log as an ActivityFeedResponse.
 * Falls back to an empty feed on error (e.g. while the project is initialising).
 */
export async function fetchRecentActivity(
  projectId: string,
  limit = 10,
): Promise<ActivityFeedResponse> {
  try {
    const entries = await api.get<BackendActivityEntry[]>(
      `/api/data/projects/${encodeURIComponent(projectId)}/activity?limit=${limit}`,
    );
    return {
      entries: entries.map((e) => ({
        id: e.id,
        stage: e.stage_id ?? e.event_type,
        description: e.description ?? e.event_type,
        at: e.created_at,
        kind: "stage" as const,
      })),
      totalCount: entries.length,
      commentCount: 0,
      stageCount: entries.length,
    };
  } catch {
    // Route not yet implemented — return empty feed rather than error.
    return { entries: [], totalCount: 0, commentCount: 0, stageCount: 0 };
  }
}

// ---------------------------------------------------------------------------
// AttributesPanelServices
// ---------------------------------------------------------------------------

/**
 * Fetch project attributes.
 *
 * Route: GET /api/data/projects/{id}/attributes (W4 Group 4 — real route).
 * Returns bib/pgdp/fmt fields from the project config.
 * Falls back to deriving from the project record when the attributes route
 * returns an error (e.g. legacy projects without stored attributes).
 */
export async function fetchAttributes(
  projectId: string,
): Promise<AttributeRecord> {
  try {
    const attrs = await api.get<AttributeRecord>(
      `/api/data/projects/${encodeURIComponent(projectId)}/attributes`,
    );
    return attrs;
  } catch {
    // Derive from project config on 404/not-implemented.
    try {
      const project = await api.get<BackendProject>(
        `/api/data/projects/${encodeURIComponent(projectId)}`,
      );
      return {
        bib: {
          Title: project.name,
          Author: project.config.author ?? "—",
        },
        pgdp: {
          "Project ID": project.id,
        },
        fmt: {},
        comments: "",
      };
    } catch {
      return { bib: {}, pgdp: {}, fmt: {}, comments: "" };
    }
  }
}

/**
 * Save one section of project attributes.
 *
 * Route: PATCH /api/data/projects/{id}/attributes/{section}
 * W4 Group 4 — real route.
 */
export async function saveAttributes(
  projectId: string,
  section: AttributeSection,
  draft: Record<string, string>,
): Promise<AttributeRecord> {
  try {
    const result = await api.patch<AttributeRecord>(
      `/api/data/projects/${encodeURIComponent(projectId)}/attributes/${encodeURIComponent(section)}`,
      draft,
    );
    return result;
  } catch {
    // Fallback: return current attributes on error.
    return fetchAttributes(projectId);
  }
}

// ---------------------------------------------------------------------------
// ManageActionsServices
// ---------------------------------------------------------------------------

/**
 * Run a manage action against the real API.
 *
 * Maps to backend routes:
 *   clean    → POST /api/data/projects/{id}/clean (W4 Group 4)
 *   archive  → POST /api/data/projects/{id}/archive
 *   restore  → POST /api/data/projects/{id}/unarchive
 *   saveCopy → POST /api/data/projects/{id}/export (W4 Group 4)
 *   delete   → DELETE /api/data/projects/{id}
 */
export async function runManageAction(
  projectId: string,
  action: ManageAction,
  step?: 1 | 2,
): Promise<ManageActionResult> {
  switch (action) {
    case "archive":
      await api.post(
        `/api/data/projects/${encodeURIComponent(projectId)}/archive`,
      );
      return { action, status: "archived" };
    case "restore":
      await api.post(
        `/api/data/projects/${encodeURIComponent(projectId)}/unarchive`,
      );
      return { action, status: "queued" };
    case "delete":
      if (step === 2) {
        await api.delete(`/api/data/projects/${encodeURIComponent(projectId)}`);
        return { action, deleted: true };
      }
      // Step 1: archive first (confirm gate)
      await api.post(
        `/api/data/projects/${encodeURIComponent(projectId)}/archive`,
      );
      return { action, status: "archived" };
    case "clean": {
      const cleanResult = await api.post<{ reclaimed_bytes: number }>(
        `/api/data/projects/${encodeURIComponent(projectId)}/clean`,
      );
      return { action, reclaimedBytes: cleanResult.reclaimed_bytes ?? 0 };
    }
    case "saveCopy": {
      await api.post(
        `/api/data/projects/${encodeURIComponent(projectId)}/export`,
      );
      return { action };
    }
  }
}

// ---------------------------------------------------------------------------
// Exported factory functions
// ---------------------------------------------------------------------------

/** Build real RailListServices. */
export function buildRealRailListServices(): RailListServices {
  return { fetchProjects };
}

/** Build real ProjectDetailServices (same fetchProjects). */
export function buildRealProjectDetailServices(): {
  fetchProjects: () => Promise<ProjectRecord[]>;
} {
  return { fetchProjects };
}

/**
 * Build real RecentActivityServices.
 * @internal — Wired to RecentActivityPanel at I2.
 */
export function buildRealRecentActivityServices(): RecentActivityServices {
  return { fetchRecentActivity };
}

/**
 * Build real AttributesPanelServices.
 * @internal — Wired to AttributesPanel at I2.
 */
export function buildRealAttributesPanelServices(): AttributesPanelServices {
  return { fetchAttributes, saveAttributes };
}

/** Build real ManageActionsServices. */
export function buildRealManageActionsServices(): ManageActionsServices {
  return { runManageAction };
}
