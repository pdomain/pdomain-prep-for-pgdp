/**
 * Tests for DiskCostBanner — disk-cost informational banner in project header.
 *
 * Spec: docs/specs/2026-05-13-m4-migration-disk-cost-design.md §Disk-cost banner
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DiskCostBanner } from "./DiskCostBanner";

function makeProject(
  overrides: {
    stage_artifacts_bytes?: number;
    source_zip_bytes?: number;
  } = {},
) {
  return {
    stage_artifacts_bytes: overrides.stage_artifacts_bytes ?? 0,
    source_zip_bytes: overrides.source_zip_bytes ?? 0,
  };
}

describe("DiskCostBanner", () => {
  it("renders nothing when stage_artifacts_bytes is 0", () => {
    const { container } = render(<DiskCostBanner project={makeProject()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the banner when stage_artifacts_bytes > 0", () => {
    render(
      <DiskCostBanner
        project={makeProject({ stage_artifacts_bytes: 1024 * 1024 * 100 })}
      />,
    );
    expect(screen.getByTestId("disk-cost-banner")).toBeInTheDocument();
  });

  it("shows formatted stage artifact size", () => {
    render(
      <DiskCostBanner
        project={makeProject({ stage_artifacts_bytes: 1024 * 1024 * 500 })}
      />,
    );
    expect(screen.getByText(/500\.0 MB/)).toBeInTheDocument();
  });

  it("shows estimated full-DAG size based on source_zip_bytes * 12", () => {
    // 100 MB source -> 1200 MB (~1.17 GB) estimated full DAG
    render(
      <DiskCostBanner
        project={makeProject({
          stage_artifacts_bytes: 1024 * 1024 * 500,
          source_zip_bytes: 1024 * 1024 * 100,
        })}
      />,
    );
    // 100 MB * 12 = 1200 MB = 1.17 GB
    expect(screen.getByText(/estimated full DAG/)).toBeInTheDocument();
    expect(screen.getByText(/1\.17 GB/)).toBeInTheDocument();
  });

  it("hides the estimated full-DAG when source_zip_bytes is 0", () => {
    render(
      <DiskCostBanner project={makeProject({ stage_artifacts_bytes: 1024 })} />,
    );
    expect(screen.queryByText(/estimated full DAG/)).not.toBeInTheDocument();
  });

  it("shows Reclaim space button", () => {
    render(
      <DiskCostBanner project={makeProject({ stage_artifacts_bytes: 1024 })} />,
    );
    expect(
      screen.getByRole("button", { name: /reclaim space/i }),
    ).toBeInTheDocument();
  });

  it("opens a Coming soon dialog when Reclaim space is clicked", async () => {
    render(
      <DiskCostBanner project={makeProject({ stage_artifacts_bytes: 1024 })} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /reclaim space/i }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });

  it("closes the Coming soon dialog when Close button is clicked", async () => {
    render(
      <DiskCostBanner project={makeProject({ stage_artifacts_bytes: 1024 })} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /reclaim space/i }),
    );
    // Click the "Close" text button (not the X icon button which is "Close" via aria-label)
    const buttons = screen.getAllByRole("button", { name: /close/i });
    // The last "close" button is the text "Close" inside the dialog footer
    // noUncheckedIndexedAccess: getAllByRole guarantees non-empty
    await userEvent.click(buttons[buttons.length - 1]!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("formats bytes correctly for GB-scale values", () => {
    render(
      <DiskCostBanner
        project={makeProject({
          stage_artifacts_bytes: Math.round(2.5 * 1024 * 1024 * 1024),
        })}
      />,
    );
    expect(screen.getByText(/2\.50 GB/)).toBeInTheDocument();
  });

  it("has blue left-accent border styling (status-running token)", () => {
    const { container } = render(
      <DiskCostBanner project={makeProject({ stage_artifacts_bytes: 1024 })} />,
    );
    const accentEl = container.querySelector(".border-status-running");
    expect(accentEl).not.toBeNull();
  });
});
