import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";

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

const STATUS_CLS: Record<string, string> = {
  queued: "bg-slate-100 text-slate-700",
  scheduled: "bg-amber-100 text-amber-800",
  running: "bg-sky-100 text-sky-800",
  complete: "bg-emerald-100 text-emerald-800",
  error: "bg-rose-100 text-rose-800",
  cancelled: "bg-slate-200 text-slate-600",
};

export function JobsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
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

  const isLive = (s: string) =>
    s === "queued" || s === "scheduled" || s === "running";
  const isRetryable = (s: string) => s === "error" || s === "cancelled";

  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">Recent jobs</h1>
        <p className="text-xs text-slate-500">
          Auto-refreshes every 5 seconds.
        </p>
      </header>

      {projectFilter && (
        <div className="flex items-center justify-between rounded border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          <span>
            Filtered to project{" "}
            <span className="font-mono">{projectFilter.slice(0, 8)}</span>
          </span>
          <button
            type="button"
            onClick={clearFilter}
            className="rounded border border-sky-300 px-2 py-0.5 text-sky-800 hover:bg-sky-100"
          >
            Clear filter
          </button>
        </div>
      )}

      {jobs.isLoading && <p className="text-slate-500">Loading…</p>}
      {jobs.error && (
        <p className="text-red-600">
          Error: {(jobs.error as Error).message}
        </p>
      )}

      {jobs.data && jobs.data.length === 0 && (
        <p className="rounded border border-dashed border-slate-300 bg-white p-6 text-center text-slate-500">
          No jobs yet. Run a pipeline step from a project.
        </p>
      )}

      {jobs.data && jobs.data.length > 0 && (
        <ul className="divide-y rounded border bg-white text-sm">
          {jobs.data.map((j) => {
            const cls = STATUS_CLS[j.status] ?? "bg-slate-100 text-slate-700";
            return (
              <li key={j.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-2 py-0.5 text-[11px] font-medium ${cls}`}
                    >
                      {j.status}
                    </span>
                    <span className="font-mono text-xs text-slate-700">
                      {j.type}
                    </span>
                    <Link
                      to={`/projects/${j.project_id}`}
                      className="text-xs text-slate-500 hover:underline"
                    >
                      project {j.project_id.slice(0, 8)}
                    </Link>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-slate-400">
                      {new Date(j.created_at).toLocaleString()}
                    </span>
                    {isLive(j.status) && (
                      <button
                        onClick={() => cancel.mutate(j.id)}
                        disabled={cancel.isPending}
                        className="rounded border border-rose-300 px-2 py-0.5 text-[11px] text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    )}
                    {isRetryable(j.status) && (
                      <button
                        onClick={() => retry.mutate(j.id)}
                        disabled={retry.isPending}
                        className="rounded border border-sky-300 px-2 py-0.5 text-[11px] text-sky-700 hover:bg-sky-50 disabled:opacity-50"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                </div>

                {j.progress.total > 0 && (
                  <div className="mt-1 text-xs text-slate-500">
                    {j.progress.current}/{j.progress.total}
                    {j.progress.message && ` · ${j.progress.message}`}
                  </div>
                )}
                {j.error_message && (
                  <div className="mt-1 text-xs text-rose-700">
                    {j.error_message}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
