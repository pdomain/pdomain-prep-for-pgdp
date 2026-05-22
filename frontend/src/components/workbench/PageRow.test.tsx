/**
 * Tests for PageRow component.
 *
 * Covers:
 * - Renders page number (1-indexed) and prefix/source_stem
 * - Calls onSelect with idx0 when clicked
 * - Shows selected state (border class applied)
 * - Shows status badge for non-pending pages
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PageRow } from "./PageRow";
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
  idx0: 2,
  prefix: "0003",
  source_stem: "scan_0003",
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
  processing_status: "pending",
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

describe("PageRow", () => {
  it("renders the 1-indexed page number", () => {
    render(<PageRow page={basePage} isSelected={false} onSelect={vi.fn()} />);
    // idx0=2 → displayed as "3"
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders the prefix as filename", () => {
    render(<PageRow page={basePage} isSelected={false} onSelect={vi.fn()} />);
    expect(screen.getByText("0003")).toBeInTheDocument();
  });

  it("falls back to source_stem when prefix is empty", () => {
    const page = { ...basePage, prefix: "" };
    render(<PageRow page={page} isSelected={false} onSelect={vi.fn()} />);
    expect(screen.getByText("scan_0003")).toBeInTheDocument();
  });

  it("calls onSelect with idx0 when clicked", async () => {
    const onSelect = vi.fn();
    render(<PageRow page={basePage} isSelected={false} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("applies selected state classes when isSelected=true", () => {
    const { container } = render(
      <PageRow page={basePage} isSelected={true} onSelect={vi.fn()} />,
    );
    // The root div should contain the border-border-2 class when selected
    const row = container.firstChild as HTMLElement;
    expect(row.className).toContain("border-border-2");
  });

  it("shows status badge for complete pages", () => {
    const page = { ...basePage, processing_status: "complete" as const };
    render(<PageRow page={page} isSelected={false} onSelect={vi.fn()} />);
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("shows error badge for errored pages", () => {
    const page = { ...basePage, processing_status: "error" as const };
    render(<PageRow page={page} isSelected={false} onSelect={vi.fn()} />);
    expect(screen.getByText("Errored")).toBeInTheDocument();
  });

  it("shows running badge for processing pages", () => {
    const page = { ...basePage, processing_status: "processing" as const };
    render(<PageRow page={page} isSelected={false} onSelect={vi.fn()} />);
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("uses custom data-testid when provided", () => {
    render(
      <PageRow
        page={basePage}
        isSelected={false}
        onSelect={vi.fn()}
        data-testid="my-row"
      />,
    );
    expect(screen.getByTestId("my-row")).toBeInTheDocument();
  });

  it("defaults data-testid to page-row-{idx0}", () => {
    render(<PageRow page={basePage} isSelected={false} onSelect={vi.fn()} />);
    expect(screen.getByTestId("page-row-2")).toBeInTheDocument();
  });
});
