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
import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useActor } from "@xstate/react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { Badge, type BadgeStatus } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
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
} from "@/mocks/types";
import {
  railListMachine,
  type RailListServices,
} from "@/machines/projects/railList";
import {
  projectDetailMachine,
  type ProjectDetailServices,
} from "@/machines/projects/projectDetail";
import { ProjectsEmpty } from "./ProjectsEmpty";
import type { StateValue } from "xstate";

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
            style={{
              width: here ? 8 : 6,
              height: here ? 8 : 6,
              borderRadius: 99,
              background:
                done || here
                  ? color
                  : "color-mix(in srgb, currentColor 20%, transparent)",
              opacity: done && !here ? 0.7 : 1,
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
}

export function ProjectsPage({
  services,
}: {
  services?: ProjectsPageServices;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Build services from QueryClient if not injected (production path).
  const resolvedServices = useMemo<ProjectsPageServices>(() => {
    if (services) return services;
    const fetchProjects = (): Promise<ProjectRecord[]> =>
      queryClient.fetchQuery({
        queryKey: ["projects"],
        queryFn: () => api.get<ProjectRecord[]>("/api/data/projects"),
      });
    const rail: RailListServices = { fetchProjects };
    const detail: ProjectDetailServices = { fetchProjects };
    return { rail, detail };
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
        <ProjectsEmpty onNewProject={() => void navigate("/projects/new")} />
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
              onClick={() => void navigate("/projects/new")}
            >
              New project
            </Button>
          </div>

          {/* Summary */}
          <div className="px-4 pb-2 text-xs font-mono text-ink-3">
            <div>{counts.active + counts.archived} projects</div>
          </div>

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
              onViewAllActivity={() =>
                detailSend({ type: "VIEW_ALL_ACTIVITY" })
              }
            />
          )}
        </div>
      </div>
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
  onViewAllActivity,
}: {
  project: ProjectRecord;
  tab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  onOpenProject: () => void;
  onViewAllActivity: () => void;
}) {
  const s = toBadgeStatus(project.status, project.archived);
  const label = statusLabel(project.status, project.archived);
  const pct = Math.round((project.currentStage / project.totalStages) * 100);

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

      {/* Stats grid */}
      <div
        className="mt-6 grid grid-cols-6 overflow-hidden rounded-lg border border-border-1 bg-border-1"
        data-testid="detail-stats"
        style={{ gap: 1 }}
      >
        {(
          [
            { label: "pages", value: String(project.pages) },
            { label: "on disk", value: project.size },
            {
              label: "flagged",
              value: project.flagged != null ? String(project.flagged) : "—",
              highlight: !!project.flagged,
            },
            {
              label: "progress",
              value: `${pct}%`,
              sub: `${project.currentStage + 1}/${project.totalStages}`,
            },
            {
              label: "created",
              value: project.created.replace(", 2026", ""),
            },
            { label: "updated", value: project.updatedRel },
          ] as {
            label: string;
            value: string;
            highlight?: boolean;
            sub?: string;
          }[]
        ).map((stat) => (
          <div key={stat.label} className="bg-bg-surface px-3.5 py-3.5">
            <div className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
              {stat.label}
            </div>
            <div
              className={`mt-1.5 font-mono text-lg font-semibold ${
                stat.highlight ? "text-status-review" : "text-ink-1"
              }`}
              data-testid={`stat-${stat.label.replace(/\s+/g, "-")}`}
            >
              {stat.value}
            </div>
            {stat.sub ? (
              <div className="mt-0.5 font-mono text-[10.5px] text-ink-4">
                {stat.sub}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {/* Pipeline strip */}
      <div className="mt-6" data-testid="detail-pipeline">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-3">
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
              {project.archived ? " · final" : ""}
            </span>
            {project.flagged ? (
              <span className="text-status-review">
                {project.flagged} pages flagged
              </span>
            ) : null}
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
              { id: "activity", label: "Recent activity" },
              { id: "attributes", label: "Attributes" },
              { id: "manage", label: "Manage" },
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
                className={`relative px-3.5 py-2.5 text-[12.5px] font-medium ${
                  active ? "text-ink-1" : "text-ink-3"
                }`}
              >
                {t.label}
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
              onClick={onViewAllActivity}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[11.5px] text-ink-3 hover:text-ink-1"
            >
              View all activity
            </button>
          )}
        </div>

        {/* Tab panels */}
        {tab === "activity" && (
          <ActivityTabPanel project={project} onViewAll={onViewAllActivity} />
        )}
        {tab === "attributes" && <AttributesTabPanel project={project} />}
        {tab === "manage" && <ManageTabPanel project={project} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Activity tab panel
// ---------------------------------------------------------------------------

function ActivityTabPanel({
  project,
  onViewAll,
}: {
  project: ProjectRecord;
  onViewAll: () => void;
}) {
  return (
    <div
      className="mt-3 rounded-lg border border-border-1 bg-bg-surface"
      data-testid="activity-panel"
    >
      <div className="px-4 py-3 text-xs text-ink-4">
        Activity for <span className="font-mono">{project.id}</span> — connect
        recentActivity machine here.
      </div>
      <div className="flex items-center justify-between border-t border-border-1 px-4 py-2.5">
        <span className="font-mono text-[11px] text-ink-4">—</span>
        <Button
          variant="ghost"
          size="sm"
          data-testid="open-activity-log-btn"
          onClick={onViewAll}
        >
          Open activity log
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attributes tab panel
// ---------------------------------------------------------------------------

function AttributesTabPanel({ project }: { project: ProjectRecord }) {
  return (
    <div
      className="mt-3 rounded-lg border border-border-1 bg-bg-surface"
      data-testid="attributes-panel"
    >
      <div className="px-4 py-3 text-xs text-ink-4">
        Attributes for <span className="font-mono">{project.id}</span> — connect
        attributesPanel machine here.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Manage tab panel
// ---------------------------------------------------------------------------

interface ManageActionDef {
  id: ManageAction;
  label: string;
  desc: string;
  danger?: boolean;
  twoStep?: boolean;
}

function ManageTabPanel({ project }: { project: ProjectRecord }) {
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const actions: ManageActionDef[] = project.archived
    ? [
        {
          id: "restore",
          label: "Restore project",
          desc: "Unarchive and make the project editable again.",
        },
        {
          id: "saveCopy",
          label: "Save a copy…",
          desc: "Download the archived zip to a different location.",
        },
        {
          id: "delete",
          label: "Delete project",
          desc: "Permanently remove everything. Only archived projects can be deleted.",
          danger: true,
        },
      ]
    : [
        {
          id: "clean",
          label: "Clean intermediate artifacts",
          desc: "Drop stage outputs that can be re-derived automatically.",
        },
        {
          id: "archive",
          label: "Archive project",
          desc: "Zip the project in place and mark it read-only.",
        },
        {
          id: "saveCopy",
          label: "Save a copy…",
          desc: "Download a zip of the full project.",
        },
        {
          id: "delete",
          label: "Delete project",
          desc: "Step 1 of 2 — archives the project (run delete again from archived to remove permanently).",
          twoStep: true,
        },
      ];

  return (
    <div
      className="mt-3 rounded-lg border border-border-1 bg-bg-surface"
      data-testid="manage-panel"
    >
      {actions.map((a, i) => (
        <div
          key={a.id}
          data-testid={`manage-action-${a.id}`}
          className={`flex items-center gap-3.5 px-4 py-3.5 ${
            i > 0 ? "border-t border-border-1" : ""
          }`}
        >
          <div className="min-w-0 flex-1">
            <div
              className={`text-[13px] font-semibold ${
                a.danger === true ? "text-status-error" : "text-ink-1"
              }`}
            >
              {a.label}
            </div>
            <div className="mt-0.5 text-xs text-ink-3">{a.desc}</div>
          </div>
          <Button
            variant={a.danger === true ? "danger" : "outline"}
            size="sm"
            data-testid={`manage-action-btn-${a.id}`}
            onClick={() => {
              if (a.id === "saveCopy") {
                void navigate(`/projects/${project.id}/export`);
              } else if (a.id === "delete" && project.archived === true) {
                setDeleteOpen(true);
              }
              // Connect manageActions machine here in a follow-on slice.
            }}
          >
            {a.id === "delete" && project.archived !== true
              ? "Delete…"
              : a.id === "delete"
                ? "Delete permanently"
                : a.label.replace("…", "")}
          </Button>
        </div>
      ))}

      <AlertDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        data-testid="delete-confirm-dialog"
      >
        <AlertDialogContent>
          <AlertDialogTitle>Delete project permanently?</AlertDialogTitle>
          <AlertDialogDescription>
            This will remove all pages, OCR output, and pipeline state for
            &ldquo;{project.title}&rdquo;. This cannot be undone.
          </AlertDialogDescription>
          <div className="flex justify-end gap-2 pt-2">
            <AlertDialogCancel asChild>
              <Button
                variant="outline"
                size="sm"
                data-testid="delete-cancel-btn"
              >
                Cancel
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="danger"
                size="sm"
                data-testid="delete-confirm-btn"
                onClick={() => {
                  // Connect manageActions machine delete here in a follow-on slice.
                }}
              >
                Delete permanently
              </Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
