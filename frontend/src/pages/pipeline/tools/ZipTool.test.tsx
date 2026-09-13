/**
 * ZipTool.test.tsx — Artboard fixture tests for the Zip stage tool surface.
 *
 * Covers:
 * - Initial compressing state (starting banner)
 * - Rehydration from the persisted stage status (connect snapshot)
 * - Built state after ZIP_DONE, driven through the mocked SSE seam
 * - Settings tab: zip-settings panel, deterministic display, format display
 *
 * ZIP_PROGRESS / ZIP_DONE arrive via SSE (real backend push). Tests drive that
 * seam by mocking `@/services/sse` and capturing the project-channel callback,
 * so the transitions previously deferred to e2e are covered here.
 *
 * @see src/machines/tools/zipTool.ts
 * @see src/pages/pipeline/tools/ZipTool.tsx
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ProjectChannelEvent, ProjectStageState } from "@/types/pipeline";

// ---------------------------------------------------------------------------
// Mock the SSE seam — capture the project-channel callback so tests can push
// frames synchronously (pattern: machines/lib/pageToolSseBridge.test.ts).
// ---------------------------------------------------------------------------

let _projectCallback: ((event: ProjectChannelEvent) => void) | null = null;

vi.mock("@/services/sse", () => ({
  subscribeProject: (
    _projectId: string,
    cb: (event: ProjectChannelEvent) => void,
  ) => {
    _projectCallback = cb;
    return () => {
      _projectCallback = null;
    };
  },
  subscribePageChannel: () => () => {},
  subscribeProjectPageStageChannel: () => () => {},
}));

// ---------------------------------------------------------------------------
// Mock the zip services — `requestRebuild` is the machine's `compressing`
// entry action (a real POST), and `fetchZipManifest` is what the SSE handler
// calls before sending ZIP_DONE.
// ---------------------------------------------------------------------------

const MOCK_ARCHIVE = {
  name: "book.zip",
  entries: 1229,
  bytes: 1_380_000_000,
  ratio: 0.62,
  sha256: "a3f1c09e77b4d2e5",
};

const MOCK_TREE = [{ name: "book.txt", kind: "file", bytes: 1024 }];

const requestRebuildSpy = vi.fn().mockResolvedValue(undefined);

vi.mock("@/services/tools/zipTool", () => ({
  buildRealZipToolServices: () => ({
    requestRebuild: (projectId: string, settings: unknown) =>
      requestRebuildSpy(projectId, settings) as Promise<void>,
    downloadArchive: () => Promise.resolve("/download"),
  }),
  fetchZipManifest: () =>
    Promise.resolve({ archive: MOCK_ARCHIVE, tree: MOCK_TREE }),
}));

// Import the component AFTER the mocks are set up.
import { ZipTool } from "./ZipTool";

// ---------------------------------------------------------------------------
// Stub runnerRef
// ---------------------------------------------------------------------------

const fakeRunnerRef = {} as never;

beforeEach(() => {
  requestRebuildSpy.mockClear();
});

/** Minimal valid ProjectStageState for the zip row. */
function zipStageRow(status: ProjectStageState["status"]): ProjectStageState {
  return {
    project_id: "demo",
    stage_id: "zip",
    status,
    stage_version: 1,
    artifact_key: null,
    config_hash: null,
    input_hash: null,
    last_run_at: null,
    duration_ms: null,
    error_message: null,
    job_id: null,
  };
}

/** Push the on-connect snapshot frame reporting zip's persisted status. */
async function emitSnapshot(status: ProjectStageState["status"]) {
  act(() => {
    _projectCallback?.({
      type: "project-snapshot",
      project_stages: [zipStageRow(status)],
    });
  });
  // The handler fetches the manifest before sending ZIP_DONE — let it settle.
  await waitFor(() => {
    expect(_projectCallback).not.toBeNull();
  });
}

// ---------------------------------------------------------------------------
// Render helper — MemoryRouter required since ZipTool uses useParams
// ---------------------------------------------------------------------------

function renderZip() {
  return render(
    <MemoryRouter initialEntries={["/projects/demo/pipeline"]}>
      <ZipTool stageId="zip" runnerRef={fakeRunnerRef} />
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Initial compressing state
// ---------------------------------------------------------------------------

describe("ZipTool — initial state (compressing)", () => {
  it("renders zip-tool root immediately", () => {
    renderZip();
    expect(screen.getByTestId("zip-tool")).toBeInTheDocument();
  });

  it("renders compressing-starting placeholder before SSE progress events", () => {
    renderZip();
    // Machine starts in compressing state; before any SSE ZIP_PROGRESS arrives
    // the starting placeholder is shown.
    expect(screen.getByTestId("compressing-starting")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Rehydration from the persisted stage status
//
// The zip stage's `clean` status is persisted server-side. On a fresh page
// load the incremental `project-stage-status` frames never fire (they only
// mark transitions) — the persisted status arrives in the on-connect
// `project-snapshot` frame. Ignoring that frame left the surface stuck in
// `compressing` after any reload of an already-zipped project.
//
// Sibling gap, same root cause: ArchiveTool's ARCHIVE_RESTORED.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// No rebuild on mount (ocr-container-meta#402)
//
// `compressing` requests a real rebuild (POST .../zip/run). It used to be the
// initial state, so merely opening the Zip step re-ran the whole stage even
// when the archive was already clean. The machine now starts in `hydrating`,
// which has no entry action: reading the persisted status decides whether a
// build is needed.
// ---------------------------------------------------------------------------

describe("ZipTool — does not rebuild on mount", () => {
  it("requests no rebuild before the stage status is known", () => {
    renderZip();
    expect(requestRebuildSpy).not.toHaveBeenCalled();
  });

  it("requests no rebuild when the snapshot reports zip clean", async () => {
    renderZip();
    await emitSnapshot("clean");
    await waitFor(() => {
      expect(screen.getByTestId("gate-built")).toBeInTheDocument();
    });
    expect(requestRebuildSpy).not.toHaveBeenCalled();
  });

  it("requests exactly one rebuild when the snapshot reports zip dirty", async () => {
    renderZip();
    await emitSnapshot("dirty");
    await waitFor(() => {
      expect(requestRebuildSpy).toHaveBeenCalledTimes(1);
    });
  });

  it("follows an in-flight build without requesting another", async () => {
    renderZip();
    act(() => {
      _projectCallback?.({
        type: "project-stage-progress",
        stage_id: "zip",
        progress: 0.5,
        message: "compressing",
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId("zip-tool")).toBeInTheDocument();
    });
    expect(requestRebuildSpy).not.toHaveBeenCalled();
  });

  it("still rebuilds on an explicit REBUILD from the built state", async () => {
    const user = userEvent.setup();
    renderZip();
    await emitSnapshot("clean");
    await waitFor(() => {
      expect(screen.getByTestId("gate-built")).toBeInTheDocument();
    });
    expect(requestRebuildSpy).not.toHaveBeenCalled();

    await user.click(screen.getByRole("tab", { name: "Step Settings" }));
    await user.click(screen.getByTestId("zip-rebuild-btn"));
    await waitFor(() => {
      expect(requestRebuildSpy).toHaveBeenCalledTimes(1);
    });
  });
});

describe("ZipTool — rehydration from persisted status", () => {
  it("reaches the built state when the connect snapshot reports zip clean", async () => {
    renderZip();
    expect(screen.getByTestId("compressing-starting")).toBeInTheDocument();

    await emitSnapshot("clean");

    await waitFor(() => {
      expect(screen.getByTestId("gate-built")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("compressing-starting"),
    ).not.toBeInTheDocument();
  });

  it("stays compressing when the snapshot reports zip not clean", async () => {
    renderZip();

    await emitSnapshot("dirty");

    expect(screen.queryByTestId("gate-built")).not.toBeInTheDocument();
    expect(screen.getByTestId("compressing-starting")).toBeInTheDocument();
  });

  it("ignores a clean snapshot row for a different stage", async () => {
    renderZip();

    act(() => {
      _projectCallback?.({
        type: "project-snapshot",
        project_stages: [{ ...zipStageRow("clean"), stage_id: "archive" }],
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("compressing-starting")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("gate-built")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Built state (after ZIP_DONE)
//
// Previously skipped: "gate-built, sha256-stat, zip-tree, download-zip-btn all
// require a ZIP_DONE event delivered via the SSE actor. At I1 the SSE actor is
// not yet wired in unit tests." The mocked `@/services/sse` seam above supplies
// exactly that, so these now run here rather than only in e2e.
// ---------------------------------------------------------------------------

describe("ZipTool — built state (after ZIP_DONE)", () => {
  it("renders gate-built after ZIP_DONE", async () => {
    renderZip();
    await emitSnapshot("clean");
    await waitFor(() => {
      expect(screen.getByTestId("gate-built")).toBeInTheDocument();
    });
  });

  it("renders sha256-stat with archive sha256 value", async () => {
    renderZip();
    await emitSnapshot("clean");
    await waitFor(() => {
      expect(screen.getByTestId("sha256-stat")).toBeInTheDocument();
    });
    expect(screen.getByTestId("sha256-stat")).toHaveTextContent("a3f1");
  });

  it("renders zip-tree with archive contents", async () => {
    renderZip();
    await emitSnapshot("clean");
    await waitFor(() => {
      expect(screen.getByTestId("zip-tree")).toBeInTheDocument();
    });
  });

  it("renders download-zip-btn after built", async () => {
    renderZip();
    await emitSnapshot("clean");
    await waitFor(() => {
      expect(screen.getByTestId("download-zip-btn")).toBeInTheDocument();
    });
  });

  it("compressing-banner is gone after built", async () => {
    renderZip();
    await emitSnapshot("clean");
    await waitFor(() => {
      expect(screen.getByTestId("gate-built")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("compressing-banner")).not.toBeInTheDocument();
  });

  it("zip-rebuild-btn visible in settings after built", async () => {
    const user = userEvent.setup();
    renderZip();
    await emitSnapshot("clean");
    await waitFor(() => {
      expect(screen.getByTestId("gate-built")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("tab", { name: "Step Settings" }));
    expect(screen.getByTestId("zip-rebuild-btn")).toBeInTheDocument();
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
});
