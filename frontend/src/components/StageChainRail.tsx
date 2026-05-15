/**
 * StageChainRail — M3 polished workbench chip rail for the per-page stage DAG.
 *
 * Spec: docs/specs/2026-05-11-workbench-artifact-viewer-design.md §Decision #1
 * Each chip shows a status pill + inline thumbnail (lazy-loaded) for image-type
 * stages, or a text icon for JSON/text-output stages. Clicking a clean/dirty
 * chip calls onStageSelect; clicking not-run/not-applicable is a no-op (chip
 * is disabled). A "Run this stage" button appears in the selected chip's
 * expanded context — clicks are delegated to onStageRun.
 *
 * Thumbnail freshness: the /thumbnail URL carries no ?v= cache-busting param.
 * The backend emits an ETag echoing the artifact's input_hash; the browser
 * sends If-None-Match on re-fetches and gets a 304 when unchanged. This means
 * re-run thumbnails reload automatically without a hard refresh as soon as the
 * ETag changes.
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
  onStageRun?: (stageId: string) => void;
}

function chipClassesFor(status: PageStageStatus, selected: boolean): string {
  const ring = selected ? " ring-2 ring-offset-1 ring-blue-500" : "";
  switch (status) {
    case "not-run":
      return `bg-slate-200 text-slate-700 border-slate-300 hover:bg-slate-300 cursor-pointer${ring}`;
    case "running":
      return `bg-sky-200 text-sky-900 border-sky-400 animate-pulse cursor-default${ring}`;
    case "clean":
      return `bg-emerald-200 text-emerald-900 hover:bg-emerald-300 border-emerald-400 cursor-pointer${ring}`;
    case "dirty":
      return `bg-amber-200 text-amber-900 hover:bg-amber-300 border-amber-400 cursor-pointer${ring}`;
    case "failed":
      return `bg-rose-200 text-rose-900 border-rose-400 hover:bg-rose-300 cursor-pointer${ring}`;
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

// Stages that can be clicked to select (shows in controls panel + viewer).
// Includes not-run and failed so users can select them and hit "Run this stage"
// in the controls panel — the only way to advance a not-run chain from the UI.
// running and not-applicable are excluded: running is in-flight, not-applicable
// has no impl for this page type.
const SELECTABLE: ReadonlySet<PageStageStatus> = new Set([
  "clean",
  "dirty",
  "not-run",
  "failed",
]);

// Stages with on-disk artifacts (thumbnail + artifact viewer available).
const HAS_ARTIFACT: ReadonlySet<PageStageStatus> = new Set(["clean", "dirty"]);

// Stage output type → whether the stage produces an image artifact.
// Mirrors STAGE_OUTPUT_TYPE / IMAGE_OUTPUT_TYPES in ArtifactViewer.tsx.
// Used to decide whether to show a thumbnail or a text icon in the chip.
const IMAGE_STAGE_IDS = new Set([
  "ingest_source",
  "thumbnail",
  "decode_source",
  "initial_crop",
  "manual_deskew_pre",
  "grayscale",
  "threshold",
  "invert",
  "crop_to_content",
  "auto_deskew",
  "morph_fill",
  "rescale",
  "canvas_map",
  "blank_proof_synth",
  "ocr_crop",
  "extract_illustrations",
]);

export function StageChainRail({
  projectId,
  idx0,
  selectedStageId,
  onStageSelect,
  onStageRun,
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
          const hasArtifact = HAS_ARTIFACT.has(row.status);
          const selected = row.stage_id === selectedStageId;
          const cls = chipClassesFor(row.status, selected);
          const isImageStage = IMAGE_STAGE_IDS.has(row.stage_id);
          const thumbUrl = `/api/data/projects/${projectId}/pages/${idx0}/stages/${row.stage_id}/thumbnail`;
          return (
            <span
              key={row.stage_id}
              className="inline-flex flex-col items-center gap-0.5"
            >
              {/* Thumbnail or text icon: shown when the stage has an artifact
                  (clean or dirty). Image-type stages get a lazy-loaded img;
                  text/JSON-type stages get a small text icon. The thumbnail
                  URL carries no ?v= param — the browser handles ETag
                  revalidation (If-None-Match) natively. */}
              {hasArtifact && isImageStage ? (
                <img
                  data-testid={`stage-thumb-${row.stage_id}`}
                  src={thumbUrl}
                  alt={`${row.stage_id} thumbnail`}
                  loading="lazy"
                  className="h-10 w-10 rounded border border-slate-200 object-cover"
                />
              ) : hasArtifact && !isImageStage ? (
                <span
                  data-testid={`stage-icon-${row.stage_id}`}
                  className="flex h-10 w-10 items-center justify-center rounded border border-slate-200 bg-slate-100 text-xs text-slate-500"
                  title="Text artifact"
                  aria-label="Text artifact"
                >
                  {"{}"}
                </span>
              ) : null}
              <button
                type="button"
                data-testid={`stage-chip-${row.stage_id}`}
                data-status={row.status}
                data-stage-id={row.stage_id}
                className={`rounded border px-2 py-1 text-[11px] font-mono ${cls}`}
                title={tooltipFor(row)}
                disabled={!selectable}
                onClick={
                  selectable ? () => onStageSelect?.(row.stage_id) : undefined
                }
              >
                {row.stage_id}
              </button>
              {/* Run button: only shown for the selected selectable chip.
                  This replaces click-to-run semantics: clicking the chip
                  selects it; clicking "Run" triggers the stage. */}
              {selectable && selected ? (
                <button
                  type="button"
                  data-testid={`stage-run-btn-${row.stage_id}`}
                  onClick={() => onStageRun?.(row.stage_id)}
                  className="rounded border border-emerald-400 bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-800 hover:bg-emerald-100"
                >
                  Run
                </button>
              ) : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}
