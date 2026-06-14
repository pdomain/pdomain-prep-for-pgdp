/**
 * SourceToolFiles — Files tab sub-components for the Source stage tool.
 *
 * Exports:
 *   InsertDivider   — hover affordance between thumb cards (Src-D)
 *   SourceBanner    — generating / selection status banner
 *   FileToolbar     — filter chips + density selector + insert button
 *   BulkBar         — sticky multi-select action bar
 *   InsertDialog    — insert-page dialog overlay
 *   SourceFiles     — main Files tab artboard
 *
 * Split from SourceTool.tsx (Fix 4: file too large).
 * No behavior change — only code organisation.
 *
 * @see docs/plans/design_handoff_pgdp_app/final/source/source.jsx
 * @see src/pages/pipeline/tools/SourceTool.tsx — main entry point
 */

import { useState, useRef } from "react";
import type { ReactNode, RefObject, KeyboardEvent } from "react";
import type {
  FileRow,
  FileState,
  FileFilter,
  FileDensity,
  InsertDraft,
  FileTotals,
} from "@/machines/tools/source";
import { RealThumb } from "./source/RealThumb";

// ---------------------------------------------------------------------------
// Helpers (used only within this module)
// ---------------------------------------------------------------------------

/** Filter the file list per the active filter chip. */
export function applyFilter(files: FileRow[], filter: FileFilter): FileRow[] {
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

export function applySearch(files: FileRow[], query: string): FileRow[] {
  if (!query) return files;
  const q = query.toLowerCase();
  return files.filter((f) => f.stem.toLowerCase().includes(q));
}

// Tone → CSS token mapping
const STATE_DOT_COLOR: Record<string, string> = {
  page: "var(--exact)",
  cover: "var(--gt)",
  back: "var(--gt)",
  blank: "var(--ink-3)",
  duplicate: "var(--mismatch)",
  inserted: "var(--accent)",
  skipped: "var(--ink-4)",
};

const STATE_LABEL: Record<string, string> = {
  page: "page",
  cover: "cover",
  back: "back",
  blank: "blank",
  duplicate: "dup",
  inserted: "insert",
  skipped: "skipped",
};

const KIND_LABEL: Record<string, string> = {
  missing: "Missing",
  blank: "Blank",
  errata: "Errata",
  manual: "Manual",
};

// ---------------------------------------------------------------------------
// InsertDivider — Src-D artboard affordance
// ---------------------------------------------------------------------------

/**
 * Thin "+ Insert page here" affordance between two thumb cards.
 * Visible on hover (controlled via `visible` prop).
 *
 * From final/source/source.jsx InsertDivider — appears between every pair
 * of thumb cards when the user hovers the gap area.
 *
 * @see docs/plans/design_handoff_pgdp_app/final/source/source.jsx
 */
export function InsertDivider({
  visible = false,
  onClick,
}: {
  visible?: boolean;
  onClick?: () => void;
}): ReactNode {
  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      data-testid="insert-divider"
      onClick={onClick}
      style={{
        width: 18,
        alignSelf: "stretch",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        position: "relative",
        opacity: visible ? 1 : 0,
        transition: "opacity .12s",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: 2,
          height: "70%",
          borderRadius: 99,
          background: "color-mix(in oklab, var(--accent) 60%, transparent)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 18,
          height: 18,
          borderRadius: 99,
          background: "var(--accent)",
          color: "var(--accent-ink)",
          display: "grid",
          placeItems: "center",
          fontSize: 14,
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        +
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton / placeholder thumbs
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

// ---------------------------------------------------------------------------
// ThumbCard
// ---------------------------------------------------------------------------

/** Single thumb card in the grid. */
export function ThumbCard({
  file,
  density,
  selected,
  hoveredForInsert,
  onClick,
  onRangeClick,
}: {
  file: FileRow;
  density: FileDensity;
  selected: boolean;
  /** Whether the gap AFTER this card is currently hovered (shows InsertDivider). */
  hoveredForInsert?: boolean;
  onClick: () => void;
  /** Called with this card's idx when user shift+clicks for range select. */
  onRangeClick?: (idx: number) => void;
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
    <div
      role="checkbox"
      aria-checked={selected}
      tabIndex={0}
      data-testid={`thumb-card-${file.idx}`}
      onClick={(e) => {
        if (e.shiftKey && onRangeClick) {
          onRangeClick(file.idx);
        } else {
          onClick();
        }
      }}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
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
        outline: "none",
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
          <RealThumb
            {...(file.thumbnailKey ? { thumbnailKey: file.thumbnailKey } : {})}
            alt={file.stem}
            tone={file.tone ?? "light"}
            kind={file.state === "blank" ? "blank" : "page"}
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
      {/* Hover affordance indicator (for insert-divider visibility). Not shown inline here;
          the parent grid renders InsertDivider between cards using hoveredForInsert. */}
      {hoveredForInsert === true && null /* handled by parent */}
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
  query,
  searchInputRef,
  onFilterChange,
  onDensityChange,
  onQueryChange,
  onInsertOpen,
}: {
  filter: FileFilter;
  density: FileDensity;
  totals: FileTotals | null;
  query?: string;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  onFilterChange: (f: FileFilter) => void;
  onDensityChange: (d: FileDensity) => void;
  onQueryChange?: (q: string) => void;
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

      {/* Search input — wired to SET_QUERY; "/" shortcut focuses via searchInputRef */}
      {onQueryChange && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            ref={searchInputRef}
            data-testid="source-search-input"
            type="text"
            value={query ?? ""}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search files…"
            aria-label="Search files"
            style={{
              height: 28,
              width: 160,
              padding: "0 8px 0 28px",
              borderRadius: 6,
              border: "1px solid var(--border-2)",
              background: "var(--bg-page)",
              fontSize: 12,
              color: "var(--ink-1)",
              fontFamily: "inherit",
              boxSizing: "border-box",
              backgroundImage:
                "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cpath d='m21 21-4.35-4.35'/%3E%3C/svg%3E\")",
              backgroundRepeat: "no-repeat",
              backgroundPosition: "8px center",
              backgroundSize: "14px",
            }}
          />
        </div>
      )}

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
  { id: "cover", name: "Cover", dot: "var(--gt)" },
  { id: "back", name: "Back", dot: "var(--gt)" },
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
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                color: "var(--ink-4)",
                marginBottom: 6,
              }}
            >
              Position
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {(["before", "after"] as const).map((pos) => (
                <button
                  key={pos}
                  type="button"
                  data-testid={`insert-position-${pos}`}
                  onClick={() => onPatch({ position: pos })}
                  style={{
                    height: 28,
                    padding: "0 12px",
                    borderRadius: 5,
                    border:
                      draft.position === pos
                        ? "1.5px solid var(--accent)"
                        : "1px solid var(--border-2)",
                    background:
                      draft.position === pos
                        ? "color-mix(in oklab, var(--accent) 8%, var(--bg-surface))"
                        : "var(--bg-surface)",
                    color:
                      draft.position === pos ? "var(--accent)" : "var(--ink-2)",
                    fontSize: 12,
                    fontWeight: draft.position === pos ? 600 : 500,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {pos === "before" ? "Before anchor" : "After anchor"}
                </button>
              ))}
            </div>
          </div>

          {/* Kind */}
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
              Type
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {INSERT_KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  data-testid={`insert-kind-${k.id}`}
                  onClick={() => onPatch({ kind: k.id as InsertDraft["kind"] })}
                  style={{
                    height: 28,
                    padding: "0 12px",
                    borderRadius: 5,
                    border:
                      draft.kind === k.id
                        ? "1.5px solid var(--accent)"
                        : "1px solid var(--border-2)",
                    background:
                      draft.kind === k.id
                        ? "color-mix(in oklab, var(--accent) 8%, var(--bg-surface))"
                        : "var(--bg-surface)",
                    color:
                      draft.kind === k.id ? "var(--accent)" : "var(--ink-2)",
                    fontSize: 12,
                    fontWeight: draft.kind === k.id ? 600 : 500,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {k.name}
                </button>
              ))}
            </div>
          </div>

          {/* Note */}
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
              Note
            </div>
            <input
              data-testid="insert-note-field"
              type="text"
              value={draft.note}
              onChange={(e) => onPatch({ note: e.target.value })}
              placeholder="Optional note…"
              style={{
                width: "100%",
                height: 32,
                padding: "0 10px",
                borderRadius: 6,
                border: "1px solid var(--border-2)",
                background: "var(--bg-page)",
                fontSize: 12.5,
                color: "var(--ink-1)",
                boxSizing: "border-box",
                fontFamily: "inherit",
              }}
            />
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 18px",
            borderTop: "1px solid var(--border-1)",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button
            type="button"
            data-testid="insert-cancel-btn"
            onClick={onCancel}
            style={{
              height: 32,
              padding: "0 14px",
              borderRadius: 6,
              background: "transparent",
              border: "1px solid var(--border-2)",
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
              height: 32,
              padding: "0 16px",
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
            Insert page
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
  searchInputRef,
  onSelectFile,
  onRangeSelect,
  onClearSelection,
  onMark,
  onRemove,
  onFilterChange,
  onDensityChange,
  onQueryChange,
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
  searchInputRef?: RefObject<HTMLInputElement | null>;
  onSelectFile: (idx: number) => void;
  /** Called when user shift+clicks a card — dispatch SELECT_RANGE with anchor=last selected. */
  onRangeSelect?: (anchorIdx: number, endIdx: number) => void;
  onClearSelection: () => void;
  onMark: (state: FileState) => void;
  onRemove: () => void;
  onFilterChange: (f: FileFilter) => void;
  onDensityChange: (d: FileDensity) => void;
  onQueryChange?: (q: string) => void;
  onInsertOpen: (anchorStem?: string) => void;
  onInsertPatch: (patch: Partial<InsertDraft>) => void;
  onInsertConfirm: () => void;
  onInsertCancel: () => void;
  onConfirmSelection: () => void;
}): ReactNode {
  const [hoveredDividerIdx, setHoveredDividerIdx] = useState<number | null>(
    null,
  );
  // Track last-selected idx for shift+click range anchor
  const lastSelectedRef = useRef<number | null>(null);

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
        query={query}
        {...(searchInputRef !== undefined && { searchInputRef })}
        onFilterChange={onFilterChange}
        onDensityChange={onDensityChange}
        {...(onQueryChange !== undefined && { onQueryChange })}
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
        {displayFiles.map((file, i) => (
          <div
            key={`${file.idx}-${file.stem}`}
            style={{ display: "flex", alignItems: "flex-start" }}
            onMouseEnter={() => setHoveredDividerIdx(i)}
            onMouseLeave={() =>
              setHoveredDividerIdx((prev) => (prev === i ? null : prev))
            }
          >
            <ThumbCard
              file={file}
              density={density}
              selected={selected.includes(file.idx)}
              onClick={() => {
                lastSelectedRef.current = file.idx;
                onSelectFile(file.idx);
              }}
              {...(onRangeSelect !== undefined && {
                onRangeClick: (endIdx: number) => {
                  const anchorIdx = lastSelectedRef.current ?? endIdx;
                  lastSelectedRef.current = endIdx;
                  onRangeSelect(anchorIdx, endIdx);
                },
              })}
            />
            {/* InsertDivider between cards (Src-D) — visible on hover */}
            {i < displayFiles.length - 1 && (
              <InsertDivider
                visible={hoveredDividerIdx === i}
                onClick={() => onInsertOpen(file.stem)}
              />
            )}
          </div>
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
