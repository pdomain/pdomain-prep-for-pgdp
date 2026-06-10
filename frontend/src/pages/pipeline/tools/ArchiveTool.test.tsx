/**
 * ArchiveTool.test.tsx — Artboard fixture tests for the Archive stage tool surface.
 *
 * Covers:
 * - Initial reviewing state: archive-tool, archive-manifest, archive-now-btn
 * - ItemRow per item: archive-item-{name} + toggle-keep-{name} buttons
 * - TOGGLE_KEEP: item keep/drop label flips
 * - ARCHIVE_NOW → archiving-in-progress → gate-archived + kept-stat + dropped-stat
 * - Settings tab: archive-settings, destination, retention
 *
 * @see src/machines/tools/archiveTool.ts
 * @see src/pages/pipeline/tools/ArchiveTool.tsx
 */

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArchiveTool } from "./ArchiveTool";

// ---------------------------------------------------------------------------
// Stub runnerRef
// ---------------------------------------------------------------------------

const fakeRunnerRef = {} as never;

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderArchive() {
  return render(<ArchiveTool stageId="archive" runnerRef={fakeRunnerRef} />);
}

// ---------------------------------------------------------------------------
// Initial reviewing state
// ---------------------------------------------------------------------------

describe("ArchiveTool — reviewing state", () => {
  it("renders archive-tool root", () => {
    renderArchive();
    expect(screen.getByTestId("archive-tool")).toBeInTheDocument();
  });

  it("renders archive-manifest", () => {
    renderArchive();
    expect(screen.getByTestId("archive-manifest")).toBeInTheDocument();
  });

  it("renders archive-now-btn in reviewing state", () => {
    renderArchive();
    expect(screen.getByTestId("archive-now-btn")).toBeInTheDocument();
  });

  it("renders item rows for MOCK_ITEMS", () => {
    renderArchive();
    // First MOCK_ITEM is "Original scans"
    expect(
      screen.getByTestId("archive-item-original-scans"),
    ).toBeInTheDocument();
  });

  it("renders toggle-keep-{name} for each item", () => {
    renderArchive();
    expect(
      screen.getByTestId("toggle-keep-original-scans"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("toggle-keep-grayscale-pages"),
    ).toBeInTheDocument();
  });

  it("gate-archived is NOT shown in reviewing state", () => {
    renderArchive();
    expect(screen.queryByTestId("gate-archived")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Toggle keep/drop
// ---------------------------------------------------------------------------

describe("ArchiveTool — TOGGLE_KEEP", () => {
  it("'Original scans' starts as 'keep' — button shows 'Drop'", () => {
    renderArchive();
    const btn = screen.getByTestId("toggle-keep-original-scans");
    expect(btn).toHaveTextContent("Drop");
  });

  it("'Grayscale pages' starts as 'drop' — button shows 'Keep'", () => {
    renderArchive();
    const btn = screen.getByTestId("toggle-keep-grayscale-pages");
    expect(btn).toHaveTextContent("Keep");
  });

  it("clicking toggle flips the button label", () => {
    renderArchive();
    const btn = screen.getByTestId("toggle-keep-original-scans");
    expect(btn).toHaveTextContent("Drop");
    fireEvent.click(btn);
    expect(btn).toHaveTextContent("Keep");
  });
});

// ---------------------------------------------------------------------------
// ARCHIVE_NOW → archiving → archived
// ---------------------------------------------------------------------------

describe("ArchiveTool — archiving and archived states", () => {
  it("clicking archive-now-btn triggers archiving-in-progress", async () => {
    renderArchive();
    fireEvent.click(screen.getByTestId("archive-now-btn"));
    await waitFor(() => {
      // Either archiving-in-progress or gate-archived depending on mock speed
      const archiving = screen.queryByTestId("archiving-in-progress");
      const archived = screen.queryByTestId("gate-archived");
      expect(archiving || archived).toBeTruthy();
    });
  });

  it("renders gate-archived after archive completes", async () => {
    renderArchive();
    fireEvent.click(screen.getByTestId("archive-now-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("gate-archived")).toBeInTheDocument();
    });
  });

  it("renders kept-stat after archiving", async () => {
    renderArchive();
    fireEvent.click(screen.getByTestId("archive-now-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("kept-stat")).toBeInTheDocument();
    });
  });

  it("renders dropped-stat after archiving", async () => {
    renderArchive();
    fireEvent.click(screen.getByTestId("archive-now-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("dropped-stat")).toBeInTheDocument();
    });
  });

  it("kept-stat shows mock kept value (3.5 GB)", async () => {
    renderArchive();
    fireEvent.click(screen.getByTestId("archive-now-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("kept-stat")).toHaveTextContent("3.5 GB");
    });
  });

  it("archive-now-btn is gone; re-archive-btn appears after archived", async () => {
    renderArchive();
    fireEvent.click(screen.getByTestId("archive-now-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("gate-archived")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("archive-now-btn")).not.toBeInTheDocument();
    expect(screen.getByTestId("re-archive-btn")).toBeInTheDocument();
  });

  it("toggle buttons are disabled after archiving", async () => {
    renderArchive();
    fireEvent.click(screen.getByTestId("archive-now-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("gate-archived")).toBeInTheDocument();
    });
    expect(screen.getByTestId("toggle-keep-original-scans")).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

describe("ArchiveTool — settings tab", () => {
  it("renders archive-settings panel on Settings tab", async () => {
    const user = userEvent.setup();
    renderArchive();
    await user.click(screen.getByRole("tab", { name: "Step Settings" }));
    expect(screen.getByTestId("archive-settings")).toBeInTheDocument();
  });

  it("shows destination: glacier in settings", async () => {
    const user = userEvent.setup();
    renderArchive();
    await user.click(screen.getByRole("tab", { name: "Step Settings" }));
    expect(screen.getByText("glacier")).toBeInTheDocument();
  });

  it("shows retention: 10yr in settings", async () => {
    const user = userEvent.setup();
    renderArchive();
    await user.click(screen.getByRole("tab", { name: "Step Settings" }));
    expect(screen.getByText("10yr")).toBeInTheDocument();
  });
});
