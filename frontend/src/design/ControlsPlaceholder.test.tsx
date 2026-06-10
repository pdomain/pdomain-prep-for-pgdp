import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ControlsPlaceholder } from "./ControlsPlaceholder";

describe("ControlsPlaceholder", () => {
  it("renders with default testid", () => {
    render(<ControlsPlaceholder />);
    expect(screen.getByTestId("controls-placeholder")).toBeInTheDocument();
  });

  it("renders the placeholder label text", () => {
    render(<ControlsPlaceholder />);
    expect(screen.getByText("content controls")).toBeInTheDocument();
  });

  it("applies default width of 460", () => {
    render(<ControlsPlaceholder />);
    const el = screen.getByTestId("controls-placeholder");
    expect(el.style.width).toBe("460px");
  });

  it("applies custom width", () => {
    render(<ControlsPlaceholder width={200} />);
    const el = screen.getByTestId("controls-placeholder");
    expect(el.style.width).toBe("200px");
  });

  it("forwards data-testid", () => {
    render(<ControlsPlaceholder data-testid="my-cp" />);
    expect(screen.getByTestId("my-cp")).toBeInTheDocument();
  });

  it("merges className", () => {
    render(<ControlsPlaceholder className="extra" />);
    expect(screen.getByTestId("controls-placeholder").className).toContain(
      "extra",
    );
  });

  it("has dashed border style class", () => {
    render(<ControlsPlaceholder />);
    expect(screen.getByTestId("controls-placeholder").className).toContain(
      "border-dashed",
    );
  });
});
