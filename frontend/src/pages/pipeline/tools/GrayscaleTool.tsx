/**
 * GrayscaleTool — React surface for the Grayscale stage (stage 02).
 *
 * Drives `grayscaleToolMachine`. Three sections:
 *   - Auto-detect banner (with backend chip: GPU / CPU)
 *   - Page grid (filterable by mode: all / perceptual / standard)
 *   - Step-settings panel (mode toggle + advanced params)
 *
 * DCArtboard-faithful layout:
 *   ┌──────────────────────────────────────────────────┐
 *   │  Auto-detect banner  (detecting / result)        │
 *   │  ─────────────────────────────────────────────   │
 *   │  Filter bar  ·  Backend chip  ·  Page cursor     │
 *   │  ─────────────────────────────────────────────   │
 *   │  Page viewer (current page thumbnail + mode)     │
 *   │  ─────────────────────────────────────────────   │
 *   │  Step-settings (mode toggle + advanced params)   │
 *   │  ─────────────────────────────────────────────   │
 *   │  Apply / Re-run / Reset actions                  │
 *   └──────────────────────────────────────────────────┘
 *
 * Props: ToolSlotProps { stageId, runnerRef }
 *
 * @see src/machines/tools/grayscaleTool.ts
 * @see docs/plans/design_handoff_pgdp_app/final/grayscale/grayscale.jsx
 * @see src/pages/pipeline/toolSlot.tsx
 */

import { useMemo, useEffect, useRef } from "react";
import { useActor } from "@xstate/react";
import { useParams } from "react-router-dom";
import {
  grayscaleToolMachine,
  type GrayscaleToolServices,
  type GrayscaleMode,
  type GrayscaleBackend,
} from "@/machines/tools/grayscaleTool";
import type { ToolSlotProps } from "../toolSlot";
import { Button } from "@/components/ui/Button";

// ---------------------------------------------------------------------------
// Mock service adapter (replaced at I1)
// ---------------------------------------------------------------------------

function makeGrayscaleServices(_projectId: string): GrayscaleToolServices {
  return {
    detectProfile: () =>
      Promise.resolve({
        mode: "perceptual",
        why: "newsprint · low contrast · low DPI",
        backend: "cpu",
      }),
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Backend pill — GPU exact-green, CPU fuzzy-amber */
function BackendChip({ backend }: { backend: GrayscaleBackend }) {
  const isGpu = backend === "gpu";
  const color = isGpu ? "var(--exact)" : "var(--fuzzy)";
  const label = isGpu ? "GPU · CUDA" : "CPU · numpy";
  return (
    <span
      data-testid="backend-chip"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 8px",
        height: 22,
        borderRadius: 99,
        background: `color-mix(in oklab, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in oklab, ${color} 35%, var(--border-1))`,
        color,
        fontSize: 11,
        fontWeight: 600,
        fontFamily: "var(--mono-font, monospace)",
        letterSpacing: ".02em",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 99,
          background: color,
          boxShadow: `0 0 6px ${color}`,
        }}
      />
      {label}
    </span>
  );
}

/** Mode chip (perceptual / standard) */
function ModeChip({ mode }: { mode: GrayscaleMode }) {
  const color = mode === "perceptual" ? "var(--ocr)" : "var(--ink-3)";
  return (
    <span
      data-testid={`mode-chip-${mode}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "1px 7px",
        height: 18,
        borderRadius: 99,
        background: `color-mix(in oklab, ${color} 14%, rgba(12,12,16,0.78))`,
        border: `1px solid color-mix(in oklab, ${color} 40%, transparent)`,
        color,
        fontSize: 9.5,
        fontWeight: 600,
        fontFamily: "var(--mono-font, monospace)",
      }}
    >
      {mode}
    </span>
  );
}

/** Auto-detect banner */
function AutoDetectBanner({
  machineState,
  detected,
  why,
  backend,
}: {
  machineState: string;
  detected: GrayscaleMode | null;
  why: string | null;
  backend: GrayscaleBackend;
}) {
  if (machineState === "detecting") {
    return (
      <div
        data-testid="autodetect-banner-detecting"
        style={{
          padding: "10px 14px",
          borderRadius: 8,
          background:
            "color-mix(in oklab, var(--accent) 6%, var(--bg-surface))",
          border:
            "1px solid color-mix(in oklab, var(--accent) 30%, var(--border-1))",
          fontSize: 13,
          color: "var(--ink-2)",
        }}
      >
        Detecting source profile from 8 sample pages…
      </div>
    );
  }

  if (!detected) return null;

  return (
    <div
      data-testid="autodetect-banner-result"
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 14,
        padding: "12px 14px",
        borderRadius: 8,
        background: "color-mix(in oklab, var(--accent) 6%, var(--bg-surface))",
        border:
          "1px solid color-mix(in oklab, var(--accent) 35%, var(--border-1))",
        alignItems: "center",
      }}
    >
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
            {detected}
          </span>{" "}
          from a sample of 8 pages ·{" "}
          <span
            style={{
              fontFamily: "monospace",
              fontSize: 11,
              color: "var(--ink-2)",
            }}
          >
            {why}
          </span>
        </div>
      </div>
      <BackendChip backend={backend} />
    </div>
  );
}

/** Filter bar for mode filtering */
function GrayscaleFilterBar({
  filter,
  onSetFilter,
}: {
  filter: "all" | "perceptual" | "standard";
  onSetFilter: (v: "all" | "perceptual" | "standard") => void;
}) {
  const chips = [
    { id: "all" as const, label: "All" },
    { id: "perceptual" as const, label: "Perceptual" },
    { id: "standard" as const, label: "Standard" },
  ];
  return (
    <div data-testid="grayscale-filter-bar" style={{ display: "flex", gap: 6 }}>
      {chips.map((chip) => {
        const active = filter === chip.id;
        return (
          <button
            key={chip.id}
            data-testid={`gs-filter-${chip.id}`}
            onClick={() => onSetFilter(chip.id)}
            style={{
              padding: "3px 10px",
              height: 26,
              borderRadius: 6,
              border: active
                ? "1px solid color-mix(in oklab, var(--accent) 50%, var(--border-1))"
                : "1px solid var(--border-1)",
              background: active
                ? "color-mix(in oklab, var(--accent) 12%, transparent)"
                : "transparent",
              color: active ? "var(--accent)" : "var(--ink-2)",
              fontSize: 11.5,
              fontWeight: active ? 600 : 500,
              cursor: "pointer",
            }}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}

/** Page viewer — simple page thumbnail with mode indicator */
function PageViewer({
  page,
  index,
  total,
  onPrev,
  onNext,
}: {
  page: { id: string; mode: GrayscaleMode; tone?: number } | null;
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (!page) {
    return (
      <div
        data-testid="page-viewer-empty"
        style={{
          height: 200,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-1)",
          borderRadius: 8,
          color: "var(--ink-4)",
          fontSize: 12,
        }}
      >
        No pages loaded
      </div>
    );
  }

  return (
    <div
      data-testid="page-viewer"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 12,
        background: "var(--bg-surface)",
        border: "1px solid var(--border-1)",
        borderRadius: 8,
      }}
    >
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          data-testid="prev-page-btn"
          onClick={onPrev}
          disabled={index === 0}
          style={{
            padding: "3px 8px",
            borderRadius: 5,
            border: "1px solid var(--border-2)",
            background: "var(--bg-raised)",
            color: "var(--ink-2)",
            fontSize: 12,
            cursor: index === 0 ? "default" : "pointer",
            opacity: index === 0 ? 0.4 : 1,
          }}
        >
          ‹
        </button>
        <span
          style={{
            fontSize: 11.5,
            color: "var(--ink-3)",
            fontFamily: "monospace",
          }}
        >
          {index + 1} / {total}
        </span>
        <button
          data-testid="next-page-btn"
          onClick={onNext}
          disabled={index >= total - 1}
          style={{
            padding: "3px 8px",
            borderRadius: 5,
            border: "1px solid var(--border-2)",
            background: "var(--bg-raised)",
            color: "var(--ink-2)",
            fontSize: 12,
            cursor: index >= total - 1 ? "default" : "pointer",
            opacity: index >= total - 1 ? 0.4 : 1,
          }}
        >
          ›
        </button>
        <div style={{ flex: 1 }} />
        <ModeChip mode={page.mode} />
        {page.tone != null && (
          <span
            style={{
              fontFamily: "monospace",
              fontSize: 11,
              color: "var(--ink-3)",
            }}
          >
            tone: {page.tone.toFixed(3)}
          </span>
        )}
      </div>

      {/* Fake page thumbnail */}
      <div
        data-testid={`page-thumb-grayscale-${page.id}`}
        style={{
          height: 140,
          borderRadius: 4,
          background:
            page.mode === "perceptual"
              ? "linear-gradient(145deg, oklch(0.91 0.006 200) 0%, oklch(0.88 0.004 200) 100%)"
              : "linear-gradient(145deg, oklch(0.92 0 0) 0%, oklch(0.89 0 0) 100%)",
          border: "1px solid var(--border-2)",
          position: "relative",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Ink lines */}
        <div
          style={{
            position: "absolute",
            inset: "12% 14%",
            backgroundImage: `repeating-linear-gradient(to bottom, oklch(0.32 0 0) 0 1.5px, transparent 1.5px 6px)`,
            opacity: 0.6,
          }}
        />
        <span
          style={{
            position: "absolute",
            bottom: 6,
            left: "50%",
            transform: "translateX(-50%)",
            fontFamily: "monospace",
            fontSize: 9,
            color: "oklch(0.4 0 0)",
          }}
        >
          {page.id}
        </span>
      </div>
    </div>
  );
}

/** Step settings panel — mode toggle + advanced params */
function StepSettings({
  draft,
  onPatch,
  onReset,
}: {
  draft: Record<string, unknown> | null;
  onPatch: (patch: Record<string, unknown>) => void;
  onReset: () => void;
}) {
  const mode = (draft?.["mode"] as GrayscaleMode | undefined) ?? "perceptual";
  const samplerRadius = (draft?.["samplerRadius"] as number | undefined) ?? 64;
  const gamma = (draft?.["gamma"] as number | undefined) ?? 1.0;
  const outputRangeMin = (draft?.["outputRangeMin"] as number | undefined) ?? 0;
  const outputRangeMax =
    (draft?.["outputRangeMax"] as number | undefined) ?? 255;

  return (
    <div
      data-testid="step-settings-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "12px 14px",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-1)",
        borderRadius: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 2,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-1)" }}>
          Step settings
        </span>
        <button
          data-testid="reset-btn"
          onClick={onReset}
          style={{
            fontSize: 11,
            color: "var(--ink-3)",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: "2px 6px",
          }}
        >
          Reset to default
        </button>
      </div>

      {/* Mode toggle */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span style={{ fontSize: 11.5, color: "var(--ink-2)" }}>Mode</span>
        <div
          data-testid="mode-toggle"
          style={{
            display: "inline-flex",
            padding: 2,
            gap: 2,
            background: "var(--bg-page)",
            border: "1px solid var(--border-1)",
            borderRadius: 6,
            alignSelf: "flex-start",
          }}
        >
          {(["perceptual", "standard"] as const).map((m) => (
            <button
              key={m}
              data-testid={`mode-btn-${m}`}
              onClick={() => onPatch({ mode: m })}
              style={{
                padding: "3px 12px",
                borderRadius: 4,
                border:
                  mode === m
                    ? "1px solid var(--border-2)"
                    : "1px solid transparent",
                background: mode === m ? "var(--bg-surface)" : "transparent",
                color: mode === m ? "var(--ink-1)" : "var(--ink-3)",
                fontSize: 11.5,
                fontWeight: mode === m ? 600 : 500,
                cursor: "pointer",
              }}
            >
              {m}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 10.5, color: "var(--ink-4)", lineHeight: 1.4 }}>
          {mode === "perceptual"
            ? "Weighted luma transform — preserves ink contrast. Best for newsprint and low-DPI scans."
            : "Simple ITU-R luma weights — faster, uniform output. Best for clean modern book scans."}
        </div>
      </div>

      {/* Sampler radius (perceptual only) */}
      {mode === "perceptual" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <label
              htmlFor="gs-sampler-radius"
              style={{ fontSize: 11.5, color: "var(--ink-2)" }}
            >
              Sampler radius (px)
            </label>
            <span
              style={{
                fontFamily: "monospace",
                fontSize: 11,
                fontWeight: 600,
                color: "var(--ink-1)",
              }}
            >
              {samplerRadius}
            </span>
          </div>
          <input
            id="gs-sampler-radius"
            type="range"
            data-testid="slider-samplerRadius"
            min={8}
            max={256}
            step={8}
            value={samplerRadius}
            onChange={(e) =>
              onPatch({ samplerRadius: parseInt(e.target.value, 10) })
            }
            style={{ width: "100%" }}
          />
          <div style={{ fontSize: 10.5, color: "var(--ink-4)" }}>
            Neighbourhood radius for the perceptual sampler. Larger = smoother
            tone map.
          </div>
        </div>
      )}

      {/* Gamma */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <label
            htmlFor="gs-gamma"
            style={{ fontSize: 11.5, color: "var(--ink-2)" }}
          >
            Gamma
          </label>
          <span
            style={{
              fontFamily: "monospace",
              fontSize: 11,
              fontWeight: 600,
              color: "var(--ink-1)",
            }}
          >
            {gamma.toFixed(2)}
          </span>
        </div>
        <input
          id="gs-gamma"
          type="range"
          data-testid="slider-gamma"
          min={0.5}
          max={2.5}
          step={0.05}
          value={gamma}
          onChange={(e) => onPatch({ gamma: parseFloat(e.target.value) })}
          style={{ width: "100%" }}
        />
      </div>

      {/* Output range */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span style={{ fontSize: 11.5, color: "var(--ink-2)" }}>
          Output range
        </span>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
        >
          <div>
            <label
              htmlFor="gs-output-min"
              style={{
                fontSize: 10.5,
                color: "var(--ink-4)",
                display: "block",
                marginBottom: 2,
              }}
            >
              Min
            </label>
            <input
              id="gs-output-min"
              type="range"
              data-testid="slider-outputRangeMin"
              min={0}
              max={128}
              step={1}
              value={outputRangeMin}
              onChange={(e) =>
                onPatch({ outputRangeMin: parseInt(e.target.value, 10) })
              }
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label
              htmlFor="gs-output-max"
              style={{
                fontSize: 10.5,
                color: "var(--ink-4)",
                display: "block",
                marginBottom: 2,
              }}
            >
              Max
            </label>
            <input
              id="gs-output-max"
              type="range"
              data-testid="slider-outputRangeMax"
              min={128}
              max={255}
              step={1}
              value={outputRangeMax}
              onChange={(e) =>
                onPatch({ outputRangeMax: parseInt(e.target.value, 10) })
              }
              style={{ width: "100%" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * GrayscaleTool — tool slot surface for the Grayscale stage.
 *
 * @see docs/plans/design_handoff_pgdp_app/final/grayscale/grayscale.jsx
 * @see src/pages/pipeline/toolSlot.tsx — F5 contract
 */
export function GrayscaleTool({
  stageId: _stageId,
  runnerRef: _runnerRef,
  _testServices,
}: ToolSlotProps & { _testServices?: GrayscaleToolServices }) {
  const { projectId = "mock-project" } = useParams();

  const services = useMemo(
    () => _testServices ?? makeGrayscaleServices(projectId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId],
  );

  const [snapshot, send] = useActor(grayscaleToolMachine, {
    input: {
      projectId,
      stageIndex: 0,
      services,
    },
  });

  const ctx = snapshot.context;

  const topState = (() => {
    if (snapshot.matches("detecting")) return "detecting";
    if (snapshot.matches("converting")) return "converting";
    if (snapshot.matches("done")) return "done";
    if (snapshot.matches("error")) return "error";
    return "unknown";
  })();

  const currentPage = ctx.pages[ctx.cursor] ?? null;

  // Mock: simulate PAGE_PUSH events when in converting state.
  // At I1 these come from the SSE stream; in the mock we push a small fixed
  // set of synthetic pages immediately.  The guard `isLastPage` uses the
  // `_total` sentinel field to know when we're done.
  const hasFiredMockPages = useRef(false);
  useEffect(() => {
    if (topState !== "converting" || hasFiredMockPages.current) return;
    hasFiredMockPages.current = true;
    const MOCK_PAGE_COUNT = 4;
    const modes: ("perceptual" | "standard")[] = [
      "perceptual",
      "perceptual",
      "standard",
      "perceptual",
    ];
    for (let i = 0; i < MOCK_PAGE_COUNT; i++) {
      const isLast = i === MOCK_PAGE_COUNT - 1;
      const page = Object.assign(
        {
          id: `mock-page-${i + 1}`,
          mode: modes[i] ?? "perceptual",
          tone: 0.5 + i * 0.05,
        },
        isLast ? { _total: MOCK_PAGE_COUNT } : {},
      );
      setTimeout(() => send({ type: "PAGE_PUSH", page }), i * 5);
    }
  }, [topState, send]);

  // Filtered pages for the grid (not displayed in the canvas but tracked for
  // the filter bar — actual page browsing uses cursor navigation)
  const filteredCount =
    ctx.filter === "all"
      ? ctx.pages.length
      : ctx.pages.filter((p) => p.mode === ctx.filter).length;

  if (topState === "error") {
    return (
      <div
        data-testid="grayscale-tool-error"
        style={{ padding: 24, textAlign: "center", color: "var(--mismatch)" }}
      >
        <div style={{ marginBottom: 12 }}>Detection failed.</div>
        <div style={{ marginBottom: 12, fontSize: 12, color: "var(--ink-3)" }}>
          {ctx.error?.message}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => send({ type: "RETRY" })}
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div
      data-testid="grayscale-tool"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 16,
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* Auto-detect banner */}
      <AutoDetectBanner
        machineState={topState}
        detected={ctx.detected?.mode ?? null}
        why={ctx.detected?.why ?? null}
        backend={ctx.backend}
      />

      {/* Converting progress */}
      {topState === "converting" && (
        <div
          data-testid="converting-progress"
          style={{
            padding: "8px 12px",
            background: "color-mix(in oklab, var(--ocr) 8%, var(--bg-surface))",
            border:
              "1px solid color-mix(in oklab, var(--ocr) 30%, var(--border-1))",
            borderRadius: 7,
            fontSize: 12,
            color: "var(--ocr)",
          }}
        >
          Converting pages… {ctx.pages.length} done
        </div>
      )}

      {/* Toolbar: filter bar + page count */}
      {(topState === "done" || ctx.pages.length > 0) && (
        <div
          data-testid="grayscale-toolbar"
          style={{ display: "flex", alignItems: "center", gap: 10 }}
        >
          <GrayscaleFilterBar
            filter={ctx.filter}
            onSetFilter={(v) => send({ type: "SET_FILTER", value: v })}
          />
          <div style={{ flex: 1 }} />
          <span
            style={{
              fontSize: 11,
              color: "var(--ink-3)",
              fontFamily: "monospace",
            }}
          >
            {filteredCount} page{filteredCount !== 1 ? "s" : ""}
          </span>
          <BackendChip backend={ctx.backend} />
        </div>
      )}

      {/* Page viewer */}
      {ctx.pages.length > 0 && (
        <PageViewer
          page={currentPage}
          index={ctx.cursor}
          total={ctx.pages.length}
          onPrev={() => send({ type: "PREV_PAGE" })}
          onNext={() => send({ type: "NEXT_PAGE" })}
        />
      )}

      {/* Step settings (done state only) */}
      {topState === "done" && (
        <StepSettings
          draft={ctx.draft ?? {}}
          onPatch={(patch) => send({ type: "SET_PARAM", patch })}
          onReset={() => send({ type: "RESET" })}
        />
      )}

      {/* Action bar (done state — tuned sub-state shows Apply button) */}
      {topState === "done" && (
        <div
          data-testid="grayscale-action-bar"
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            padding: "8px 0",
          }}
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={() => send({ type: "REDETECT" })}
          >
            Re-detect
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => send({ type: "APPLY_RUN" })}
            data-testid="apply-run-btn"
          >
            Apply &amp; re-run all
          </Button>
        </div>
      )}
    </div>
  );
}
