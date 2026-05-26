/**
 * Image viewport with clickable word bounding-box overlay for
 * `TextReviewPage`.
 *
 * Phase 2.2 — migrated from raw-Konva-Stage-over-img to pdomain-ui
 * PageImageCanvas as the canvas host. Slot mapping:
 *
 *   image     — page bitmap (managed entirely by pdomain-ui)
 *   selection — word bbox Rects (visual only; listening=false on layer)
 *   tool      — marquee drag-preview Rect
 *
 * Pointer behaviour is handled via a DOM event-capture overlay div
 * (the same GAP-1 shim pattern used by pdomain-ocr-labeler-spa). pdomain-ui's
 * internal Stage drag is overridden because the event-capture div sits
 * above it and captures all mouse events first.
 *
 * Parent API change from Phase 2.2:
 *   - NEW:     `imageUrl` prop (was rendered by parent as a separate <img>)
 *   - REMOVED: `trackElement` prop (pdomain-ui handles ResizeObserver internally)
 *   - REMOVED: `naturalWidth` / `naturalHeight` are now passed as `page`
 *              dimensions to pdomain-ui, not used for manual scale math.
 *
 * Capability gaps vs plain local implementation:
 *   GAP-1: pdomain-ui's Stage has listening event handlers for its own
 *          internal drag. We override them entirely via the event-capture
 *          overlay div that sits above the Stage and captures all mouse
 *          events. pdomain-ui's internal drag never fires.
 *          TODO: when pdomain-ui adds an `onDragComplete(rect)` callback, remove
 *          the event-capture div and wire callbacks through pdomain-ui instead.
 *   GAP-2: Word bbox Rects are in the `selection` slot (Layer listening=false),
 *          so Konva hit detection does not apply. Click and hover are resolved
 *          via DOM coordinates on the event-capture overlay. Cursor changes and
 *          click dispatch are handled in the overlay's mousemove/click handlers.
 */
import { useRef, useState } from "react";
import { Rect } from "react-konva";
import { PageImageCanvas } from "@pdomain/pdomain-ui/canvas";
import {
  computeMarqueeSelection,
  normaliseMarquee,
  type MarqueeRect,
} from "../lib/marquee";
import type { OcrWord } from "../lib/wordOffsets";

interface Props {
  /** URL of the page image — rendered by pdomain-ui's image layer. */
  imageUrl: string;
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
   * when omitted (or empty) selection styling is suppressed.
   */
  selectedWordIds?: ReadonlySet<string>;
  /**
   * Toggle handler invoked on every word click in addition to
   * `onWordClick`. Receives the word's `id` (NOT its index). Optional.
   */
  onWordToggleSelect?: (id: string) => void;
  /**
   * §9a marquee bulk-select. Fires once on mouse-up after a drag on
   * empty canvas. `additive=true` means shift was held at mousedown.
   * A zero-extent drag (click) is suppressed. Optional.
   */
  onMarqueeSelect?: (ids: string[], additive: boolean) => void;
}

/** Hit-test a DOM point (in natural-pixel space) against word bboxes. */
function hitTestWord(
  naturalX: number,
  naturalY: number,
  words: readonly OcrWord[],
): number | null {
  for (let i = 0; i < words.length; i++) {
    const bb = words[i]!.bounding_box;
    if (
      naturalX >= bb.left &&
      naturalX <= bb.left + bb.width &&
      naturalY >= bb.top &&
      naturalY <= bb.top + bb.height
    ) {
      return i;
    }
  }
  return null;
}

/**
 * Image viewport with clickable word bbox overlay for TextReviewPage.
 *
 * Phase 2.2: Replaces the `<img>` + absolute-positioned raw-Konva-Stage
 * pattern with a single pdomain-ui PageImageCanvas that hosts both the image
 * layer and the word-overlay slot fills. Mouse events are handled via a
 * DOM event-capture overlay (GAP-1 shim — see file header).
 */
export function WordBboxOverlay({
  imageUrl,
  naturalWidth,
  naturalHeight,
  words,
  activeWordIndex,
  onWordClick,
  selectedWordIds,
  onWordToggleSelect,
  onMarqueeSelect,
}: Props) {
  // Marquee drag state in natural-pixel space.
  const dragAnchorRef = useRef<{
    x: number;
    y: number;
    additive: boolean;
  } | null>(null);
  const [marqueeCurrent, setMarqueeCurrent] = useState<{
    anchorX: number;
    anchorY: number;
    curX: number;
    curY: number;
  } | null>(null);

  if (!words.length) return null;
  if (!naturalWidth || !naturalHeight) return null;

  /**
   * Convert a DOM clientX/Y into natural-pixel space.
   * The event-capture overlay exactly covers the displayed canvas area.
   * Its bounding rect maps CSS pixels to displayed image pixels.
   * Multiply by (naturalWidth / displayedWidth) to get natural pixels.
   */
  const clientToNatural = (
    clientX: number,
    clientY: number,
    overlay: HTMLElement,
  ): { x: number; y: number } => {
    const r = overlay.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return { x: 0, y: 0 };
    const scaleX = naturalWidth / r.width;
    const scaleY = naturalHeight / r.height;
    return {
      x: (clientX - r.left) * scaleX,
      y: (clientY - r.top) * scaleY,
    };
  };

  // The normalised marquee preview (in natural-pixel space) for the tool slot.
  const previewRect: { x: number; y: number; w: number; h: number } | null =
    marqueeCurrent
      ? (() => {
          const r = normaliseMarquee(
            marqueeCurrent.anchorX,
            marqueeCurrent.anchorY,
            marqueeCurrent.curX,
            marqueeCurrent.curY,
          );
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        })()
      : null;

  const pdUiPage = { width: naturalWidth, height: naturalHeight };

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* ── pdomain-ui PageImageCanvas — Konva Stage host ──────────────────────
          Provides: image layer, Stage setup, ResizeObserver for container
          size, focus management. The word Rects go in the selection slot
          (visual only; Layer listening=false per pdomain-ui implementation).
          The marquee drag-preview Rect goes in the tool slot. */}
      <PageImageCanvas
        src={imageUrl}
        page={pdUiPage}
        words={[]}
        fitOnMount={true}
      >
        {{
          // ── selection slot: word bbox Rects (visual) ──────────────────
          // Rendered inside Layer name="selection" (listening=false).
          // Coordinates are in natural-pixel space — pdomain-ui's Stage applies
          // scaleX/scaleY so natural coords display at the right size.
          // Click/hover events are handled by the DOM overlay (GAP-2).
          selection: () => (
            <>
              {words.map((w, i) => {
                const bb = w.bounding_box;
                const isActive = i === activeWordIndex;
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
                return (
                  <Rect
                    key={w.id || i}
                    x={bb.left}
                    y={bb.top}
                    width={bb.width}
                    height={bb.height}
                    stroke={stroke}
                    strokeWidth={strokeWidth}
                    {...(fill !== undefined && { fill })}
                    listening={false}
                    perfectDrawEnabled={false}
                  />
                );
              })}
            </>
          ),

          // ── tool slot: marquee drag-preview Rect ──────────────────────
          // Rendered inside Layer name="tool" by pdomain-ui.
          // Coordinates in natural-pixel space.
          tool: () =>
            previewRect ? (
              <Rect
                x={previewRect.x}
                y={previewRect.y}
                width={previewRect.w}
                height={previewRect.h}
                stroke="#6366f1" // indigo-500
                strokeWidth={1}
                fill="rgba(99,102,241,0.10)"
                listening={false}
              />
            ) : null,
        }}
      </PageImageCanvas>

      {/* ── Event-capture overlay (GAP-1 shim) ─────────────────────────────
          Absolutely positioned over the entire canvas area. Captures all
          mouse events so pdomain-ui's internal Stage drag never fires.
          Handles:
            - Word click dispatch (hit-test in natural-pixel space)
            - Cursor pointer when over a word bbox
            - §9a marquee drag (mousedown → mousemove → mouseup)
          data-testid="word-bbox-overlay-capture" — used by tests. */}
      <div
        data-testid="word-bbox-overlay-capture"
        style={{
          position: "absolute",
          inset: 0,
          cursor: "default",
        }}
        onMouseDown={(e) => {
          if (!onMarqueeSelect) return;
          const pt = clientToNatural(e.clientX, e.clientY, e.currentTarget);
          dragAnchorRef.current = {
            x: pt.x,
            y: pt.y,
            additive: e.shiftKey,
          };
          setMarqueeCurrent({
            anchorX: pt.x,
            anchorY: pt.y,
            curX: pt.x,
            curY: pt.y,
          });
        }}
        onMouseMove={(e) => {
          // Update cursor when hovering over a word bbox.
          const pt = clientToNatural(e.clientX, e.clientY, e.currentTarget);
          const hit = hitTestWord(pt.x, pt.y, words);
          e.currentTarget.style.cursor = hit !== null ? "pointer" : "default";

          // Update marquee preview if a drag is in progress.
          if (!dragAnchorRef.current) return;
          setMarqueeCurrent({
            anchorX: dragAnchorRef.current.x,
            anchorY: dragAnchorRef.current.y,
            curX: pt.x,
            curY: pt.y,
          });
        }}
        onMouseUp={(e) => {
          const anchor = dragAnchorRef.current;
          const pt = clientToNatural(e.clientX, e.clientY, e.currentTarget);

          if (!anchor) {
            // Plain click with no drag in progress — dispatch word click.
            const idx = hitTestWord(pt.x, pt.y, words);
            if (idx !== null) {
              onWordClick(idx);
              if (onWordToggleSelect && words[idx]?.id) {
                onWordToggleSelect(words[idx].id);
              }
            }
            setMarqueeCurrent(null);
            return;
          }

          dragAnchorRef.current = null;
          setMarqueeCurrent(null);

          const rect: MarqueeRect = normaliseMarquee(
            anchor.x,
            anchor.y,
            pt.x,
            pt.y,
          );

          // Suppress zero-area drags — treat as a click.
          if (rect.width <= 0 || rect.height <= 0) {
            const idx = hitTestWord(pt.x, pt.y, words);
            if (idx !== null) {
              onWordClick(idx);
              if (onWordToggleSelect && words[idx]?.id) {
                onWordToggleSelect(words[idx].id);
              }
            }
            return;
          }

          if (!onMarqueeSelect) return;
          const ids = computeMarqueeSelection(words, rect);
          onMarqueeSelect(ids, anchor.additive);
        }}
        onMouseLeave={() => {
          dragAnchorRef.current = null;
          setMarqueeCurrent(null);
        }}
        aria-hidden="true"
      />
    </div>
  );
}
