import { useEffect, useState } from "react";
import { api } from "../api/client";

/**
 * Shape of a single SSE event from `/api/gpu/jobs/{id}/events`.
 * `current_page` is a 0-indexed idx0 the worker is currently on for
 * batch_process_pages; null for jobs that don't operate per-page.
 */
export interface JobEvent {
  type: string;
  status: string;
  current: number;
  total: number;
  current_page: number | null;
  message: string;
  error: string | null;
}

interface JobSnapshot {
  id: string;
  type: string;
  status: string;
  progress: { current: number; total: number; message: string };
  error_message: string | null;
}

const TERMINAL = new Set(["complete", "error", "cancelled"]);

/**
 * Subscribe to SSE progress for a single job. Pass `null` to opt out
 * (e.g. when no job is active yet) — the hook then sits idle.
 *
 * Falls back to one-shot GET on EventSource error so the UI still
 * reflects terminal state behind older proxies.
 */
export function useJobProgress(jobId: string | null): {
  event: JobEvent | null;
  error: string | null;
  status: string | null;
  current: number;
  total: number;
  currentPage: number | null;
  isTerminal: boolean;
} {
  const [event, setEvent] = useState<JobEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEvent(null);
    setError(null);
    if (!jobId) return;

    const es = new EventSource(`/api/gpu/jobs/${jobId}/events`);
    es.onmessage = (m) => {
      try {
        const data = JSON.parse(m.data) as JobEvent;
        setEvent(data);
        if (TERMINAL.has(data.status)) es.close();
      } catch {
        /* ignore malformed events */
      }
    };
    es.onerror = () => {
      es.close();
      api
        .get<JobSnapshot>(`/api/data/jobs/${jobId}`)
        .then((j) =>
          setEvent({
            type: "progress",
            status: j.status,
            current: j.progress.current,
            total: j.progress.total,
            current_page: null,
            message: j.progress.message,
            error: j.error_message,
          }),
        )
        .catch((e) => setError((e as Error).message));
    };
    return () => {
      es.close();
    };
  }, [jobId]);

  const status = event?.status ?? null;
  return {
    event,
    error,
    status,
    current: event?.current ?? 0,
    total: event?.total ?? 0,
    currentPage: event?.current_page ?? null,
    isTerminal: status !== null && TERMINAL.has(status),
  };
}
