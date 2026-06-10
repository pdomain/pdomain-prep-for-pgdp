import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StageCard } from "./StageCard";

describe("StageCard", () => {
  it("renders with default testid", () => {
    render(<StageCard />);
    expect(screen.getByTestId("stage-card")).toBeInTheDocument();
  });

  it("renders children", () => {
    render(<StageCard>card content</StageCard>);
    expect(screen.getByText("card content")).toBeInTheDocument();
  });

  it("renders title when provided", () => {
    render(<StageCard title="My Stage" />);
    expect(screen.getByText("My Stage")).toBeInTheDocument();
  });

  it("does not render title element when not provided", () => {
    render(<StageCard data-testid="c" />);
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("forwards data-testid", () => {
    render(<StageCard data-testid="my-card" />);
    expect(screen.getByTestId("my-card")).toBeInTheDocument();
  });

  it("forwards data-screen-label", () => {
    render(<StageCard data-screen-label="card-label" />);
    expect(screen.getByTestId("stage-card")).toHaveAttribute(
      "data-screen-label",
      "card-label",
    );
  });

  it("forwards data-comment-anchor", () => {
    render(<StageCard data-comment-anchor="my-anchor" />);
    expect(screen.getByTestId("stage-card")).toHaveAttribute(
      "data-comment-anchor",
      "my-anchor",
    );
  });

  it("has border-border-1 class", () => {
    render(<StageCard />);
    expect(screen.getByTestId("stage-card").className).toContain(
      "border-border-1",
    );
  });

  it("has bg-bg-surface class", () => {
    render(<StageCard />);
    expect(screen.getByTestId("stage-card").className).toContain(
      "bg-bg-surface",
    );
  });
});
