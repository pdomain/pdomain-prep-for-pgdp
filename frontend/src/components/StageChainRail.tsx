/**
 * StageChainRail — M3 polished workbench chip rail for the per-page stage DAG.
 *
 * Spec: docs/specs/2026-05-11-workbench-artifact-viewer-design.md §Decision #1
 * Each chip shows a status pill + inline thumbnail (lazy-loaded). Clicking a
 * clean/dirty chip calls onStageSelect; clicking not-run/not-applicable is a
 * no-op (chip is disabled).
 *
 * Visual contract:
 *   - not-run        gray   (disabled)
 *   - running        blue + pulse  (disabled)
 *   - clean          green  (selectable)
 *   - dirty          yellow (selectable)
 *   - failed         red    (disabled)
 *   - not-applicable slate-50 (visually quietest, disabled)
 */

import { useQuery } from "@tanstack/react-query";

import { api } from "../api/client";
import type { components } from "../api/types.gen";
import { useStageEvents } from "../hooks/useStageEvents";

type PageStageState = components["schemas"]["PageStageState"];
type PageStageStatus = components["schemas"]["PageStageStatus"];

interface Props {
  projectId: string;
  idx0: number;
  selectedStageId?: string;
  onStageSelect?: (stageId: string) => void;
}

function chipClassesFor(status: PageStageStatus, selected: boolean): string {
  const ring = selected ? " ring-2 ring-offset-1 ring-blue-500" : "";
  switch (status) {
    case "not-run":
      return `bg-slate-200 text-slate-700 border-slate-300 cursor-default opacity-60${ring}`;
    case "running":
      return `bg-sky-200 text-sky-900 border-sky-400 animate-pulse cursor-default${ring}`;
    case "clean":
      return `bg-emerald-200 text-emerald-900 hover:bg-emerald-300 border-emerald-400 cursor-pointer${ring}`;
    case "dirty":
      return `bg-amber-200 text-amber-900 hover:bg-amber-300 border-amber-400 cursor-pointer${ring}`;
    case "failed":
      return `bg-rose-200 text-rose-900 border-rose-400 cursor-default opacity-70${ring}`;
    case "not-applicable":
      return `bg-slate-50 text-slate-400 border-slate-200 italic cursor-default opacity-60${ring}`;
    default:
      return `bg-slate-200 text-slate-700 border-slate-300${ring}`;
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
  if (row.status === "not-run" || row.status === "not-applicable") {
    parts.push("(no artifact yet)");
  }
  return parts.join("\n");
}

const SELECTABLE: ReadonlySet<PageStageStatus> = new Set(["clean", "dirty"]);

export function StageChainRail({
  projectId,
  idx0,
  selectedStageId,
  onStageSelect,
}: Props) {
  // Subscribe to the per-page SSE stream. Events seed and patch the query
  // cache directly, so the useQuery below gets live updates without polling.
  useStageEvents(projectId, idx0);

  // Initial data load and fallback source of truth for the chip rail.
  // refetchInterval is omitted — SSE pushes status changes in real time.
  const stages = useQuery({
    queryKey: ["page-stages", projectId, idx0],
    queryFn: () =>
      api.get<PageStageState[]>(
        `/api/data/projects/${projectId}/pages/${idx0}/stages`,
      ),
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
        Couldn't load stage state.
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
          const selectable = SELECTABLE.has(row.status);
          const selected = row.stage_id === selectedStageId;
          const cls = chipClassesFor(row.status, selected);
          const thumbUrl = `/api/data/projects/${projectId}/pages/${idx0}/stages/${row.stage_id}/thumbnail`;
          return (
            <span
              key={row.stage_id}
              className="inline-flex flex-col items-center gap-0.5"
            >
              {/* Thumbnail: lazy-load via native loading attribute; only shown
                  when the stage has an artifact (clean or dirty). */}
              {selectable ? (
                <img
                  data-testid={`stage-thumb-${row.stage_id}`}
                  src={thumbUrl}
                  alt={`${row.stage_id} thumbnail`}
                  loading="lazy"
                  className="h-10 w-10 rounded border border-slate-200 object-cover"
                />
              ) : null}
              <button
                type="button"
                data-testid={`stage-chip-${row.stage_id}`}
                data-status={row.status}
                className={`rounded border px-2 py-1 text-[11px] font-mono ${cls}`}
                title={tooltipFor(row)}
                disabled={!selectable}
                onClick={
                  selectable ? () => onStageSelect?.(row.stage_id) : undefined
                }
              >
                {row.stage_id}
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}
