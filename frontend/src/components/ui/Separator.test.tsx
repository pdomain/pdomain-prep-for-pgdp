/**
 * Separator tests — after Task 2 (s0-b) the component is pd-ui's Separator.
 *
 * pd-ui Separator renders a <div> with className "separator" (semantic CSS
 * class from primitives.css) rather than raw Tailwind classes. Tests assert
 * on the behavioral contract: renders, sets data-orientation, merges className,
 * and forwards data-testid.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Separator } from "./Separator";

describe("Separator", () => {
  it("renders an element", () => {
    render(<Separator data-testid="sep" />);
    expect(screen.getByTestId("sep")).toBeInTheDocument();
  });

  it("defaults to horizontal orientation", () => {
    render(<Separator data-testid="sep" />);
    expect(screen.getByTestId("sep")).toHaveAttribute(
      "data-orientation",
      "horizontal",
    );
  });

  it("sets vertical orientation", () => {
    render(<Separator data-testid="sep" orientation="vertical" />);
    expect(screen.getByTestId("sep")).toHaveAttribute(
      "data-orientation",
      "vertical",
    );
  });

  it("has separator CSS class", () => {
    render(<Separator data-testid="sep" />);
    expect(screen.getByTestId("sep").className).toContain("separator");
  });

  it("forwards data-testid", () => {
    render(<Separator data-testid="my-sep" />);
    expect(screen.getByTestId("my-sep")).toBeInTheDocument();
  });

  it("merges className", () => {
    render(<Separator data-testid="sep" className="extra" />);
    expect(screen.getByTestId("sep").className).toContain("extra");
  });
});
