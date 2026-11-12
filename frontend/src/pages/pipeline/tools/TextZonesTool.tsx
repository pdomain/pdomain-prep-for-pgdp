/**
 * TextZonesTool.tsx — React surface for the Text Zones stage tool.
 *
 * Registered in TOOL_REGISTRY as `text_zones`. Renders three tabs:
 * - **Overview** — stats projection from machine context (derived, never stored)
 * - **Pages**    — zone page grid, inline zone/split editors, confirm gate
 * - **Settings** — stage settings panel (minimal at F5; follows F5.1 pattern)
 *
 * Services are the real v2 routes (`buildRealTextZonesToolServices`).
 * W2.4: page cards show the ingest thumbnail, and both inline editors are
 * Konva boards over the real page image: the zone editor draws, selects,
 * re-types and deletes zones, and the split editor moves the gutter before
 * APPLY_SPLIT creates the sibling pages.
 *
 * @see src/machines/tools/textZonesTool.ts — machine + types
 * @see docs/plans/design_handoff_pgdp_app/final/text_zones/ — design canvas
 */

import type { ReactNode } from "react";
import { useActor } from "@xstate/react";
import { useMemo, useState } from "react";
import type { Zone, ZoneType } from "@/machines/tools/textZonesTool";
import { ZoneCanvas } from "./textZones/ZoneCanvas";
import { ZONE_TYPE_COLORS } from "./textZones/zoneColors";
import { SplitCanvas } from "./textZones/SplitCanvas";
import type { NormBox } from "./textZones/geometry";
import { pageImageUrls, pageThumbnailUrl, rowIdx0 } from "./textZones/geometry";
import { useParams } from "react-router-dom";
import type { ToolSlotProps } from "../toolSlot";
import {
  textZonesToolMachine,
  type ZonePageRow,
  type ZoneTotals,
  type SplitDraft,
  type TextZonesToolServices,
} from "@/machines/tools/textZonesTool";
import { buildRealTextZonesToolServices } from "@/services/tools/textZonesTool";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stateColor(state: ZonePageRow["state"]): string {
  switch (state) {
    case "clean":
      return "var(--exact)";
    case "flagged":
      return "var(--fuzzy)";
    case "reviewed":
      return "var(--ocr)";
    case "split":
      return "var(--ocr)";
    case "running":
      return "var(--ocr)";
    default:
      return "var(--ink-4)";
  }
}

function totalsLabel(totals: ZoneTotals): string {
  const parts: string[] = [];
  if (totals.clean > 0) parts.push(`${totals.clean} clean`);
  if (totals.flagged > 0) parts.push(`${totals.flagged} flagged`);
  if (totals.splits > 0) parts.push(`${totals.splits} splits`);
  if (totals.reviewed > 0) parts.push(`${totals.reviewed} reviewed`);
  return parts.join(" · ") || "No pages";
}

// ---------------------------------------------------------------------------
// Zone card thumbnail — the page's ingest thumbnail; schematic only when the
// thumbnail is missing.
// ---------------------------------------------------------------------------

function ZoneCardThumb({
  row,
  projectId,
}: {
  row: ZonePageRow;
  projectId: string;
}): ReactNode {
  const isRunning = row.state === "running";
  const hasSplit = row.flags?.includes("splitSuggested") && !isRunning;
  const thumbUrl = pageThumbnailUrl(projectId, rowIdx0(row));
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = failedUrl !== thumbUrl;
  return (
    <div
      data-testid="zone-card-thumb"
      style={{
        width: "100%",
        aspectRatio: "3/4",
        background: "#fff",
        border: "1px solid var(--border-2)",
        borderRadius: 3,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {isRunning ? (
        <div
          data-testid="zone-thumb-skeleton"
          style={{
            position: "absolute",
            inset: 0,
            background:
              "repeating-linear-gradient(90deg, var(--bg-raised) 0 40%, var(--bg-sunk) 40% 60%, var(--bg-raised) 60% 100%)",
            backgroundSize: "200% 100%",
          }}
        />
      ) : (
        <>
          {showImage ? (
            <img
              data-testid="zone-card-image"
              alt={`Page ${row.prefix}`}
              src={thumbUrl}
              loading="lazy"
              onError={() => setFailedUrl(thumbUrl)}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "contain",
              }}
            />
          ) : (
            /* Schematic zone blocks — no thumbnail for this page yet */
            <div
              style={{
                position: "absolute",
                top: "8%",
                left: "10%",
                right: "10%",
                height: "72%",
                opacity: 0.55,
                backgroundImage:
                  "repeating-linear-gradient(to bottom, oklch(0.2 0 0) 0 1.5px, transparent 1.5px 5px)",
              }}
            />
          )}
          {/* Split guide if applicable */}
          {hasSplit && row.split ? (
            <div
              data-testid="zone-thumb-split-guide"
              style={{
                position: "absolute",
                top:
                  row.split.axis === "row"
                    ? `${row.split.gutter * 100}%`
                    : "4%",
                bottom: row.split.axis === "col" ? "4%" : undefined,
                left:
                  row.split.axis === "col"
                    ? `${row.split.gutter * 100}%`
                    : "4%",
                right: row.split.axis === "row" ? "4%" : undefined,
                width: row.split.axis === "col" ? 0 : undefined,
                height: row.split.axis === "row" ? 0 : undefined,
                borderLeft:
                  row.split.axis === "col"
                    ? "2px dashed var(--ocr)"
                    : undefined,
                borderTop:
                  row.split.axis === "row"
                    ? "2px dashed var(--ocr)"
                    : undefined,
              }}
            />
          ) : null}
        </>
      )}
      {/* State indicator corner */}
      <span
        style={{
          position: "absolute",
          top: 4,
          left: 4,
          width: 6,
          height: 6,
          borderRadius: 99,
          background: stateColor(row.state),
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Zone page card
// ---------------------------------------------------------------------------

function ZonePageCard({
  row,
  projectId,
  isEditing,
  onClick,
}: {
  row: ZonePageRow;
  projectId: string;
  isEditing: boolean;
  onClick: () => void;
}): ReactNode {
  const hasSplit = row.flags?.includes("splitSuggested");
  return (
    <div
      data-testid="zone-page-card"
      data-idx={row.idx}
      data-state={row.state}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
      style={{
        padding: 4,
        borderRadius: 6,
        border: `1.5px solid ${isEditing ? "var(--ocr)" : "var(--border-1)"}`,
        background: isEditing
          ? "color-mix(in oklab, var(--ocr) 6%, var(--bg-surface))"
          : "transparent",
        cursor: "pointer",
      }}
    >
      <ZoneCardThumb row={row} projectId={projectId} />
      <div
        style={{
          marginTop: 4,
          fontSize: 10,
          fontFamily: "var(--mono-font, monospace)",
          color: "var(--ink-3)",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>{row.prefix}</span>
        {hasSplit ? (
          <span style={{ color: "var(--ocr)" }}>split</span>
        ) : row.state === "reviewed" ? (
          <span style={{ color: "var(--ocr)" }}>rv</span>
        ) : row.zones != null ? (
          <span>{row.zones}z</span>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared editor chrome
// ---------------------------------------------------------------------------

const ZONE_TYPES: readonly ZoneType[] = [
  "body",
  "heading",
  "header",
  "footer",
  "caption",
  "footnote",
  "illustration",
  "table",
  "marginalia",
];

const secondaryButton = {
  padding: "4px 12px",
  borderRadius: 5,
  border: "1px solid var(--border-2)",
  background: "var(--bg-surface)",
  cursor: "pointer",
  fontSize: 12,
  color: "var(--ink-2)",
} as const;

const primaryButton = {
  padding: "4px 12px",
  borderRadius: 5,
  border: "none",
  background: "var(--accent)",
  color: "var(--accent-ink, #fff)",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
} as const;

function segmentButton(active: boolean) {
  return {
    padding: "4px 10px",
    borderRadius: 5,
    border: "none",
    background: active ? "var(--bg-surface)" : "transparent",
    boxShadow: active ? "0 0 0 1px var(--border-1)" : "none",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: active ? 600 : 500,
    color: active ? "var(--ocr)" : "var(--ink-3)",
  } as const;
}

const segmentGroup = {
  display: "inline-flex",
  padding: 3,
  gap: 2,
  background: "var(--bg-raised)",
  border: "1px solid var(--border-1)",
  borderRadius: 7,
} as const;

function EditorError({ error }: { error: unknown }): ReactNode {
  if (error === null || error === undefined) return null;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "The request failed.";
  return (
    <div
      data-testid="zone-editor-error"
      role="alert"
      style={{ fontSize: 12, color: "var(--mismatch)" }}
    >
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline zone editor panel — Konva board over the page image
// ---------------------------------------------------------------------------

function ZoneEditorPanel({
  row,
  projectId,
  zones,
  tool,
  busy,
  error,
  onSetTool,
  onDraw,
  onRetype,
  onDelete,
  onSave,
  onCancel,
  onRedetect,
  onSplit,
}: {
  row: ZonePageRow;
  projectId: string;
  zones: readonly Zone[];
  tool: "select" | "box" | "lasso";
  busy: boolean;
  error: unknown;
  onSetTool: (tool: "select" | "box") => void;
  onDraw: (box: NormBox, zoneType: ZoneType) => void;
  onRetype: (zoneId: string, zoneType: ZoneType) => void;
  onDelete: (zoneId: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onRedetect: () => void;
  onSplit: () => void;
}): ReactNode {
  const [drawType, setDrawType] = useState<ZoneType>("body");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const imageUrls = useMemo(
    () => pageImageUrls(projectId, rowIdx0(row)),
    [projectId, row],
  );
  return (
    <div
      data-testid="zone-editor-panel"
      data-idx={row.idx}
      style={{
        marginTop: 12,
        padding: "16px 18px",
        border: "1px solid var(--ocr)",
        borderRadius: 8,
        background: "color-mix(in oklab, var(--ocr) 5%, var(--bg-surface))",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <span
          style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-1)" }}
        >
          Edit layout · {row.prefix}
        </span>
        <span
          style={{
            flex: 1,
            fontSize: 11,
            fontFamily: "var(--mono-font)",
            color: "var(--ink-3)",
          }}
        >
          {zones.length} zones · drag to draw · click a zone to select
        </span>
        <button
          data-testid="zone-editor-cancel"
          onClick={onCancel}
          style={{ ...secondaryButton, padding: "2px 10px", fontSize: 11 }}
        >
          Cancel
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 300px",
          gap: 16,
          alignItems: "start",
        }}
      >
        <div
          data-testid="zone-canvas-area"
          style={{
            padding: 16,
            background: "var(--bg-sunk)",
            border: "1px solid var(--border-1)",
            borderRadius: 6,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={segmentGroup}>
              {(
                [
                  ["select", "Select"],
                  ["box", "Draw box"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  data-testid={`zone-tool-${k}`}
                  aria-pressed={tool === k}
                  onClick={() => onSetTool(k)}
                  style={segmentButton(tool === k)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>as</span>
            <select
              data-testid="zone-draw-type"
              value={drawType}
              onChange={(e) => setDrawType(e.target.value as ZoneType)}
              style={{ fontSize: 12, padding: "3px 6px", borderRadius: 5 }}
            >
              {ZONE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <ZoneCanvas
            imageUrls={imageUrls}
            zones={zones}
            selectedId={selectedId}
            tool={tool}
            onSelect={setSelectedId}
            onDraw={(box) => onDraw(box, drawType)}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
            }}
          >
            Zones on this page
          </div>
          <div
            data-testid="zone-list"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              maxHeight: 320,
              overflow: "auto",
            }}
          >
            {zones.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--ink-4)" }}>
                No zones. Draw one on the page or re-detect.
              </div>
            ) : null}
            {zones.map((z, i) => (
              <div
                key={z.id}
                data-testid={`zone-list-item-${z.id}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "5px 8px",
                  borderRadius: 6,
                  background: "var(--bg-surface)",
                  border: `1px solid ${z.id === selectedId ? ZONE_TYPE_COLORS[z.type] : "var(--border-1)"}`,
                }}
              >
                <button
                  data-testid={`zone-select-${z.id}`}
                  aria-label={`Select zone ${i + 1}`}
                  aria-pressed={z.id === selectedId}
                  onClick={() => setSelectedId(z.id)}
                  style={{
                    width: 18,
                    height: 18,
                    padding: 0,
                    border: "none",
                    borderRadius: 3,
                    background: ZONE_TYPE_COLORS[z.type],
                    color: "#fff",
                    fontSize: 9,
                    fontWeight: 700,
                    display: "grid",
                    placeItems: "center",
                    flex: "0 0 auto",
                    cursor: "pointer",
                  }}
                >
                  {z.order ?? i + 1}
                </button>
                <select
                  data-testid={`zone-type-${z.id}`}
                  aria-label={`Type of zone ${i + 1}`}
                  value={z.type}
                  onChange={(e) => onRetype(z.id, e.target.value as ZoneType)}
                  style={{ flex: 1, fontSize: 12, padding: "2px 4px" }}
                >
                  {ZONE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <button
                  data-testid={`zone-delete-${z.id}`}
                  aria-label={`Delete zone ${i + 1}`}
                  onClick={() => {
                    if (selectedId === z.id) setSelectedId(null);
                    onDelete(z.id);
                  }}
                  style={{
                    ...secondaryButton,
                    padding: "1px 7px",
                    fontSize: 11,
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <EditorError error={error} />

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          data-testid="zone-editor-split"
          onClick={onSplit}
          disabled={busy}
          style={{ ...secondaryButton, marginRight: "auto" }}
        >
          Split page…
        </button>
        <button
          data-testid="zone-editor-redetect"
          onClick={onRedetect}
          disabled={busy}
          style={secondaryButton}
        >
          Re-detect
        </button>
        <button
          data-testid="zone-editor-save"
          onClick={onSave}
          disabled={busy}
          style={primaryButton}
        >
          {busy ? "Saving…" : "Save layout"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline split editor panel — gutter on the source page image
// ---------------------------------------------------------------------------

const DEFAULT_SPLIT: SplitDraft = {
  axis: "col",
  into: 2,
  gutter: 0.5,
  conf: 0,
};

function SplitEditorPanel({
  row,
  projectId,
  splitDraft,
  busy,
  error,
  onAxis,
  onGutter,
  onApply,
  onKeepAsOne,
  onCancel,
}: {
  row: ZonePageRow;
  projectId: string;
  splitDraft: SplitDraft | null;
  busy: boolean;
  error: unknown;
  onAxis: (axis: SplitDraft["axis"]) => void;
  onGutter: (gutter: number) => void;
  onApply: () => void;
  onKeepAsOne: () => void;
  onCancel: () => void;
}): ReactNode {
  const split = splitDraft ?? row.split ?? DEFAULT_SPLIT;
  const isCol = split.axis === "col";
  const imageUrls = useMemo(
    () => [pageThumbnailUrl(projectId, rowIdx0(row))],
    [projectId, row],
  );
  const childLabels: [string, string] = [`${row.prefix}a`, `${row.prefix}b`];
  return (
    <div
      data-testid="split-editor-panel"
      data-idx={row.idx}
      style={{
        marginTop: 12,
        padding: "16px 18px",
        border: "1px solid var(--ocr)",
        borderRadius: 8,
        background: "color-mix(in oklab, var(--ocr) 5%, var(--bg-surface))",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-1)" }}
        >
          Split page · {row.prefix}
        </span>
        <button
          data-testid="split-editor-cancel"
          onClick={onCancel}
          style={{ ...secondaryButton, padding: "2px 10px", fontSize: 11 }}
        >
          Cancel
        </button>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
        <div style={segmentGroup} role="group" aria-label="Split axis">
          {(
            [
              ["col", "Column"],
              ["row", "Row"],
            ] as const
          ).map(([axis, label]) => (
            <button
              key={axis}
              data-testid={`split-axis-${axis}`}
              aria-pressed={split.axis === axis}
              onClick={() => onAxis(axis)}
              style={segmentButton(split.axis === axis)}
            >
              {label}
            </button>
          ))}
        </div>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            color: "var(--ink-3)",
          }}
        >
          {isCol ? "Gutter X" : "Divider Y"}
          <input
            data-testid="split-gutter-slider"
            type="range"
            min={10}
            max={90}
            step={1}
            value={Math.round(split.gutter * 100)}
            onChange={(e) => onGutter(Number(e.target.value) / 100)}
          />
        </label>
        <span
          data-testid="split-gutter-value"
          style={{
            fontSize: 11.5,
            fontFamily: "var(--mono-font)",
            color: "var(--ink-3)",
          }}
        >
          axis: {split.axis} · gutter: {Math.round(split.gutter * 100)}%
          {row.split
            ? ` · detected at ${Math.round(row.split.conf * 100)}%`
            : " · manual"}
        </span>
      </div>

      <SplitCanvas
        imageUrls={imageUrls}
        split={split}
        childLabels={childLabels}
        onGutter={onGutter}
      />

      <div style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
        Children keep this page&apos;s stage history and re-flow through OCR on
        their own.
      </div>

      <EditorError error={error} />

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          data-testid="split-editor-keep-as-one"
          onClick={onKeepAsOne}
          disabled={busy}
          style={secondaryButton}
        >
          Keep as one
        </button>
        <button
          data-testid="split-editor-apply"
          onClick={onApply}
          disabled={busy}
          style={primaryButton}
        >
          Apply split → 2 pages
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

function ZoneBanner({
  totals,
  isConfirmable,
}: {
  totals: ZoneTotals;
  isConfirmable: boolean;
}): ReactNode {
  const flagged = totals.flagged;
  const tone = flagged > 0 ? "var(--fuzzy)" : "var(--exact)";
  return (
    <div
      data-testid="zone-banner"
      style={{
        padding: "12px 14px",
        borderRadius: 8,
        border: `1px solid color-mix(in oklab, ${tone} 40%, var(--border-1))`,
        background: `color-mix(in oklab, ${tone} 7%, var(--bg-surface))`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 14,
      }}
    >
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-1)" }}>
          {totals.done} pages segmented · {totalsLabel(totals)}
        </div>
        {flagged > 0 ? (
          <div style={{ marginTop: 3, fontSize: 11.5, color: "var(--ink-3)" }}>
            Resolve layout flags here. Confirm when all flags are reviewed.
          </div>
        ) : (
          <div style={{ marginTop: 3, fontSize: 11.5, color: "var(--ink-3)" }}>
            Zones + reading order resolved. Confirm to forward to OCR.
          </div>
        )}
      </div>
      <button
        data-testid="zone-confirm-advance"
        disabled={!isConfirmable}
        style={{
          padding: "6px 16px",
          borderRadius: 6,
          border: "none",
          background: isConfirmable ? "var(--accent)" : "var(--bg-raised)",
          color: isConfirmable ? "var(--accent-ink, #fff)" : "var(--ink-4)",
          cursor: isConfirmable ? "pointer" : "not-allowed",
          fontSize: 12.5,
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        Confirm and advance
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Zone Overview tab — derived stats projection; never stored in machine context
// ---------------------------------------------------------------------------

function ZoneOverviewTab({ totals }: { totals: ZoneTotals | null }): ReactNode {
  const t = totals ?? {
    total: 0,
    done: 0,
    clean: 0,
    flagged: 0,
    reviewed: 0,
    splits: 0,
  };
  const stats: {
    label: string;
    value: string | number;
    tone: string;
    sub?: string;
  }[] = [
    { label: "pages", value: t.total, tone: "var(--ink-1)" },
    {
      label: "segmented",
      value: `${t.done}/${t.total}`,
      tone: t.done < t.total ? "var(--ocr)" : "var(--exact)",
    },
    { label: "clean", value: t.clean, tone: "var(--exact)" },
    {
      label: "flagged",
      value: t.flagged,
      tone: t.flagged > 0 ? "var(--fuzzy)" : "var(--ink-2)",
      sub: t.flagged > 0 ? "needs review" : "all clear",
    },
    { label: "splits", value: t.splits, tone: "var(--ocr)", sub: "pages → 2" },
    {
      label: "reviewed",
      value: t.reviewed,
      tone: "var(--ocr)",
      sub: "of flagged",
    },
  ];

  return (
    <div
      data-testid="zone-overview-tab"
      style={{
        flex: 1,
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      {/* Stats grid — derived from machine context rows/totals */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6, 1fr)",
          gap: 1,
          background: "var(--border-1)",
          border: "1px solid var(--border-1)",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {stats.map((s) => (
          <div
            key={s.label}
            data-testid={`zone-overview-stat-${s.label}`}
            style={{
              background: "var(--bg-surface)",
              padding: "14px 12px 12px",
            }}
          >
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--ink-4)",
              }}
            >
              {s.label}
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 18,
                fontWeight: 600,
                color: s.tone,
                fontFamily: "var(--mono-font, monospace)",
                letterSpacing: "-0.01em",
              }}
            >
              {s.value}
            </div>
            {s.sub ? (
              <div
                style={{
                  marginTop: 2,
                  fontSize: 10.5,
                  fontFamily: "var(--mono-font, monospace)",
                  color: "var(--ink-4)",
                }}
              >
                {s.sub}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {/* Placeholder for zone-type distribution chart (I1: derive from rows[].zones) */}
      <div
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-1)",
          borderRadius: 8,
          padding: "14px 16px",
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--ink-1)",
            marginBottom: 8,
          }}
        >
          Zone-type distribution
        </div>
        <div style={{ fontSize: 12, color: "var(--ink-4)" }}>
          Zone-type breakdown across {t.total} pages (I1: derive from rows)
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Zone StepSettings tab — local settings panel (F5 minimal; wired at I1)
// ---------------------------------------------------------------------------

/**
 * W5.1 — ZoneStepSettingsTab wired to machine context (splitsOn, granularity).
 *
 * Previously used local useState for splitsOn/granularity. Now receives
 * machine-context values and callback props so clicking sends SET_SPLITS_ON /
 * SET_GRANULARITY to the textZonesToolMachine.
 */
function ZoneStepSettingsTab({
  splitsOn,
  granularity,
  onSetSplitsOn,
  onSetGranularity,
}: {
  splitsOn: boolean;
  granularity: "block" | "paragraph" | "line" | "word";
  onSetSplitsOn: (v: boolean) => void;
  onSetGranularity: (v: "block" | "paragraph" | "line" | "word") => void;
}): ReactNode {
  return (
    <div
      data-testid="zone-step-settings-tab"
      style={{
        flex: 1,
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-1)" }}>
          Stage settings · Page layout
        </div>
        <div style={{ marginTop: 3, fontSize: 12, color: "var(--ink-3)" }}>
          The layout model, segmentation granularity, reading order, and
          page-split detection. Changes here re-run detection and stale
          downstream stages. (Full settings panel wired at I1 via stageSettings
          machine pattern.)
        </div>
      </div>

      {/* Offer page splits toggle */}
      <div
        style={{
          background: "color-mix(in oklab, var(--ocr) 4%, var(--bg-surface))",
          border:
            "1px solid color-mix(in oklab, var(--ocr) 30%, var(--border-1))",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ flex: 1 }}>
            <div
              style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-1)" }}
            >
              Offer page splits from layout
            </div>
            <div
              style={{ marginTop: 2, fontSize: 11.5, color: "var(--ink-3)" }}
            >
              When columns or stacked blocks look like two pages, offer a split.
            </div>
          </div>
          <button
            data-testid="zone-settings-splits-toggle"
            onClick={() => onSetSplitsOn(!splitsOn)}
            role="switch"
            aria-checked={splitsOn}
            style={{
              width: 36,
              height: 20,
              borderRadius: 99,
              border: "none",
              background: splitsOn ? "var(--accent)" : "var(--bg-raised)",
              cursor: "pointer",
              position: "relative",
              transition: "background 0.15s",
            }}
          >
            <span
              style={{
                position: "absolute",
                top: 2,
                left: splitsOn ? 18 : 2,
                width: 16,
                height: 16,
                borderRadius: 99,
                background: "#fff",
                boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                transition: "left 0.15s",
              }}
            />
          </button>
        </div>
      </div>

      {/* Segmentation granularity */}
      <div
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-1)",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "200px 1fr",
            gap: 12,
            padding: "14px 16px",
            alignItems: "center",
          }}
        >
          <div>
            <div
              style={{ fontSize: 12.5, fontWeight: 500, color: "var(--ink-1)" }}
            >
              Segmentation granularity
            </div>
            <div
              style={{ marginTop: 2, fontSize: 11.5, color: "var(--ink-3)" }}
            >
              How deep the zone tree goes
            </div>
          </div>
          <div
            style={{
              display: "inline-flex",
              padding: 3,
              gap: 2,
              background: "var(--bg-raised)",
              border: "1px solid var(--border-1)",
              borderRadius: 7,
            }}
          >
            {(["block", "paragraph", "line", "word"] as const).map((opt) => {
              const active = granularity === opt;
              return (
                <button
                  key={opt}
                  data-testid={`zone-settings-granularity-${opt}`}
                  onClick={() => onSetGranularity(opt)}
                  style={{
                    padding: "5px 12px",
                    borderRadius: 5,
                    border: "none",
                    background: active ? "var(--bg-surface)" : "transparent",
                    boxShadow: active ? "0 0 0 1px var(--border-1)" : "none",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: active ? 600 : 500,
                    color: active ? "var(--ink-1)" : "var(--ink-3)",
                  }}
                >
                  {opt.charAt(0).toUpperCase() + opt.slice(1)}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div
        style={{
          padding: "10px 14px",
          borderRadius: 8,
          border: "1px dashed var(--border-2)",
          background: "var(--bg-raised)",
          fontSize: 11.5,
          color: "var(--ink-4)",
        }}
      >
        Full settings panel (low-score threshold, reading order, detection
        toggles, re-run controls) wired at I1 via stageSettings machine.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab bar — shared between TextZonesTool tab modes
// ---------------------------------------------------------------------------

type ZoneTab = "overview" | "pages" | "settings";

function ZoneTabBar({
  active,
  onChange,
}: {
  active: ZoneTab;
  onChange: (tab: ZoneTab) => void;
}): ReactNode {
  return (
    <div
      data-testid="zone-tab-bar"
      style={{
        display: "flex",
        gap: 2,
        padding: "0 16px",
        borderBottom: "1px solid var(--border-1)",
        background: "var(--bg-raised)",
      }}
    >
      {(["overview", "pages", "settings"] as const).map((tab) => {
        const isActive = active === tab;
        const labels: Record<ZoneTab, string> = {
          overview: "Overview",
          pages: "Pages",
          settings: "Settings",
        };
        return (
          <button
            key={tab}
            data-testid={`zone-tab-${tab}`}
            onClick={() => onChange(tab)}
            style={{
              padding: "9px 14px",
              border: "none",
              borderBottom: `2px solid ${isActive ? "var(--accent)" : "transparent"}`,
              background: "transparent",
              cursor: "pointer",
              fontSize: 12.5,
              fontWeight: isActive ? 600 : 500,
              color: isActive ? "var(--ink-1)" : "var(--ink-3)",
            }}
          >
            {labels[tab]}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main TextZonesTool component
// ---------------------------------------------------------------------------

export function TextZonesTool({
  stageId,
  runnerRef: _runnerRef, // wired at I1
  _testServices,
}: ToolSlotProps & { _testServices?: TextZonesToolServices }): ReactNode {
  // Extract projectId from the runner context (at I1; for now use fixture)
  const { projectId = "demo" } = useParams<{ projectId: string }>();

  const services = useMemo(
    () => _testServices ?? buildRealTextZonesToolServices(),
    [_testServices],
  );

  const [snapshot, send] = useActor(textZonesToolMachine, {
    input: { projectId, stageIndex: 9, services },
  });
  const {
    rows,
    totals,
    filter,
    density,
    editing,
    editorKind,
    splitDraft,
    splitsOn,
    granularity,
    zoneDraft,
    tool,
    error,
  } = snapshot.context;

  // Tab state — local per F5.3-2 convention (view-only, not guarded by machine)
  const [activeTab, setActiveTab] = useState<ZoneTab>("pages");

  const isLoading = snapshot.matches("loading");
  const isLoadError = snapshot.matches("loadError");
  const isReviewing = snapshot.matches("reviewing");
  const isConfirming = snapshot.matches("confirming");
  const isSettled = snapshot.matches("settled");

  const isConfirmable =
    totals !== null &&
    (totals.flagged === 0 || totals.flagged <= totals.reviewed);

  // Filter rows by current filter
  const filteredRows = rows.filter((r) => {
    if (filter === "flagged") return r.state === "flagged";
    if (filter === "splits") return (r.flags ?? []).includes("splitSuggested");
    if (filter === "clean") return r.state === "clean";
    if (filter === "reviewed") return r.state === "reviewed";
    return true;
  });

  const editingRow = editing ? rows.find((r) => r.idx === editing) : null;

  if (isLoading) {
    return (
      <div
        data-testid="zone-tool-loading"
        data-stage-id={stageId}
        style={{
          flex: 1,
          display: "grid",
          placeItems: "center",
          color: "var(--ink-3)",
          fontSize: 13,
        }}
      >
        Loading zone data…
      </div>
    );
  }

  if (isLoadError) {
    return (
      <div
        data-testid="zone-tool-error"
        data-stage-id={stageId}
        style={{
          flex: 1,
          display: "grid",
          placeItems: "center",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ color: "var(--mismatch)", fontSize: 13 }}>
          Failed to load zone data.
        </div>
        <button
          data-testid="zone-tool-retry"
          onClick={() => send({ type: "RETRY" })}
          style={{
            padding: "4px 14px",
            borderRadius: 5,
            border: "1px solid var(--border-2)",
            background: "var(--bg-surface)",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (isConfirming) {
    return (
      <div
        data-testid="zone-tool-confirming"
        data-stage-id={stageId}
        style={{
          flex: 1,
          display: "grid",
          placeItems: "center",
          color: "var(--ink-3)",
          fontSize: 13,
        }}
      >
        Confirming stage…
      </div>
    );
  }

  if (isSettled) {
    return (
      <div
        data-testid="zone-tool-settled"
        data-stage-id={stageId}
        style={{
          flex: 1,
          display: "grid",
          placeItems: "center",
          color: "var(--exact)",
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        Text zones confirmed. Waiting for downstream stages.
      </div>
    );
  }

  return (
    <div
      data-testid="text-zones-tool"
      data-stage-id={stageId}
      style={{
        flex: 1,
        minHeight: 480,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Tab bar */}
      <ZoneTabBar active={activeTab} onChange={setActiveTab} />

      {/* Overview tab */}
      {activeTab === "overview" ? <ZoneOverviewTab totals={totals} /> : null}

      {/* Settings tab */}
      {activeTab === "settings" ? (
        <ZoneStepSettingsTab
          splitsOn={splitsOn}
          granularity={granularity}
          onSetSplitsOn={(v) => send({ type: "SET_SPLITS_ON", value: v })}
          onSetGranularity={(v) => send({ type: "SET_GRANULARITY", value: v })}
        />
      ) : null}

      {/* Pages tab */}
      {activeTab === "pages" ? (
        <div
          data-testid="zone-pages-tab"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: "12px 16px",
          }}
        >
          {/* Banner + confirm */}
          {totals && isReviewing ? (
            <ZoneBanner totals={totals} isConfirmable={isConfirmable} />
          ) : null}

          {/* Toolbar */}
          {isReviewing ? (
            <div
              data-testid="zone-toolbar"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              {/* Filter chips */}
              <div
                style={{
                  display: "flex",
                  gap: 3,
                  padding: 3,
                  background: "var(--bg-raised)",
                  borderRadius: 7,
                  border: "1px solid var(--border-1)",
                }}
              >
                {(
                  [
                    { id: "all", label: "All", count: totals?.total },
                    { id: "flagged", label: "Flagged", count: totals?.flagged },
                    { id: "splits", label: "Splits", count: totals?.splits },
                    { id: "clean", label: "Clean", count: totals?.clean },
                    {
                      id: "reviewed",
                      label: "Reviewed",
                      count: totals?.reviewed,
                    },
                  ] as const
                ).map((chip) => (
                  <button
                    key={chip.id}
                    data-testid={`zone-filter-${chip.id}`}
                    onClick={() => send({ type: "SET_FILTER", value: chip.id })}
                    style={{
                      padding: "4px 9px",
                      borderRadius: 5,
                      border: "none",
                      background:
                        filter === chip.id
                          ? "var(--bg-surface)"
                          : "transparent",
                      boxShadow:
                        filter === chip.id
                          ? "0 0 0 1px var(--border-1)"
                          : "none",
                      cursor: "pointer",
                      fontSize: 11.5,
                      fontWeight: filter === chip.id ? 600 : 500,
                      color:
                        filter === chip.id ? "var(--ink-1)" : "var(--ink-3)",
                    }}
                  >
                    {chip.label}{" "}
                    <span
                      style={{
                        fontFamily: "var(--mono-font)",
                        fontSize: 10,
                        color: "var(--ink-4)",
                      }}
                    >
                      {chip.count}
                    </span>
                  </button>
                ))}
              </div>

              <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                {/* Density toggle */}
                <div
                  style={{
                    display: "inline-flex",
                    padding: 2,
                    background: "var(--bg-raised)",
                    border: "1px solid var(--border-1)",
                    borderRadius: 6,
                  }}
                >
                  {(["S", "M", "L"] as const).map((d) => (
                    <button
                      key={d}
                      data-testid={`zone-density-${d}`}
                      onClick={() => send({ type: "SET_DENSITY", value: d })}
                      style={{
                        padding: "2px 8px",
                        borderRadius: 4,
                        border: "none",
                        background:
                          density === d ? "var(--bg-surface)" : "transparent",
                        cursor: "pointer",
                        fontSize: 11,
                        fontFamily: "var(--mono-font)",
                        fontWeight: density === d ? 600 : 500,
                        color: density === d ? "var(--ink-1)" : "var(--ink-3)",
                      }}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {/* Page grid */}
          {isReviewing ? (
            <div
              data-testid="zone-page-grid"
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${density === "S" ? 9 : density === "L" ? 4 : 6}, 1fr)`,
                gap: 6,
                padding: 10,
                borderRadius: 8,
                background: "var(--bg-surface)",
                border: "1px solid var(--border-1)",
              }}
            >
              {filteredRows.map((row) => (
                <ZonePageCard
                  key={row.idx}
                  row={row}
                  projectId={projectId}
                  isEditing={editing === row.idx}
                  onClick={() => {
                    if (editing === row.idx) return;
                    if (row.flags?.includes("splitSuggested")) {
                      send({ type: "OPEN_SPLIT_EDITOR", idx: row.idx });
                    } else {
                      send({ type: "OPEN_ZONE_EDITOR", idx: row.idx });
                    }
                  }}
                />
              ))}
            </div>
          ) : null}

          {/* Inline editors — exclusive */}
          {editingRow && editorKind === "zones" ? (
            <ZoneEditorPanel
              key={editingRow.idx}
              row={editingRow}
              projectId={projectId}
              zones={zoneDraft ?? []}
              tool={tool}
              busy={
                snapshot.matches({ reviewing: "savingLayout" }) ||
                snapshot.matches({ reviewing: "redetecting" })
              }
              error={error}
              onSetTool={(t) => send({ type: "SET_TOOL", tool: t })}
              onDraw={(box, zoneType) =>
                send({ type: "DRAW_ZONE", box, zoneType })
              }
              onRetype={(zoneId, zoneType) =>
                send({ type: "RETYPE_ZONE", zoneId, zoneType })
              }
              onDelete={(zoneId) => send({ type: "DELETE_ZONE", zoneId })}
              onSave={() => send({ type: "SAVE_LAYOUT" })}
              onCancel={() => send({ type: "CANCEL" })}
              onRedetect={() => send({ type: "REDETECT" })}
              onSplit={() =>
                send({ type: "OPEN_SPLIT_EDITOR", idx: editingRow.idx })
              }
            />
          ) : editingRow && editorKind === "split" ? (
            <SplitEditorPanel
              key={editingRow.idx}
              row={editingRow}
              projectId={projectId}
              splitDraft={splitDraft}
              busy={
                snapshot.matches({ reviewing: "applyingSplit" }) ||
                snapshot.matches({ reviewing: "dismissingSplit" })
              }
              error={error}
              onAxis={(axis) => send({ type: "SET_AXIS", patch: { axis } })}
              onGutter={(gutter) =>
                send({ type: "DRAG_GUTTER", patch: { gutter } })
              }
              onApply={() => send({ type: "APPLY_SPLIT" })}
              onKeepAsOne={() => send({ type: "KEEP_AS_ONE" })}
              onCancel={() => send({ type: "CANCEL" })}
            />
          ) : null}

          {/* Confirm gate (shown while applying split) */}
          {snapshot.matches({ reviewing: "applyingSplit" }) ? (
            <div
              data-testid="zone-applying-split"
              style={{
                padding: "8px 14px",
                borderRadius: 6,
                background:
                  "color-mix(in oklab, var(--ocr) 10%, var(--bg-surface))",
                border:
                  "1px solid color-mix(in oklab, var(--ocr) 35%, var(--border-1))",
                fontSize: 12,
                color: "var(--ocr)",
              }}
            >
              Applying split…
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
