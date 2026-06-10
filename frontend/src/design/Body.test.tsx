import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Body } from "./Body";

describe("Body", () => {
  it("renders with default testid", () => {
    render(<Body />);
    expect(screen.getByTestId("stage-body")).toBeInTheDocument();
  });

  it("renders children", () => {
    render(<Body>content here</Body>);
    expect(screen.getByText("content here")).toBeInTheDocument();
  });

  it("forwards data-testid", () => {
    render(<Body data-testid="my-body" />);
    expect(screen.getByTestId("my-body")).toBeInTheDocument();
  });

  it("forwards data-screen-label", () => {
    render(<Body data-screen-label="body-label" />);
    expect(screen.getByTestId("stage-body")).toHaveAttribute(
      "data-screen-label",
      "body-label",
    );
  });

  it("merges className", () => {
    render(<Body className="extra" />);
    expect(screen.getByTestId("stage-body").className).toContain("extra");
  });

  it("has bg-bg-page class", () => {
    render(<Body />);
    expect(screen.getByTestId("stage-body").className).toContain("bg-bg-page");
  });
});
