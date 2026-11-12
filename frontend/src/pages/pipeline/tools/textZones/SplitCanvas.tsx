/**
 * SplitCanvas — Konva board for the Text Zones split editor (W2.4).
 *
 * Shows the source page with the split gutter. Pressing or dragging on the
 * page moves the gutter along the split axis. Beside it, two child previews
 * crop the same image to what each child page will hold.
 */

import type { ReactNode } from "react";
import { useState } from "react";
import {
  Image as KonvaImage,
  Layer,
  Line,
  Rect,
  Stage,
  Text,
} from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type { SplitDraft } from "@/machines/tools/textZonesTool";
import { gutterFromPointer } from "./geometry";
import { useFallbackImage } from "./useFallbackImage";

const GUTTER_COLOR = "#2f6fd6";
const DEFAULT_ASPECT = 4 / 3;

export interface SplitCanvasProps {
  imageUrls: readonly string[];
  split: SplitDraft;
  childLabels: [string, string];
  onGutter: (gutter: number) => void;
  width?: number;
}

export function SplitCanvas({
  imageUrls,
  split,
  childLabels,
  onGutter,
  width = 260,
}: SplitCanvasProps): ReactNode {
  const { image, src, failed } = useFallbackImage(imageUrls);
  const aspect =
    image && image.naturalWidth > 0
      ? image.naturalHeight / image.naturalWidth
      : DEFAULT_ASPECT;
  const height = Math.round(width * aspect);
  const size = { w: width, h: height };
  const isCol = split.axis === "col";
  const gx = split.gutter * width;
  const gy = split.gutter * height;

  const [dragging, setDragging] = useState(false);

  function move(e: KonvaEventObject<MouseEvent>): void {
    const p = e.target.getStage()?.getPointerPosition();
    if (p) onGutter(gutterFromPointer(p, size, split.axis));
  }

  return (
    <div
      data-testid="split-preview-canvas"
      data-image-src={src ?? ""}
      data-image-loaded={image ? "true" : "false"}
      data-axis={split.axis}
      data-gutter={split.gutter}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        padding: 16,
        background: "var(--bg-sunk)",
        border: "1px solid var(--border-1)",
        borderRadius: 6,
        flexWrap: "wrap",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          data-testid="split-source-stage"
          style={{
            width,
            height,
            position: "relative",
            background: "#fff",
            boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
            cursor: isCol ? "ew-resize" : "ns-resize",
          }}
        >
          {failed ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                fontSize: 11.5,
                color: "var(--ink-4)",
              }}
            >
              No source image
            </div>
          ) : null}
          <Stage
            width={width}
            height={height}
            onMouseDown={(e) => {
              setDragging(true);
              move(e);
            }}
            onMouseMove={(e) => {
              if (dragging) move(e);
            }}
            onMouseUp={() => setDragging(false)}
            onMouseLeave={() => setDragging(false)}
            style={{ position: "absolute", inset: 0 }}
          >
            <Layer>
              {image ? (
                <KonvaImage image={image} width={width} height={height} />
              ) : null}
            </Layer>
            <Layer listening={false}>
              <Rect
                x={0}
                y={0}
                width={isCol ? gx : width}
                height={isCol ? height : gy}
                fill={`${GUTTER_COLOR}10`}
              />
              <Text
                x={6}
                y={6}
                text={childLabels[0]}
                fontSize={11}
                fontStyle="bold"
                fill={GUTTER_COLOR}
              />
              <Text
                x={isCol ? gx + 6 : 6}
                y={isCol ? 6 : gy + 6}
                text={childLabels[1]}
                fontSize={11}
                fontStyle="bold"
                fill={GUTTER_COLOR}
              />
              <Line
                name="gutter"
                points={isCol ? [gx, 0, gx, height] : [0, gy, width, gy]}
                stroke={GUTTER_COLOR}
                strokeWidth={2}
                dash={[8, 5]}
              />
            </Layer>
          </Stage>
        </div>
        <div
          style={{
            marginTop: 8,
            fontSize: 10.5,
            fontFamily: "var(--mono-font)",
            color: "var(--ink-3)",
          }}
        >
          source · drag to move the {isCol ? "gutter" : "divider"}
        </div>
      </div>

      <div style={{ textAlign: "center" }}>
        <div
          style={{
            display: "flex",
            flexDirection: isCol ? "row" : "column",
            gap: 8,
            alignItems: "center",
          }}
        >
          {([0, 1] as const).map((half) => (
            <ChildPreview
              key={half}
              half={half}
              src={image ? (src ?? "") : ""}
              split={split}
              label={childLabels[half]}
              aspect={aspect}
            />
          ))}
        </div>
        <div
          style={{
            marginTop: 8,
            fontSize: 10.5,
            fontFamily: "var(--mono-font)",
            color: "var(--ocr)",
            fontWeight: 600,
          }}
        >
          2 pages · {childLabels[0]} · {childLabels[1]}
        </div>
      </div>
    </div>
  );
}

/** One child page: the parent image cropped to its side of the gutter. */
function ChildPreview({
  half,
  src,
  split,
  label,
  aspect,
}: {
  half: 0 | 1;
  src: string;
  split: SplitDraft;
  label: string;
  aspect: number;
}): ReactNode {
  const isCol = split.axis === "col";
  // The full parent image is scaled to a fixed 200 px on the split's cross axis.
  const fullW = isCol ? 200 / aspect : 150;
  const fullH = isCol ? 200 : 150 * aspect;
  const share = half === 0 ? split.gutter : 1 - split.gutter;
  const w = isCol ? fullW * share : fullW;
  const h = isCol ? fullH : fullH * share;
  const offsetX = isCol && half === 1 ? -fullW * split.gutter : 0;
  const offsetY = !isCol && half === 1 ? -fullH * split.gutter : 0;
  return (
    <div
      data-testid={half === 0 ? "split-child-a" : "split-child-b"}
      style={{
        width: w,
        height: h,
        position: "relative",
        overflow: "hidden",
        background: "#fff",
        borderRadius: 3,
        boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
      }}
    >
      {src ? (
        <img
          alt=""
          src={src}
          style={{
            position: "absolute",
            left: offsetX,
            top: offsetY,
            width: fullW,
            height: fullH,
            maxWidth: "none",
          }}
        />
      ) : null}
      <span
        style={{
          position: "absolute",
          bottom: 4,
          left: 4,
          padding: "1px 6px",
          borderRadius: 3,
          background: "rgba(12,12,16,0.8)",
          color: "#fff",
          fontFamily: "var(--mono-font)",
          fontSize: 9,
          fontWeight: 600,
        }}
      >
        {label}
      </span>
    </div>
  );
}
