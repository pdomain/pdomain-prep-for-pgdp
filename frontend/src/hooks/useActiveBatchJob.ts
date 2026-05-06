import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "../api/client";
import { LIVE_STATUSES } from "../lib/jobStatus";

/**
 * Minimal job shape returned by `/api/data/jobs`. Defined here so consumers
 * don't all need to redeclare the same `JobLite` interface — the data API
 * always returns at least these fields.
 */
export interface JobSnapshot {
  id: string;
  type: string;
  status: string;
  progress: { current: number; total: number; message: string };
}

const DEFAULT_KINDS = ["batch_process_pages"];

export interface UseActiveBatchJobResult {
  /** ID of the most-recent live job of the requested kinds, or null. */
  jobId: string | null;
  /** Status of that job (queued/scheduled/running), or null. */
  status: string | null;
  /** All jobs returned by the poll — useful for callers that want
   *  to render their own filtered views without a second fetch. */
  jobs: JobSnapshot[];
}

/**
 * Light 3s poll of `/api/data/jobs?project_id=…` that returns whichever
 * live (queued/running) job of the requested `kinds` is most recent.
 * Pass `null` for `projectId` to opt out — the hook then sits idle.
 *
 * The data API returns jobs newest-first, so `find()` on the filtered
 * list naturally yields "most recent live job".
 *
 * Designed as the single shared poll for "is a batch running on this
 * project right now?" — pages that need finer-grained progress (current
 * page index, total, percent done) should chain `useJobProgress(jobId)`
 * on top of the `jobId` this returns.
 */
export function useActiveBatchJob(
  projectId: string | null,
  kinds: string[] = DEFAULT_KINDS,
): UseActiveBatchJobResult {
  const kindsKey = kinds.join(",");
  const query = useQuery({
    queryKey: ["jobs", projectId],
    queryFn: () =>
      api.get<JobSnapshot[]>(
        `/api/data/jobs?limit=20&project_id=${encodeURIComponent(
          projectId ?? "",
        )}`,
      ),
    refetchInterval: 3000,
    enabled: Boolean(projectId),
  });

  const liveJob = useMemo(() => {
    if (!query.data) return null;
    const wanted = new Set(kinds);
    return (
      query.data.find(
        (j) => wanted.has(j.type) && LIVE_STATUSES.has(j.status),
      ) ?? null
    );
    // kindsKey covers `kinds` array identity changes without forcing
    // callers to memoize the array themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, kindsKey]);

  return {
    jobId: liveJob?.id ?? null,
    status: liveJob?.status ?? null,
    jobs: query.data ?? [],
  };
}
