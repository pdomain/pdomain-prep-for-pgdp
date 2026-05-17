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
 *   - §9a marquee: a mousedown on empty Stage (not on a Rect) starts
 *     a drag-rectangle; mouseup fires `onMarqueeSelect` with the
 *     word ids whose bboxes overlap the marquee. Modifier semantics:
 *     shift held → additive (union with existing selection); no
 *     modifier → replace. The overlay only emits the additive flag;
 *     the parent decides how to fold it into its selection state.
 */
import { useEffect, useRef, useState } from "react";
import { Layer, Rect, Stage } from "react-konva";
import {
  computeMarqueeSelection,
  normaliseMarquee,
  type MarqueeRect,
} from "../lib/marquee";
import type { OcrWord } from "../lib/wordOffsets";

interface Props {
  /** Pixel width of the underlying image at OCR time. */
  naturalWidth: number;
  /** Pixel height of the underlying image at OCR time. */
  naturalHeight: number;
  /** Word list from the OCR endpoint (may be empty for legacy pages). */
  words: readonly OcrWord[];
  /** Currently active word index (highlighted), or `null` for none. */
  activeWordIndex: number | null;
  /** Click handler for any word rect. */
  onWordClick: (index: number) => void;
  /**
   * Selected word ids — drawn with a distinct red stroke / fill so
   * the proofer can see what a Delete press will remove. Optional;
   * when omitted (or empty) selection styling is suppressed and the
   * overlay behaves as the pre-§9a single-active-word view.
   */
  selectedWordIds?: ReadonlySet<string>;
  /**
   * Toggle handler invoked on every word click in addition to
   * `onWordClick`. Receives the word's `id` (NOT its index) because
   * the §9a delete API addresses words by id, not index — keeping the
   * selection set keyed by id makes the round-trip trivial. Optional
   * for callers that don't need selection.
   */
  onWordToggleSelect?: (id: string) => void;
  /**
   * §9a marquee bulk-select. Fires once on mouse-up after a drag on
   * empty canvas. `additive=true` means the user held Shift while
   * dragging, so the parent should union with its existing selection;
   * `false` means a plain drag and the parent should replace. A
   * zero-extent marquee (click without drag) is suppressed and does
   * not fire this callback. Optional — call sites that don't need
   * marquee can omit and the overlay falls back to single-click only.
   */
  onMarqueeSelect?: (ids: string[], additive: boolean) => void;
  /**
   * The element whose rendered size the Stage should track. Usually
   * the `<img>` in the parent — we use a ResizeObserver on it so the
   * Stage rescales as the layout flexes.
   */
  trackElement: HTMLElement | null;
}

/**
 * Konva-event shape we actually use. Konva provides a richer object
 * (`KonvaEventObject<MouseEvent>`), but pulling the type in here would
 * require a direct `konva` import that the test mock doesn't provide.
 * Using a local minimal shape keeps the runtime free of Konva type
 * dependencies and lets the Vitest mock surface plain DOM mouse
 * events through the same prop signature.
 */
interface StageMouseEvent {
  evt: MouseEvent;
  target: {
    getStage: () => { container: () => HTMLElement } | null;
  };
}

export function WordBboxOverlay({
  naturalWidth,
  naturalHeight,
  words,
  activeWordIndex,
  onWordClick,
  selectedWordIds,
  onWordToggleSelect,
  onMarqueeSelect,
  trackElement,
}: Props) {
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const roRef = useRef<ResizeObserver | null>(null);

  // Marquee state. `anchor` is the natural-space coordinate of the
  // mousedown that started the drag, or `null` when no drag is in
  // flight. `current` tracks the live pointer for the translucent
  // preview rect; once mouseup fires we hit-test and clear both.
  const [marqueeAnchor, setMarqueeAnchor] = useState<{
    x: number;
    y: number;
    additive: boolean;
  } | null>(null);
  const [marqueeCurrent, setMarqueeCurrent] = useState<{
    x: number;
    y: number;
  } | null>(null);

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

  /**
   * Convert a DOM-pixel pointer position (relative to the Stage
   * container) into the natural pixel space the bboxes live in.
   * Every marquee handler funnels through this so the math stays in
   * one coordinate system.
   */
  const stagePointToNatural = (
    clientX: number,
    clientY: number,
    stageContainer: HTMLElement,
  ): { x: number; y: number } => {
    const r = stageContainer.getBoundingClientRect();
    const dx = clientX - r.left;
    const dy = clientY - r.top;
    return { x: dx / sx, y: dy / sy };
  };

  const handleStageMouseDown = (ev: StageMouseEvent) => {
    if (!onMarqueeSelect) return;
    // Konva's `target` for an empty-canvas hit IS the Stage; for a
    // hit on a Rect it's the Rect node. We only start a marquee on
    // the empty case so word clicks aren't shadowed.
    const stage = ev.target.getStage();
    if (!stage) return;
    // Cheap "empty canvas?" check: the Stage's own getStage() returns
    // itself; a Rect's would too, but Konva sets `evt.target` to the
    // shape node, so `ev.target === stage` distinguishes them. Mocks
    // may shape this differently; fall back to the more robust
    // "did the underlying DOM event hit the canvas container?" test.
    // The mock-friendly path: if a Rect was hit, its onMouseDown
    // would fire instead — we wire the marquee at the Stage level
    // only, and let Konva's bubbling deliver Rect clicks to their
    // own handlers.
    const container = stage.container();
    if (!container) return;
    const pt = stagePointToNatural(ev.evt.clientX, ev.evt.clientY, container);
    setMarqueeAnchor({ x: pt.x, y: pt.y, additive: ev.evt.shiftKey });
    setMarqueeCurrent({ x: pt.x, y: pt.y });
  };

  const handleStageMouseMove = (ev: StageMouseEvent) => {
    if (!marqueeAnchor) return;
    const stage = ev.target.getStage();
    if (!stage) return;
    const container = stage.container();
    if (!container) return;
    const pt = stagePointToNatural(ev.evt.clientX, ev.evt.clientY, container);
    setMarqueeCurrent({ x: pt.x, y: pt.y });
  };

  const handleStageMouseUp = (ev: StageMouseEvent) => {
    if (!marqueeAnchor || !onMarqueeSelect) {
      setMarqueeAnchor(null);
      setMarqueeCurrent(null);
      return;
    }
    const stage = ev.target.getStage();
    let endX = marqueeCurrent?.x ?? marqueeAnchor.x;
    let endY = marqueeCurrent?.y ?? marqueeAnchor.y;
    if (stage) {
      const container = stage.container();
      if (container) {
        const pt = stagePointToNatural(
          ev.evt.clientX,
          ev.evt.clientY,
          container,
        );
        endX = pt.x;
        endY = pt.y;
      }
    }
    const rect: MarqueeRect = normaliseMarquee(
      marqueeAnchor.x,
      marqueeAnchor.y,
      endX,
      endY,
    );
    setMarqueeAnchor(null);
    setMarqueeCurrent(null);
    // Suppress zero-area marquees so a stray click on empty canvas
    // doesn't clear the existing selection in the parent's
    // "replace" branch. A real drag will always produce >0 extent.
    if (rect.width <= 0 || rect.height <= 0) return;
    const ids = computeMarqueeSelection(words, rect);
    onMarqueeSelect(ids, marqueeAnchor.additive);
  };

  // Translucent preview rect for the drag-in-progress, scaled back
  // into rendered DOM space. Only rendered while an anchor exists.
  let previewRect: { x: number; y: number; w: number; h: number } | null = null;
  if (marqueeAnchor && marqueeCurrent) {
    const r = normaliseMarquee(
      marqueeAnchor.x,
      marqueeAnchor.y,
      marqueeCurrent.x,
      marqueeCurrent.y,
    );
    previewRect = {
      x: r.x * sx,
      y: r.y * sy,
      w: r.width * sx,
      h: r.height * sy,
    };
  }

  return (
    <Stage
      width={size.w}
      height={size.h}
      style={{ position: "absolute", inset: 0 }}
      onMouseDown={handleStageMouseDown}
      onMouseMove={handleStageMouseMove}
      onMouseUp={handleStageMouseUp}
    >
      <Layer>
        {words.map((w, i) => {
          const bb = w.bounding_box;
          const isActive = i === activeWordIndex;
          // Selection takes visual priority over the active highlight:
          // a proofer staging a delete needs the marked-for-deletion
          // colour to be unambiguous, even when the word is also the
          // current textarea-cursor target.
          const isSelected = !!(w.id && selectedWordIds?.has(w.id));
          let stroke: string;
          let fill: string | undefined;
          let strokeWidth: number;
          if (isSelected) {
            stroke = "#dc2626"; // red-600
            fill = "rgba(220,38,38,0.22)";
            strokeWidth = 2;
          } else if (isActive) {
            stroke = "#2563eb"; // blue-600
            fill = "rgba(37,99,235,0.18)";
            strokeWidth = 2;
          } else {
            stroke = "#94a3b8"; // slate-400
            fill = undefined;
            strokeWidth = 1;
          }
          const handleHit = () => {
            onWordClick(i);
            if (onWordToggleSelect && w.id) {
              onWordToggleSelect(w.id);
            }
          };
          return (
            <Rect
              key={w.id || i}
              x={bb.left * sx}
              y={bb.top * sy}
              width={bb.width * sx}
              height={bb.height * sy}
              stroke={stroke}
              strokeWidth={strokeWidth}
              {...(fill !== undefined && { fill })}
              listening
              onClick={handleHit}
              onTap={handleHit}
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
        {previewRect && (
          <Rect
            x={previewRect.x}
            y={previewRect.y}
            width={previewRect.w}
            height={previewRect.h}
            stroke="#6366f1" // indigo-500 — distinct from selection (red) and active (blue)
            strokeWidth={1}
            fill="rgba(99,102,241,0.10)"
            listening={false}
          />
        )}
      </Layer>
    </Stage>
  );
}
