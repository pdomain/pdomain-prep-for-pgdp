import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Check, type CheckTone } from "./Check";

const TONES: CheckTone[] = ["clean", "error", "neutral"];

describe("Check", () => {
  it("renders with default testid", () => {
    render(<Check checked={false} label="Accept terms" />);
    expect(screen.getByTestId("check")).toBeInTheDocument();
  });

  it("renders the label", () => {
    render(<Check checked={false} label="Enable wordcheck" />);
    expect(screen.getByText("Enable wordcheck")).toBeInTheDocument();
  });

  it("renders description when provided", () => {
    render(
      <Check
        checked={false}
        label="Auto-submit"
        description="Submit after all stages pass"
      />,
    );
    expect(
      screen.getByText("Submit after all stages pass"),
    ).toBeInTheDocument();
  });

  it("renders a hidden checkbox input", () => {
    render(<Check checked={false} label="x" />);
    // The visually-hidden checkbox input
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
  });

  it("reflects checked state on the checkbox", () => {
    render(<Check checked={true} label="x" />);
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("reflects unchecked state on the checkbox", () => {
    render(<Check checked={false} label="x" />);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("calls onChange when the label is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Check checked={false} label="Toggle me" onChange={onChange} />);
    await user.click(screen.getByText("Toggle me"));
    expect(onChange).toHaveBeenCalled();
  });

  it("sets data-checked attribute", () => {
    render(<Check checked={true} label="x" />);
    expect(screen.getByTestId("check")).toHaveAttribute("data-checked", "true");
  });

  it("sets data-tone attribute", () => {
    render(<Check checked={false} label="x" tone="clean" />);
    expect(screen.getByTestId("check")).toHaveAttribute("data-tone", "clean");
  });

  it.each(TONES)("accepts tone=%s without error", (tone) => {
    const { container } = render(
      <Check checked={false} label="x" tone={tone} />,
    );
    expect(container.firstChild).toBeTruthy();
  });

  it("is disabled when disabled prop is set", () => {
    render(<Check checked={false} label="x" disabled />);
    expect(screen.getByRole("checkbox")).toBeDisabled();
  });

  it("forwards data-testid", () => {
    render(<Check data-testid="my-check" checked={false} label="x" />);
    expect(screen.getByTestId("my-check")).toBeInTheDocument();
  });

  it("forwards data-screen-label", () => {
    render(<Check label="x" checked={false} data-screen-label="chk-label" />);
    expect(screen.getByTestId("check")).toHaveAttribute(
      "data-screen-label",
      "chk-label",
    );
  });
});
