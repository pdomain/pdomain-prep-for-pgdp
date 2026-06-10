import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Gate, type GateTone } from "./Gate";

const TONES: GateTone[] = ["passed", "blocked", "pending", "warning"];

describe("Gate", () => {
  it("renders with default testid", () => {
    render(<Gate label="Check passed" />);
    expect(screen.getByTestId("gate")).toBeInTheDocument();
  });

  it("renders the label", () => {
    render(<Gate label="Validation passed" />);
    expect(screen.getByText("Validation passed")).toBeInTheDocument();
  });

  it("renders detail when provided", () => {
    render(<Gate label="OK" detail="All 232 pages clean" />);
    expect(screen.getByText("All 232 pages clean")).toBeInTheDocument();
  });

  it("does not render detail when not provided", () => {
    render(<Gate label="OK" />);
    // Only one text element should exist (the label)
    expect(screen.queryByText("undefined")).toBeNull();
  });

  it("renders action slot", () => {
    render(<Gate label="OK" action={<button>Proceed</button>} />);
    expect(screen.getByRole("button", { name: "Proceed" })).toBeInTheDocument();
  });

  it.each(TONES)("sets data-gate-tone=%s", (tone) => {
    render(<Gate data-testid="g" label="x" tone={tone} />);
    expect(screen.getByTestId("g")).toHaveAttribute("data-gate-tone", tone);
  });

  it("defaults to pending tone", () => {
    render(<Gate label="x" />);
    expect(screen.getByTestId("gate")).toHaveAttribute(
      "data-gate-tone",
      "pending",
    );
  });

  it("forwards data-testid", () => {
    render(<Gate data-testid="my-gate" label="x" />);
    expect(screen.getByTestId("my-gate")).toBeInTheDocument();
  });

  it("forwards data-screen-label", () => {
    render(<Gate label="x" data-screen-label="gate-label" />);
    expect(screen.getByTestId("gate")).toHaveAttribute(
      "data-screen-label",
      "gate-label",
    );
  });

  it("forwards data-comment-anchor", () => {
    render(<Gate label="x" data-comment-anchor="anchor1" />);
    expect(screen.getByTestId("gate")).toHaveAttribute(
      "data-comment-anchor",
      "anchor1",
    );
  });
});
