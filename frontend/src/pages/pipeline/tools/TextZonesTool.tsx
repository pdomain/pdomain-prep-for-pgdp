/**
 * TextZonesTool.tsx — React surface for the Text Zones stage tool.
 *
 * Registered in TOOL_REGISTRY as `text_zones`. Renders three tabs:
 * - **Overview** — stats projection from machine context (derived, never stored)
 * - **Pages**    — zone page grid, inline zone/split editors, confirm gate
 * - **Settings** — stage settings panel (minimal at F5; follows F5.1 pattern)
 *
 * At F5: mock-only wiring. The machine is driven with the mock server's
 * fetchZonePages / applySplit / redetectLayout / persistLayout / confirmStage.
 * Settings tab uses local state + no-op handlers (wired at I1).
 *
 * At I1: replace the mock services with real API calls; wire settings
 * to stageSettings machine pattern from F5.1 stageSettings.ts.
 *
 * @see src/machines/tools/textZonesTool.ts — machine + types
 * @see docs/plans/design_handoff_pgdp_app/final/text_zones/ — design canvas
 */

import type { ReactNode } from "react";
import { useActor } from "@xstate/react";
import { useMemo, useState } from "react";
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
  onRedetect,
}: {
  row: ZonePageRow;
  onSave: () => void;
  onCancel: () => void;
  onRedetect: () => void;
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
          onClick={onRedetect}
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
 * F5-3-5 — ZoneStepSettings uses local state only (no stageSettings machine).
 *
 * stageSettings.ts exists in the f51-source worktree (F5.1) but NOT in this
 * worktree at F5.3 time. Per task instructions, we use a local minimal panel
 * driven by local state + no-op handlers. The ActionFunction phantom-type
 * constraint still applies: when F5.1 is rebased in, each machine must inline
 * the 9 settings actions typed to its own Context/Event.
 */
function ZoneStepSettingsTab(): ReactNode {
  const [splitsOn, setSplitsOn] = useState(true);
  const [granularity, setGranularity] = useState<
    "Block" | "Paragraph" | "Line" | "Word"
  >("Line");

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
            onClick={() => setSplitsOn((v) => !v)}
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
            {(["Block", "Paragraph", "Line", "Word"] as const).map((opt) => {
              const active = granularity === opt;
              return (
                <button
                  key={opt}
                  data-testid={`zone-settings-granularity-${opt.toLowerCase()}`}
                  onClick={() => setGranularity(opt)}
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
                  {opt}
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
  runnerRef,
  _testServices,
}: ToolSlotProps & { _testServices?: TextZonesToolServices }): ReactNode {
  void runnerRef; // wired at I1

  // Extract projectId from the runner context (at I1; for now use fixture)
  const { projectId = "demo" } = useParams<{ projectId: string }>();

  const services = useMemo(
    () => _testServices ?? buildRealTextZonesToolServices(),
    [_testServices],
  );

  const [snapshot, send] = useActor(textZonesToolMachine, {
    input: { projectId, stageIndex: 9, services },
  });
  const { rows, totals, filter, density, editing, editorKind, splitDraft } =
    snapshot.context;

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
      {activeTab === "settings" ? <ZoneStepSettingsTab /> : null}

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
              onRedetect={() => send({ type: "REDETECT" })}
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
      ) : null}
    </div>
  );
}
