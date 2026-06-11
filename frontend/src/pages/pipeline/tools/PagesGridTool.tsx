/**
 * PagesGridTool — React surface for the Crop stage (and any pages-grid stage).
 *
 * Drives `pagesGridMachine`. Layout:
 *   ┌──────────────────────────────────────────────────┐
 *   │  Filter bar  ·  flag legend                      │
 *   │  ─────────────────────────────────────────────   │
 *   │  Page grid (CroppedThumb + flag chips)           │
 *   │    ├── inline bbox editor (exclusive)            │
 *   │        ├── crop handles / bbox inputs            │
 *   │        └── Accept / Save / Discard actions       │
 *   └──────────────────────────────────────────────────┘
 *
 * Props: ToolSlotProps { stageId, runnerRef }
 *
 * @see src/machines/tools/pagesGrid.ts
 * @see docs/plans/design_handoff_pgdp_app/final/crop/crop.jsx
 * @see src/pages/pipeline/toolSlot.tsx
 */

import { useMemo } from "react";
import { useActor } from "@xstate/react";
import { useParams } from "react-router-dom";
import {
  pagesGridMachine,
  type PagesGridServices,
  type CropPageRow,
} from "@/machines/tools/pagesGrid";
import type { ToolSlotProps } from "../toolSlot";
import { Button } from "@/components/ui/Button";
import { buildRealPagesGridServices } from "@/services/tools/pagesGrid";

// ---------------------------------------------------------------------------
// Crop flag taxonomy (crop stage)
// ---------------------------------------------------------------------------

const CROP_FLAGS: Record<string, { label: string; tone: string }> = {
  overCrop: { label: "Over-crop", tone: "var(--mismatch)" },
  underCrop: { label: "Under-crop", tone: "var(--ocr)" },
  finger: { label: "Finger", tone: "var(--fuzzy)" },
  skewed: { label: "Skewed", tone: "var(--ink-3)" },
  blurry: { label: "Blurry", tone: "var(--fuzzy)" },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Flag chip for the page grid */
function CropFlagChip({ flag }: { flag: string }) {
  const def = CROP_FLAGS[flag];
  const tone = def?.tone ?? "var(--fuzzy)";
  const label = def?.label ?? flag;
  return (
    <span
      data-testid={`crop-flag-chip-${flag}`}
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

/** CroppedThumb — thumbnail with a dashed bbox overlay */
function CroppedThumb({
  row,
  isOpen,
  onClick,
}: {
  row: CropPageRow;
  isOpen: boolean;
  onClick: () => void;
}) {
  const isFlagged = row.flags.length > 0;
  const bbox = row.bbox ?? [0.08, 0.07, 0.92, 0.93];
  const domFlag = row.flags[0] ?? null;
  const bboxTone =
    domFlag && CROP_FLAGS[domFlag] ? CROP_FLAGS[domFlag].tone : "var(--accent)";

  // bbox is [l, t, r, b] fractions
  const [bl, bt, br, bb] = bbox;
  const top = bt * 100;
  const right = (1 - br) * 100;
  const bottom = (1 - bb) * 100;
  const left = bl * 100;

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`cropped-thumb-${row.pageId}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        width: 80,
        height: 108,
        position: "relative",
        background: "oklch(0.18 0.012 60)",
        border: `1.5px solid ${isOpen ? "var(--accent)" : isFlagged ? bboxTone : "var(--border-2)"}`,
        borderRadius: 3,
        overflow: "hidden",
        cursor: "pointer",
        outline: isOpen ? "2px solid var(--accent)" : "none",
        outlineOffset: 2,
      }}
    >
      {/* Scanner shadow */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at center, oklch(0.32 0.015 60) 35%, oklch(0.14 0.012 60) 100%)",
        }}
      />
      {/* Left/right scanner shadows */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(90deg, oklch(0.08 0.01 60) 0%, transparent 6%, transparent 94%, oklch(0.08 0.01 60) 100%)",
        }}
      />

      {/* Cropped page */}
      <div
        style={{
          position: "absolute",
          top: `${top}%`,
          right: `${right}%`,
          bottom: `${bottom}%`,
          left: `${left}%`,
          background: "oklch(0.94 0.012 85)",
          borderRadius: 1,
          boxShadow:
            "0 0 0 1px rgba(40,30,20,0.15), 0 1px 4px rgba(0,0,0,0.45)",
          overflow: "hidden",
          transform: row.skewDeg ? `rotate(${row.skewDeg}deg)` : undefined,
          transformOrigin: "center",
        }}
      >
        {/* Ink lines */}
        <div
          style={{
            position: "absolute",
            inset: "12% 14% 14% 14%",
            backgroundImage: `repeating-linear-gradient(to bottom, oklch(0.34 0.02 60) 0 1.2px, transparent 1.2px 6px)`,
            opacity: 0.65,
          }}
        />
      </div>

      {/* Finger artifact */}
      {row.flags.includes("finger") && (
        <div
          style={{
            position: "absolute",
            top: "34%",
            bottom: "34%",
            right: "-2%",
            width: "14%",
            background:
              "radial-gradient(ellipse at left center, oklch(0.55 0.07 40) 0%, transparent 75%)",
            opacity: 0.65,
          }}
        />
      )}

      {/* Bbox dashed overlay */}
      <div
        style={{
          position: "absolute",
          top: `${top}%`,
          right: `${right}%`,
          bottom: `${bottom}%`,
          left: `${left}%`,
          border: `1.5px dashed ${bboxTone}`,
          boxShadow: `0 0 0 1px color-mix(in oklab, ${bboxTone} 35%, transparent)`,
          pointerEvents: "none",
        }}
      />

      {/* Page number */}
      <span
        style={{
          position: "absolute",
          bottom: 3,
          left: "50%",
          transform: "translateX(-50%)",
          fontFamily: "monospace",
          fontSize: 8,
          color: "oklch(0.7 0 0)",
        }}
      >
        {row.n}
      </span>
    </div>
  );
}

/** Bbox editor — numeric inputs for fine bbox control */
function BboxEditor({
  row,
  draft,
  onEdit,
  onAccept,
  onSave,
  onDiscard,
}: {
  row: CropPageRow;
  draft: CropPageRow | null;
  onEdit: (patch: Partial<CropPageRow>) => void;
  onAccept: () => void;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const current = draft ?? row;
  const [bl, bt, br, bb] = current.bbox ?? [0.08, 0.07, 0.92, 0.93];

  const updateBbox = (idx: number, val: number) => {
    const next: [number, number, number, number] = [bl, bt, br, bb];
    next[idx] = val;
    onEdit({ bbox: next });
  };

  const isDirty = draft !== null;

  return (
    <div
      data-testid={`bbox-editor-${row.pageId}`}
      style={{
        marginTop: 8,
        padding: "12px 14px",
        background: "var(--bg-surface)",
        border: "1.5px solid var(--accent)",
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {/* Header */}
      <div
        style={{
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
            Page {row.n}
          </span>
          {row.flags.map((f) => (
            <CropFlagChip key={f} flag={f} />
          ))}
        </div>
        <button
          data-testid="bbox-editor-close-btn"
          onClick={onDiscard}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            fontSize: 16,
            color: "var(--ink-3)",
          }}
        >
          ×
        </button>
      </div>

      {/* Bbox controls */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {[
          { label: "Left (L)", idx: 0, val: bl },
          { label: "Top (T)", idx: 1, val: bt },
          { label: "Right (R)", idx: 2, val: br },
          { label: "Bottom (B)", idx: 3, val: bb },
        ].map(({ label, idx, val }) => (
          <div
            key={idx}
            style={{ display: "flex", flexDirection: "column", gap: 3 }}
          >
            <label style={{ fontSize: 10.5, color: "var(--ink-3)" }}>
              {label}
            </label>
            <input
              type="number"
              data-testid={`bbox-input-${idx}`}
              min={0}
              max={1}
              step={0.01}
              value={val.toFixed(3)}
              onChange={(e) => updateBbox(idx, parseFloat(e.target.value))}
              style={{
                padding: "4px 8px",
                borderRadius: 4,
                border: "1px solid var(--border-2)",
                background: "var(--bg-raised)",
                color: "var(--ink-1)",
                fontSize: 12,
                fontFamily: "monospace",
                width: "100%",
              }}
            />
          </div>
        ))}
      </div>

      {/* Skew */}
      {row.skewDeg != null && (
        <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
          Detected skew:{" "}
          <span style={{ fontFamily: "monospace", fontWeight: 600 }}>
            {row.skewDeg.toFixed(2)}°
          </span>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
        <Button variant="ghost" size="sm" onClick={onDiscard}>
          Discard
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onAccept}
          data-testid="accept-btn"
        >
          Accept as-is
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onSave}
          disabled={!isDirty}
          data-testid="save-btn"
        >
          Save
        </Button>
      </div>
    </div>
  );
}

/** Filter bar */
function CropFilterBar({
  filter,
  onSetFilter,
}: {
  filter: string;
  onSetFilter: (v: string) => void;
}) {
  const chips = [
    { id: "all", label: "All" },
    { id: "flagged", label: "Flagged" },
    ...Object.entries(CROP_FLAGS).map(([id, def]) => ({
      id,
      label: def.label,
    })),
  ];

  return (
    <div
      data-testid="crop-filter-bar"
      style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
    >
      {chips.map((chip) => {
        const active = filter === chip.id;
        return (
          <button
            key={chip.id}
            data-testid={`crop-filter-${chip.id}`}
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

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * PagesGridTool — tool slot surface for the Crop stage.
 *
 * @see docs/plans/design_handoff_pgdp_app/final/crop/crop.jsx
 * @see src/pages/pipeline/toolSlot.tsx — F5 contract
 */
export function PagesGridTool({
  stageId,
  runnerRef: _runnerRef,
  _testServices,
}: ToolSlotProps & { _testServices?: PagesGridServices }) {
  const { projectId = "mock-project" } = useParams();

  const services = useMemo(
    () => _testServices ?? buildRealPagesGridServices(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId],
  );

  const [snapshot, send] = useActor(pagesGridMachine, {
    input: {
      projectId,
      stageId,
      stageIndex: 0,
      services,
    },
  });

  const ctx = snapshot.context;

  const topState = (() => {
    if (snapshot.matches("loading")) return "loading";
    if (snapshot.matches("ready")) return "ready";
    if (snapshot.matches("loadError")) return "loadError";
    return "unknown";
  })();

  const editingPage = ctx.selectedPageId
    ? (ctx.pages.find((p) => p.pageId === ctx.selectedPageId) ?? null)
    : null;

  const isEditorOpen =
    snapshot.matches({ ready: { editor: "editing" } }) ||
    snapshot.matches({ ready: { editor: "saving" } }) ||
    snapshot.matches({ ready: { editor: "confirmDiscard" } });

  if (topState === "loadError") {
    return (
      <div
        data-testid="pages-grid-tool-error"
        style={{ padding: 24, textAlign: "center", color: "var(--mismatch)" }}
      >
        <div style={{ marginBottom: 12 }}>Failed to load pages.</div>
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

  if (topState === "loading") {
    return (
      <div
        data-testid="pages-grid-tool-loading"
        style={{
          padding: 24,
          textAlign: "center",
          color: "var(--ink-3)",
          fontSize: 13,
        }}
      >
        Loading pages…
      </div>
    );
  }

  const flaggedCount = ctx.pages.filter((p) => p.flags.length > 0).length;
  const resolvedCount = ctx.resolvedThisSession.length;

  return (
    <div
      data-testid="pages-grid-tool"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 16,
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* Progress banner */}
      <div
        data-testid="pages-grid-banner"
        style={{
          padding: "8px 14px",
          background:
            flaggedCount === 0
              ? "color-mix(in oklab, var(--exact) 8%, var(--bg-surface))"
              : "color-mix(in oklab, var(--fuzzy) 8%, var(--bg-surface))",
          border: `1px solid ${
            flaggedCount === 0
              ? "color-mix(in oklab, var(--exact) 30%, var(--border-1))"
              : "color-mix(in oklab, var(--fuzzy) 30%, var(--border-1))"
          }`,
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-1)" }}>
          Crop · {ctx.pages.length} pages · {flaggedCount} flagged
        </span>
        {resolvedCount > 0 && (
          <span style={{ fontSize: 11.5, color: "var(--exact)" }}>
            {resolvedCount} resolved this session
          </span>
        )}
      </div>

      {/* Toolbar */}
      <div
        data-testid="crop-toolbar"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <CropFilterBar
          filter={ctx.filter}
          onSetFilter={(v) => send({ type: "SET_FILTER", value: v })}
        />
        <div style={{ flex: 1 }} />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => send({ type: "FLUSH_RESOLVED" })}
          data-testid="flush-resolved-btn"
        >
          Flush resolved
        </Button>
      </div>

      {/* Inline error (save error stays in editing) */}
      {ctx.error && topState === "ready" && (
        <div
          data-testid="crop-inline-error"
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
        data-testid="crop-page-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))",
          gap: 12,
          padding: 14,
          background: "var(--bg-surface)",
          border: "1px solid var(--border-1)",
          borderRadius: 8,
          flex: 1,
          minHeight: 200,
          overflowY: "auto",
        }}
      >
        {ctx.visible.map((row) => {
          const isOpen = isEditorOpen && ctx.selectedPageId === row.pageId;
          return (
            <div
              key={row.pageId}
              data-testid={`crop-page-cell-${row.pageId}`}
              style={{ display: "flex", flexDirection: "column", gap: 6 }}
            >
              <CroppedThumb
                row={row}
                isOpen={isOpen}
                onClick={() =>
                  send({ type: "OPEN_EDITOR", pageId: row.pageId })
                }
              />
              {/* Flag chips */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: 9,
                    color: "var(--ink-4)",
                  }}
                >
                  p{row.n}
                </span>
                {row.flags.map((f) => (
                  <CropFlagChip key={f} flag={f} />
                ))}
              </div>

              {/* Inline bbox editor */}
              {isOpen && editingPage && (
                <BboxEditor
                  row={editingPage}
                  draft={ctx.draft}
                  onEdit={(patch) => send({ type: "EDIT", patch })}
                  onAccept={() => send({ type: "ACCEPT" })}
                  onSave={() => send({ type: "SAVE" })}
                  onDiscard={() => send({ type: "CLOSE" })}
                />
              )}

              {/* Saving spinner */}
              {snapshot.matches({ ready: { editor: "saving" } }) &&
                ctx.selectedPageId === row.pageId && (
                  <div
                    data-testid={`saving-${row.pageId}`}
                    style={{
                      padding: 8,
                      textAlign: "center",
                      fontSize: 11,
                      color: "var(--ocr)",
                    }}
                  >
                    Saving…
                  </div>
                )}

              {/* Confirm-discard prompt */}
              {snapshot.matches({ ready: { editor: "confirmDiscard" } }) &&
                ctx.selectedPageId === row.pageId && (
                  <div
                    data-testid={`confirm-discard-${row.pageId}`}
                    style={{
                      padding: "8px 10px",
                      background:
                        "color-mix(in oklab, var(--fuzzy) 10%, var(--bg-surface))",
                      border:
                        "1px solid color-mix(in oklab, var(--fuzzy) 35%, var(--border-1))",
                      borderRadius: 6,
                      fontSize: 11,
                      color: "var(--fuzzy)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <span>Discard changes?</span>
                    <div style={{ display: "flex", gap: 4 }}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => send({ type: "KEEP" })}
                        data-testid={`confirm-discard-keep-${row.pageId}`}
                      >
                        Keep
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => send({ type: "DISCARD" })}
                        data-testid={`confirm-discard-ok-${row.pageId}`}
                      >
                        Discard
                      </Button>
                    </div>
                  </div>
                )}
            </div>
          );
        })}

        {ctx.visible.length === 0 && (
          <div
            style={{
              gridColumn: "1 / -1",
              padding: 24,
              textAlign: "center",
              color: "var(--ink-4)",
              fontSize: 12,
            }}
          >
            No pages match the current filter.
          </div>
        )}
      </div>
    </div>
  );
}
