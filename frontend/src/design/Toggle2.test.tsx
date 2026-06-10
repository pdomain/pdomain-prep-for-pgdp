import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Toggle2 } from "./Toggle2";

describe("Toggle2", () => {
  it("renders with default testid", () => {
    render(<Toggle2 checked={false} onChange={() => undefined} />);
    expect(screen.getByTestId("toggle2")).toBeInTheDocument();
  });

  it("renders a switch button", () => {
    render(<Toggle2 checked={false} onChange={() => undefined} />);
    expect(screen.getByRole("switch")).toBeInTheDocument();
  });

  it("reports checked=false in aria-checked", () => {
    render(<Toggle2 checked={false} onChange={() => undefined} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("reports checked=true in aria-checked", () => {
    render(<Toggle2 checked={true} onChange={() => undefined} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("sets data-checked attribute", () => {
    render(<Toggle2 checked={true} onChange={() => undefined} />);
    expect(screen.getByTestId("toggle2")).toHaveAttribute(
      "data-checked",
      "true",
    );
  });

  it("calls onChange with toggled value when clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Toggle2 checked={false} onChange={onChange} />);
    await user.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("calls onChange with false when toggled off", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Toggle2 checked={true} onChange={onChange} />);
    await user.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("renders a label when provided", () => {
    render(
      <Toggle2 checked={false} onChange={() => undefined} label="Auto-run" />,
    );
    expect(screen.getByText("Auto-run")).toBeInTheDocument();
  });

  it("does not render label text when not provided", () => {
    const { container } = render(
      <Toggle2 checked={false} onChange={() => undefined} />,
    );
    // Only the switch + thumb should be inside the label
    expect(container.querySelector("span:not([aria-hidden])")).toBeNull();
  });

  it("forwards data-testid", () => {
    render(
      <Toggle2
        data-testid="my-toggle"
        checked={false}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByTestId("my-toggle")).toBeInTheDocument();
  });

  it("disables the switch when disabled prop is set", () => {
    render(<Toggle2 checked={false} onChange={() => undefined} disabled />);
    expect(screen.getByRole("switch")).toBeDisabled();
  });
});
