import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Download, Loader2, AlertCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { DiskCostBanner } from "../components/DiskCostBanner";
import { SearchPanel } from "../components/SearchPanel";
import { SourcePreview } from "../components/SourcePreview";
import { PageHeader } from "../components/shell/PageHeader";
import { Card } from "../components/ui/Card";
import { StatTile } from "../components/ui/StatTile";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../components/ui/Tabs";
import { PageDrawer } from "../components/workbench/PageDrawer";
import { PageRow } from "../components/workbench/PageRow";
import {
  useActiveBatchJob,
  type JobSnapshot,
} from "../hooks/useActiveBatchJob";
import { useJobProgress } from "../hooks/useJobProgress";
import type { components } from "../api/types.gen";

type ListPagesResponse = components["schemas"]["ListPagesResponse"];
type PageRecord = components["schemas"]["PageRecord"];
type Project = components["schemas"]["Project"];
type ProjectConfig = components["schemas"]["ProjectConfig"];
type UpdatePageRequest = components["schemas"]["UpdatePageRequest"];

const INGEST_KINDS = ["unzip", "thumbnails"];

export function ProjectConfigurePage() {
  const { projectId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") ?? "pipeline") as
    | "pipeline"
    | "pages"
    | "settings";

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value });
  };

  // Drawer state: ?drawer=<idx0> opens the PageDrawer for that page.
  const drawerIdx0 =
    searchParams.get("drawer") !== null
      ? Number(searchParams.get("drawer"))
      : null;

  const openDrawer = (idx0: number) => {
    setSearchParams((prev) => {
      prev.set("drawer", String(idx0));
      return prev;
    });
  };
  const closeDrawer = () => {
    setSearchParams((prev) => {
      prev.delete("drawer");
      return prev;
    });
  };

  const queryClient = useQueryClient();

  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.get<Project>(`/api/data/projects/${projectId}`),
  });
  // Watch the project's recent jobs (via the shared poll) so we can show a
  // "creating thumbnails" banner while ingest is in flight. TanStack dedupes
  // on the shared query key so this is free when other panels also poll.
  const ingestBatch = useActiveBatchJob(projectId || null, INGEST_KINDS);
  const liveIngestJob = useMemo(
    () => ingestBatch.jobs.find((j) => j.id === ingestBatch.jobId) ?? null,
    [ingestBatch.jobs, ingestBatch.jobId],
  );
  // Infinite scroll for very large books — `next_cursor` walks 200 at a
  // time. Most books are small enough that the first page covers everything;
  // the "Load more" button only appears when the server reports more.
  const pageSize = 200;
  const pages = useInfiniteQuery({
    queryKey: ["pages", projectId],
    queryFn: ({ pageParam }) =>
      api.get<ListPagesResponse>(
        `/api/data/projects/${projectId}/pages?limit=${pageSize}` +
          (pageParam ? `&cursor=${encodeURIComponent(String(pageParam))}` : ""),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });

  const allPages = useMemo(
    () => (pages.data?.pages ?? []).flatMap((p) => p.pages),
    [pages.data],
  );
  const total = pages.data?.pages?.[0]?.total ?? allPages.length;

  // Page selected in the drawer (resolved from ?drawer=<idx0> URL param).
  const selectedPage = useMemo(
    () =>
      drawerIdx0 !== null
        ? (allPages.find((p) => p.idx0 === drawerIdx0) ?? null)
        : null,
    [allPages, drawerIdx0],
  );

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showSplitParents, setShowSplitParents] = useState(false);

  // ── Drag-and-drop page reordering ────────────────────────────────────────
  // Optimistic local order: null means "use server order" (visiblePages).
  const [localPageOrder, setLocalPageOrder] = useState<PageRecord[] | null>(
    null,
  );
  const dragSrcIndex = useRef<number | null>(null);
  // Snapshot taken at dragstart so we can revert on error.
  const dragOrderSnapshot = useRef<PageRecord[] | null>(null);

  // Compute the set of page_ids that are referenced as parent_page_id by
  // at least one split child. These are "split parents" hidden by default.
  const splitParentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of allPages) {
      if (p.parent_page_id != null) ids.add(p.parent_page_id);
    }
    return ids;
  }, [allPages]);

  const visiblePages = useMemo(
    () =>
      showSplitParents
        ? allPages
        : allPages.filter(
            (p) =>
              p.parent_page_id != null ||
              !splitParentIds.has(String(p.idx0).padStart(4, "0")),
          ),
    [allPages, showSplitParents, splitParentIds],
  );

  const reorder = useMutation({
    mutationFn: (pageIds: string[]) =>
      api.patch(`/api/data/projects/${projectId}/pages/reorder`, {
        page_ids: pageIds,
      }),
    onSuccess: () => {
      // Clear local optimistic order so the invalidated server data takes over.
      setLocalPageOrder(null);
      queryClient.invalidateQueries({ queryKey: ["pages", projectId] });
    },
    onError: () => {
      // Revert to the snapshot captured at drag-start.
      setLocalPageOrder(dragOrderSnapshot.current);
    },
    onSettled: () => {
      dragOrderSnapshot.current = null;
    },
  });

  // Derive displayed pages: localPageOrder takes priority while optimistic.
  const displayedPages = localPageOrder ?? visiblePages;

  if (project.isLoading || pages.isLoading) {
    return <p className="text-slate-500">Loading…</p>;
  }
  if (!project.data) {
    return <p className="text-red-600">Project not found.</p>;
  }

  // While unzip or thumbnails are in flight, hide the page grid and point
  // the user at the JobsPage. The grid would just be empty (unzip) or
  // thumbnail-less (thumbnails) anyway.
  if (liveIngestJob) {
    const label =
      liveIngestJob.type === "unzip"
        ? "Unzipping source archive…"
        : "Creating thumbnails…";
    const { current, total: jobTotal, message } = liveIngestJob.progress;
    return (
      <section className="space-y-3">
        <h1 className="text-xl font-semibold">{project.data.name}</h1>
        <div className="rounded border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
          <p className="font-medium">{label}</p>
          {jobTotal > 0 && (
            <p className="mt-1 text-xs">
              {current}/{jobTotal}
              {message && ` · ${message}`}
            </p>
          )}
          <p className="mt-2 text-xs">
            <Link
              to={`/jobs?project_id=${encodeURIComponent(projectId)}`}
              className="underline"
            >
              Open jobs page →
            </Link>
          </p>
        </div>
        {/* While ingest is in flight we can already peek inside the
            uploaded zip via the central directory — gives the user
            something concrete to look at instead of staring at a
            spinner, and surfaces wrong-zip mistakes before unzip
            finishes (roadmap §8 / P2 #8 slice 4). */}
        <SourcePreview projectId={projectId} />
      </section>
    );
  }

  return (
    <section className="space-y-0" data-testid="project-configure-page">
      {/* Page header with project name and action buttons */}
      <PageHeader
        data-testid="project-page-header"
        title={project.data.name}
        actions={
          <>
            <Link
              to={`/projects/${projectId}/pages/0`}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              Open Workbench
            </Link>
            <Link
              to={`/projects/${projectId}/crops`}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              Crops
            </Link>
            <Link
              to={`/projects/${projectId}/review`}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              Review queue
            </Link>
          </>
        }
      />

      {/* Stat tile row */}
      <div
        className="flex gap-6 px-6 py-3 border-b border-border-1"
        data-testid="stat-tile-row"
      >
        <StatTile
          value={project.data.page_count ?? 0}
          label="Total pages"
          data-testid="stat-total-pages"
        />
        <StatTile value={0} label="Done" data-testid="stat-done" />
        <StatTile
          value={0}
          label="Awaiting review"
          data-testid="stat-awaiting-review"
        />
      </div>

      {/* DiskCostBanner — page-local because it requires project prop from this page's query */}
      <div className="px-6 pt-3">
        <DiskCostBanner project={project.data} />
      </div>

      {/* URL-stateful tabs: Pipeline / Pages / Settings */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="mt-4">
        <TabsList className="flex border-b border-border-1 px-6 gap-1">
          <TabsTrigger
            value="pipeline"
            className="px-4 py-2 text-sm data-[state=active]:border-b-2 data-[state=active]:border-slate-900 data-[state=active]:font-medium"
          >
            Pipeline
          </TabsTrigger>
          <TabsTrigger
            value="pages"
            className="px-4 py-2 text-sm data-[state=active]:border-b-2 data-[state=active]:border-slate-900 data-[state=active]:font-medium"
          >
            Pages
          </TabsTrigger>
          <TabsTrigger
            value="settings"
            className="px-4 py-2 text-sm data-[state=active]:border-b-2 data-[state=active]:border-slate-900 data-[state=active]:font-medium"
          >
            Settings
          </TabsTrigger>
        </TabsList>

        {/* Pipeline tab — pipeline controls */}
        <TabsContent value="pipeline" className="space-y-4 px-6 pt-4">
          <RunAllDirtyPanel projectId={projectId} />

          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <RunPipelinePanel
              projectId={projectId}
              bookName={project.data?.config.book_name ?? ""}
            />
            <div className="space-y-4">
              <ProjectJobsFeed projectId={projectId} />
              <SearchPanel projectId={projectId} />
            </div>
          </div>
        </TabsContent>

        {/* Pages tab — page list with PageRow + PageDrawer */}
        <TabsContent value="pages">
          {/* Bulk actions and split-parent toggle live above the two-column area */}
          <div className="space-y-4 px-6 pt-4">
            <BulkActions
              projectId={projectId}
              selected={selected}
              onClear={() => setSelected(new Set())}
            />

            {splitParentIds.size > 0 && (
              <div className="flex items-center gap-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={showSplitParents}
                    onChange={(e) => setShowSplitParents(e.target.checked)}
                    className="rounded"
                  />
                  Show split parents ({splitParentIds.size})
                </label>
              </div>
            )}
          </div>

          {/* Two-column layout: page list | drawer */}
          <div className="flex">
            <div className="flex-1 overflow-auto">
              <Card className="m-4" data-testid="pages-card">
                {displayedPages.length === 0 && (
                  <p className="px-4 py-6 text-sm text-ink-3 text-center">
                    No pages yet.
                  </p>
                )}
                {displayedPages.map((page, listIndex) => (
                  <PageRow
                    key={page.idx0}
                    page={page}
                    isSelected={page.idx0 === drawerIdx0}
                    onSelect={openDrawer}
                    draggable
                    onDragStart={(e) => {
                      dragSrcIndex.current = listIndex;
                      // Capture a snapshot before any optimistic update.
                      dragOrderSnapshot.current = displayedPages.slice();
                      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const srcIdx = dragSrcIndex.current;
                      if (srcIdx === null || srcIdx === listIndex) return;

                      // Build the reordered list optimistically.
                      const reordered = displayedPages.slice();
                      const [moved] = reordered.splice(srcIdx, 1);
                      reordered.splice(listIndex, 0, moved);
                      setLocalPageOrder(reordered);
                      dragSrcIndex.current = null;

                      // Tell the server the new order using zero-padded idx0.
                      const pageIds = reordered.map((p) =>
                        String(p.idx0).padStart(4, "0"),
                      );
                      reorder.mutate(pageIds);
                    }}
                    onDragEnd={() => {
                      dragSrcIndex.current = null;
                    }}
                  />
                ))}
              </Card>

              {pages.hasNextPage && (
                <div className="px-6 pb-4 text-center">
                  <button
                    onClick={() => pages.fetchNextPage()}
                    disabled={pages.isFetchingNextPage}
                    className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                  >
                    {pages.isFetchingNextPage
                      ? "Loading…"
                      : `Load more (${total - allPages.length} remaining)`}
                  </button>
                </div>
              )}
            </div>

            <PageDrawer
              page={selectedPage}
              projectId={projectId}
              onClose={closeDrawer}
            />
          </div>
        </TabsContent>

        {/* Settings tab — book settings / config form */}
        <TabsContent value="settings" className="space-y-4 px-6 pt-4">
          <BookSettingsAccordion
            projectId={projectId}
            config={project.data.config}
            totalPages={total}
          />
        </TabsContent>
      </Tabs>
    </section>
  );
}

function BookSettingsAccordion({
  projectId,
  config,
  totalPages,
}: {
  projectId: string;
  config: ProjectConfig;
  totalPages: number;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(config);

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/api/data/projects/${projectId}/config`, {
        project_config: {
          proof_start_idx0: draft.proof_start_idx0,
          proof_end_idx0: draft.proof_end_idx0,
          frontmatter_start_idx0: draft.frontmatter_start_idx0,
          frontmatter_end_idx0: draft.frontmatter_end_idx0,
          bodymatter_start_idx0: draft.bodymatter_start_idx0,
          bodymatter_end_idx0: draft.bodymatter_end_idx0,
          frontmatter_page_nbr_start: draft.frontmatter_page_nbr_start,
          bodymatter_page_nbr_start: draft.bodymatter_page_nbr_start,
          default_overrides: draft.default_overrides,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pages", projectId] });
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    },
  });

  const layoutConf =
    typeof draft.default_overrides.layout_detector_confidence === "number"
      ? (draft.default_overrides.layout_detector_confidence as number)
      : null;

  return (
    <div className="rounded border bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2 text-left text-sm font-medium hover:bg-slate-50"
      >
        Book Settings — ranges
        <span className="text-slate-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <RangeField
            label="Proof range"
            from={draft.proof_start_idx0}
            to={draft.proof_end_idx0}
            max={totalPages - 1}
            onChange={(from, to) =>
              setDraft((d) => ({
                ...d,
                proof_start_idx0: from,
                proof_end_idx0: to,
              }))
            }
          />
          <RangeField
            label="Frontmatter"
            from={draft.frontmatter_start_idx0}
            to={draft.frontmatter_end_idx0}
            max={totalPages - 1}
            onChange={(from, to) =>
              setDraft((d) => ({
                ...d,
                frontmatter_start_idx0: from,
                frontmatter_end_idx0: to,
              }))
            }
          />
          <RangeField
            label="Bodymatter"
            from={draft.bodymatter_start_idx0}
            to={draft.bodymatter_end_idx0}
            max={totalPages - 1}
            onChange={(from, to) =>
              setDraft((d) => ({
                ...d,
                bodymatter_start_idx0: from,
                bodymatter_end_idx0: to,
              }))
            }
          />
          <label className="block text-sm sm:col-span-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-700">
                Layout detector confidence
                <span className="ml-2 text-xs text-slate-500">
                  (per-project; overrides system default)
                </span>
              </span>
              <span className="font-mono text-xs text-slate-500">
                {layoutConf === null ? "(inherit)" : layoutConf.toFixed(2)}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={layoutConf ?? 0.5}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    default_overrides: {
                      ...d.default_overrides,
                      layout_detector_confidence: Number(e.target.value),
                    },
                  }))
                }
                className="flex-1"
              />
              {layoutConf !== null && (
                <button
                  onClick={() =>
                    setDraft((d) => {
                      const o = { ...d.default_overrides };
                      delete o.layout_detector_confidence;
                      return { ...d, default_overrides: o };
                    })
                  }
                  className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50"
                >
                  inherit
                </button>
              )}
            </div>
          </label>
          <div className="flex items-end">
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 hover:bg-slate-800"
            >
              {save.isPending ? "Saving…" : "Save ranges"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RangeField({
  label,
  from,
  to,
  max,
  onChange,
}: {
  label: string;
  from: number;
  to: number;
  max: number;
  onChange: (from: number, to: number) => void;
}) {
  return (
    <label className="block text-sm">
      <div className="text-slate-700">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="number"
          min={0}
          max={max}
          value={from}
          onChange={(e) => onChange(Number(e.target.value), to)}
          className="w-20 rounded border border-slate-300 px-2 py-1 text-sm"
        />
        <span className="text-slate-400">…</span>
        <input
          type="number"
          min={0}
          max={max}
          value={to}
          onChange={(e) => onChange(from, Number(e.target.value))}
          className="w-20 rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </div>
    </label>
  );
}

function BulkActions({
  projectId,
  selected,
  onClear,
}: {
  projectId: string;
  selected: Set<number>;
  onClear: () => void;
}) {
  const queryClient = useQueryClient();
  const apply = useMutation({
    mutationFn: async (patch: UpdatePageRequest) => {
      const idxs = Array.from(selected);
      await Promise.all(
        idxs.map((idx0) =>
          api.patch(`/api/data/projects/${projectId}/pages/${idx0}`, patch),
        ),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pages", projectId] });
      onClear();
    },
  });

  if (selected.size === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-slate-300 bg-slate-50 p-2 text-sm">
      <span className="font-medium">{selected.size} selected</span>
      {(["normal", "blank", "plate_b", "plate_p", "plate_r"] as const).map(
        (pt) => (
          <button
            key={pt}
            onClick={() => apply.mutate({ page_type: pt })}
            className="rounded border border-slate-300 bg-white px-2 py-1 hover:bg-slate-100"
          >
            {pt}
          </button>
        ),
      )}
      <span className="text-slate-400">·</span>
      {(["default", "top", "center", "bottom"] as const).map((al) => (
        <button
          key={al}
          onClick={() => apply.mutate({ alignment: al })}
          className="rounded border border-slate-300 bg-white px-2 py-1 hover:bg-slate-100"
        >
          align {al}
        </button>
      ))}
      <button
        onClick={onClear}
        className="ml-auto rounded px-2 py-1 text-slate-500 hover:bg-slate-200"
      >
        clear
      </button>
    </div>
  );
}

// ─── M5: Run all dirty stages panel ───────────────────────────────────────

/**
 * One-click project-level fan-out: POST /api/data/projects/{id}/run-dirty.
 * Shows inline progress after submission using the job's SSE stream.
 */
function RunAllDirtyPanel({ projectId }: { projectId: string }) {
  const [jobId, setJobId] = useState<string | null>(null);
  const { event, isTerminal } = useJobProgress(jobId);

  // Clear job display when it reaches a terminal state so the button
  // is re-enabled and the panel resets to "idle".
  useEffect(() => {
    if (isTerminal) setJobId(null);
  }, [isTerminal]);

  const submit = useMutation({
    mutationFn: () =>
      api.post<{ job_id: string; status: string }>(
        `/api/data/projects/${projectId}/run-dirty`,
      ),
    onSuccess: (res) => setJobId(res.job_id),
  });

  const colour =
    event?.status === "complete"
      ? "text-emerald-700"
      : event?.status === "error"
        ? "text-rose-600"
        : "text-slate-500";
  const progress =
    event && event.total > 0 ? `${event.current}/${event.total} pages` : "";

  return (
    <div className="flex items-center gap-3 rounded border bg-white px-4 py-3">
      <button
        onClick={() => submit.mutate()}
        disabled={submit.isPending || jobId !== null}
        className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
        aria-label="Run all dirty stages"
      >
        Run all dirty stages
      </button>
      {jobId && event && (
        <span className={`text-xs ${colour}`}>
          {event.status} {progress}
          {event.error ? ` · ${event.error}` : ""}
        </span>
      )}
      {submit.isError && (
        <span className="text-xs text-rose-600">Submit failed</span>
      )}
    </div>
  );
}

// ─── Run-pipeline panel ────────────────────────────────────────────────────

type JobType = "build_package";

const STEPS: { type: JobType; label: string; subtitle: string }[] = [
  {
    type: "build_package",
    label: "Step 10 — Build package",
    subtitle: "Assemble PNG + TXT + illustrations into the PGDP zip.",
  },
];

function RunPipelinePanel({
  projectId,
  bookName,
}: {
  projectId: string;
  bookName: string;
}) {
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState<Record<JobType, string | null>>({
    build_package: null,
  });
  // Once build_package reaches "complete" we persist the job id so the
  // download link keeps rendering even after the progress indicator resets.
  const [completedJobId, setCompletedJobId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Track any build_package job that is already running on this project (e.g.
  // user came back to this page mid-run, or it was kicked off elsewhere).
  // Pre-populate `active.build_package` so the inline progress and tile-pulse
  // render without requiring the user to click Run again.
  // Reuses the shared `["jobs", projectId]` poll so this is free.
  const liveBatch = useActiveBatchJob(projectId, ["build_package"]);
  useEffect(() => {
    if (liveBatch.jobId && active.build_package !== liveBatch.jobId) {
      setActive((s) => ({ ...s, build_package: liveBatch.jobId }));
    }
  }, [liveBatch.jobId, active.build_package]);

  // Find the completed build_package job to pass to DownloadPackageButton
  const completedBuildJob = useMemo(() => {
    if (!liveBatch.jobs) return null;
    return (
      liveBatch.jobs.find(
        (j) => j.type === "build_package" && j.status === "complete",
      ) ?? null
    );
  }, [liveBatch.jobs]);

  const submit = useMutation({
    mutationFn: async (type: JobType) => {
      const r = await api.post<{ job_id: string }>(
        `/api/data/projects/${projectId}/build-package`,
      );
      setActive((s) => ({ ...s, [type]: r.job_id }));
      // Clear any previous download link when a new build starts.
      setCompletedJobId(null);
      return r;
    },
    onSuccess: () => {
      // Invalidate the jobs query immediately so useActiveBatchJob re-fetches
      // right away, closing the gap between mutation completion and the next
      // 3-second poll cycle. This keeps the button disabled immediately after
      // clicking, preventing a brief flash of the enabled state.
      queryClient.invalidateQueries({ queryKey: ["jobs", projectId] });
    },
  });

  // Derive the storage key for the built package zip.
  // Matches core/packaging.py: f"projects/{project.id}/for_zip/{book_name}.zip"
  const packageKey = bookName
    ? `projects/${projectId}/for_zip/${bookName}.zip`
    : null;

  // Fetch a download URL once the build_package job completes successfully.
  // The query is disabled until we have both a completed job id and a key.
  const downloadUrl = useQuery({
    queryKey: ["package-download-url", projectId, packageKey],
    queryFn: () =>
      api.get<{ download_url: string }>(
        `/api/data/projects/${projectId}/assets/download-url?key=${encodeURIComponent(packageKey!)}`,
      ),
    enabled: completedJobId !== null && packageKey !== null,
    // Cache for 45 minutes (presigned URLs expire at 1 h server-side).
    staleTime: 45 * 60 * 1000,
  });

  return (
    <div className="rounded border bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2 text-left text-sm font-medium hover:bg-slate-50"
      >
        Run pipeline
        <span className="text-slate-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <ul className="divide-y">
          {STEPS.map((step) => (
            <li
              key={step.type}
              className="flex flex-col gap-2 px-4 py-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <div className="text-sm font-medium">{step.label}</div>
                <div className="text-xs text-slate-500">{step.subtitle}</div>
              </div>
              <div className="flex items-center gap-2">
                {active[step.type] && (
                  <JobProgressInline
                    jobId={active[step.type]!}
                    onComplete={
                      step.type === "build_package"
                        ? () => setCompletedJobId(active[step.type])
                        : undefined
                    }
                  />
                )}
                {step.type === "build_package" &&
                  completedJobId !== null &&
                  downloadUrl.data && (
                    <a
                      href={downloadUrl.data.download_url}
                      download
                      className="rounded border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm text-emerald-700 hover:bg-emerald-100"
                      data-testid="download-package-link"
                    >
                      Download package
                    </a>
                  )}
                <button
                  onClick={() => submit.mutate(step.type)}
                  disabled={submit.isPending || active[step.type] !== null}
                  className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
                >
                  Run
                </button>
                {step.type === "build_package" && (
                  <DownloadPackageButton
                    projectId={projectId}
                    completedBuildJob={completedBuildJob}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Download Package Button ──────────────────────────────────────────────

type DownloadUrlResponse = components["schemas"]["DownloadUrlResponse"];

function DownloadPackageButton({
  projectId,
  completedBuildJob,
}: {
  projectId: string;
  completedBuildJob: JobSnapshot | null;
}) {
  // Mutation to fetch the download URL when the button is clicked
  const downloadMutation = useMutation({
    mutationFn: () =>
      api.get<DownloadUrlResponse>(
        `/api/data/projects/${projectId}/assets/download-url`,
      ),
    onSuccess: (data) => {
      // Open the URL in a new tab/window with noopener noreferrer for security
      window.open(data.download_url, "_blank", "noopener,noreferrer");
    },
  });

  if (!completedBuildJob) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => downloadMutation.mutate()}
        disabled={downloadMutation.isPending}
        className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1.5"
        aria-label="Download package"
      >
        {downloadMutation.isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Downloading…</span>
          </>
        ) : (
          <>
            <Download className="h-4 w-4" />
            <span>Download package</span>
          </>
        )}
      </button>
      {downloadMutation.isError && (
        <div className="flex items-center gap-1 text-xs text-rose-600">
          <AlertCircle className="h-4 w-4" />
          <span>Failed to download</span>
        </div>
      )}
    </div>
  );
}

function JobProgressInline({
  jobId,
  onCurrentPageChange,
  onComplete,
}: {
  jobId: string;
  onCurrentPageChange?: (idx0: number | null) => void;
  onComplete?: () => void;
}) {
  const { event, error, currentPage, isTerminal } = useJobProgress(jobId);

  // Lift current_page up so a parent (e.g. PageGrid) can highlight
  // the tile the worker is on. Clear on terminal status, and on unmount
  // so a stale highlight doesn't outlive this panel.
  useEffect(() => {
    if (!onCurrentPageChange) return;
    onCurrentPageChange(isTerminal ? null : currentPage);
  }, [onCurrentPageChange, currentPage, isTerminal]);
  useEffect(() => {
    return () => {
      if (onCurrentPageChange) onCurrentPageChange(null);
    };
  }, [onCurrentPageChange]);

  // Notify parent when the job completes successfully.
  useEffect(() => {
    if (event?.status === "complete" && onComplete) {
      onComplete();
    }
  }, [event?.status, onComplete]);

  if (error)
    return <span className="text-xs text-rose-600">channel: {error}</span>;
  if (!event) return <span className="text-xs text-slate-400">…</span>;

  const colour =
    event.status === "complete"
      ? "text-emerald-700"
      : event.status === "error"
        ? "text-rose-600"
        : "text-slate-500";
  const progress = event.total ? `${event.current}/${event.total}` : "";
  // `current_page` is a 0-indexed idx0 from the backend. Show it 1-indexed
  // so it matches the labels users see in the page grid / workbench.
  const pageHint =
    event.current_page !== null && event.current_page !== undefined
      ? ` · page ${event.current_page + 1}`
      : "";
  return (
    <span className={`text-xs ${colour}`}>
      {event.status} {progress}
      {pageHint}
      {event.error && ` · ${event.error}`}
    </span>
  );
}

// ─── Project-scoped recent jobs feed ──────────────────────────────────────

function ProjectJobsFeed({ projectId }: { projectId: string }) {
  const jobs = useQuery({
    queryKey: ["jobs", "project", projectId],
    queryFn: () =>
      api.get<JobSnapshot[]>(`/api/data/jobs?project_id=${projectId}&limit=20`),
    refetchInterval: 5000,
  });

  return (
    <div className="rounded border bg-white">
      <div className="px-4 py-2 text-sm font-medium">Recent jobs</div>
      {jobs.isLoading && (
        <div className="px-4 pb-3 text-xs text-slate-500">Loading…</div>
      )}
      {jobs.data && jobs.data.length === 0 && (
        <div className="px-4 pb-3 text-xs text-slate-500">
          No jobs run yet for this project.
        </div>
      )}
      {jobs.data && jobs.data.length > 0 && (
        <ul className="divide-y text-xs">
          {jobs.data.slice(0, 8).map((j) => {
            const colour =
              j.status === "complete"
                ? "text-emerald-700"
                : j.status === "error"
                  ? "text-rose-700"
                  : j.status === "running" || j.status === "scheduled"
                    ? "text-sky-700"
                    : "text-slate-600";
            return (
              <li
                key={j.id}
                className="flex items-center justify-between px-4 py-2"
              >
                <div className="flex items-center gap-2">
                  <span className={`font-medium ${colour}`}>{j.status}</span>
                  <span className="font-mono text-slate-500">{j.type}</span>
                </div>
                {j.progress.total > 0 && (
                  <span className="text-slate-400">
                    {j.progress.current}/{j.progress.total}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
