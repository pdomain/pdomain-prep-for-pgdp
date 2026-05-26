/**
 * Component-mount tests for `WordBboxOverlay` (Phase 2.2).
 *
 * Phase 2.2 migration: The component now wraps pdomain-ui's PageImageCanvas
 * rather than rendering its own raw Konva Stage. Pointer events are
 * handled via a DOM event-capture overlay (GAP-1 shim, see component
 * header). Word bboxes are rendered as Konva Rects in the `selection`
 * slot (visual only; hit detection is DOM-based).
 *
 * Test strategy (unchanged from pre-Phase-2.2 spirit):
 *   - Mock `@pdomain/pdomain-ui/canvas` so that the `selection` and
 *     `tool` slot fills are invoked and rendered as plain DOM elements.
 *   - Mock `react-konva` with div-based stubs so jsdom can render the
 *     Konva primitives inside the slot fills.
 *   - The component's actual logic — bbox math, early-return guards, click
 *     dispatch, marquee drag — runs unmodified; only canvas substrates
 *     are swapped out.
 *
 * Key behavioural differences from pre-Phase-2.2:
 *   - Click / hover events are handled by the DOM overlay div
 *     (`data-testid="word-bbox-overlay-capture"`), not by Konva Rect
 *     onClick. Hit detection is the `hitTestWord` function in the component.
 *   - Marquee dispatch uses the same overlay div.
 *   - `trackElement` prop removed; `imageUrl` prop added.
 *   - `naturalWidth/naturalHeight` still required; early-return guards
 *     unchanged.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { OcrWord } from "../lib/wordOffsets";
import { WordBboxOverlay } from "./WordBboxOverlay";

// ── Mock @pdomain/pdomain-ui/canvas ──────────────────────────────────────
// The PageImageCanvas from pdomain-ui hosts the Stage. We stub it with a minimal
// div that invokes the `selection` and `tool` slot fills so their Konva
// content renders into the DOM for inspection.
vi.mock("@pdomain/pdomain-ui/canvas", () => {
  return {
    PageImageCanvas: ({
      children,
    }: {
      src?: string;
      page?: { width: number; height: number };
      words?: unknown[];
      fitOnMount?: boolean;
      children?: {
        selection?: () => ReactNode;
        tool?: () => ReactNode;
      };
    }) => (
      <div data-testid="pdomain-ui-canvas">
        <div data-testid="pdomain-ui-canvas-selection">
          {children?.selection?.()}
        </div>
        <div data-testid="pdomain-ui-canvas-tool">{children?.tool?.()}</div>
      </div>
    ),
  };
});

// ── Mock react-konva ─────────────────────────────────────────────────────────
// Turns each Konva primitive into a plain DOM element. `Rect` surfaces
// props as data-* attributes so tests can assert positioning + styles.
vi.mock("react-konva", () => {
  return {
    Stage: ({ children }: { children?: ReactNode }) => (
      <div data-testid="konva-stage">{children}</div>
    ),
    Layer: ({ children }: { children?: ReactNode }) => (
      <div data-testid="konva-layer">{children}</div>
    ),
    Rect: ({
      x,
      y,
      width,
      height,
      stroke,
    }: {
      x: number;
      y: number;
      width: number;
      height: number;
      stroke: string;
    }) => (
      <div
        data-testid="konva-rect"
        data-x={String(x)}
        data-y={String(y)}
        data-width={String(width)}
        data-height={String(height)}
        data-stroke={stroke}
      />
    ),
  };
});

function makeWord(overrides: Partial<OcrWord> & { id: string }): OcrWord {
  return {
    text: "word",
    confidence: 0.99,
    bounding_box: { left: 0, top: 0, width: 10, height: 10 },
    ...overrides,
  };
}

/**
 * The event-capture overlay uses `getBoundingClientRect` to convert
 * client coordinates to natural-pixel space. Stub it so tests get
 * deterministic coordinate math.
 *
 * Given naturalWidth=1000, naturalHeight=1500 and displayedSize 500×750:
 *   scaleX = 1000/500 = 2, scaleY = 1500/750 = 2
 *   client (25, 25) → natural (50, 50)
 */
function stubOverlayBoundingRect(
  overlay: HTMLElement,
  displayW: number,
  displayH: number,
) {
  overlay.getBoundingClientRect = () => ({
    width: displayW,
    height: displayH,
    top: 0,
    left: 0,
    right: displayW,
    bottom: displayH,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
}

const BASE_PROPS = {
  imageUrl: "/cdn/test-image.jpg",
  naturalWidth: 1000,
  naturalHeight: 1500,
};

describe("WordBboxOverlay (Phase 2.2)", () => {
  it("renders nothing when the word list is empty", () => {
    const { container } = render(
      <WordBboxOverlay
        {...BASE_PROPS}
        words={[]}
        activeWordIndex={null}
        onWordClick={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when natural image dimensions are zero", () => {
    const words: OcrWord[] = [
      makeWord({
        id: "w0",
        bounding_box: { left: 0, top: 0, width: 5, height: 5 },
      }),
    ];
    const { container } = render(
      <WordBboxOverlay
        imageUrl="/cdn/test.jpg"
        naturalWidth={0}
        naturalHeight={0}
        words={words}
        activeWordIndex={null}
        onWordClick={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders word bbox Rects in natural-pixel space (no sx/sy scaling needed)", () => {
    // Phase 2.2: pdomain-ui's Stage applies scaleX/scaleY at the Stage level,
    // so word bbox coordinates are passed straight through to Rect x/y/w/h
    // without any sx/sy multiplication in the slot fill.
    const words: OcrWord[] = [
      makeWord({
        id: "w0",
        bounding_box: { left: 200, top: 600, width: 100, height: 40 },
      }),
      makeWord({
        id: "w1",
        bounding_box: { left: 400, top: 900, width: 60, height: 30 },
      }),
    ];

    render(
      <WordBboxOverlay
        {...BASE_PROPS}
        words={words}
        activeWordIndex={1}
        onWordClick={() => {}}
      />,
    );

    const rects = screen.getAllByTestId("konva-rect");
    expect(rects).toHaveLength(2);
    const rect0 = rects[0]!;
    const rect1 = rects[1]!;

    // Natural-pixel coords — no scaling (pdomain-ui handles it).
    expect(rect0.dataset["x"]).toBe("200");
    expect(rect0.dataset["y"]).toBe("600");
    expect(rect0.dataset["width"]).toBe("100");
    expect(rect0.dataset["height"]).toBe("40");

    expect(rect1.dataset["x"]).toBe("400");
    expect(rect1.dataset["y"]).toBe("900");
    expect(rect1.dataset["width"]).toBe("60");
    expect(rect1.dataset["height"]).toBe("30");

    // Active highlight (word at index 1).
    expect(rect1.dataset["stroke"]).toBe("#2563eb");
    expect(rect0.dataset["stroke"]).toBe("#94a3b8");
  });

  it("invokes onWordClick when the DOM overlay is clicked over a word bbox", async () => {
    const onWordClick = vi.fn();
    const words: OcrWord[] = [
      // Word at natural (100,100,80,30) — displayed in 500×750 (scale 2)
      // → DOM click at (60, 65) maps to natural (120, 130) → inside word.
      makeWord({
        id: "w0",
        bounding_box: { left: 100, top: 100, width: 80, height: 30 },
      }),
      makeWord({
        id: "w1",
        bounding_box: { left: 400, top: 400, width: 60, height: 30 },
      }),
    ];

    render(
      <WordBboxOverlay
        {...BASE_PROPS}
        words={words}
        activeWordIndex={null}
        onWordClick={onWordClick}
      />,
    );

    const overlay = screen.getByTestId("word-bbox-overlay-capture");
    stubOverlayBoundingRect(overlay, 500, 750);

    // Click at DOM (60, 65) → natural (120, 130) — inside w0.
    // We use fireEvent.mouseUp (no mouseDown) to simulate a simple click.
    fireEvent.mouseUp(overlay, { clientX: 60, clientY: 65 });

    expect(onWordClick).toHaveBeenCalledTimes(1);
    expect(onWordClick).toHaveBeenCalledWith(0);
  });

  it("invokes onWordToggleSelect alongside onWordClick when clicking a word", async () => {
    const onWordClick = vi.fn();
    const onWordToggleSelect = vi.fn();
    const words: OcrWord[] = [
      makeWord({
        id: "w0",
        bounding_box: { left: 100, top: 100, width: 80, height: 30 },
      }),
    ];

    render(
      <WordBboxOverlay
        {...BASE_PROPS}
        words={words}
        activeWordIndex={null}
        onWordClick={onWordClick}
        onWordToggleSelect={onWordToggleSelect}
      />,
    );

    const overlay = screen.getByTestId("word-bbox-overlay-capture");
    stubOverlayBoundingRect(overlay, 500, 750);

    // DOM (60, 65) → natural (120, 130) → inside w0.
    fireEvent.mouseUp(overlay, { clientX: 60, clientY: 65 });

    expect(onWordClick).toHaveBeenCalledWith(0);
    expect(onWordToggleSelect).toHaveBeenCalledWith("w0");
  });

  it("does not invoke onWordClick when clicking empty canvas", () => {
    const onWordClick = vi.fn();
    const words: OcrWord[] = [
      makeWord({
        id: "w0",
        bounding_box: { left: 100, top: 100, width: 80, height: 30 },
      }),
    ];

    render(
      <WordBboxOverlay
        {...BASE_PROPS}
        words={words}
        activeWordIndex={null}
        onWordClick={onWordClick}
      />,
    );

    const overlay = screen.getByTestId("word-bbox-overlay-capture");
    stubOverlayBoundingRect(overlay, 500, 750);

    // Click at DOM (0, 0) → natural (0, 0) — outside w0.
    fireEvent.mouseUp(overlay, { clientX: 0, clientY: 0 });

    expect(onWordClick).not.toHaveBeenCalled();
  });

  it("invokes onMarqueeSelect with the ids of words intersecting the drag rect", () => {
    const onMarqueeSelect = vi.fn();
    const words: OcrWord[] = [
      // Two words within the marquee, one outside.
      makeWord({
        id: "w0",
        bounding_box: { left: 100, top: 100, width: 80, height: 30 },
      }),
      makeWord({
        id: "w1",
        bounding_box: { left: 200, top: 110, width: 60, height: 30 },
      }),
      makeWord({
        id: "w2",
        bounding_box: { left: 700, top: 700, width: 50, height: 30 },
      }),
    ];

    render(
      <WordBboxOverlay
        {...BASE_PROPS}
        words={words}
        activeWordIndex={null}
        onWordClick={() => {}}
        onMarqueeSelect={onMarqueeSelect}
      />,
    );

    const overlay = screen.getByTestId("word-bbox-overlay-capture");
    // displayedSize 500×750; naturalWidth=1000 → scaleX=2, scaleY=2
    // DOM (25, 25) → natural (50, 50)
    // DOM (150, 80) → natural (300, 160)
    // That marquee covers w0 (100,100→180,130) and w1 (200,110→260,140)
    // but NOT w2 (700,700→750,730).
    stubOverlayBoundingRect(overlay, 500, 750);

    fireEvent.mouseDown(overlay, { clientX: 25, clientY: 25, shiftKey: false });
    fireEvent.mouseMove(overlay, { clientX: 150, clientY: 80 });
    fireEvent.mouseUp(overlay, { clientX: 150, clientY: 80 });

    expect(onMarqueeSelect).toHaveBeenCalledTimes(1);
    expect(onMarqueeSelect).toHaveBeenCalledWith(["w0", "w1"], false);
  });

  it("passes additive=true when shift is held during marquee mousedown", () => {
    const onMarqueeSelect = vi.fn();
    const words: OcrWord[] = [
      makeWord({
        id: "w0",
        bounding_box: { left: 100, top: 100, width: 80, height: 30 },
      }),
    ];

    render(
      <WordBboxOverlay
        {...BASE_PROPS}
        words={words}
        activeWordIndex={null}
        onWordClick={() => {}}
        onMarqueeSelect={onMarqueeSelect}
      />,
    );

    const overlay = screen.getByTestId("word-bbox-overlay-capture");
    stubOverlayBoundingRect(overlay, 500, 750);

    fireEvent.mouseDown(overlay, { clientX: 25, clientY: 25, shiftKey: true });
    fireEvent.mouseMove(overlay, { clientX: 150, clientY: 80 });
    fireEvent.mouseUp(overlay, { clientX: 150, clientY: 80 });

    expect(onMarqueeSelect).toHaveBeenCalledWith(["w0"], true);
  });

  it("renders pdomain-ui PageImageCanvas with the image URL and page dimensions", () => {
    const words: OcrWord[] = [
      makeWord({
        id: "w0",
        bounding_box: { left: 0, top: 0, width: 10, height: 10 },
      }),
    ];

    render(
      <WordBboxOverlay
        imageUrl="/cdn/some-page.jpg"
        naturalWidth={800}
        naturalHeight={1200}
        words={words}
        activeWordIndex={null}
        onWordClick={() => {}}
      />,
    );

    // The pdomain-ui canvas mock renders this testid.
    expect(screen.getByTestId("pdomain-ui-canvas")).toBeInTheDocument();
    // Selection slot renders the word Rects.
    expect(
      screen.getByTestId("pdomain-ui-canvas-selection"),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("konva-rect")).toHaveLength(1);
  });

  it("suppresses zero-area drag (simple click) from firing onMarqueeSelect", () => {
    const onMarqueeSelect = vi.fn();
    const words: OcrWord[] = [
      makeWord({
        id: "w0",
        bounding_box: { left: 100, top: 100, width: 80, height: 30 },
      }),
    ];

    render(
      <WordBboxOverlay
        {...BASE_PROPS}
        words={words}
        activeWordIndex={null}
        onWordClick={() => {}}
        onMarqueeSelect={onMarqueeSelect}
      />,
    );

    const overlay = screen.getByTestId("word-bbox-overlay-capture");
    stubOverlayBoundingRect(overlay, 500, 750);

    // mouseDown + mouseUp at the same point → zero-extent marquee.
    fireEvent.mouseDown(overlay, { clientX: 50, clientY: 50 });
    fireEvent.mouseUp(overlay, { clientX: 50, clientY: 50 });

    expect(onMarqueeSelect).not.toHaveBeenCalled();
  });
});
