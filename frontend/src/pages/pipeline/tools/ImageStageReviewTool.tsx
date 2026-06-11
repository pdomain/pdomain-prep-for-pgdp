/**
 * ImageStageReviewTool — shared review surface for imageStageReview stages.
 *
 * Handles: threshold, deskew, denoise, dewarp, post_transform_crop
 * (post_ocr_crop and canvas_map belong to other groups' canvases but share
 * the same machine — they can use this surface too, augmenting with their
 * own per-stage extras at I1).
 *
 * Layout (DCArtboard-faithful):
 *   ┌────────────────────────────────────────────────────────┐
 *   │  Banner: running / review / settled / confirming       │
 *   │  ─────────────────────────────────────────────────     │
 *   │  Toolbar: filter chips · density toggle · bulk bar     │
 *   │  ─────────────────────────────────────────────────     │
 *   │  Flag grid (pages with thumbnails + flag chips)        │
 *   │    ├── inline editor (exclusive, one at a time)        │
 *   │        ├── before/after wipe                           │
 *   │        ├── controls per STAGE_SCHEMAS[stageId]         │
 *   │        └── apply-to picker + Rerun / Accept-as-is      │
 *   │  ─────────────────────────────────────────────────     │
 *   │  Confirm gate (guarded by allFlagsReviewed)            │
 *   └────────────────────────────────────────────────────────┘
 *
 * Props:
 *   - stageId: string — matched against STAGE_SCHEMAS for control defs
 *   - runnerRef: StageRunnerRef — passed through but not used yet at F5
 *
 * Machine:
 *   The component instantiates imageStageReviewMachine with the mock service
 *   adapter. At I1 replace makeImageStageReviewServices() with real API calls.
 *
 * @see src/machines/imageStageReview.ts
 * @see src/pages/pipeline/tools/stageSchemas.ts
 * @see src/pages/pipeline/toolSlot.tsx
 * @see docs/plans/design_handoff_pgdp_app/final/threshold/threshold.jsx
 */

import { useState, useMemo } from "react";
import { useActor } from "@xstate/react";
import { useParams } from "react-router-dom";
import type { SnapshotFrom } from "xstate";
import {
  imageStageReviewMachine,
  type PageRow,
  type ImageStageReviewEvent,
  type ImageStageReviewServices,
} from "@/machines/imageStageReview";
import type { ToolSlotProps } from "../toolSlot";
import {
  getStageSchema,
  type FlagKindDef,
  type ControlDef,
} from "./stageSchemas";
import { Button } from "@/components/ui/Button";
import { buildRealImageStageReviewServices } from "@/services/tools/imageStageReview";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** 3-state banner: running / review / settled / confirming */
function ReviewBanner({
  machineState,
  totals,
  stageLabel,
  onRerunStage,
  onConfirm,
}: {
  machineState: string;
  totals: ReturnType<typeof imageStageReviewMachine.provide> extends never
    ? never
    : {
        flagged: number;
        total: number;
        reviewed: number;
        running: number;
      } | null;
  stageLabel: string;
  onRerunStage: () => void;
  onConfirm: () => void;
}) {
  if (machineState === "loading") {
    return (
      <div
        data-testid="review-banner-loading"
        style={{
          padding: "10px 16px",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-1)",
          borderRadius: 8,
          fontSize: 13,
          color: "var(--ink-3)",
        }}
      >
        Loading {stageLabel} pages…
      </div>
    );
  }

  if (machineState === "running") {
    const running = totals?.running ?? 0;
    const total = totals?.total ?? 0;
    return (
      <div
        data-testid="review-banner-running"
        style={{
          padding: "10px 16px",
          background: "color-mix(in oklab, var(--ocr) 8%, var(--bg-surface))",
          border:
            "1px solid color-mix(in oklab, var(--ocr) 35%, var(--border-1))",
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontSize: 13, color: "var(--ink-1)", fontWeight: 600 }}>
          Running {stageLabel} · {total - running}/{total} pages done
        </span>
      </div>
    );
  }

  if (machineState === "settled") {
    return (
      <div
        data-testid="review-banner-settled"
        style={{
          padding: "10px 16px",
          background: "color-mix(in oklab, var(--exact) 8%, var(--bg-surface))",
          border:
            "1px solid color-mix(in oklab, var(--exact) 30%, var(--border-1))",
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontSize: 13, color: "var(--exact)", fontWeight: 600 }}>
          {stageLabel} · all pages reviewed
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <Button variant="ghost" size="sm" onClick={onRerunStage}>
            Re-run stage
          </Button>
          <Button variant="primary" size="sm" onClick={onConfirm}>
            Confirm & advance
          </Button>
        </div>
      </div>
    );
  }

  if (machineState === "confirming") {
    return (
      <div
        data-testid="review-banner-confirming"
        style={{
          padding: "10px 16px",
          background: "color-mix(in oklab, var(--ocr) 8%, var(--bg-surface))",
          border:
            "1px solid color-mix(in oklab, var(--ocr) 30%, var(--border-1))",
          borderRadius: 8,
          fontSize: 13,
          color: "var(--ink-2)",
        }}
      >
        Confirming advance…
      </div>
    );
  }

  // review state
  const flagged = totals?.flagged ?? 0;
  const reviewed = totals?.reviewed ?? 0;
  const allReviewed = flagged === 0 || reviewed >= flagged;

  return (
    <div
      data-testid="review-banner-review"
      style={{
        padding: "10px 16px",
        background: "color-mix(in oklab, var(--fuzzy) 8%, var(--bg-surface))",
        border:
          "1px solid color-mix(in oklab, var(--fuzzy) 30%, var(--border-1))",
        borderRadius: 8,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <span style={{ fontSize: 13, color: "var(--ink-1)", fontWeight: 600 }}>
        {stageLabel} · {flagged} flagged · {reviewed}/{flagged} reviewed
      </span>
      <div style={{ display: "flex", gap: 6 }}>
        <Button variant="ghost" size="sm" onClick={onRerunStage}>
          Re-run stage
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onConfirm}
          disabled={!allReviewed}
          data-testid="confirm-advance-btn"
        >
          Confirm & advance
        </Button>
      </div>
    </div>
  );
}

/** Flag chip for the page grid */
function FlagChip({
  kind,
  flagDefs,
}: {
  kind: string;
  flagDefs: FlagKindDef[];
}) {
  const def = flagDefs.find((f) => f.key === kind);
  const tone = def?.tone ?? "var(--fuzzy)";
  const label = def?.label ?? kind;
  return (
    <span
      data-testid={`flag-chip-${kind}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        height: 16,
        padding: "0 6px",
        borderRadius: 99,
        fontSize: 9.5,
        fontWeight: 600,
        fontFamily: "var(--mono-font, monospace)",
        background: `color-mix(in oklab, ${tone} 16%, rgba(12,12,16,0.78))`,
        color: tone,
        border: `1px solid color-mix(in oklab, ${tone} 45%, transparent)`,
      }}
    >
      <span
        style={{ width: 4.5, height: 4.5, borderRadius: 99, background: tone }}
      />
      {label}
    </span>
  );
}

/** Fake page thumbnail for the grid */
function PageThumb({ row }: { row: PageRow }) {
  const isFlagged = row.state === "flagged";
  return (
    <div
      data-testid={`page-thumb-${row.idx}`}
      style={{
        width: 80,
        height: 108,
        position: "relative",
        background: isFlagged ? "oklch(0.92 0.02 60)" : "oklch(0.93 0 0)",
        borderRadius: 3,
        border: `1.5px solid ${isFlagged ? "var(--fuzzy)" : "var(--border-2)"}`,
        overflow: "hidden",
      }}
    >
      {/* Simulated page content */}
      <div
        style={{
          position: "absolute",
          inset: "12% 14%",
          backgroundImage: `repeating-linear-gradient(to bottom, oklch(0.32 0 0) 0 1.5px, transparent 1.5px 6px)`,
          opacity: 0.65,
        }}
      />
      <span
        style={{
          position: "absolute",
          bottom: 4,
          left: "50%",
          transform: "translateX(-50%)",
          fontFamily: "monospace",
          fontSize: 8,
          color: "oklch(0.4 0 0)",
        }}
      >
        {row.prefix}
      </span>
    </div>
  );
}

/** Control editor for inline page-level parameter tuning */
function ControlEditor({
  controls,
  draft,
  onPatch,
}: {
  controls: ControlDef[];
  draft: Record<string, unknown>;
  onPatch: (patch: Record<string, unknown>) => void;
}) {
  return (
    <div
      data-testid="control-editor"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "10px 12px",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-1)",
        borderRadius: 7,
      }}
    >
      {controls.map((ctrl) => {
        const currentVal = draft[ctrl.key] ?? ctrl.defaultValue;
        return (
          <div
            key={ctrl.key}
            data-testid={`control-${ctrl.key}`}
            style={{ display: "flex", flexDirection: "column", gap: 5 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11.5, color: "var(--ink-2)" }}>
                {ctrl.label}
              </span>
              {ctrl.kind === "slider" && (
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "var(--ink-1)",
                  }}
                >
                  {typeof currentVal === "number"
                    ? currentVal
                    : typeof ctrl.defaultValue === "string" ||
                        typeof ctrl.defaultValue === "number"
                      ? String(ctrl.defaultValue)
                      : ""}
                </span>
              )}
            </div>
            {ctrl.description && (
              <div
                style={{
                  fontSize: 10.5,
                  color: "var(--ink-4)",
                  lineHeight: 1.4,
                }}
              >
                {ctrl.description}
              </div>
            )}
            {ctrl.kind === "slider" && ctrl.range && (
              <input
                type="range"
                data-testid={`slider-${ctrl.key}`}
                min={ctrl.range[0]}
                max={ctrl.range[1]}
                step={ctrl.range[2]}
                value={
                  typeof currentVal === "number" ? currentVal : ctrl.range[0]
                }
                onChange={(e) =>
                  onPatch({ [ctrl.key]: parseFloat(e.target.value) })
                }
                style={{ width: "100%" }}
              />
            )}
            {ctrl.kind === "toggle" && (
              <button
                data-testid={`toggle-${ctrl.key}`}
                onClick={() => onPatch({ [ctrl.key]: !currentVal })}
                style={{
                  padding: "4px 8px",
                  borderRadius: 5,
                  border: "1px solid var(--border-2)",
                  background: currentVal ? "var(--accent)" : "var(--bg-raised)",
                  color: currentVal ? "#fff" : "var(--ink-2)",
                  fontSize: 11.5,
                  cursor: "pointer",
                  alignSelf: "flex-start",
                }}
              >
                {currentVal ? "On" : "Off"}
              </button>
            )}
            {ctrl.kind === "select" && ctrl.options && (
              <select
                data-testid={`select-${ctrl.key}`}
                value={
                  typeof currentVal === "string"
                    ? currentVal
                    : String(ctrl.defaultValue)
                }
                onChange={(e) => onPatch({ [ctrl.key]: e.target.value })}
                style={{
                  padding: "4px 8px",
                  borderRadius: 5,
                  border: "1px solid var(--border-2)",
                  background: "var(--bg-raised)",
                  color: "var(--ink-1)",
                  fontSize: 11.5,
                }}
              >
                {ctrl.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Inline page editor — exclusive, one at a time */
function InlineEditor({
  row,
  draft,
  applyTo,
  controls,
  flagDefs,
  onPatch,
  onSetApplyTo,
  onAcceptAsIs,
  onRerun,
  onCancel,
}: {
  row: PageRow;
  draft: Record<string, unknown>;
  applyTo: "this" | "selected" | "sameIssue";
  controls: ControlDef[];
  flagDefs: FlagKindDef[];
  onPatch: (patch: Record<string, unknown>) => void;
  onSetApplyTo: (value: "this" | "selected" | "sameIssue") => void;
  onAcceptAsIs: () => void;
  onRerun: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      data-testid={`inline-editor-${row.idx}`}
      style={{
        marginTop: 8,
        border: "1.5px solid var(--accent)",
        borderRadius: 8,
        background: "var(--bg-surface)",
        overflow: "hidden",
      }}
    >
      {/* Editor header */}
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--border-1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontFamily: "monospace",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--ink-1)",
            }}
          >
            {row.prefix}
          </span>
          {row.flags?.map((f) => (
            <FlagChip key={f} kind={f} flagDefs={flagDefs} />
          ))}
        </div>
        <button
          data-testid="editor-close-btn"
          onClick={onCancel}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            fontSize: 16,
            color: "var(--ink-3)",
            padding: "0 4px",
          }}
        >
          ×
        </button>
      </div>

      {/* Before/after wipe placeholder */}
      <div
        data-testid="wipe-viewer"
        style={{
          height: 160,
          background: "var(--bg-page)",
          display: "grid",
          gridTemplateColumns: "1fr 6px 1fr",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            color: "var(--ink-4)",
            fontFamily: "monospace",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          before
        </div>
        <div style={{ background: "var(--border-2)" }} />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 10,
            color: "var(--ink-4)",
            fontFamily: "monospace",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          after
        </div>
      </div>

      {/* Controls */}
      <div style={{ padding: 12 }}>
        <ControlEditor controls={controls} draft={draft} onPatch={onPatch} />
      </div>

      {/* Apply-to selector */}
      <div
        style={{
          padding: "8px 14px",
          borderTop: "1px solid var(--border-1)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: "var(--ink-3)",
            fontWeight: 500,
            flex: "0 0 auto",
          }}
        >
          Apply to:
        </span>
        {(["this", "selected", "sameIssue"] as const).map((val) => (
          <button
            key={val}
            data-testid={`apply-to-${val}`}
            onClick={() => onSetApplyTo(val)}
            style={{
              padding: "3px 10px",
              borderRadius: 5,
              border: `1px solid ${applyTo === val ? "var(--accent)" : "var(--border-2)"}`,
              background:
                applyTo === val
                  ? "color-mix(in oklab, var(--accent) 14%, transparent)"
                  : "transparent",
              color: applyTo === val ? "var(--accent)" : "var(--ink-2)",
              fontSize: 11.5,
              fontWeight: applyTo === val ? 600 : 500,
              cursor: "pointer",
            }}
          >
            {val === "this"
              ? "This page"
              : val === "selected"
                ? "Selected"
                : "Same flag"}
          </button>
        ))}
      </div>

      {/* Action buttons */}
      <div
        style={{
          padding: "10px 14px",
          borderTop: "1px solid var(--border-1)",
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
        }}
      >
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onAcceptAsIs}
          data-testid="accept-as-is-btn"
        >
          Accept as-is
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onRerun}
          data-testid="rerun-btn"
        >
          Re-run
        </Button>
      </div>
    </div>
  );
}

/** Filter chip bar */
function FilterBar({
  filter,
  flagDefs,
  onSetFilter,
}: {
  filter: string;
  flagDefs: FlagKindDef[];
  onSetFilter: (value: string) => void;
}) {
  const chips = [
    { id: "all", label: "All" },
    { id: "flagged", label: "Flagged" },
    ...flagDefs.map((f) => ({ id: f.key, label: f.label })),
  ];

  return (
    <div
      data-testid="filter-bar"
      style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
    >
      {chips.map((chip) => {
        const active = filter === chip.id;
        return (
          <button
            key={chip.id}
            data-testid={`filter-chip-${chip.id}`}
            onClick={() => onSetFilter(chip.id)}
            style={{
              padding: "3px 10px",
              height: 26,
              borderRadius: 6,
              border: active
                ? "1px solid color-mix(in oklab, var(--accent) 50%, var(--border-1))"
                : "1px solid var(--border-1)",
              background: active
                ? "color-mix(in oklab, var(--accent) 12%, transparent)"
                : "transparent",
              color: active ? "var(--accent)" : "var(--ink-2)",
              fontSize: 11.5,
              fontWeight: active ? 600 : 500,
              cursor: "pointer",
            }}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}

/** Density toggle */
function DensityToggle({
  density,
  onSetDensity,
}: {
  density: "S" | "M" | "L";
  onSetDensity: (value: "S" | "M" | "L") => void;
}) {
  return (
    <div
      data-testid="density-toggle"
      style={{
        display: "inline-flex",
        padding: 2,
        gap: 2,
        background: "var(--bg-page)",
        border: "1px solid var(--border-1)",
        borderRadius: 6,
      }}
    >
      {(["S", "M", "L"] as const).map((d) => (
        <button
          key={d}
          data-testid={`density-${d}`}
          onClick={() => onSetDensity(d)}
          style={{
            padding: "3px 9px",
            borderRadius: 4,
            border:
              density === d
                ? "1px solid var(--border-2)"
                : "1px solid transparent",
            background: density === d ? "var(--bg-surface)" : "transparent",
            color: density === d ? "var(--ink-1)" : "var(--ink-3)",
            fontSize: 11,
            fontWeight: density === d ? 600 : 500,
            cursor: "pointer",
          }}
        >
          {d}
        </button>
      ))}
    </div>
  );
}

/** Bulk action bar (shown when selection > 0) */
function BulkBar({
  selectedCount,
  onBulkAccept,
  onBulkRerun,
  onClearSelection,
}: {
  selectedCount: number;
  onBulkAccept: () => void;
  onBulkRerun: () => void;
  onClearSelection: () => void;
}) {
  if (selectedCount === 0) return null;
  return (
    <div
      data-testid="bulk-bar"
      style={{
        padding: "8px 14px",
        background: "color-mix(in oklab, var(--accent) 8%, var(--bg-surface))",
        border:
          "1px solid color-mix(in oklab, var(--accent) 30%, var(--border-1))",
        borderRadius: 8,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "var(--ink-1)",
          flex: 1,
        }}
      >
        {selectedCount} page{selectedCount !== 1 ? "s" : ""} selected
      </span>
      <Button variant="ghost" size="sm" onClick={onClearSelection}>
        Clear
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={onBulkAccept}
        data-testid="bulk-accept-btn"
      >
        Accept selected
      </Button>
      <Button
        variant="primary"
        size="sm"
        onClick={onBulkRerun}
        data-testid="bulk-rerun-btn"
      >
        Re-run selected
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Props for ImageStageReviewTool — ToolSlotProps plus an optional actor
 * override for callers that need to own the machine instance (e.g. CanvasMapTool
 * wiring REDERIVE from an extras panel outside the shared surface).
 *
 * When `actorOverride` is absent the component creates its own actor.
 */
export interface ImageStageReviewToolProps extends ToolSlotProps {
  /**
   * Optional pre-created actor. When provided:
   *   - `snapshot` / `send` are used directly instead of creating a new actor.
   *   - The component does NOT start/stop the actor — the caller owns its lifetime.
   * When absent, the component calls `useActor(imageStageReviewMachine, ...)`.
   */
  actorOverride?: {
    snapshot: SnapshotFrom<typeof imageStageReviewMachine>;
    send: (event: ImageStageReviewEvent) => void;
  };
  /** Test-only: inject services directly to bypass real API calls. */
  _testServices?: ImageStageReviewServices;
}

/**
 * ImageStageReviewTool — the shared review surface for imageStageReview stages.
 *
 * @see docs/plans/design_handoff_pgdp_app/final/threshold/threshold.jsx
 * @see src/pages/pipeline/toolSlot.tsx — F5 contract
 */
export function ImageStageReviewTool({
  stageId,
  runnerRef: _runnerRef,
  actorOverride,
  _testServices,
}: ImageStageReviewToolProps) {
  const { projectId = "mock-project" } = useParams();

  const schema = getStageSchema(stageId);
  const stageLabel = schema?.label ?? stageId;
  const flagDefs = schema?.flagKinds ?? [];
  const controls = schema?.controls ?? [];

  const services = useMemo(
    () => _testServices ?? buildRealImageStageReviewServices(),
    [_testServices],
  );

  const ownActor = useActor(imageStageReviewMachine, {
    input: {
      projectId,
      stageId,
      stageIndex: 0,
      services,
    },
  });

  // Use the provided actor override if given; fall back to own actor.
  const [snapshot, send] = actorOverride
    ? ([actorOverride.snapshot, actorOverride.send] as const)
    : ownActor;

  const ctx = snapshot.context;

  // Current top-level state name
  const topState = (() => {
    if (snapshot.matches("loading")) return "loading";
    if (snapshot.matches("running")) return "running";
    if (snapshot.matches("review")) return "review";
    if (snapshot.matches("settled")) return "settled";
    if (snapshot.matches("confirming")) return "confirming";
    if (snapshot.matches("loadError")) return "loadError";
    return "unknown";
  })();

  // Filter pages by current filter
  const visibleRows = useMemo(() => {
    const rows = ctx.rows;
    if (ctx.filter === "all") return rows;
    if (ctx.filter === "flagged")
      return rows.filter((r) => r.state === "flagged");
    return rows.filter((r) => r.flags?.includes(ctx.filter) ?? false);
  }, [ctx.rows, ctx.filter]);

  // Selection (for the selecting sub-state)
  const [localSelected, setLocalSelected] = useState<string[]>([]);
  const isSelecting = snapshot.matches({ review: "selecting" });
  const selectedIds = isSelecting ? ctx.selected : localSelected;

  // Editing row
  const editingRow = ctx.editing
    ? ctx.rows.find((r) => r.idx === ctx.editing)
    : null;
  const isEditing = snapshot.matches({ review: "editing" });
  const isRerunning = snapshot.matches({ review: "rerunning" });

  // Grid column count from density
  const colCount = ctx.density === "S" ? 8 : ctx.density === "L" ? 4 : 6;

  if (topState === "loadError") {
    return (
      <div
        data-testid="image-stage-review-error"
        style={{ padding: 24, textAlign: "center", color: "var(--mismatch)" }}
      >
        <div style={{ marginBottom: 12 }}>
          Failed to load {stageLabel} pages.
        </div>
        <div style={{ marginBottom: 12, fontSize: 12, color: "var(--ink-3)" }}>
          {ctx.error?.message}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => send({ type: "RETRY" })}
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div
      data-testid={`image-stage-review-tool-${stageId}`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 16,
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* Banner */}
      <ReviewBanner
        machineState={topState}
        totals={ctx.totals}
        stageLabel={stageLabel}
        onRerunStage={() => send({ type: "RERUN_STAGE" })}
        onConfirm={() => send({ type: "CONFIRM_ADVANCE" })}
      />

      {/* Toolbar */}
      <div
        data-testid="review-toolbar"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <FilterBar
          filter={ctx.filter}
          flagDefs={flagDefs}
          onSetFilter={(value) => send({ type: "SET_FILTER", value })}
        />
        <div style={{ flex: 1 }} />
        <DensityToggle
          density={ctx.density}
          onSetDensity={(value) => send({ type: "SET_DENSITY", value })}
        />
      </div>

      {/* Bulk bar */}
      {isSelecting && (
        <BulkBar
          selectedCount={ctx.selected.length}
          onBulkAccept={() => send({ type: "BULK_ACCEPT" })}
          onBulkRerun={() => send({ type: "BULK_RERUN" })}
          onClearSelection={() => {
            send({ type: "CLEAR_SELECTION" });
            setLocalSelected([]);
          }}
        />
      )}

      {/* Error display (inline, inside review state) */}
      {ctx.error && topState === "review" && (
        <div
          data-testid="review-inline-error"
          style={{
            padding: "8px 12px",
            background:
              "color-mix(in oklab, var(--mismatch) 8%, var(--bg-surface))",
            border:
              "1px solid color-mix(in oklab, var(--mismatch) 30%, var(--border-1))",
            borderRadius: 6,
            fontSize: 12,
            color: "var(--mismatch)",
          }}
        >
          {ctx.error.message}
        </div>
      )}

      {/* Page grid */}
      <div
        data-testid="page-grid"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${colCount}, 1fr)`,
          gap: 12,
          padding: 14,
          background: "var(--bg-surface)",
          border: "1px solid var(--border-1)",
          borderRadius: 8,
          flex: 1,
          minHeight: 240,
          overflowY: "auto",
        }}
      >
        {(topState === "loading" || topState === "running") &&
        visibleRows.length === 0 ? (
          <div
            style={{
              gridColumn: `1 / -1`,
              padding: 24,
              textAlign: "center",
              color: "var(--ink-3)",
              fontSize: 13,
            }}
          >
            {topState === "loading" ? "Loading…" : "Running…"}
          </div>
        ) : null}

        {visibleRows.map((row) => {
          const isOpen = ctx.editing === row.idx;
          const isSelected = selectedIds.includes(row.idx);

          return (
            <div
              key={row.idx}
              data-testid={`page-cell-${row.idx}`}
              style={{ display: "flex", flexDirection: "column", gap: 6 }}
            >
              {/* Thumbnail + selection ring */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (isEditing && !isOpen) {
                    // Open the new editor (replaces current)
                    send({ type: "OPEN_EDITOR", idx: row.idx });
                  } else if (isSelecting) {
                    send({ type: "SELECT_PAGE", idx: row.idx });
                  } else if (row.state === "flagged") {
                    send({ type: "OPEN_EDITOR", idx: row.idx });
                  } else {
                    // Start selection on clean pages too
                    send({ type: "SELECT_PAGE", idx: row.idx });
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (row.state === "flagged" || isEditing) {
                      send({ type: "OPEN_EDITOR", idx: row.idx });
                    } else {
                      send({ type: "SELECT_PAGE", idx: row.idx });
                    }
                  }
                }}
                style={{
                  cursor: "pointer",
                  outline: isSelected
                    ? "2px solid var(--accent)"
                    : isOpen
                      ? "2px solid var(--fuzzy)"
                      : "none",
                  outlineOffset: 2,
                  borderRadius: 4,
                  display: "inline-block",
                }}
              >
                <PageThumb row={row} />
              </div>

              {/* Page label + flags */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: 10,
                    color: "var(--ink-3)",
                  }}
                >
                  {row.prefix}
                </span>
                {row.flags?.map((f) => (
                  <FlagChip key={f} kind={f} flagDefs={flagDefs} />
                ))}
              </div>

              {/* Inline editor (exclusive) */}
              {isOpen && editingRow && !isRerunning && (
                <InlineEditor
                  row={editingRow}
                  draft={ctx.draft ?? {}}
                  applyTo={ctx.applyTo}
                  controls={controls}
                  flagDefs={flagDefs}
                  onPatch={(patch) => send({ type: "SET_PARAM", patch })}
                  onSetApplyTo={(value) =>
                    send({ type: "SET_APPLY_TO", value })
                  }
                  onAcceptAsIs={() => send({ type: "ACCEPT_AS_IS" })}
                  onRerun={() => send({ type: "RERUN" })}
                  onCancel={() => send({ type: "CANCEL" })}
                />
              )}

              {/* Rerunning spinner */}
              {isOpen && isRerunning && (
                <div
                  data-testid={`rerunning-${row.idx}`}
                  style={{
                    padding: 12,
                    textAlign: "center",
                    fontSize: 12,
                    color: "var(--ocr)",
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border-1)",
                    borderRadius: 7,
                    marginTop: 8,
                  }}
                >
                  Re-running {row.prefix}…
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Settled confirm gate (bottom of the surface) */}
      {(topState === "settled" || topState === "review") && (
        <div
          data-testid="confirm-gate"
          style={{
            padding: "10px 14px",
            background: "var(--bg-surface)",
            border: "1px solid var(--border-1)",
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
            {topState === "settled"
              ? `${stageLabel} complete — advance to next stage.`
              : `Review all flagged pages before advancing.`}
          </span>
          <Button
            variant="primary"
            size="sm"
            onClick={() => send({ type: "CONFIRM_ADVANCE" })}
            disabled={
              topState === "review" &&
              !(
                ctx.totals &&
                (ctx.totals.flagged === 0 ||
                  ctx.totals.flagged === ctx.totals.reviewed)
              )
            }
            data-testid="bottom-confirm-advance-btn"
          >
            {schema?.confirmLabel ?? "Confirm & advance"}
          </Button>
        </div>
      )}
    </div>
  );
}
