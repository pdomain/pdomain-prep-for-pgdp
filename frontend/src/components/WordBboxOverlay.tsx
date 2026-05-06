/**
 * Konva-based clickable bounding-box overlay for OCR words on the
 * `TextReviewPage` source image.
 *
 * Layout contract (set by the parent):
 *   - The `<img>` is the layout-driver (decides container width/height
 *     via `object-contain`).
 *   - This Stage is `position: absolute; inset: 0` on top of that
 *     image inside a relatively-positioned wrapper.
 *   - Word coordinates are in the image's *natural* pixel space; we
 *     scale to the current rendered DOM size of the wrapper.
 *
 * Pointer behaviour:
 *   - Stage covers the image absolutely; the image has no click
 *     handlers, so accepting pointer events on the canvas (rather
 *     than the image) is fine. Rects use `listening` for hit
 *     detection inside the canvas.
 */
import { useEffect, useRef, useState } from "react";
import { Layer, Rect, Stage } from "react-konva";
import type { OcrWord } from "../lib/wordOffsets";

interface Props {
  /** Pixel width of the underlying image at OCR time. */
  naturalWidth: number;
  /** Pixel height of the underlying image at OCR time. */
  naturalHeight: number;
  /** Word list from the OCR endpoint (may be empty for legacy pages). */
  words: ReadonlyArray<OcrWord>;
  /** Currently active word index (highlighted), or `null` for none. */
  activeWordIndex: number | null;
  /** Click handler for any word rect. */
  onWordClick: (index: number) => void;
  /**
   * The element whose rendered size the Stage should track. Usually
   * the `<img>` in the parent — we use a ResizeObserver on it so the
   * Stage rescales as the layout flexes.
   */
  trackElement: HTMLElement | null;
}

export function WordBboxOverlay({
  naturalWidth,
  naturalHeight,
  words,
  activeWordIndex,
  onWordClick,
  trackElement,
}: Props) {
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const roRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    if (!trackElement) return;
    const update = () => {
      const r = trackElement.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(trackElement);
    roRef.current = ro;
    return () => {
      ro.disconnect();
      roRef.current = null;
    };
  }, [trackElement]);

  if (!words.length) return null;
  if (!naturalWidth || !naturalHeight) return null;
  if (!size.w || !size.h) {
    // Render a degenerate Stage so the parent layout is stable; the
    // ResizeObserver will promote it on the next paint.
    return <Stage width={0} height={0} />;
  }

  const sx = size.w / naturalWidth;
  const sy = size.h / naturalHeight;

  return (
    <Stage
      width={size.w}
      height={size.h}
      style={{ position: "absolute", inset: 0 }}
    >
      <Layer>
        {words.map((w, i) => {
          const bb = w.bounding_box;
          const isActive = i === activeWordIndex;
          const stroke = isActive ? "#2563eb" : "#94a3b8"; // blue-600 vs slate-400
          const fill = isActive ? "rgba(37,99,235,0.18)" : undefined;
          const strokeWidth = isActive ? 2 : 1;
          return (
            <Rect
              key={w.id || i}
              x={bb.left * sx}
              y={bb.top * sy}
              width={bb.width * sx}
              height={bb.height * sy}
              stroke={stroke}
              strokeWidth={strokeWidth}
              fill={fill}
              listening
              onClick={() => onWordClick(i)}
              onTap={() => onWordClick(i)}
              onMouseEnter={(e) => {
                const stage = e.target.getStage();
                const c = stage?.container();
                if (c) c.style.cursor = "pointer";
              }}
              onMouseLeave={(e) => {
                const stage = e.target.getStage();
                const c = stage?.container();
                if (c) c.style.cursor = "";
              }}
              // Re-enable hit detection per rect (Stage container has
              // pointer-events:none so clicks fall through the gaps).
              perfectDrawEnabled={false}
            />
          );
        })}
      </Layer>
    </Stage>
  );
}
