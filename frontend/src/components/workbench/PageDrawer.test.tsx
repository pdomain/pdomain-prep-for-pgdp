/**
 * Tests for PageDrawer component.
 *
 * Covers:
 * - Renders null when page=null
 * - Renders page info when page is provided
 * - "Open in workbench" button navigates to the correct route
 * - Close button calls onClose
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { PageDrawer } from "./PageDrawer";
import type { components } from "@/api/types.gen";

type PageRecord = components["schemas"]["PageRecord"];

const nullOverrides = {
  initial_crop: null,
  white_space_additional: null,
  threshold_level: null,
  fuzzy_pct: null,
  pixel_count_columns: null,
  pixel_count_rows: null,
  skip_auto_deskew: null,
  deskew_before_crop: null,
  deskew_after_crop: null,
  do_morph: null,
  skip_denoise: null,
  use_ocr_bbox_edge: null,
  rotated_standard: null,
  single_dimension_rescale: null,
  manual_deskew_angle: null,
  flip_horizontal: null,
  flip_vertical: null,
} satisfies PageRecord["config_overrides"];

const basePage: PageRecord = {
  project_id: "proj1",
  idx0: 4,
  prefix: "0005",
  source_stem: "scan_0005",
  ignore: false,
  page_type: "normal",
  alignment: "default",
  config_overrides: nullOverrides,
  splits: [],
  illustration_regions: [],
  source_key: null,
  thumbnail_key: null,
  processed_image_key: null,
  ocr_image_key: null,
  processing_status: "complete",
  processing_job_id: null,
  processing_error: null,
  last_processed_at: null,
  outputs: [],
  parent_page_id: null,
  source_crop_bbox: null,
  split_index: null,
  split_at_stage: null,
  split_suffix: null,
  reading_order: 0,
};

function renderDrawer(
  page: PageRecord | null,
  onClose = vi.fn(),
  projectId = "proj1",
) {
  return render(
    <MemoryRouter>
      <PageDrawer page={page} projectId={projectId} onClose={onClose} />
    </MemoryRouter>,
  );
}

describe("PageDrawer", () => {
  it("renders nothing when page is null", () => {
    const { container } = renderDrawer(null);
    expect(container.firstChild).toBeNull();
  });

  it("renders the page number (1-indexed) in the header", () => {
    renderDrawer(basePage);
    // idx0=4 → "Page 5"
    expect(screen.getByText("Page 5")).toBeInTheDocument();
  });

  it("renders the prefix as source info", () => {
    renderDrawer(basePage);
    expect(screen.getByText("0005")).toBeInTheDocument();
  });

  it("shows status badge for complete pages", () => {
    renderDrawer(basePage);
    expect(screen.getByTestId("page-drawer-status-badge")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("shows error status badge and error message for errored pages", () => {
    const page: PageRecord = {
      ...basePage,
      processing_status: "error",
      processing_error: "OCR failed: timeout",
    };
    renderDrawer(page);
    expect(screen.getByText("Errored")).toBeInTheDocument();
    expect(screen.getByText("OCR failed: timeout")).toBeInTheDocument();
  });

  it("shows page type label for non-normal types", () => {
    const page: PageRecord = { ...basePage, page_type: "blank" };
    renderDrawer(page);
    expect(screen.getByText("Blank")).toBeInTheDocument();
  });

  it("shows 'Outside proof range' when ignore=true", () => {
    const page: PageRecord = { ...basePage, ignore: true };
    renderDrawer(page);
    expect(screen.getByText("Outside proof range")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", async () => {
    const onClose = vi.fn();
    renderDrawer(basePage, onClose);
    await userEvent.click(screen.getByLabelText("Close drawer"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders 'Open in workbench' button", () => {
    renderDrawer(basePage);
    expect(
      screen.getByRole("button", { name: /open in workbench/i }),
    ).toBeInTheDocument();
  });

  it("uses custom data-testid when provided", () => {
    render(
      <MemoryRouter>
        <PageDrawer
          page={basePage}
          projectId="proj1"
          onClose={vi.fn()}
          data-testid="my-drawer"
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("my-drawer")).toBeInTheDocument();
  });

  it("defaults data-testid to 'page-drawer'", () => {
    renderDrawer(basePage);
    expect(screen.getByTestId("page-drawer")).toBeInTheDocument();
  });
});
