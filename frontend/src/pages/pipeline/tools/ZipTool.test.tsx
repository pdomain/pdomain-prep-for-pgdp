/**
 * ZipTool.test.tsx — Artboard fixture tests for the Zip stage tool surface.
 *
 * Covers:
 * - Initial compressing state (starting banner)
 * - compressing-banner renders after first ZIP_PROGRESS event
 * - compression-progress-bar present in compressing state
 * - gate-built + sha256-stat + zip-tree + download-zip-btn after ZIP_DONE
 * - Settings tab: zip-settings panel, deterministic display, format display
 * - zip-rebuild-btn visible in settings after built
 *
 * @see src/machines/tools/zipTool.ts
 * @see src/pages/pipeline/tools/ZipTool.tsx
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ZipTool } from "./ZipTool";

// ---------------------------------------------------------------------------
// Stub runnerRef
// ---------------------------------------------------------------------------

const fakeRunnerRef = {} as never;

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderZip() {
  return render(<ZipTool stageId="zip" runnerRef={fakeRunnerRef} />);
}

// ---------------------------------------------------------------------------
// Initial compressing state
// ---------------------------------------------------------------------------

describe("ZipTool — initial state (compressing)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders zip-tool root immediately", () => {
    renderZip();
    expect(screen.getByTestId("zip-tool")).toBeInTheDocument();
  });

  it("renders compressing-starting placeholder before first progress event", () => {
    renderZip();
    // Before 300ms no ZIP_PROGRESS events
    expect(screen.getByTestId("compressing-starting")).toBeInTheDocument();
  });

  it("renders compressing-banner after first ZIP_PROGRESS event (300ms)", async () => {
    renderZip();
    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    expect(screen.getByTestId("compressing-banner")).toBeInTheDocument();
  });

  it("renders compression-progress-bar during compression", async () => {
    renderZip();
    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    expect(screen.getByTestId("compression-progress-bar")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Built state (after ZIP_DONE at 900ms)
// ---------------------------------------------------------------------------

describe("ZipTool — built state (after ZIP_DONE)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders gate-built after ZIP_DONE", async () => {
    renderZip();
    await act(async () => {
      vi.advanceTimersByTime(950);
    });
    expect(screen.getByTestId("gate-built")).toBeInTheDocument();
  });

  it("renders sha256-stat with archive sha256 value", async () => {
    renderZip();
    await act(async () => {
      vi.advanceTimersByTime(950);
    });
    expect(screen.getByTestId("sha256-stat")).toBeInTheDocument();
    expect(screen.getByTestId("sha256-stat")).toHaveTextContent("a3f1");
  });

  it("renders zip-tree with archive contents", async () => {
    renderZip();
    await act(async () => {
      vi.advanceTimersByTime(950);
    });
    expect(screen.getByTestId("zip-tree")).toBeInTheDocument();
  });

  it("renders download-zip-btn after built", async () => {
    renderZip();
    await act(async () => {
      vi.advanceTimersByTime(950);
    });
    expect(screen.getByTestId("download-zip-btn")).toBeInTheDocument();
  });

  it("compressing-banner is gone after built", async () => {
    renderZip();
    await act(async () => {
      vi.advanceTimersByTime(950);
    });
    expect(screen.queryByTestId("compressing-banner")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

describe("ZipTool — settings tab", () => {
  it("renders zip-settings panel on Settings tab (compressing state)", async () => {
    const user = userEvent.setup();
    renderZip();
    await user.click(screen.getByRole("tab", { name: "Step Settings" }));
    expect(screen.getByTestId("zip-settings")).toBeInTheDocument();
  });

  it("shows deterministic: on in settings (default ctx.settings.deterministic=true)", async () => {
    const user = userEvent.setup();
    renderZip();
    await user.click(screen.getByRole("tab", { name: "Step Settings" }));
    expect(screen.getByText("on")).toBeInTheDocument();
  });

  it("shows format: zip in settings", async () => {
    const user = userEvent.setup();
    renderZip();
    await user.click(screen.getByRole("tab", { name: "Step Settings" }));
    expect(screen.getByText("zip")).toBeInTheDocument();
  });

  it("zip-rebuild-btn visible in settings after built", async () => {
    const user = userEvent.setup();
    vi.useFakeTimers();
    renderZip();
    await act(async () => {
      vi.advanceTimersByTime(950);
    });
    vi.useRealTimers();
    await user.click(screen.getByRole("tab", { name: "Step Settings" }));
    await waitFor(() => {
      expect(screen.getByTestId("zip-rebuild-btn")).toBeInTheDocument();
    });
  });
});
