/**
 * CanvasMapTool — stage tool surface for the Canvas map stage.
 *
 * Wraps the shared ImageStageReviewTool with a scatter of measured page sizes
 * and a Re-derive action. CanvasMapTool owns the review actor and passes it to
 * ImageStageReviewTool so Re-derive can update the same rows.
 *
 * @see src/pages/pipeline/tools/ImageStageReviewTool.tsx — shared surface
 * @see src/services/tools/canvasMap.ts — measured page sizes
 */

import { useMemo } from "react";
import { useActor } from "@xstate/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { imageStageReviewMachine } from "@/machines/imageStageReview";
import {
  fetchAspectPoints,
  saveCanvasRatio,
  type AspectPoint,
} from "@/services/tools/canvasMap";
import { buildRealImageStageReviewServices } from "@/services/tools/imageStageReview";
import { ImageStageReviewTool } from "./ImageStageReviewTool";
import type { ToolSlotProps } from "../toolSlot";

const CHART = {
  width: 260,
  height: 160,
  left: 34,
  right: 10,
  top: 10,
  bottom: 24,
};
const PLOT_WIDTH = CHART.width - CHART.left - CHART.right;
const PLOT_HEIGHT = CHART.height - CHART.top - CHART.bottom;

function AspectScatter({
  points,
  canvasRatio,
}: {
  points: AspectPoint[];
  canvasRatio: number;
}) {
  if (points.length === 0) {
    return (
      <div
        data-testid="canvas-map-aspect-scatter"
        style={{
          width: CHART.width,
          height: CHART.height,
          display: "grid",
          placeItems: "center",
          padding: 16,
          textAlign: "center",
          background: "var(--bg-page)",
          border: "1px solid var(--border-1)",
          borderRadius: 6,
          fontSize: 12,
          color: "var(--ink-3)",
          flex: "0 0 auto",
        }}
      >
        No page sizes yet. Run post-transform crop first.
      </div>
    );
  }

  const maxWidth = Math.max(...points.map((p) => p.width));
  const maxHeight = Math.max(...points.map((p) => p.height));
  const x = (width: number) => CHART.left + (PLOT_WIDTH * width) / maxWidth;
  const y = (height: number) =>
    CHART.top + PLOT_HEIGHT - (PLOT_HEIGHT * height) / maxHeight;
  const guideWidth = Math.min(maxWidth, maxHeight / canvasRatio);

  return (
    <svg
      data-testid="canvas-map-aspect-scatter"
      role="img"
      aria-label={`Page sizes for ${points.length} pages`}
      width={CHART.width}
      height={CHART.height}
      style={{
        background: "var(--bg-page)",
        border: "1px solid var(--border-1)",
        borderRadius: 6,
        flex: "0 0 auto",
      }}
    >
      <path
        d={`M${x(0)} ${y(maxHeight)}V${y(0)}H${x(maxWidth)}`}
        fill="none"
        stroke="var(--border-2)"
      />
      <line
        data-testid="canvas-map-ratio-line"
        x1={x(0)}
        y1={y(0)}
        x2={x(guideWidth)}
        y2={y(guideWidth * canvasRatio)}
        stroke="var(--accent)"
        strokeWidth={2}
        strokeDasharray="4 3"
      />
      {points.map((point) => {
        const title = `${point.prefix}: ${point.width} × ${point.height} (${point.ratio.toFixed(3)})`;
        return point.body ? (
          <circle
            key={point.pageId}
            data-testid={`aspect-point-${point.pageId}`}
            cx={x(point.width)}
            cy={y(point.height)}
            r={4}
            fill="var(--ocr)"
          >
            <title>{title}</title>
          </circle>
        ) : (
          <rect
            key={point.pageId}
            data-testid={`aspect-point-${point.pageId}`}
            x={x(point.width) - 4}
            y={y(point.height) - 4}
            width={8}
            height={8}
            fill="none"
            stroke="var(--fuzzy)"
            strokeWidth={1.5}
          >
            <title>{title}</title>
          </rect>
        );
      })}
      <text
        x={CHART.left + PLOT_WIDTH / 2}
        y={CHART.height - 7}
        textAnchor="middle"
        fontSize={9}
        fill="var(--ink-3)"
      >
        width (px)
      </text>
      <text
        transform={`translate(13 ${CHART.top + PLOT_HEIGHT / 2}) rotate(-90)`}
        textAnchor="middle"
        fontSize={9}
        fill="var(--ink-3)"
      >
        height (px)
      </text>
    </svg>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
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
        data-testid={`canvas-map-stat-${label}`}
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
  );
}

function LegendItem({
  marker,
  label,
}: {
  marker: React.CSSProperties;
  label: string;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={marker} />
      {label}
    </span>
  );
}

function CanvasMapExtras({
  points,
  canvasRatio,
  bodyRatio,
  loadFailed,
  rederiveFailed,
  rederiving,
  onRederive,
}: {
  points: AspectPoint[];
  canvasRatio: number;
  bodyRatio: number | null;
  loadFailed: boolean;
  rederiveFailed: boolean;
  rederiving: boolean;
  onRederive: () => void;
}) {
  const bodyCount = points.filter((p) => p.body).length;
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
          type="button"
          data-testid="canvas-map-rederive-btn"
          onClick={onRederive}
          disabled={bodyRatio === null || rederiving}
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

      {loadFailed && (
        <div role="alert" style={{ fontSize: 12, color: "var(--mismatch)" }}>
          Could not load the page sizes.
        </div>
      )}
      {rederiveFailed && (
        <div role="alert" style={{ fontSize: 12, color: "var(--mismatch)" }}>
          Could not re-derive the canvas.
        </div>
      )}

      <div style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
        <AspectScatter points={points} canvasRatio={canvasRatio} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: "var(--ink-3)", lineHeight: 1.6 }}>
            Re-derive sets the canvas to the median page shape, then re-runs
            every page. Pages more than 5% away from the median are outliers and
            do not change it much. Pages with their own saved ratio keep it.
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
            <Stat label="canvas ratio" value={canvasRatio.toFixed(3)} />
            <Stat
              label="median ratio"
              value={bodyRatio === null ? "none" : bodyRatio.toFixed(3)}
            />
            <Stat label="body pages" value={String(bodyCount)} />
            <Stat label="outliers" value={String(points.length - bodyCount)} />
          </div>
          <div
            style={{
              marginTop: 10,
              display: "flex",
              gap: 12,
              fontSize: 11,
              color: "var(--ink-3)",
            }}
          >
            <LegendItem
              label="body page"
              marker={{
                width: 8,
                height: 8,
                borderRadius: 99,
                background: "var(--ocr)",
              }}
            />
            <LegendItem
              label="outlier"
              marker={{
                width: 8,
                height: 8,
                borderRadius: 1,
                border: "1.5px solid var(--fuzzy)",
              }}
            />
            <LegendItem
              label="canvas ratio"
              marker={{ width: 12, borderTop: "2px dashed var(--accent)" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Canvas_map review surface: the shared review tool plus measured page sizes. */
export function CanvasMapTool({ stageId, runnerRef }: ToolSlotProps) {
  const { projectId = "mock-project" } = useParams();

  const services = useMemo(() => buildRealImageStageReviewServices(), []);

  const [snapshot, send] = useActor(imageStageReviewMachine, {
    input: {
      projectId,
      stageId,
      stageIndex: 0,
      services,
    },
  });

  const rows = snapshot.context.rows;
  // Sizes come from the input stage, and beforeUrl changes when that stage re-runs.
  const inputVersions = rows.map((row) => row.beforeUrl ?? "").join("|");
  const aspect = useQuery({
    queryKey: ["canvas-map-aspect", projectId, inputVersions],
    queryFn: () => fetchAspectPoints(projectId),
  });

  const rederive = useMutation({
    mutationFn: async (ratio: number) => {
      await saveCanvasRatio(projectId, ratio);
      return services.reRunPages(
        projectId,
        stageId,
        {},
        rows.map((row) => row.idx),
      );
    },
    onSuccess: (updatedRows) => {
      send({ type: "ROWS_REFRESHED", rows: updatedRows });
      void aspect.refetch();
    },
  });

  const bodyRatio = aspect.data?.bodyRatio ?? null;

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
      <ImageStageReviewTool
        stageId={stageId}
        runnerRef={runnerRef}
        actorOverride={{ snapshot, send }}
      />

      <div style={{ padding: "0 16px 16px" }}>
        <CanvasMapExtras
          points={aspect.data?.points ?? []}
          canvasRatio={aspect.data?.canvasRatio ?? 1.294}
          bodyRatio={bodyRatio}
          loadFailed={aspect.isError}
          rederiveFailed={rederive.isError}
          rederiving={rederive.isPending}
          onRederive={() => {
            if (bodyRatio !== null) rederive.mutate(bodyRatio);
          }}
        />
      </div>
    </div>
  );
}
