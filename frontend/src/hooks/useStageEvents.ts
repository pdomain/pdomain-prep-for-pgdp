/**
 * useStageEvents — subscribes to the per-page SSE stream and keeps the
 * TanStack Query cache for ["page-stages", projectId, idx0] up to date in
 * real time.
 *
 * The hook opens an EventSource to GET /api/data/projects/{id}/pages/{idx0}/events.
 * The first frame is a "snapshot" event that seeds the cache with all 22 stage
 * rows; subsequent "stage-status" and "stage-progress" frames mutate individual
 * rows in-place. EventSource reconnects automatically on network errors (browser
 * built-in).
 *
 * Spec: docs/specs/2026-05-11-workbench-artifact-viewer-design.md §Decision #4
 */

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { components } from "../api/types.gen";

type PageStageState = components["schemas"]["PageStageState"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStatus(value: unknown): value is PageStageState["status"] {
  return (
    value === "not-run" ||
    value === "running" ||
    value === "clean" ||
    value === "dirty" ||
    value === "failed" ||
    value === "not-applicable"
  );
}

function isPageStage(value: unknown): value is PageStageState {
  if (!isRecord(value) || !isStatus(value["status"])) return false;
  return (
    typeof value["project_id"] === "string" &&
    typeof value["page_id"] === "string" &&
    typeof value["stage_id"] === "string" &&
    typeof value["stage_version"] === "number" &&
    [
      "artifact_key",
      "config_hash",
      "input_hash",
      "error_message",
      "job_id",
    ].every((key) => value[key] === null || typeof value[key] === "string") &&
    ["last_run_at", "duration_ms"].every(
      (key) => value[key] === null || typeof value[key] === "number",
    )
  );
}

export interface StageEventsResult {
  isConnected: boolean;
  error: string | null;
}

export function useStageEvents(
  projectId: string | null,
  idx0: number | null,
): StageEventsResult {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Reset connection state as soon as the target page changes, adjusted
  // during render (https://react.dev/learn/you-might-not-need-an-effect)
  // instead of at the top of the effect below, so a stale error/connected
  // flag from the previous page never paints even for one frame.
  const stageKey =
    projectId === null || idx0 === null ? null : `${projectId}:${idx0}`;
  const [prevStageKey, setPrevStageKey] = useState(stageKey);
  if (stageKey !== prevStageKey) {
    setPrevStageKey(stageKey);
    setError(null);
    setIsConnected(false);
  }

  useEffect(() => {
    if (projectId === null || idx0 === null) return;
    if (typeof EventSource === "undefined") return;

    const url = `/api/data/projects/${projectId}/pages/${idx0}/events`;
    const es = new EventSource(url);
    const queryKey = ["page-stages", projectId, idx0] as const;

    const onSnapshot = (e: MessageEvent<unknown>) => {
      try {
        if (typeof e.data !== "string") return;
        const data: unknown = JSON.parse(e.data);
        if (
          isRecord(data) &&
          data["type"] === "snapshot" &&
          Array.isArray(data["stages"]) &&
          data["stages"].every(isPageStage)
        ) {
          queryClient.setQueryData(queryKey, data["stages"]);
          setIsConnected(true);
          setError(null);
        }
      } catch {
        /* ignore malformed frames */
      }
    };

    const onStageEvent = (e: MessageEvent<unknown>) => {
      try {
        if (typeof e.data !== "string") return;
        const data: unknown = JSON.parse(e.data);
        if (
          !isRecord(data) ||
          typeof data["stage_id"] !== "string" ||
          !isStatus(data["status"])
        )
          return;
        const { stage_id, status } = data;
        queryClient.setQueryData(
          queryKey,
          (prev: PageStageState[] | undefined) => {
            if (!prev) return prev;
            return prev.map((row) =>
              row.stage_id === stage_id ? { ...row, status: status } : row,
            );
          },
        );
      } catch {
        /* ignore malformed frames */
      }
    };

    es.addEventListener("snapshot", onSnapshot);
    es.addEventListener("stage-status", onStageEvent);
    es.addEventListener("stage-progress", onStageEvent);

    es.onerror = () => {
      setError(
        "SSE connection error — EventSource will reconnect automatically",
      );
      setIsConnected(false);
    };

    return () => {
      es.removeEventListener("snapshot", onSnapshot);
      es.removeEventListener("stage-status", onStageEvent);
      es.removeEventListener("stage-progress", onStageEvent);
      es.close();
    };
  }, [projectId, idx0, queryClient]);

  return { isConnected, error };
}
