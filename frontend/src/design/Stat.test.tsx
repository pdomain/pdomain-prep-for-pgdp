/**
 * Stat tests — Stat is a re-export of pdomain-ui StatTile.
 * Tests verify the re-export contract: the component renders with the
 * expected label and value, and the tone prop is accepted.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Stat, type StatTone } from "./Stat";

const TONES: StatTone[] = ["clean", "dirty", "neutral"];

describe("Stat (re-export of pdomain-ui StatTile)", () => {
  it("renders a value", () => {
    render(<Stat value="42" label="Pages" />);
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("renders a string value", () => {
    render(<Stat value="100%" label="Coverage" />);
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("renders the label", () => {
    render(<Stat value="5" label="Errors" />);
    expect(screen.getByText("Errors")).toBeInTheDocument();
  });

  it.each(TONES)("accepts tone=%s without error", (tone) => {
    // tone is a prop of StatTile; just verify it renders without throwing
    const { container } = render(<Stat value="0" label="x" tone={tone} />);
    expect(container.firstChild).toBeTruthy();
  });
});
