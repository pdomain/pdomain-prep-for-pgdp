/**
 * ZoneCanvas — Konva board for the Text Zones zone editor (W2.4).
 *
 * Draws the page image with the drafted zones on top. In the box tool a drag
 * adds a zone; a click on a zone selects it. Coordinates are normalised to
 * the page image, the same space the detector and the layout route use.
 */

import type { ReactNode } from "react";
import { useState } from "react";
import {
  Group,
  Image as KonvaImage,
  Layer,
  Rect,
  Stage,
  Text,
} from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type { Zone } from "@/machines/tools/textZonesTool";
import { boxFromDrag, type NormBox, type Point } from "./geometry";
import { useFallbackImage } from "./useFallbackImage";
import { ZONE_TYPE_COLORS } from "./zoneColors";

/** Page aspect (h / w) used until the image has loaded. */
const DEFAULT_ASPECT = 4 / 3;

export interface ZoneCanvasProps {
  imageUrls: readonly string[];
  zones: readonly Zone[];
  selectedId: string | null;
  tool: "select" | "box" | "lasso";
  onSelect: (zoneId: string | null) => void;
  onDraw: (box: NormBox) => void;
  width?: number;
}

export function ZoneCanvas({
  imageUrls,
  zones,
  selectedId,
  tool,
  onSelect,
  onDraw,
  width = 320,
}: ZoneCanvasProps): ReactNode {
  const { image, src, failed } = useFallbackImage(imageUrls);
  const aspect =
    image && image.naturalWidth > 0
      ? image.naturalHeight / image.naturalWidth
      : DEFAULT_ASPECT;
  const height = Math.round(width * aspect);
  const size = { w: width, h: height };

  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [dragEnd, setDragEnd] = useState<Point | null>(null);
  const drawing = tool === "box";
  const pending =
    dragStart && dragEnd ? boxFromDrag(dragStart, dragEnd, size) : null;

  function pointer(e: KonvaEventObject<MouseEvent>): Point | null {
    return e.target.getStage()?.getPointerPosition() ?? null;
  }

  function handleDown(e: KonvaEventObject<MouseEvent>): void {
    if (!drawing) return;
    const p = pointer(e);
    setDragStart(p);
    setDragEnd(p);
  }

  function handleMove(e: KonvaEventObject<MouseEvent>): void {
    if (!dragStart) return;
    setDragEnd(pointer(e));
  }

  function handleUp(e: KonvaEventObject<MouseEvent>): void {
    if (dragStart) {
      const end = pointer(e) ?? dragEnd;
      const box = end ? boxFromDrag(dragStart, end, size) : null;
      setDragStart(null);
      setDragEnd(null);
      if (box) {
        onDraw(box);
        return;
      }
    }
    const zoneId = e.target.name() === "zone" ? e.target.id() : null;
    onSelect(zoneId);
  }

  return (
    <div
      data-testid="zone-canvas"
      data-image-src={src ?? ""}
      data-image-loaded={image ? "true" : "false"}
      data-zone-count={zones.length}
      style={{
        width,
        height,
        position: "relative",
        background: "#fff",
        boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
        cursor: drawing ? "crosshair" : "default",
      }}
    >
      {failed ? (
        <div
          data-testid="zone-canvas-no-image"
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            padding: 16,
            textAlign: "center",
            fontSize: 11.5,
            color: "var(--ink-4)",
          }}
        >
          No page image yet. Run the earlier image stages to see the page.
        </div>
      ) : null}
      <Stage
        width={width}
        height={height}
        onMouseDown={handleDown}
        onMouseMove={handleMove}
        onMouseUp={handleUp}
        style={{ position: "absolute", inset: 0 }}
      >
        <Layer>
          {image ? (
            <KonvaImage
              image={image}
              width={width}
              height={height}
              listening={false}
            />
          ) : null}
        </Layer>
        <Layer>
          {zones.map((z, i) => {
            const color = ZONE_TYPE_COLORS[z.type];
            const selected = z.id === selectedId;
            return (
              <Group key={z.id}>
                <Rect
                  name="zone"
                  id={z.id}
                  x={z.x * width}
                  y={z.y * height}
                  width={z.w * width}
                  height={z.h * height}
                  stroke={color}
                  strokeWidth={selected ? 2.5 : 1.5}
                  fill={selected ? `${color}33` : `${color}1a`}
                />
                <Rect
                  x={z.x * width}
                  y={z.y * height}
                  width={16}
                  height={14}
                  fill={color}
                  listening={false}
                />
                <Text
                  x={z.x * width}
                  y={z.y * height + 2}
                  width={16}
                  align="center"
                  text={String(z.order ?? i + 1)}
                  fontSize={10}
                  fontStyle="bold"
                  fill="#fff"
                  listening={false}
                />
              </Group>
            );
          })}
          {pending ? (
            <Rect
              name="pending"
              x={pending.x * width}
              y={pending.y * height}
              width={pending.w * width}
              height={pending.h * height}
              stroke="#d1453b"
              strokeWidth={2}
              dash={[6, 4]}
              listening={false}
            />
          ) : null}
        </Layer>
      </Stage>
    </div>
  );
}
