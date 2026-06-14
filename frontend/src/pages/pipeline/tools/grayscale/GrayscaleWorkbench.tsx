/**
 * GrayscaleWorkbench — Page workbench tab for the Grayscale tool.
 *
 * Two-pane layout:
 *   Left  340px — StageControlsDrawer (mode chooser, advanced params, state banner)
 *   Right flex  — PageViewer (before/after split + page strip)
 *
 * Design reference: grayscale.jsx §GrayscaleStepSettings + StageControlsLeft
 *                   + PageViewer + PageRender
 *
 * OPEN QUESTION: Re-run page, Apply & Run, Save-as-default currently call
 * the machine but no backend wiring exists at F5. They are rendered faithfully;
 * backend integration deferred to I1. Marked [OPEN:I1] in comments.
 */

import { useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "@pdomain/pdomain-ui/icons";
import type {
  GrayscaleBackend,
  GrayscaleDetected,
  GrayscaleDraft,
  GrayscaleMode,
  GrayscalePage,
} from "./types";
import {
  BackendChip,
  GhostButton,
  GrayscaleBody,
  GrayscaleSubhead,
  ModePill,
  PrimaryButton,
  VDivider,
} from "./GrayscaleShared";
import {
  estimateSecPerPage,
  fmtSec,
  fmtProjectTotal,
  grayscaleArtifactUrl,
  sourceArtifactUrl,
} from "./helpers";

// ---------------------------------------------------------------------------
// Advanced params — collapsible stacked sliders
// ---------------------------------------------------------------------------

function AdvancedParamsStacked({
  draft,
  onPatch,
}: {
  draft: GrayscaleDraft | null;
  onPatch: (patch: Partial<GrayscaleDraft>) => void;
}): ReactNode {
  const [open, setOpen] = useState(true);

  const samplerRadius = draft?.samplerRadius ?? 3;
  const gamma = draft?.gamma ?? 1.1;
  const outMin = draft?.outputRangeMin ?? 12;
  const outMax = draft?.outputRangeMax ?? 248;

  return (
    <div
      style={{
        borderRadius: 7,
        border: "1px solid var(--border-1)",
        background: "var(--bg-surface)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          padding: "9px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderBottom: open ? "1px solid var(--border-1)" : "none",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span
          style={{
            color: "var(--ink-3)",
            transform: open ? "rotate(90deg)" : "none",
            display: "inline-block",
            transition: "transform 0.15s",
          }}
        >
          <Icon name="chevR" size={10} />
        </span>
        <span
          style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ink-1)" }}
        >
          Advanced · perceptual
        </span>
        <span style={{ flex: 1 }} />
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPatch({
              samplerRadius: 3,
              gamma: 1.1,
              outputRangeMin: 12,
              outputRangeMax: 248,
            });
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "3px 8px",
            height: 24,
            borderRadius: 5,
            border: "1px solid var(--border-2)",
            background: "transparent",
            color: "var(--ink-2)",
            fontSize: 11.5,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Reset
        </button>
      </button>
      {open && (
        <>
          {/* Sampler radius */}
          <div
            style={{
              padding: "8px 12px",
              borderTop: "1px solid var(--border-1)",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
              }}
            >
              <span style={{ fontSize: 11.5, color: "var(--ink-2)" }}>
                Sampler radius
              </span>
              <span
                className="mono"
                style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-1)" }}
              >
                {samplerRadius}px
              </span>
            </div>
            <SliderTrack
              value={samplerRadius}
              min={1}
              max={9}
              onChange={(v) => onPatch({ samplerRadius: v })}
            />
          </div>
          {/* Gamma */}
          <div
            style={{
              padding: "8px 12px",
              borderTop: "1px solid var(--border-1)",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
              }}
            >
              <span style={{ fontSize: 11.5, color: "var(--ink-2)" }}>
                Gamma
              </span>
              <span
                className="mono"
                style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-1)" }}
              >
                {gamma.toFixed(2)}
              </span>
            </div>
            <SliderTrack
              value={gamma}
              min={0.5}
              max={2.0}
              step={0.05}
              onChange={(v) => onPatch({ gamma: v })}
            />
          </div>
          {/* Output range */}
          <div
            style={{
              padding: "8px 12px",
              borderTop: "1px solid var(--border-1)",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
              }}
            >
              <span style={{ fontSize: 11.5, color: "var(--ink-2)" }}>
                Output range
              </span>
              <span
                className="mono"
                style={{ fontSize: 11, fontWeight: 600, color: "var(--ink-1)" }}
              >
                {outMin} – {outMax}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <SliderTrack
                value={outMin}
                min={0}
                max={128}
                onChange={(v) => onPatch({ outputRangeMin: v })}
              />
              <SliderTrack
                value={outMax}
                min={128}
                max={255}
                onChange={(v) => onPatch({ outputRangeMax: v })}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Custom slider track (native range styled via accent color)
function SliderTrack({
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}): ReactNode {
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return (
    <div style={{ flex: 1, position: "relative", height: 14 }}>
      {/* Track */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: 0,
          right: 0,
          height: 3,
          transform: "translateY(-50%)",
          borderRadius: 99,
          background: "var(--border-2)",
        }}
      >
        {/* Fill */}
        <div
          style={{
            position: "absolute",
            inset: "0 auto 0 0",
            width: `${pct * 100}%`,
            background: "var(--accent)",
            borderRadius: 99,
          }}
        />
      </div>
      {/* Thumb */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: `calc(${pct * 100}% - 5px)`,
          width: 10,
          height: 10,
          borderRadius: 99,
          background: "var(--accent)",
          transform: "translateY(-50%)",
          boxShadow: "0 1px 3px rgba(0,0,0,.25)",
          pointerEvents: "none",
        }}
      />
      {/* Invisible native input on top */}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          opacity: 0,
          cursor: "pointer",
          margin: 0,
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact mode row (for the drawer)
// ---------------------------------------------------------------------------

function ModeRowCompact({
  kind,
  selected,
  backend,
  onClick,
}: {
  kind: GrayscaleMode;
  selected: boolean;
  backend: GrayscaleBackend;
  onClick: () => void;
}): ReactNode {
  const isPerc = kind === "perceptual";
  const accent = isPerc ? "var(--accent)" : "var(--exact)";
  const sec = estimateSecPerPage(backend);
  const time = isPerc ? fmtSec(sec) : "<1s";
  const timeTone = isPerc
    ? backend === "gpu"
      ? "var(--fuzzy)"
      : "var(--mismatch)"
    : "var(--exact)";

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`mode-row-${kind}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
      style={{
        padding: "10px 12px",
        borderRadius: 7,
        border: `1.5px solid ${selected ? accent : "var(--border-1)"}`,
        background: selected
          ? `color-mix(in oklab, ${accent} 6%, var(--bg-surface))`
          : "var(--bg-surface)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        cursor: "pointer",
      }}
    >
      {/* Radio dot */}
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: 99,
          border: `1.5px solid ${selected ? accent : "var(--border-2)"}`,
          background: selected ? accent : "transparent",
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
        }}
      >
        {selected && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 99,
              background: "#fff",
            }}
          />
        )}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span
            style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-1)" }}
          >
            {isPerc ? "Perceptual" : "Standard"}
          </span>
          {isPerc && (
            <span
              className="mono"
              style={{
                padding: "0 5px",
                borderRadius: 3,
                background:
                  "color-mix(in oklab, var(--accent) 12%, transparent)",
                color: "var(--accent)",
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: ".04em",
              }}
            >
              RECOMMENDED
            </span>
          )}
        </div>
        <div
          style={{
            marginTop: 2,
            fontSize: 10.5,
            color: "var(--ink-3)",
            lineHeight: 1.4,
          }}
        >
          {isPerc
            ? "Neighbourhood-sampled · preserves local contrast"
            : "Luma-weighted · fastest"}
        </div>
      </div>
      <span
        className="mono"
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: timeTone,
          flexShrink: 0,
        }}
      >
        est. {time}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage controls drawer (left 340px)
// ---------------------------------------------------------------------------

type SettingsState = "default" | "modified" | "preset";

function StageControlsDrawer({
  backend,
  draft,
  detected,
  settingsState,
  onSetMode: _onSetMode,
  onPatch: _onPatch,
  onRevert,
  onSaveDefault,
  onRedetect,
  pageCount,
}: {
  backend: GrayscaleBackend;
  draft: GrayscaleDraft | null;
  detected: GrayscaleDetected | null;
  settingsState: SettingsState;
  onSetMode: (m: GrayscaleMode) => void;
  onPatch: (patch: Partial<GrayscaleDraft>) => void;
  onRevert: () => void;
  onSaveDefault: () => void;
  onRedetect: () => void;
  pageCount: number;
}): ReactNode {
  const sec = estimateSecPerPage(backend);
  const currentMode = draft?.mode ?? "perceptual";

  const bannerTone =
    settingsState === "modified"
      ? "var(--fuzzy)"
      : settingsState === "preset"
        ? "var(--ocr)"
        : "var(--exact)";
  const bannerLabel =
    settingsState === "modified"
      ? "Modified vs project default"
      : settingsState === "preset"
        ? "Using a preset"
        : "Using project default";

  return (
    <div
      data-testid="stage-controls-drawer"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-1)",
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid var(--border-1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
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
            }}
          >
            Stage controls
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 3,
            }}
          >
            <span
              className="mono"
              style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-1)" }}
            >
              grayscale
            </span>
            {settingsState === "modified" && (
              <span
                style={{
                  padding: "1px 6px",
                  borderRadius: 4,
                  background:
                    "color-mix(in oklab, var(--fuzzy) 14%, transparent)",
                  color: "var(--fuzzy)",
                  fontFamily: "var(--mono-font, monospace)",
                  fontSize: 9.5,
                  fontWeight: 600,
                  letterSpacing: ".04em",
                }}
              >
                DIRTY
              </span>
            )}
          </div>
        </div>
        <BackendChip backend={backend} compact />
      </div>

      {/* Scrollable body */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {/* Inheritance banner */}
        <div
          style={{
            padding: "8px 10px",
            borderRadius: 6,
            border: `1px solid color-mix(in oklab, ${bannerTone} 40%, var(--border-1))`,
            background: `color-mix(in oklab, ${bannerTone} 7%, var(--bg-surface))`,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ color: bannerTone, flexShrink: 0, display: "flex" }}>
            {settingsState === "modified" ? (
              <Icon name="alert" size={12} />
            ) : settingsState === "preset" ? (
              <Icon name="sparkles" size={12} />
            ) : (
              <Icon name="check" size={10} />
            )}
          </span>
          <span
            style={{
              fontSize: 11.5,
              color: "var(--ink-1)",
              fontWeight: 500,
              flex: 1,
              minWidth: 0,
            }}
          >
            {bannerLabel}
          </span>
          {settingsState !== "default" && (
            <GhostButton onClick={onRevert} data-testid="revert-btn">
              Revert
            </GhostButton>
          )}
        </div>

        {/* Auto-detect mini banner */}
        <div
          data-testid="autodetect-mini-banner"
          style={{
            padding: "10px 12px",
            borderRadius: 7,
            background:
              "color-mix(in oklab, var(--accent) 6%, var(--bg-surface))",
            border:
              "1px solid color-mix(in oklab, var(--accent) 30%, var(--border-1))",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: "var(--accent)",
            }}
          >
            <Icon name="sparkles" size={12} /> Auto-detected
          </div>
          <div
            style={{
              marginTop: 5,
              fontSize: 11.5,
              color: "var(--ink-2)",
              lineHeight: 1.5,
            }}
          >
            Picked{" "}
            <span style={{ color: "var(--ink-1)", fontWeight: 600 }}>
              {detected?.mode ?? "—"}
            </span>{" "}
            from a sample of 8 pages.{" "}
            {detected?.why && (
              <span className="mono" style={{ color: "var(--ink-3)" }}>
                {detected.why}
              </span>
            )}
          </div>
          <div
            style={{
              marginTop: 8,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: 10.5,
            }}
          >
            <span className="mono" style={{ color: "var(--ink-3)" }}>
              {fmtSec(sec)}/page · ~{fmtProjectTotal(sec, pageCount)} total
            </span>
            <GhostButton onClick={onRedetect} data-testid="redetect-mini-btn">
              Re-detect
            </GhostButton>
          </div>
        </div>

        {/* CPU fallback warning */}
        {backend === "cpu" && (
          <div
            data-testid="cpu-warning"
            style={{
              padding: "9px 10px",
              borderRadius: 6,
              background:
                "color-mix(in oklab, var(--mismatch) 9%, var(--bg-surface))",
              border:
                "1px solid color-mix(in oklab, var(--mismatch) 35%, var(--border-1))",
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              fontSize: 11,
              color: "var(--ink-2)",
              lineHeight: 1.45,
            }}
          >
            <span
              style={{
                color: "var(--mismatch)",
                marginTop: 1,
                flexShrink: 0,
                display: "flex",
              }}
            >
              <Icon name="alert" size={12} />
            </span>
            <div>
              <span style={{ color: "var(--ink-1)", fontWeight: 600 }}>
                No CUDA device.
              </span>{" "}
              Perceptual on CPU ·{" "}
              <span className="mono">{fmtSec(sec)}/page</span>.
            </div>
          </div>
        )}

        {/* Wave 2 — mode + params (disabled until perceptual primitive ships) */}
        <div style={{ position: "relative" }}>
          <div style={{ pointerEvents: "none", opacity: 0.45 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div
                style={{
                  fontSize: 9.5,
                  fontWeight: 700,
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                  color: "var(--ink-4)",
                }}
              >
                Grayscale mode
              </div>
              <ModeRowCompact
                kind="standard"
                selected={currentMode === "standard"}
                backend={backend}
                onClick={() => {}}
              />
              <ModeRowCompact
                kind="perceptual"
                selected={currentMode === "perceptual"}
                backend={backend}
                onClick={() => {}}
              />
            </div>
            {currentMode === "perceptual" && (
              <AdvancedParamsStacked draft={draft} onPatch={() => {}} />
            )}
          </div>
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background:
                "color-mix(in oklab, var(--bg-surface) 70%, transparent)",
              borderRadius: 7,
              flexDirection: "column",
              gap: 6,
            }}
          >
            <Icon name="wrench" size={14} color="var(--ink-3)" />
            <span
              style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 500 }}
            >
              Mode tuning coming soon
            </span>
          </div>
        </div>

        {/* Cached note */}
        <div
          style={{
            padding: "7px 10px",
            borderRadius: 6,
            background: "var(--bg-page)",
            border: "1px solid var(--border-1)",
            display: "flex",
            alignItems: "flex-start",
            gap: 7,
            fontSize: 10.5,
            color: "var(--ink-3)",
            lineHeight: 1.45,
          }}
        >
          <span
            style={{
              color: "var(--ink-4)",
              marginTop: 1,
              flexShrink: 0,
              display: "flex",
            }}
          >
            <Icon name="info" size={12} />
          </span>
          <span>
            Output cached per page. Downstream stages re-use the cached tensor —
            you only pay the conversion cost once.
          </span>
        </div>
      </div>

      {/* Sticky footer — save defaults */}
      {settingsState === "modified" && (
        <div
          style={{
            padding: "10px 14px",
            borderTop: "1px solid var(--border-1)",
            background: "var(--bg-surface)",
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
          }}
        >
          <GhostButton onClick={onRevert} data-testid="footer-revert-btn">
            Revert
          </GhostButton>
          <PrimaryButton onClick={onSaveDefault} data-testid="save-default-btn">
            Save as default
          </PrimaryButton>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page viewer (right pane) — before/after split with real images
// ---------------------------------------------------------------------------

type ViewMode = "before" | "split" | "after";

function PageViewerPane({
  projectId,
  cursor,
  pages,
  onPrev,
  onNext,
  onRerunPage,
  backend,
  currentMode,
}: {
  projectId: string;
  cursor: number;
  pages: GrayscalePage[];
  onPrev: () => void;
  onNext: () => void;
  onRerunPage: () => void;
  backend: GrayscaleBackend;
  currentMode: GrayscaleMode;
}): ReactNode {
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const page = pages[cursor];
  const sec = estimateSecPerPage(backend);

  // Artifact URLs keyed on page.idx0 + page.lastRunAt for cache-busting
  const gsUrl = page
    ? grayscaleArtifactUrl(projectId, page.idx0, page.lastRunAt ?? null)
    : null;
  const srcUrl = page ? sourceArtifactUrl(projectId, page.idx0) : null;

  const pageLabel = page?.id ?? String(cursor + 1).padStart(4, "0");
  const total = pages.length;

  // Page strip — show a window of 12 pages centred on cursor
  const stripStart = Math.max(0, Math.min(cursor - 4, total - 12));
  const stripPages = pages.slice(stripStart, stripStart + 12);

  return (
    <div
      data-testid="page-viewer"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-1)",
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
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
        {/* Page id + position */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            className="mono"
            style={{ fontSize: 11.5, color: "var(--ink-1)", fontWeight: 600 }}
          >
            p{pageLabel}
          </span>
          <span style={{ fontSize: 11, color: "var(--ink-4)" }}>·</span>
          <span
            className="mono"
            style={{ fontSize: 11, color: "var(--ink-3)" }}
          >
            {cursor + 1} / {total || "—"}
          </span>
        </div>
        <VDivider />

        {/* View-mode toggle */}
        <div
          data-testid="view-mode-toggle"
          style={{
            display: "inline-flex",
            padding: 2,
            gap: 2,
            background: "var(--bg-page)",
            border: "1px solid var(--border-1)",
            borderRadius: 6,
          }}
        >
          {(["before", "split", "after"] as const).map((v) => (
            <button
              key={v}
              data-testid={`view-mode-${v}`}
              onClick={() => setViewMode(v)}
              style={{
                padding: "4px 10px",
                borderRadius: 4,
                border:
                  viewMode === v
                    ? "1px solid var(--border-2)"
                    : "1px solid transparent",
                background:
                  viewMode === v ? "var(--bg-surface)" : "transparent",
                color: viewMode === v ? "var(--ink-1)" : "var(--ink-3)",
                fontSize: 11,
                fontWeight: viewMode === v ? 600 : 500,
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {v === "split" ? "Split" : v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>

        <span style={{ flex: 1 }} />

        <span
          className="mono"
          style={{ fontSize: 10.5, color: "var(--ink-3)" }}
        >
          this page ·{" "}
          <span style={{ color: "var(--ink-3)" }}>est. {fmtSec(sec)}</span> ·{" "}
          {page ? "cached" : "not run"}
        </span>
        <VDivider />
        <GhostButton onClick={onRerunPage} data-testid="rerun-page-btn">
          Re-run page
        </GhostButton>
      </div>

      {/* Image area */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: 18,
          background: "var(--bg-page)",
          display: "grid",
          gridTemplateColumns: viewMode === "split" ? "1fr 8px 1fr" : "1fr",
          gap: 0,
          overflow: "hidden",
        }}
      >
        {/* Before pane */}
        {(viewMode === "before" || viewMode === "split") && (
          <div style={{ position: "relative", overflow: "hidden" }}>
            {srcUrl ? (
              <img
                data-testid="before-image"
                src={srcUrl}
                alt="source (before grayscale)"
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            ) : (
              <SyntheticPage isColor />
            )}
            <ImageLabel text="BEFORE · source" />
          </div>
        )}

        {/* Split divider — drag not yet implemented */}
        {viewMode === "split" && (
          <div
            style={{
              background: "var(--border-2)",
              position: "relative",
            }}
          />
        )}

        {/* After pane */}
        {(viewMode === "after" || viewMode === "split") && (
          <div style={{ position: "relative", overflow: "hidden" }}>
            {gsUrl ? (
              <img
                data-testid="after-image"
                src={gsUrl}
                alt="grayscale output (after)"
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            ) : (
              <SyntheticPage isColor={false} mode={currentMode} />
            )}
            <ImageLabel text={`AFTER · ${currentMode}`} />
            {!gsUrl && (
              <span
                style={{
                  position: "absolute",
                  top: 8,
                  right: 8,
                  padding: "2px 8px",
                  borderRadius: 4,
                  background: "color-mix(in oklab, var(--accent) 90%, black)",
                  color: "#fff",
                  fontFamily: "var(--mono-font, monospace)",
                  fontSize: 10,
                  fontWeight: 600,
                }}
              >
                preview
              </span>
            )}
          </div>
        )}
      </div>

      {/* Page strip */}
      <div
        data-testid="page-strip"
        style={{
          padding: "10px 14px",
          borderTop: "1px solid var(--border-1)",
          background: "var(--bg-surface)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          overflow: "hidden",
        }}
      >
        <GhostButton onClick={onPrev} data-testid="prev-page-strip-btn">
          <Icon name="chevL" size={14} />
        </GhostButton>
        <div
          style={{
            flex: 1,
            display: "flex",
            gap: 5,
            overflow: "hidden",
          }}
        >
          {stripPages.map((p, i) => {
            const pageIdx = stripStart + i;
            const isActive = pageIdx === cursor;
            const tone = typeof p.tone === "number" ? p.tone : 0.82;
            return (
              <div
                key={p.id}
                title={`p${p.id}`}
                data-testid={`strip-page-${p.id}`}
                style={{
                  flexShrink: 0,
                  width: 36,
                  height: 48,
                  borderRadius: 3,
                  background: `oklch(${tone} 0 0)`,
                  boxShadow: "inset 0 0 0 1px rgba(40,40,40,0.15)",
                  outline: isActive ? "2px solid var(--accent)" : "none",
                  outlineOffset: 1,
                  position: "relative",
                  cursor: "pointer",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: "14% 14%",
                    backgroundImage:
                      "repeating-linear-gradient(to bottom, oklch(0.32 0 0) 0 1px, transparent 1px 4px)",
                    opacity: 0.6,
                  }}
                />
                {/* Mode dot */}
                <ModePill mode={p.mode} />
              </div>
            );
          })}
        </div>
        <GhostButton onClick={onNext} data-testid="next-page-strip-btn">
          <Icon name="chevR" size={14} />
        </GhostButton>
      </div>
    </div>
  );
}

// Floating image label (BEFORE / AFTER)
function ImageLabel({ text }: { text: string }): ReactNode {
  return (
    <span
      style={{
        position: "absolute",
        top: 8,
        left: 8,
        padding: "2px 8px",
        borderRadius: 4,
        background: "rgba(0,0,0,0.5)",
        color: "#fff",
        fontFamily: "var(--mono-font, monospace)",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: ".04em",
        textTransform: "uppercase",
      }}
    >
      {text}
    </span>
  );
}

// Synthetic page render fallback (when no real artifact yet)
function SyntheticPage({
  isColor = false,
  mode = "perceptual",
}: {
  isColor?: boolean;
  mode?: GrayscaleMode;
}): ReactNode {
  const paper = isColor ? "oklch(0.88 0.04 75)" : "oklch(0.82 0 0)";
  const ink = isColor ? "oklch(0.30 0.04 60)" : "oklch(0.27 0 0)";
  return (
    <div
      data-testid="synthetic-page"
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
        background: paper,
        boxShadow: "inset 0 0 0 1px rgba(40,40,40,0.12)",
      }}
    >
      {/* Content */}
      <div
        style={{
          position: "absolute",
          inset: "8% 12%",
          display: "flex",
          flexDirection: "column",
          gap: "2%",
        }}
      >
        <div
          style={{
            height: 18,
            width: "78%",
            background: ink,
            opacity: 0.8,
            borderRadius: 1,
          }}
        />
        <div
          style={{
            height: 12,
            width: "52%",
            background: ink,
            opacity: 0.55,
            marginBottom: 8,
          }}
        />
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            style={{
              height: mode === "perceptual" ? 3 : 3.5,
              width: `${88 - (i % 4) * 7}%`,
              background: ink,
              opacity: mode === "perceptual" ? 0.7 : 0.55,
            }}
          />
        ))}
        <div
          style={{
            marginTop: 10,
            height: 70,
            background: ink,
            opacity: 0.15,
            borderRadius: 2,
          }}
        />
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            style={{
              height: 3,
              width: `${85 - (i % 3) * 8}%`,
              background: ink,
              opacity: 0.65,
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page workbench tab — assembles drawer + viewer
// ---------------------------------------------------------------------------

export function GrayscaleWorkbenchTab({
  projectId,
  pages,
  cursor,
  backend,
  draft,
  detected,
  settingsState,
  onPrev,
  onNext,
  onSetMode,
  onPatch,
  onRevert,
  onSaveDefault,
  onRedetect,
  onApplyRun,
  onRerunPage,
}: {
  projectId: string;
  pages: GrayscalePage[];
  cursor: number;
  backend: GrayscaleBackend;
  draft: GrayscaleDraft | null;
  detected: GrayscaleDetected | null;
  settingsState: SettingsState;
  onPrev: () => void;
  onNext: () => void;
  onSetMode: (m: GrayscaleMode) => void;
  onPatch: (patch: Partial<GrayscaleDraft>) => void;
  onRevert: () => void;
  onSaveDefault: () => void;
  onRedetect: () => void;
  onApplyRun: () => void;
  onRerunPage: () => void;
}): ReactNode {
  const page = pages[cursor];
  const currentMode = draft?.mode ?? page?.mode ?? "perceptual";
  const pageLabel = page?.id ?? String(cursor + 1).padStart(4, "0");

  return (
    <>
      <GrayscaleSubhead
        title="Page workbench · Grayscale"
        sub={
          <>
            Per-page workbench. Tune the mode and sampler for{" "}
            <span className="mono">p{pageLabel}</span>, then{" "}
            <span style={{ color: "var(--ink-1)", fontWeight: 600 }}>
              Apply &amp; Run
            </span>{" "}
            commits the change to the cache.
          </>
        }
        right={
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <GhostButton onClick={onPrev} data-testid="prev-page-btn">
              <Icon name="chevL" size={14} /> Prev page
            </GhostButton>
            <GhostButton onClick={onNext} data-testid="next-page-btn">
              Next page <Icon name="chevR" size={14} />
            </GhostButton>
            <VDivider />
            <PrimaryButton onClick={onApplyRun} data-testid="apply-run-btn">
              Apply &amp; Run →
            </PrimaryButton>
          </div>
        }
      />
      <GrayscaleBody gap={0}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "340px 1fr",
            gap: 14,
            flex: 1,
            minHeight: 0,
          }}
        >
          <StageControlsDrawer
            backend={backend}
            draft={draft}
            detected={detected}
            settingsState={settingsState}
            onSetMode={onSetMode}
            onPatch={onPatch}
            onRevert={onRevert}
            onSaveDefault={onSaveDefault}
            onRedetect={onRedetect}
            pageCount={pages.length}
          />
          <PageViewerPane
            projectId={projectId}
            cursor={cursor}
            pages={pages}
            onPrev={onPrev}
            onNext={onNext}
            onRerunPage={onRerunPage}
            backend={backend}
            currentMode={currentMode}
          />
        </div>
      </GrayscaleBody>
    </>
  );
}
