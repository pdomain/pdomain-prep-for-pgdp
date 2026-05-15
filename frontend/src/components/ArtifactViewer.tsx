/**
 * ArtifactViewer — M3 side-by-side artifact viewer.
 *
 * Spec: docs/specs/2026-05-11-workbench-artifact-viewer-design.md §Decision #2
 *
 * Two stage selectors (Stage / Compare with). Primary is synced from the
 * chip-rail's selectedStageId prop; Compare defaults to the immediate
 * upstream stage with an artifact. Both panes stream from the artifact
 * endpoint with `?v=<last_run_at>` cache-busting.
 *
 * Non-image stages (bbox, page_attrs, etc.) render as a text link rather
 * than an <img>. extract_illustrations shows an illustration-panel
 * placeholder (the full panel is wired in a later slice).
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { api } from "../api/client";
import type { components } from "../api/types.gen";
import { Card } from "./ui/Card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/Select";

type PageStageState = components["schemas"]["PageStageState"];

// ─── DAG upstream map (first depends_on per stage, spec-locked) ──────────────
// Mirrors _STAGE_DAG_TABLE in core/pipeline/stage_dag.py.
// Used to auto-select the default Compare stage.
const STAGE_UPSTREAM: Record<string, string | null> = {
  ingest_source: null,
  thumbnail: "ingest_source",
  auto_detect_attrs: "ingest_source",
  auto_detect_illustrations: "ingest_source",
  decode_source: "ingest_source",
  initial_crop: "decode_source",
  manual_deskew_pre: "initial_crop",
  grayscale: "manual_deskew_pre",
  threshold: "grayscale",
  invert: "threshold",
  find_content_edges: "invert",
  crop_to_content: "invert",
  auto_deskew: "crop_to_content",
  morph_fill: "auto_deskew",
  rescale: "morph_fill",
  canvas_map: "rescale",
  blank_proof_synth: "auto_detect_attrs",
  ocr_crop: "canvas_map",
  extract_illustrations: "auto_detect_illustrations",
  ocr: "ocr_crop",
  text_postprocess: "ocr",
  text_review: "text_postprocess",
};

// ─── Stage output type → render mode ────────────────────────────────────────
const STAGE_OUTPUT_TYPE: Record<string, string> = {
  ingest_source: "image_bytes",
  thumbnail: "jpeg_bytes",
  auto_detect_attrs: "page_attrs",
  auto_detect_illustrations: "illustration_regions",
  decode_source: "image",
  initial_crop: "image",
  manual_deskew_pre: "image",
  grayscale: "gray",
  threshold: "binary",
  invert: "binary",
  find_content_edges: "bbox",
  crop_to_content: "binary",
  auto_deskew: "binary",
  morph_fill: "binary",
  rescale: "image",
  canvas_map: "image_bytes",
  blank_proof_synth: "image_bytes",
  ocr_crop: "image_bytes",
  extract_illustrations: "hi_res_crops",
  ocr: "words+text",
  text_postprocess: "text",
  text_review: "text+attestation",
};

const IMAGE_OUTPUT_TYPES = new Set([
  "image_bytes",
  "jpeg_bytes",
  "image",
  "gray",
  "binary",
]);

const SELECTABLE: ReadonlySet<string> = new Set(["clean", "dirty"]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function artifactUrl(
  projectId: string,
  idx0: number,
  stage: PageStageState,
): string {
  const base = `/api/data/projects/${projectId}/pages/${idx0}/stages/${stage.stage_id}/artifact`;
  return stage.last_run_at !== null ? `${base}?v=${stage.last_run_at}` : base;
}

/** Walk upstream until we find a stage that has an artifact. */
function findUpstreamWithArtifact(
  stageId: string,
  available: PageStageState[],
): string | undefined {
  const ids = new Set(available.map((s) => s.stage_id));
  let cur: string | null = STAGE_UPSTREAM[stageId] ?? null;
  while (cur !== null) {
    if (ids.has(cur)) return cur;
    cur = STAGE_UPSTREAM[cur] ?? null;
  }
  return undefined;
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  projectId: string;
  idx0: number;
  /** Stage selected by the chip rail; updates primary selector + resets compare. */
  selectedStageId?: string;
}

export function ArtifactViewer({ projectId, idx0, selectedStageId }: Props) {
  const stages = useQuery({
    queryKey: ["page-stages", projectId, idx0],
    queryFn: () =>
      api.get<PageStageState[]>(
        `/api/data/projects/${projectId}/pages/${idx0}/stages`,
      ),
  });

  const available = (stages.data ?? []).filter((s) => SELECTABLE.has(s.status));

  const [primaryId, setPrimaryId] = useState<string | undefined>(
    selectedStageId,
  );
  // undefined = auto-derive from upstream; non-undefined = user override
  const [compareId, setCompareId] = useState<string | undefined>(undefined);

  // Sync from chip-rail prop: update primary and reset compare override
  useEffect(() => {
    if (selectedStageId === primaryId) return;
    setPrimaryId(selectedStageId);
    setCompareId(undefined);
  }, [selectedStageId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pane is hidden when no chip is selected — selectedStageId drives visibility.
  if (!selectedStageId) return null;

  // Derive compare: explicit override first, then auto-upstream
  const compareIdResolved =
    compareId ??
    (primaryId ? findUpstreamWithArtifact(primaryId, available) : undefined);

  const primaryStage = available.find((s) => s.stage_id === primaryId);
  const compareStage = available.find((s) => s.stage_id === compareIdResolved);

  if (stages.isPending) {
    return (
      <Card
        data-testid="artifact-viewer"
        className="p-3 text-xs text-slate-500"
      >
        Loading…
      </Card>
    );
  }

  if (available.length === 0) {
    return (
      <Card
        data-testid="artifact-viewer"
        className="p-4 text-sm text-slate-500"
      >
        No stage artifacts yet. Run a stage to view its output here.
      </Card>
    );
  }

  return (
    <Card
      data-testid="artifact-viewer"
      className="overflow-hidden space-y-3 p-3"
    >
      {/* Selectors row */}
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-slate-600">Stage:</span>
          <Select
            value={primaryId ?? ""}
            onValueChange={(value) => setPrimaryId(value || undefined)}
          >
            <SelectTrigger
              data-testid="artifact-primary-select"
              className="rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <SelectValue placeholder="— select —" />
            </SelectTrigger>
            <SelectContent>
              {available.length > 0 ? (
                available.map((s) => (
                  <SelectItem key={s.stage_id} value={s.stage_id}>
                    {s.stage_id}
                  </SelectItem>
                ))
              ) : (
                <div className="px-2 py-1 text-xs text-slate-400">
                  No stages available
                </div>
              )}
            </SelectContent>
          </Select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-slate-600">Compare with:</span>
          <Select
            value={compareIdResolved ?? ""}
            onValueChange={(value) => setCompareId(value || undefined)}
          >
            <SelectTrigger
              data-testid="artifact-compare-select"
              className="rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <SelectValue placeholder="— none —" />
            </SelectTrigger>
            <SelectContent>
              {available.length > 0 ? (
                available.map((s) => (
                  <SelectItem key={s.stage_id} value={s.stage_id}>
                    {s.stage_id}
                  </SelectItem>
                ))
              ) : (
                <div className="px-2 py-1 text-xs text-slate-400">
                  No stages available
                </div>
              )}
            </SelectContent>
          </Select>
        </label>
      </div>

      {/* Side-by-side panes */}
      <div className="grid grid-cols-2 gap-3">
        <div
          data-testid="artifact-primary-pane"
          className="overflow-auto rounded border bg-slate-50"
        >
          {primaryStage ? (
            <ArtifactPane
              projectId={projectId}
              idx0={idx0}
              stage={primaryStage}
              paneId="primary"
            />
          ) : (
            <div className="p-4 text-xs text-slate-400">
              Select a stage above
            </div>
          )}
        </div>
        <div
          data-testid="artifact-compare-pane"
          className="overflow-auto rounded border bg-slate-50"
        >
          {compareStage ? (
            <ArtifactPane
              projectId={projectId}
              idx0={idx0}
              stage={compareStage}
              paneId="compare"
            />
          ) : (
            <div className="p-4 text-xs text-slate-400">
              Select a stage to compare
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ─── Artifact pane ────────────────────────────────────────────────────────────

function ArtifactPane({
  projectId,
  idx0,
  stage,
  paneId,
}: {
  projectId: string;
  idx0: number;
  stage: PageStageState;
  paneId: "primary" | "compare";
}) {
  const url = artifactUrl(projectId, idx0, stage);
  const outputType = STAGE_OUTPUT_TYPE[stage.stage_id] ?? "image_bytes";

  if (stage.stage_id === "extract_illustrations") {
    return (
      <div
        data-testid="artifact-illustrations-panel"
        className="p-4 text-xs text-slate-600"
      >
        Illustration artifacts — use the Illustrations panel below.
      </div>
    );
  }

  if (IMAGE_OUTPUT_TYPES.has(outputType)) {
    return (
      <img
        data-testid={`artifact-${paneId}-img`}
        src={url}
        alt={`${stage.stage_id} artifact`}
        className="w-full"
      />
    );
  }

  return (
    <div
      data-testid={`artifact-${paneId}-text`}
      className="whitespace-pre-wrap p-3 font-mono text-xs text-slate-700"
    >
      <a
        href={url}
        className="text-xs text-blue-600 hover:underline"
        target="_blank"
        rel="noreferrer"
      >
        View {stage.stage_id} artifact →
      </a>
    </div>
  );
}
