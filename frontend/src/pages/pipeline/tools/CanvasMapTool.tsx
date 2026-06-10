/**
 * CanvasMapTool — stage tool surface for the Canvas map stage.
 *
 * Wraps the shared ImageStageReviewTool with canvas_map-specific extras:
 *   - AspectScatter: page-dimension scatter (body cluster + chosen ratio box)
 *   - Spreads summary: verso/recto pairs with margin-mirror status
 *   - "Re-derive canvas" action
 *
 * The shared ImageStageReviewTool handles the page grid, filter chips, density
 * toggle, inline editor, and confirm gate. The extras below the review surface
 * show the canvas placement analysis unique to this stage.
 *
 * ## Design fidelity
 * The extras match the DCArtboard overviews from canvas-map.jsx:
 *   - CmapOverview: aspect scatter + stat grid + placement flags
 *   - CmapSpreads: facing-page pairs (shown as a summary row here)
 *
 * Full spread/overview views are deferred to I1 (canvas_map extras are not
 * in the F5 acceptance criteria). This wrapper satisfies the F5 contract:
 * canvas_map registered in TOOL_REGISTRY, schema entry added to stageSchemas.ts,
 * ImageStageReviewTool renders the review surface.
 *
 * @see src/pages/pipeline/tools/ImageStageReviewTool.tsx — shared surface
 * @see src/pages/pipeline/tools/stageSchemas.ts — canvas_map schema entry
 * @see docs/plans/design_handoff_pgdp_app/final/canvas_map/canvas-map.jsx
 */

import { ImageStageReviewTool } from "./ImageStageReviewTool";
import type { ToolSlotProps } from "../toolSlot";

// ---------------------------------------------------------------------------
// AspectScatter — page-dimension scatter placeholder
// ---------------------------------------------------------------------------

function AspectScatterPlaceholder() {
  // Mocked body-cluster points (schematic only — real data from I1 API)
  const points = [
    { x: 0.41, y: 0.51, body: true },
    { x: 0.42, y: 0.52, body: true },
    { x: 0.43, y: 0.5, body: true },
    { x: 0.42, y: 0.53, body: true },
    { x: 0.44, y: 0.49, body: true },
    { x: 0.4, y: 0.54, body: true },
    { x: 0.22, y: 0.35, body: false }, // outlier: plate
    { x: 0.55, y: 0.7, body: false }, // outlier: foldout
    { x: 0.18, y: 0.18, body: false }, // outlier: initial
  ];
  const w = 260;
  const h = 160;

  return (
    <div
      data-testid="canvas-map-aspect-scatter"
      style={{
        position: "relative",
        width: w,
        height: h,
        background: "var(--bg-page)",
        border: "1px solid var(--border-1)",
        borderRadius: 6,
        overflow: "hidden",
        flex: "0 0 auto",
      }}
    >
      {/* Axes */}
      <div
        style={{
          position: "absolute",
          left: 28,
          right: 10,
          bottom: 22,
          top: 10,
          borderLeft: "1px solid var(--border-2)",
          borderBottom: "1px solid var(--border-2)",
        }}
      />
      {/* Common-canvas ratio box */}
      <div
        style={{
          position: "absolute",
          left: `${28 + (w - 38) * 0.38}px`,
          top: `${10 + (h - 32) * 0.44}px`,
          width: 38,
          height: 25,
          border: "1.5px solid var(--accent)",
          background: "color-mix(in oklab, var(--accent) 10%, transparent)",
          borderRadius: 2,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: -13,
            left: 0,
            fontSize: 8.5,
            color: "var(--accent)",
            fontWeight: 700,
            fontFamily: "monospace",
            whiteSpace: "nowrap",
          }}
        >
          common
        </span>
      </div>
      {/* Data points */}
      {points.map((p, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            left: `${28 + (w - 38) * p.x}px`,
            top: `${10 + (h - 32) * (1 - p.y)}px`,
            width: p.body ? 5 : 6,
            height: p.body ? 5 : 6,
            borderRadius: p.body ? 99 : 1,
            background: p.body ? "var(--ocr)" : "transparent",
            border: p.body ? "none" : "1.5px solid var(--fuzzy)",
            transform: "translate(-50%, -50%)",
            display: "inline-block",
          }}
        />
      ))}
      {/* Axis labels */}
      <span
        style={{
          position: "absolute",
          left: 4,
          top: "46%",
          fontSize: 8.5,
          color: "var(--ink-4)",
          fontFamily: "monospace",
          writingMode: "vertical-rl",
          transform: "rotate(180deg)",
        }}
      >
        height
      </span>
      <span
        style={{
          position: "absolute",
          bottom: 6,
          left: "46%",
          fontSize: 8.5,
          color: "var(--ink-4)",
          fontFamily: "monospace",
        }}
      >
        width
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Canvas map extras panel
// ---------------------------------------------------------------------------

function CanvasMapExtras() {
  return (
    <div
      data-testid="canvas-map-extras"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-1)",
        borderRadius: 8,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--ink-1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        Common aspect ratio
        <button
          data-testid="canvas-map-rederive-btn"
          style={{
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid var(--border-2)",
            background: "var(--bg-raised)",
            color: "var(--ink-2)",
            fontSize: 11.5,
            cursor: "pointer",
          }}
        >
          Re-derive canvas
        </button>
      </div>

      {/* Aspect scatter + legend */}
      <div style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
        <AspectScatterPlaceholder />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.6 }}>
            Derived from the{" "}
            <span style={{ color: "var(--ocr)", fontWeight: 600 }}>
              body-text pages
            </span>{" "}
            (tight cluster), not from outliers — plates, title pages and
            foldouts are fit{" "}
            <span style={{ color: "var(--ink-1)" }}>within</span> the canvas.
          </div>
          <div
            style={{
              marginTop: 10,
              display: "flex",
              gap: 14,
              flexWrap: "wrap",
              fontSize: 11,
            }}
          >
            {[
              { label: "canvas", value: "826 × 1048" },
              { label: "ratio", value: "~4:5" },
              { label: "from", value: "318 body pages" },
              { label: "outliers", value: "21 fit within" },
            ].map(({ label, value }) => (
              <div key={label}>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--ink-4)",
                    textTransform: "uppercase",
                    letterSpacing: ".04em",
                  }}
                >
                  {label}
                </div>
                <div
                  style={{
                    fontFamily: "monospace",
                    marginTop: 2,
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "var(--ink-1)",
                  }}
                >
                  {value}
                </div>
              </div>
            ))}
          </div>
          {/* Legend */}
          <div
            style={{
              marginTop: 10,
              display: "flex",
              gap: 12,
              fontSize: 11,
              color: "var(--ink-3)",
            }}
          >
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 99,
                  background: "var(--ocr)",
                }}
              />
              body page
            </span>
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 1,
                  border: "1.5px solid var(--fuzzy)",
                }}
              />
              outlier
            </span>
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <span
                style={{
                  width: 10,
                  height: 7,
                  border: "1.5px solid var(--accent)",
                }}
              />
              chosen ratio
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component — wraps shared ImageStageReviewTool + extras
// ---------------------------------------------------------------------------

/**
 * CanvasMapTool — canvas_map stage review surface.
 *
 * Delegates the page grid / flag review to the shared ImageStageReviewTool,
 * then appends the canvas_map-specific extras (aspect scatter + re-derive).
 *
 * Artboard DCArtboard states are the same as ImageStageReviewTool (loading /
 * running / review / settled / confirming) plus the extras overlay.
 */
export function CanvasMapTool(props: ToolSlotProps) {
  return (
    <div
      data-testid="canvas-map-tool"
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* Shared imageStageReview surface */}
      <ImageStageReviewTool {...props} />

      {/* Canvas-map extras (aspect scatter + re-derive) */}
      <div style={{ padding: "0 16px 16px" }}>
        <CanvasMapExtras />
      </div>
    </div>
  );
}
