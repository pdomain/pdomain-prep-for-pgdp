/**
 * StageChainRail — workbench chip rail for the per-page stage DAG.
 *
 * Spec: docs/specs/pipeline-task-model.md §"Per-page stage DAG" + the
 * M2 smoke-test in docs/08-roadmap.md §P0.5 M2. Renders one button-shaped
 * chip per stage in `GET /api/data/projects/{id}/pages/{idx0}/stages`,
 * color-coded by status, clickable to invoke
 * `POST /api/data/projects/{id}/pages/{idx0}/stages/{stage_id}/run`.
 *
 * Visual contract (per the smoke-test):
 *   - not-run        gray
 *   - running        blue + pulse
 *   - clean          green
 *   - dirty          yellow
 *   - failed         red
 *   - not-applicable slate-50 (visually quietest)
 *
 * Tooltip on hover shows last_run_at, error_message (if failed),
 * stage_version, and a truncated input_hash so the user can see exactly
 * what an old artifact's identity was.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "../api/client";
import type { components } from "../api/types.gen";

type PageStageState = components["schemas"]["PageStageState"];
type PageStageStatus = components["schemas"]["PageStageStatus"];

interface Props {
  projectId: string;
  idx0: number;
}

// Status-to-color mapping. Keep short and readable; the tooltip carries
// the precise textual status for users who need it.
function chipClassesFor(status: PageStageStatus): string {
  switch (status) {
    case "not-run":
      return "bg-slate-200 text-slate-700 hover:bg-slate-300 border-slate-300";
    case "running":
      return "bg-sky-200 text-sky-900 hover:bg-sky-300 border-sky-400 animate-pulse";
    case "clean":
      return "bg-emerald-200 text-emerald-900 hover:bg-emerald-300 border-emerald-400";
    case "dirty":
      return "bg-amber-200 text-amber-900 hover:bg-amber-300 border-amber-400";
    case "failed":
      return "bg-rose-200 text-rose-900 hover:bg-rose-300 border-rose-400";
    case "not-applicable":
      return "bg-slate-50 text-slate-400 border-slate-200 italic";
    default:
      return "bg-slate-200 text-slate-700 border-slate-300";
  }
}

function tooltipFor(row: PageStageState): string {
  const parts: string[] = [`status: ${row.status}`];
  if (row.last_run_at !== null) {
    const t = new Date(row.last_run_at * 1000).toISOString();
    parts.push(`last run: ${t}`);
  }
  if (row.stage_version != null) {
    parts.push(`v${row.stage_version}`);
  }
  if (row.input_hash) {
    parts.push(`hash: ${row.input_hash.slice(0, 8)}…`);
  }
  if (row.error_message) {
    parts.push(`error: ${row.error_message}`);
  }
  return parts.join("\n");
}

export function StageChainRail({ projectId, idx0 }: Props) {
  const queryClient = useQueryClient();

  // List all 22 stage rows for this page. Lazy-init runs server-side on
  // first GET; subsequent calls are simple lookups. Poll every 2s while
  // any row is `running` so chip transitions show without manual refresh.
  const stages = useQuery({
    queryKey: ["page-stages", projectId, idx0],
    queryFn: () =>
      api.get<PageStageState[]>(
        `/api/data/projects/${projectId}/pages/${idx0}/stages`,
      ),
    refetchInterval: (q) => {
      const data = q.state.data as PageStageState[] | undefined;
      const anyRunning = (data ?? []).some((row) => row.status === "running");
      return anyRunning ? 2000 : false;
    },
  });

  // Optimistic "in-flight" set so chips show running while the POST is
  // round-tripping. We don't reach for setQueryData here since the server
  // is the source of truth — just a local UI state for responsiveness.
  const [inFlight, setInFlight] = useState<Set<string>>(new Set());

  const runStage = useMutation({
    mutationFn: async (stageId: string): Promise<PageStageState> => {
      setInFlight((prev) => {
        const next = new Set(prev);
        next.add(stageId);
        return next;
      });
      return api.post<PageStageState>(
        `/api/data/projects/${projectId}/pages/${idx0}/stages/${stageId}/run`,
      );
    },
    onSuccess: (state) => {
      toast.success(`stage ${state.stage_id} → ${state.status}`);
      queryClient.invalidateQueries({
        queryKey: ["page-stages", projectId, idx0],
      });
    },
    onError: (err: unknown, stageId) => {
      // The api client throws { status, detail } on non-2xx. Pull a
      // user-readable message from detail when present.
      const e = err as { status?: number; detail?: unknown };
      const detailText =
        typeof e?.detail === "string"
          ? e.detail
          : e?.detail
            ? JSON.stringify(e.detail)
            : "";
      const code = e?.status ?? "?";
      toast.error(`stage ${stageId} failed (HTTP ${code}): ${detailText}`);
      queryClient.invalidateQueries({
        queryKey: ["page-stages", projectId, idx0],
      });
    },
    onSettled: (_data, _err, stageId) => {
      setInFlight((prev) => {
        const next = new Set(prev);
        next.delete(stageId);
        return next;
      });
    },
  });

  if (stages.isPending) {
    return (
      <div
        data-testid="stage-chain-rail"
        className="rounded border bg-white p-3 text-xs text-slate-500"
      >
        Loading stages…
      </div>
    );
  }

  if (stages.isError) {
    return (
      <div
        data-testid="stage-chain-rail"
        className="rounded border border-rose-300 bg-rose-50 p-3 text-xs text-rose-800"
      >
        Couldn’t load stage state.
      </div>
    );
  }

  const rows = stages.data ?? [];

  return (
    <div
      data-testid="stage-chain-rail"
      className="rounded border bg-white p-2"
      role="toolbar"
      aria-label="Per-page stage chain"
    >
      <div className="mb-1 text-[11px] font-medium text-slate-500">
        Stage chain ({rows.length})
      </div>
      <div className="flex flex-wrap gap-1">
        {rows.map((row) => {
          const showRunning =
            row.status === "running" || inFlight.has(row.stage_id);
          const effectiveStatus: PageStageStatus = showRunning
            ? "running"
            : row.status;
          const cls = chipClassesFor(effectiveStatus);
          return (
            <button
              key={row.stage_id}
              type="button"
              data-testid={`stage-chip-${row.stage_id}`}
              data-status={effectiveStatus}
              className={`rounded border px-2 py-1 text-[11px] font-mono ${cls}`}
              title={tooltipFor(row)}
              onClick={() => runStage.mutate(row.stage_id)}
              disabled={showRunning}
            >
              {row.stage_id}
            </button>
          );
        })}
      </div>
    </div>
  );
}
