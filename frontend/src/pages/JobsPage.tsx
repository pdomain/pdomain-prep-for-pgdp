/**
 * JobsPage — hi-fi redesign P3-1: PageHeader + filter ToggleGroup + Card layout.
 *
 * The page fetches the jobs list (auto-refreshes every 5 s) and renders:
 *   - PageHeader "Jobs".
 *   - Filter ToggleGroup (All / Running / Queued / Done / Errored / Awaiting review).
 *   - Job rows as Cards with: type + id, Progress bar, Badge status,
 *     Logs IconButton, and More DropdownMenu (copy job ID, cancel, retry).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { FileText, MoreHorizontal } from "lucide-react";
import { api } from "../api/client";
import { isLiveStatus } from "../lib/jobStatus";
import { Badge } from "../components/ui/Badge";
import type { BadgeStatus } from "../components/ui/Badge";
import { Card } from "../components/ui/Card";
import { Progress } from "../components/ui/Progress";
import { IconButton } from "../components/ui/IconButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/DropdownMenu";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/ToggleGroup";
import { PageHeader } from "../components/shell/PageHeader";

interface Job {
  id: string;
  project_id: string;
  type: string;
  status: string;
  progress: { current: number; total: number; message: string };
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  next_dispatch_at: string | null;
  error_message: string | null;
}

/** Map raw API status strings to BadgeStatus. Unknown statuses fall through to "queued". */
function toBadgeStatus(status: string): BadgeStatus {
  const map: Record<string, BadgeStatus> = {
    queued: "queued",
    scheduled: "scheduled",
    running: "running",
    complete: "complete",
    error: "error",
    cancelled: "cancelled",
    awaiting_review: "awaiting_review",
  };
  return map[status] ?? "queued";
}

/** Map filter tab values to raw status strings. "all" means no filter. */
function matchesFilter(job: Job, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "running") return isLiveStatus(job.status);
  if (filter === "queued")
    return job.status === "queued" || job.status === "scheduled";
  if (filter === "done") return job.status === "complete";
  if (filter === "errored")
    return job.status === "error" || job.status === "cancelled";
  if (filter === "review") return job.status === "awaiting_review";
  return true;
}

export function JobsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState("all");

  const projectFilter = searchParams.get("project_id") ?? "";
  const jobsUrl = projectFilter
    ? `/api/data/jobs?limit=50&project_id=${encodeURIComponent(projectFilter)}`
    : "/api/data/jobs?limit=50";

  const jobs = useQuery({
    queryKey: ["jobs", projectFilter],
    queryFn: () => api.get<Job[]>(jobsUrl),
    refetchInterval: 5000,
  });

  const clearFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("project_id");
    setSearchParams(next);
  };

  const cancel = useMutation({
    mutationFn: (id: string) => api.delete(`/api/gpu/jobs/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });

  const retry = useMutation({
    mutationFn: (id: string) => api.post(`/api/gpu/jobs/${id}/retry`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });

  const isRetryable = (s: string) => s === "error" || s === "cancelled";
  const allJobs = jobs.data ?? [];
  const liveCount = allJobs.filter((j) => isLiveStatus(j.status)).length;
  const filteredJobs = allJobs.filter((j) => matchesFilter(j, statusFilter));

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  return (
    <section>
      <PageHeader
        title="Jobs"
        description="Auto-refreshes every 5 seconds."
        actions={
          liveCount > 0 ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-800 ring-1 ring-inset ring-sky-200"
              title={`${liveCount} job${liveCount === 1 ? "" : "s"} in flight`}
            >
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500"
              />
              live: {liveCount}
            </span>
          ) : undefined
        }
      />

      {/* Filter ToggleGroup */}
      <div className="px-6 py-3 border-b border-border-1">
        <ToggleGroup
          type="single"
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v || "all")}
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="running">Running</ToggleGroupItem>
          <ToggleGroupItem value="queued">Queued</ToggleGroupItem>
          <ToggleGroupItem value="done">Done</ToggleGroupItem>
          <ToggleGroupItem value="errored">Errored</ToggleGroupItem>
          <ToggleGroupItem value="review">Awaiting review</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="px-6 py-4 space-y-3">
        {projectFilter && (
          <div className="flex items-center justify-between rounded border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
            <span>
              Filtered to project{" "}
              <span className="font-mono">{projectFilter.slice(0, 8)}</span>
            </span>
            <button
              type="button"
              aria-label="Clear filter"
              onClick={clearFilter}
              className="rounded border border-sky-300 px-2 py-0.5 text-sky-800 hover:bg-sky-100"
            >
              Clear filter
            </button>
          </div>
        )}

        {jobs.isLoading && <p className="text-ink-3">Loading…</p>}
        {jobs.error && (
          <p className="text-status-error">
            Error: {(jobs.error as Error).message}
          </p>
        )}

        {jobs.data && filteredJobs.length === 0 && (
          <p className="rounded border border-dashed border-border-1 bg-bg-surface p-6 text-center text-ink-3">
            {allJobs.length === 0
              ? "No jobs yet. Run a pipeline step from a project."
              : "No jobs match the current filter."}
          </p>
        )}

        {filteredJobs.length > 0 && (
          <div className="space-y-2">
            {filteredJobs.map((j) => {
              const progressPct =
                j.progress.total > 0
                  ? Math.round((j.progress.current / j.progress.total) * 100)
                  : 0;

              return (
                <Card key={j.id} className="overflow-hidden">
                  <div
                    className="grid items-center gap-3 p-4"
                    style={{
                      gridTemplateColumns: "1fr 220px 140px 110px",
                    }}
                  >
                    {/* Job identity */}
                    <div>
                      <p className="text-sm font-medium text-ink-1">{j.type}</p>
                      <p className="text-xs text-ink-3 font-mono">{j.id}</p>
                      <Link
                        to={`/projects/${j.project_id}`}
                        className="text-xs text-ink-3 hover:underline"
                      >
                        project {j.project_id.slice(0, 8)}
                      </Link>
                    </div>

                    {/* Progress */}
                    <div className="space-y-1">
                      <Progress value={progressPct} />
                      {j.progress.total > 0 && (
                        <p className="text-xs text-ink-3">
                          {j.progress.current} / {j.progress.total}
                          {j.progress.message && ` · ${j.progress.message}`}
                        </p>
                      )}
                      {j.error_message && (
                        <p className="text-xs text-status-error">
                          {j.error_message}
                        </p>
                      )}
                    </div>

                    {/* Status badge */}
                    <div>
                      <Badge status={toBadgeStatus(j.status)} />
                    </div>

                    {/* Action cluster */}
                    <div className="flex items-center justify-end gap-1">
                      {/* Logs button (placeholder — opens nothing yet) */}
                      <IconButton
                        variant="ghost"
                        aria-label="View logs"
                        title="View logs"
                      >
                        <FileText className="h-4 w-4" />
                      </IconButton>

                      {/* More DropdownMenu */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton variant="ghost" aria-label="More actions">
                            <MoreHorizontal className="h-4 w-4" />
                          </IconButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => copyToClipboard(j.id)}
                          >
                            Copy job ID
                          </DropdownMenuItem>
                          {isLiveStatus(j.status) && (
                            <DropdownMenuItem
                              onClick={() => cancel.mutate(j.id)}
                              disabled={cancel.isPending}
                            >
                              Cancel
                            </DropdownMenuItem>
                          )}
                          {isRetryable(j.status) && (
                            <DropdownMenuItem
                              onClick={() => retry.mutate(j.id)}
                              disabled={retry.isPending}
                            >
                              Retry
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
