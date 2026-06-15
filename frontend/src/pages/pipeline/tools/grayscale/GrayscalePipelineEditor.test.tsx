/**
 * GrayscalePipelineEditor.test.tsx — Task 4.2 TDD
 *
 * Covers:
 *   1. Controls render with correct data-testids (flatten toggle, converter select,
 *      CLAHE toggle, channel select)
 *   2. Resolved-source badge renders with data-testid="grayscale-resolved-source-converter"
 *   3. Selecting a converter dispatches SET_CONVERTER event (via the machine)
 *   4. Flatten toggle dispatches SET_FLATTEN; CLAHE toggle dispatches SET_CLAHE
 *   5. Channel select is visible when converter="best_channel", hidden otherwise
 *   6. Source tier badge shows correct tier text ("from: page", "from: project", etc.)
 *
 * TDD: write the test first (FAIL), then implement the editor, then verify PASS.
 *
 * @see Task 4.2 in docs/plans/ grayscale-pipeline.md
 * @see frontend/src/pages/pipeline/tools/grayscale/grayscaleConfig.ts — config types
 * @see frontend/src/machines/tools/grayscaleTool.ts — machine + events
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GrayscalePipelineEditor } from "./GrayscalePipelineEditor";
import type {
  GrayscaleDraftConfig,
  GrayscaleConverter,
} from "./grayscaleConfig";
import { GRAYSCALE_CONFIG_DEFAULTS } from "./grayscaleConfig";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const defaultDraft: GrayscaleDraftConfig = {
  ...GRAYSCALE_CONFIG_DEFAULTS,
};

/** Sources map as returned by GET .../settings/resolved */
const defaultSources: Record<string, string> = {
  converter: "registry",
  channel: "registry",
  flatten: "registry",
  clahe: "registry",
};

function renderEditor(
  props: Partial<{
    draft: GrayscaleDraftConfig;
    sources: Record<string, string>;
    onSetConverter: (c: GrayscaleConverter) => void;
    onSetFlatten: (enabled: boolean) => void;
    onSetClahe: (enabled: boolean) => void;
    onSetChannel: (ch: string) => void;
  }> = {},
) {
  return render(
    <GrayscalePipelineEditor
      draft={props.draft ?? defaultDraft}
      sources={props.sources ?? defaultSources}
      onSetConverter={props.onSetConverter ?? vi.fn()}
      onSetFlatten={props.onSetFlatten ?? vi.fn()}
      onSetClahe={props.onSetClahe ?? vi.fn()}
      onSetChannel={props.onSetChannel ?? vi.fn()}
    />,
  );
}

// ---------------------------------------------------------------------------
// 1. Controls render
// ---------------------------------------------------------------------------

describe("GrayscalePipelineEditor — controls render", () => {
  it("renders grayscale-flatten-toggle", () => {
    renderEditor();
    expect(screen.getByTestId("grayscale-flatten-toggle")).toBeDefined();
  });

  it("renders grayscale-converter-select", () => {
    renderEditor();
    expect(screen.getByTestId("grayscale-converter-select")).toBeDefined();
  });

  it("renders grayscale-clahe-toggle", () => {
    renderEditor();
    expect(screen.getByTestId("grayscale-clahe-toggle")).toBeDefined();
  });

  it("converter select has luma option", () => {
    renderEditor();
    const sel = screen.getByTestId<HTMLSelectElement>(
      "grayscale-converter-select",
    );
    const opts = Array.from(sel.options).map((o) => o.value);
    expect(opts).toContain("luma");
  });

  it("converter select has luma_bt709 option", () => {
    renderEditor();
    const sel = screen.getByTestId<HTMLSelectElement>(
      "grayscale-converter-select",
    );
    const opts = Array.from(sel.options).map((o) => o.value);
    expect(opts).toContain("luma_bt709");
  });

  it("converter select has lab_l option", () => {
    renderEditor();
    const sel = screen.getByTestId<HTMLSelectElement>(
      "grayscale-converter-select",
    );
    const opts = Array.from(sel.options).map((o) => o.value);
    expect(opts).toContain("lab_l");
  });

  it("converter select has color2gray option", () => {
    renderEditor();
    const sel = screen.getByTestId<HTMLSelectElement>(
      "grayscale-converter-select",
    );
    const opts = Array.from(sel.options).map((o) => o.value);
    expect(opts).toContain("color2gray");
  });

  it("converter select has best_channel option", () => {
    renderEditor();
    const sel = screen.getByTestId<HTMLSelectElement>(
      "grayscale-converter-select",
    );
    const opts = Array.from(sel.options).map((o) => o.value);
    expect(opts).toContain("best_channel");
  });

  it("converter select shows draft value", () => {
    renderEditor({ draft: { ...defaultDraft, converter: "lab_l" } });
    const sel = screen.getByTestId<HTMLSelectElement>(
      "grayscale-converter-select",
    );
    expect(sel.value).toBe("lab_l");
  });

  it("flatten toggle reflects draft.flatten.enabled=false by default", () => {
    renderEditor();
    const toggle = screen.getByTestId<HTMLInputElement>(
      "grayscale-flatten-toggle",
    );
    expect(toggle.checked).toBe(false);
  });

  it("flatten toggle reflects draft.flatten.enabled=true when set", () => {
    renderEditor({
      draft: {
        ...defaultDraft,
        flatten: { ...defaultDraft.flatten, enabled: true },
      },
    });
    const toggle = screen.getByTestId<HTMLInputElement>(
      "grayscale-flatten-toggle",
    );
    expect(toggle.checked).toBe(true);
  });

  it("clahe toggle reflects draft.clahe.enabled=false by default", () => {
    renderEditor();
    const toggle = screen.getByTestId<HTMLInputElement>(
      "grayscale-clahe-toggle",
    );
    expect(toggle.checked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Channel select — shown only when converter=best_channel
// ---------------------------------------------------------------------------

describe("GrayscalePipelineEditor — channel select", () => {
  it("channel select is NOT present when converter is not best_channel", () => {
    renderEditor({ draft: { ...defaultDraft, converter: "luma" } });
    expect(screen.queryByTestId("grayscale-channel-select")).toBeNull();
  });

  it("channel select IS present when converter=best_channel", () => {
    renderEditor({ draft: { ...defaultDraft, converter: "best_channel" } });
    expect(screen.getByTestId("grayscale-channel-select")).toBeDefined();
  });

  it("channel select has green/red/blue/auto options", () => {
    renderEditor({ draft: { ...defaultDraft, converter: "best_channel" } });
    const sel = screen.getByTestId<HTMLSelectElement>(
      "grayscale-channel-select",
    );
    const opts = Array.from(sel.options).map((o) => o.value);
    expect(opts).toContain("green");
    expect(opts).toContain("red");
    expect(opts).toContain("blue");
    expect(opts).toContain("auto");
  });

  it("channel select reflects draft.channel value", () => {
    renderEditor({
      draft: { ...defaultDraft, converter: "best_channel", channel: "red" },
    });
    const sel = screen.getByTestId<HTMLSelectElement>(
      "grayscale-channel-select",
    );
    expect(sel.value).toBe("red");
  });
});

// ---------------------------------------------------------------------------
// 3. Source tier badge
// ---------------------------------------------------------------------------

describe("GrayscalePipelineEditor — source tier badge", () => {
  it("renders grayscale-resolved-source-converter badge", () => {
    renderEditor();
    expect(
      screen.getByTestId("grayscale-resolved-source-converter"),
    ).toBeDefined();
  });

  it("badge shows 'from: registry' when source is registry", () => {
    renderEditor({ sources: { ...defaultSources, converter: "registry" } });
    expect(
      screen.getByTestId("grayscale-resolved-source-converter").textContent,
    ).toContain("from: registry");
  });

  it("badge shows 'from: page' when source is page", () => {
    renderEditor({ sources: { ...defaultSources, converter: "page" } });
    expect(
      screen.getByTestId("grayscale-resolved-source-converter").textContent,
    ).toContain("from: page");
  });

  it("badge shows 'from: project' when source is project", () => {
    renderEditor({ sources: { ...defaultSources, converter: "project" } });
    expect(
      screen.getByTestId("grayscale-resolved-source-converter").textContent,
    ).toContain("from: project");
  });

  it("badge shows 'from: all' when source is all", () => {
    renderEditor({ sources: { ...defaultSources, converter: "all" } });
    expect(
      screen.getByTestId("grayscale-resolved-source-converter").textContent,
    ).toContain("from: all");
  });
});

// ---------------------------------------------------------------------------
// 4. Event dispatch — selecting a converter calls onSetConverter
// ---------------------------------------------------------------------------

describe("GrayscalePipelineEditor — event dispatch", () => {
  it("selecting a different converter calls onSetConverter with the new value", () => {
    const onSetConverter = vi.fn();
    renderEditor({ onSetConverter });
    const sel = screen.getByTestId<HTMLSelectElement>(
      "grayscale-converter-select",
    );
    fireEvent.change(sel, { target: { value: "lab_l" } });
    expect(onSetConverter).toHaveBeenCalledWith("lab_l");
  });

  it("selecting best_channel calls onSetConverter with 'best_channel'", () => {
    const onSetConverter = vi.fn();
    renderEditor({ onSetConverter });
    const sel = screen.getByTestId<HTMLSelectElement>(
      "grayscale-converter-select",
    );
    fireEvent.change(sel, { target: { value: "best_channel" } });
    expect(onSetConverter).toHaveBeenCalledWith("best_channel");
  });

  it("clicking flatten toggle calls onSetFlatten with toggled value", () => {
    const onSetFlatten = vi.fn();
    renderEditor({ onSetFlatten });
    const toggle = screen.getByTestId<HTMLInputElement>(
      "grayscale-flatten-toggle",
    );
    fireEvent.click(toggle);
    expect(onSetFlatten).toHaveBeenCalledWith(true);
  });

  it("clicking clahe toggle calls onSetClahe with toggled value", () => {
    const onSetClahe = vi.fn();
    renderEditor({ onSetClahe });
    const toggle = screen.getByTestId<HTMLInputElement>(
      "grayscale-clahe-toggle",
    );
    fireEvent.click(toggle);
    expect(onSetClahe).toHaveBeenCalledWith(true);
  });

  it("changing channel select calls onSetChannel", () => {
    const onSetChannel = vi.fn();
    renderEditor({
      draft: { ...defaultDraft, converter: "best_channel" },
      onSetChannel,
    });
    const sel = screen.getByTestId<HTMLSelectElement>(
      "grayscale-channel-select",
    );
    fireEvent.change(sel, { target: { value: "blue" } });
    expect(onSetChannel).toHaveBeenCalledWith("blue");
  });
});

// ---------------------------------------------------------------------------
// 5. Machine integration — GrayscaleWorkbenchTab receives resolved config
// ---------------------------------------------------------------------------

/**
 * Integration smoke: verify that when the machine has a GrayscaleDraftConfig
 * in context.draft, the editor receives it correctly.
 *
 * We test the editor component directly (pure props) rather than mounting
 * the full machine — full machine integration is tested in GrayscaleTool.test.tsx.
 */
describe("GrayscalePipelineEditor — draft config shapes", () => {
  it("renders without error for luma_bt709 converter", () => {
    renderEditor({ draft: { ...defaultDraft, converter: "luma_bt709" } });
    const sel = screen.getByTestId<HTMLSelectElement>(
      "grayscale-converter-select",
    );
    expect(sel.value).toBe("luma_bt709");
  });

  it("renders without error for color2gray converter", () => {
    renderEditor({ draft: { ...defaultDraft, converter: "color2gray" } });
    const sel = screen.getByTestId<HTMLSelectElement>(
      "grayscale-converter-select",
    );
    expect(sel.value).toBe("color2gray");
  });

  it("renders when sources map is empty", () => {
    renderEditor({ sources: {} });
    // Badge should gracefully handle missing source key
    expect(
      screen.getByTestId("grayscale-resolved-source-converter"),
    ).toBeDefined();
  });
});
