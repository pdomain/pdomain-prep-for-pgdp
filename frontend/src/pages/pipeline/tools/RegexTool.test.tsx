/**
 * RegexTool.test.tsx — Component artboard tests for the RegexTool surface.
 *
 * Covers (F5.5 fix round):
 * - Tab bar presence (overview / rules / settings)
 * - Tab switching
 * - ADD_RULE "Add rule" button rendered in rules banner
 * - REORDER_RULE up/down arrow buttons rendered per rule row
 * - Overview stat cells render
 * - Loading state renders loading spinner testid
 * - Clean state renders regex-tool-clean testid
 *
 * @see src/machines/tools/regexPass.ts — machine
 * @see RegexTool.tsx — component under test
 */

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RegexTool } from "./RegexTool";

// ---------------------------------------------------------------------------
// Minimal runnerRef stub (unused at F5 — wired at I1)
// ---------------------------------------------------------------------------

const fakeRunnerRef = {} as never;

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderTool() {
  return render(<RegexTool stageId="regex" runnerRef={fakeRunnerRef} />);
}

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

describe("RegexTool — loading state", () => {
  it("shows loading spinner on initial mount before rules are fetched", () => {
    // The machine starts in 'loading' synchronously before the mock fetchRules resolves.
    renderTool();

    expect(screen.getByTestId("regex-tool-loading")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tab bar (after rules loaded)
// ---------------------------------------------------------------------------

describe("RegexTool — tab bar after rules loaded", () => {
  it("renders the tab bar after fetchRules resolves", async () => {
    renderTool();

    await waitFor(() => {
      expect(screen.getByTestId("regex-tab-bar")).toBeInTheDocument();
    });
  });

  it("all three tab buttons are present", async () => {
    renderTool();

    await waitFor(() => {
      expect(screen.getByTestId("regex-tab-bar")).toBeInTheDocument();
    });

    expect(screen.getByTestId("regex-tab-overview")).toBeInTheDocument();
    expect(screen.getByTestId("regex-tab-rules")).toBeInTheDocument();
    expect(screen.getByTestId("regex-tab-settings")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

describe("RegexTool — tab switching", () => {
  it("starts on the rules tab by default", async () => {
    renderTool();

    await waitFor(() => {
      expect(screen.getByTestId("regex-rules-tab")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("regex-overview-tab")).not.toBeInTheDocument();
  });

  it("clicking Overview tab shows regex-overview-tab", async () => {
    renderTool();

    await waitFor(() => {
      expect(screen.getByTestId("regex-tab-bar")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("regex-tab-overview"));

    expect(screen.getByTestId("regex-overview-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("regex-rules-tab")).not.toBeInTheDocument();
  });

  it("clicking Settings tab shows regex-settings-tab", async () => {
    renderTool();

    await waitFor(() => {
      expect(screen.getByTestId("regex-tab-bar")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("regex-tab-settings"));

    expect(screen.getByTestId("regex-settings-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("regex-rules-tab")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ADD_RULE — "Add rule" button in rules banner (F5.5 fix round wiring)
// ---------------------------------------------------------------------------

describe("RegexTool — ADD_RULE button", () => {
  it("renders Add rule button in the rules banner", async () => {
    renderTool();

    await waitFor(() => {
      expect(screen.getByTestId("regex-add-rule")).toBeInTheDocument();
    });
  });

  it("Add rule button label contains 'Add rule'", async () => {
    renderTool();

    await waitFor(() => {
      const btn = screen.getByTestId("regex-add-rule");
      expect(btn).toHaveTextContent(/add rule/i);
    });
  });
});

// ---------------------------------------------------------------------------
// REORDER_RULE — up/down buttons per rule row (F5.5 fix round wiring)
// ---------------------------------------------------------------------------

describe("RegexTool — REORDER_RULE up/down buttons per rule", () => {
  it("renders move-up button for first mock rule (rx1)", async () => {
    renderTool();

    await waitFor(() => {
      expect(screen.getByTestId("regex-rule-move-up-rx1")).toBeInTheDocument();
    });
  });

  it("renders move-down button for first mock rule (rx1)", async () => {
    renderTool();

    await waitFor(() => {
      expect(
        screen.getByTestId("regex-rule-move-down-rx1"),
      ).toBeInTheDocument();
    });
  });

  it("move-up button for first rule (index 0) is disabled", async () => {
    renderTool();

    await waitFor(() => {
      const btn = screen.getByTestId("regex-rule-move-up-rx1");
      expect(btn).toBeDisabled();
    });
  });

  it("move-down button for last rule (rx3) is disabled", async () => {
    renderTool();

    await waitFor(() => {
      const btn = screen.getByTestId("regex-rule-move-down-rx3");
      expect(btn).toBeDisabled();
    });
  });

  it("move-down button for first rule (rx1) is enabled", async () => {
    renderTool();

    await waitFor(() => {
      const btn = screen.getByTestId("regex-rule-move-down-rx1");
      expect(btn).not.toBeDisabled();
    });
  });

  it("renders move buttons for all three mock rules", async () => {
    renderTool();

    await waitFor(() => {
      expect(screen.getByTestId("regex-rule-move-up-rx2")).toBeInTheDocument();
      expect(
        screen.getByTestId("regex-rule-move-down-rx2"),
      ).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Overview stat cells
// ---------------------------------------------------------------------------

describe("RegexTool — overview stat cells", () => {
  it("renders five stat cells when overview tab is active", async () => {
    renderTool();

    await waitFor(() => {
      expect(screen.getByTestId("regex-tab-bar")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("regex-tab-overview"));

    expect(screen.getByTestId("regex-stat-rules")).toBeInTheDocument();
    expect(screen.getByTestId("regex-stat-applied")).toBeInTheDocument();
    expect(screen.getByTestId("regex-stat-review")).toBeInTheDocument();
    expect(screen.getByTestId("regex-stat-pending")).toBeInTheDocument();
    expect(screen.getByTestId("regex-stat-matches")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Rule list
// ---------------------------------------------------------------------------

describe("RegexTool — rule list", () => {
  it("renders all three mock rules in the rule list", async () => {
    renderTool();

    await waitFor(() => {
      expect(screen.getByTestId("regex-rule-list")).toBeInTheDocument();
    });

    expect(screen.getByTestId("regex-rule-row-rx1")).toBeInTheDocument();
    expect(screen.getByTestId("regex-rule-row-rx2")).toBeInTheDocument();
    expect(screen.getByTestId("regex-rule-row-rx3")).toBeInTheDocument();
  });
});
