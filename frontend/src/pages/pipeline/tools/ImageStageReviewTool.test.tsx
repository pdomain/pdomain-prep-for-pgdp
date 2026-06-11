/**
 * ImageStageReviewTool artboard fixture tests.
 *
 * Covers all 5 imageStageReview instances:
 *   threshold, deskew, denoise, dewarp, post_transform_crop
 *
 * DCArtboard states per stage:
 *   - review/browsing   — flag grid + filter bar + density toggle
 *   - review/editing    — inline editor open (before/after wipe + controls)
 *   - settled           — all reviewed, confirm gate active
 *   - confirming        — confirm in flight
 *
 * @see docs/plans/design_handoff_pgdp_app/final/threshold/threshold.jsx
 * @see docs/plans/design_handoff_pgdp_app/final/deskew/deskew.jsx
 * @see docs/plans/design_handoff_pgdp_app/final/denoise/denoise.jsx
 * @see docs/plans/design_handoff_pgdp_app/final/dewarp/dewarp.jsx
 * @see docs/plans/design_handoff_pgdp_app/final/post_transform_crop/
 * @see src/pages/pipeline/tools/ImageStageReviewTool.tsx
 * @see src/pages/pipeline/tools/stageSchemas.ts
 */

import { describe, it, expect } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ImageStageReviewTool } from "./ImageStageReviewTool";
import type { ToolSlotProps } from "../toolSlot";
import type {
  ImageStageReviewServices,
  PageRow,
} from "@/machines/imageStageReview";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_RUNNER_REF = {} as ToolSlotProps["runnerRef"];

const MOCK_PAGES: PageRow[] = Array.from({ length: 6 }, (_, i) => ({
  idx: `page-${i + 1}`,
  prefix: `p${String(i + 1).padStart(3, "0")}`,
  state: i === 1 || i === 3 ? "flagged" : "clean",
  flags: i === 1 ? ["speckle"] : i === 3 ? ["lowContrast"] : [],
  pageNumber: i + 1,
}));

const TEST_SERVICES: ImageStageReviewServices = {
  fetchStagePages: () =>
    Promise.resolve({
      rows: MOCK_PAGES,
      totals: {
        total: 6,
        done: 6,
        flagged: 2,
        clean: 4,
        reviewed: 0,
        errors: 0,
        running: 0,
      },
    }),
  reRunPages: (_projectId, _stageId, draft, pageIds) =>
    Promise.resolve(
      pageIds.map((idx) => ({
        idx,
        prefix: idx,
        state: "clean" as const,
        flags: [],
        pageNumber: 1,
        ...draft,
      })),
    ),
  confirmStage: () => Promise.resolve({ ok: true }),
};

function renderReview(stageId: string) {
  return render(
    <MemoryRouter>
      <ImageStageReviewTool
        stageId={stageId}
        runnerRef={MOCK_RUNNER_REF}
        _testServices={TEST_SERVICES}
      />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Artboard: shared surface — loading → review transition
// ---------------------------------------------------------------------------

describe("ImageStageReviewTool — loading → review", () => {
  it("renders loading banner initially", () => {
    renderReview("threshold");
    // Machine starts in loading state
    expect(screen.getByTestId("review-banner-loading")).toBeDefined();
  });

  it("transitions to review banner after load", async () => {
    renderReview("threshold");
    await waitFor(() => {
      expect(screen.getByTestId("review-banner-review")).toBeDefined();
    });
  });

  it("renders page grid after load", async () => {
    renderReview("threshold");
    await waitFor(() => {
      expect(screen.getByTestId("page-grid")).toBeDefined();
    });
  });

  it("renders filter bar after load", async () => {
    renderReview("threshold");
    await waitFor(() => {
      expect(screen.getByTestId("filter-bar")).toBeDefined();
    });
  });

  it("renders density toggle after load", async () => {
    renderReview("threshold");
    await waitFor(() => {
      expect(screen.getByTestId("density-toggle")).toBeDefined();
    });
  });

  it("renders review toolbar", async () => {
    renderReview("threshold");
    await waitFor(() => {
      expect(screen.getByTestId("review-toolbar")).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Artboard: threshold stage
// ---------------------------------------------------------------------------

describe("ImageStageReviewTool — threshold", () => {
  it("renders tool with threshold stageId in wrapper", async () => {
    renderReview("threshold");
    await waitFor(() => {
      expect(
        screen.getByTestId("image-stage-review-tool-threshold"),
      ).toBeDefined();
    });
  });

  it("filter bar has 'all' and 'flagged' chips", async () => {
    renderReview("threshold");
    await waitFor(() => {
      expect(screen.getByTestId("filter-chip-all")).toBeDefined();
      expect(screen.getByTestId("filter-chip-flagged")).toBeDefined();
    });
  });

  it("filter bar has threshold-specific flag chips (speckle)", async () => {
    renderReview("threshold");
    await waitFor(() => {
      expect(screen.getByTestId("filter-chip-speckle")).toBeDefined();
    });
  });

  it("renders page cells in the grid", async () => {
    renderReview("threshold");
    await waitFor(() => {
      expect(screen.getByTestId("page-cell-page-1")).toBeDefined();
    });
  });

  it("review banner contains 'Threshold'", async () => {
    renderReview("threshold");
    await waitFor(() => {
      const banner = screen.getByTestId("review-banner-review");
      expect(banner.textContent).toContain("Threshold");
    });
  });

  it("density toggle has S/M/L options", async () => {
    renderReview("threshold");
    await waitFor(() => {
      expect(screen.getByTestId("density-S")).toBeDefined();
      expect(screen.getByTestId("density-M")).toBeDefined();
      expect(screen.getByTestId("density-L")).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Artboard: deskew stage
// ---------------------------------------------------------------------------

describe("ImageStageReviewTool — deskew", () => {
  it("renders tool with deskew stageId", async () => {
    renderReview("deskew");
    await waitFor(() => {
      expect(
        screen.getByTestId("image-stage-review-tool-deskew"),
      ).toBeDefined();
    });
  });

  it("review banner contains 'Deskew'", async () => {
    renderReview("deskew");
    await waitFor(() => {
      const banner = screen.getByTestId("review-banner-review");
      expect(banner.textContent).toContain("Deskew");
    });
  });

  it("filter bar has deskew-specific flag chips (largeAngle)", async () => {
    renderReview("deskew");
    await waitFor(() => {
      expect(screen.getByTestId("filter-chip-largeAngle")).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Artboard: denoise stage
// ---------------------------------------------------------------------------

describe("ImageStageReviewTool — denoise", () => {
  it("renders tool with denoise stageId", async () => {
    renderReview("denoise");
    await waitFor(() => {
      expect(
        screen.getByTestId("image-stage-review-tool-denoise"),
      ).toBeDefined();
    });
  });

  it("review banner contains 'Denoise'", async () => {
    renderReview("denoise");
    await waitFor(() => {
      const banner = screen.getByTestId("review-banner-review");
      expect(banner.textContent).toContain("Denoise");
    });
  });

  it("filter bar has denoise-specific flag chips (protectConflict)", async () => {
    renderReview("denoise");
    await waitFor(() => {
      expect(screen.getByTestId("filter-chip-protectConflict")).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Artboard: dewarp stage
// ---------------------------------------------------------------------------

describe("ImageStageReviewTool — dewarp", () => {
  it("renders tool with dewarp stageId", async () => {
    renderReview("dewarp");
    await waitFor(() => {
      expect(
        screen.getByTestId("image-stage-review-tool-dewarp"),
      ).toBeDefined();
    });
  });

  it("review banner contains 'Dewarp'", async () => {
    renderReview("dewarp");
    await waitFor(() => {
      const banner = screen.getByTestId("review-banner-review");
      expect(banner.textContent).toContain("Dewarp");
    });
  });

  it("filter bar has dewarp-specific flag chips (strongCurve)", async () => {
    renderReview("dewarp");
    await waitFor(() => {
      expect(screen.getByTestId("filter-chip-strongCurve")).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Artboard: post_transform_crop stage
// ---------------------------------------------------------------------------

describe("ImageStageReviewTool — post_transform_crop", () => {
  it("renders tool with post_transform_crop stageId", async () => {
    renderReview("post_transform_crop");
    await waitFor(() => {
      expect(
        screen.getByTestId("image-stage-review-tool-post_transform_crop"),
      ).toBeDefined();
    });
  });

  it("review banner contains 'Post-transform crop'", async () => {
    renderReview("post_transform_crop");
    await waitFor(() => {
      const banner = screen.getByTestId("review-banner-review");
      expect(banner.textContent).toContain("Post-transform crop");
    });
  });

  it("filter bar has post_transform_crop-specific flag chips (borderArtifact)", async () => {
    renderReview("post_transform_crop");
    await waitFor(() => {
      expect(screen.getByTestId("filter-chip-borderArtifact")).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Artboard: inline editor (review/editing)
// ---------------------------------------------------------------------------

describe("ImageStageReviewTool — inline editor", () => {
  it("opens inline editor when a flagged page thumbnail is clicked", async () => {
    renderReview("threshold");
    await waitFor(() => {
      // page-2 is flagged (index 1 in mock = page-2)
      expect(screen.getByTestId("page-cell-page-2")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("page-thumb-page-2"));
    await waitFor(() => {
      expect(screen.getByTestId("inline-editor-page-2")).toBeDefined();
    });
  });

  it("inline editor shows before/after wipe", async () => {
    renderReview("threshold");
    await waitFor(() => {
      expect(screen.getByTestId("page-thumb-page-2")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("page-thumb-page-2"));
    await waitFor(() => {
      expect(screen.getByTestId("wipe-viewer")).toBeDefined();
    });
  });

  it("inline editor shows control editor", async () => {
    renderReview("threshold");
    await waitFor(() => {
      expect(screen.getByTestId("page-thumb-page-2")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("page-thumb-page-2"));
    await waitFor(() => {
      expect(screen.getByTestId("control-editor")).toBeDefined();
    });
  });

  it("threshold inline editor shows method control", async () => {
    renderReview("threshold");
    await waitFor(() => {
      expect(screen.getByTestId("page-thumb-page-2")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("page-thumb-page-2"));
    await waitFor(() => {
      expect(screen.getByTestId("control-method")).toBeDefined();
    });
  });

  it("inline editor has accept-as-is and rerun buttons", async () => {
    renderReview("threshold");
    await waitFor(() => {
      expect(screen.getByTestId("page-thumb-page-2")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("page-thumb-page-2"));
    await waitFor(() => {
      expect(screen.getByTestId("accept-as-is-btn")).toBeDefined();
      expect(screen.getByTestId("rerun-btn")).toBeDefined();
    });
  });

  it("inline editor has apply-to selector buttons", async () => {
    renderReview("threshold");
    await waitFor(() => {
      expect(screen.getByTestId("page-thumb-page-2")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("page-thumb-page-2"));
    await waitFor(() => {
      expect(screen.getByTestId("apply-to-this")).toBeDefined();
      expect(screen.getByTestId("apply-to-selected")).toBeDefined();
      expect(screen.getByTestId("apply-to-sameIssue")).toBeDefined();
    });
  });

  it("close button dismisses the inline editor", async () => {
    renderReview("threshold");
    await waitFor(() => {
      expect(screen.getByTestId("page-thumb-page-2")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("page-thumb-page-2"));
    await waitFor(() => {
      expect(screen.getByTestId("inline-editor-page-2")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("editor-close-btn"));
    await waitFor(() => {
      expect(screen.queryByTestId("inline-editor-page-2")).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Artboard: confirm gate
// ---------------------------------------------------------------------------

describe("ImageStageReviewTool — confirm gate", () => {
  it("renders confirm gate in review state", async () => {
    renderReview("threshold");
    await waitFor(() => {
      expect(screen.getByTestId("confirm-gate")).toBeDefined();
    });
  });

  it("confirm gate button is disabled when flags not fully reviewed", async () => {
    renderReview("threshold");
    await waitFor(() => {
      const btn = screen.getByTestId("bottom-confirm-advance-btn");
      // 2 flagged pages, 0 reviewed — button should be disabled
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Artboard: settled state (all flagged pages reviewed)
// ---------------------------------------------------------------------------

describe("ImageStageReviewTool — settled state", () => {
  it("renders review-banner-settled after all flagged pages are accepted", async () => {
    // Drive machine: load → open editor on page-2 (flagged) → accept → open
    // editor on page-4 (flagged) → accept → machine reaches settled.
    renderReview("threshold");

    // Wait for load
    await waitFor(() => {
      expect(screen.getByTestId("page-thumb-page-2")).toBeDefined();
    });

    // Accept page-2
    fireEvent.click(screen.getByTestId("page-thumb-page-2"));
    await waitFor(() => {
      expect(screen.getByTestId("inline-editor-page-2")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("accept-as-is-btn"));

    // Accept page-4
    await waitFor(() => {
      expect(screen.getByTestId("page-thumb-page-4")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("page-thumb-page-4"));
    await waitFor(() => {
      expect(screen.getByTestId("inline-editor-page-4")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("accept-as-is-btn"));

    // Machine should now be settled
    await waitFor(() => {
      expect(screen.getByTestId("review-banner-settled")).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Artboard: confirming state (confirm in flight)
// ---------------------------------------------------------------------------

describe("ImageStageReviewTool — confirming state", () => {
  it("renders review-banner-confirming after CONFIRM_ADVANCE from settled", async () => {
    renderReview("threshold");

    // Load and accept both flagged pages to reach settled
    await waitFor(() => {
      expect(screen.getByTestId("page-thumb-page-2")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("page-thumb-page-2"));
    await waitFor(() => {
      expect(screen.getByTestId("inline-editor-page-2")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("accept-as-is-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("page-thumb-page-4")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("page-thumb-page-4"));
    await waitFor(() => {
      expect(screen.getByTestId("inline-editor-page-4")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("accept-as-is-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("review-banner-settled")).toBeDefined();
    });

    // Click confirm — from settled the banner button fires CONFIRM_ADVANCE
    fireEvent.click(screen.getByTestId("bottom-confirm-advance-btn"));

    await waitFor(() => {
      expect(screen.getByTestId("review-banner-confirming")).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Artboard: stageSchemas — controls per stage
// ---------------------------------------------------------------------------

describe("ImageStageReviewTool — controls via stageSchemas (threshold)", () => {
  it("threshold controls include method select", async () => {
    renderReview("threshold");
    await waitFor(() => {
      expect(screen.getByTestId("page-thumb-page-2")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("page-thumb-page-2"));
    await waitFor(() => {
      expect(screen.getByTestId("select-method")).toBeDefined();
    });
  });

  it("threshold controls include threshold slider (0–255)", async () => {
    renderReview("threshold");
    await waitFor(() => {
      expect(screen.getByTestId("page-thumb-page-2")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("page-thumb-page-2"));
    await waitFor(() => {
      expect(screen.getByTestId("slider-threshold")).toBeDefined();
    });
  });

  it("threshold controls include windowSize slider", async () => {
    renderReview("threshold");
    await waitFor(() => {
      expect(screen.getByTestId("page-thumb-page-2")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("page-thumb-page-2"));
    await waitFor(() => {
      expect(screen.getByTestId("slider-windowSize")).toBeDefined();
    });
  });

  it("threshold controls include kFactor slider", async () => {
    renderReview("threshold");
    await waitFor(() => {
      expect(screen.getByTestId("page-thumb-page-2")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("page-thumb-page-2"));
    await waitFor(() => {
      expect(screen.getByTestId("slider-kFactor")).toBeDefined();
    });
  });
});

describe("ImageStageReviewTool — controls via stageSchemas (denoise)", () => {
  it("denoise controls include protectFootMarks toggle", async () => {
    renderReview("denoise");
    await waitFor(() => {
      expect(screen.getByTestId("page-thumb-page-2")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("page-thumb-page-2"));
    await waitFor(() => {
      expect(screen.getByTestId("toggle-protectFootMarks")).toBeDefined();
    });
  });
});

describe("ImageStageReviewTool — controls via stageSchemas (dewarp)", () => {
  it("dewarp controls include model select", async () => {
    renderReview("dewarp");
    await waitFor(() => {
      expect(screen.getByTestId("page-thumb-page-2")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("page-thumb-page-2"));
    await waitFor(() => {
      expect(screen.getByTestId("select-model")).toBeDefined();
    });
  });

  it("dewarp controls include stiffness slider", async () => {
    renderReview("dewarp");
    await waitFor(() => {
      expect(screen.getByTestId("page-thumb-page-2")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("page-thumb-page-2"));
    await waitFor(() => {
      expect(screen.getByTestId("slider-stiffness")).toBeDefined();
    });
  });
});

describe("ImageStageReviewTool — controls via stageSchemas (post_transform_crop)", () => {
  it("post_transform_crop controls include marginTop slider", async () => {
    renderReview("post_transform_crop");
    await waitFor(() => {
      expect(screen.getByTestId("page-thumb-page-2")).toBeDefined();
    });
    fireEvent.click(screen.getByTestId("page-thumb-page-2"));
    await waitFor(() => {
      expect(screen.getByTestId("slider-marginTop")).toBeDefined();
    });
  });
});
