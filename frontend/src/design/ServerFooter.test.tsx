import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ServerFooter } from "./ServerFooter";

describe("ServerFooter", () => {
  it("renders with default testid", () => {
    render(<ServerFooter />);
    expect(screen.getByTestId("server-footer")).toBeInTheDocument();
  });

  it("displays default address", () => {
    render(<ServerFooter />);
    expect(screen.getByText("127.0.0.1:8765")).toBeInTheDocument();
  });

  it("displays custom address", () => {
    render(<ServerFooter address="127.0.0.1:9000" />);
    expect(screen.getByText("127.0.0.1:9000")).toBeInTheDocument();
  });

  it("renders server label", () => {
    render(<ServerFooter />);
    expect(screen.getByText("server:")).toBeInTheDocument();
  });

  it("has copy button", () => {
    render(<ServerFooter />);
    expect(
      screen.getByRole("button", { name: "Copy server address" }),
    ).toBeInTheDocument();
  });

  it("calls onCopy when copy button is clicked", async () => {
    const onCopy = vi.fn();
    const user = userEvent.setup();
    render(<ServerFooter onCopy={onCopy} />);
    await user.click(
      screen.getByRole("button", { name: "Copy server address" }),
    );
    expect(onCopy).toHaveBeenCalledOnce();
  });

  it("forwards data-testid", () => {
    render(<ServerFooter data-testid="my-footer" />);
    expect(screen.getByTestId("my-footer")).toBeInTheDocument();
  });

  it("forwards data-screen-label", () => {
    render(<ServerFooter data-screen-label="footer" />);
    expect(screen.getByTestId("server-footer")).toHaveAttribute(
      "data-screen-label",
      "footer",
    );
  });

  it("is rendered as a footer element", () => {
    render(<ServerFooter />);
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });
});
