/**
 * GrayscaleSettings — Stage settings tab for the Grayscale tool.
 *
 * Full-width two-up mode chooser + advanced params + auto-detect banner.
 * Design reference: grayscale.jsx §GrayscaleStepSettings (overview panel)
 *                   + ModeCard + AdvancedParams + AutoDetectBanner
 */

import { useState } from "react";
import type { ReactNode } from "react";
import type {
  GrayscaleBackend,
  GrayscaleDetected,
  GrayscaleDraft,
  GrayscaleMode,
} from "./types";
import {
  BackendChip,
  GhostButton,
  GrayscaleBody,
  GrayscaleSubhead,
} from "./GrayscaleShared";
import { estimateSecPerPage, fmtSec, fmtProjectTotal } from "./helpers";

// ---------------------------------------------------------------------------
// Full-width ModeCard
// ---------------------------------------------------------------------------

function ModeCard({
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
      data-testid={`mode-card-${kind}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
      style={{
        flex: 1,
        padding: "14px 16px",
        borderRadius: 8,
        border: `1.5px solid ${selected ? accent : "var(--border-1)"}`,
        background: selected
          ? `color-mix(in oklab, ${accent} 6%, var(--bg-surface))`
          : "var(--bg-surface)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        position: "relative",
        cursor: "pointer",
      }}
    >
      {/* Check badge */}
      {selected && (
        <span
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            width: 18,
            height: 18,
            borderRadius: 99,
            background: accent,
            color: "#fff",
            display: "grid",
            placeItems: "center",
            fontSize: 10,
            fontWeight: 700,
          }}
        >
          ✓
        </span>
      )}

      {/* Title row */}
      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span
            style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-1)" }}
          >
            {isPerc ? "Perceptual" : "Standard"}
          </span>
          {isPerc && (
            <span
              className="mono"
              style={{
                padding: "1px 6px",
                borderRadius: 4,
                background:
                  "color-mix(in oklab, var(--accent) 12%, transparent)",
                color: "var(--accent)",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: ".04em",
              }}
            >
              recommended
            </span>
          )}
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 12,
            color: "var(--ink-3)",
            lineHeight: 1.5,
          }}
        >
          {isPerc
            ? "Neighbourhood-sampled. Preserves local contrast — gives downstream stages a much cleaner signal on newsprint and faded books."
            : "Luma-weighted (0.299R + 0.587G + 0.114B). The fastest path. Fine for clean modern scans."}
        </div>
      </div>

      {/* Algorithm + cost */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
          padding: "8px 10px",
          borderRadius: 6,
          background: "var(--bg-page)",
          border: "1px solid var(--border-1)",
        }}
      >
        <div>
          <div
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--ink-4)",
              textTransform: "uppercase",
              letterSpacing: ".06em",
            }}
          >
            algorithm
          </div>
          <div
            className="mono"
            style={{
              marginTop: 3,
              fontSize: 11.5,
              color: "var(--ink-1)",
              fontWeight: 600,
            }}
          >
            {isPerc ? "np_uint8_color_to_gray" : "cv2.cvtColor · BGR2GRAY"}
          </div>
        </div>
        <div>
          <div
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--ink-4)",
              textTransform: "uppercase",
              letterSpacing: ".06em",
            }}
          >
            ~/page
          </div>
          <div
            className="mono"
            style={{
              marginTop: 3,
              fontSize: 11.5,
              fontWeight: 600,
              color: timeTone,
            }}
          >
            {time}
          </div>
        </div>
      </div>

      {/* Preview histogram strip */}
      <div
        style={{
          height: 38,
          borderRadius: 4,
          background: isPerc
            ? "linear-gradient(90deg, oklch(0.92 0 0) 0%, oklch(0.85 0 0) 20%, oklch(0.78 0 0) 35%, oklch(0.66 0 0) 50%, oklch(0.55 0 0) 70%, oklch(0.40 0 0) 100%)"
            : "linear-gradient(90deg, oklch(0.92 0 0) 0%, oklch(0.84 0 0) 30%, oklch(0.66 0 0) 60%, oklch(0.46 0 0) 100%)",
          border: "1px solid var(--border-1)",
          position: "relative",
        }}
      >
        <span
          className="mono"
          style={{
            position: "absolute",
            top: 4,
            left: 6,
            fontSize: 9,
            color: "rgba(0,0,0,.4)",
            letterSpacing: ".04em",
            textTransform: "uppercase",
          }}
        >
          preview · histogram
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Advanced params (full-width three-column)
// ---------------------------------------------------------------------------

function AdvancedParamsFull({
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

  const params = [
    {
      label: "Sampler radius",
      sub: "Size of neighbourhood (px) sampled per output pixel. Larger = smoother, more cost.",
      value: samplerRadius,
      min: 1,
      max: 9,
      step: 1,
      display: `${samplerRadius}px`,
      onChange: (v: number) => onPatch({ samplerRadius: Math.round(v) }),
    },
    {
      label: "Gamma",
      sub: "Output gamma curve. <1 brightens shadows, >1 deepens them.",
      value: gamma,
      min: 0.5,
      max: 2.0,
      step: 0.05,
      display: gamma.toFixed(2),
      onChange: (v: number) => onPatch({ gamma: v }),
    },
    {
      label: "Output range",
      sub: "Linear stretch applied after sampling. Compress the tails for cleaner thresholding.",
      value: outMin,
      min: 0,
      max: 255,
      step: 1,
      display: `${outMin} – ${outMax}`,
      onChange: (v: number) => onPatch({ outputRangeMin: Math.round(v) }),
    },
  ];

  return (
    <div
      style={{
        borderRadius: 8,
        border: "1px solid var(--border-1)",
        background: "var(--bg-surface)",
        overflow: "hidden",
      }}
    >
      <div
        role="button"
        tabIndex={0}
        style={{
          padding: "10px 14px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderBottom: open ? "1px solid var(--border-1)" : "none",
          cursor: "pointer",
        }}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setOpen((v) => !v);
        }}
      >
        <span
          style={{
            fontSize: 10,
            color: "var(--ink-3)",
            transform: open ? "rotate(90deg)" : "none",
            display: "inline-block",
          }}
        >
          ▶
        </span>
        <span
          style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-1)" }}
        >
          Advanced · perceptual params
        </span>
        <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
          sampler radius, gamma, output range — defaults usually fine
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
          Reset to defaults
        </button>
      </div>
      {open && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 0,
          }}
        >
          {params.map((row, i) => {
            const pct = Math.max(
              0,
              Math.min(1, (row.value - row.min) / (row.max - row.min)),
            );
            return (
              <div
                key={row.label}
                style={{
                  padding: "12px 14px",
                  borderLeft: i === 0 ? "none" : "1px solid var(--border-1)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--ink-1)",
                    }}
                  >
                    {row.label}
                  </div>
                  <div
                    style={{
                      marginTop: 2,
                      fontSize: 11,
                      color: "var(--ink-3)",
                      lineHeight: 1.4,
                    }}
                  >
                    {row.sub}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      flex: 1,
                      height: 4,
                      borderRadius: 99,
                      background: "var(--border-2)",
                      position: "relative",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        inset: "0 auto 0 0",
                        width: `${pct * 100}%`,
                        background: "var(--accent)",
                        borderRadius: 99,
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        top: -4,
                        left: `calc(${pct * 100}% - 6px)`,
                        width: 12,
                        height: 12,
                        borderRadius: 99,
                        background: "var(--accent)",
                        boxShadow: "0 1px 3px rgba(0,0,0,.2)",
                      }}
                    />
                    <input
                      type="range"
                      min={row.min}
                      max={row.max}
                      step={row.step}
                      value={row.value}
                      onChange={(e) => row.onChange(parseFloat(e.target.value))}
                      style={{
                        position: "absolute",
                        inset: "-4px 0",
                        width: "100%",
                        opacity: 0,
                        cursor: "pointer",
                        margin: 0,
                      }}
                    />
                  </div>
                  <span
                    className="mono"
                    style={{
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: "var(--ink-1)",
                      minWidth: 64,
                      textAlign: "right",
                    }}
                  >
                    {row.display}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage settings tab
// ---------------------------------------------------------------------------

export function GrayscaleSettingsTab({
  backend,
  draft,
  detected: _detected,
  onSetMode,
  onPatch,
  onRedetect,
  pageCount,
}: {
  backend: GrayscaleBackend;
  draft: GrayscaleDraft | null;
  detected: GrayscaleDetected | null;
  onSetMode: (m: GrayscaleMode) => void;
  onPatch: (patch: Partial<GrayscaleDraft>) => void;
  onRedetect: () => void;
  pageCount: number;
}): ReactNode {
  const sec = estimateSecPerPage(backend);
  const currentMode = draft?.mode ?? "perceptual";

  return (
    <>
      <GrayscaleSubhead
        title="Stage settings · Grayscale"
        sub="Configure the grayscale mode and sampler used across the whole project. Auto-detect picks the best profile from 8 sample pages."
        right={<BackendChip backend={backend} />}
      />
      <GrayscaleBody>
        {/* Auto-detect full banner */}
        <div
          data-testid="settings-autodetect-banner"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 14,
            padding: "12px 14px",
            borderRadius: 8,
            background:
              "color-mix(in oklab, var(--accent) 6%, var(--bg-surface))",
            border:
              "1px solid color-mix(in oklab, var(--accent) 35%, var(--border-1))",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
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
                fontSize: 14,
              }}
            >
              ✦
            </div>
            <div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--ink-1)",
                }}
              >
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
                  perceptual
                </span>{" "}
                from a sample of 8 pages ·{" "}
                <span
                  className="mono"
                  style={{ color: "var(--ink-2)", fontSize: 11 }}
                >
                  newsprint · low contrast · low DPI
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
            <GhostButton
              onClick={onRedetect}
              data-testid="settings-redetect-btn"
            >
              Re-detect
            </GhostButton>
          </div>
        </div>

        {/* Mode cards — side by side */}
        <div data-testid="mode-cards" style={{ display: "flex", gap: 12 }}>
          <ModeCard
            kind="standard"
            selected={currentMode === "standard"}
            backend={backend}
            onClick={() => onSetMode("standard")}
          />
          <ModeCard
            kind="perceptual"
            selected={currentMode === "perceptual"}
            backend={backend}
            onClick={() => onSetMode("perceptual")}
          />
        </div>

        {/* Advanced params (perceptual only) */}
        {currentMode === "perceptual" && (
          <AdvancedParamsFull draft={draft} onPatch={onPatch} />
        )}
      </GrayscaleBody>
    </>
  );
}
