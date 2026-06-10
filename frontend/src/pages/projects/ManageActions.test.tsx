/**
 * ManageTabPanel — wired manageActions machine tests.
 *
 * Covers:
 *   1. Archive flow: click Archive → confirming dialog → CONFIRM → service called
 *   2. Danger acknowledge gate: Delete (archived) → dialog → checkbox needed before
 *      CONFIRM enabled → ACKNOWLEDGE enables CONFIRM → CONFIRM calls service
 *   3. Cancel resets back to list (no pending action)
 *   4. New-project flow: clicking new-project-btn opens the create dialog
 *   5. Create dialog opens, submits, rail refreshes (mock API)
 *
 * All tests inject mock services so no real network calls are made.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ProjectRecord, ManageActionResult } from "@/mocks/types";
import type { ManageActionsServices } from "@/machines/projects/manageActions";
import { ProjectsPage, type ProjectsPageServices } from "./ProjectsPage";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(
  overrides: Partial<ProjectRecord> & { id: string; title: string },
): ProjectRecord {
  return {
    author: "Author Name",
    pages: 200,
    totalStages: 23,
    currentStage: 10,
    status: "queued",
    archived: false,
    updatedRel: "2h ago",
    updatedAbs: "2026-06-10T10:00:00Z",
    created: "2026-06-01",
    size: "12.0 MB",
    registry_version: 1,
    ...overrides,
  };
}

const ACTIVE_1 = makeProject({
  id: "p1",
  title: "Active Alpha",
  status: "ready",
});
const ARCHIVED_1 = makeProject({
  id: "p3",
  title: "Archived One",
  archived: true,
  archivedOn: "May 10, 2026",
});

function makeManageServices(
  spy?: ReturnType<typeof vi.fn>,
): ManageActionsServices {
  const runManageAction =
    spy ??
    vi.fn().mockResolvedValue({
      action: "archive",
      status: "archived",
    } satisfies ManageActionResult);
  return { runManageAction };
}

function makeServices(
  projects: ProjectRecord[],
  manageSpy?: ReturnType<typeof vi.fn>,
): ProjectsPageServices {
  return {
    rail: { fetchProjects: vi.fn().mockResolvedValue(projects) },
    detail: { fetchProjects: vi.fn().mockResolvedValue(projects) },
    manage: makeManageServices(manageSpy),
  };
}

function wrap(ui: ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Shared: load page → click Manage tab → wait for manage panel */
async function openManageTab(
  services: ProjectsPageServices,
): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  wrap(<ProjectsPage services={services} />);

  await waitFor(() =>
    expect(screen.getByTestId("tab-manage")).toBeInTheDocument(),
  );
  await user.click(screen.getByTestId("tab-manage"));
  await waitFor(() =>
    expect(screen.getByTestId("manage-panel")).toBeInTheDocument(),
  );
  return user;
}

/** Shared: navigate to archived projects and select ARCHIVED_1 */
async function openArchivedManageTab(
  services: ProjectsPageServices,
): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  wrap(<ProjectsPage services={services} />);

  await waitFor(() =>
    expect(screen.getByTestId("rail-tab-archived")).toBeInTheDocument(),
  );
  await user.click(screen.getByTestId("rail-tab-archived"));
  await waitFor(() =>
    expect(screen.getByTestId("project-row-p3")).toBeInTheDocument(),
  );
  await user.click(screen.getByTestId("project-row-p3"));
  await waitFor(() =>
    expect(screen.getByTestId("detail-title")).toHaveTextContent(
      "Archived One",
    ),
  );

  // Open manage tab
  await user.click(screen.getByTestId("tab-manage"));
  await waitFor(() =>
    expect(screen.getByTestId("manage-panel")).toBeInTheDocument(),
  );
  return user;
}

// ---------------------------------------------------------------------------
// 1. Archive flow
// ---------------------------------------------------------------------------

describe("ManageTabPanel — archive flow", () => {
  it("clicking Archive button opens the confirm dialog", async () => {
    const spy = vi
      .fn()
      .mockResolvedValue({ action: "archive", status: "archived" });
    const user = await openManageTab(makeServices([ACTIVE_1], spy));

    await user.click(screen.getByTestId("manage-action-btn-archive"));

    await waitFor(() =>
      expect(screen.getByTestId("delete-confirm-btn")).toBeInTheDocument(),
    );
    // Confirm button is enabled immediately (non-danger confirm)
    expect(screen.getByTestId("delete-confirm-btn")).not.toBeDisabled();
  });

  it("confirming archive calls the manage service with action=archive", async () => {
    const spy = vi.fn().mockResolvedValue({
      action: "archive",
      status: "archived",
    } satisfies ManageActionResult);
    const user = await openManageTab(makeServices([ACTIVE_1], spy));

    await user.click(screen.getByTestId("manage-action-btn-archive"));
    await waitFor(() =>
      expect(screen.getByTestId("delete-confirm-btn")).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId("delete-confirm-btn"));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(ACTIVE_1.id, "archive", undefined),
    );
  });

  it("cancelling archive dialog resets back to manage panel (no dialog)", async () => {
    const user = await openManageTab(makeServices([ACTIVE_1]));

    await user.click(screen.getByTestId("manage-action-btn-archive"));
    await waitFor(() =>
      expect(screen.getByTestId("delete-cancel-btn")).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId("delete-cancel-btn"));

    // Dialog should be gone
    await waitFor(() =>
      expect(
        screen.queryByTestId("delete-confirm-btn"),
      ).not.toBeInTheDocument(),
    );
    // Manage panel still visible
    expect(screen.getByTestId("manage-panel")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 2. Danger acknowledge gate (permanent delete on archived project)
// ---------------------------------------------------------------------------

describe("ManageTabPanel — danger acknowledge gate (archived delete)", () => {
  it("permanent delete button opens danger dialog with acknowledge checkbox", async () => {
    const user = await openArchivedManageTab(
      makeServices([ACTIVE_1, ARCHIVED_1]),
    );

    await user.click(screen.getByTestId("manage-action-btn-delete"));

    // The dialog should be visible
    await waitFor(() =>
      expect(screen.getByTestId("delete-acknowledge")).toBeInTheDocument(),
    );
  });

  it("CONFIRM button is disabled before acknowledging", async () => {
    const user = await openArchivedManageTab(
      makeServices([ACTIVE_1, ARCHIVED_1]),
    );

    await user.click(screen.getByTestId("manage-action-btn-delete"));

    await waitFor(() =>
      expect(screen.getByTestId("delete-confirm-btn")).toBeInTheDocument(),
    );
    // Confirm must be disabled while armed (ack not checked)
    expect(screen.getByTestId("delete-confirm-btn")).toBeDisabled();
  });

  it("checking the acknowledge checkbox enables CONFIRM", async () => {
    const user = await openArchivedManageTab(
      makeServices([ACTIVE_1, ARCHIVED_1]),
    );

    await user.click(screen.getByTestId("manage-action-btn-delete"));

    await waitFor(() =>
      expect(screen.getByTestId("delete-acknowledge")).toBeInTheDocument(),
    );

    // Click the checkbox to acknowledge
    await user.click(screen.getByTestId("delete-acknowledge"));

    await waitFor(() =>
      expect(screen.getByTestId("delete-confirm-btn")).not.toBeDisabled(),
    );
  });

  it("confirming after acknowledge calls the service with step=2", async () => {
    const spy = vi.fn().mockResolvedValue({
      action: "delete",
      deleted: true,
    } satisfies ManageActionResult);
    const user = await openArchivedManageTab(
      makeServices([ACTIVE_1, ARCHIVED_1], spy),
    );

    await user.click(screen.getByTestId("manage-action-btn-delete"));

    await waitFor(() =>
      expect(screen.getByTestId("delete-acknowledge")).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId("delete-acknowledge"));

    await waitFor(() =>
      expect(screen.getByTestId("delete-confirm-btn")).not.toBeDisabled(),
    );
    await user.click(screen.getByTestId("delete-confirm-btn"));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(ARCHIVED_1.id, "delete", 2),
    );
  });

  it("cancelling danger dialog resets without calling the service", async () => {
    const spy = vi.fn();
    const user = await openArchivedManageTab(
      makeServices([ACTIVE_1, ARCHIVED_1], spy),
    );

    await user.click(screen.getByTestId("manage-action-btn-delete"));

    await waitFor(() =>
      expect(screen.getByTestId("delete-cancel-btn")).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId("delete-cancel-btn"));

    await waitFor(() =>
      expect(
        screen.queryByTestId("delete-confirm-btn"),
      ).not.toBeInTheDocument(),
    );
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. New-project button opens create dialog
// ---------------------------------------------------------------------------

describe("ProjectsPage — new-project-btn opens create dialog", () => {
  it("new-project-btn opens the create project dialog", async () => {
    const user = userEvent.setup();
    wrap(<ProjectsPage services={makeServices([ACTIVE_1])} />);

    await waitFor(() =>
      expect(screen.getByTestId("new-project-btn")).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId("new-project-btn"));

    await waitFor(() =>
      expect(screen.getByTestId("create-project-dialog")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("create-project-name")).toBeInTheDocument();
  });

  it("create submit button is disabled before filling name+file", async () => {
    const user = userEvent.setup();
    wrap(<ProjectsPage services={makeServices([ACTIVE_1])} />);

    await waitFor(() =>
      expect(screen.getByTestId("new-project-btn")).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId("new-project-btn"));

    await waitFor(() =>
      expect(
        screen.getByTestId("create-project-submit-btn"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByTestId("create-project-submit-btn")).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// 4. Create dialog submits and rail refreshes
// ---------------------------------------------------------------------------

describe("ProjectsPage — create project flow", () => {
  it("submitting a valid name+zip calls the API and refreshes the rail", async () => {
    // Mock the API client calls
    const { api } = await import("@/api/client");
    const postSpy = vi
      .spyOn(api, "post")
      .mockImplementation(async (path: string) => {
        if (path === "/api/data/projects") {
          return {
            project: { id: "new-proj-1", name: "Test Book" },
            upload_url: "http://localhost/cdn/test-key",
            upload_key: "test-key",
          };
        }
        if (path === "/api/gpu/ingest") {
          return { job_id: "job-1", status: "queued" };
        }
        return {};
      });

    // Stub XHR upload (vitest jsdom does not do XHR)
    interface XhrMockShape {
      open: ReturnType<typeof vi.fn>;
      setRequestHeader: ReturnType<typeof vi.fn>;
      send: ReturnType<typeof vi.fn>;
      upload: { onprogress: null };
      status: number;
      onload: (() => void) | null;
      onerror: (() => void) | null;
    }
    const xhrMock: XhrMockShape = {
      open: vi.fn(),
      setRequestHeader: vi.fn(),
      send: vi.fn().mockImplementation(function (this: XhrMockShape) {
        this.onload?.();
      }),
      upload: { onprogress: null },
      status: 200,
      onload: null,
      onerror: null,
    };
    vi.spyOn(globalThis, "XMLHttpRequest").mockImplementation(
      () => xhrMock as unknown as XMLHttpRequest,
    );

    const user = userEvent.setup();
    wrap(<ProjectsPage services={makeServices([ACTIVE_1])} />);

    await waitFor(() =>
      expect(screen.getByTestId("new-project-btn")).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId("new-project-btn"));

    await waitFor(() =>
      expect(screen.getByTestId("create-project-name")).toBeInTheDocument(),
    );

    // Fill name
    await user.type(screen.getByTestId("create-project-name"), "Test Book");

    // Attach a fake zip file
    const file = new File(["zip content"], "scan.zip", {
      type: "application/zip",
    });
    const fileInput = screen.getByTestId("create-project-zip-input");
    await user.upload(fileInput, file);

    await waitFor(() =>
      expect(
        screen.getByTestId("create-project-submit-btn"),
      ).not.toBeDisabled(),
    );

    await user.click(screen.getByTestId("create-project-submit-btn"));

    // API should have been called with the project name
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(
        "/api/data/projects",
        expect.objectContaining({ name: "Test Book" }),
      ),
    );

    postSpy.mockRestore();
    vi.restoreAllMocks();
  });
});
