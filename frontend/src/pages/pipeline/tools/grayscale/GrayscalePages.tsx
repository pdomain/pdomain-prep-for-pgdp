/**
 * GrayscalePages — Pages tab for the Grayscale tool.
 *
 * Renders a grid of page thumbnails (either real images via the artifact
 * endpoint or synthetic grey thumbnails when no artifact is available).
 * Each card shows page id + ModePill.
 *
 * Design reference: grayscale.jsx § GrayscalePages + GrayThumb + ModePill
 */

import type { ReactNode } from "react";
import type { GrayscaleBackend, GrayscalePage } from "./types";
import {
  BackendChip,
  GrayscaleBody,
  GrayscaleSubhead,
  ModePill,
  VDivider,
} from "./GrayscaleShared";
import { estimateSecPerPage, fmtSec } from "./helpers";

// ---------------------------------------------------------------------------
// Synthetic page thumbnail (when no artifact available yet)
// ---------------------------------------------------------------------------

function GrayThumb({
  page,
  active = false,
  projectId: _projectId,
  idx0: _idx0,
}: {
  page: GrayscalePage;
  active?: boolean;
  projectId: string;
  idx0: number;
}): ReactNode {
  // GrayscalePage doesn't carry artifact_key at F5 — always use synthetic gradient.
  // Wire to real artifact endpoint at I1 (OQ-4).
  const tone = typeof page.tone === "number" ? page.tone : 0.86;
  const inkTone = Math.max(0.2, tone - 0.55);
  return (
    <div
      data-testid={`gs-page-thumb-${page.id}`}
      style={{
        width: "100%",
        aspectRatio: "3/4",
        borderRadius: 3,
        position: "relative",
        overflow: "hidden",
        background: `oklch(${tone} 0 0)`,
        boxShadow: active
          ? "0 0 0 2px var(--accent), inset 0 0 0 1px rgba(40,40,40,0.15)"
          : "inset 0 0 0 1px rgba(40,40,40,0.15)",
        cursor: "pointer",
      }}
    >
      {/* Paper grain */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `radial-gradient(ellipse at top, oklch(${tone + 0.04} 0 0) 0%, transparent 50%), radial-gradient(ellipse at bottom right, oklch(${tone - 0.04} 0 0) 0%, transparent 60%)`,
        }}
      />
      {/* Ink lines */}
      <div
        style={{
          position: "absolute",
          inset: "14% 14%",
          backgroundImage: `repeating-linear-gradient(to bottom, oklch(${inkTone} 0 0) 0 1.2px, transparent 1.2px 6px)`,
          opacity: 0.65,
        }}
      />
      {/* Page number stripe */}
      <div
        style={{
          position: "absolute",
          left: "40%",
          right: "40%",
          bottom: "7%",
          height: 2,
          background: `oklch(${inkTone} 0 0)`,
          opacity: 0.55,
        }}
      />
      {/* Label */}
      <span
        className="mono"
        style={{
          position: "absolute",
          top: 4,
          right: 4,
          fontSize: 8,
          color: "oklch(0.32 0 0)",
        }}
      >
        p{page.id}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter chip
// ---------------------------------------------------------------------------

function FilterChip({
  id,
  label,
  count,
  active,
  onClick,
}: {
  id: string;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}): ReactNode {
  return (
    <span
      role="button"
      tabIndex={0}
      data-testid={`gs-filter-${id}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "4px 9px",
        height: 24,
        borderRadius: 6,
        background: active
          ? "color-mix(in oklab, var(--accent) 14%, transparent)"
          : "transparent",
        border: active
          ? "1px solid color-mix(in oklab, var(--accent) 45%, var(--border-1))"
          : "1px solid var(--border-1)",
        color: active ? "var(--accent)" : "var(--ink-2)",
        fontSize: 11.5,
        fontWeight: active ? 600 : 500,
        cursor: "pointer",
      }}
    >
      {label}
      <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-4)" }}>
        {count}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Pages tab
// ---------------------------------------------------------------------------

type PageFilter = "all" | "perceptual" | "standard";

export function GrayscalePagesTab({
  pages,
  filter,
  onSetFilter,
  cursor,
  onSelectPage,
  backend,
  projectId,
}: {
  pages: GrayscalePage[];
  filter: PageFilter;
  onSetFilter: (f: PageFilter) => void;
  cursor: number;
  onSelectPage: (idx: number) => void;
  backend: GrayscaleBackend;
  projectId: string;
}): ReactNode {
  const sec = estimateSecPerPage(backend);
  const perceptualCount = pages.filter((p) => p.mode === "perceptual").length;
  const standardCount = pages.filter((p) => p.mode === "standard").length;

  const filtered =
    filter === "all" ? pages : pages.filter((p) => p.mode === filter);

  return (
    <>
      <GrayscaleSubhead
        title="Pages · grayscale output"
        sub="Every page converted. Auto-picked the cheaper standard mode where it could; perceptual where the source needed it."
        right={
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <BackendChip backend={backend} />
            <VDivider />
            <FilterChip
              id="all"
              label="All"
              count={pages.length}
              active={filter === "all"}
              onClick={() => onSetFilter("all")}
            />
            <FilterChip
              id="perceptual"
              label="Perceptual"
              count={perceptualCount}
              active={filter === "perceptual"}
              onClick={() => onSetFilter("perceptual")}
            />
            <FilterChip
              id="standard"
              label="Standard"
              count={standardCount}
              active={filter === "standard"}
              onClick={() => onSetFilter("standard")}
            />
          </div>
        }
      />
      <GrayscaleBody>
        {pages.length === 0 ? (
          // No pages yet — show placeholder grid
          <div
            data-testid="gs-pages-empty"
            style={{
              padding: 24,
              textAlign: "center",
              color: "var(--ink-4)",
              fontSize: 12,
            }}
          >
            No pages converted yet.{" "}
            <span className="mono">{fmtSec(sec)}/page</span> on{" "}
            {backend === "gpu" ? "GPU" : "CPU"}.
          </div>
        ) : (
          <div
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border-1)",
              borderRadius: 8,
              padding: 18,
              flex: 1,
              minHeight: 0,
              overflow: "auto",
            }}
          >
            <div
              data-testid="grayscale-page-grid"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                gap: 14,
              }}
            >
              {filtered.map((page, i) => {
                const pageIdx = pages.indexOf(page);
                const active = pageIdx === cursor;
                return (
                  <div
                    key={page.id}
                    role="button"
                    tabIndex={0}
                    data-testid={`gs-page-card-${page.id}`}
                    onClick={() => onSelectPage(pageIdx)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ")
                        onSelectPage(pageIdx);
                    }}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      alignItems: "center",
                      cursor: "pointer",
                    }}
                  >
                    <GrayThumb
                      page={page}
                      active={active}
                      projectId={projectId}
                      idx0={i}
                    />
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <span
                        className="mono"
                        style={{ fontSize: 10.5, color: "var(--ink-3)" }}
                      >
                        p{page.id}
                      </span>
                      <ModePill mode={page.mode} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </GrayscaleBody>
    </>
  );
}
