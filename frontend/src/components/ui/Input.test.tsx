/**
 * Input tests — after Task 2 (s0-b) the component is pd-ui's Input.
 *
 * pd-ui Input renders an <input> with className "input" (semantic CSS class
 * from primitives.css) rather than raw Tailwind classes. Tests assert on the
 * behavioral contract: renders an input element, passes through value/type,
 * merges className, and forwards data-testid.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Input } from "./Input";

describe("Input", () => {
  it("renders an input element", () => {
    render(<Input data-testid="inp" />);
    expect(screen.getByTestId("inp")).toBeInTheDocument();
  });

  it("has input CSS class", () => {
    render(<Input data-testid="inp" />);
    expect(screen.getByTestId("inp").className).toContain("input");
  });

  it("accepts value prop", () => {
    render(<Input data-testid="inp" value="hello" onChange={() => {}} />);
    expect(screen.getByDisplayValue("hello")).toBeInTheDocument();
  });

  it("accepts type prop", () => {
    render(<Input data-testid="inp" type="password" />);
    expect(screen.getByTestId("inp")).toHaveAttribute("type", "password");
  });

  it("forwards data-testid", () => {
    render(<Input data-testid="my-input" />);
    expect(screen.getByTestId("my-input")).toBeInTheDocument();
  });

  it("merges additional className", () => {
    render(<Input data-testid="inp" className="extra-class" />);
    expect(screen.getByTestId("inp").className).toContain("extra-class");
  });
});
