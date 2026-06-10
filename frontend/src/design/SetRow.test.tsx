import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SetRow } from "./SetRow";

describe("SetRow", () => {
  it("renders with default testid", () => {
    render(<SetRow label="Threshold" />);
    expect(screen.getByTestId("set-row")).toBeInTheDocument();
  });

  it("renders the label", () => {
    render(<SetRow label="Threshold" />);
    expect(screen.getByText("Threshold")).toBeInTheDocument();
  });

  it("renders description when provided", () => {
    render(<SetRow label="Threshold" description="Binarisation cutoff" />);
    expect(screen.getByText("Binarisation cutoff")).toBeInTheDocument();
  });

  it("renders control children", () => {
    render(
      <SetRow label="Threshold">
        <input type="range" />
      </SetRow>,
    );
    expect(screen.getByRole("slider")).toBeInTheDocument();
  });

  it("forwards data-testid", () => {
    render(<SetRow data-testid="my-row" label="x" />);
    expect(screen.getByTestId("my-row")).toBeInTheDocument();
  });

  it("forwards data-screen-label", () => {
    render(<SetRow label="x" data-screen-label="row-label" />);
    expect(screen.getByTestId("set-row")).toHaveAttribute(
      "data-screen-label",
      "row-label",
    );
  });

  it("merges className", () => {
    render(<SetRow label="x" className="extra" />);
    expect(screen.getByTestId("set-row").className).toContain("extra");
  });
});

// SettingRow alias intentionally not exported (knip duplicate-export prevention).
// Use SetRow directly.
