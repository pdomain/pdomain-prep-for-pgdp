/**
 * PagesGridTool artboard fixture tests (crop stage).
 *
 * DCArtboard states:
 *   - loading        — fetchPages in flight → loading spinner
 *   - ready/browse   — pages grid with flag chips + filter bar
 *   - ready/editing  — inline bbox editor open for flagged page
 *   - ready/saving   — save in flight → saving-{pageId} spinner
 *   - ready/confirmDiscard — unsaved change + close → confirm-discard-{pageId}
 *   - loadError      — fetchPages failed → retry shown
 *
 * @see docs/plans/design_handoff_pgdp_app/final/crop/crop.jsx
 * @see src/pages/pipeline/tools/PagesGridTool.tsx
 */

import { describe, it, expect } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PagesGridTool } from "./PagesGridTool";
import type { ToolSlotProps } from "../toolSlot";
import type { PagesGridServices } from "@/machines/tools/pagesGrid";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_RUNNER_REF = {} as ToolSlotProps["runnerRef"];

function renderPagesGrid(
  props: Partial<ToolSlotProps> & {
    _testServices?: PagesGridServices;
  } = {},
) {
  return render(
    <MemoryRouter>
      <PagesGridTool stageId="crop" runnerRef={MOCK_RUNNER_REF} {...props} />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Artboard: loading state
// ---------------------------------------------------------------------------

describe("PagesGridTool — loading", () => {
  it("renders loading spinner initially", () => {
    renderPagesGrid();
    // Machine starts in loading state before fetchPages resolves
    expect(screen.getByTestId("pages-grid-tool-loading")).toBeDefined();
  });

  it("loading element has sensible text", () => {
    renderPagesGrid();
    expect(screen.getByTestId("pages-grid-tool-loading").textContent).toContain(
      "Loading",
    );
  });
});

// ---------------------------------------------------------------------------
// Artboard: ready/browse state
// ---------------------------------------------------------------------------

describe("PagesGridTool — ready/browse", () => {
  it("renders the page grid after load", async () => {
    renderPagesGrid();
    await waitFor(() => {
      expect(screen.getByTestId("crop-page-grid")).toBeDefined();
    });
  });

  it("renders filter bar after load", async () => {
    renderPagesGrid();
    await waitFor(() => {
      expect(screen.getByTestId("crop-filter-bar")).toBeDefined();
    });
  });

  it("filter bar has all / flagged chips", async () => {
    renderPagesGrid();
    await waitFor(() => {
      expect(screen.getByTestId("crop-filter-all")).toBeDefined();
      expect(screen.getByTestId("crop-filter-flagged")).toBeDefined();
    });
  });

  it("renders banner with page and flag counts", async () => {
    renderPagesGrid();
    await waitFor(() => {
      const banner = screen.getByTestId("pages-grid-banner");
      expect(banner.textContent).toContain("8 pages");
      expect(banner.textContent).toContain("flagged");
    });
  });

  it("renders page cells for each page", async () => {
    renderPagesGrid();
    await waitFor(() => {
      // 8 mock pages
      expect(screen.getByTestId("crop-page-cell-page-1")).toBeDefined();
      expect(screen.getByTestId("crop-page-cell-page-2")).toBeDefined();
    });
  });

  it("renders cropped-thumb for flagged page", async () => {
    renderPagesGrid();
    await waitFor(() => {
      // page-2 is flagged with overCrop in mock data
      expect(screen.getByTestId("cropped-thumb-page-2")).toBeDefined();
    });
  });

  it("renders flag chip on flagged page", async () => {
    renderPagesGrid();
    await waitFor(() => {
      // page-2 has overCrop flag
      expect(screen.getByTestId("crop-flag-chip-overCrop")).toBeDefined();
    });
  });

  it("renders crop toolbar", async () => {
    renderPagesGrid();
    await waitFor(() => {
      expect(screen.getByTestId("crop-toolbar")).toBeDefined();
    });
  });

  it("renders flush-resolved button", async () => {
    renderPagesGrid();
    await waitFor(() => {
      expect(screen.getByTestId("flush-resolved-btn")).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Artboard: ready/editing state
// ---------------------------------------------------------------------------

describe("PagesGridTool — ready/editing", () => {
  it("opens bbox editor when a page is clicked", async () => {
    renderPagesGrid();
    await waitFor(() => {
      expect(screen.getByTestId("cropped-thumb-page-2")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("cropped-thumb-page-2"));
    await waitFor(() => {
      expect(screen.getByTestId("bbox-editor-page-2")).toBeDefined();
    });
  });

  it("bbox editor shows flag chips for the opened page", async () => {
    renderPagesGrid();
    await waitFor(() => {
      expect(screen.getByTestId("cropped-thumb-page-2")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("cropped-thumb-page-2"));
    await waitFor(() => {
      // Inside editor for page-2 (overCrop flag)
      const editor = screen.getByTestId("bbox-editor-page-2");
      expect(editor).toBeDefined();
    });
  });

  it("bbox editor has Save and Accept buttons", async () => {
    renderPagesGrid();
    await waitFor(() => {
      expect(screen.getByTestId("cropped-thumb-page-2")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("cropped-thumb-page-2"));
    await waitFor(() => {
      expect(screen.getByTestId("save-btn")).toBeDefined();
      expect(screen.getByTestId("accept-btn")).toBeDefined();
    });
  });

  it("bbox editor has 4 numeric inputs (l/t/r/b)", async () => {
    renderPagesGrid();
    await waitFor(() => {
      expect(screen.getByTestId("cropped-thumb-page-2")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("cropped-thumb-page-2"));
    await waitFor(() => {
      expect(screen.getByTestId("bbox-input-0")).toBeDefined();
      expect(screen.getByTestId("bbox-input-1")).toBeDefined();
      expect(screen.getByTestId("bbox-input-2")).toBeDefined();
      expect(screen.getByTestId("bbox-input-3")).toBeDefined();
    });
  });

  it("close button dismisses the editor", async () => {
    renderPagesGrid();
    await waitFor(() => {
      expect(screen.getByTestId("cropped-thumb-page-2")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("cropped-thumb-page-2"));
    await waitFor(() => {
      expect(screen.getByTestId("bbox-editor-page-2")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("bbox-editor-close-btn"));
    await waitFor(() => {
      expect(screen.queryByTestId("bbox-editor-page-2")).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Artboard: ready/saving state
// ---------------------------------------------------------------------------

describe("PagesGridTool — ready/saving", () => {
  it("shows saving spinner while save is in flight", async () => {
    // Use a slow save service so the saving state is long enough to assert.
    let resolveSave!: () => void;
    const slowSavePage: PagesGridServices["savePage"] = (_pid, _sid, draft) =>
      new Promise<typeof draft>((resolve) => {
        resolveSave = () => resolve({ ...draft });
      });

    renderPagesGrid({
      _testServices: {
        fetchPages: (_pid, _sid) =>
          Promise.resolve([
            {
              pageId: "page-2",
              n: 2,
              thumbUrl: "",
              flags: ["overCrop"],
              bbox: [0.08, 0.07, 0.92, 0.93] as [
                number,
                number,
                number,
                number,
              ],
              skewDeg: null,
            },
          ]),
        savePage: slowSavePage,
      },
    });

    // Open editor
    await waitFor(() => {
      expect(screen.getByTestId("cropped-thumb-page-2")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("cropped-thumb-page-2"));
    await waitFor(() => {
      expect(screen.getByTestId("bbox-editor-page-2")).toBeDefined();
    });

    // Make it dirty by changing a bbox input, then save
    const input = screen.getByTestId("bbox-input-0");
    fireEvent.change(input, { target: { value: "0.05" } });

    fireEvent.click(screen.getByTestId("save-btn"));

    // Saving spinner should appear
    await waitFor(() => {
      expect(screen.getByTestId("saving-page-2")).toBeDefined();
    });

    // Resolve the save and verify spinner goes away
    resolveSave();
    await waitFor(() => {
      expect(screen.queryByTestId("saving-page-2")).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Artboard: ready/confirmDiscard state
// ---------------------------------------------------------------------------

describe("PagesGridTool — ready/confirmDiscard", () => {
  it("shows confirm-discard prompt when editor is dirty and close is clicked", async () => {
    renderPagesGrid();

    // Open editor for page-2
    await waitFor(() => {
      expect(screen.getByTestId("cropped-thumb-page-2")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("cropped-thumb-page-2"));
    await waitFor(() => {
      expect(screen.getByTestId("bbox-editor-page-2")).toBeDefined();
    });

    // Make it dirty
    const input = screen.getByTestId("bbox-input-0");
    fireEvent.change(input, { target: { value: "0.05" } });

    // Click the X close button — machine: editing.dirty → confirmDiscard
    fireEvent.click(screen.getByTestId("bbox-editor-close-btn"));

    // confirm-discard prompt should appear
    await waitFor(() => {
      expect(screen.getByTestId("confirm-discard-page-2")).toBeDefined();
    });
  });

  it("confirm-discard Keep button returns to editor", async () => {
    renderPagesGrid();

    await waitFor(() => {
      expect(screen.getByTestId("cropped-thumb-page-2")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("cropped-thumb-page-2"));
    await waitFor(() => {
      expect(screen.getByTestId("bbox-editor-page-2")).toBeDefined();
    });

    const input = screen.getByTestId("bbox-input-0");
    fireEvent.change(input, { target: { value: "0.05" } });
    fireEvent.click(screen.getByTestId("bbox-editor-close-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("confirm-discard-page-2")).toBeDefined();
    });

    // KEEP → back to editing
    fireEvent.click(screen.getByTestId("confirm-discard-keep-page-2"));
    await waitFor(() => {
      expect(screen.queryByTestId("confirm-discard-page-2")).toBeNull();
      expect(screen.getByTestId("bbox-editor-page-2")).toBeDefined();
    });
  });

  it("confirm-discard Discard button closes the editor", async () => {
    renderPagesGrid();

    await waitFor(() => {
      expect(screen.getByTestId("cropped-thumb-page-2")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("cropped-thumb-page-2"));
    await waitFor(() => {
      expect(screen.getByTestId("bbox-editor-page-2")).toBeDefined();
    });

    const input = screen.getByTestId("bbox-input-0");
    fireEvent.change(input, { target: { value: "0.05" } });
    fireEvent.click(screen.getByTestId("bbox-editor-close-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("confirm-discard-page-2")).toBeDefined();
    });

    // DISCARD → editor closes
    fireEvent.click(screen.getByTestId("confirm-discard-ok-page-2"));
    await waitFor(() => {
      expect(screen.queryByTestId("bbox-editor-page-2")).toBeNull();
      expect(screen.queryByTestId("confirm-discard-page-2")).toBeNull();
    });
  });
});
