import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { DiskCostBanner } from "../components/DiskCostBanner";
import { SearchPanel } from "../components/SearchPanel";
import { SourcePreview } from "../components/SourcePreview";
import { useActiveBatchJob } from "../hooks/useActiveBatchJob";
import { useJobProgress } from "../hooks/useJobProgress";
import type { components } from "../api/types.gen";

type AlignmentOverride = components["schemas"]["AlignmentOverride"];
type ListPagesResponse = components["schemas"]["ListPagesResponse"];
type PageRecord = components["schemas"]["PageRecord"];
type PageType = components["schemas"]["PageType"];
type Project = components["schemas"]["Project"];
type ProjectConfig = components["schemas"]["ProjectConfig"];
type UpdatePageRequest = components["schemas"]["UpdatePageRequest"];

const PAGE_TYPE_BADGE: Record<PageType, { label: string; cls: string } | null> =
  {
    normal: null,
    blank: { label: "BLANK", cls: "bg-amber-100 text-amber-900" },
    plate_b: { label: "PLATE-B", cls: "bg-purple-100 text-purple-900" },
    plate_p: { label: "PLATE-P", cls: "bg-pink-100 text-pink-900" },
    plate_r: { label: "PLATE-R", cls: "bg-rose-100 text-rose-900" },
  };

const ALIGNMENT_BADGE: Record<
  AlignmentOverride,
  { label: string; cls: string } | null
> = {
  default: null,
  top: { label: "TOP", cls: "bg-sky-100 text-sky-900" },
  center: { label: "CENTER", cls: "bg-sky-100 text-sky-900" },
  bottom: { label: "BOTTOM", cls: "bg-sky-100 text-sky-900" },
};

const INGEST_KINDS = ["unzip", "thumbnails"];

export function ProjectConfigurePage() {
  const { projectId = "" } = useParams();
  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.get<Project>(`/api/data/projects/${projectId}`),
  });
  // Watch the project's recent jobs (via the shared poll) so we can show a
  // "creating thumbnails" banner while ingest is in flight. The same poll
  // is reused by RunPipelinePanel below for its `batch_process_pages`
  // catch-up — TanStack dedupes on the shared query key.
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

  const [selected, setSelected] = useState<Set<number>>(new Set());
  // Lifted from JobProgressInline: while a batch_process_pages job is
  // running, this holds the idx0 of the page the worker is currently on
  // so PageGrid can pulse-highlight the matching tile. Null when no
  // such job is active.
  const [activePageIdx0, setActivePageIdx0] = useState<number | null>(null);
  const [showSplitParents, setShowSplitParents] = useState(false);

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

  // Build a map from page_id → prefix for split children to compute labels.
  const prefixByPageId = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of allPages) {
      m.set(String(p.idx0).padStart(4, "0"), p.prefix);
    }
    return m;
  }, [allPages]);

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
    <section className="space-y-4">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <ProjectTitleEdit
            projectId={projectId}
            currentName={project.data.name}
          />
          <p className="text-xs text-slate-500">
            {total} pages · status: {project.data.status}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to={`/projects/${projectId}/pages/0`}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Open Workbench
          </Link>
          <Link
            to={`/projects/${projectId}/review`}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Review queue
          </Link>
        </div>
      </header>

      {/* DiskCostBanner — page-local because it requires project prop from this page's query */}
      <DiskCostBanner project={project.data} />

      <BookSettingsAccordion
        projectId={projectId}
        config={project.data.config}
        totalPages={total}
      />

      <RunAllDirtyPanel projectId={projectId} />

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <RunPipelinePanel
          projectId={projectId}
          onActivePageChange={setActivePageIdx0}
        />
        <div className="space-y-4">
          <ProjectJobsFeed projectId={projectId} />
          <SearchPanel projectId={projectId} />
        </div>
      </div>

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

      <PageGrid
        pages={visiblePages}
        projectId={projectId}
        selected={selected}
        activePageIdx0={activePageIdx0}
        prefixByPageId={prefixByPageId}
        onToggle={(idx0) => {
          setSelected((s) => {
            const next = new Set(s);
            if (next.has(idx0)) next.delete(idx0);
            else next.add(idx0);
            return next;
          });
        }}
      />

      {pages.hasNextPage && (
        <div className="text-center">
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

  const reprocess = useMutation({
    mutationFn: () =>
      api.post("/api/gpu/jobs", {
        project_id: projectId,
        job_type: "batch_process_pages",
        page_idxs: Array.from(selected),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["jobs", "project", projectId],
      });
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
      <span className="text-slate-400">·</span>
      <button
        onClick={() => reprocess.mutate()}
        disabled={reprocess.isPending}
        className="rounded border border-sky-300 bg-white px-2 py-1 text-sky-700 hover:bg-sky-50 disabled:opacity-50"
      >
        {reprocess.isPending ? "Submitting…" : "Re-process selected"}
      </button>
      <button
        onClick={onClear}
        className="ml-auto rounded px-2 py-1 text-slate-500 hover:bg-slate-200"
      >
        clear
      </button>
    </div>
  );
}

function PageGrid({
  pages,
  projectId,
  selected,
  activePageIdx0,
  prefixByPageId,
  onToggle,
}: {
  pages: PageRecord[];
  projectId: string;
  selected: Set<number>;
  activePageIdx0: number | null;
  prefixByPageId: Map<string, string>;
  onToggle: (idx0: number) => void;
}) {
  const queryClient = useQueryClient();

  const unsplit = useMutation({
    mutationFn: (idx0: number) =>
      api.delete<PageRecord>(
        `/api/data/projects/${projectId}/pages/${idx0}/split`,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pages", projectId] });
    },
  });

  const sorted = useMemo(
    () => [...pages].sort((a, b) => a.idx0 - b.idx0),
    [pages],
  );
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
      {sorted.map((p) => {
        const sel = selected.has(p.idx0);
        const isActive = activePageIdx0 === p.idx0;
        const ptBadge = PAGE_TYPE_BADGE[p.page_type];
        const alBadge = ALIGNMENT_BADGE[p.alignment];
        const borderCls = sel
          ? "border-slate-900 ring-2 ring-slate-900"
          : isActive
            ? "border-sky-500 ring-2 ring-sky-400 animate-pulse"
            : "border-slate-200 hover:border-slate-400";

        // Split-child display label: "{parent_prefix}-{split_index} (suffix)"
        const isSplitChild = p.parent_page_id != null;
        const parentPrefix = isSplitChild
          ? (prefixByPageId.get(p.parent_page_id!) ?? "")
          : null;
        const splitLabel =
          isSplitChild && parentPrefix != null
            ? `${parentPrefix}-${p.split_index}${p.split_suffix ? ` (${p.split_suffix})` : ""}`
            : null;

        return (
          <li
            key={p.idx0}
            className={`group relative rounded border ${borderCls} bg-white`}
          >
            <button
              onClick={() => onToggle(p.idx0)}
              className="block aspect-[2/3] w-full overflow-hidden rounded bg-slate-100"
              aria-label={`page ${splitLabel ?? p.prefix ?? p.idx0}`}
            >
              {p.thumbnail_key ? (
                <img
                  src={`/cdn/${p.thumbnail_key}`}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-slate-400">
                  no thumbnail
                </div>
              )}
            </button>
            <div className="space-y-1 px-2 py-1">
              <div className="flex items-center justify-between text-[11px] text-slate-600">
                <span className="font-mono">
                  {splitLabel ?? p.prefix ?? `#${p.idx0}`}
                </span>
                <Link
                  to={`/projects/${projectId}/pages/${p.idx0}`}
                  className="text-slate-400 hover:text-slate-900"
                >
                  open →
                </Link>
              </div>
              <div className="flex flex-wrap gap-1">
                {ptBadge && (
                  <span className={`rounded px-1 text-[10px] ${ptBadge.cls}`}>
                    {ptBadge.label}
                  </span>
                )}
                {alBadge && (
                  <span className={`rounded px-1 text-[10px] ${alBadge.cls}`}>
                    {alBadge.label}
                  </span>
                )}
                {p.ignore && (
                  <span className="rounded bg-slate-200 px-1 text-[10px] text-slate-600">
                    OUTSIDE
                  </span>
                )}
                {p.processing_status === "complete" && (
                  <span
                    className="rounded bg-emerald-100 px-1 text-[10px] text-emerald-800"
                    title="processed"
                  >
                    ✓
                  </span>
                )}
                {p.processing_status === "processing" && (
                  <span
                    className="rounded bg-sky-100 px-1 text-[10px] text-sky-800"
                    title="processing"
                  >
                    …
                  </span>
                )}
                {p.processing_status === "error" && (
                  <span
                    className="rounded bg-rose-100 px-1 text-[10px] text-rose-800"
                    title={p.processing_error ?? "error"}
                  >
                    ⚠ err
                  </span>
                )}
              </div>
              {isSplitChild && (
                <button
                  onClick={() => unsplit.mutate(p.idx0)}
                  disabled={unsplit.isPending}
                  className="mt-0.5 w-full rounded border border-rose-200 bg-rose-50 px-1 py-0.5 text-[10px] text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                  aria-label={`Reverse split for page ${splitLabel ?? p.prefix}`}
                >
                  Reverse split
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
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

type JobType =
  | "batch_process_pages"
  | "batch_ocr"
  | "batch_text_postprocess"
  | "batch_extract_illustrations"
  | "build_package";

interface JobSnapshot {
  id: string;
  type: string;
  status: string;
  progress: { current: number; total: number; message: string };
  error_message: string | null;
}

const STEPS: { type: JobType; label: string; subtitle: string }[] = [
  {
    type: "batch_process_pages",
    label: "Step 4 — Process pages",
    subtitle:
      "Auto-deskew, threshold, edge-find, rescale all proof-range pages.",
  },
  {
    type: "batch_extract_illustrations",
    label: "Step 4.5 — Extract illustrations",
    subtitle: "Crop hi-res images for every region marked on a page.",
  },
  {
    type: "batch_ocr",
    label: "Step 7 — OCR",
    subtitle: "Run DocTR on every cropped page; layout-aware reorganization.",
  },
  {
    type: "batch_text_postprocess",
    label: "Step 8 — Text post-process",
    subtitle: "Apply scannos, hyphenation join, and custom regex passes.",
  },
  {
    type: "build_package",
    label: "Step 10 — Build package",
    subtitle: "Assemble PNG + TXT + illustrations into the PGDP zip.",
  },
];

function RunPipelinePanel({
  projectId,
  onActivePageChange,
}: {
  projectId: string;
  onActivePageChange: (idx0: number | null) => void;
}) {
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState<Record<JobType, string | null>>({
    batch_process_pages: null,
    batch_ocr: null,
    batch_text_postprocess: null,
    batch_extract_illustrations: null,
    build_package: null,
  });

  // If a batch_process_pages job is already running on this project (e.g.
  // user came back to this page mid-run, or it was kicked off elsewhere),
  // pre-populate `active.batch_process_pages` so the inline progress and
  // tile-pulse render without requiring the user to click Run again.
  // Reuses the shared `["jobs", projectId]` poll so this is free.
  const liveBatch = useActiveBatchJob(projectId, ["batch_process_pages"]);
  useEffect(() => {
    if (liveBatch.jobId && active.batch_process_pages !== liveBatch.jobId) {
      setActive((s) => ({ ...s, batch_process_pages: liveBatch.jobId }));
    }
  }, [liveBatch.jobId, active.batch_process_pages]);

  const submit = useMutation({
    mutationFn: async (type: JobType) => {
      const r = await api.post<{ job_id: string }>("/api/gpu/jobs", {
        project_id: projectId,
        job_type: type,
      });
      setActive((s) => ({ ...s, [type]: r.job_id }));
      return r;
    },
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
                    onCurrentPageChange={
                      step.type === "batch_process_pages"
                        ? onActivePageChange
                        : undefined
                    }
                  />
                )}
                <button
                  onClick={() => submit.mutate(step.type)}
                  disabled={submit.isPending}
                  className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
                >
                  Run
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function JobProgressInline({
  jobId,
  onCurrentPageChange,
}: {
  jobId: string;
  onCurrentPageChange?: (idx0: number | null) => void;
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

// ─── Project title (inline rename) ────────────────────────────────────────

function ProjectTitleEdit({
  projectId,
  currentName,
}: {
  projectId: string;
  currentName: string;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(currentName);

  const rename = useMutation({
    mutationFn: (name: string) =>
      api.patch(`/api/data/projects/${projectId}/config`, {
        name,
        project_config: {},
      }),
    onSuccess: () => {
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  if (!editing) {
    return (
      <h1
        className="group flex cursor-pointer items-center gap-2 text-xl font-semibold"
        onClick={() => {
          setDraft(currentName);
          setEditing(true);
        }}
        title="Click to rename"
      >
        {currentName}
        <span className="text-xs text-slate-400 opacity-0 group-hover:opacity-100">
          edit
        </span>
      </h1>
    );
  }
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.trim()) rename.mutate(draft.trim());
      }}
    >
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
        }}
        className="rounded border border-slate-300 px-2 py-1 text-xl font-semibold"
      />
      <button
        type="submit"
        disabled={rename.isPending}
        className="rounded bg-slate-900 px-2 py-1 text-sm text-white disabled:opacity-50"
      >
        Save
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50"
      >
        Cancel
      </button>
    </form>
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
