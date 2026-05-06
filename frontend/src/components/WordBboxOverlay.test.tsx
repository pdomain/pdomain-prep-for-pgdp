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
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { OcrWord } from "../lib/wordOffsets";
import { WordBboxOverlay } from "./WordBboxOverlay";

// Mock react-konva BEFORE the component imports it. The mock turns
// each Konva primitive into a plain DOM element so jsdom can render
// it and Testing-Library can query it. `Rect` props are stringified
// onto data attributes so the test can assert positioning + dispatch
// click handlers without a canvas context.
vi.mock("react-konva", () => {
  return {
    Stage: ({
      children,
      width,
      height,
    }: {
      children?: ReactNode;
      width: number;
      height: number;
    }) => (
      <div
        data-testid="konva-stage"
        data-width={String(width)}
        data-height={String(height)}
      >
        {children}
      </div>
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
  el.getBoundingClientRect = () =>
    ({
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
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
      makeWord({ id: "w0", bounding_box: { left: 0, top: 0, width: 5, height: 5 } }),
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

    expect(rects[0].dataset.x).toBe("100");
    expect(rects[0].dataset.y).toBe("300");
    expect(rects[0].dataset.width).toBe("50");
    expect(rects[0].dataset.height).toBe("20");

    expect(rects[1].dataset.x).toBe("200");
    expect(rects[1].dataset.y).toBe("450");
    expect(rects[1].dataset.width).toBe("30");
    expect(rects[1].dataset.height).toBe("15");

    // Active highlight wired through to stroke colour (the only
    // styling assertion — proves the `activeWordIndex` prop reaches
    // the right rect).
    expect(rects[1].dataset.stroke).toBe("#2563eb");
    expect(rects[0].dataset.stroke).toBe("#94a3b8");
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
    await user.click(rects[1]);

    expect(onWordClick).toHaveBeenCalledTimes(1);
    expect(onWordClick).toHaveBeenCalledWith(1);
  });
});
