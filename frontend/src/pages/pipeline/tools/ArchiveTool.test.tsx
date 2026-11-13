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
import {
  createMemoryRouter,
  MemoryRouter,
  RouterProvider,
} from "react-router-dom";
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
  subscribePageChannel: () => vi.fn(),
  subscribeProjectPageStageChannel: () => vi.fn(),
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

const KEPT_NAME = "pages/0001/stages/threshold/output.png";
const DROPPED_NAME = "pages/0001/stages/grayscale/output.png";
const KEPT_ROW = "archive-item-pages-0001-stages-threshold-output-png";
const KEPT_TOGGLE = "toggle-keep-pages-0001-stages-threshold-output-png";
const DROPPED_TOGGLE = "toggle-keep-pages-0001-stages-grayscale-output-png";

const TEST_SERVICES: ArchiveToolServices = {
  archiveProject: (_pid, _items, _dest, _ret) =>
    Promise.resolve({ kept: "3.5 GB", dropped: "18.4 GB" }),
  persistItem: (_pid, _name, _keep) => Promise.resolve({ ok: true }),
  listItems: () =>
    Promise.resolve([
      { name: KEPT_NAME, meta: "9 B", keep: true },
      { name: DROPPED_NAME, meta: "4 B", keep: false },
    ]),
};

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

async function renderArchive() {
  const view = render(
    <MemoryRouter>
      <ArchiveTool
        stageId="archive"
        runnerRef={fakeRunnerRef}
        _testServices={TEST_SERVICES}
      />
    </MemoryRouter>,
  );
  await screen.findByTestId(KEPT_ROW);
  return view;
}

// ---------------------------------------------------------------------------
// Initial reviewing state
// ---------------------------------------------------------------------------

describe("ArchiveTool — reviewing state", () => {
  it("renders archive-tool root", async () => {
    await renderArchive();
    expect(screen.getByTestId("archive-tool")).toBeInTheDocument();
  });

  it("renders archive-manifest", async () => {
    await renderArchive();
    expect(screen.getByTestId("archive-manifest")).toBeInTheDocument();
  });

  it("renders archive-now-btn in reviewing state", async () => {
    await renderArchive();
    expect(screen.getByTestId("archive-now-btn")).toBeInTheDocument();
  });

  it("renders the project stage files and not the mock catalog", async () => {
    await renderArchive();
    expect(await screen.findByTestId(KEPT_ROW)).toBeInTheDocument();
    expect(
      screen.queryByTestId("archive-item-original-scans"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Original scans")).not.toBeInTheDocument();
    expect(screen.queryByText("Finished package")).not.toBeInTheDocument();
    expect(screen.queryByText("Grayscale pages")).not.toBeInTheDocument();
  });

  it("renders toggle-keep-{name} for each item", async () => {
    await renderArchive();
    expect(await screen.findByTestId(KEPT_TOGGLE)).toBeInTheDocument();
    expect(screen.getByTestId(DROPPED_TOGGLE)).toBeInTheDocument();
  });

  it("gate-archived is NOT shown in reviewing state", async () => {
    await renderArchive();
    expect(screen.queryByTestId("gate-archived")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Toggle keep/drop
// ---------------------------------------------------------------------------

describe("ArchiveTool — TOGGLE_KEEP", () => {
  it("a kept stage file starts with a Drop button", async () => {
    await renderArchive();
    const btn = await screen.findByTestId(KEPT_TOGGLE);
    expect(btn).toHaveTextContent("Drop");
  });

  it("a dropped stage file starts with a Keep button", async () => {
    await renderArchive();
    const btn = await screen.findByTestId(DROPPED_TOGGLE);
    expect(btn).toHaveTextContent("Keep");
  });

  it("clicking toggle flips the button label", async () => {
    await renderArchive();
    const btn = await screen.findByTestId(KEPT_TOGGLE);
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
    await renderArchive();
    fireEvent.click(screen.getByTestId("archive-now-btn"));
    await waitFor(() => {
      // Either archiving-in-progress or gate-archived depending on mock speed
      const archiving = screen.queryByTestId("archiving-in-progress");
      const archived = screen.queryByTestId("gate-archived");
      expect(archiving || archived).toBeTruthy();
    });
  });

  it("renders gate-archived after archive completes", async () => {
    await renderArchive();
    fireEvent.click(screen.getByTestId("archive-now-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("gate-archived")).toBeInTheDocument();
    });
  });

  it("renders kept-stat after archiving", async () => {
    await renderArchive();
    fireEvent.click(screen.getByTestId("archive-now-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("kept-stat")).toBeInTheDocument();
    });
  });

  it("renders dropped-stat after archiving", async () => {
    await renderArchive();
    fireEvent.click(screen.getByTestId("archive-now-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("dropped-stat")).toBeInTheDocument();
    });
  });

  it("kept-stat shows mock kept value (3.5 GB)", async () => {
    await renderArchive();
    fireEvent.click(screen.getByTestId("archive-now-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("kept-stat")).toHaveTextContent("3.5 GB");
    });
  });

  it("archive-now-btn is gone; re-archive-btn appears after archived", async () => {
    await renderArchive();
    fireEvent.click(screen.getByTestId("archive-now-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("gate-archived")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("archive-now-btn")).not.toBeInTheDocument();
    expect(screen.getByTestId("re-archive-btn")).toBeInTheDocument();
  });

  it("toggle buttons are disabled after archiving", async () => {
    await renderArchive();
    fireEvent.click(screen.getByTestId("archive-now-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("gate-archived")).toBeInTheDocument();
    });
    expect(await screen.findByTestId(KEPT_TOGGLE)).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

describe("ArchiveTool — settings tab", () => {
  it("renders archive-settings panel on Settings tab", async () => {
    const user = userEvent.setup();
    await renderArchive();
    await user.click(screen.getByRole("tab", { name: "Step Settings" }));
    expect(screen.getByTestId("archive-settings")).toBeInTheDocument();
  });

  it("shows destination: glacier in settings", async () => {
    const user = userEvent.setup();
    await renderArchive();
    await user.click(screen.getByRole("tab", { name: "Step Settings" }));
    expect(screen.getByText("glacier")).toBeInTheDocument();
  });

  it("shows retention: 10yr in settings", async () => {
    const user = userEvent.setup();
    await renderArchive();
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

describe("ArchiveTool — inventory load", () => {
  it("disables archive and shows an error when the list fails", async () => {
    render(
      <MemoryRouter>
        <ArchiveTool
          stageId="archive"
          runnerRef={fakeRunnerRef}
          _testServices={{
            ...TEST_SERVICES,
            listItems: () => Promise.reject(new Error("offline")),
          }}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("archive-list-error")).toHaveTextContent(
      "Could not load the archive list.",
    );
    expect(screen.getByTestId("archive-now-btn")).toBeDisabled();
    expect(screen.queryByText("Original scans")).not.toBeInTheDocument();
  });

  it("loads and archives the project in the current route", async () => {
    const listItems = vi.fn((projectId: string) =>
      Promise.resolve([
        {
          name: `pages/${projectId}/stages/threshold/output.png`,
          meta: "1 B",
          keep: true,
        },
      ]),
    );
    const archiveProject = vi.fn(() =>
      Promise.resolve({
        kept: "1 B",
        dropped: "0 B",
      }),
    );
    const router = createMemoryRouter(
      [
        {
          path: "/projects/:projectId/archive",
          element: (
            <ArchiveTool
              stageId="archive"
              runnerRef={fakeRunnerRef}
              _testServices={{
                ...TEST_SERVICES,
                listItems,
                archiveProject,
              }}
            />
          ),
        },
      ],
      { initialEntries: ["/projects/alpha/archive"] },
    );
    render(<RouterProvider router={router} />);

    expect(
      await screen.findByText("pages/alpha/stages/threshold/output.png"),
    ).toBeInTheDocument();

    await act(async () => {
      await router.navigate("/projects/beta/archive");
    });

    expect(
      await screen.findByText("pages/beta/stages/threshold/output.png"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("pages/alpha/stages/threshold/output.png"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("archive-now-btn"));
    await waitFor(() => {
      expect(archiveProject).toHaveBeenCalledWith(
        "beta",
        expect.any(Array),
        "glacier",
        "10yr",
      );
    });
  });
});

describe("ArchiveTool — rehydration from persisted status", () => {
  it("renders gate-archived when the connect snapshot reports archive clean", async () => {
    await renderArchive();
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
    await renderArchive();

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
    await renderArchive();

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
    await renderArchive();

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
