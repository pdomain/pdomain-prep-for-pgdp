import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Seg, type SegItem } from "./Seg";

const ITEMS: SegItem[] = [
  { value: "files", label: "Files" },
  { value: "report", label: "Report" },
  { value: "log", label: "Log" },
];

describe("Seg", () => {
  it("renders with default testid", () => {
    render(<Seg items={ITEMS} value="files" onChange={() => undefined} />);
    expect(screen.getByTestId("seg")).toBeInTheDocument();
  });

  it("renders all item labels", () => {
    render(<Seg items={ITEMS} value="files" onChange={() => undefined} />);
    expect(screen.getByText("Files")).toBeInTheDocument();
    expect(screen.getByText("Report")).toBeInTheDocument();
    expect(screen.getByText("Log")).toBeInTheDocument();
  });

  it("marks active item with data-state=active", () => {
    render(<Seg items={ITEMS} value="report" onChange={() => undefined} />);
    const active = screen.getByText("Report").closest("[data-state]");
    expect(active).toHaveAttribute("data-state", "active");
  });

  it("marks inactive items with data-state=inactive", () => {
    render(<Seg items={ITEMS} value="report" onChange={() => undefined} />);
    const inactive = screen.getByText("Files").closest("[data-state]");
    expect(inactive).toHaveAttribute("data-state", "inactive");
  });

  it("calls onChange with the clicked item value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Seg items={ITEMS} value="files" onChange={onChange} />);
    await user.click(screen.getByText("Report"));
    expect(onChange).toHaveBeenCalledWith("report");
  });

  it("has role=tablist", () => {
    render(<Seg items={ITEMS} value="files" onChange={() => undefined} />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
  });

  it("each item has role=tab", () => {
    render(<Seg items={ITEMS} value="files" onChange={() => undefined} />);
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("forwards data-testid", () => {
    render(
      <Seg
        data-testid="my-seg"
        items={ITEMS}
        value="files"
        onChange={() => undefined}
      />,
    );
    expect(screen.getByTestId("my-seg")).toBeInTheDocument();
  });

  it("forwards data-screen-label", () => {
    render(
      <Seg
        data-screen-label="seg-label"
        items={ITEMS}
        value="files"
        onChange={() => undefined}
      />,
    );
    expect(screen.getByTestId("seg")).toHaveAttribute(
      "data-screen-label",
      "seg-label",
    );
  });
});
