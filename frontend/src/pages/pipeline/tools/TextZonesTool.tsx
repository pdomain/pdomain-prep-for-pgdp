/**
 * TextZonesTool.tsx — React surface for the Text Zones stage tool.
 *
 * Registered in TOOL_REGISTRY as `text_zones`. Renders:
 * - Zone page grid with filter / density controls
 * - Inline zone editor (draw / re-type / delete zones, reading order)
 * - Inline split editor (axis / gutter / APPLY_SPLIT with NARROW STALE invariant)
 * - Summary banner (totals, CONFIRM_ADVANCE gate)
 *
 * At F5: mock-only wiring. The machine is driven with the mock server's
 * fetchZonePages / applySplit / redetectLayout / persistLayout / confirmStage.
 *
 * At I1: replace the mock services with real API calls.
 *
 * @see src/machines/tools/textZonesTool.ts — machine + types
 * @see docs/plans/design_handoff_pgdp_app/final/text_zones/ — design canvas
 */

import type { ReactNode } from "react";
import { useActor } from "@xstate/react";
import { useMemo } from "react";
import type { ToolSlotProps } from "../toolSlot";
import {
  textZonesToolMachine,
  type ZonePageRow,
  type ZoneTotals,
  type Zone,
  type SplitDraft,
  type TextZonesToolServices,
} from "@/machines/tools/textZonesTool";

// ---------------------------------------------------------------------------
// Mock services (F5 — replaced at I1)
// ---------------------------------------------------------------------------

/**
 * F5 mock services for textZonesTool.
 * Realistic shapes; no real I/O.
 */
function createMockTextZonesServices(projectId: string): TextZonesToolServices {
  return {
    async fetchZonePages(_pid) {
      // Deterministic fixture: 3 pages
      const rows: ZonePageRow[] = [
        {
          idx: "0001",
          prefix: "p0001",
          state: "flagged",
          flags: ["splitSuggested"],
          zones: 4,
          lines: 42,
          words: 310,
          pageNumber: 1,
          layoutKind: "double",
          split: { axis: "col", into: 2, gutter: 0.49, conf: 0.92 },
        },
        {
          idx: "0002",
          prefix: "p0002",
          state: "clean",
          zones: 3,
          lines: 38,
          words: 285,
          pageNumber: 2,
          layoutKind: "single",
        },
        {
          idx: "0003",
          prefix: "p0003",
          state: "flagged",
          flags: ["mergedBlocks"],
          zones: 5,
          lines: 44,
          words: 330,
          pageNumber: 3,
          layoutKind: "single",
        },
      ];
      const totals: ZoneTotals = {
        total: 3,
        done: 3,
        clean: 1,
        flagged: 2,
        reviewed: 0,
        splits: 1,
      };
      void projectId;
      return { rows, totals };
    },

    async applySplit(pid, pageId, draft) {
      void pid;
      void draft;
      const parentRow: ZonePageRow = {
        idx: pageId,
        prefix: `p${pageId}`,
        state: "split",
        layoutKind: "double",
      };
      const childRows: [ZonePageRow, ZonePageRow] = [
        {
          idx: `${pageId}-a`,
          prefix: `p${pageId}a`,
          state: "clean",
          zones: 3,
          lines: 22,
          words: 160,
          layoutKind: "single",
        },
        {
          idx: `${pageId}-b`,
          prefix: `p${pageId}b`,
          state: "clean",
          zones: 2,
          lines: 20,
          words: 150,
          layoutKind: "single",
        },
      ];
      return { parentRow, childRows };
    },

    async redetectLayout(pid, pageId, _current) {
      void pid;
      void pageId;
      // Return a minimal zone set
      const zones: Zone[] = [
        { id: "z1", type: "body", x: 0.1, y: 0.1, w: 0.8, h: 0.7, order: 1 },
        {
          id: "z2",
          type: "footer",
          x: 0.1,
          y: 0.85,
          w: 0.8,
          h: 0.08,
          order: null,
        },
      ];
      return { zones };
    },

    async persistLayout(pid, pageId, _data) {
      void pid;
      void pageId;
      return { ok: true };
    },

    async confirmStage(pid) {
      void pid;
      return { ok: true };
    },
  };
}

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
// Zone card thumbnail (schematic — no real image at F5)
// ---------------------------------------------------------------------------

function ZoneCardThumb({ row }: { row: ZonePageRow }): ReactNode {
  const isRunning = row.state === "running";
  const hasSplit = row.flags?.includes("splitSuggested") && !isRunning;
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
          {/* Schematic zone blocks */}
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
  isEditing,
  onClick,
}: {
  row: ZonePageRow;
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
      <ZoneCardThumb row={row} />
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
// Inline zone editor panel
// ---------------------------------------------------------------------------

function ZoneEditorPanel({
  row,
  onSave,
  onCancel,
}: {
  row: ZonePageRow;
  onSave: () => void;
  onCancel: () => void;
}): ReactNode {
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
        }}
      >
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: "var(--ink-1)",
          }}
        >
          Zone editor · {row.prefix}
        </span>
        <button
          data-testid="zone-editor-cancel"
          onClick={onCancel}
          style={{
            padding: "2px 10px",
            borderRadius: 5,
            border: "1px solid var(--border-2)",
            background: "var(--bg-surface)",
            cursor: "pointer",
            fontSize: 11,
            color: "var(--ink-3)",
          }}
        >
          Cancel
        </button>
      </div>

      {/* Schematic page + zones area */}
      <div
        data-testid="zone-canvas-area"
        style={{
          height: 240,
          background: "var(--bg-sunk)",
          border: "1px solid var(--border-1)",
          borderRadius: 6,
          display: "grid",
          placeItems: "center",
          color: "var(--ink-4)",
          fontSize: 12,
        }}
      >
        Page canvas with zone overlays (I1: Konva)
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          data-testid="zone-editor-redetect"
          style={{
            padding: "4px 12px",
            borderRadius: 5,
            border: "1px solid var(--border-2)",
            background: "var(--bg-surface)",
            cursor: "pointer",
            fontSize: 12,
            color: "var(--ink-2)",
          }}
        >
          Re-detect
        </button>
        <button
          data-testid="zone-editor-save"
          onClick={onSave}
          style={{
            padding: "4px 12px",
            borderRadius: 5,
            border: "none",
            background: "var(--accent)",
            color: "var(--accent-ink, #fff)",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Save layout
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline split editor panel
// ---------------------------------------------------------------------------

function SplitEditorPanel({
  row,
  splitDraft,
  onApply,
  onKeepAsOne,
  onCancel,
}: {
  row: ZonePageRow;
  splitDraft: SplitDraft | null;
  onApply: () => void;
  onKeepAsOne: () => void;
  onCancel: () => void;
}): ReactNode {
  const split = splitDraft ?? row.split;
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
          Split editor · {row.prefix}
        </span>
        <button
          data-testid="split-editor-cancel"
          onClick={onCancel}
          style={{
            padding: "2px 10px",
            borderRadius: 5,
            border: "1px solid var(--border-2)",
            background: "var(--bg-surface)",
            cursor: "pointer",
            fontSize: 11,
            color: "var(--ink-3)",
          }}
        >
          Cancel
        </button>
      </div>

      {split ? (
        <div
          style={{
            fontSize: 11.5,
            fontFamily: "var(--mono-font)",
            color: "var(--ink-3)",
          }}
        >
          axis: {split.axis} · gutter: {Math.round(split.gutter * 100)}% · conf:{" "}
          {Math.round(split.conf * 100)}%
        </div>
      ) : null}

      {/* Schematic split preview */}
      <div
        data-testid="split-preview-canvas"
        style={{
          height: 200,
          background: "var(--bg-sunk)",
          border: "1px solid var(--border-1)",
          borderRadius: 6,
          display: "grid",
          placeItems: "center",
          color: "var(--ink-4)",
          fontSize: 12,
          position: "relative",
        }}
      >
        Split preview (I1: Konva)
        {split ? (
          <span
            data-testid="split-gutter-indicator"
            style={{
              position: "absolute",
              top: split.axis === "col" ? "10%" : `${split.gutter * 100}%`,
              left: split.axis === "col" ? `${split.gutter * 100}%` : "10%",
              width: split.axis === "col" ? 2 : "80%",
              height: split.axis === "row" ? 2 : "80%",
              background: "var(--ocr)",
              transform:
                split.axis === "col" ? "translateX(-50%)" : "translateY(-50%)",
            }}
          />
        ) : null}
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          data-testid="split-editor-keep-as-one"
          onClick={onKeepAsOne}
          style={{
            padding: "4px 12px",
            borderRadius: 5,
            border: "1px solid var(--border-2)",
            background: "var(--bg-surface)",
            cursor: "pointer",
            fontSize: 12,
            color: "var(--ink-2)",
          }}
        >
          Keep as one
        </button>
        <button
          data-testid="split-editor-apply"
          onClick={onApply}
          style={{
            padding: "4px 12px",
            borderRadius: 5,
            border: "none",
            background: "var(--accent)",
            color: "var(--accent-ink, #fff)",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Apply split
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
// Main TextZonesTool component
// ---------------------------------------------------------------------------

export function TextZonesTool({
  stageId,
  runnerRef,
}: ToolSlotProps): ReactNode {
  void runnerRef; // wired at I1

  // Extract projectId from the runner context (at I1; for now use fixture)
  const projectId = "mock-project";

  const services = useMemo(
    () => createMockTextZonesServices(projectId),
    [projectId],
  );

  const [snapshot, send] = useActor(textZonesToolMachine, {
    input: { projectId, stageIndex: 9, services },
  });
  const { rows, totals, filter, density, editing, editorKind, splitDraft } =
    snapshot.context;

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
                { id: "reviewed", label: "Reviewed", count: totals?.reviewed },
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
                    filter === chip.id ? "var(--bg-surface)" : "transparent",
                  boxShadow:
                    filter === chip.id ? "0 0 0 1px var(--border-1)" : "none",
                  cursor: "pointer",
                  fontSize: 11.5,
                  fontWeight: filter === chip.id ? 600 : 500,
                  color: filter === chip.id ? "var(--ink-1)" : "var(--ink-3)",
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
          row={editingRow}
          onSave={() => send({ type: "SAVE_LAYOUT" })}
          onCancel={() => send({ type: "CANCEL" })}
        />
      ) : editingRow && editorKind === "split" ? (
        <SplitEditorPanel
          row={editingRow}
          splitDraft={splitDraft}
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
  );
}
