import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Rect, Transformer } from "react-konva";
import type Konva from "konva";
import { PageImageCanvas } from "@concavetrillion/pd-ui/canvas";
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
import { PageHeader } from "../components/shell/PageHeader";

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

type EditMode =
  | "view"
  | "split"
  | "illustration"
  | "create-sibling"
  | "rotate"
  | "flip";

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
      void queryClient.invalidateQueries({
        queryKey: ["page", projectId, idx0],
      });
      void queryClient.invalidateQueries({ queryKey: ["jobs", projectId] });
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
      void queryClient.invalidateQueries({
        queryKey: ["page", projectId, idx0],
      });
    }
  }, [jobProgress.currentPage, idx0, liveBatchJobId, queryClient, projectId]);

  const [overrides, setOverrides] = useState<PageConfigOverrides>({});
  const [editMode, setEditMode] = useState<EditMode>("view");
  const [selectedStageId, setSelectedStageId] = useState<string | undefined>(
    undefined,
  );
  // Rotate mode: draft angle in degrees (±180 range).
  const [draftAngle, setDraftAngle] = useState<number>(0);

  // Flip mode: draft flip state (true = flip applied, false/null = no flip).
  const [draftFlipH, setDraftFlipH] = useState<boolean>(false);
  const [draftFlipV, setDraftFlipV] = useState<boolean>(false);

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
      void queryClient.invalidateQueries({ queryKey: ["pages", projectId] });
      const first = data.children[0];
      if (first) void navigate(`/projects/${projectId}/pages/${first.idx0}`);
    },
  });

  useEffect(() => {
    if (page.data) setOverrides(page.data.config_overrides);
  }, [page.data]);

  const commitOverrides = useMutation({
    mutationFn: (patch: UpdatePageRequest) =>
      api.patch<PageRecord>(
        `/api/data/projects/${projectId}/pages/${idx0}`,
        patch,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["page", projectId, idx0],
      });
      void queryClient.invalidateQueries({ queryKey: ["pages", projectId] });
    },
  });

  // Stages that require the async run path because they may take seconds.
  const SLOW_STAGES = new Set(["ocr", "extract_illustrations"]);

  // Run a stage from the chip rail "Run" button. Fast stages use the sync path
  // (200 + PageStageState on success); slow stages enqueue a job (202 + Job).
  // Either way the stages query is invalidated so the chip rail updates.
  const runStage = useMutation({
    mutationFn: (stageId: string) => {
      const isAsync = SLOW_STAGES.has(stageId);
      const url = isAsync
        ? `/api/data/projects/${projectId}/pages/${idx0}/stages/${stageId}/run?async=true`
        : `/api/data/projects/${projectId}/pages/${idx0}/stages/${stageId}/run`;
      return api.post(url, {});
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["page-stages", projectId, idx0],
      });
    },
  });

  // Rotate apply: PATCH config_overrides with manual_deskew_angle, then
  // POST manual_deskew_pre/run to re-run the stage.
  const runDeskewStage = useMutation({
    mutationFn: () =>
      api.post(
        `/api/data/projects/${projectId}/pages/${idx0}/stages/manual_deskew_pre/run`,
        {},
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["page-stages", projectId, idx0],
      });
      setEditMode("view");
    },
  });

  // angle=null clears the stored override (Reset path); angle=number persists it (Apply path).
  const applyRotation = useMutation({
    mutationFn: (angle: number | null) =>
      api.patch<PageRecord>(`/api/data/projects/${projectId}/pages/${idx0}`, {
        config_overrides: { ...overrides, manual_deskew_angle: angle },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["page", projectId, idx0],
      });
      void queryClient.invalidateQueries({ queryKey: ["pages", projectId] });
      runDeskewStage.mutate();
    },
  });

  // Round angle to one decimal place for display and storage (spec §Angle range and precision).
  const roundAngle = (a: number) => Number(a.toFixed(1));

  // Flip apply: PATCH config_overrides with flip_horizontal/flip_vertical, then
  // POST manual_deskew_pre/run to re-run the stage.
  //
  // null/null = Reset (clear stored flips).
  const applyFlip = useMutation({
    mutationFn: ({
      flipH,
      flipV,
    }: {
      flipH: boolean | null;
      flipV: boolean | null;
    }) =>
      api.patch<PageRecord>(`/api/data/projects/${projectId}/pages/${idx0}`, {
        config_overrides: {
          ...overrides,
          flip_horizontal: flipH,
          flip_vertical: flipV,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["page", projectId, idx0],
      });
      void queryClient.invalidateQueries({ queryKey: ["pages", projectId] });
      runDeskewStage.mutate();
    },
  });

  // Pre-fill draftAngle when entering rotate mode if a stored angle exists.
  // Pre-fill draftFlipH/draftFlipV when entering flip mode.
  const handleSetEditMode = (mode: EditMode) => {
    if (mode === "rotate" && page.data) {
      const stored = page.data.config_overrides.manual_deskew_angle;
      setDraftAngle(
        stored !== null && stored !== undefined ? roundAngle(stored) : 0,
      );
    }
    if (mode === "flip" && page.data) {
      setDraftFlipH(
        page.data.config_overrides.flip_horizontal === true ? true : false,
      );
      setDraftFlipV(
        page.data.config_overrides.flip_vertical === true ? true : false,
      );
    }
    setEditMode(mode);
  };

  // Global Escape handler: exits rotate or flip mode without applying.
  useEffect(() => {
    if (editMode !== "rotate" && editMode !== "flip") return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setEditMode("view");
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [editMode]);

  if (page.isLoading) return <p className="text-slate-500">Loading…</p>;
  if (!page.data) return <p className="text-red-600">Page not found.</p>;

  const handleAddSplit = (rect: {
    L: number;
    R: number;
    T: number;
    B: number;
  }) => {
    const splits = (page.data.splits as PageSplit[]) ?? [];
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
    commitOverrides.mutate({ splits: [...splits, next] });
  };

  const handleAddRegion = (rect: {
    L: number;
    R: number;
    T: number;
    B: number;
  }) => {
    const regions =
      (page.data.illustration_regions as IllustrationRegion[]) ?? [];
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
      illustration_regions: [...regions, next],
    });
  };

  const handleDeleteSplit = (suffix: string) => {
    const splits = (page.data.splits as PageSplit[]) ?? [];
    commitOverrides.mutate({
      splits: splits.filter((s) => s.suffix !== suffix),
    });
  };

  const handleDeleteRegion = (index: number) => {
    const regions =
      (page.data.illustration_regions as IllustrationRegion[]) ?? [];
    commitOverrides.mutate({
      illustration_regions: regions.filter((r) => r.index !== index),
    });
  };

  const handleUpdateSplit = (
    suffix: string,
    rect: { L: number; R: number; T: number; B: number },
  ) => {
    const splits = (page.data.splits as PageSplit[]) ?? [];
    const updated = splits.map((s) =>
      s.suffix === suffix ? { ...s, ...rect } : s,
    );
    commitOverrides.mutate({ splits: updated });
  };

  const handleUpdateRegion = (
    index: number,
    rect: { L: number; R: number; T: number; B: number },
  ) => {
    const regions =
      (page.data.illustration_regions as IllustrationRegion[]) ?? [];
    const updated = regions.map((r) =>
      r.index === index ? { ...r, ...rect } : r,
    );
    commitOverrides.mutate({ illustration_regions: updated });
  };

  return (
    <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <div className="space-y-3">
        <PageHeader
          title={`Page ${idx0 + 1}`}
          description={page.data.source_stem}
          actions={
            <>
              {isProcessingThisPage && (
                <span
                  className="inline-flex items-center gap-1 rounded bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800 animate-pulse"
                  title="A batch_process_pages job is currently processing this page"
                >
                  <span className="h-2 w-2 rounded-full bg-sky-500" />
                  Processing…
                </span>
              )}
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
            </>
          }
        />

        {page.data.processing_error && (
          <div className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            <strong className="font-semibold">Processing error:</strong>{" "}
            {page.data.processing_error}
          </div>
        )}

        {/* M3 — polished stage-chain rail. Clicking any selectable chip
            sets selectedStageId for the artifact viewer below. The "Run"
            button that appears on the selected chip fires runStage so the
            user can advance the chain without navigating away. */}
        <StageChainRail
          projectId={projectId}
          idx0={idx0}
          {...(selectedStageId !== undefined && { selectedStageId })}
          onStageSelect={setSelectedStageId}
          onStageRun={(stageId) => runStage.mutate(stageId)}
        />

        {/* M3 — side-by-side artifact viewer (Stage + Compare selectors). */}
        <ArtifactViewer
          projectId={projectId}
          idx0={idx0}
          {...(selectedStageId !== undefined && { selectedStageId })}
        />

        {/* M3 — stage-controls panel: filtered config fields + Apply + Run. */}
        <StageControlsPanel
          projectId={projectId}
          idx0={idx0}
          stageId={selectedStageId}
          page={page.data}
          onApplied={() =>
            queryClient.invalidateQueries({
              queryKey: ["page-stages", projectId, idx0],
            })
          }
        />

        <ModeToolbar mode={editMode} onChange={handleSetEditMode} />

        {editMode === "rotate" && (
          <RotateToolbar
            draftAngle={draftAngle}
            onApply={() => applyRotation.mutate(roundAngle(draftAngle))}
            onReset={() => {
              setDraftAngle(0);
              // If a stored angle exists, clear the config override and re-run.
              const storedAngle =
                page.data?.config_overrides.manual_deskew_angle ?? null;
              if (storedAngle !== null) {
                applyRotation.mutate(null);
              }
            }}
            onEscape={() => setEditMode("view")}
            onDiscreteRotate={(delta) => {
              const raw = draftAngle + delta;
              // Wrap within ±180°, then round to 1dp.
              const wrapped = roundAngle(
                raw > 180 ? raw - 360 : raw < -180 ? raw + 360 : raw,
              );
              setDraftAngle(wrapped);
              applyRotation.mutate(wrapped);
            }}
            isPending={applyRotation.isPending || runDeskewStage.isPending}
          />
        )}

        {editMode === "flip" && (
          <FlipToolbar
            flipH={draftFlipH}
            flipV={draftFlipV}
            onFlipH={() => {
              const next = !draftFlipH;
              setDraftFlipH(next);
              applyFlip.mutate({ flipH: next, flipV: draftFlipV });
            }}
            onFlipV={() => {
              const next = !draftFlipV;
              setDraftFlipV(next);
              applyFlip.mutate({ flipH: draftFlipH, flipV: next });
            }}
            onReset={() => {
              const hasStoredFlip =
                page.data?.config_overrides.flip_horizontal != null ||
                page.data?.config_overrides.flip_vertical != null;
              setDraftFlipH(false);
              setDraftFlipV(false);
              if (hasStoredFlip) {
                applyFlip.mutate({ flipH: null, flipV: null });
              }
            }}
            onCancel={() => setEditMode("view")}
            isPending={applyFlip.isPending || runDeskewStage.isPending}
          />
        )}

        <CanvasViewer
          imageKey={`/cdn/${page.data.thumbnail_key ?? ""}`}
          page={page.data}
          editMode={editMode}
          draftAngle={draftAngle}
          draftFlipH={draftFlipH}
          draftFlipV={draftFlipV}
          onRotate={setDraftAngle}
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
          splits={page.data.splits ?? []}
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
          regions={page.data.illustration_regions ?? []}
          onDelete={handleDeleteRegion}
        />
        <ConfigOverridesPanel
          overrides={overrides}
          onChange={setOverrides}
          onPreview={() => runStage.mutate("canvas_map")}
          onSave={() => commitOverrides.mutate({ config_overrides: overrides })}
          previewing={runStage.isPending}
          backendInfo={null}
        />
      </aside>
    </section>
  );
}

// ─── Canvas (Konva) — view + drag-to-create ─────────────────────────────────
//
// Phase 2.2: Migrated from raw Konva Stage + KonvaImage to pd-ui's
// PageImageCanvas as the canvas host. Slot mapping:
//
//   image     — page bitmap (managed entirely by pd-ui)
//   tool      — split/illustration Rects + Transformer + drag-preview Rect
//               (tool layer has listening=true → Konva hit detection works)
//
// Pointer events for drag-to-create-rect use a DOM event-capture overlay
// (same GAP-1 shim pattern as pd-ocr-labeler-spa and WordBboxOverlay).
//
// Capability gaps vs plain local implementation:
//   GAP-1: Rotate mode's Konva Transformer-on-image is NOT ported.
//          pd-ui manages the image Layer internally and does not expose
//          the image node ref, so we cannot attach a Transformer to it.
//          The discrete rotate buttons (90° CW, 90° CCW, 180°) and the
//          PATCH-based Apply/Reset path work unchanged — only the
//          drag-rotate interaction is unavailable in rotate mode.
//          TODO: when pd-ui exposes `imageNodeRef`, wire Transformer there.
//   GAP-2: pd-ui's Stage applies scaleX/scaleY at the Stage level. Konva
//          node positions inside slot fills are therefore in natural-pixel
//          space. rectFromNode now uses scale=1 (natural coords are already
//          natural). Drag-to-create rect math is also in natural-pixel space
//          via the DOM event-capture overlay's coordinate conversion.

type Selection =
  | { kind: "split"; suffix: string }
  | { kind: "region"; index: number }
  | null;

function CanvasViewer({
  imageKey,
  page,
  editMode,
  draftAngle,
  draftFlipH,
  draftFlipV,
  onRotate,
  onDrawSplit,
  onDrawRegion,
  onUpdateSplit,
  onUpdateRegion,
  onCaptureSiblingBbox,
}: {
  imageKey: string;
  page: PageRecord;
  editMode: EditMode;
  draftAngle: number;
  draftFlipH: boolean;
  draftFlipV: boolean;
  onRotate: (angle: number) => void;
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
  const transformerRef = useRef<Konva.Transformer>(null);
  const rectRefs = useRef<Map<string, Konva.Rect>>(new Map());
  const [naturalSize, setNaturalSize] = useState<{
    w: number;
    h: number;
  } | null>(null);
  const drawAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const [dragRect, setDragRect] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [selection, setSelection] = useState<Selection>(null);

  // Preload the image to get natural dimensions for pd-ui's page prop.
  useEffect(() => {
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.src = imageKey;
    el.onload = () =>
      setNaturalSize({ w: el.naturalWidth, h: el.naturalHeight });
    return () => {
      el.onload = null;
    };
  }, [imageKey]);

  // Drawing (drag-to-create) is disabled in view, rotate, and flip modes.
  // GAP-1: rotate mode no longer drives a Transformer; the overlay
  // cursor still changes to indicate the mode, but drag does nothing.
  const drawingEnabled =
    editMode !== "view" && editMode !== "rotate" && editMode !== "flip";

  // Attach the Transformer to the selected rect (split/illustration modes).
  // GAP-1: rotate mode Transformer-on-image removed (see file header).
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    if (editMode === "rotate" || editMode === "flip") {
      // GAP-1: Cannot attach Transformer to pd-ui's internal image node.
      // Clear any previously attached rect so the transformer is idle.
      tr.nodes([]);
      tr.rotateEnabled(false);
      tr.resizeEnabled(false);
      tr.getLayer()?.batchDraw();
    } else {
      const key = selection ? selectionKey(selection) : null;
      const node = key ? rectRefs.current.get(key) : null;
      tr.nodes(node ? [node] : []);
      tr.rotateEnabled(false);
      tr.resizeEnabled(true);
      tr.borderEnabled(true);
      tr.getLayer()?.batchDraw();
    }
  }, [editMode, selection, page.splits, page.illustration_regions]);

  // GAP-1: visual preview via CSS transform on the container div.
  // Compose: flip first (scaleX/scaleY), then rotate — matching the pipeline
  // transform order (flip in source space, then rotate).
  // Active in rotate mode (angle preview) and flip mode (flip preview).
  const previewTransformParts: string[] = [];
  if (editMode === "rotate" || editMode === "flip") {
    const scaleX = draftFlipH ? -1 : 1;
    const scaleY = draftFlipV ? -1 : 1;
    if (scaleX !== 1 || scaleY !== 1) {
      previewTransformParts.push(`scaleX(${scaleX}) scaleY(${scaleY})`);
    }
    if (editMode === "rotate" && draftAngle !== 0) {
      previewTransformParts.push(`rotate(${draftAngle}deg)`);
    }
  }
  const rotateStyle =
    previewTransformParts.length > 0
      ? {
          transform: previewTransformParts.join(" "),
          transformOrigin: "center",
        }
      : undefined;

  if (!naturalSize) {
    return (
      <div className="rounded border bg-white" style={{ minHeight: 400 }}>
        <div className="flex h-96 items-center justify-center text-slate-400">
          Loading image…
        </div>
      </div>
    );
  }

  const { w: naturalW, h: naturalH } = naturalSize;
  const pdUiPage = { width: naturalW, height: naturalH };

  /**
   * Convert a DOM clientX/Y (in the event-capture overlay) to natural-pixel
   * space. The overlay covers the entire canvas area; its width/height is the
   * displayed canvas size. Natural coords = DOM coords * (naturalW / displayW).
   */
  const clientToNatural = (
    clientX: number,
    clientY: number,
    overlay: HTMLElement,
  ): { x: number; y: number } => {
    const r = overlay.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return { x: 0, y: 0 };
    return {
      x: (clientX - r.left) * (naturalW / r.width),
      y: (clientY - r.top) * (naturalH / r.height),
    };
  };

  return (
    <div
      className="rounded border bg-white relative"
      style={{ minHeight: 400, ...rotateStyle }}
    >
      {/* ── pd-ui PageImageCanvas — Konva Stage host ──────────────────────
          Provides: image layer, Stage setup, ResizeObserver for container
          size. Split/illustration Rects + Transformer + drag-preview go
          in the tool slot (has listening=true → Konva events work). */}
      <PageImageCanvas
        src={imageKey}
        page={pdUiPage}
        words={[]}
        fitOnMount={true}
      >
        {{
          // ── tool slot: interactive Rects + Transformer + drag-preview ──
          // Layer name="tool" has no listening=false, so Konva hit
          // detection fires on Rects here (click, drag, transform).
          // Coordinates are in natural-pixel space (pd-ui scales the Stage).
          tool: () => (
            <>
              {(page.illustration_regions as IllustrationRegion[]).map(
                (region) => {
                  const key = `region-${region.index}`;
                  return (
                    <Rect
                      key={key}
                      ref={(node) => {
                        if (node) rectRefs.current.set(key, node);
                        else rectRefs.current.delete(key);
                      }}
                      x={region.L ?? 0}
                      y={region.T ?? 0}
                      width={(region.R ?? 0) - (region.L ?? 0)}
                      height={(region.B ?? 0) - (region.T ?? 0)}
                      stroke="rgba(220,38,38,0.9)"
                      strokeWidth={2}
                      dash={[6, 4]}
                      draggable={!drawingEnabled}
                      onClick={(e) => {
                        e.cancelBubble = true;
                        if (!drawingEnabled)
                          setSelection({
                            kind: "region",
                            index: region.index,
                          });
                      }}
                      onDragEnd={(e) =>
                        onUpdateRegion(region.index, rectFromNode(e.target))
                      }
                      onTransformEnd={(e) => {
                        onUpdateRegion(region.index, rectFromNode(e.target));
                        // Reset scale on the node after committing — Konva
                        // applies scale during transform, but we want
                        // width/height to be the source of truth.
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
                return (
                  <Rect
                    key={key}
                    ref={(node) => {
                      if (node) rectRefs.current.set(key, node);
                      else rectRefs.current.delete(key);
                    }}
                    x={split.L ?? 0}
                    y={split.T ?? 0}
                    width={(split.R ?? naturalW) - (split.L ?? 0)}
                    height={(split.B ?? naturalH) - (split.T ?? 0)}
                    stroke="rgba(37,99,235,0.9)"
                    strokeWidth={2}
                    dash={[2, 4]}
                    draggable={!drawingEnabled}
                    onClick={(e) => {
                      e.cancelBubble = true;
                      if (!drawingEnabled)
                        setSelection({
                          kind: "split",
                          suffix: split.suffix,
                        });
                    }}
                    onDragEnd={(e) =>
                      onUpdateSplit(split.suffix, rectFromNode(e.target))
                    }
                    onTransformEnd={(e) => {
                      onUpdateSplit(split.suffix, rectFromNode(e.target));
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
                  if (newBox.width < 8 || newBox.height < 8) return oldBox;
                  return newBox;
                }}
                onTransform={() => {
                  // GAP-1: Transformer is never attached to the image node
                  // in rotate mode (pd-ui owns the image). onRotate is not
                  // called here; it fires only via RotateToolbar buttons.
                  // This handler is intentionally a no-op for the rotate
                  // case. For rect transforms it does not need to call
                  // onRotate either.
                  void onRotate; // satisfy the linter — prop is used elsewhere
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
                  listening={false}
                />
              )}
            </>
          ),
        }}
      </PageImageCanvas>

      {/* ── Event-capture overlay (GAP-1 shim) ───────────────────────────────
          Absolutely positioned over the entire canvas area. Captures all
          mouse events for drag-to-create-rect so pd-ui's internal Stage
          drag never fires. Handles drawing in split / illustration /
          create-sibling modes. In view and rotate modes it is transparent
          (pointer-events:none) so Konva events reach the tool slot Rects. */}
      {drawingEnabled && (
        <div
          data-testid="canvas-draw-overlay"
          style={{
            position: "absolute",
            inset: 0,
            cursor: "crosshair",
          }}
          onMouseDown={(e) => {
            const pt = clientToNatural(e.clientX, e.clientY, e.currentTarget);
            drawAnchorRef.current = { x: pt.x, y: pt.y };
            setDragRect({ x: pt.x, y: pt.y, w: 0, h: 0 });
          }}
          onMouseMove={(e) => {
            const anchor = drawAnchorRef.current;
            if (!anchor) return;
            const pt = clientToNatural(e.clientX, e.clientY, e.currentTarget);
            setDragRect({
              x: Math.min(anchor.x, pt.x),
              y: Math.min(anchor.y, pt.y),
              w: Math.abs(pt.x - anchor.x),
              h: Math.abs(pt.y - anchor.y),
            });
          }}
          onMouseUp={(e) => {
            const anchor = drawAnchorRef.current;
            drawAnchorRef.current = null;
            const localDragRect = dragRect;
            setDragRect(null);
            if (!anchor || !localDragRect) return;
            if (localDragRect.w >= 8 && localDragRect.h >= 8) {
              const pt = clientToNatural(e.clientX, e.clientY, e.currentTarget);
              const rect = {
                L: Math.round(Math.min(anchor.x, pt.x)),
                R: Math.round(Math.max(anchor.x, pt.x)),
                T: Math.round(Math.min(anchor.y, pt.y)),
                B: Math.round(Math.max(anchor.y, pt.y)),
              };
              if (editMode === "split") onDrawSplit(rect);
              else if (editMode === "illustration") onDrawRegion(rect);
              else if (editMode === "create-sibling")
                onCaptureSiblingBbox(rect);
            }
          }}
          onMouseLeave={() => {
            drawAnchorRef.current = null;
            setDragRect(null);
          }}
          aria-hidden="true"
        />
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
      {btn("rotate", "Rotate", "bg-amber-600")}
      {btn("flip", "Flip", "bg-teal-600")}
    </div>
  );
}

// ─── Rotate toolbar ──────────────────────────────────────────────────────────

function RotateToolbar({
  draftAngle,
  onApply,
  onReset,
  onEscape,
  onDiscreteRotate,
  isPending,
}: {
  draftAngle: number;
  onApply: () => void;
  onReset: () => void;
  onEscape: () => void;
  onDiscreteRotate: (delta: number) => void;
  isPending: boolean;
}) {
  // Keyboard: Enter = Apply, Escape = cancel.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onApply();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onEscape();
    }
  };

  const displayAngle = Number(draftAngle.toFixed(1));

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- rotate widget captures arrow-key events; tabIndex=-1 means programmatically focusable only; full ARIA role would be redundant here
    <div
      className="flex flex-wrap items-center gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <span className="font-medium text-amber-800">Rotate:</span>
      {/* Angle readout */}
      <span className="min-w-[4rem] rounded bg-white px-2 py-0.5 font-mono text-sm text-slate-800 border border-slate-200">
        {displayAngle < 0 ? `${displayAngle}°` : `${displayAngle}°`}
      </span>
      {/* Apply / Reset / Escape */}
      <button
        onClick={onApply}
        disabled={isPending}
        className="rounded bg-amber-600 px-3 py-1 text-sm text-white hover:bg-amber-700 disabled:opacity-50"
      >
        Apply
      </button>
      <button
        onClick={onReset}
        disabled={isPending}
        className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
      >
        Reset
      </button>
      <button
        onClick={onEscape}
        className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50"
      >
        Cancel
      </button>
      {/* Discrete orientation buttons */}
      <span className="ml-2 text-slate-500">|</span>
      <button
        onClick={() => onDiscreteRotate(90)}
        disabled={isPending}
        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
        title="Rotate 90° clockwise"
      >
        90° CW
      </button>
      <button
        onClick={() => onDiscreteRotate(-90)}
        disabled={isPending}
        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
        title="Rotate 90° counter-clockwise"
      >
        90° CCW
      </button>
      <button
        onClick={() => onDiscreteRotate(180)}
        disabled={isPending}
        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
        title="Rotate 180°"
      >
        180°
      </button>
    </div>
  );
}

// ─── Flip toolbar ──────────────────────────────────────────────────────────

function FlipToolbar({
  flipH,
  flipV,
  onFlipH,
  onFlipV,
  onReset,
  onCancel,
  isPending,
}: {
  flipH: boolean;
  flipV: boolean;
  onFlipH: () => void;
  onFlipV: () => void;
  onReset: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-teal-200 bg-teal-50 px-3 py-2 text-sm">
      <span className="font-medium text-teal-800">Flip:</span>
      <button
        onClick={onFlipH}
        disabled={isPending}
        aria-pressed={flipH}
        className={`rounded border px-3 py-1 text-sm disabled:opacity-50 ${
          flipH
            ? "border-teal-600 bg-teal-600 text-white"
            : "border-slate-300 bg-white hover:bg-slate-50"
        }`}
      >
        Flip Horizontal
      </button>
      <button
        onClick={onFlipV}
        disabled={isPending}
        aria-pressed={flipV}
        className={`rounded border px-3 py-1 text-sm disabled:opacity-50 ${
          flipV
            ? "border-teal-600 bg-teal-600 text-white"
            : "border-slate-300 bg-white hover:bg-slate-50"
        }`}
      >
        Flip Vertical
      </button>
      <span className="ml-2 text-slate-500">|</span>
      <button
        onClick={onReset}
        disabled={isPending}
        className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
      >
        Reset
      </button>
      <button
        onClick={onCancel}
        className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50"
      >
        Cancel
      </button>
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

/**
 * Read natural-pixel rect from a Konva.Rect node.
 *
 * Phase 2.2: pd-ui's Stage applies scaleX/scaleY at the Stage level, so
 * node.x() / node.y() / node.width() / node.height() already return values
 * in natural-pixel space. No division by `scale` is needed.
 */
function rectFromNode(node: Konva.Node): {
  L: number;
  R: number;
  T: number;
  B: number;
} {
  const x = node.x();
  const y = node.y();
  const w = node.width() * node.scaleX();
  const h = node.height() * node.scaleY();
  return {
    L: Math.round(x),
    R: Math.round(x + w),
    T: Math.round(y),
    B: Math.round(y + h),
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
