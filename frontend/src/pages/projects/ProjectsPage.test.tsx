/**
 * ProjectsPage fixture tests.
 *
 * Covers every DCArtboard state from final/projects/projects.jsx:
 *   1. loading  — booting state (spinner)
 *   2. error    — loadError state (retry button)
 *   3. empty    — no projects, empty-state hero
 *   4. active   — project selected, activity tab default
 *   5. archived — archived project, manage tab with danger actions
 *   6. attributes — attributes tab rendered
 *   7. manage   — manage tab (active project, two-step delete)
 *
 * These are component-mount tests. We inject mock services so the machines
 * resolve synchronously via vi.waitFor without touching any network.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
  ProjectRecord,
  ManageActionResult,
  ActivityFeedResponse,
  AttributeRecord,
} from "@/mocks/types";
import { ProjectsPage, type ProjectsPageServices } from "./ProjectsPage";

// ---------------------------------------------------------------------------
// Test helpers
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
const ACTIVE_2 = makeProject({
  id: "p2",
  title: "Active Beta",
  status: "running",
});
const ARCHIVED_1 = makeProject({
  id: "p3",
  title: "Archived One",
  archived: true,
  archivedOn: "May 10, 2026",
});

const EMPTY_ACTIVITY_FEED: ActivityFeedResponse = {
  entries: [],
  totalCount: 0,
  commentCount: 0,
  stageCount: 0,
};

const EMPTY_ATTRIBUTES: AttributeRecord = {
  bib: {},
  pgdp: {},
  fmt: {},
  comments: "",
};

function makeServices(
  projects: ProjectRecord[],
  overrides: Partial<ProjectsPageServices> = {},
): ProjectsPageServices {
  return {
    rail: {
      fetchProjects: vi.fn().mockResolvedValue(projects),
    },
    detail: {
      fetchProjects: vi.fn().mockResolvedValue(projects),
    },
    manage: {
      runManageAction: vi.fn().mockResolvedValue({
        action: "archive",
        status: "archived",
      } satisfies ManageActionResult),
    },
    activity: {
      fetchRecentActivity: vi.fn().mockResolvedValue(EMPTY_ACTIVITY_FEED),
    },
    attributes: {
      fetchAttributes: vi.fn().mockResolvedValue(EMPTY_ATTRIBUTES),
      saveAttributes: vi.fn().mockResolvedValue(EMPTY_ATTRIBUTES),
    },
    ...overrides,
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

// ---------------------------------------------------------------------------
// Artboard 1 — Loading state (machine is booting)
// ---------------------------------------------------------------------------

describe("ProjectsPage — loading state", () => {
  it("shows spinner while booting (slow fetch)", () => {
    // Never-resolving fetch keeps machine in booting
    const services = makeServices([]);
    services.detail.fetchProjects = vi.fn(
      () => new Promise<ProjectRecord[]>(() => {}),
    );
    services.rail.fetchProjects = services.detail.fetchProjects;
    wrap(<ProjectsPage services={services} />);

    expect(screen.getByTestId("projects-loading")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Artboard 2 — Error state
// ---------------------------------------------------------------------------

describe("ProjectsPage — error state", () => {
  it("shows error + retry button on fetch failure", async () => {
    const services = makeServices([]);
    services.detail.fetchProjects = vi.fn().mockRejectedValue(new Error("net"));
    services.rail.fetchProjects = vi.fn().mockRejectedValue(new Error("net"));

    wrap(<ProjectsPage services={services} />);

    await vi.waitFor(() =>
      expect(screen.getByTestId("projects-error")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("projects-retry")).toBeInTheDocument();
  });

  it("retry button sends RETRY event", async () => {
    let calls = 0;
    const services = makeServices([]);
    services.detail.fetchProjects = vi.fn().mockImplementation(() => {
      calls++;
      return Promise.reject(new Error("net"));
    });
    services.rail.fetchProjects = vi.fn().mockRejectedValue(new Error("net"));

    const user = userEvent.setup();
    wrap(<ProjectsPage services={services} />);

    await vi.waitFor(() =>
      expect(screen.getByTestId("projects-retry")).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId("projects-retry"));

    // fetchProjects called again after retry
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Artboard 3 — Empty state
// ---------------------------------------------------------------------------

describe("ProjectsPage — empty state", () => {
  it("renders empty-state hero when no projects exist", async () => {
    wrap(<ProjectsPage services={makeServices([])} />);

    await vi.waitFor(() =>
      expect(screen.getByTestId("projects-empty")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("empty-new-project-btn")).toBeInTheDocument();
    expect(screen.getByText(/no projects yet/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Artboard 4 — Active project selected (activity tab)
// ---------------------------------------------------------------------------

describe("ProjectsPage — active project selected", () => {
  it("renders split pane with rail and detail after load", async () => {
    wrap(<ProjectsPage services={makeServices([ACTIVE_1, ACTIVE_2])} />);

    await vi.waitFor(() =>
      expect(screen.getByTestId("projects-rail")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("projects-detail")).toBeInTheDocument();
  });

  it("project row is visible in the rail", async () => {
    wrap(<ProjectsPage services={makeServices([ACTIVE_1, ACTIVE_2])} />);

    await vi.waitFor(() =>
      expect(screen.getByTestId("project-row-p1")).toBeInTheDocument(),
    );
  });

  it("auto-selects first project on load", async () => {
    wrap(<ProjectsPage services={makeServices([ACTIVE_1, ACTIVE_2])} />);

    await vi.waitFor(() =>
      expect(screen.getByTestId("detail-title")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("detail-title")).toHaveTextContent(
      "Active Alpha",
    );
  });

  it("detail header shows title and status badge", async () => {
    wrap(<ProjectsPage services={makeServices([ACTIVE_1, ACTIVE_2])} />);

    await vi.waitFor(() =>
      expect(screen.getByTestId("detail-title")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("detail-status-badge")).toBeInTheDocument();
  });

  it("activity tab is active by default", async () => {
    wrap(<ProjectsPage services={makeServices([ACTIVE_1, ACTIVE_2])} />);

    await vi.waitFor(() =>
      expect(screen.getByTestId("tab-activity")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("tab-activity")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("activity panel renders", async () => {
    wrap(<ProjectsPage services={makeServices([ACTIVE_1, ACTIVE_2])} />);

    await vi.waitFor(() =>
      expect(screen.getByTestId("activity-panel")).toBeInTheDocument(),
    );
  });

  it("Open project button is present for active project", async () => {
    wrap(<ProjectsPage services={makeServices([ACTIVE_1, ACTIVE_2])} />);

    await vi.waitFor(() =>
      expect(screen.getByTestId("open-project-btn")).toBeInTheDocument(),
    );
  });

  it("clicking a different row changes detail pane", async () => {
    const user = userEvent.setup();
    wrap(<ProjectsPage services={makeServices([ACTIVE_1, ACTIVE_2])} />);

    await vi.waitFor(() =>
      expect(screen.getByTestId("project-row-p2")).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId("project-row-p2"));

    await vi.waitFor(() =>
      expect(screen.getByTestId("detail-title")).toHaveTextContent(
        "Active Beta",
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Artboard 5 — Archived project selected
// ---------------------------------------------------------------------------

describe("ProjectsPage — archived project selected", () => {
  it("clicking Archived tab shows archived projects", async () => {
    const user = userEvent.setup();
    wrap(<ProjectsPage services={makeServices([ACTIVE_1, ARCHIVED_1])} />);

    await vi.waitFor(() =>
      expect(screen.getByTestId("rail-tab-archived")).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId("rail-tab-archived"));

    await vi.waitFor(() =>
      expect(screen.getByTestId("project-row-p3")).toBeInTheDocument(),
    );
  });

  it("archived project shows 'archived' badge label", async () => {
    const user = userEvent.setup();
    wrap(<ProjectsPage services={makeServices([ACTIVE_1, ARCHIVED_1])} />);

    await vi.waitFor(() =>
      expect(screen.getByTestId("rail-tab-archived")).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId("rail-tab-archived"));
    await user.click(await screen.findByTestId("project-row-p3"));

    await vi.waitFor(() =>
      expect(screen.getByTestId("detail-title")).toHaveTextContent(
        "Archived One",
      ),
    );
    // Status badge shows "archived"
    expect(screen.getByTestId("detail-status-badge")).toHaveTextContent(
      "archived",
    );
  });
});

// ---------------------------------------------------------------------------
// Artboard 6 — Attributes tab
// ---------------------------------------------------------------------------

describe("ProjectsPage — attributes tab", () => {
  it("switching to attributes tab renders attributes panel", async () => {
    const user = userEvent.setup();
    wrap(<ProjectsPage services={makeServices([ACTIVE_1])} />);

    await vi.waitFor(() =>
      expect(screen.getByTestId("tab-attributes")).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId("tab-attributes"));

    await vi.waitFor(() =>
      expect(screen.getByTestId("attributes-panel")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("tab-attributes")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

// ---------------------------------------------------------------------------
// Artboard 7 — Manage tab (active project)
// ---------------------------------------------------------------------------

describe("ProjectsPage — manage tab", () => {
  it("switching to manage tab renders manage panel", async () => {
    const user = userEvent.setup();
    wrap(<ProjectsPage services={makeServices([ACTIVE_1])} />);

    await vi.waitFor(() =>
      expect(screen.getByTestId("tab-manage")).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId("tab-manage"));

    await vi.waitFor(() =>
      expect(screen.getByTestId("manage-panel")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("tab-manage")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("active project shows clean, archive, save copy, delete actions", async () => {
    const user = userEvent.setup();
    wrap(<ProjectsPage services={makeServices([ACTIVE_1])} />);

    await vi.waitFor(() =>
      expect(screen.getByTestId("tab-manage")).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId("tab-manage"));

    await vi.waitFor(() =>
      expect(screen.getByTestId("manage-panel")).toBeInTheDocument(),
    );

    expect(screen.getByTestId("manage-action-clean")).toBeInTheDocument();
    expect(screen.getByTestId("manage-action-archive")).toBeInTheDocument();
    expect(screen.getByTestId("manage-action-saveCopy")).toBeInTheDocument();
    expect(screen.getByTestId("manage-action-delete")).toBeInTheDocument();
  });

  it("delete button for active project shows 'Delete…' (two-step)", async () => {
    const user = userEvent.setup();
    wrap(<ProjectsPage services={makeServices([ACTIVE_1])} />);

    await vi.waitFor(() =>
      expect(screen.getByTestId("tab-manage")).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId("tab-manage"));

    await vi.waitFor(() =>
      expect(
        screen.getByTestId("manage-action-btn-delete"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByTestId("manage-action-btn-delete")).toHaveTextContent(
      "Delete…",
    );
  });
});

// ---------------------------------------------------------------------------
// Rail interactions
// ---------------------------------------------------------------------------

describe("ProjectsPage — rail interactions", () => {
  it("Active/Archived counts show correct numbers", async () => {
    wrap(
      <ProjectsPage
        services={makeServices([ACTIVE_1, ACTIVE_2, ARCHIVED_1])}
      />,
    );

    await vi.waitFor(() =>
      expect(screen.getByTestId("rail-tab-active")).toBeInTheDocument(),
    );
    // Active tab shows count 2
    expect(screen.getByTestId("rail-tab-active")).toHaveTextContent("2");
    // Archived tab shows count 1
    expect(screen.getByTestId("rail-tab-archived")).toHaveTextContent("1");
  });

  it("search input filters visible projects", async () => {
    const user = userEvent.setup();
    wrap(<ProjectsPage services={makeServices([ACTIVE_1, ACTIVE_2])} />);

    await vi.waitFor(() =>
      expect(screen.getByTestId("projects-search")).toBeInTheDocument(),
    );

    await user.type(screen.getByTestId("projects-search"), "Alpha");
    // After debounce
    await vi.waitFor(
      () =>
        expect(screen.queryByTestId("project-row-p2")).not.toBeInTheDocument(),
      { timeout: 500 },
    );
    expect(screen.getByTestId("project-row-p1")).toBeInTheDocument();
  });

  it("pipeline mini strip renders in detail pane", async () => {
    wrap(<ProjectsPage services={makeServices([ACTIVE_1])} />);

    await vi.waitFor(() =>
      expect(screen.getByTestId("pipeline-mini")).toBeInTheDocument(),
    );
  });

  it("New project button is present", async () => {
    wrap(<ProjectsPage services={makeServices([ACTIVE_1])} />);

    await vi.waitFor(() =>
      expect(screen.getByTestId("new-project-btn")).toBeInTheDocument(),
    );
  });
});
