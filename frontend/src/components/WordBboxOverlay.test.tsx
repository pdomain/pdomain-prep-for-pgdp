/**
 * Component-mount tests for `WordBboxOverlay` — roadmap §6 deferred
 * Vitest coverage, layered on the §9 toolchain (msw + Testing-Library).
 *
 * `react-konva` renders to a real `<canvas>` element, which jsdom
 * supports only as a stub. Rather than pull in the `canvas` native
 * dependency, we mock `react-konva` with simple `<div>` placeholders
 * that surface the props back to the DOM via `data-*` attributes.
 * The component's actual logic — bbox positioning math, the
 * empty-words / unmeasured-size guards, and the click-handler wiring
 * — runs unmodified; only the canvas substrate is swapped out.
 *
 * Scope is the smallest useful slice: branch coverage for the two
 * "render nothing" guards, the scaling math on a happy-path render,
 * and the `onWordClick` dispatch. The active-word highlight styling
 * is intentionally out of scope (it's a colour string, not behaviour).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { OcrWord } from "../lib/wordOffsets";
import { WordBboxOverlay } from "./WordBboxOverlay";

// Mock react-konva BEFORE the component imports it. The mock turns
// each Konva primitive into a plain DOM element so jsdom can render
// it and Testing-Library can query it. `Rect` props are stringified
// onto data attributes so the test can assert positioning + dispatch
// click handlers without a canvas context.
// Minimal Konva-event shape the overlay's marquee handlers expect.
// Stage handlers receive `{evt, target}`; our mock synthesises this
// from a plain DOM mousedown/move/up so the test can dispatch
// pointer events without a real canvas.
interface FakeKonvaEvent {
  evt: MouseEvent;
  target: {
    getStage: () => { container: () => HTMLElement } | null;
  };
}

vi.mock("react-konva", () => {
  return {
    Stage: ({
      children,
      width,
      height,
      onMouseDown,
      onMouseMove,
      onMouseUp,
    }: {
      children?: ReactNode;
      width: number;
      height: number;
      onMouseDown?: (e: FakeKonvaEvent) => void;
      onMouseMove?: (e: FakeKonvaEvent) => void;
      onMouseUp?: (e: FakeKonvaEvent) => void;
    }) => {
      // Build the fake Konva event lazily on each callback so the
      // ref captures the current container element. The container is
      // the stage div itself; tests stub its `getBoundingClientRect`.
      const wrap = (cb: ((e: FakeKonvaEvent) => void) | undefined) =>
        cb
          ? (e: ReactMouseEvent<HTMLDivElement>) => {
              const container = e.currentTarget;
              cb({
                evt: e.nativeEvent,
                target: {
                  getStage: () => ({ container: () => container }),
                },
              });
            }
          : undefined;
      return (
        <div
          data-testid="konva-stage"
          data-width={String(width)}
          data-height={String(height)}
          onMouseDown={wrap(onMouseDown)}
          onMouseMove={wrap(onMouseMove)}
          onMouseUp={wrap(onMouseUp)}
        >
          {children}
        </div>
      );
    },
    Layer: ({ children }: { children?: ReactNode }) => (
      <div data-testid="konva-layer">{children}</div>
    ),
    Rect: ({
      x,
      y,
      width,
      height,
      stroke,
      onClick,
    }: {
      x: number;
      y: number;
      width: number;
      height: number;
      stroke: string;
      onClick?: () => void;
    }) => (
      <div
        data-testid="konva-rect"
        data-x={String(x)}
        data-y={String(y)}
        data-width={String(width)}
        data-height={String(height)}
        data-stroke={stroke}
        onClick={onClick}
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
 * Build a track element whose `getBoundingClientRect` returns a fixed
 * size, so the component's initial sync `update()` (which runs before
 * the ResizeObserver attaches) sets `size` to a non-zero value and
 * the happy-path branch renders.
 */
function makeTrackElement(width: number, height: number): HTMLElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () => ({
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  document.body.appendChild(el);
  return el;
}

describe("WordBboxOverlay", () => {
  it("renders nothing when the word list is empty", () => {
    const { container } = render(
      <WordBboxOverlay
        naturalWidth={1000}
        naturalHeight={1500}
        words={[]}
        activeWordIndex={null}
        onWordClick={() => {}}
        trackElement={makeTrackElement(500, 750)}
      />,
    );
    // `null` from a component → no DOM nodes rendered into the wrapper.
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
        naturalWidth={0}
        naturalHeight={0}
        words={words}
        activeWordIndex={null}
        onWordClick={() => {}}
        trackElement={makeTrackElement(500, 750)}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("scales bbox coordinates from natural pixel space to the rendered DOM size", () => {
    // Natural 1000×1500, rendered 500×750 → sx=sy=0.5. A bbox at
    // (200, 600, 100×40) should land at (100, 300, 50×20).
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
        naturalWidth={1000}
        naturalHeight={1500}
        words={words}
        activeWordIndex={1}
        onWordClick={() => {}}
        trackElement={makeTrackElement(500, 750)}
      />,
    );

    const rects = screen.getAllByTestId("konva-rect");
    expect(rects).toHaveLength(2);
    // noUncheckedIndexedAccess: length checked above
    const rect0 = rects[0]!;
    const rect1 = rects[1]!;

    expect(rect0.dataset["x"]).toBe("100");
    expect(rect0.dataset["y"]).toBe("300");
    expect(rect0.dataset["width"]).toBe("50");
    expect(rect0.dataset["height"]).toBe("20");

    expect(rect1.dataset["x"]).toBe("200");
    expect(rect1.dataset["y"]).toBe("450");
    expect(rect1.dataset["width"]).toBe("30");
    expect(rect1.dataset["height"]).toBe("15");

    // Active highlight wired through to stroke colour (the only
    // styling assertion — proves the `activeWordIndex` prop reaches
    // the right rect).
    expect(rect1.dataset["stroke"]).toBe("#2563eb");
    expect(rect0.dataset["stroke"]).toBe("#94a3b8");
  });

  it("invokes onWordClick with the rect's word index when a rect is clicked", async () => {
    const onWordClick = vi.fn();
    const words: OcrWord[] = [
      makeWord({ id: "w0" }),
      makeWord({ id: "w1" }),
      makeWord({ id: "w2" }),
    ];

    render(
      <WordBboxOverlay
        naturalWidth={1000}
        naturalHeight={1500}
        words={words}
        activeWordIndex={null}
        onWordClick={onWordClick}
        trackElement={makeTrackElement(500, 750)}
      />,
    );

    const user = userEvent.setup();
    const rects = screen.getAllByTestId("konva-rect");
    // noUncheckedIndexedAccess: getAllByTestId guarantees non-empty
    await user.click(rects[1]!);

    expect(onWordClick).toHaveBeenCalledTimes(1);
    expect(onWordClick).toHaveBeenCalledWith(1);
  });

  // §9a marquee bulk-select. The full Konva event surface isn't
  // available here (the mock substitutes plain divs), but the
  // overlay reads only `evt.clientX` / `evt.clientY` and
  // `target.getStage().container()` from the event payload — both of
  // which the mock synthesises faithfully from React's synthetic
  // mouse events. The runtime path (Konva on a real canvas) shares
  // the same handler bodies, so this tests the actual production
  // logic minus the canvas substrate.
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
        naturalWidth={1000}
        naturalHeight={1500}
        words={words}
        activeWordIndex={null}
        onWordClick={() => {}}
        onMarqueeSelect={onMarqueeSelect}
        trackElement={makeTrackElement(500, 750)}
      />,
    );

    const stage = screen.getByTestId("konva-stage");
    // Stub the stage's getBoundingClientRect so client→natural math
    // is deterministic. Stage container at origin, 500×750 (matches
    // the rendered size that the natural→DOM scaling assumes).
    stage.getBoundingClientRect = () => ({
      width: 500,
      height: 750,
      top: 0,
      left: 0,
      right: 500,
      bottom: 750,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    // sx=sy=0.5 → DOM (25, 25) → natural (50, 50); DOM (150, 80) →
    // natural (300, 160). That marquee fully covers w0 (100,100→180,130)
    // and w1 (200,110→260,140), but not w2.
    fireEvent.mouseDown(stage, { clientX: 25, clientY: 25, shiftKey: false });
    fireEvent.mouseMove(stage, { clientX: 150, clientY: 80 });
    fireEvent.mouseUp(stage, { clientX: 150, clientY: 80 });

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
        naturalWidth={1000}
        naturalHeight={1500}
        words={words}
        activeWordIndex={null}
        onWordClick={() => {}}
        onMarqueeSelect={onMarqueeSelect}
        trackElement={makeTrackElement(500, 750)}
      />,
    );

    const stage = screen.getByTestId("konva-stage");
    stage.getBoundingClientRect = () => ({
      width: 500,
      height: 750,
      top: 0,
      left: 0,
      right: 500,
      bottom: 750,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.mouseDown(stage, { clientX: 25, clientY: 25, shiftKey: true });
    fireEvent.mouseMove(stage, { clientX: 150, clientY: 80 });
    fireEvent.mouseUp(stage, { clientX: 150, clientY: 80 });

    expect(onMarqueeSelect).toHaveBeenCalledWith(["w0"], true);
  });
});
