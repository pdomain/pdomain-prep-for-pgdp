/**
 * OcrTool.tsx — React surface for the OCR stage tool.
 *
 * Registered in TOOL_REGISTRY as `ocr`. Renders three tabs:
 * - **Overview**   — stats projection from machine context (derived, never stored)
 * - **Pages**      — confidence-tinted page grid + inline Recognition panel
 * - **Settings**   — OCR engine / backend / model settings (minimal at F5; wired at I1)
 *
 * At F5: mock-only wiring (PAGE_PUSH events from a simulated run).
 * At I1: real SSE actor feeds PAGE_PUSH events; confirmStage hits the backend;
 * settings tab wires to stageSettings machine pattern from F5.1 stageSettings.ts.
 *
 * @see src/machines/tools/ocrTool.ts — machine + types
 * @see docs/plans/design_handoff_pgdp_app/final/ocr/ — design canvas
 */

import type { ReactNode } from "react";
import { useActor } from "@xstate/react";
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import type { ToolSlotProps } from "../toolSlot";
import {
  ocrToolMachine,
  type OcrPageRow,
  type OcrTotals,
  type OcrToken,
} from "@/machines/tools/ocrTool";
import { buildRealOcrToolServices } from "@/services/tools/ocrTool";

// ---------------------------------------------------------------------------
// Confidence helpers
// ---------------------------------------------------------------------------

function confTone(c: number): string {
  if (c >= 0.95) return "var(--exact)";
  if (c >= 0.85) return "var(--ocr)";
  if (c >= 0.7) return "var(--fuzzy)";
  return "var(--mismatch)";
}

function confLabel(c: number): string {
  return `${Math.round(c * 100)}%`;
}

// ---------------------------------------------------------------------------
// OCR page thumbnail
// ---------------------------------------------------------------------------

function OcrPageThumb({ row }: { row: OcrPageRow }): ReactNode {
  const tone = row.illust ? "var(--ink-4)" : confTone(row.meanConf ?? 1);
  const isRunning = row.state === "running";

  return (
    <div
      data-testid="ocr-page-thumb"
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
          data-testid="ocr-thumb-skeleton"
          style={{
            position: "absolute",
            inset: 0,
            background: "var(--bg-raised)",
            animation: "none",
          }}
        />
      ) : row.illust ? (
        <div
          style={{
            position: "absolute",
            inset: "16%",
            background: "#111",
            opacity: 0.13,
            borderRadius: 2,
          }}
        />
      ) : (
        <>
          {/* Schematic text lines */}
          <div
            style={{
              position: "absolute",
              inset: "15% 16% 16% 16%",
              backgroundImage:
                "repeating-linear-gradient(to bottom, oklch(0.16 0 0) 0 1.5px, transparent 1.5px 6px)",
              opacity: 0.85,
            }}
          />
          {/* Low-conf word highlights */}
          {(row.lowConf ?? 0) > 5 ? (
            <>
              <span
                style={{
                  position: "absolute",
                  top: "28%",
                  left: "20%",
                  width: "25%",
                  height: 5,
                  background: `color-mix(in oklab, ${confTone(0.65)} 38%, transparent)`,
                  borderRadius: 1,
                }}
              />
              <span
                style={{
                  position: "absolute",
                  top: "44%",
                  left: "40%",
                  width: "18%",
                  height: 5,
                  background: `color-mix(in oklab, ${confTone(0.6)} 38%, transparent)`,
                  borderRadius: 1,
                }}
              />
            </>
          ) : null}
        </>
      )}

      {/* Confidence corner ribbon */}
      {!isRunning && !row.illust ? (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 0,
            height: 0,
            borderStyle: "solid",
            borderWidth: "10px 10px 0 0",
            borderColor: `${tone} transparent transparent transparent`,
            opacity: 0.85,
          }}
        />
      ) : null}

      {/* State indicator */}
      {row.state === "reviewed" ? (
        <div
          style={{
            position: "absolute",
            top: 4,
            right: 4,
            fontSize: 8,
            fontFamily: "var(--mono-font)",
            fontWeight: 700,
            padding: "1px 4px",
            borderRadius: 3,
            background: "color-mix(in oklab, var(--ocr) 85%, black)",
            color: "#fff",
          }}
        >
          rv
        </div>
      ) : row.state === "flagged" ? (
        <div
          style={{
            position: "absolute",
            top: 4,
            right: 4,
            fontSize: 8,
            fontFamily: "var(--mono-font)",
            fontWeight: 700,
            padding: "1px 4px",
            borderRadius: 3,
            background:
              "color-mix(in oklab, var(--fuzzy) 18%, rgba(12,12,16,0.78))",
            color: "var(--fuzzy)",
          }}
        >
          flag
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OCR page card
// ---------------------------------------------------------------------------

function OcrPageCard({
  row,
  density,
  isExpanded,
  onClick,
}: {
  row: OcrPageRow;
  density: "S" | "M" | "L";
  isExpanded: boolean;
  onClick: () => void;
}): ReactNode {
  return (
    <div
      data-testid="ocr-page-card"
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
        border: `1.5px solid ${isExpanded ? "var(--ocr)" : "var(--border-1)"}`,
        background: isExpanded
          ? "color-mix(in oklab, var(--ocr) 6%, var(--bg-surface))"
          : "transparent",
        cursor: "pointer",
      }}
    >
      <OcrPageThumb row={row} />
      <div
        style={{
          marginTop: 4,
          fontSize: density === "S" ? 9.5 : 11,
          fontFamily: "var(--mono-font, monospace)",
          color: "var(--ink-3)",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {row.prefix}
        </span>
        {!row.illust && density !== "S" ? (
          <span
            style={{
              color: confTone(row.meanConf ?? 1),
              flexShrink: 0,
            }}
          >
            {confLabel(row.meanConf ?? 1)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Banner (recognising / reviewing)
// ---------------------------------------------------------------------------

function OcrBanner({
  state,
  totals,
}: {
  state: "recognising" | "reviewing" | "other";
  totals: OcrTotals | null;
}): ReactNode {
  if (state === "recognising" && totals) {
    const pct = Math.round(
      totals.total > 0 ? (totals.done / totals.total) * 100 : 0,
    );
    return (
      <div
        data-testid="ocr-banner-recognising"
        style={{
          padding: "12px 14px",
          borderRadius: 8,
          border:
            "1px solid color-mix(in oklab, var(--ocr) 38%, var(--border-1))",
          background: "color-mix(in oklab, var(--ocr) 7%, var(--bg-surface))",
          display: "flex",
          alignItems: "center",
          gap: 12,
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
            display: "inline-block",
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-1)" }}>
            Recognising text…{" "}
            <span
              style={{
                fontFamily: "var(--mono-font)",
                fontSize: 11.5,
                color: "var(--ink-3)",
                fontWeight: 500,
              }}
            >
              {totals.done} / {totals.total}
            </span>
          </div>
          <div
            style={{
              marginTop: 6,
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
                transition: "width 0.3s ease",
              }}
            />
          </div>
        </div>
        <span
          style={{
            fontFamily: "var(--mono-font)",
            fontSize: 16,
            fontWeight: 600,
            color: "var(--ocr)",
          }}
        >
          {pct}%
        </span>
      </div>
    );
  }

  if (!totals) return null;

  const flagged = totals.flagged;
  const tone = flagged > 0 ? "var(--fuzzy)" : "var(--exact)";

  return (
    <div
      data-testid="ocr-banner-review"
      style={{
        padding: "12px 14px",
        borderRadius: 8,
        border: `1px solid color-mix(in oklab, ${tone} 40%, var(--border-1))`,
        background: `color-mix(in oklab, ${tone} 7%, var(--bg-surface))`,
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-1)" }}>
          {totals.words} words · mean{" "}
          <span style={{ color: confTone(totals.meanConf) }}>
            {confLabel(totals.meanConf)}
          </span>
          {flagged > 0 ? (
            <>
              {" "}
              ·{" "}
              <span style={{ color: "var(--fuzzy)" }}>
                {flagged} pages flagged
              </span>
            </>
          ) : (
            " · all clean"
          )}
        </div>
        {flagged > 0 ? (
          <div style={{ marginTop: 3, fontSize: 11.5, color: "var(--ink-3)" }}>
            {totals.lowConfWords} low-score words. Open the Recognition tab to
            check them.
          </div>
        ) : (
          <div style={{ marginTop: 3, fontSize: 11.5, color: "var(--ink-3)" }}>
            Every page recognised. Confirm to advance to Page order.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recognition panel (one page, token list)
// ---------------------------------------------------------------------------

function RecognitionPanel({
  row,
  tokens,
  onAcceptToken,
  onAcceptPage,
  onNextFlagged,
  onClose,
}: {
  row: OcrPageRow;
  tokens: OcrToken[];
  onAcceptToken: (tokenId: string) => void;
  onAcceptPage: () => void;
  onNextFlagged: () => void;
  onClose: () => void;
}): ReactNode {
  return (
    <div
      data-testid="ocr-recognition-panel"
      data-idx={row.idx}
      style={{
        marginTop: 12,
        padding: "14px 16px",
        border: "1px solid var(--ocr)",
        borderRadius: 8,
        background: "color-mix(in oklab, var(--ocr) 5%, var(--bg-surface))",
        display: "grid",
        gridTemplateColumns: "1fr 280px",
        gap: 14,
      }}
    >
      {/* Left: page image area */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span
            style={{
              fontFamily: "var(--mono-font)",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--ink-1)",
            }}
          >
            {row.prefix}
          </span>
          <span
            style={{
              fontFamily: "var(--mono-font)",
              fontSize: 11,
              color: "var(--ink-3)",
            }}
          >
            mean {confLabel(row.meanConf ?? 1)} · {row.lowConf} low-score
          </span>
          <button
            data-testid="recognition-panel-close"
            onClick={onClose}
            style={{
              padding: "2px 8px",
              border: "1px solid var(--border-2)",
              borderRadius: 4,
              background: "var(--bg-surface)",
              cursor: "pointer",
              fontSize: 11,
              color: "var(--ink-3)",
            }}
          >
            Close
          </button>
        </div>

        {/* Page image placeholder (Konva at I1) */}
        <div
          data-testid="recognition-page-canvas"
          style={{
            flex: 1,
            minHeight: 200,
            background: "var(--bg-sunk)",
            border: "1px solid var(--border-1)",
            borderRadius: 6,
            display: "grid",
            placeItems: "center",
            color: "var(--ink-4)",
            fontSize: 12,
          }}
        >
          Page with word boxes tinted by confidence (I1: Konva)
        </div>
      </div>

      {/* Right: token list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
              padding: "8px 12px",
              borderBottom: "1px solid var(--border-1)",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--ink-1)",
            }}
          >
            Low-score tokens
            <span
              style={{
                marginLeft: 8,
                fontFamily: "var(--mono-font)",
                fontSize: 10,
                color: "var(--ink-4)",
                fontWeight: 400,
              }}
            >
              {tokens.length}
            </span>
          </div>

          {tokens.length === 0 ? (
            <div
              style={{
                padding: "10px 12px",
                fontSize: 11.5,
                color: "var(--ink-4)",
              }}
            >
              No low-score tokens on this page.
            </div>
          ) : (
            tokens.map((t) => (
              <div
                key={t.id}
                data-testid={`token-row-${t.id}`}
                style={{
                  padding: "8px 12px",
                  borderTop: "1px solid var(--border-1)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    width: 30,
                    height: 16,
                    borderRadius: 3,
                    display: "grid",
                    placeItems: "center",
                    fontSize: 9,
                    fontWeight: 700,
                    fontFamily: "var(--mono-font)",
                    color: "#fff",
                    background: confTone(t.conf),
                    flexShrink: 0,
                  }}
                >
                  {Math.round(t.conf * 100)}
                </span>
                <span
                  style={{
                    fontFamily: "Georgia, serif",
                    fontSize: 13,
                    color: "var(--ink-1)",
                  }}
                >
                  {t.word}
                </span>
                <span style={{ fontSize: 11, color: "var(--ink-4)" }}>→</span>
                <span
                  style={{
                    fontFamily: "Georgia, serif",
                    fontSize: 13,
                    color: "var(--exact)",
                    fontWeight: 600,
                    flex: 1,
                  }}
                >
                  {t.suggest}
                </span>
                <button
                  data-testid={`accept-token-${t.id}`}
                  onClick={() => onAcceptToken(t.id)}
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 5,
                    border: "1px solid var(--border-2)",
                    background: "var(--bg-surface)",
                    cursor: "pointer",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 10,
                    color: "var(--ink-3)",
                  }}
                >
                  ✓
                </button>
              </div>
            ))
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <button
            data-testid="recognition-accept-page"
            onClick={onAcceptPage}
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
            Accept page
          </button>
          <button
            data-testid="recognition-next-flagged"
            onClick={onNextFlagged}
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
            Next flagged →
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OCR Overview tab — derived stats projection; never stored in machine context
// ---------------------------------------------------------------------------

function OcrOverviewTab({ totals }: { totals: OcrTotals | null }): ReactNode {
  const t = totals ?? {
    total: 0,
    done: 0,
    words: 0,
    meanConf: 1,
    lowConfWords: 0,
    flagged: 0,
    clean: 0,
    reviewed: 0,
  };

  const stats: {
    label: string;
    value: string | number;
    tone: string;
    sub?: string;
  }[] = [
    { label: "pages", value: t.total, tone: "var(--ink-1)" },
    {
      label: "recognised",
      value: `${t.done}/${t.total}`,
      tone: t.done < t.total ? "var(--ocr)" : "var(--exact)",
    },
    { label: "words", value: t.words, tone: "var(--ink-1)" },
    {
      label: "mean score",
      value: `${Math.round(t.meanConf * 100)}%`,
      tone: confTone(t.meanConf),
    },
    {
      label: "low-score",
      value: t.lowConfWords,
      tone: t.lowConfWords > 0 ? "var(--fuzzy)" : "var(--ink-2)",
      sub: "words",
    },
    {
      label: "flagged",
      value: t.flagged,
      tone: t.flagged > 0 ? "var(--fuzzy)" : "var(--ink-2)",
      sub: "pages",
    },
  ];

  return (
    <div
      data-testid="ocr-overview-tab"
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
            data-testid={`ocr-overview-stat-${s.label.replace(" ", "-")}`}
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

      {/* Word-score distribution — placeholder (I1: derive from rows) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
        }}
      >
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
            Word score distribution
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-4)" }}>
            Confidence histogram across {t.words} words (I1: derive from rows)
          </div>
        </div>
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
            Page flags
          </div>
          <div style={{ fontSize: 12, color: "var(--ink-4)" }}>
            Flag breakdown across {t.total} pages (I1: derive from rows)
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OCR StepSettings tab — local settings panel (F5 minimal; wired at I1)
// ---------------------------------------------------------------------------

/**
 * F5-3-6 — OcrStepSettings uses local state only (no stageSettings machine).
 *
 * stageSettings.ts exists in the f51-source worktree (F5.1) but NOT in this
 * worktree at F5.3 time. Per task instructions, we use a local minimal panel
 * driven by local state + no-op handlers. When F5.1 is rebased in, each
 * machine must inline the 9 settings actions typed to its own Context/Event
 * (ActionFunction phantom-type constraint from stageSettings.ts).
 */
function OcrStepSettingsTab({
  engine,
  backend,
  onSetEngine,
  onSetBackend,
}: {
  engine: "doctr" | "tesseract";
  backend: "gpu" | "cpu";
  onSetEngine: (eng: "doctr" | "tesseract") => void;
  onSetBackend: (b: "gpu" | "cpu") => void;
}): ReactNode {
  const isDoctr = engine === "doctr";

  return (
    <div
      data-testid="ocr-step-settings-tab"
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
          Stage settings · OCR
        </div>
        <div style={{ marginTop: 3, fontSize: 12, color: "var(--ink-3)" }}>
          The recognition engine (and GPU/CPU backend), its model + languages,
          and per-page overrides. Changes re-run OCR and stale 15 downstream
          stages. (Full panel wired at I1 via stageSettings machine pattern.)
        </div>
      </div>

      {/* Engine selector */}
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
            alignItems: "flex-start",
          }}
        >
          <div>
            <div
              style={{ fontSize: 12.5, fontWeight: 500, color: "var(--ink-1)" }}
            >
              Engine
            </div>
            <div
              style={{ marginTop: 2, fontSize: 11.5, color: "var(--ink-3)" }}
            >
              DocTR is the primary model; Tesseract is the fallback
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {(["doctr", "tesseract"] as const).map((eng) => {
              const active = engine === eng;
              return (
                <div
                  key={eng}
                  role="button"
                  tabIndex={0}
                  data-testid={`ocr-settings-engine-${eng}`}
                  onClick={() => onSetEngine(eng)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") onSetEngine(eng);
                  }}
                  style={{
                    flex: 1,
                    padding: "10px 12px",
                    borderRadius: 8,
                    cursor: "pointer",
                    background: active
                      ? "color-mix(in oklab, var(--accent) 8%, var(--bg-surface))"
                      : "var(--bg-surface)",
                    border: `1.5px solid ${active ? "var(--accent)" : "var(--border-1)"}`,
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: active ? "var(--accent)" : "var(--ink-1)",
                    }}
                  >
                    {eng === "doctr" ? "DocTR" : "Tesseract"}
                  </div>
                  <div
                    style={{
                      marginTop: 3,
                      fontSize: 10.5,
                      fontFamily: "var(--mono-font, monospace)",
                      color: "var(--ink-4)",
                    }}
                  >
                    {eng === "doctr"
                      ? "GPU + CPU · ~0.3s/page"
                      : "CPU only · ~1.2s/page"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Backend */}
        {isDoctr ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "200px 1fr",
              gap: 12,
              padding: "14px 16px",
              alignItems: "center",
              borderTop: "1px solid var(--border-1)",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: "var(--ink-1)",
                }}
              >
                Compute backend
              </div>
              <div
                style={{ marginTop: 2, fontSize: 11.5, color: "var(--ink-3)" }}
              >
                DocTR runs on GPU with a CPU fallback
              </div>
            </div>
            <div
              data-testid="ocr-settings-backend"
              style={{
                display: "inline-flex",
                padding: 3,
                gap: 2,
                background: "var(--bg-raised)",
                border: "1px solid var(--border-1)",
                borderRadius: 7,
              }}
            >
              {(["gpu", "cpu"] as const).map((b) => {
                const active = backend === b;
                return (
                  <div
                    key={b}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSetBackend(b)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") onSetBackend(b);
                    }}
                    style={{
                      padding: "5px 12px",
                      borderRadius: 5,
                      cursor: "pointer",
                      background: active ? "var(--bg-surface)" : "transparent",
                      boxShadow: active ? "0 0 0 1px var(--border-1)" : "none",
                      fontSize: 12,
                      fontFamily: "var(--mono-font, monospace)",
                      fontWeight: active ? 600 : 500,
                      color: active ? "var(--ink-1)" : "var(--ink-3)",
                    }}
                  >
                    {b === "gpu" ? "GPU · CUDA" : "CPU · fallback"}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
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
        Full settings panel (model weights, language packs, per-page overrides,
        low-score threshold, re-run controls) wired at I1 via stageSettings
        machine.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab bar — shared between OcrTool tab modes
// ---------------------------------------------------------------------------

type OcrTab = "overview" | "pages" | "settings";

function OcrTabBar({
  active,
  onChange,
}: {
  active: OcrTab;
  onChange: (tab: OcrTab) => void;
}): ReactNode {
  return (
    <div
      data-testid="ocr-tab-bar"
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
        const labels: Record<OcrTab, string> = {
          overview: "Overview",
          pages: "Pages",
          settings: "Settings",
        };
        return (
          <button
            key={tab}
            data-testid={`ocr-tab-${tab}`}
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
// Main OcrTool component
// ---------------------------------------------------------------------------

export function OcrTool({
  stageId,
  runnerRef: _runnerRef,
}: ToolSlotProps): ReactNode {
  const { projectId = "demo" } = useParams<{ projectId: string }>();
  const services = useMemo(() => buildRealOcrToolServices(), []);

  const [snapshot, send] = useActor(ocrToolMachine, {
    input: { projectId, stageIndex: 10, services },
  });
  const { rows, totals, cursor, tokens, engine, backend } = snapshot.context;

  // View-only display preferences — local state per DIVERGENCES.md #8 / F5-3-2
  const [density, setDensity] = useState<"S" | "M" | "L">("M");
  const [filter, setFilter] = useState<string>("all");

  // Tab state — local per F5-3-2 convention (view-only, not guarded by machine)
  const [activeTab, setActiveTab] = useState<OcrTab>("pages");

  const isRecognising = snapshot.matches("recognising");
  const isReviewing = snapshot.matches("reviewing");
  const isInGrid = snapshot.matches({ reviewing: "grid" });
  const isInRecognition = snapshot.matches({ reviewing: "recognition" });
  const isConfirming = snapshot.matches("confirming");
  const isSettled = snapshot.matches("settled");

  const isConfirmable =
    totals !== null &&
    (totals.flagged === 0 || totals.flagged <= totals.reviewed);

  const cursorRow = cursor ? rows.find((r) => r.idx === cursor) : null;

  // Filter rows for grid
  const filteredRows = rows.filter((r) => {
    if (filter === "flagged") return r.state === "flagged";
    if (filter === "clean") return r.state === "clean";
    if (filter === "reviewed") return r.state === "reviewed";
    return true;
  });

  if (isConfirming) {
    return (
      <div
        data-testid="ocr-tool-confirming"
        data-stage-id={stageId}
        style={{
          flex: 1,
          display: "grid",
          placeItems: "center",
          color: "var(--ink-3)",
          fontSize: 13,
        }}
      >
        Confirming OCR stage…
      </div>
    );
  }

  if (isSettled) {
    return (
      <div
        data-testid="ocr-tool-settled"
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
        OCR complete. Waiting for downstream stages.
      </div>
    );
  }

  return (
    <div
      data-testid="ocr-tool"
      data-stage-id={stageId}
      style={{
        flex: 1,
        minHeight: 480,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Tab bar */}
      <OcrTabBar active={activeTab} onChange={setActiveTab} />

      {/* Overview tab */}
      {activeTab === "overview" ? <OcrOverviewTab totals={totals} /> : null}

      {/* Settings tab */}
      {activeTab === "settings" ? (
        <OcrStepSettingsTab
          engine={engine}
          backend={backend}
          onSetEngine={(eng) => send({ type: "SET_ENGINE", value: eng })}
          onSetBackend={(b) => send({ type: "SET_BACKEND", value: b })}
        />
      ) : null}

      {/* Pages tab */}
      {activeTab === "pages" ? (
        <div
          data-testid="ocr-pages-tab"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: "12px 16px",
          }}
        >
          {/* Banner */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              justifyContent: "space-between",
            }}
          >
            <div style={{ flex: 1 }}>
              <OcrBanner
                state={
                  isRecognising
                    ? "recognising"
                    : isReviewing
                      ? "reviewing"
                      : "other"
                }
                totals={totals}
              />
            </div>
            {isReviewing ? (
              <button
                data-testid="ocr-confirm-advance"
                disabled={!isConfirmable}
                onClick={() => send({ type: "CONFIRM_ADVANCE" })}
                style={{
                  padding: "6px 16px",
                  borderRadius: 6,
                  border: "none",
                  background: isConfirmable
                    ? "var(--accent)"
                    : "var(--bg-raised)",
                  color: isConfirmable
                    ? "var(--accent-ink, #fff)"
                    : "var(--ink-4)",
                  cursor: isConfirmable ? "pointer" : "not-allowed",
                  fontSize: 12.5,
                  fontWeight: 600,
                  flexShrink: 0,
                }}
              >
                Confirm and advance
              </button>
            ) : null}
          </div>

          {/* Toolbar (review state) */}
          {isReviewing ? (
            <div
              data-testid="ocr-toolbar"
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
                    data-testid={`ocr-filter-${chip.id}`}
                    onClick={() => setFilter(chip.id)}
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

              {/* Confidence legend */}
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  marginLeft: 4,
                }}
              >
                {(
                  [
                    ["≥95", 0.97],
                    ["85–95", 0.9],
                    ["70–85", 0.77],
                    ["<70", 0.6],
                  ] as const
                ).map(([label, c]) => (
                  <span
                    key={label}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 10.5,
                      color: "var(--ink-4)",
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        background: confTone(c),
                      }}
                    />
                    {label}%
                  </span>
                ))}
              </div>

              <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                {/* Re-OCR button */}
                <button
                  data-testid="ocr-reocr-selection"
                  onClick={() => send({ type: "RE_OCR_SELECTION" })}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 5,
                    border: "1px solid var(--border-2)",
                    background: "var(--bg-surface)",
                    cursor: "pointer",
                    fontSize: 11.5,
                    color: "var(--ink-2)",
                  }}
                >
                  Re-OCR selection
                </button>

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
                      data-testid={`ocr-density-${d}`}
                      onClick={() => setDensity(d)}
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

          {/* Page grid — shown in recognising (progress view) and reviewing.grid */}
          {isRecognising || isInGrid ? (
            <div
              data-testid="ocr-page-grid"
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
                <OcrPageCard
                  key={row.idx}
                  row={row}
                  density={density}
                  isExpanded={cursor === row.idx}
                  onClick={() => {
                    if (row.state !== "running") {
                      send({ type: "OPEN_RECOGNITION", idx: row.idx });
                    }
                  }}
                />
              ))}
              {rows.length === 0 && isRecognising ? (
                <div
                  style={{
                    gridColumn: "1 / -1",
                    padding: "20px",
                    textAlign: "center",
                    color: "var(--ink-4)",
                    fontSize: 12,
                  }}
                >
                  Waiting for first page result…
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Recognition panel (inline — Recognition sub-state) */}
          {isInRecognition && cursorRow ? (
            <RecognitionPanel
              row={cursorRow}
              tokens={tokens}
              onAcceptToken={(tokenId) =>
                send({ type: "ACCEPT_TOKEN", tokenId })
              }
              onAcceptPage={() => send({ type: "ACCEPT_PAGE" })}
              onNextFlagged={() => send({ type: "NEXT_FLAGGED" })}
              onClose={() => send({ type: "CLOSE" })}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
