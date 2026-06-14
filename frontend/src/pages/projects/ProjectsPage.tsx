/**
 * ProjectsPage — F3 projects surface.
 *
 * 320px left rail (project list with Active/Archived tabs + search + sort)
 * wired to projectDetail machine for the right pane (activity / attributes /
 * manage tabs).
 *
 * DCArtboard states covered (fixture tests in ProjectsPage.test.tsx):
 *   - loading   — booting state, spinner
 *   - error     — loadError state, retry button
 *   - empty     — empty-state hero (no projects)
 *   - active    — active project selected, activity tab
 *   - archived  — archived project selected, manage tab
 *   - attributes — attributes tab
 *   - manage    — manage tab (active project)
 */
import JSZip from "jszip";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useActor } from "@xstate/react";
import { createActor } from "xstate";
import { api } from "@/api/client";
import type { components } from "@/api/types.gen";
import {
  buildRealRailListServices,
  buildRealProjectDetailServices,
  buildRealManageActionsServices,
  buildRealRecentActivityServices,
  buildRealAttributesPanelServices,
} from "@/services/projects";
import { FormErrorBanner } from "@/components/FormErrorBanner";
import { Badge, type BadgeStatus } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/AlertDialog";
import { PageHeader } from "@/components/shell/PageHeader";
import type {
  ProjectRecord,
  ProjectLifecycleStatus,
  ManageAction,
  ManageActionResult,
  ActivityEntry,
  AttributeRecord,
  AttributeSection,
} from "@/mocks/types";
import {
  railListMachine,
  type RailListServices,
} from "@/machines/projects/railList";
import {
  projectDetailMachine,
  type ProjectDetailServices,
} from "@/machines/projects/projectDetail";
import {
  manageActionsMachine,
  type ManageActionsServices,
} from "@/machines/projects/manageActions";
import {
  recentActivityMachine,
  type RecentActivityServices,
} from "@/machines/projects/recentActivity";
import {
  attributesPanelMachine,
  type AttributesPanelServices,
} from "@/machines/projects/attributesPanel";
import { ProjectsEmpty } from "./ProjectsEmpty";
import type { StateValue } from "xstate";

type CreateProjectRequest = components["schemas"]["CreateProjectRequest"];
type CreateProjectResponse = components["schemas"]["CreateProjectResponse"];

// ---------------------------------------------------------------------------
// Status → Badge mapping
// ---------------------------------------------------------------------------

function toBadgeStatus(
  status: ProjectLifecycleStatus,
  archived?: boolean,
): BadgeStatus {
  if (archived) return "cancelled";
  switch (status) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "review":
      return "awaiting_review";
    case "ready":
      return "complete";
    case "submitted":
      return "scheduled";
    case "error":
      return "error";
    case "archived":
      return "cancelled";
    default:
      return "queued";
  }
}

function statusLabel(
  status: ProjectLifecycleStatus,
  archived?: boolean,
): string {
  if (archived) return "archived";
  return status;
}

// ---------------------------------------------------------------------------
// Helper: extract tab from parallel state value
// ---------------------------------------------------------------------------

type DetailTab = "activity" | "attributes" | "manage";

function extractTab(stateValue: StateValue): DetailTab {
  if (typeof stateValue !== "object") return "activity";
  const readyVal = (stateValue as Record<string, StateValue>)["ready"];
  if (!readyVal || typeof readyVal !== "object") return "activity";
  const tabVal = (readyVal as Record<string, StateValue>)["tab"];
  if (tabVal === "activity" || tabVal === "attributes" || tabVal === "manage") {
    return tabVal;
  }
  return "activity";
}

// ---------------------------------------------------------------------------
// CoverPlaceholder — author initials with chroma-stable hue
// ---------------------------------------------------------------------------

function CoverPlaceholder({
  author,
  size = 56,
}: {
  author: string;
  size?: number;
}) {
  const initials = author
    .split(" ")
    .map((w) => w[0] ?? "")
    .slice(0, 2)
    .join("");
  const hue = author.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <div
      data-testid="cover-placeholder"
      style={{
        width: size,
        height: size * 1.35,
        borderRadius: 4,
        background: `linear-gradient(160deg, oklch(0.62 0.07 ${hue}), oklch(0.42 0.06 ${(hue + 30) % 360}))`,
        color: "rgba(255,255,255,0.92)",
        flexShrink: 0,
        display: "grid",
        placeItems: "center",
        fontWeight: 600,
        fontSize: size * 0.28,
        letterSpacing: "0.04em",
      }}
    >
      {initials}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PipelineMini — 23-dot progress strip
// ---------------------------------------------------------------------------

function PipelineMini({
  total = 23,
  current,
  status,
}: {
  total?: number;
  current: number;
  status: ProjectLifecycleStatus;
}) {
  const color =
    status === "error"
      ? "var(--status-error)"
      : status === "running"
        ? "var(--status-running)"
        : status === "review"
          ? "var(--status-review)"
          : "var(--status-done)";
  return (
    <div
      data-testid="pipeline-mini"
      style={{ display: "flex", alignItems: "center", gap: 2, height: 8 }}
    >
      {Array.from({ length: total }).map((_, i) => {
        const done = i < current;
        const here = i === current;
        return (
          <span
            key={i}
            className={here && status === "running" ? "pgd-pulse" : undefined}
            style={{
              width: here ? 8 : 6,
              height: here ? 8 : 6,
              borderRadius: 99,
              background:
                done || here
                  ? color
                  : "color-mix(in srgb, currentColor 20%, transparent)",
              opacity: done && !here ? 0.7 : 1,
              display: "inline-block",
            }}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProjectsPage — main surface
// ---------------------------------------------------------------------------

/** Services injected into the page at mount time (wired via QueryClient in prod). */
export interface ProjectsPageServices {
  rail: RailListServices;
  detail: ProjectDetailServices;
  manage: ManageActionsServices;
  activity: RecentActivityServices;
  attributes: AttributesPanelServices;
}

export function ProjectsPage({
  services,
}: {
  services?: ProjectsPageServices;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);

  // Build services from real v2 API if not injected (production path).
  const resolvedServices = useMemo<ProjectsPageServices>(() => {
    if (services) return services;
    void queryClient; // available for cache invalidation at I2
    return {
      rail: buildRealRailListServices(),
      detail: buildRealProjectDetailServices(),
      manage: buildRealManageActionsServices(),
      activity: buildRealRecentActivityServices(),
      attributes: buildRealAttributesPanelServices(),
    };
  }, [services, queryClient]);

  const [detailSnap, detailSend] = useActor(projectDetailMachine, {
    input: {
      services: resolvedServices.detail,
      onOpenProject: (projectId) => {
        void navigate(`/projects/${projectId}`);
      },
      onOpenActivityLog: (projectId) => {
        void navigate(`/projects/${projectId}/activity`);
      },
      onRespawnActivity: (_projectId) => {
        // Child actor lifecycle delegated to component layer (F3-4 divergence)
      },
      onRespawnAttributes: (_projectId) => {},
      onRespawnManage: (_projectId, _isArchived) => {},
      onRefreshRail: () => {
        railSend({ type: "PROJECTS_CHANGED" });
      },
    },
  });

  const onSelect = useCallback(
    (id: string) => {
      detailSend({ type: "SELECT", id });
    },
    [detailSend],
  );

  const [railSnap, railSend] = useActor(railListMachine, {
    input: {
      services: resolvedServices.rail,
      onSelect,
    },
  });

  // ---------------------------------------------------------------------------
  // Loading / error states
  // ---------------------------------------------------------------------------

  if (detailSnap.matches("booting")) {
    return (
      <section
        className="flex flex-col"
        data-testid="projects-page"
        data-screen-label="Projects"
      >
        <PageHeader title="Projects" />
        <div
          className="flex flex-1 items-center justify-center p-12 text-ink-3"
          data-testid="projects-loading"
        >
          Loading…
        </div>
      </section>
    );
  }

  if (detailSnap.matches("loadError")) {
    return (
      <section
        className="flex flex-col"
        data-testid="projects-page"
        data-screen-label="Projects"
      >
        <PageHeader title="Projects" />
        <div
          className="flex flex-1 flex-col items-center justify-center gap-4 p-12"
          data-testid="projects-error"
        >
          <p className="text-status-error">Failed to load projects.</p>
          <Button
            data-testid="projects-retry"
            onClick={() => detailSend({ type: "RETRY" })}
          >
            Retry
          </Button>
        </div>
      </section>
    );
  }

  if (detailSnap.matches("empty")) {
    return (
      <section
        className="flex flex-col"
        data-testid="projects-page"
        data-screen-label="Projects"
      >
        <ProjectsEmpty onNewProject={() => setShowCreate(true)} />
        <CreateProjectModal
          open={showCreate}
          onClose={() => setShowCreate(false)}
          onCreated={(projectId) => {
            void navigate(`/projects/${projectId}/import`);
          }}
          onRailRefresh={() => railSend({ type: "PROJECTS_CHANGED" })}
        />
      </section>
    );
  }

  // ---------------------------------------------------------------------------
  // Ready state — split pane
  // ---------------------------------------------------------------------------

  const selected = detailSnap.context.selected;
  const activeTab = extractTab(detailSnap.value);
  const { railTab, visible, counts, query } = railSnap.context;

  return (
    <section
      className="flex flex-col"
      data-testid="projects-page"
      data-screen-label="Projects"
    >
      <PageHeader
        title="Projects"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              data-testid="sort-btn"
              onClick={() =>
                railSend({
                  type: "SET_SORT",
                  sort: railSnap.context.sort === "recent" ? "title" : "recent",
                })
              }
            >
              Sort: {railSnap.context.sort === "recent" ? "Recent" : "Title"}
            </Button>
            <input
              data-testid="projects-search"
              type="search"
              value={query}
              placeholder="Filter projects…"
              className="h-7 w-52 rounded border border-border-2 bg-bg-sunk px-2 text-xs text-ink-2 placeholder:text-ink-4"
              onChange={(e) =>
                e.target.value === ""
                  ? railSend({ type: "CLEAR_SEARCH" })
                  : railSend({ type: "SEARCH_INPUT", value: e.target.value })
              }
            />
          </div>
        }
      />

      <div
        className="flex flex-1 overflow-hidden"
        style={{ display: "grid", gridTemplateColumns: "320px 1fr" }}
      >
        {/* ── Left rail ── */}
        <div
          className="flex flex-col border-r border-border-1 bg-bg-surface"
          data-testid="projects-rail"
        >
          {/* New project button */}
          <div className="p-4 pb-3">
            <Button
              variant="primary"
              className="w-full"
              data-testid="new-project-btn"
              onClick={() => setShowCreate(true)}
            >
              New project
            </Button>
          </div>

          {/* Summary */}
          {(() => {
            const all = railSnap.context.all ?? [];
            const totalPages = all.reduce((sum, p) => sum + (p.pages ?? 0), 0);
            return (
              <div className="px-4 pb-2 font-mono text-[11px] text-ink-3">
                <div>
                  {counts.active + counts.archived} projects ·{" "}
                  {totalPages.toLocaleString()} pages
                </div>
              </div>
            );
          })()}

          {/* Active / Archived tabs */}
          <div
            className="flex gap-1 px-3 pb-2"
            role="tablist"
            aria-label="Project filter"
            data-testid="rail-tabs"
          >
            {(
              [
                { id: "active", label: "Active", count: counts.active },
                {
                  id: "archived",
                  label: "Archived",
                  count: counts.archived,
                },
              ] as const
            ).map((t) => {
              const on = railTab === t.id;
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={on}
                  data-testid={`rail-tab-${t.id}`}
                  onClick={() => railSend({ type: "SET_RAIL_TAB", tab: t.id })}
                  className={`flex flex-1 h-7 items-center justify-center gap-1.5 rounded-md border text-xs font-medium ${
                    on
                      ? "border-border-2 bg-bg-raised text-ink-1"
                      : "border-transparent text-ink-3"
                  }`}
                >
                  {t.label}
                  <span
                    className={`rounded px-1 py-0.5 text-[10px] font-mono ${
                      on ? "bg-accent/15 text-accent" : "bg-bg-sunk text-ink-4"
                    }`}
                  >
                    {t.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Project rows */}
          <div
            className="flex-1 overflow-auto border-t border-border-1"
            data-testid="projects-list"
          >
            {railSnap.matches("loading") && (
              <div className="p-4 text-center text-xs text-ink-4">Loading…</div>
            )}
            {railSnap.matches("error") && (
              <div className="flex flex-col items-center gap-2 p-4">
                <p className="text-xs text-status-error">
                  Failed to load list.
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="rail-retry"
                  onClick={() => railSend({ type: "RETRY" })}
                >
                  Retry
                </Button>
              </div>
            )}
            {(railSnap.matches("ready") ||
              railSnap.matches({ ready: "idle" }) ||
              railSnap.matches({ ready: "debouncing" })) &&
              visible.map((p) => {
                const isSel = railSnap.context.selectedId === p.id;
                const bStatus = toBadgeStatus(p.status, p.archived);
                const label = statusLabel(p.status, p.archived);
                return (
                  <button
                    key={p.id}
                    data-testid={`project-row-${p.id}`}
                    aria-pressed={isSel}
                    onClick={() => {
                      railSend({ type: "SELECT", id: p.id });
                      detailSend({ type: "SELECT", id: p.id });
                    }}
                    className={`w-full cursor-pointer px-4 py-2.5 text-left flex flex-col gap-1 border-l-2 ${
                      isSel
                        ? "border-accent bg-bg-raised"
                        : "border-transparent hover:bg-bg-raised/50"
                    } ${p.archived ? "opacity-90" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`truncate text-[13px] ${
                          isSel ? "font-semibold" : "font-medium"
                        } ${p.archived ? "text-ink-2" : "text-ink-1"}`}
                      >
                        {p.title}
                      </span>
                      <Badge status={bStatus}>{label}</Badge>
                    </div>
                    <div className="flex items-center gap-1.5 font-mono text-[10.5px] text-ink-4">
                      <span>{p.id}</span>
                      <span className="text-border-2">·</span>
                      <span>{p.pages}p</span>
                      <span className="text-border-2">·</span>
                      <span>{p.size}</span>
                      <span className="flex-1" />
                      <span>
                        {p.archived
                          ? `archived ${p.archivedOn?.split(",")[0] ?? ""}`
                          : p.updatedRel}
                      </span>
                    </div>
                  </button>
                );
              })}
            {(railSnap.matches("ready") ||
              railSnap.matches({ ready: "idle" })) &&
              visible.length === 0 && (
                <div
                  className="p-8 text-center text-xs text-ink-4"
                  data-testid="rail-empty"
                >
                  No {railTab} projects.
                </div>
              )}
          </div>
        </div>

        {/* ── Right pane ── */}
        <div
          className="flex flex-col overflow-auto"
          data-testid="projects-detail"
        >
          {!selected ? (
            <div
              className="flex flex-1 items-center justify-center p-12 text-ink-4"
              data-testid="projects-no-selection"
            >
              Select a project
            </div>
          ) : (
            <ProjectDetailPane
              project={selected}
              tab={activeTab}
              onTabChange={(t) => detailSend({ type: "SET_TAB", tab: t })}
              onOpenProject={() => detailSend({ type: "OPEN_PROJECT" })}
              manageServices={resolvedServices.manage}
              activityServices={resolvedServices.activity}
              attributesServices={resolvedServices.attributes}
              onProjectMutated={() => {
                railSend({ type: "PROJECTS_CHANGED" });
                detailSend({ type: "PROJECTS_CHANGED" });
              }}
            />
          )}
        </div>
      </div>

      <CreateProjectModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(projectId) => {
          void navigate(`/projects/${projectId}/import`);
        }}
        onRailRefresh={() => railSend({ type: "PROJECTS_CHANGED" })}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// ProjectDetailPane — right pane content
// ---------------------------------------------------------------------------

function ProjectDetailPane({
  project,
  tab,
  onTabChange,
  onOpenProject,
  manageServices,
  activityServices,
  attributesServices,
  onProjectMutated,
}: {
  project: ProjectRecord;
  tab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  onOpenProject: () => void;
  manageServices: ManageActionsServices;
  activityServices: RecentActivityServices;
  attributesServices: AttributesPanelServices;
  onProjectMutated: () => void;
}) {
  const s = toBadgeStatus(project.status, project.archived);
  const label = statusLabel(project.status, project.archived);
  const pct = Math.round((project.currentStage / project.totalStages) * 100);

  // Derive current stage name for pipeline strip (page-scoped stages 0-15, project-scoped 16-23)
  const PAGE_STAGE_NAMES = [
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
  const PROJECT_STAGE_NAMES = [
    "source",
    "page_order",
    "validation",
    "proof_pack",
    "build_package",
    "zip",
    "submit_check",
    "archive",
  ] as const;
  const ALL_STAGE_NAMES = [
    ...PAGE_STAGE_NAMES,
    ...PROJECT_STAGE_NAMES,
  ] as readonly string[];
  const currentStageName =
    ALL_STAGE_NAMES[project.currentStage] ?? `stage_${project.currentStage}`;

  return (
    <div className="p-8" data-testid="detail-pane">
      {/* Header */}
      <div className="flex items-start gap-5" data-testid="detail-header">
        <CoverPlaceholder author={project.author} size={88} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2.5">
            <h1
              className="text-2xl font-semibold tracking-tight text-ink-1"
              data-testid="detail-title"
            >
              {project.title}
            </h1>
            <Badge status={s} data-testid="detail-status-badge">
              {label}
            </Badge>
          </div>
          <p className="mt-1 text-[13px] text-ink-3">
            {project.author} · <span className="font-mono">{project.id}</span>
          </p>
        </div>
        <Button
          variant="primary"
          data-testid="open-project-btn"
          onClick={onOpenProject}
        >
          {project.archived ? "Open (read-only)" : "Open project"}
        </Button>
      </div>

      {/* Stats grid — 6 tiles separated by 1px gaps (bg-border-1 bleeds through) */}
      <div
        className="mt-6 grid grid-cols-6 overflow-hidden rounded-lg border border-border-1 bg-border-1"
        data-testid="detail-stats"
        style={{ gap: 1 }}
      >
        {/* PAGES */}
        <div className="bg-bg-surface px-3.5 py-3.5">
          <div className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-ink-3">
            pages
          </div>
          <div
            className="mt-1.5 font-mono text-lg font-semibold text-ink-1"
            data-testid="stat-pages"
          >
            {project.pages}
          </div>
        </div>
        {/* ON DISK */}
        <div className="bg-bg-surface px-3.5 py-3.5">
          <div className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-ink-3">
            on disk
          </div>
          <div
            className="mt-1.5 font-mono text-lg font-semibold text-ink-1"
            data-testid="stat-on-disk"
          >
            {project.size}
          </div>
        </div>
        {/* FLAGGED */}
        <div className="bg-bg-surface px-3.5 py-3.5">
          <div className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-ink-3">
            flagged
          </div>
          <div
            className={`mt-1.5 font-mono text-lg font-semibold ${project.flagged ? "text-status-review" : "text-ink-2"}`}
            data-testid="stat-flagged"
          >
            {project.flagged != null ? project.flagged : "—"}
          </div>
          {project.flagged ? (
            <div className="mt-0.5 font-mono text-[10.5px] text-ink-4">
              awaiting review
            </div>
          ) : (
            <div className="mt-0.5 font-mono text-[10.5px] text-ink-4">
              none
            </div>
          )}
        </div>
        {/* PROGRESS */}
        <div className="bg-bg-surface px-3.5 py-3.5">
          <div className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-ink-3">
            progress
          </div>
          <div
            className="mt-1.5 font-mono text-lg font-semibold text-ink-1"
            data-testid="stat-progress"
          >
            {pct}%
          </div>
          <div className="mt-0.5 font-mono text-[10.5px] text-ink-4">
            {project.currentStage + 1}/{project.totalStages} stages
          </div>
        </div>
        {/* CREATED */}
        <div className="bg-bg-surface px-3.5 py-3.5">
          <div className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-ink-3">
            created
          </div>
          <div
            className="mt-1.5 font-mono text-lg font-semibold text-ink-2"
            data-testid="stat-created"
          >
            {/* Show "May 18" style — strip year from absolute date */}
            {project.created.replace(/,?\s*\d{4}$/, "")}
          </div>
          <div className="mt-0.5 font-mono text-[10.5px] text-ink-4">
            {/\d{4}$/.exec(project.created)?.[0] ?? ""}
          </div>
        </div>
        {/* UPDATED */}
        <div className="bg-bg-surface px-3.5 py-3.5">
          <div className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-ink-3">
            updated
          </div>
          <div
            className="mt-1.5 font-mono text-lg font-semibold text-ink-2"
            data-testid="stat-updated"
          >
            {project.updatedRel}
          </div>
          {/* Extract HH:MM from updatedAbs which is now "Jun 10, 14:00" format */}
          <div className="mt-0.5 font-mono text-[10.5px] text-ink-4">
            {(() => {
              const parts = project.updatedAbs.split(", ");
              const timePart = parts[1] ?? "";
              // Only show if it looks like HH:MM (not a year)
              return /^\d{2}:\d{2}$/.test(timePart) ? timePart : "";
            })()}
          </div>
        </div>
      </div>

      {/* Pipeline strip */}
      <div className="mt-6" data-testid="detail-pipeline">
        <div className="mb-2 text-[9.5px] font-bold uppercase tracking-[0.1em] text-ink-3">
          Pipeline
        </div>
        <div className="rounded-lg border border-border-1 bg-bg-surface px-4 py-3.5">
          <PipelineMini
            total={project.totalStages}
            current={project.currentStage}
            status={project.status}
          />
          <div className="mt-2.5 flex justify-between font-mono text-[11.5px] text-ink-3">
            <span>
              stage {project.currentStage + 1}/{project.totalStages}
              {project.archived ? " · final" : ` · ${currentStageName}`}
            </span>
            <span
              className={project.flagged ? "text-status-review" : "text-ink-4"}
            >
              {project.flagged ? `${project.flagged} pages flagged · ` : ""}
              {project.archived ? `archived` : ""}
            </span>
          </div>
        </div>
      </div>

      {/* Tab strip */}
      <div className="mt-7" data-comment-anchor="projects-detail-tabs">
        <div
          className="flex items-center gap-1 border-b border-border-1"
          role="tablist"
          aria-label="Project detail"
          data-testid="detail-tabs"
        >
          {(
            [
              { id: "activity", label: "Recent activity", count: "last 3" },
              { id: "attributes", label: "Attributes", count: null },
              { id: "manage", label: "Manage", count: null },
            ] as const
          ).map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                data-testid={`tab-${t.id}`}
                onClick={() => onTabChange(t.id)}
                className={`relative flex items-center gap-2 px-3.5 py-2.5 text-[12.5px] font-medium ${
                  active ? "text-ink-1" : "text-ink-3"
                }`}
              >
                {t.label}
                {t.count ? (
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                      active
                        ? "bg-accent/15 text-accent"
                        : "bg-bg-raised text-ink-3"
                    }`}
                  >
                    {t.count}
                  </span>
                ) : null}
                {active && (
                  <span className="absolute bottom-[-1px] left-2.5 right-2.5 h-0.5 rounded-t bg-accent" />
                )}
              </button>
            );
          })}
          <span className="flex-1" />
          {tab === "activity" && (
            <button
              data-testid="view-all-activity-btn"
              disabled
              title="Coming soon"
              className="flex cursor-not-allowed items-center gap-1 px-2.5 py-1.5 text-[11.5px] text-ink-4 opacity-50"
            >
              View all activity →
            </button>
          )}
        </div>

        {/* Tab panels */}
        {tab === "activity" && (
          <ActivityTabPanel project={project} services={activityServices} />
        )}
        {tab === "attributes" && (
          <AttributesTabPanel project={project} services={attributesServices} />
        )}
        {tab === "manage" && (
          <ManageTabPanel
            project={project}
            services={manageServices}
            onProjectMutated={onProjectMutated}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity tab panel — wired to recentActivityMachine
// ---------------------------------------------------------------------------

/**
 * Format an ISO timestamp as "May 21, 18:30" style for display in the activity log.
 */
function formatActivityTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const month = d.toLocaleString("en-US", { month: "short" });
    const day = d.getDate();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${month} ${day}, ${hh}:${mm}`;
  } catch {
    return iso;
  }
}

function ActivityTabPanel({
  project,
  services,
}: {
  project: ProjectRecord;
  services: RecentActivityServices;
}) {
  // Spawn the recentActivity machine as a local actor, keyed to project.id.
  // Re-create when project changes.
  const [activityEntries, setActivityEntries] = useState<ActivityEntry[]>([]);
  const [activityTotal, setActivityTotal] = useState(0);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState<string | null>(null);

  // Use the recentActivity machine via createActor so we get the full
  // machine lifecycle without mounting another hook at the component boundary.
  // Key on project.id so switching projects resets the actor.
  useEffect(() => {
    setActivityLoading(true);
    setActivityError(null);
    setActivityEntries([]);
    setActivityTotal(0);

    const actor = createActor(recentActivityMachine, {
      input: {
        projectId: project.id,
        services,
      },
    });

    const sub = actor.subscribe((snapshot) => {
      const ctx = snapshot.context;
      if (snapshot.matches("loading")) {
        setActivityLoading(true);
        setActivityError(null);
      } else if (snapshot.matches("error")) {
        setActivityLoading(false);
        setActivityError(ctx.error ?? "Failed to load activity");
      } else if (snapshot.matches("loaded")) {
        setActivityLoading(false);
        setActivityError(null);
        setActivityEntries(ctx.entries);
        setActivityTotal(ctx.totalCount);
      }
    });

    actor.start();
    actor.send({ type: "LOAD", projectId: project.id });

    return () => {
      sub.unsubscribe();
      actor.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  return (
    <div
      className="mt-3 rounded-lg border border-border-1 bg-bg-surface"
      data-testid="activity-panel"
      style={{ padding: "4px 0" }}
    >
      {activityLoading && (
        <div className="px-4 py-3 font-mono text-[11px] text-ink-4">
          Loading activity…
        </div>
      )}

      {activityError && !activityLoading && (
        <div className="px-4 py-3 text-xs text-status-error">
          {activityError}
        </div>
      )}

      {!activityLoading && !activityError && activityEntries.length === 0 && (
        <div className="px-4 py-3 font-mono text-[11px] text-ink-4">
          No activity recorded yet.
        </div>
      )}

      {!activityLoading &&
        activityEntries.map((entry, i) => (
          <div
            key={entry.id}
            className="grid items-center border-t border-border-1 px-4 py-2.5"
            style={{
              gridTemplateColumns: "120px 1fr 140px",
              gap: 12,
              borderTopWidth: i === 0 ? 0 : 1,
            }}
          >
            <span className="font-mono text-[11.5px] font-semibold text-ink-2">
              {entry.stage}
            </span>
            <span className="text-[12px] text-ink-3">{entry.description}</span>
            <span className="text-right font-mono text-[11px] text-ink-4">
              {formatActivityTime(entry.at)}
            </span>
          </div>
        ))}

      {/* Footer */}
      <div
        className="flex items-center justify-between border-t border-border-1 px-4 py-2.5"
        style={{ borderTopWidth: activityEntries.length > 0 ? 1 : 0 }}
      >
        <span className="font-mono text-[11px] text-ink-4">
          {activityTotal > activityEntries.length
            ? `+ ${activityTotal - activityEntries.length} earlier entries`
            : activityTotal > 0
              ? `${activityTotal} entries`
              : "—"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          data-testid="open-activity-log-btn"
          disabled
          title="Coming soon"
        >
          Open activity log →
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attributes tab panel — wired to attributesPanelMachine
// ---------------------------------------------------------------------------

const SECTION_LABELS: Record<AttributeSection, string> = {
  bib: "Bibliographic",
  pgdp: "PGDP project",
  fmt: "Format & content",
  comments: "Project comments (to proofreaders)",
};

function AttributesTabPanel({
  project,
  services,
}: {
  project: ProjectRecord;
  services: AttributesPanelServices;
}) {
  // Local state driven by the attributesPanel machine
  const [attrFields, setAttrFields] = useState<AttributeRecord | null>(null);
  const [attrOpen, setAttrOpen] = useState<Record<AttributeSection, boolean>>({
    bib: true,
    pgdp: true,
    fmt: true,
    comments: true,
  });
  const [attrLoading, setAttrLoading] = useState(true);
  const [attrError, setAttrError] = useState<string | null>(null);

  useEffect(() => {
    setAttrLoading(true);
    setAttrError(null);
    setAttrFields(null);

    const actor = createActor(attributesPanelMachine, {
      input: { projectId: project.id, services },
    });

    const sub = actor.subscribe((snapshot) => {
      const ctx = snapshot.context;
      if (snapshot.matches("loading")) {
        setAttrLoading(true);
        setAttrError(null);
      } else if (snapshot.matches("loadError")) {
        setAttrLoading(false);
        setAttrError(ctx.error ?? "Failed to load attributes");
      } else if (snapshot.matches("viewing")) {
        setAttrLoading(false);
        setAttrError(null);
        setAttrFields(ctx.fields);
        setAttrOpen({ ...ctx.open });
      }
    });

    actor.start();

    return () => {
      sub.unsubscribe();
      actor.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const toggleSection = (section: AttributeSection) => {
    setAttrOpen((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  if (attrLoading) {
    return (
      <div
        className="mt-3 rounded-lg border border-border-1 bg-bg-surface px-4 py-3"
        data-testid="attributes-panel"
      >
        <span className="font-mono text-[11px] text-ink-4">
          Loading attributes…
        </span>
      </div>
    );
  }

  if (attrError) {
    return (
      <div
        className="mt-3 rounded-lg border border-border-1 bg-bg-surface px-4 py-3"
        data-testid="attributes-panel"
      >
        <span className="text-xs text-status-error">{attrError}</span>
      </div>
    );
  }

  // Sections: bib/pgdp/fmt as field maps, comments as single string
  const sections: AttributeSection[] = ["bib", "pgdp", "fmt", "comments"];

  return (
    <div
      className="mt-3"
      data-testid="attributes-panel"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
        gap: 12,
      }}
    >
      {sections.map((section) => {
        const isOpen = attrOpen[section];
        const sectionLabel = SECTION_LABELS[section];

        let fieldEntries: [string, string][] = [];
        if (attrFields) {
          if (section === "comments") {
            // comments is a string, shown as body text
          } else {
            const raw = attrFields[section] as
              | Record<string, string>
              | undefined;
            if (raw) fieldEntries = Object.entries(raw);
          }
        }

        return (
          <div
            key={section}
            className="overflow-hidden rounded-lg border border-border-1 bg-bg-surface"
            style={{
              gridColumn: section === "comments" ? "1 / -1" : undefined,
              alignSelf: "start",
            }}
          >
            {/* Collapse header */}
            <button
              type="button"
              onClick={() => toggleSection(section)}
              className="flex w-full cursor-pointer items-center justify-between border-b border-border-1 bg-bg-page px-3.5 py-2.5"
              style={{ borderBottomWidth: isOpen ? 1 : 0 }}
            >
              <span className="flex items-center gap-2">
                <span
                  style={{
                    display: "inline-flex",
                    transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)",
                    transition: "transform 0.15s",
                    color: "var(--ink-3)",
                  }}
                >
                  <svg
                    width={12}
                    height={12}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </span>
                <span className="text-[12px] font-medium text-ink-2">
                  {sectionLabel}
                </span>
                <span className="font-mono text-[10.5px] text-ink-4">
                  {section === "comments"
                    ? ""
                    : `${fieldEntries.length} fields`}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                }}
                data-testid={`attr-edit-btn-${section}`}
              >
                Edit
              </Button>
            </button>

            {/* Body */}
            {isOpen && (
              <div>
                {section === "comments" ? (
                  <div className="px-4 py-3.5 text-[12.5px] leading-relaxed text-ink-2">
                    {attrFields?.comments || (
                      <span className="text-ink-4">No project comments.</span>
                    )}
                  </div>
                ) : (
                  fieldEntries.map(([key, val], i) => (
                    <div
                      key={key}
                      className="grid items-baseline px-3.5 py-2.5"
                      style={{
                        gridTemplateColumns: "170px 1fr",
                        gap: 12,
                        borderTop:
                          i === 0 ? "none" : "1px solid var(--border-1)",
                      }}
                    >
                      <span className="text-[12px] text-ink-3">{key}</span>
                      <span className="text-[12.5px] font-medium text-ink-1">
                        {val}
                      </span>
                    </div>
                  ))
                )}
                {section !== "comments" && fieldEntries.length === 0 && (
                  <div className="px-4 py-3 font-mono text-[11px] text-ink-4">
                    No {SECTION_LABELS[section].toLowerCase()} data.
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Manage tab panel — wired to manageActions machine
// ---------------------------------------------------------------------------

function ManageTabPanel({
  project,
  services,
  onProjectMutated,
}: {
  project: ProjectRecord;
  services: ManageActionsServices;
  onProjectMutated: () => void;
}) {
  const [manageSnap, manageSend] = useActor(manageActionsMachine, {
    input: {
      projectId: project.id,
      isArchived: project.archived ?? false,
      services,
      onMutated: (_action: ManageAction, _result: ManageActionResult) => {
        onProjectMutated();
      },
    },
  });

  // Acknowledge checkbox ref for the danger-confirm dialog
  const ackRef = useRef<HTMLInputElement>(null);

  const isConfirming =
    manageSnap.matches("confirming") ||
    manageSnap.matches({ confirmingDanger: "armed" }) ||
    manageSnap.matches({ confirmingDanger: "ready" });
  const isDangerConfirm =
    manageSnap.matches({ confirmingDanger: "armed" }) ||
    manageSnap.matches({ confirmingDanger: "ready" });
  const isArmed = manageSnap.matches({ confirmingDanger: "armed" });
  const isReady = manageSnap.matches({ confirmingDanger: "ready" });
  const isExecuting = manageSnap.matches("executing");
  const isDone = manageSnap.matches("done");
  const isFailed = manageSnap.matches("failed");

  // Dialog open: any of the confirm/danger/executing/done/failed states
  const dialogOpen = isConfirming || isExecuting || isDone || isFailed;

  // Confirm button enabled: non-danger confirming OR danger+ready
  const confirmEnabled =
    (manageSnap.matches("confirming") || (isDangerConfirm && isReady)) &&
    !isExecuting;

  // Pending action label for dialog copy
  const pendingAction = manageSnap.context.pendingAction;

  function pendingActionCopy(): { title: string; body: string } {
    switch (pendingAction) {
      case "clean":
        return {
          title: "Clean intermediate artifacts?",
          body: "Stage outputs that can be re-derived will be deleted. The project remains intact.",
        };
      case "archive":
        return {
          title: "Archive this project?",
          body: "The project will be zipped and marked read-only. You can restore it later.",
        };
      case "restore":
        return {
          title: "Restore this project?",
          body: "The project will be unarchived and made editable again.",
        };
      case "delete":
        if (manageSnap.context._step === 2) {
          return {
            title: "Delete project permanently?",
            body: `This will remove all pages, OCR output, and pipeline state for "${project.title}". This cannot be undone.`,
          };
        }
        return {
          title: "Delete project?",
          body: `Step 1 of 2: "${project.title}" will be archived (zipped, read-only). Run delete again from the Archived tab to remove permanently.`,
        };
      default:
        return { title: "Confirm action", body: "" };
    }
  }

  const { title: dialogTitle, body: dialogBody } = pendingActionCopy();

  return (
    <div
      className="mt-3 rounded-lg border border-border-1 bg-bg-surface"
      data-testid="manage-panel"
    >
      {/* Active project actions */}
      {!project.archived && (
        <>
          <ManageRow
            id="clean"
            label="Clean intermediate artifacts"
            desc="Drop stage outputs that can be re-derived automatically (crops, OCR, dewarped images). Final package is preserved."
            meta="reclaim artifacts"
            onAction={() => manageSend({ type: "CLEAN" })}
          />
          <ManageRow
            id="archive"
            label="Archive project"
            desc="Zip the project in place and mark it read-only. Stays in this list under Archived."
            meta="→ stays here"
            onAction={() => manageSend({ type: "ARCHIVE" })}
          />
          <ManageRow
            id="saveCopy"
            label="Save a copy…"
            desc="Download a zip of the full project to a different location. The original remains untouched."
            meta="choose destination"
            comingSoon
            onAction={() => {}} // no-op until export route exists
          />
          <ManageRow
            id="delete"
            label="Delete project"
            desc="Cleans intermediate artifacts and archives the project. Run delete again from the archived state to remove it permanently."
            meta="step 1 of 2 · → archived"
            twoStep
            buttonLabel="Delete…"
            onAction={() => manageSend({ type: "DELETE" })}
          />
        </>
      )}

      {/* Archived project actions */}
      {project.archived && (
        <>
          <ManageRow
            id="restore"
            label="Restore project"
            desc="Unarchive and make the project editable again. Intermediate artifacts will be regenerated on demand."
            meta="unzip in place"
            onAction={() => manageSend({ type: "RESTORE" })}
          />
          <ManageRow
            id="saveCopy"
            label="Save a copy…"
            desc="Download the archived zip to a different location. The original archive remains here."
            meta={`${project.size} · choose destination`}
            onAction={() => manageSend({ type: "SAVE_COPY" })}
          />
          <ManageRow
            id="delete"
            label="Delete project"
            desc="Permanently remove everything: pages, settings, package, and history. Only archived projects can be deleted."
            meta="cannot be undone"
            danger
            buttonLabel="Delete permanently"
            onAction={() => manageSend({ type: "DELETE" })}
          />
        </>
      )}

      {/* Executing / done / failed inline notice */}
      {isExecuting && (
        <div className="border-t border-border-1 px-4 py-3 text-xs text-ink-3">
          Working…
        </div>
      )}
      {isDone && (
        <div className="border-t border-border-1 px-4 py-3 text-xs text-ink-2">
          Done.{" "}
          <button
            className="text-accent underline"
            onClick={() => manageSend({ type: "DISMISS" })}
          >
            Dismiss
          </button>
        </div>
      )}
      {isFailed && (
        <div className="border-t border-border-1 px-4 py-3 text-xs text-status-error">
          {manageSnap.context.error ?? "Action failed."}{" "}
          <button
            className="text-accent underline"
            onClick={() => manageSend({ type: "RETRY" })}
          >
            Retry
          </button>
        </div>
      )}

      {/* Confirm / danger-confirm dialog */}
      <AlertDialog
        open={dialogOpen && !isExecuting && !isDone && !isFailed}
        onOpenChange={(open) => {
          if (!open) manageSend({ type: "CANCEL" });
        }}
        data-testid="delete-confirm-dialog"
      >
        <AlertDialogContent>
          <AlertDialogTitle>{dialogTitle}</AlertDialogTitle>
          <AlertDialogDescription>{dialogBody}</AlertDialogDescription>

          {/* Danger-gate: checkbox acknowledge step (armed sub-state only) */}
          {isDangerConfirm && (
            <div className="flex items-center gap-2 py-2">
              <input
                ref={ackRef}
                id="delete-ack-checkbox"
                type="checkbox"
                data-testid="delete-acknowledge"
                checked={!isArmed}
                disabled={isReady}
                onChange={() => {
                  if (isArmed) manageSend({ type: "ACKNOWLEDGE" });
                }}
                className="h-4 w-4 rounded border border-border-2"
              />
              <label
                htmlFor="delete-ack-checkbox"
                className="text-sm text-ink-2"
              >
                I understand this cannot be undone.
              </label>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <AlertDialogCancel asChild>
              <Button
                variant="outline"
                size="sm"
                data-testid="delete-cancel-btn"
                onClick={() => manageSend({ type: "CANCEL" })}
              >
                Cancel
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant={isDangerConfirm ? "danger" : "outline"}
                size="sm"
                data-testid="delete-confirm-btn"
                disabled={!confirmEnabled}
                onClick={() => manageSend({ type: "CONFIRM" })}
              >
                {isDangerConfirm ? "Delete permanently" : "Confirm"}
              </Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Inline SVG icons for the manage action tiles */
function ManageActionIcon({
  id,
  danger,
  twoStep,
}: {
  id: ManageAction;
  danger?: boolean;
  twoStep?: boolean;
}) {
  const iconColor = danger
    ? "var(--status-error)"
    : twoStep
      ? "var(--status-review)"
      : "var(--ink-2)";
  const bgColor = danger
    ? "color-mix(in oklab, var(--status-error) 10%, transparent)"
    : twoStep
      ? "color-mix(in oklab, var(--status-review) 12%, transparent)"
      : "var(--bg-raised)";

  // Simple inline SVG icons matching lucide style
  const path: Record<ManageAction, string> = {
    clean: "M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm0 6v4l3 3",
    archive:
      "M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z",
    saveCopy: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
    delete:
      "M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
    restore:
      "M1 4v6h6M23 20v-6h-6M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15",
  };

  return (
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: 6,
        background: bgColor,
        color: iconColor,
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
      }}
    >
      <svg
        width={14}
        height={14}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={path[id]} />
      </svg>
    </div>
  );
}

function ManageRow({
  id,
  label,
  desc,
  meta,
  danger,
  twoStep,
  buttonLabel,
  comingSoon,
  onAction,
}: {
  id: ManageAction;
  label: string;
  desc: string;
  meta?: string;
  danger?: boolean;
  twoStep?: boolean;
  buttonLabel?: string;
  comingSoon?: boolean;
  onAction: () => void;
}) {
  return (
    <div
      data-testid={`manage-action-${id}`}
      className="grid items-center border-t border-border-1 first:border-t-0 px-4 py-3.5"
      style={{ gridTemplateColumns: "28px 1fr auto auto", gap: 14 }}
    >
      <ManageActionIcon
        id={id}
        {...(danger !== undefined && { danger })}
        {...(twoStep !== undefined && { twoStep })}
      />
      <div className="min-w-0">
        <div
          className={`text-[13px] font-semibold ${
            danger === true ? "text-status-error" : "text-ink-1"
          }`}
        >
          {label}
        </div>
        <div className="mt-0.5 text-xs text-ink-3 leading-snug">{desc}</div>
      </div>
      {meta ? (
        <div
          className="font-mono text-[11px] text-right"
          style={{
            color: danger
              ? "var(--status-error)"
              : twoStep
                ? "var(--status-review)"
                : "var(--ink-4)",
            minWidth: 120,
          }}
        >
          {meta}
        </div>
      ) : (
        <div />
      )}
      <Button
        variant={danger === true ? "danger" : "outline"}
        size="sm"
        data-testid={`manage-action-btn-${id}`}
        onClick={onAction}
        disabled={comingSoon}
        title={comingSoon ? "Coming soon" : undefined}
      >
        {comingSoon ? "Coming soon" : (buttonLabel ?? label.replace("…", ""))}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CreateProjectModal — ported from deleted ProjectListPage (git: f588108)
// ---------------------------------------------------------------------------

type Step =
  | { kind: "form" }
  | { kind: "zipping" }
  | { kind: "uploading"; pct: number };

type UploadMode = "zip" | "folder";

function CreateProjectModal({
  open,
  onClose,
  onCreated,
  onRailRefresh,
}: {
  open: boolean;
  onClose: () => void;
  /** Called with the new project id when creation + upload succeeds. */
  onCreated: (projectId: string) => void;
  /** Callback to tell the rail to re-fetch after a successful create. */
  onRailRefresh: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [folderFiles, setFolderFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<UploadMode>("zip");
  const [step, setStep] = useState<Step>({ kind: "form" });

  const createMut = useMutation({
    mutationFn: async () => {
      let uploadFile_: File;
      if (mode === "folder") {
        if (folderFiles.length === 0)
          throw new Error("Select a folder of images first.");
        setStep({ kind: "zipping" });
        const zip = new JSZip();
        for (const f of folderFiles) {
          zip.file(f.name, f);
        }
        const blob = await zip.generateAsync({ type: "blob" });
        uploadFile_ = new File([blob], "upload.zip", {
          type: "application/zip",
        });
      } else {
        if (!file) throw new Error("Choose a zip file first.");
        uploadFile_ = file;
      }

      const created = await api.post<CreateProjectResponse>(
        "/api/data/projects",
        { name, source_type: "zip" } satisfies CreateProjectRequest,
      );
      if (!created.upload_url || !created.upload_key) {
        throw new Error("Server did not return an upload URL.");
      }

      setStep({ kind: "uploading", pct: 0 });
      await uploadFileXhr(created.upload_url, uploadFile_, (pct) =>
        setStep({ kind: "uploading", pct }),
      );

      await api.post<{ job_id: string; status: string }>("/api/gpu/ingest", {
        project_id: created.project.id,
        source_key: created.upload_key,
        source_type: "zip",
      });

      return created.project;
    },
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      onRailRefresh();
      onClose();
      onCreated(project.id);
    },
    onError: () => {
      setStep({ kind: "form" });
    },
  });

  const isReady =
    name.trim().length > 0 &&
    (mode === "zip" ? file !== null : folderFiles.length > 0);

  function handleClose() {
    if (createMut.isPending) return; // block close while uploading
    setName("");
    setFile(null);
    setFolderFiles([]);
    setMode("zip");
    setStep({ kind: "form" });
    createMut.reset();
    onClose();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
    >
      <DialogContent>
        <div data-testid="create-project-dialog">
          <DialogTitle className="text-lg font-semibold">
            New project
          </DialogTitle>

          {step.kind === "form" && (
            <>
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- Input wraps a native <input>; jsx-a11y cannot see through the component boundary */}
              <label className="block">
                <span className="text-sm text-ink-2">Book name</span>
                <Input
                  className="mt-1"
                  data-testid="create-project-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Belloc — The Four Men"
                />
              </label>

              {/* Mode toggle — ZIP file vs Folder */}
              <div
                role="tablist"
                aria-label="Upload source"
                className="flex gap-1 rounded border border-border-2 p-0.5 w-fit"
              >
                <button
                  role="tab"
                  aria-selected={mode === "zip"}
                  onClick={() => {
                    setMode("zip");
                    setFolderFiles([]);
                  }}
                  className={`rounded px-3 py-1 text-sm transition-colors ${
                    mode === "zip"
                      ? "bg-accent text-white"
                      : "text-ink-2 hover:bg-bg-raised"
                  }`}
                >
                  ZIP file
                </button>
                <button
                  role="tab"
                  aria-selected={mode === "folder"}
                  onClick={() => {
                    setMode("folder");
                    setFile(null);
                  }}
                  className={`rounded px-3 py-1 text-sm transition-colors ${
                    mode === "folder"
                      ? "bg-accent text-white"
                      : "text-ink-2 hover:bg-bg-raised"
                  }`}
                >
                  Folder
                </button>
              </div>

              {mode === "zip" && (
                <label className="block">
                  <span className="text-sm text-ink-2">Source zip</span>
                  <input
                    type="file"
                    accept=".zip,application/zip"
                    data-testid="create-project-zip-input"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="mt-1 block w-full text-sm"
                  />
                </label>
              )}

              {mode === "folder" && (
                <label className="block">
                  <span className="text-sm text-ink-2">
                    Image folder{" "}
                    <span className="text-ink-3">
                      (select your scans folder)
                    </span>
                  </span>
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    data-testid="create-project-folder-input"
                    data-folder-input="true"
                    {...({ webkitdirectory: "" } as object)}
                    onChange={(e) => {
                      const files = e.target.files
                        ? Array.from(e.target.files)
                        : [];
                      setFolderFiles(files);
                    }}
                    className="mt-1 block w-full text-sm"
                  />
                  {folderFiles.length > 0 && (
                    <p className="mt-1 text-xs text-ink-3">
                      {folderFiles.length} image
                      {folderFiles.length !== 1 ? "s" : ""} selected — will be
                      zipped before upload
                    </p>
                  )}
                </label>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <Button
                  data-testid="create-project-submit-btn"
                  onClick={() => createMut.mutate()}
                  disabled={!isReady || createMut.isPending}
                >
                  Create + Upload
                </Button>
              </div>
            </>
          )}

          {step.kind === "zipping" && <ProgressLine label="Zipping…" pct={0} />}

          {step.kind === "uploading" && (
            <ProgressLine
              label={`Uploading… ${step.pct}%`}
              pct={step.pct}
              testid="create-upload-progress"
            />
          )}

          <FormErrorBanner
            prefix="create project failed"
            error={createMut.isError ? createMut.error : null}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProgressLine({
  label,
  pct,
  testid,
}: {
  label: string;
  pct: number;
  testid?: string;
}) {
  return (
    <div className="space-y-2" data-testid={testid}>
      <div className="text-sm text-ink-2">{label}</div>
      <div className="h-2 w-full overflow-hidden rounded bg-bg-raised">
        <div
          className="h-full bg-accent transition-[width]"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

async function uploadFileXhr(
  url: string,
  file: File,
  onProgress: (pct: number) => void,
  contentType = "application/zip",
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed: HTTP ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error("Upload network error"));
    xhr.send(file);
  });
}
