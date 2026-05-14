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

  useEffect(() => {
    setError(null);
    setIsConnected(false);
    if (projectId === null || idx0 === null) return;
    if (typeof EventSource === "undefined") return;

    const url = `/api/data/projects/${projectId}/pages/${idx0}/events`;
    const es = new EventSource(url);
    const queryKey = ["page-stages", projectId, idx0] as const;

    const onSnapshot = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as {
          type: string;
          stages: PageStageState[];
        };
        if (data.type === "snapshot") {
          queryClient.setQueryData(queryKey, data.stages);
          setIsConnected(true);
          setError(null);
        }
      } catch {
        /* ignore malformed frames */
      }
    };

    const onStageEvent = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as {
          stage_id: string;
          status: string;
        };
        queryClient.setQueryData(
          queryKey,
          (prev: PageStageState[] | undefined) => {
            if (!prev) return prev;
            return prev.map((row) =>
              row.stage_id === data.stage_id
                ? { ...row, status: data.status as PageStageState["status"] }
                : row,
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
