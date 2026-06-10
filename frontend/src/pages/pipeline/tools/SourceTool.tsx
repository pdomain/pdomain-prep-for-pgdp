/**
 * SourceTool — Source-stage tool component for the pipeline tool slot.
 *
 * Recreates the artboards from `final/source/source.jsx`:
 *   SourceFiles (generating + selection states)
 *   SourceOverview
 *   SourceStepSettings (default / modified / preset)
 *   SourcePageWorkbench
 *
 * ## Machine wiring
 * Driven by `sourceToolMachine` (machines/tools/source.ts).
 * Receives `{ stageId, runnerRef }` from the F4 toolSlot contract.
 * The `runnerRef` is NOT used directly here — the source stage has no
 * stageRunner (machine-stage-map.md §3). The runnerRef is retained in the
 * prop signature to satisfy the `ToolSlotComponent` interface contract.
 *
 * ## Artboard parity
 * Every named artboard from final/source/ is represented as a named
 * component with `data-testid` on interactive elements:
 *   - data-testid="source-banner"           — progress / marking status banner
 *   - data-testid="source-banner-generating"— generating state banner
 *   - data-testid="source-banner-selection" — selection state banner
 *   - data-testid="confirm-selection-btn"   — the guarded Confirm button
 *   - data-testid="file-toolbar"            — filter chips + density + search + insert
 *   - data-testid="filter-chip-{id}"        — individual filter chip
 *   - data-testid="density-btn-{d}"         — S/M/L density button
 *   - data-testid="file-grid"               — thumb grid container
 *   - data-testid="thumb-card-{idx}"        — individual thumb card
 *   - data-testid="bulk-bar"                — sticky multi-select action bar
 *   - data-testid="bulk-mark-{state}"       — mark-as button in bulk bar
 *   - data-testid="insert-dialog"           — insert-page dialog overlay
 *   - data-testid="settings-banner"         — inheritance banner
 *   - data-testid="settings-save-btn"       — "Save as project default"
 *   - data-testid="settings-revert-btn"     — "Revert"
 *   - data-testid="settings-reset-btn"      — "Reset to project default"
 *   - data-testid="workbench-role-segment"  — per-page role selector
 *   - data-testid="workbench-apply-btn"     — "Apply & Continue"
 *
 * @see docs/plans/design_handoff_pgdp_app/final/source/source.jsx
 * @see src/machines/tools/source.ts
 * @see src/machines/tools/stageSettings.ts
 * @see src/pages/pipeline/toolSlot.tsx — ToolSlotComponent contract
 * @see src/machines/DIVERGENCES.md — F5-1 through F5-5
 */

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useActor } from "@xstate/react";
import {
  sourceToolMachine,
  type SourceToolServices,
  type FileRow,
  type FileState,
  type FileFilter,
  type FileDensity,
  type InsertDraft,
  type FileTotals,
} from "@/machines/tools/source";
import { countDraftChanges } from "@/machines/tools/stageSettings";
import type { ToolSlotProps } from "@/pages/pipeline/toolSlot";
import { Seg } from "@/design/Seg";
import { SetRow } from "@/design/SetRow";
import { Toggle2 } from "@/design/Toggle2";
import { SettingSlider } from "@/design/SettingSlider";
import { createMockServer } from "@/mocks/server";
import { MOCK_PROJECT_ID } from "@/mocks/fixtures";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Filter the file list per the active filter chip. */
function applyFilter(files: FileRow[], filter: FileFilter): FileRow[] {
  switch (filter) {
    case "page":
      return files.filter((f) => f.state === "page");
    case "skipped":
      return files.filter((f) =>
        ["cover", "back", "blank", "duplicate"].includes(f.state),
      );
    case "unmarked":
      return files.filter((f) => f.state === "ready");
    case "inserts":
      return files.filter((f) => f.state === "inserted");
    default:
      return files;
  }
}

function applySearch(files: FileRow[], query: string): FileRow[] {
  if (!query) return files;
  const q = query.toLowerCase();
  return files.filter((f) => f.stem.toLowerCase().includes(q));
}

// Tone → CSS token mapping
const STATE_DOT_COLOR: Record<string, string> = {
  page: "var(--exact)",
  cover: "var(--gt, #84cc16)",
  back: "var(--gt, #84cc16)",
  blank: "var(--ink-3)",
  duplicate: "var(--mismatch)",
  inserted: "var(--accent)",
};

const STATE_LABEL: Record<string, string> = {
  page: "page",
  cover: "cover",
  back: "back",
  blank: "blank",
  duplicate: "dup",
  inserted: "insert",
};

const KIND_LABEL: Record<string, string> = {
  missing: "Missing",
  blank: "Blank",
  errata: "Errata",
  manual: "Manual",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Skeleton thumb card shown while thumbnail is generating. */
function SkeletonThumb({
  width,
  height,
}: {
  width: number;
  height: number;
}): ReactNode {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 3,
        background: "var(--bg-raised)",
        border: "1px solid var(--border-1)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(90deg, transparent 0%, color-mix(in oklab, var(--ink-4) 18%, transparent) 50%, transparent 100%)",
          backgroundSize: "200% 100%",
          animation: "pgd-shimmer 1.6s linear infinite",
        }}
      />
    </div>
  );
}

/** Inserted-page placeholder thumb. */
function InsertedThumb({
  width,
  height,
}: {
  width: number;
  height: number;
}): ReactNode {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 3,
        background: "color-mix(in oklab, var(--accent) 6%, var(--bg-surface))",
        border:
          "1.5px dashed color-mix(in oklab, var(--accent) 55%, var(--border-2))",
        display: "grid",
        placeItems: "center",
        color: "var(--accent)",
        fontSize: 20,
      }}
    >
      +
    </div>
  );
}

/** Fake thumb for a scanned page (no actual image). */
function FakeThumb({
  tone = "light",
  kind,
  width,
  height,
}: {
  tone?: "light" | "mid" | "dark";
  kind?: string;
  width: number;
  height: number;
}): ReactNode {
  const paper =
    tone === "dark"
      ? "oklch(0.72 0.02 80)"
      : tone === "mid"
        ? "oklch(0.86 0.02 80)"
        : "oklch(0.95 0.012 85)";
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 3,
        background: paper,
        boxShadow: "inset 0 0 0 1px rgba(40,30,20,0.15)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {kind !== "blank" && (
        <div
          style={{
            position: "absolute",
            inset: "14% 12% 14% 12%",
            backgroundImage: `repeating-linear-gradient(to bottom, oklch(0.34 0.02 60) 0 1.5px, transparent 1.5px 7px)`,
            opacity: 0.7,
          }}
        />
      )}
      {kind === "blank" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            color: "var(--ink-4)",
            fontSize: 10,
            fontFamily: "var(--mono-font)",
            letterSpacing: ".08em",
            textTransform: "uppercase",
          }}
        >
          blank
        </div>
      )}
    </div>
  );
}

/** Tag chip shown on marked files. */
function TagChip({ state }: { state: FileState }): ReactNode {
  const color = STATE_DOT_COLOR[state];
  const label = STATE_LABEL[state];
  if (!color || !label) return null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        height: 17,
        padding: "0 6px",
        borderRadius: 99,
        fontSize: 9.5,
        fontWeight: 600,
        fontFamily: "var(--mono-font)",
        background: `color-mix(in oklab, ${color} 14%, var(--bg-surface))`,
        color,
        border: `1px solid color-mix(in oklab, ${color} 40%, transparent)`,
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: 99,
          background: color,
        }}
      />
      {label}
    </span>
  );
}

/** Single thumb card in the grid. */
function ThumbCard({
  file,
  density,
  selected,
  onClick,
}: {
  file: FileRow;
  density: FileDensity;
  selected: boolean;
  onClick: () => void;
}): ReactNode {
  const dims =
    density === "S"
      ? { w: 90, h: 118, fs: 10 }
      : density === "L"
        ? { w: 160, h: 208, fs: 12 }
        : { w: 124, h: 162, fs: 11 };

  const isPending = file.state === "pending";
  const isInserted = file.state === "inserted";
  const showTag = !isPending && file.state !== "ready";

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      data-testid={`thumb-card-${file.idx}`}
      onClick={onClick}
      style={{
        position: "relative",
        width: dims.w,
        padding: 4,
        borderRadius: 6,
        background: selected
          ? "color-mix(in oklab, var(--accent) 8%, var(--bg-surface))"
          : "transparent",
        border: `1.5px solid ${selected ? "var(--accent)" : "transparent"}`,
        cursor: "pointer",
        transition: "border-color .12s, background .12s",
      }}
    >
      <div
        style={{
          position: "relative",
          display: "flex",
          justifyContent: "center",
        }}
      >
        {isPending ? (
          <SkeletonThumb width={dims.w - 8} height={dims.h - 36} />
        ) : isInserted ? (
          <InsertedThumb width={dims.w - 8} height={dims.h - 36} />
        ) : (
          <FakeThumb
            tone={file.tone ?? "light"}
            {...(file.state === "blank" ? { kind: "blank" } : {})}
            width={dims.w - 8}
            height={dims.h - 36}
          />
        )}
        {/* Checkbox top-left (when not pending) */}
        {!isPending && (
          <div
            style={{
              position: "absolute",
              top: 6,
              left: 6,
              width: 18,
              height: 18,
              borderRadius: 4,
              background: selected ? "var(--accent)" : "rgba(245,240,230,0.92)",
              border: `1.5px solid ${selected ? "var(--accent)" : "rgba(40,30,20,0.35)"}`,
              display: "grid",
              placeItems: "center",
              color: selected ? "var(--accent-ink)" : "transparent",
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            {selected ? "✓" : ""}
          </div>
        )}
        {/* Page number badge */}
        {file.pageNumber != null && (
          <div
            style={{
              position: "absolute",
              bottom: 6,
              left: 6,
              height: 18,
              padding: "0 6px",
              borderRadius: 4,
              background: "rgba(40,30,20,0.78)",
              color: "#fff",
              fontSize: 10,
              fontFamily: "var(--mono-font)",
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            {file.pageNumber}
          </div>
        )}
        {/* Tag chip top-right */}
        {showTag && (
          <div style={{ position: "absolute", top: 6, right: 6 }}>
            <TagChip state={file.state} />
          </div>
        )}
      </div>
      {/* Filename */}
      <div
        style={{
          marginTop: 5,
          height: 18,
          display: "flex",
          alignItems: "center",
        }}
      >
        {isInserted ? (
          <span
            style={{
              fontSize: dims.fs - 0.5,
              color: "var(--accent)",
              fontWeight: 600,
              fontFamily: "var(--mono-font)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {KIND_LABEL[file.kind ?? "missing"] ?? "Insert"} · inserted
          </span>
        ) : (
          <span
            style={{
              fontSize: dims.fs,
              color: "var(--ink-3)",
              fontFamily: "var(--mono-font)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {file.stem}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SourceBanner
// ---------------------------------------------------------------------------

/** Progress / marking status banner (generating vs selection states). */
export function SourceBanner({
  isGenerating,
  totals,
}: {
  isGenerating: boolean;
  totals: FileTotals | null;
}): ReactNode {
  if (!totals) return null;

  if (isGenerating) {
    const pct =
      totals.files > 0 ? Math.round((totals.thumbed / totals.files) * 100) : 0;
    return (
      <div
        data-testid="source-banner-generating"
        style={{
          borderRadius: 10,
          border:
            "1px solid color-mix(in oklab, var(--ocr) 38%, var(--border-1))",
          background: "color-mix(in oklab, var(--ocr) 7%, var(--bg-surface))",
          padding: "14px 16px",
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background:
              "color-mix(in oklab, var(--ocr) 16%, var(--bg-surface))",
            color: "var(--ocr)",
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              width: 14,
              height: 14,
              borderRadius: 99,
              border:
                "2.5px solid color-mix(in oklab, var(--ocr) 30%, transparent)",
              borderTopColor: "var(--ocr)",
              display: "block",
            }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink-1)" }}
          >
            Generating thumbnails…
          </div>
          <div
            style={{
              marginTop: 2,
              fontSize: 11.5,
              color: "var(--ink-3)",
              fontFamily: "var(--mono-font)",
            }}
          >
            {totals.thumbed} / {totals.files} ·{" "}
            {totals.rateHz > 0
              ? `${totals.rateHz}/s · ~${Math.ceil(totals.remaining / totals.rateHz)}s remaining`
              : "starting…"}
          </div>
          <div
            style={{
              marginTop: 8,
              height: 4,
              borderRadius: 99,
              background: "color-mix(in oklab, var(--ocr) 14%, var(--bg-sunk))",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${pct}%`,
                height: "100%",
                background: "var(--ocr)",
              }}
            />
          </div>
        </div>
        <span
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: "var(--ocr)",
            fontFamily: "var(--mono-font)",
            flexShrink: 0,
          }}
        >
          {pct}%
        </span>
      </div>
    );
  }

  // Selection state
  const m = totals.marked;
  const tone = totals.unmarked > 0 ? "var(--fuzzy)" : "var(--exact)";
  const dotPairs: [string, number, string][] = [
    ["page", m.page, "var(--exact)"],
    ["cover", m.cover, "var(--gt, #84cc16)"],
    ["back", m.back, "var(--gt, #84cc16)"],
    ["blank", m.blank, "var(--ink-3)"],
    ["dup", m.duplicate, "var(--mismatch)"],
    ["insert", m.inserted, "var(--accent)"],
  ];

  return (
    <div
      data-testid="source-banner-selection"
      style={{
        borderRadius: 10,
        border: `1px solid color-mix(in oklab, ${tone} 40%, var(--border-1))`,
        background: `color-mix(in oklab, ${tone} 7%, var(--bg-surface))`,
        display: "flex",
        alignItems: "stretch",
        overflow: "hidden",
      }}
    >
      <div style={{ width: 4, background: tone, flexShrink: 0 }} />
      <div
        style={{
          flex: 1,
          padding: "14px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 13.5,
              fontWeight: 600,
              color: "var(--ink-1)",
            }}
          >
            {totals.files} files · {m.page} marked as pages
            {totals.unmarked > 0 && (
              <>
                {" "}
                ·{" "}
                <span style={{ color: tone }}>{totals.unmarked} unmarked</span>
              </>
            )}
          </div>
          <div style={{ marginTop: 3, fontSize: 12, color: "var(--ink-3)" }}>
            {totals.unmarked > 0
              ? "Mark every file as page / cover / back / blank / duplicate before confirming."
              : "All files reviewed. Confirm to advance the pipeline."}
          </div>
          <div
            style={{
              marginTop: 8,
              display: "flex",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            {dotPairs
              .filter(([, n]) => n > 0)
              .map(([k, n, color]) => (
                <span
                  key={k}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    height: 20,
                    padding: "0 8px",
                    borderRadius: 99,
                    fontSize: 11,
                    fontWeight: 500,
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border-1)",
                    color: "var(--ink-2)",
                  }}
                >
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: 99,
                      background: color,
                    }}
                  />
                  {k}{" "}
                  <span
                    style={{
                      color: "var(--ink-4)",
                      fontFamily: "var(--mono-font)",
                    }}
                  >
                    {n}
                  </span>
                </span>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FileToolbar
// ---------------------------------------------------------------------------

const FILTER_CHIPS = [
  { id: "all", name: "All" },
  { id: "page", name: "Marked as page" },
  { id: "skipped", name: "Skipped" },
  { id: "unmarked", name: "Unmarked" },
  { id: "inserts", name: "Inserts" },
] as const;

/** Filter chips + density selector + search + Insert button. */
export function FileToolbar({
  filter,
  density,
  totals,
  onFilterChange,
  onDensityChange,
  onInsertOpen,
}: {
  filter: FileFilter;
  density: FileDensity;
  totals: FileTotals | null;
  onFilterChange: (f: FileFilter) => void;
  onDensityChange: (d: FileDensity) => void;
  onInsertOpen: () => void;
}): ReactNode {
  const m = totals?.marked ?? {
    page: 0,
    cover: 0,
    back: 0,
    blank: 0,
    duplicate: 0,
    inserted: 0,
  };
  const counts: Record<string, number> = {
    all: totals?.files ?? 0,
    page: m.page,
    skipped: m.cover + m.back + m.blank + m.duplicate,
    unmarked: totals?.unmarked ?? 0,
    inserts: m.inserted,
  };

  return (
    <div
      data-testid="file-toolbar"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      {/* Filter chips */}
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: 4,
          background: "var(--bg-raised)",
          borderRadius: 8,
          border: "1px solid var(--border-1)",
        }}
      >
        {FILTER_CHIPS.map((chip) => {
          const active = filter === chip.id;
          return (
            <button
              key={chip.id}
              data-testid={`filter-chip-${chip.id}`}
              type="button"
              onClick={() => onFilterChange(chip.id)}
              style={{
                padding: "5px 10px",
                borderRadius: 6,
                background: active ? "var(--bg-surface)" : "transparent",
                boxShadow: active
                  ? "0 1px 1px rgba(15,23,42,.06), 0 0 0 1px var(--border-1)"
                  : "none",
                border: 0,
                display: "flex",
                alignItems: "center",
                gap: 7,
                color: active ? "var(--ink-1)" : "var(--ink-3)",
                fontSize: 12.5,
                fontWeight: active ? 600 : 500,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {chip.name}
              <span
                style={{
                  fontSize: 10.5,
                  color: "var(--ink-4)",
                  fontFamily: "var(--mono-font)",
                }}
              >
                {counts[chip.id]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Insert button */}
      <div
        style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <button
          type="button"
          data-testid="insert-page-btn"
          onClick={onInsertOpen}
          style={{
            height: 30,
            padding: "0 12px",
            borderRadius: 6,
            background: "var(--bg-surface)",
            border: "1px solid var(--border-1)",
            color: "var(--ink-1)",
            fontSize: 12.5,
            fontWeight: 500,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          + Insert page
        </button>

        <div
          style={{
            width: 1,
            height: 22,
            background: "var(--border-2)",
          }}
        />

        {/* Density */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11.5,
            color: "var(--ink-3)",
          }}
        >
          Density
          <div
            style={{
              display: "inline-flex",
              padding: 3,
              background: "var(--bg-raised)",
              border: "1px solid var(--border-1)",
              borderRadius: 7,
            }}
          >
            {(["S", "M", "L"] as FileDensity[]).map((d) => {
              const active = density === d;
              return (
                <button
                  key={d}
                  type="button"
                  data-testid={`density-btn-${d}`}
                  onClick={() => onDensityChange(d)}
                  style={{
                    padding: "3px 8px",
                    borderRadius: 5,
                    border: 0,
                    background: active ? "var(--bg-surface)" : "transparent",
                    boxShadow: active
                      ? "0 1px 1px rgba(15,23,42,.06), 0 0 0 1px var(--border-1)"
                      : "none",
                    color: active ? "var(--ink-1)" : "var(--ink-3)",
                    fontSize: 11,
                    fontWeight: active ? 600 : 500,
                    fontFamily: "var(--mono-font)",
                    cursor: "pointer",
                  }}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BulkBar
// ---------------------------------------------------------------------------

const BULK_MARK_OPTIONS: { id: FileState; name: string; dot: string }[] = [
  { id: "page", name: "Page", dot: "var(--exact)" },
  { id: "cover", name: "Cover", dot: "var(--gt, #84cc16)" },
  { id: "back", name: "Back", dot: "var(--gt, #84cc16)" },
  { id: "blank", name: "Blank", dot: "var(--ink-3)" },
  { id: "duplicate", name: "Duplicate", dot: "var(--mismatch)" },
];

/** Sticky multi-select action bar. */
export function BulkBar({
  count,
  onMark,
  onRemove,
  onClear,
}: {
  count: number;
  onMark: (state: FileState) => void;
  onRemove: () => void;
  onClear: () => void;
}): ReactNode {
  return (
    <div
      data-testid="bulk-bar"
      style={{
        position: "sticky",
        bottom: 12,
        marginTop: 12,
        zIndex: 5,
        padding: "10px 14px",
        borderRadius: 10,
        background: "var(--ink-1)",
        color: "var(--bg-page)",
        boxShadow:
          "0 12px 28px rgba(15,23,42,.22), 0 2px 6px rgba(15,23,42,.10)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          fontFamily: "var(--mono-font)",
        }}
      >
        {count} selected
      </span>
      <div
        style={{
          width: 1,
          height: 18,
          background: "color-mix(in oklab, var(--bg-page) 25%, transparent)",
        }}
      />
      <span
        style={{
          fontSize: 12,
          color: "color-mix(in oklab, var(--bg-page) 65%, transparent)",
        }}
      >
        Mark as
      </span>
      {BULK_MARK_OPTIONS.map((b) => (
        <button
          key={b.id}
          type="button"
          data-testid={`bulk-mark-${b.id}`}
          onClick={() => onMark(b.id)}
          style={{
            height: 26,
            padding: "0 9px",
            borderRadius: 6,
            background: "color-mix(in oklab, var(--bg-page) 12%, transparent)",
            border:
              "1px solid color-mix(in oklab, var(--bg-page) 22%, transparent)",
            color: "var(--bg-page)",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            fontWeight: 500,
            fontFamily: "inherit",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 99,
              background: b.dot,
            }}
          />
          {b.name}
        </button>
      ))}
      <div
        style={{
          width: 1,
          height: 18,
          background: "color-mix(in oklab, var(--bg-page) 25%, transparent)",
        }}
      />
      <button
        type="button"
        data-testid="bulk-remove-btn"
        onClick={onRemove}
        style={{
          height: 26,
          padding: "0 10px",
          borderRadius: 6,
          background: "transparent",
          border:
            "1px solid color-mix(in oklab, var(--mismatch) 75%, transparent)",
          color: "color-mix(in oklab, var(--mismatch) 70%, var(--bg-page))",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 500,
          fontFamily: "inherit",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        ✕ Remove from project
      </button>
      <span style={{ flex: 1 }} />
      <button
        type="button"
        data-testid="bulk-clear-btn"
        onClick={onClear}
        style={{
          background: "transparent",
          border: "none",
          color: "color-mix(in oklab, var(--bg-page) 55%, transparent)",
          fontSize: 10.5,
          fontFamily: "var(--mono-font)",
          cursor: "pointer",
        }}
      >
        esc clear
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InsertDialog
// ---------------------------------------------------------------------------

const INSERT_KINDS: { id: string; name: string; desc: string }[] = [
  { id: "missing", name: "Missing", desc: "Page absent from scan" },
  { id: "blank", name: "Blank", desc: "Intentional blank" },
  { id: "errata", name: "Errata", desc: "Correction sheet" },
  { id: "manual", name: "Manual", desc: "Typed transcription" },
];

/** Insert-page dialog overlay. */
export function InsertDialog({
  draft,
  onPatch,
  onConfirm,
  onCancel,
}: {
  draft: InsertDraft | null;
  onPatch: (patch: Partial<InsertDraft>) => void;
  onConfirm: () => void;
  onCancel: () => void;
}): ReactNode {
  if (!draft) return null;

  return (
    <div
      data-testid="insert-dialog"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 20,
        background: "rgba(20,14,8,0.40)",
        backdropFilter: "blur(2px)",
        display: "grid",
        placeItems: "center",
      }}
    >
      <div
        style={{
          width: 480,
          background: "var(--bg-surface)",
          border: "1px solid var(--border-1)",
          borderRadius: 10,
          boxShadow:
            "0 24px 64px rgba(15,23,42,.30), 0 2px 8px rgba(15,23,42,.12)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border-1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: "var(--ink-1)",
              }}
            >
              Insert page
            </div>
            <div
              style={{ marginTop: 2, fontSize: 11.5, color: "var(--ink-3)" }}
            >
              Synthetic page that participates in numbering and downstream
              stages.
            </div>
          </div>
          <button
            type="button"
            data-testid="insert-dialog-close"
            onClick={onCancel}
            style={{
              width: 24,
              height: 24,
              background: "transparent",
              border: 0,
              cursor: "pointer",
              color: "var(--ink-3)",
              fontSize: 16,
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            padding: "16px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {/* Position */}
          <div>
            <div
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                color: "var(--ink-2)",
                marginBottom: 6,
              }}
            >
              Position
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <div
                style={{
                  display: "inline-flex",
                  padding: 3,
                  background: "var(--bg-raised)",
                  border: "1px solid var(--border-1)",
                  borderRadius: 7,
                }}
              >
                {(["before", "after"] as const).map((pos) => {
                  const active = draft.position === pos;
                  return (
                    <button
                      key={pos}
                      type="button"
                      data-testid={`insert-position-${pos}`}
                      onClick={() => onPatch({ position: pos })}
                      style={{
                        padding: "4px 10px",
                        borderRadius: 5,
                        border: 0,
                        background: active
                          ? "var(--bg-surface)"
                          : "transparent",
                        color: active ? "var(--ink-1)" : "var(--ink-3)",
                        fontSize: 12,
                        fontWeight: active ? 600 : 500,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {pos.charAt(0).toUpperCase() + pos.slice(1)}
                    </button>
                  );
                })}
              </div>
              {draft.anchorStem && (
                <div
                  style={{
                    flex: 1,
                    height: 30,
                    padding: "0 10px",
                    background: "var(--bg-sunk)",
                    border: "1px solid var(--border-2)",
                    borderRadius: 6,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11.5,
                    color: "var(--ink-1)",
                    fontFamily: "var(--mono-font)",
                  }}
                >
                  {draft.anchorStem}
                </div>
              )}
            </div>
          </div>

          {/* Kind */}
          <div>
            <div
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                color: "var(--ink-2)",
                marginBottom: 6,
              }}
            >
              Kind
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {INSERT_KINDS.map((k) => {
                const active = draft.kind === k.id;
                return (
                  // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
                  <div
                    key={k.id}
                    data-testid={`insert-kind-${k.id}`}
                    onClick={() =>
                      onPatch({ kind: k.id as InsertDraft["kind"] })
                    }
                    style={{
                      flex: 1,
                      minWidth: 100,
                      padding: "8px 10px",
                      borderRadius: 7,
                      background: active
                        ? "color-mix(in oklab, var(--accent) 8%, var(--bg-surface))"
                        : "var(--bg-surface)",
                      border: `1px solid ${active ? "var(--accent)" : "var(--border-1)"}`,
                      cursor: "pointer",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: active ? "var(--accent)" : "var(--ink-1)",
                      }}
                    >
                      {k.name}
                    </div>
                    <div
                      style={{
                        marginTop: 2,
                        fontSize: 10.5,
                        color: "var(--ink-3)",
                      }}
                    >
                      {k.desc}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Note */}
          <div>
            <div
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                color: "var(--ink-2)",
                marginBottom: 6,
              }}
            >
              Note{" "}
              <span style={{ color: "var(--ink-4)", fontWeight: 400 }}>
                · optional
              </span>
            </div>
            <textarea
              data-testid="insert-note-field"
              value={draft.note}
              onChange={(e) => onPatch({ note: e.target.value })}
              style={{
                width: "100%",
                background: "var(--bg-sunk)",
                border: "1px solid var(--border-2)",
                borderRadius: 6,
                padding: 10,
                fontSize: 12,
                color: "var(--ink-1)",
                minHeight: 56,
                fontFamily: "inherit",
                resize: "vertical",
                boxSizing: "border-box",
              }}
              placeholder="Optional note about this inserted page…"
            />
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 18px",
            borderTop: "1px solid var(--border-1)",
            background: "var(--bg-page)",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button
            type="button"
            data-testid="insert-cancel-btn"
            onClick={onCancel}
            style={{
              height: 30,
              padding: "0 12px",
              borderRadius: 6,
              background: "transparent",
              border: "1px solid var(--border-1)",
              color: "var(--ink-2)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="insert-confirm-btn"
            onClick={onConfirm}
            style={{
              height: 30,
              padding: "0 14px",
              borderRadius: 6,
              background: "var(--accent)",
              border: "none",
              color: "var(--accent-ink)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            + Insert page
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SourceFiles — main artboard (Files tab)
// ---------------------------------------------------------------------------

/** Source Files tab — generating or selection artboard. */
export function SourceFiles({
  files,
  filter,
  density,
  query,
  selected,
  totals,
  isGenerating,
  isConfirming,
  isConfirmed,
  insertDraft,
  onSelectFile,
  onClearSelection,
  onMark,
  onRemove,
  onFilterChange,
  onDensityChange,
  onInsertOpen,
  onInsertPatch,
  onInsertConfirm,
  onInsertCancel,
  onConfirmSelection,
}: {
  files: FileRow[];
  filter: FileFilter;
  density: FileDensity;
  query: string;
  selected: number[];
  totals: FileTotals | null;
  isGenerating: boolean;
  isConfirming: boolean;
  isConfirmed: boolean;
  insertDraft: InsertDraft | null;
  onSelectFile: (idx: number) => void;
  onClearSelection: () => void;
  onMark: (state: FileState) => void;
  onRemove: () => void;
  onFilterChange: (f: FileFilter) => void;
  onDensityChange: (d: FileDensity) => void;
  onInsertOpen: () => void;
  onInsertPatch: (patch: Partial<InsertDraft>) => void;
  onInsertConfirm: () => void;
  onInsertCancel: () => void;
  onConfirmSelection: () => void;
}): ReactNode {
  const displayFiles = applySearch(applyFilter(files, filter), query);
  const hasSelection = selected.length > 0;
  const canConfirm =
    !isGenerating && !isConfirmed && totals !== null && totals.unmarked === 0;

  return (
    <div
      style={{
        position: "relative",
        flex: 1,
        minHeight: 0,
        padding: "20px 28px 28px",
      }}
    >
      {/* Banner + Confirm button row */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 14,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <SourceBanner isGenerating={isGenerating} totals={totals} />
        </div>
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            alignItems: "flex-end",
          }}
        >
          <button
            type="button"
            data-testid="confirm-selection-btn"
            disabled={!canConfirm || isConfirming}
            onClick={onConfirmSelection}
            style={{
              height: 34,
              padding: "0 16px",
              borderRadius: 7,
              background: canConfirm ? "var(--accent)" : "var(--bg-raised)",
              border: "none",
              color: canConfirm ? "var(--accent-ink)" : "var(--ink-4)",
              fontSize: 13,
              fontWeight: 600,
              cursor: canConfirm ? "pointer" : "not-allowed",
              fontFamily: "inherit",
              opacity: isConfirming ? 0.7 : 1,
            }}
          >
            {isConfirming
              ? "Confirming…"
              : isConfirmed
                ? "Confirmed"
                : `Confirm selection${totals ? ` · ${totals.marked.page} pages` : ""}`}
          </button>
          {totals && totals.unmarked > 0 && (
            <span
              style={{
                fontSize: 10.5,
                color: "var(--ink-4)",
                fontFamily: "var(--mono-font)",
              }}
            >
              {totals.unmarked} unmarked
            </span>
          )}
        </div>
      </div>

      <FileToolbar
        filter={filter}
        density={density}
        totals={totals}
        onFilterChange={onFilterChange}
        onDensityChange={onDensityChange}
        onInsertOpen={onInsertOpen}
      />

      {/* Thumb grid */}
      <div
        data-testid="file-grid"
        style={{
          marginTop: 14,
          display: "flex",
          flexWrap: "wrap",
          gap: 4,
          padding: 12,
          borderRadius: 10,
          background: "var(--bg-surface)",
          border: "1px solid var(--border-1)",
          minHeight: 200,
        }}
      >
        {displayFiles.map((file) => (
          <ThumbCard
            key={`${file.idx}-${file.stem}`}
            file={file}
            density={density}
            selected={selected.includes(file.idx)}
            onClick={() => onSelectFile(file.idx)}
          />
        ))}
        {displayFiles.length === 0 && (
          <div
            style={{
              width: "100%",
              padding: "40px 0",
              textAlign: "center",
              color: "var(--ink-4)",
              fontSize: 12,
            }}
          >
            No files match the current filter.
          </div>
        )}
      </div>

      {/* Bulk bar (sticky) */}
      {hasSelection && (
        <BulkBar
          count={selected.length}
          onMark={onMark}
          onRemove={onRemove}
          onClear={onClearSelection}
        />
      )}

      {/* Insert dialog overlay */}
      {insertDraft && (
        <InsertDialog
          draft={insertDraft}
          onPatch={onInsertPatch}
          onConfirm={onInsertConfirm}
          onCancel={onInsertCancel}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SourceOverview
// ---------------------------------------------------------------------------

/** Source Overview tab. */
export function SourceOverview({
  totals,
  isGenerating,
  onOpenFiles,
}: {
  totals: FileTotals | null;
  isGenerating: boolean;
  onOpenFiles: () => void;
}): ReactNode {
  if (!totals) {
    return (
      <div
        style={{
          padding: "20px 28px 28px",
          color: "var(--ink-3)",
          fontSize: 13,
        }}
      >
        Loading…
      </div>
    );
  }

  const m = totals.marked;
  const statItems = [
    {
      label: "files",
      value: totals.files,
      tone: "var(--ink-1)",
    },
    {
      label: "thumbnails",
      value: `${totals.thumbed}/${totals.files}`,
      tone: isGenerating ? "var(--ocr)" : "var(--exact)",
    },
    {
      label: "pages",
      value: m.page,
      tone: "var(--exact)",
      sub: "in this project",
    },
    {
      label: "skipped",
      value: m.cover + m.back + m.blank + m.duplicate,
      tone: "var(--gt, #84cc16)",
      sub: "not in proofing",
    },
    { label: "inserts", value: m.inserted, tone: "var(--accent)" },
    {
      label: "unmarked",
      value: totals.unmarked,
      tone: totals.unmarked > 0 ? "var(--fuzzy)" : "var(--ink-2)",
      sub: totals.unmarked > 0 ? "needs review" : "all reviewed",
    },
  ];

  return (
    <div
      style={{
        padding: "20px 28px 28px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <SourceBanner isGenerating={isGenerating} totals={totals} />

      {/* Stats grid */}
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
        {statItems.map((stat) => (
          <div
            key={stat.label}
            style={{
              background: "var(--bg-surface)",
              padding: "14px 14px 12px",
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: "var(--ink-3)",
                letterSpacing: ".04em",
                textTransform: "uppercase",
              }}
            >
              {stat.label}
            </div>
            <div
              style={{
                marginTop: 6,
                fontSize: 18,
                fontWeight: 600,
                fontFamily: "var(--mono-font)",
                color: stat.tone,
                letterSpacing: "-0.01em",
              }}
            >
              {stat.value}
            </div>
            {stat.sub && (
              <div
                style={{
                  marginTop: 2,
                  fontSize: 10.5,
                  fontFamily: "var(--mono-font)",
                  color: "var(--ink-4)",
                }}
              >
                {stat.sub}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* CTA row */}
      <div
        style={{
          padding: "14px 16px",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-1)",
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-1)" }}>
            {isGenerating ? "Waiting for thumbnails…" : "Review page selection"}
          </div>
          <div style={{ marginTop: 3, fontSize: 12, color: "var(--ink-3)" }}>
            Open the Files tab to mark covers and inserts. Confirm to advance.
          </div>
        </div>
        <button
          type="button"
          data-testid="overview-open-files-btn"
          onClick={onOpenFiles}
          style={{
            height: 30,
            padding: "0 12px",
            borderRadius: 6,
            background: "var(--bg-surface)",
            border: "1px solid var(--border-1)",
            color: "var(--ink-1)",
            fontSize: 12.5,
            fontWeight: 500,
            cursor: "pointer",
            fontFamily: "inherit",
            flexShrink: 0,
          }}
        >
          Open Files →
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SourceStepSettings — Settings tab
// ---------------------------------------------------------------------------

/** Settings inheritance banner tones. */
const SETTINGS_BANNER_CONFIG = {
  default: {
    tone: "var(--exact)",
    label: "Using project default · Standard quality preset",
    sub: "Changes here can be saved back as the project default for Source.",
  },
  modified: {
    tone: "var(--fuzzy)",
    label: (n: number) =>
      `Modified · ${n} change${n === 1 ? "" : "s"} vs project default`,
    sub: "Save these as the project default, or revert to inherit.",
  },
  preset: {
    tone: "var(--ocr)",
    label: (id: string) => `Using preset · ${id}`,
    sub: "Loaded from a saved preset; not the project default.",
  },
} as const;

/** Source stage settings tab. */
export function SourceStepSettings({
  settingsState,
  draft,
  presetId,
  onSaveAsDefault,
  onRevert,
  onResetToDefault,
}: {
  settingsState: "default" | "modified" | "preset";
  draft: Record<string, unknown> | null;
  presetId: string | null;
  onSaveAsDefault: () => void;
  onRevert: () => void;
  onResetToDefault: () => void;
}): ReactNode {
  const [thumbQuality, setThumbQuality] = useState<string>("Standard");
  const [workers, setWorkers] = useState(4);
  const [autoConfirm, setAutoConfirm] = useState(false);

  const nChanges = countDraftChanges(draft);

  let bannerLabel: string;
  let bannerSub: string;
  let bannerTone: string;

  if (settingsState === "modified") {
    bannerLabel = SETTINGS_BANNER_CONFIG.modified.label(nChanges);
    bannerSub = SETTINGS_BANNER_CONFIG.modified.sub;
    bannerTone = SETTINGS_BANNER_CONFIG.modified.tone;
  } else if (settingsState === "preset") {
    bannerLabel = SETTINGS_BANNER_CONFIG.preset.label(presetId ?? "unknown");
    bannerSub = SETTINGS_BANNER_CONFIG.preset.sub;
    bannerTone = SETTINGS_BANNER_CONFIG.preset.tone;
  } else {
    bannerLabel = SETTINGS_BANNER_CONFIG.default.label;
    bannerSub = SETTINGS_BANNER_CONFIG.default.sub;
    bannerTone = SETTINGS_BANNER_CONFIG.default.tone;
  }

  return (
    <div
      style={{
        padding: "20px 28px 28px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div>
        <h2
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: "var(--ink-1)",
            letterSpacing: "-0.01em",
            margin: 0,
          }}
        >
          Stage settings · Source
        </h2>
        <div style={{ marginTop: 3, fontSize: 12, color: "var(--ink-3)" }}>
          Thumbnail quality, worker concurrency, and auto-confirm behaviour for
          this stage.
        </div>
      </div>

      {/* Inheritance banner */}
      <div
        data-testid="settings-banner"
        data-settings-state={settingsState}
        style={{
          borderRadius: 8,
          border: `1px solid color-mix(in oklab, ${bannerTone} 40%, var(--border-1))`,
          background: `color-mix(in oklab, ${bannerTone} 7%, var(--bg-surface))`,
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-1)" }}
          >
            {bannerLabel}
          </div>
          <div style={{ marginTop: 2, fontSize: 11.5, color: "var(--ink-3)" }}>
            {bannerSub}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {settingsState === "modified" && (
            <>
              <button
                type="button"
                data-testid="settings-revert-btn"
                onClick={onRevert}
                style={{
                  height: 28,
                  padding: "0 10px",
                  borderRadius: 5,
                  background: "transparent",
                  border: "1px solid var(--border-2)",
                  color: "var(--ink-2)",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                ↺ Revert
              </button>
              <button
                type="button"
                data-testid="settings-save-btn"
                onClick={onSaveAsDefault}
                style={{
                  height: 28,
                  padding: "0 12px",
                  borderRadius: 5,
                  background: "var(--accent)",
                  border: "none",
                  color: "var(--accent-ink)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                ✓ Save as project default
              </button>
            </>
          )}
          {settingsState === "preset" && (
            <button
              type="button"
              data-testid="settings-reset-btn"
              onClick={onResetToDefault}
              style={{
                height: 28,
                padding: "0 10px",
                borderRadius: 5,
                background: "transparent",
                border: "1px solid var(--border-2)",
                color: "var(--ink-2)",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              ↺ Reset to project default
            </button>
          )}
        </div>
      </div>

      {/* Settings rows */}
      <div
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-1)",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {/* Thumbnail quality */}
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--border-1)",
          }}
        >
          <SetRow
            label="Thumbnail quality"
            description="Higher quality → larger cache + slower generation"
            data-testid="setting-row-thumb-quality"
          >
            <div
              style={{
                display: "inline-flex",
                padding: 3,
                background: "var(--bg-raised)",
                border: "1px solid var(--border-1)",
                borderRadius: 7,
              }}
            >
              {["Fast", "Standard", "High"].map((v) => {
                const active = thumbQuality === v;
                return (
                  <button
                    key={v}
                    type="button"
                    data-testid={`thumb-quality-${v.toLowerCase()}`}
                    onClick={() => setThumbQuality(v)}
                    style={{
                      padding: "4px 12px",
                      borderRadius: 5,
                      border: 0,
                      background: active ? "var(--bg-surface)" : "transparent",
                      color: active ? "var(--ink-1)" : "var(--ink-3)",
                      fontSize: 12,
                      fontWeight: active ? 600 : 500,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {v}
                  </button>
                );
              })}
            </div>
          </SetRow>
        </div>

        {/* Workers */}
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--border-1)",
          }}
        >
          <SetRow
            label="Concurrent workers"
            description="How many thumbnails to generate at once"
            data-testid="setting-row-workers"
          >
            <div style={{ minWidth: 240 }}>
              <SettingSlider
                value={workers}
                onChange={setWorkers}
                min={1}
                max={8}
                step={1}
                data-testid="workers-slider"
              />
            </div>
          </SetRow>
        </div>

        {/* Regenerate */}
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid var(--border-1)",
          }}
        >
          <SetRow
            label="Re-generate thumbnails"
            description="Clears the cache and runs again at current quality"
            data-testid="setting-row-regenerate"
          >
            <button
              type="button"
              data-testid="regenerate-btn"
              style={{
                height: 28,
                padding: "0 10px",
                borderRadius: 5,
                background: "transparent",
                border: "1px solid var(--border-2)",
                color: "var(--ink-2)",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              ↺ Re-generate all thumbnails
            </button>
          </SetRow>
        </div>

        {/* Auto-confirm */}
        <div style={{ padding: "14px 16px" }}>
          <SetRow
            label="Auto-confirm selection"
            description="Skip manual confirmation once selection is mostly done"
            data-testid="setting-row-auto-confirm"
          >
            <Toggle2
              checked={autoConfirm}
              onChange={setAutoConfirm}
              data-testid="auto-confirm-toggle"
            />
          </SetRow>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SourcePageWorkbench — Workbench tab
// ---------------------------------------------------------------------------

const SOURCE_ROLES: {
  id: FileState;
  label: string;
  tone: string;
}[] = [
  { id: "cover", label: "Cover", tone: "var(--ocr)" },
  { id: "page", label: "Body", tone: "var(--exact)" },
  { id: "blank", label: "Blank", tone: "var(--ink-3)" },
  { id: "inserted", label: "Insert", tone: "var(--fuzzy)" },
  { id: "duplicate", label: "Skip", tone: "var(--mismatch)" },
];

/** Workbench role segment control for per-page role assignment. */
function RoleSegment({
  activeRole,
  onChange,
}: {
  activeRole: FileState;
  onChange: (role: FileState) => void;
}): ReactNode {
  return (
    <div
      data-testid="workbench-role-segment"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${SOURCE_ROLES.length}, 1fr)`,
        gap: 4,
        padding: 3,
        background: "var(--bg-page)",
        border: "1px solid var(--border-1)",
        borderRadius: 7,
      }}
    >
      {SOURCE_ROLES.map((r) => {
        const active = r.id === activeRole;
        return (
          <button
            key={r.id}
            type="button"
            data-testid={`role-btn-${r.id}`}
            onClick={() => onChange(r.id)}
            style={{
              border: active
                ? `1px solid color-mix(in oklab, ${r.tone} 45%, var(--border-1))`
                : "1px solid transparent",
              cursor: "pointer",
              padding: "6px 4px",
              borderRadius: 5,
              background: active
                ? `color-mix(in oklab, ${r.tone} 14%, var(--bg-surface))`
                : "transparent",
              color: active ? r.tone : "var(--ink-3)",
              fontSize: 11,
              fontWeight: active ? 600 : 500,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "inherit",
            }}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}

/** Full workbench tab for the source stage. */
export function SourcePageWorkbench({
  file,
  onRoleChange,
  onApply,
  onPrev,
  onNext,
}: {
  file: FileRow | null;
  onRoleChange: (idx: number, role: FileState) => void;
  onApply: () => void;
  onPrev: () => void;
  onNext: () => void;
}): ReactNode {
  if (!file) {
    return (
      <div
        style={{
          padding: "20px 28px 28px",
          color: "var(--ink-4)",
          fontSize: 13,
        }}
      >
        No page selected.
      </div>
    );
  }

  const isInserted = file.state === "inserted";

  return (
    <>
      {/* Subheader */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          padding: "18px 28px 0",
          gap: 14,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "var(--ink-1)",
              letterSpacing: "-0.005em",
            }}
          >
            Page workbench · Source
          </div>
          <div
            style={{
              marginTop: 3,
              fontSize: 12,
              color: "var(--ink-3)",
              lineHeight: 1.5,
            }}
          >
            Per-page metadata for the raw ingested scan. Set the role, page
            number, rotation, and tone hint.
          </div>
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            data-testid="workbench-prev-btn"
            onClick={onPrev}
            style={{
              height: 28,
              padding: "0 10px",
              borderRadius: 5,
              background: "transparent",
              border: "1px solid var(--border-2)",
              color: "var(--ink-2)",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            ← Prev
          </button>
          <button
            type="button"
            data-testid="workbench-next-btn"
            onClick={onNext}
            style={{
              height: 28,
              padding: "0 10px",
              borderRadius: 5,
              background: "transparent",
              border: "1px solid var(--border-2)",
              color: "var(--ink-2)",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Next →
          </button>
          <div
            style={{ width: 1, height: 22, background: "var(--border-2)" }}
          />
          <button
            type="button"
            data-testid="workbench-apply-btn"
            onClick={onApply}
            style={{
              height: 28,
              padding: "0 14px",
              borderRadius: 5,
              background: "var(--accent)",
              border: "none",
              color: "var(--accent-ink)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Apply & Continue →
          </button>
        </div>
      </div>

      {/* Two-pane layout */}
      <div
        style={{
          padding: "14px 28px 28px",
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "340px 1fr",
          gap: 14,
        }}
      >
        {/* Controls pane */}
        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-1)",
            borderRadius: 8,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Pane header */}
          <div
            style={{
              padding: "10px 14px",
              borderBottom: "1px solid var(--border-1)",
            }}
          >
            <div
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                color: "var(--ink-4)",
              }}
            >
              Page metadata
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--ink-1)",
                marginTop: 3,
              }}
            >
              {file.stem}
            </div>
          </div>

          {/* Pane body */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflow: "auto",
              padding: 14,
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {/* Role */}
            <div>
              <div
                style={{
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                  color: "var(--ink-4)",
                  marginBottom: 6,
                }}
              >
                Role
              </div>
              <RoleSegment
                activeRole={file.state}
                onChange={(role) => onRoleChange(file.idx, role)}
              />
            </div>

            {/* Page number */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    color: "var(--ink-4)",
                    marginBottom: 5,
                  }}
                >
                  Page number
                </div>
                <div
                  style={{
                    height: 28,
                    padding: "0 10px",
                    background: "var(--bg-page)",
                    border: "1px solid var(--border-2)",
                    borderRadius: 6,
                    display: "flex",
                    alignItems: "center",
                    fontSize: 12,
                    color: "var(--ink-1)",
                    fontFamily: "var(--mono-font)",
                  }}
                >
                  {file.pageNumber ?? "—"}
                </div>
              </div>
              <div>
                <div
                  style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    color: "var(--ink-4)",
                    marginBottom: 5,
                  }}
                >
                  Section
                </div>
                <div
                  style={{
                    height: 28,
                    padding: "0 10px",
                    background: "var(--bg-page)",
                    border: "1px solid var(--border-2)",
                    borderRadius: 6,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    fontSize: 12,
                    color: "var(--ink-1)",
                  }}
                >
                  <span>Body</span>
                  <span style={{ color: "var(--ink-3)" }}>▾</span>
                </div>
              </div>
            </div>

            {/* Insert note (only for inserted pages) */}
            {isInserted && file.note && (
              <div>
                <div
                  style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    letterSpacing: ".08em",
                    textTransform: "uppercase",
                    color: "var(--ink-4)",
                    marginBottom: 5,
                  }}
                >
                  Insert note
                </div>
                <div
                  style={{
                    padding: "8px 10px",
                    background: "var(--bg-page)",
                    border: "1px solid var(--border-2)",
                    borderRadius: 6,
                    fontSize: 11.5,
                    color: "var(--ink-2)",
                    lineHeight: 1.5,
                  }}
                >
                  {file.note}
                </div>
              </div>
            )}

            {/* Quick actions */}
            <div
              style={{
                marginTop: 4,
                padding: "10px 12px",
                borderRadius: 7,
                background: "var(--bg-page)",
                border: "1px solid var(--border-1)",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                  color: "var(--ink-4)",
                }}
              >
                Actions
              </span>
              <button
                type="button"
                data-testid="workbench-replace-btn"
                style={{
                  height: 28,
                  padding: "0 10px",
                  borderRadius: 5,
                  background: "transparent",
                  border: "1px solid var(--border-2)",
                  color: "var(--ink-2)",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  width: "100%",
                }}
              >
                ↑ Replace scan…
              </button>
              <button
                type="button"
                data-testid="workbench-insert-after-btn"
                style={{
                  height: 28,
                  padding: "0 10px",
                  borderRadius: 5,
                  background: "transparent",
                  border: "1px solid var(--border-2)",
                  color: "var(--ink-2)",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  width: "100%",
                }}
              >
                + Insert page after this…
              </button>
              <button
                type="button"
                data-testid="workbench-remove-btn"
                style={{
                  height: 28,
                  padding: "0 10px",
                  borderRadius: 5,
                  background: "transparent",
                  border: "1px solid var(--border-2)",
                  color: "var(--mismatch)",
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  width: "100%",
                }}
              >
                ✕ Remove from project
              </button>
            </div>
          </div>
        </div>

        {/* Viewer pane */}
        <div
          data-testid="source-viewer"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-1)",
            borderRadius: 8,
            display: "flex",
            flexDirection: "column",
            minHeight: 400,
            overflow: "hidden",
          }}
        >
          {/* Viewer toolbar */}
          <div
            style={{
              padding: "8px 14px",
              borderBottom: "1px solid var(--border-1)",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span
              style={{
                fontSize: 11.5,
                color: "var(--ink-1)",
                fontWeight: 600,
                fontFamily: "var(--mono-font)",
              }}
            >
              {file.stem}
            </span>
          </div>

          {/* Viewer body */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              padding: 18,
              background: "var(--bg-page)",
              display: "flex",
              justifyContent: "center",
              alignItems: "flex-start",
              overflow: "auto",
            }}
          >
            <FakeThumb
              tone={file.tone ?? "light"}
              {...(file.state === "blank" ? { kind: "blank" } : {})}
              width={320}
              height={420}
            />
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// SourceTool — main tool component (registered in TOOL_REGISTRY)
// ---------------------------------------------------------------------------

/**
 * Service adapter: wraps the mock server for use with sourceToolMachine.
 */
function createSourceToolServices(): SourceToolServices {
  const mockServer = createMockServer();
  return {
    confirmSelection: (projectId, files) =>
      mockServer.confirmSourceSelection(
        projectId,
        files.map((f) => ({ idx: f.idx, state: f.state })),
      ),
    saveAsDefault: (projectId, stageId, draft) =>
      mockServer.saveStageSettingsAsDefault(projectId, stageId, draft),
    revertSettings: (projectId, stageId) =>
      mockServer.revertStageSettings(projectId, stageId),
    resetSettings: (projectId, stageId) =>
      mockServer.resetStageSettings(projectId, stageId),
  };
}

/** The tabs available on the source stage. */
const SOURCE_TABS = [
  { value: "overview", label: "Overview" },
  { value: "files", label: "Files" },
  { value: "workbench", label: "Page workbench" },
  { value: "settings", label: "Stage settings" },
] as const;

type SourceTab = (typeof SOURCE_TABS)[number]["value"];

/**
 * SourceTool — registered in TOOL_REGISTRY under `"source"`.
 *
 * Receives `{ stageId, runnerRef }` from the F4 toolSlot contract.
 * The `runnerRef` is not used for source (no stageRunner for source).
 */
export function SourceTool({ stageId }: ToolSlotProps): ReactNode {
  // useQueryClient() reserved for TanStack Query integration at I1
  const [activeTab, setActiveTab] = useState<SourceTab>("files");

  const services = useMemo(() => createSourceToolServices(), []);

  const [snapshot, send] = useActor(sourceToolMachine, {
    input: {
      projectId: MOCK_PROJECT_ID,
      stageId,
      services,
    },
  });

  const ctx = snapshot.context;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snap = snapshot as any;

  // Determine sub-states — use `as any` because XState v5 parallel-state match
  // types for nested regions are overly strict with `never` when context has
  // exactOptionalPropertyTypes. The runtime values are correct.
  const isGenerating: boolean = snap.matches({ thumbnails: "generating" });
  const isConfirming: boolean = snap.matches({ files: "confirming" });
  const isConfirmed: boolean = snap.matches({ files: "confirmed" });
  const isInserting: boolean = snap.matches({ files: "inserting" });
  const hasSelection = ctx.selected.length > 0 && !isInserting;

  // Active page for workbench tab
  const firstSelectedIdx = ctx.selected[0] ?? 0;
  const activeFile =
    ctx.files.length > 0
      ? (ctx.files[firstSelectedIdx] ?? ctx.files[0] ?? null)
      : null;

  // Tab rendering
  const renderTab = (): ReactNode => {
    switch (activeTab) {
      case "overview":
        return (
          <SourceOverview
            totals={ctx.totals}
            isGenerating={isGenerating}
            onOpenFiles={() => setActiveTab("files")}
          />
        );

      case "files":
        return (
          <SourceFiles
            files={ctx.files}
            filter={ctx.filter}
            density={ctx.density}
            query={ctx.query}
            selected={ctx.selected}
            totals={ctx.totals}
            isGenerating={isGenerating}
            isConfirming={isConfirming}
            isConfirmed={isConfirmed}
            insertDraft={ctx.insertDraft}
            onSelectFile={(idx) => send({ type: "SELECT_FILE", idx })}
            onClearSelection={() => send({ type: "CLEAR_SELECTION" })}
            onMark={(state) => send({ type: "MARK_AS", state })}
            onRemove={() => send({ type: "REMOVE_FILES" })}
            onFilterChange={(value) => send({ type: "SET_FILTER", value })}
            onDensityChange={(value) => send({ type: "SET_DENSITY", value })}
            onInsertOpen={() =>
              send({
                type: "OPEN_INSERT",
                ...(activeFile?.stem ? { anchorStem: activeFile.stem } : {}),
              })
            }
            onInsertPatch={(patch) => send({ type: "SET_INSERT_FIELD", patch })}
            onInsertConfirm={() => send({ type: "CONFIRM_INSERT" })}
            onInsertCancel={() => send({ type: "CANCEL_INSERT" })}
            onConfirmSelection={() => send({ type: "CONFIRM_SELECTION" })}
          />
        );

      case "workbench":
        return (
          <SourcePageWorkbench
            file={activeFile}
            onRoleChange={(idx, role) => send({ type: "SET_ROLE", idx, role })}
            onApply={() => {
              // Apply & Continue: clear selection, advance tab
              send({ type: "CLEAR_SELECTION" });
              setActiveTab("files");
            }}
            onPrev={() => {
              const firstIdx = ctx.selected[0] ?? 0;
              const prev = ctx.files[firstIdx - 1];
              if (prev) send({ type: "SELECT_FILE", idx: prev.idx });
            }}
            onNext={() => {
              const firstIdx = ctx.selected[0] ?? 0;
              const next = ctx.files[firstIdx + 1];
              if (next) send({ type: "SELECT_FILE", idx: next.idx });
            }}
          />
        );

      case "settings":
        return (
          <SourceStepSettings
            settingsState={ctx.settingsState}
            draft={ctx._settingsDraft}
            presetId={ctx._presetId}
            onSaveAsDefault={() => send({ type: "SAVE_AS_DEFAULT" })}
            onRevert={() => send({ type: "REVERT" })}
            onResetToDefault={() => send({ type: "RESET_TO_DEFAULT" })}
          />
        );

      default:
        return null;
    }
  };

  return (
    <div
      data-testid="source-tool"
      data-stage-id={stageId}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        background: "var(--bg-page)",
      }}
    >
      {/* Tab strip */}
      <div
        style={{
          padding: "0 28px",
          borderBottom: "1px solid var(--border-1)",
          background: "var(--bg-surface)",
        }}
      >
        <Seg
          data-testid="source-tabs"
          items={SOURCE_TABS.map((t) => ({ value: t.value, label: t.label }))}
          value={activeTab}
          onChange={(v) => setActiveTab(v as SourceTab)}
        />
      </div>

      {/* Tab content */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {renderTab()}
      </div>

      {/* Error strip */}
      {ctx.error && (
        <div
          data-testid="source-error-strip"
          style={{
            padding: "8px 28px",
            background:
              "color-mix(in oklab, var(--mismatch) 10%, var(--bg-surface))",
            borderTop:
              "1px solid color-mix(in oklab, var(--mismatch) 40%, var(--border-1))",
            fontSize: 12,
            color: "var(--mismatch)",
          }}
        >
          {ctx.error}
        </div>
      )}

      {/* Selection status hint */}
      {hasSelection && (
        <div
          style={{
            padding: "4px 28px",
            background: "var(--bg-raised)",
            borderTop: "1px solid var(--border-1)",
            fontSize: 11,
            color: "var(--ink-4)",
            fontFamily: "var(--mono-font)",
          }}
        >
          {ctx.selected.length} selected — click "Page workbench" to inspect
          this page
        </div>
      )}
    </div>
  );
}
