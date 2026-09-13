import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button, buttonVariants } from "./Button";

describe("Button", () => {
  it("renders children", () => {
    render(<Button>Click me</Button>);
    expect(
      screen.getByRole("button", { name: "Click me" }),
    ).toBeInTheDocument();
  });

  it("applies primary variant classes by default", () => {
    render(<Button data-testid="btn">Primary</Button>);
    const btn = screen.getByTestId("btn");
    expect(btn.className).toContain("bg-accent");
    expect(btn.className).toContain("text-accent-ink");
  });

  it("applies secondary variant classes", () => {
    render(
      <Button variant="secondary" data-testid="btn">
        Sec
      </Button>,
    );
    const btn = screen.getByTestId("btn");
    expect(btn.className).toContain("bg-bg-raised");
    expect(btn.className).toContain("border-border-2");
  });

  it("applies outline-solid variant classes", () => {
    render(
      <Button variant="outline" data-testid="btn">
        Out
      </Button>,
    );
    const btn = screen.getByTestId("btn");
    expect(btn.className).toContain("border-border-2");
    expect(btn.className).toContain("text-ink-1");
  });

  it("applies ghost variant classes", () => {
    render(
      <Button variant="ghost" data-testid="btn">
        Ghost
      </Button>,
    );
    const btn = screen.getByTestId("btn");
    expect(btn.className).toContain("hover:bg-bg-raised");
  });

  it("applies link variant classes", () => {
    render(
      <Button variant="link" data-testid="btn">
        Link
      </Button>,
    );
    const btn = screen.getByTestId("btn");
    expect(btn.className).toContain("underline-offset-4");
  });

  it("applies amber variant classes", () => {
    render(
      <Button variant="amber" data-testid="btn">
        Amber
      </Button>,
    );
    const btn = screen.getByTestId("btn");
    expect(btn.className).toContain("bg-brand");
  });

  it("applies danger variant classes", () => {
    render(
      <Button variant="danger" data-testid="btn">
        Danger
      </Button>,
    );
    const btn = screen.getByTestId("btn");
    expect(btn.className).toContain("bg-status-error");
  });

  it("applies default size classes", () => {
    render(<Button data-testid="btn">Default</Button>);
    const btn = screen.getByTestId("btn");
    expect(btn.className).toContain("h-9");
    expect(btn.className).toContain("px-4");
  });

  it("applies sm size classes", () => {
    render(
      <Button size="sm" data-testid="btn">
        Sm
      </Button>,
    );
    const btn = screen.getByTestId("btn");
    expect(btn.className).toContain("h-8");
    expect(btn.className).toContain("px-3");
  });

  it("applies xs size classes", () => {
    render(
      <Button size="xs" data-testid="btn">
        Xs
      </Button>,
    );
    const btn = screen.getByTestId("btn");
    expect(btn.className).toContain("h-7");
    expect(btn.className).toContain("text-xs");
  });

  it("applies icon size classes", () => {
    render(
      <Button size="icon" data-testid="btn">
        I
      </Button>,
    );
    const btn = screen.getByTestId("btn");
    expect(btn.className).toContain("h-9");
    expect(btn.className).toContain("w-9");
  });

  it("forwards data-testid", () => {
    render(<Button data-testid="my-btn">T</Button>);
    expect(screen.getByTestId("my-btn")).toBeInTheDocument();
  });

  it("exports buttonVariants", () => {
    expect(buttonVariants({ variant: "primary" })).toContain("bg-accent");
  });
});
