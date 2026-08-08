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

import { describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ProjectChannelEvent, ProjectStageState } from "@/types/pipeline";

// ---------------------------------------------------------------------------
// Mock @/services/sse — capture the project-channel callback so tests can push
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

// Import the component AFTER the mock is set up.
import { ArchiveTool } from "./ArchiveTool";
import type { ArchiveToolServices } from "@/machines/tools/archiveTool";

// ---------------------------------------------------------------------------
// Stub runnerRef + test services
// ---------------------------------------------------------------------------

const fakeRunnerRef = {} as never;

/** Minimal valid ProjectStageState for the archive row. */
function archiveStageRow(
  status: ProjectStageState["status"],
): ProjectStageState {
  return {
    project_id: "demo",
    stage_id: "archive",
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

const TEST_SERVICES: ArchiveToolServices = {
  archiveProject: (_pid, _items, _dest, _ret) =>
    Promise.resolve({ kept: "3.5 GB", dropped: "18.4 GB" }),
  persistItem: (_pid, _name, _keep) => Promise.resolve({ ok: true }),
};

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderArchive() {
  return render(
    <MemoryRouter>
      <ArchiveTool
        stageId="archive"
        runnerRef={fakeRunnerRef}
        _testServices={TEST_SERVICES}
      />
    </MemoryRouter>,
  );
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

// ---------------------------------------------------------------------------
// Rehydration from persisted stage status
//
// The archive stage is terminal and its status is persisted server-side. A
// fresh page load of an already-archived project must show the terminal gate,
// not the pre-archive keep/drop list. The project SSE channel carries the
// persisted status: a `project-snapshot` frame on connect, then incremental
// `project-stage-status` frames.
//
// Regression: e2e test_archive_tool_shows_terminal_state — the backend
// reported archive `clean` but the surface stayed in `reviewing` forever,
// because the machine always started at `reviewing` and nothing ever moved it.
// ---------------------------------------------------------------------------

describe("ArchiveTool — rehydration from persisted status", () => {
  it("renders gate-archived when the connect snapshot reports archive clean", async () => {
    renderArchive();
    expect(screen.queryByTestId("gate-archived")).not.toBeInTheDocument();

    act(() => {
      _projectCallback?.({
        type: "project-snapshot",
        project_stages: [archiveStageRow("clean")],
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("gate-archived")).toBeInTheDocument();
    });
  });

  it("renders gate-archived when a stage-status frame reports archive clean", async () => {
    renderArchive();

    act(() => {
      _projectCallback?.({
        type: "project-stage-status",
        stage_id: "archive",
        status: "clean",
        job_id: null,
        error_message: null,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("gate-archived")).toBeInTheDocument();
    });
  });

  it("stays in reviewing when the snapshot reports archive not clean", async () => {
    renderArchive();

    act(() => {
      _projectCallback?.({
        type: "project-snapshot",
        project_stages: [archiveStageRow("dirty")],
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("archive-now-btn")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("gate-archived")).not.toBeInTheDocument();
  });

  it("ignores clean frames for other stages", async () => {
    renderArchive();

    act(() => {
      _projectCallback?.({
        type: "project-stage-status",
        stage_id: "zip",
        status: "clean",
        job_id: null,
        error_message: null,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("archive-now-btn")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("gate-archived")).not.toBeInTheDocument();
  });
});
