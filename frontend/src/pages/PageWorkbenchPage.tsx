import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  Image as KonvaImage,
  Layer,
  Rect,
  Stage,
  Transformer,
} from "react-konva";
import type Konva from "konva";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { components } from "../api/types.gen";

type AlignmentOverride = components["schemas"]["AlignmentOverride"];
type PageRecord = components["schemas"]["PageRecord"];
type PageType = components["schemas"]["PageType"];
// Local form state mutates fields incrementally → use the Input variant
// (every field optional). PageRecord.config_overrides on the wire is the
// Output variant (every field present), but the workbench reads via React
// state typed as Input; TypeScript narrows fine because Output is structurally
// a subtype.
type PageConfigOverrides = components["schemas"]["PageConfigOverrides-Input"];
// PATCH /api/data/projects/{id}/pages/{idx0} accepts UpdatePageRequest
// (Input-side, fields nullable). The previous hand-written shape used
// Partial<PageRecord> which conflated Input and Output; types.gen forces us
// to be precise.
type UpdatePageRequest = components["schemas"]["UpdatePageRequest"];
import { useJobProgress } from "../hooks/useJobProgress";
import { useActiveBatchJob } from "../hooks/useActiveBatchJob";
import { ArtifactViewer } from "../components/ArtifactViewer";
import { StageChainRail } from "../components/StageChainRail";
import { StageControlsPanel } from "../components/StageControlsPanel";

interface ProcessPageResponse {
  processed_image_key: string;
  processed_image_url: string;
  dimensions: [number, number];
  processing_time_ms: number;
  backend: string;
  cold_start_ms: number;
}

interface PageSplit {
  suffix: string;
  reading_order: number;
  L: number | null;
  R: number | null;
  T: number | null;
  B: number | null;
  scale_to_standard_page: boolean;
  alignment: AlignmentOverride | null;
  ocr_engine: "doctr" | "tesseract" | null;
}

interface IllustrationRegion {
  index: number;
  label: string;
  type: "illustration" | "decoration" | "plate";
  L: number | null;
  R: number | null;
  T: number | null;
  B: number | null;
  output_format: "jpg" | "png";
  jpeg_quality: number;
  convert_to_grayscale: boolean;
}

type EditMode = "view" | "split" | "illustration" | "create-sibling";

const PAGE_TYPES: PageType[] = [
  "normal",
  "blank",
  "plate_b",
  "plate_p",
  "plate_r",
];
const ALIGNMENTS: AlignmentOverride[] = ["default", "top", "center", "bottom"];

export function PageWorkbenchPage() {
  const { projectId = "", idx0: idx0Str = "0" } = useParams();
  const idx0 = Number(idx0Str);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const page = useQuery({
    queryKey: ["page", projectId, idx0],
    queryFn: () =>
      api.get<PageRecord>(`/api/data/projects/${projectId}/pages/${idx0}`),
  });

  // Look for a running batch_process_pages job on this project so we can
  // show a "Processing…" badge if the worker is on this very page.
  const activeBatch = useActiveBatchJob(projectId || null);
  const liveBatchJobId = activeBatch.jobId;
  const jobProgress = useJobProgress(liveBatchJobId);
  const isProcessingThisPage =
    jobProgress.currentPage !== null && jobProgress.currentPage === idx0;

  // When a batch job finishes, the page record on disk is now stale —
  // refresh so the user sees the new processed_image / status without a
  // manual reload.
  useEffect(() => {
    if (jobProgress.isTerminal && liveBatchJobId) {
      queryClient.invalidateQueries({ queryKey: ["page", projectId, idx0] });
      queryClient.invalidateQueries({ queryKey: ["jobs", projectId] });
    }
  }, [jobProgress.isTerminal, liveBatchJobId, queryClient, projectId, idx0]);

  // Also refresh as the worker advances PAST this page (current_page moved
  // beyond idx0) — at that point this page's record is freshly written.
  useEffect(() => {
    if (
      jobProgress.currentPage !== null &&
      jobProgress.currentPage > idx0 &&
      liveBatchJobId
    ) {
      queryClient.invalidateQueries({ queryKey: ["page", projectId, idx0] });
    }
  }, [jobProgress.currentPage, idx0, liveBatchJobId, queryClient, projectId]);

  const [overrides, setOverrides] = useState<PageConfigOverrides>({});
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<EditMode>("view");
  const [selectedStageId, setSelectedStageId] = useState<string | undefined>(
    undefined,
  );

  // Create-sibling split state: bbox drawn by user + suffix list.
  const [siblingBbox, setSiblingBbox] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [siblingSuffixes, setSiblingSuffixes] = useState("a,b");

  const createSiblings = useMutation({
    mutationFn: (body: {
      bbox: [number, number, number, number];
      split_at_stage: string;
      suffixes: string[];
    }) =>
      api.post<{ children: PageRecord[] }>(
        `/api/data/projects/${projectId}/pages/${idx0}/split`,
        body,
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["pages", projectId] });
      const first = data.children[0];
      if (first) navigate(`/projects/${projectId}/pages/${first.idx0}`);
    },
  });

  useEffect(() => {
    if (page.data) setOverrides(page.data.config_overrides);
  }, [page.data]);

  const preview = useMutation({
    mutationFn: () =>
      api.post<ProcessPageResponse>("/api/gpu/process-page", {
        project_id: projectId,
        idx0,
        config_overrides: overrides,
        output_context: "workbench",
      }),
    onSuccess: (resp) => setPreviewUrl(resp.processed_image_url),
  });

  const commitOverrides = useMutation({
    mutationFn: (patch: UpdatePageRequest) =>
      api.patch<PageRecord>(
        `/api/data/projects/${projectId}/pages/${idx0}`,
        patch,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["page", projectId, idx0] });
      queryClient.invalidateQueries({ queryKey: ["pages", projectId] });
    },
  });

  if (page.isLoading) return <p className="text-slate-500">Loading…</p>;
  if (!page.data) return <p className="text-red-600">Page not found.</p>;

  const handleAddSplit = (rect: {
    L: number;
    R: number;
    T: number;
    B: number;
  }) => {
    const splits = (page.data!.splits as PageSplit[]) ?? [];
    const next: PageSplit = {
      suffix: nextSplitSuffix(splits),
      reading_order: splits.length,
      L: rect.L,
      R: rect.R,
      T: rect.T,
      B: rect.B,
      scale_to_standard_page: true,
      alignment: null,
      ocr_engine: null,
    };
    commitOverrides.mutate({ splits: [...splits, next] as any });
  };

  const handleAddRegion = (rect: {
    L: number;
    R: number;
    T: number;
    B: number;
  }) => {
    const regions =
      (page.data!.illustration_regions as IllustrationRegion[]) ?? [];
    const next: IllustrationRegion = {
      index: regions.length + 1,
      label: "",
      type: "illustration",
      L: rect.L,
      R: rect.R,
      T: rect.T,
      B: rect.B,
      output_format: "jpg",
      jpeg_quality: 85,
      convert_to_grayscale: false,
    };
    commitOverrides.mutate({
      illustration_regions: [...regions, next] as any,
    });
  };

  const handleDeleteSplit = (suffix: string) => {
    const splits = (page.data!.splits as PageSplit[]) ?? [];
    commitOverrides.mutate({
      splits: splits.filter((s) => s.suffix !== suffix) as any,
    });
  };

  const handleDeleteRegion = (index: number) => {
    const regions =
      (page.data!.illustration_regions as IllustrationRegion[]) ?? [];
    commitOverrides.mutate({
      illustration_regions: regions.filter((r) => r.index !== index) as any,
    });
  };

  const handleUpdateSplit = (
    suffix: string,
    rect: { L: number; R: number; T: number; B: number },
  ) => {
    const splits = (page.data!.splits as PageSplit[]) ?? [];
    const updated = splits.map((s) =>
      s.suffix === suffix ? { ...s, ...rect } : s,
    );
    commitOverrides.mutate({ splits: updated as any });
  };

  const handleUpdateRegion = (
    index: number,
    rect: { L: number; R: number; T: number; B: number },
  ) => {
    const regions =
      (page.data!.illustration_regions as IllustrationRegion[]) ?? [];
    const updated = regions.map((r) =>
      r.index === index ? { ...r, ...rect } : r,
    );
    commitOverrides.mutate({ illustration_regions: updated as any });
  };

  return (
    <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              {page.data.prefix || `#${idx0}`}
              {isProcessingThisPage && (
                <span
                  className="inline-flex items-center gap-1 rounded bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800 animate-pulse"
                  title="A batch_process_pages job is currently processing this page"
                >
                  <span className="h-2 w-2 rounded-full bg-sky-500" />
                  Processing…
                </span>
              )}
            </h1>
            <p className="text-xs text-slate-500">{page.data.source_stem}</p>
          </div>
          <div className="flex gap-2">
            <Link
              to={`/projects/${projectId}/pages/${Math.max(0, idx0 - 1)}`}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              ← Prev
            </Link>
            <Link
              to={`/projects/${projectId}/pages/${idx0 + 1}`}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              Next →
            </Link>
          </div>
        </div>

        {page.data.processing_error && (
          <div className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            <strong className="font-semibold">Processing error:</strong>{" "}
            {page.data.processing_error}
          </div>
        )}

        {/* M3 — polished stage-chain rail. Clicking a clean/dirty chip
            sets selectedStageId for the artifact viewer below. */}
        <StageChainRail
          projectId={projectId}
          idx0={idx0}
          selectedStageId={selectedStageId}
          onStageSelect={setSelectedStageId}
        />

        {/* M3 — side-by-side artifact viewer (Stage + Compare selectors). */}
        <ArtifactViewer
          projectId={projectId}
          idx0={idx0}
          selectedStageId={selectedStageId}
        />

        {/* M3 — stage-controls panel: filtered config fields + Apply + Run. */}
        <StageControlsPanel
          projectId={projectId}
          idx0={idx0}
          stageId={selectedStageId}
          page={page.data}
          onApplied={() =>
            queryClient.invalidateQueries({
              queryKey: ["stages", projectId, idx0],
            })
          }
        />

        <ModeToolbar mode={editMode} onChange={setEditMode} />

        <CanvasViewer
          imageKey={previewUrl ?? `/cdn/${page.data.thumbnail_key ?? ""}`}
          page={page.data}
          editMode={editMode}
          onDrawSplit={handleAddSplit}
          onDrawRegion={handleAddRegion}
          onUpdateSplit={handleUpdateSplit}
          onUpdateRegion={handleUpdateRegion}
          onCaptureSiblingBbox={(rect) => {
            setSiblingBbox({
              x: rect.L,
              y: rect.T,
              w: rect.R - rect.L,
              h: rect.B - rect.T,
            });
            setEditMode("view");
          }}
        />
      </div>

      <aside className="space-y-4">
        <PageIdentityPanel
          page={page.data}
          onChange={(patch) => commitOverrides.mutate(patch)}
        />
        <SplitsPanel
          splits={(page.data.splits as PageSplit[]) ?? []}
          onDelete={handleDeleteSplit}
        />
        <CreateSiblingPanel
          editMode={editMode}
          onEnterDrawMode={() => setEditMode("create-sibling")}
          bbox={siblingBbox}
          suffixes={siblingSuffixes}
          onChangeSuffixes={setSiblingSuffixes}
          stageId={selectedStageId ?? "auto_deskew"}
          onCommit={() => {
            if (!siblingBbox) return;
            const suffixList = siblingSuffixes
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            createSiblings.mutate({
              bbox: [
                siblingBbox.x,
                siblingBbox.y,
                siblingBbox.w,
                siblingBbox.h,
              ],
              split_at_stage: selectedStageId ?? "auto_deskew",
              suffixes: suffixList,
            });
          }}
          isPending={createSiblings.isPending}
        />
        <RegionsPanel
          regions={
            (page.data.illustration_regions as IllustrationRegion[]) ?? []
          }
          onDelete={handleDeleteRegion}
        />
        <ConfigOverridesPanel
          overrides={overrides}
          onChange={setOverrides}
          onPreview={() => preview.mutate()}
          onSave={() => commitOverrides.mutate({ config_overrides: overrides })}
          previewing={preview.isPending}
          backendInfo={
            preview.data
              ? `${preview.data.backend} · ${preview.data.processing_time_ms}ms`
              : null
          }
        />
      </aside>
    </section>
  );
}

// ─── Canvas (Konva) — view + drag-to-create ─────────────────────────────────

type Selection =
  | { kind: "split"; suffix: string }
  | { kind: "region"; index: number }
  | null;

function CanvasViewer({
  imageKey,
  page,
  editMode,
  onDrawSplit,
  onDrawRegion,
  onUpdateSplit,
  onUpdateRegion,
  onCaptureSiblingBbox,
}: {
  imageKey: string;
  page: PageRecord;
  editMode: EditMode;
  onDrawSplit: (r: { L: number; R: number; T: number; B: number }) => void;
  onDrawRegion: (r: { L: number; R: number; T: number; B: number }) => void;
  onUpdateSplit: (
    suffix: string,
    r: { L: number; R: number; T: number; B: number },
  ) => void;
  onUpdateRegion: (
    index: number,
    r: { L: number; R: number; T: number; B: number },
  ) => void;
  onCaptureSiblingBbox: (r: {
    L: number;
    R: number;
    T: number;
    B: number;
  }) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const rectRefs = useRef<Map<string, Konva.Rect>>(new Map());
  const [containerW, setContainerW] = useState(800);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [dragRect, setDragRect] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [selection, setSelection] = useState<Selection>(null);

  useEffect(() => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.src = imageKey;
    el.onload = () => setImg(el);
    return () => {
      el.onload = null;
    };
  }, [imageKey]);

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerW(entry.contentRect.width);
      }
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const scale = img ? containerW / img.naturalWidth : 1;
  const stageH = img ? Math.round(img.naturalHeight * scale) : 600;
  const drawingEnabled = editMode !== "view";

  // Attach the Transformer to whatever Rect is selected.
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    if (!selection) {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
      return;
    }
    const key = selectionKey(selection);
    const node = rectRefs.current.get(key);
    if (node) {
      tr.nodes([node]);
      tr.getLayer()?.batchDraw();
    }
  }, [selection, page.splits, page.illustration_regions]);

  // Click-on-empty-stage clears the selection. The Transformer + the rects
  // themselves stop the click via stopPropagation.
  const handleStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (drawingEnabled) return;
    if (e.target === e.target.getStage()) setSelection(null);
  };

  const handleMouseDown = () => {
    if (!drawingEnabled) return;
    const stage = stageRef.current;
    const pos = stage?.getPointerPosition();
    if (!pos) return;
    setDrawStart({ x: pos.x, y: pos.y });
    setDragRect({ x: pos.x, y: pos.y, w: 0, h: 0 });
  };

  const handleMouseMove = () => {
    if (!drawingEnabled || !drawStart) return;
    const pos = stageRef.current?.getPointerPosition();
    if (!pos) return;
    setDragRect({
      x: Math.min(drawStart.x, pos.x),
      y: Math.min(drawStart.y, pos.y),
      w: Math.abs(pos.x - drawStart.x),
      h: Math.abs(pos.y - drawStart.y),
    });
  };

  const handleMouseUp = () => {
    if (!drawingEnabled || !drawStart || !dragRect) {
      setDrawStart(null);
      setDragRect(null);
      return;
    }
    if (dragRect.w >= 8 && dragRect.h >= 8) {
      const rect = {
        L: Math.round(dragRect.x / scale),
        R: Math.round((dragRect.x + dragRect.w) / scale),
        T: Math.round(dragRect.y / scale),
        B: Math.round((dragRect.y + dragRect.h) / scale),
      };
      if (editMode === "split") onDrawSplit(rect);
      else if (editMode === "illustration") onDrawRegion(rect);
      else if (editMode === "create-sibling") onCaptureSiblingBbox(rect);
    }
    setDrawStart(null);
    setDragRect(null);
  };

  return (
    <div
      ref={containerRef}
      className="rounded border bg-white"
      style={{ minHeight: 400 }}
    >
      {img ? (
        <Stage
          ref={stageRef}
          width={containerW}
          height={stageH}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onClick={handleStageClick}
          style={{ cursor: drawingEnabled ? "crosshair" : "default" }}
        >
          <Layer>
            <KonvaImage image={img} scaleX={scale} scaleY={scale} />
            {(page.illustration_regions as IllustrationRegion[]).map(
              (region) => {
                const key = `region-${region.index}`;
                const x = (region.L ?? 0) * scale;
                const y = (region.T ?? 0) * scale;
                const w = ((region.R ?? 0) - (region.L ?? 0)) * scale;
                const h = ((region.B ?? 0) - (region.T ?? 0)) * scale;
                return (
                  <Rect
                    key={key}
                    ref={(node) => {
                      if (node) rectRefs.current.set(key, node);
                      else rectRefs.current.delete(key);
                    }}
                    x={x}
                    y={y}
                    width={w}
                    height={h}
                    stroke="rgba(220,38,38,0.9)"
                    strokeWidth={2}
                    dash={[6, 4]}
                    draggable={!drawingEnabled}
                    onClick={(e) => {
                      e.cancelBubble = true;
                      if (!drawingEnabled)
                        setSelection({ kind: "region", index: region.index });
                    }}
                    onDragEnd={(e) =>
                      onUpdateRegion(
                        region.index,
                        rectFromNode(e.target, scale),
                      )
                    }
                    onTransformEnd={(e) => {
                      onUpdateRegion(
                        region.index,
                        rectFromNode(e.target, scale),
                      );
                      // Reset scale on the node after committing — Konva
                      // applies scale during transform, but we want width/
                      // height to be the source of truth.
                      const node = e.target;
                      const newW = node.width() * node.scaleX();
                      const newH = node.height() * node.scaleY();
                      node.scaleX(1);
                      node.scaleY(1);
                      node.width(newW);
                      node.height(newH);
                    }}
                  />
                );
              },
            )}
            {(page.splits as PageSplit[]).map((split) => {
              const key = `split-${split.suffix}`;
              const x = (split.L ?? 0) * scale;
              const y = (split.T ?? 0) * scale;
              const w =
                ((split.R ?? img.naturalWidth) - (split.L ?? 0)) * scale;
              const h =
                ((split.B ?? img.naturalHeight) - (split.T ?? 0)) * scale;
              return (
                <Rect
                  key={key}
                  ref={(node) => {
                    if (node) rectRefs.current.set(key, node);
                    else rectRefs.current.delete(key);
                  }}
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  stroke="rgba(37,99,235,0.9)"
                  strokeWidth={2}
                  dash={[2, 4]}
                  draggable={!drawingEnabled}
                  onClick={(e) => {
                    e.cancelBubble = true;
                    if (!drawingEnabled)
                      setSelection({ kind: "split", suffix: split.suffix });
                  }}
                  onDragEnd={(e) =>
                    onUpdateSplit(split.suffix, rectFromNode(e.target, scale))
                  }
                  onTransformEnd={(e) => {
                    onUpdateSplit(split.suffix, rectFromNode(e.target, scale));
                    const node = e.target;
                    const newW = node.width() * node.scaleX();
                    const newH = node.height() * node.scaleY();
                    node.scaleX(1);
                    node.scaleY(1);
                    node.width(newW);
                    node.height(newH);
                  }}
                />
              );
            })}
            <Transformer
              ref={transformerRef}
              rotateEnabled={false}
              flipEnabled={false}
              boundBoxFunc={(oldBox, newBox) => {
                // Constrain to a sensible minimum.
                if (newBox.width < 8 || newBox.height < 8) return oldBox;
                return newBox;
              }}
            />
            {dragRect && (
              <Rect
                x={dragRect.x}
                y={dragRect.y}
                width={dragRect.w}
                height={dragRect.h}
                stroke={
                  editMode === "split"
                    ? "rgba(37,99,235,0.9)"
                    : "rgba(220,38,38,0.9)"
                }
                strokeWidth={2}
                fill={
                  editMode === "split"
                    ? "rgba(37,99,235,0.1)"
                    : "rgba(220,38,38,0.1)"
                }
              />
            )}
          </Layer>
        </Stage>
      ) : (
        <div className="flex h-96 items-center justify-center text-slate-400">
          Loading image…
        </div>
      )}
    </div>
  );
}

function ModeToolbar({
  mode,
  onChange,
}: {
  mode: EditMode;
  onChange: (m: EditMode) => void;
}) {
  const btn = (m: EditMode, label: string, hue: string) => (
    <button
      onClick={() => onChange(m)}
      className={`rounded px-3 py-1.5 text-sm border ${
        mode === m
          ? `${hue} text-white border-transparent`
          : "border-slate-300 bg-white hover:bg-slate-50"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-slate-500">Mode:</span>
      {btn("view", "View", "bg-slate-700")}
      {btn("split", "Add split", "bg-blue-600")}
      {btn("illustration", "Add illustration", "bg-red-600")}
      {btn("create-sibling", "Draw split region", "bg-indigo-600")}
    </div>
  );
}

// ─── Right-side panels ─────────────────────────────────────────────────────

function PageIdentityPanel({
  page,
  onChange,
}: {
  page: PageRecord;
  onChange: (patch: Partial<PageRecord>) => void;
}) {
  return (
    <div className="space-y-2 rounded border bg-white p-3 text-sm">
      <h2 className="text-sm font-semibold">Identity</h2>
      <label className="block">
        <span className="text-xs text-slate-600">Page type</span>
        <select
          value={page.page_type}
          onChange={(e) => onChange({ page_type: e.target.value as PageType })}
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
        >
          {PAGE_TYPES.map((pt) => (
            <option key={pt} value={pt}>
              {pt}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-xs text-slate-600">Alignment</span>
        <select
          value={page.alignment}
          onChange={(e) =>
            onChange({ alignment: e.target.value as AlignmentOverride })
          }
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
        >
          {ALIGNMENTS.map((al) => (
            <option key={al} value={al}>
              {al}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function SplitsPanel({
  splits,
  onDelete,
}: {
  splits: PageSplit[];
  onDelete: (suffix: string) => void;
}) {
  if (splits.length === 0) return null;
  return (
    <div className="space-y-2 rounded border bg-white p-3 text-sm">
      <h2 className="text-sm font-semibold">Splits</h2>
      <ul className="divide-y">
        {[...splits]
          .sort((a, b) => a.reading_order - b.reading_order)
          .map((s) => (
            <li
              key={s.suffix}
              className="flex items-center justify-between py-1"
            >
              <span className="font-mono text-xs">
                <span className="text-slate-500">
                  order {s.reading_order}:{" "}
                </span>
                {s.suffix}
                <span className="ml-2 text-slate-400">
                  L{s.L ?? "·"} R{s.R ?? "·"} T{s.T ?? "·"} B{s.B ?? "·"}
                </span>
              </span>
              <button
                onClick={() => onDelete(s.suffix)}
                className="text-xs text-rose-600 hover:underline"
              >
                delete
              </button>
            </li>
          ))}
      </ul>
    </div>
  );
}

function RegionsPanel({
  regions,
  onDelete,
}: {
  regions: IllustrationRegion[];
  onDelete: (index: number) => void;
}) {
  if (regions.length === 0) return null;
  return (
    <div className="space-y-2 rounded border bg-white p-3 text-sm">
      <h2 className="text-sm font-semibold">Illustration regions</h2>
      <ul className="divide-y">
        {regions.map((r) => (
          <li key={r.index} className="flex items-center justify-between py-1">
            <span className="font-mono text-xs">
              <span className="text-slate-500">#{r.index} </span>
              <span className="rounded bg-slate-100 px-1">{r.type}</span>
              <span className="ml-2 text-slate-400">
                L{r.L ?? "·"} R{r.R ?? "·"} T{r.T ?? "·"} B{r.B ?? "·"}
              </span>
            </span>
            <button
              onClick={() => onDelete(r.index)}
              className="text-xs text-rose-600 hover:underline"
            >
              delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConfigOverridesPanel({
  overrides,
  onChange,
  onPreview,
  onSave,
  previewing,
  backendInfo,
}: {
  overrides: PageConfigOverrides;
  onChange: (next: PageConfigOverrides) => void;
  onPreview: () => void;
  onSave: () => void;
  previewing: boolean;
  backendInfo: string | null;
}) {
  function patch(k: keyof PageConfigOverrides, v: unknown) {
    onChange({ ...overrides, [k]: v });
  }

  return (
    <div className="space-y-3 rounded border bg-white p-3 text-sm">
      <h2 className="text-sm font-semibold">Overrides</h2>

      <NumField
        label="Threshold (None = Otsu)"
        value={overrides.threshold_level ?? null}
        onChange={(v) => patch("threshold_level", v)}
      />
      <NumField
        label="Fuzzy %"
        value={overrides.fuzzy_pct ?? null}
        step={0.01}
        onChange={(v) => patch("fuzzy_pct", v)}
      />
      <NumField
        label="Pixel cols"
        value={overrides.pixel_count_columns ?? null}
        onChange={(v) => patch("pixel_count_columns", v)}
      />
      <NumField
        label="Pixel rows"
        value={overrides.pixel_count_rows ?? null}
        onChange={(v) => patch("pixel_count_rows", v)}
      />

      <div className="grid grid-cols-2 gap-2">
        <Toggle
          label="skip auto-deskew"
          value={overrides.skip_auto_deskew}
          onChange={(v) => patch("skip_auto_deskew", v)}
        />
        <Toggle
          label="morph fill"
          value={overrides.do_morph}
          onChange={(v) => patch("do_morph", v)}
        />
        <Toggle
          label="skip denoise"
          value={overrides.skip_denoise}
          onChange={(v) => patch("skip_denoise", v)}
        />
        <Toggle
          label="OCR-bbox edge"
          value={overrides.use_ocr_bbox_edge}
          onChange={(v) => patch("use_ocr_bbox_edge", v)}
        />
        <Toggle
          label="rotated standard"
          value={overrides.rotated_standard}
          onChange={(v) => patch("rotated_standard", v)}
        />
        <Toggle
          label="single-dim rescale"
          value={overrides.single_dimension_rescale}
          onChange={(v) => patch("single_dimension_rescale", v)}
        />
      </div>

      <div className="flex items-center gap-2 pt-2">
        <button
          onClick={onPreview}
          disabled={previewing}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 hover:bg-slate-800"
        >
          {previewing ? "Processing…" : "Preview"}
        </button>
        <button
          onClick={onSave}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
        >
          Save
        </button>
        {backendInfo && (
          <span className="ml-auto text-xs text-slate-500">{backendInfo}</span>
        )}
      </div>
    </div>
  );
}

function NumField({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number | null;
  step?: number;
  onChange: (v: number | null) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs text-slate-600">{label}</span>
      <input
        type="number"
        step={step}
        value={value ?? ""}
        placeholder="inherit"
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === "" ? null : Number(raw));
        }}
        className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
      />
    </label>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null | undefined;
  onChange: (v: boolean | null) => void;
}) {
  const next =
    value === null || value === undefined ? true : value ? false : null;
  return (
    <button
      type="button"
      onClick={() => onChange(next)}
      className={`rounded border px-2 py-1 text-left text-xs ${
        value === true
          ? "border-emerald-500 bg-emerald-50 text-emerald-800"
          : value === false
            ? "border-rose-500 bg-rose-50 text-rose-800"
            : "border-slate-300 bg-white text-slate-500"
      }`}
    >
      <div className="font-medium">{label}</div>
      <div className="text-[10px]">
        {value === null || value === undefined
          ? "inherit"
          : value
            ? "on"
            : "off"}
      </div>
    </button>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function nextSplitSuffix(splits: PageSplit[]): string {
  // Letters: a, b, c, ... then "z", then aa.
  const used = new Set(splits.map((s) => s.suffix));
  for (const c of "abcdefghijklmnopqrstuvwxyz") {
    if (!used.has(c)) return c;
  }
  let i = 1;
  while (used.has(`a${i}`)) i++;
  return `a${i}`;
}

function selectionKey(s: NonNullable<Selection>): string {
  return s.kind === "split" ? `split-${s.suffix}` : `region-${s.index}`;
}

/** Read screen-space rect from a Konva.Rect node, convert back to source-image space. */
function rectFromNode(
  node: Konva.Node,
  scale: number,
): { L: number; R: number; T: number; B: number } {
  const x = node.x();
  const y = node.y();
  const w = node.width() * node.scaleX();
  const h = node.height() * node.scaleY();
  return {
    L: Math.round(x / scale),
    R: Math.round((x + w) / scale),
    T: Math.round(y / scale),
    B: Math.round((y + h) / scale),
  };
}

// ─── Create-sibling panel ────────────────────────────────────────────────────

function CreateSiblingPanel({
  editMode,
  onEnterDrawMode,
  bbox,
  suffixes,
  onChangeSuffixes,
  stageId,
  onCommit,
  isPending,
}: {
  editMode: EditMode;
  onEnterDrawMode: () => void;
  bbox: { x: number; y: number; w: number; h: number } | null;
  suffixes: string;
  onChangeSuffixes: (v: string) => void;
  stageId: string;
  onCommit: () => void;
  isPending: boolean;
}) {
  return (
    <div className="space-y-2 rounded border bg-white p-3 text-sm">
      <h2 className="text-sm font-semibold">Create split</h2>
      <p className="text-xs text-slate-500">
        Draw a crop region on the image, then confirm to create sibling pages.
      </p>
      <button
        onClick={onEnterDrawMode}
        className={`w-full rounded border px-2 py-1 text-xs ${
          editMode === "create-sibling"
            ? "border-indigo-500 bg-indigo-50 text-indigo-800"
            : "border-slate-300 hover:bg-slate-50"
        }`}
      >
        {editMode === "create-sibling"
          ? "Drawing… (drag on image)"
          : bbox
            ? `Region set (${bbox.w}×${bbox.h}) — redraw?`
            : "Draw crop region"}
      </button>
      <label className="block">
        <span className="text-xs text-slate-600">
          Suffixes (comma-separated)
        </span>
        <input
          type="text"
          value={suffixes}
          onChange={(e) => onChangeSuffixes(e.target.value)}
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
          placeholder="a,b"
        />
      </label>
      <p className="text-[10px] text-slate-400">
        Stage: <span className="font-mono">{stageId}</span>
      </p>
      <button
        onClick={onCommit}
        disabled={!bbox || isPending}
        className="w-full rounded bg-indigo-600 px-2 py-1.5 text-xs text-white hover:bg-indigo-700 disabled:opacity-40"
        aria-label="Create split"
      >
        {isPending ? "Creating…" : "Create split"}
      </button>
    </div>
  );
}
