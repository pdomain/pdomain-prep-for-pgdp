import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingSlider } from "./SettingSlider";

describe("SettingSlider", () => {
  it("renders with default testid", () => {
    render(<SettingSlider value={50} onChange={() => undefined} />);
    expect(screen.getByTestId("setting-slider")).toBeInTheDocument();
  });

  it("renders a range input", () => {
    render(<SettingSlider value={50} onChange={() => undefined} />);
    expect(screen.getByRole("slider")).toBeInTheDocument();
  });

  it("reflects the current value", () => {
    render(<SettingSlider value={75} onChange={() => undefined} />);
    const slider = screen.getByRole<HTMLInputElement>("slider");
    expect(slider.value).toBe("75");
  });

  it("displays the value numerically", () => {
    render(<SettingSlider value={42} onChange={() => undefined} />);
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("displays the value with a unit suffix", () => {
    render(<SettingSlider value={80} onChange={() => undefined} unit="%" />);
    expect(screen.getByText("80%")).toBeInTheDocument();
  });

  it("calls onChange when slider changes", () => {
    const onChange = vi.fn();
    render(<SettingSlider value={50} onChange={onChange} min={0} max={100} />);
    const slider = screen.getByRole("slider");
    // fireEvent.change simulates a direct change event (avoids jsdom key-dispatch gaps)
    fireEvent.change(slider, { target: { value: "60" } });
    expect(onChange).toHaveBeenCalledWith(60);
  });

  it("uses provided min/max", () => {
    render(
      <SettingSlider value={5} onChange={() => undefined} min={0} max={10} />,
    );
    const slider = screen.getByRole<HTMLInputElement>("slider");
    expect(slider.min).toBe("0");
    expect(slider.max).toBe("10");
  });

  it("is disabled when disabled prop is set", () => {
    render(<SettingSlider value={50} onChange={() => undefined} disabled />);
    expect(screen.getByRole("slider")).toBeDisabled();
  });

  it("forwards data-testid", () => {
    render(
      <SettingSlider
        data-testid="my-slider"
        value={0}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByTestId("my-slider")).toBeInTheDocument();
  });

  it("forwards data-screen-label", () => {
    render(
      <SettingSlider
        data-screen-label="sl-label"
        value={0}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByTestId("setting-slider")).toHaveAttribute(
      "data-screen-label",
      "sl-label",
    );
  });
});
