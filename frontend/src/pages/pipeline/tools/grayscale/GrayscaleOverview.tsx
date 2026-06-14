/**
 * GrayscaleOverview — Overview tab for the Grayscale tool.
 *
 * Renders:
 *   - Stat row: pages converted / perceptual / standard / avg/page / total
 *   - Auto-detect banner
 *   - "What lands downstream" cards (crop · threshold · ocr)
 *
 * Design reference: grayscale.jsx § GrayscaleOverview + AutoDetectBanner
 */

import type { ReactNode } from "react";
import type {
  GrayscaleBackend,
  GrayscaleDetected,
  GrayscalePage,
} from "./types";
import {
  BackendChip,
  GrayscaleBody,
  GrayscaleSubhead,
  StatTile,
  GhostButton,
} from "./GrayscaleShared";
import { estimateSecPerPage, fmtSec, fmtProjectTotal } from "./helpers";

// ---------------------------------------------------------------------------
// AutoDetectBanner
// ---------------------------------------------------------------------------

function AutoDetectBanner({
  detected,
  backend,
  pageCount,
  onRedetect,
}: {
  detected: GrayscaleDetected | null;
  backend: GrayscaleBackend;
  pageCount: number;
  onRedetect?: (() => void) | undefined;
}): ReactNode {
  const sec = estimateSecPerPage(backend);
  if (detected == null) return null;
  return (
    <div
      data-testid="autodetect-banner-result"
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 14,
        padding: "12px 14px",
        borderRadius: 8,
        background: "color-mix(in oklab, var(--accent) 6%, var(--bg-surface))",
        border:
          "1px solid color-mix(in oklab, var(--accent) 35%, var(--border-1))",
        alignItems: "center",
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        {/* Icon tile */}
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 7,
            background:
              "color-mix(in oklab, var(--accent) 16%, var(--bg-surface))",
            color: "var(--accent)",
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
            fontSize: 15,
          }}
        >
          ✦
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-1)" }}>
            Auto-detected source profile
          </div>
          <div
            style={{
              marginTop: 3,
              fontSize: 12,
              color: "var(--ink-3)",
              lineHeight: 1.5,
            }}
          >
            Picked{" "}
            <span style={{ color: "var(--ink-1)", fontWeight: 600 }}>
              {detected.mode}
            </span>{" "}
            from a sample of 8 pages ·{" "}
            <span
              className="mono"
              style={{ color: "var(--ink-2)", fontSize: 11 }}
            >
              {detected.why}
            </span>
          </div>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          justifyContent: "flex-end",
        }}
      >
        <BackendChip backend={backend} />
        <div style={{ textAlign: "right" }}>
          <div
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--ink-4)",
              letterSpacing: ".04em",
              textTransform: "uppercase",
            }}
          >
            project · {pageCount} pages
          </div>
          <div
            className="mono"
            style={{
              fontSize: 13,
              color: "var(--ink-1)",
              fontWeight: 600,
              marginTop: 2,
            }}
          >
            {fmtSec(sec)}/page · ~{fmtProjectTotal(sec, pageCount)} total
          </div>
        </div>
        <GhostButton onClick={onRedetect} data-testid="redetect-btn">
          Re-detect
        </GhostButton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Downstream impact cards
// ---------------------------------------------------------------------------

const DOWNSTREAM_CARDS = [
  {
    stage: "crop",
    via: "edge detection on grayscale",
    detail:
      "Perceptual output gives the auto-crop a much cleaner gradient signal on faded covers.",
  },
  {
    stage: "threshold",
    via: "Sauvola / adaptive",
    detail:
      "Local-window thresholders feed off this stage directly. Bad input here = speckle everywhere.",
  },
  {
    stage: "ocr",
    via: "preprocessed page",
    detail:
      "Tesseract gets the grayscale tensor; cleaner gradients = fewer scannos.",
  },
];

function DownstreamCards(): ReactNode {
  return (
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
          marginBottom: 10,
        }}
      >
        What lands downstream
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 10,
        }}
      >
        {DOWNSTREAM_CARDS.map((s) => (
          <div
            key={s.stage}
            style={{
              background: "var(--bg-page)",
              border: "1px solid var(--border-1)",
              borderRadius: 7,
              padding: "10px 12px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                className="mono"
                style={{
                  padding: "2px 7px",
                  borderRadius: 4,
                  background: "var(--bg-raised)",
                  border: "1px solid var(--border-1)",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--ink-1)",
                }}
              >
                {s.stage}
              </span>
              <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                {s.via}
              </span>
            </div>
            <div
              style={{
                fontSize: 11.5,
                color: "var(--ink-3)",
                lineHeight: 1.5,
              }}
            >
              {s.detail}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview tab
// ---------------------------------------------------------------------------

export function GrayscaleOverviewTab({
  pages,
  detected,
  backend,
  onRedetect,
}: {
  pages: GrayscalePage[];
  detected: GrayscaleDetected | null;
  backend: GrayscaleBackend;
  onRedetect?: (() => void) | undefined;
}): ReactNode {
  const sec = estimateSecPerPage(backend);
  const perceptualCount = pages.filter((p) => p.mode === "perceptual").length;
  const standardCount = pages.filter((p) => p.mode === "standard").length;
  const total = pages.length;

  return (
    <>
      <GrayscaleSubhead
        title="Perceptual grayscale · overview"
        sub="Converts every cropped scan to grayscale. Auto-picks perceptual for newsprint and faded books, standard for clean modern scans. Runs once per page; cached for every downstream stage."
        right={<BackendChip backend={backend} />}
      />
      <GrayscaleBody>
        {/* Stat row */}
        <div style={{ display: "flex", gap: 12 }}>
          <StatTile
            value={String(total || 232)}
            label="pages converted"
            tone="var(--exact)"
          />
          <StatTile
            value={String(perceptualCount || 198)}
            label="perceptual mode"
            tone="var(--accent)"
          />
          <StatTile
            value={String(standardCount || 34)}
            label="standard mode"
            tone="var(--ink-2)"
          />
          <StatTile value={fmtSec(sec)} label="avg / page" />
          <StatTile
            value={fmtProjectTotal(sec, total || 232)}
            label="project total"
          />
        </div>

        {/* Auto-detect banner */}
        <AutoDetectBanner
          detected={
            detected ?? {
              mode: "perceptual",
              why: "newsprint · low contrast · low DPI",
            }
          }
          backend={backend}
          pageCount={total || 232}
          onRedetect={onRedetect}
        />

        {/* Downstream cards */}
        <DownstreamCards />
      </GrayscaleBody>
    </>
  );
}
