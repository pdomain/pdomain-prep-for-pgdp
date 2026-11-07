/**
 * BuildPackageTool.test.tsx — Artboard fixture tests for the Build Package stage tool surface.
 *
 * Covers:
 * - Initial idle state: gate-idle, preflight-status-unknown, build-btn present + disabled
 * - build-btn is disabled when preflight is not 'passed'
 * - After BUILD (with preflight 'passed'): gate-built, deliverable-tree, manifest-excerpt
 * - Settings tab: checksum algo display
 *
 * @see src/machines/tools/buildPackageTool.ts
 * @see src/pages/pipeline/tools/BuildPackageTool.tsx
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { api } from "@/api/client";
import { BuildPackageTool } from "./BuildPackageTool";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Stub runnerRef
// ---------------------------------------------------------------------------

const fakeRunnerRef = {} as never;

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderBuildPackage() {
  return render(
    <BuildPackageTool stageId="build_package" runnerRef={fakeRunnerRef} />,
  );
}

function renderProject(projectId: string) {
  return render(
    <MemoryRouter initialEntries={[`/projects/${projectId}`]}>
      <Routes>
        <Route
          path="/projects/:projectId"
          element={
            <BuildPackageTool
              stageId="build_package"
              runnerRef={fakeRunnerRef}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const builtManifest = {
  deliverable: {
    files: [{ name: "pgdp.json" }],
    count: 1,
  },
  manifest: {
    project: "book-1",
    pages: 1,
    canvas: "standard",
    built: "2026-11-06T00:00:00+00:00",
    pipeline: "v2",
    files: 1,
    sha256: "abc",
  },
};

// ---------------------------------------------------------------------------
// Initial idle state
// ---------------------------------------------------------------------------

describe("BuildPackageTool — idle state", () => {
  it("renders build-package-tool root", () => {
    renderBuildPackage();
    expect(screen.getByTestId("build-package-tool")).toBeInTheDocument();
  });

  it("renders gate-idle card on mount", () => {
    renderBuildPackage();
    expect(screen.getByTestId("gate-idle")).toBeInTheDocument();
  });

  it("renders preflight-status-unknown badge on mount", () => {
    renderBuildPackage();
    expect(screen.getByTestId("preflight-status-unknown")).toBeInTheDocument();
  });

  it("renders build-btn in idle state", () => {
    renderBuildPackage();
    expect(screen.getByTestId("build-btn")).toBeInTheDocument();
  });

  it("build-btn is disabled when preflight is unknown", () => {
    renderBuildPackage();
    expect(screen.getByTestId("build-btn")).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Built state
// ---------------------------------------------------------------------------

describe("BuildPackageTool — built state (after BUILD with preflight='passed')", () => {
  // The machine requires preflight 'passed' before BUILD is accepted.
  // The PREFLIGHT_PUSH event must be sent to transition preflight.
  // In component tests, we verify the UI shape by checking build-btn disabled.
  // Full gate-chain → gate-built path is tested in packTools.test.ts.

  it("build-btn remains disabled without PREFLIGHT_PUSH", async () => {
    renderBuildPackage();
    // build-btn is present but disabled
    const btn = screen.getByTestId("build-btn");
    expect(btn).toBeDisabled();
    // Clicking does nothing without preflight passed
    fireEvent.click(btn);
    // Still idle
    await waitFor(() => {
      expect(screen.getByTestId("gate-idle")).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

describe("BuildPackageTool — validation preflight fan-in", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
  });

  it("enables Build when the validation report is clean", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get)
      .mockResolvedValueOnce({ passed: true, blocker_count: 0 })
      .mockResolvedValue(builtManifest);
    vi.mocked(api.post).mockResolvedValue(undefined);
    renderProject("book-1");

    expect(
      await screen.findByTestId("preflight-status-passed"),
    ).toBeInTheDocument();
    const btn = screen.getByTestId("build-btn");
    expect(btn).toBeEnabled();
    await user.click(btn);
    expect(await screen.findByTestId("gate-built")).toBeInTheDocument();
  });

  it("keeps Build disabled when validation reports a blocker", async () => {
    vi.mocked(api.get).mockResolvedValue({
      passed: false,
      blocker_count: 1,
    });
    renderProject("book-1");

    expect(
      await screen.findByTestId("preflight-status-blocked"),
    ).toBeInTheDocument();
    const btn = screen.getByTestId("build-btn");
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(screen.getByTestId("gate-idle")).toBeInTheDocument();
  });

  it("stays unknown when validation has no artifact", async () => {
    vi.mocked(api.get).mockRejectedValue(
      Object.assign(new Error("HTTP 404"), { status: 404 }),
    );
    renderProject("book-1");

    await waitFor(() => {
      expect(api.get).toHaveBeenCalled();
    });
    expect(screen.getByTestId("preflight-status-unknown")).toBeInTheDocument();
    expect(screen.getByTestId("build-btn")).toBeDisabled();
  });
});

describe("BuildPackageTool — settings tab", () => {
  it("renders build-package-settings panel on Settings tab", async () => {
    const user = userEvent.setup();
    renderBuildPackage();
    await user.click(screen.getByRole("tab", { name: "Step Settings" }));
    expect(screen.getByTestId("build-package-settings")).toBeInTheDocument();
  });

  it("shows checksum algorithm value (sha256) in settings", async () => {
    const user = userEvent.setup();
    renderBuildPackage();
    await user.click(screen.getByRole("tab", { name: "Step Settings" }));
    // checksumAlgo default from machine context
    expect(screen.getByText("sha256")).toBeInTheDocument();
  });
});
