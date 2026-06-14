/**
 * GrayscalePages — Pages tab for the Grayscale tool.
 *
 * Renders a grid of page thumbnails using real images from the API:
 *   - Grayscale stage thumbnail when the stage is clean (OQ-4 fix).
 *   - Falls back to the ingest color thumbnail on 404 (stage not yet run).
 *   - Falls back to a neutral placeholder only if both fetches fail.
 * Each card shows page id + ModePill.
 *
 * Design reference: grayscale.jsx § GrayscalePages + GrayThumb + ModePill
 */

import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { GrayscaleBackend, GrayscalePage } from "./types";
import {
  BackendChip,
  GrayscaleBody,
  GrayscaleSubhead,
  ModePill,
  VDivider,
} from "./GrayscaleShared";
import {
  estimateSecPerPage,
  fmtSec,
  grayscaleStageThumbnailUrl,
  sourceArtifactUrl,
} from "./helpers";

// ---------------------------------------------------------------------------
// Page thumbnail — real image with graceful fallback (OQ-4)
// ---------------------------------------------------------------------------

/**
 * GrayThumb renders a real page thumbnail.
 *
 * Strategy:
 *   1. Try the grayscale stage thumbnail (small PNG pre-generated at stage-write time).
 *      URL: /api/data/projects/{id}/pages/{idx0}/stages/grayscale/thumbnail
 *      Returns 404 when the stage has not run or is not clean — handled via
 *      the img onError handler.
 *   2. On 404 (or any load error), fall back to the ingest color thumbnail.
 *      URL: /api/data/projects/{id}/pages/{idx0}/thumbnail
 *      This is always available after ingest and is a color JPEG.
 *   3. If both fail (network error, page never ingested), show a neutral
 *      grey placeholder div so no broken-image icon leaks through.
 */
function GrayThumb({
  page,
  active = false,
  projectId,
  idx0,
}: {
  page: GrayscalePage;
  active?: boolean;
  projectId: string;
  idx0: number;
}): ReactNode {
  // Primary: grayscale stage thumbnail (exists only when stage is clean).
  // Secondary: ingest color thumbnail (always present after ingest).
  const grayThumbUrl = grayscaleStageThumbnailUrl(
    projectId,
    idx0,
    page.lastRunAt ?? null,
  );
  const colorThumbUrl = sourceArtifactUrl(projectId, idx0);

  // Track which URL we're showing and whether both have failed.
  const [src, setSrc] = useState<string>(grayThumbUrl);
  const [failed, setFailed] = useState(false);

  // Reset to the grayscale thumbnail URL when lastRunAt changes (stage re-ran).
  useEffect(() => {
    setSrc(grayThumbUrl);
    setFailed(false);
  }, [grayThumbUrl]);

  const boxShadow = active
    ? "0 0 0 2px var(--accent), inset 0 0 0 1px rgba(40,40,40,0.15)"
    : "inset 0 0 0 1px rgba(40,40,40,0.15)";

  const containerStyle: CSSProperties = {
    width: "100%",
    aspectRatio: "3/4",
    borderRadius: 3,
    position: "relative",
    overflow: "hidden",
    boxShadow,
    cursor: "pointer",
    background: "var(--bg-page)",
  };

  if (failed) {
    // Both URLs failed — show a minimal neutral placeholder (no synthetic gradient).
    return (
      <div
        data-testid={`gs-page-thumb-${page.id}`}
        style={{ ...containerStyle, background: "oklch(0.86 0 0)" }}
      />
    );
  }

  return (
    <div data-testid={`gs-page-thumb-${page.id}`} style={containerStyle}>
      <img
        src={src}
        alt={`page ${page.id} thumbnail`}
        loading="lazy"
        onError={() => {
          if (src === grayThumbUrl) {
            // Grayscale thumbnail not available — fall back to ingest color thumbnail.
            setSrc(colorThumbUrl);
          } else {
            // Both failed — show placeholder.
            setFailed(true);
          }
        }}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
        }}
      />
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
              {filtered.map((page) => {
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
                      idx0={page.idx0}
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
