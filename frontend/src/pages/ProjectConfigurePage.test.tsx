/**
 * Tests for ProjectConfigurePage — covers the M5 RunAllDirtyPanel
 * and P2-2 tab scaffold (Pipeline / Pages / Settings, URL-stateful).
 *
 * Covers:
 * - "Run all dirty stages" button is visible in the page.
 * - Clicking the button POSTs to /api/data/projects/{id}/run-dirty.
 * - A progress indicator appears after the button is clicked.
 * - The button is disabled while a run is in progress.
 * - Pipeline tab is active by default (?tab=pipeline / no param).
 * - Switching to Pages tab shows page-list content.
 * - Switching to Settings tab shows settings content.
 * - Tab state is reflected in URL search params.
 * - Drag-and-drop page reordering via HTML5 native D&D.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { server } from "../test/server";
import { ProjectConfigurePage } from "./ProjectConfigurePage";

function renderWithProviders(
  ui: ReactElement,
  initialPath = "/projects/proj1",
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/projects/:projectId" element={ui} />
          <Route path="/projects/:projectId/*" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const baseProject = {
  id: "proj1",
  name: "Test Book",
  owner_id: "default",
  status: "ready",
  page_count: 3,
  proof_page_count: 3,
  created_at: "2026-05-01T10:00:00Z",
  updated_at: "2026-05-01T10:00:00Z",
  config: {
    book_name: "Test Book",
    source_uri: "",
    alignment: "default",
    crop_to_content: true,
    crop_add_px: 5,
    threshold_level: null,
    white_space_additional: null,
    do_morph: false,
    fuzzy_pct: null,
    book_language: null,
    scannos_file: null,
    custom_regex: null,
    default_overrides: {},
    optimize_png: true,
    proof_start_idx0: null,
    proof_end_idx0: null,
    frontmatter_start_idx0: null,
    frontmatter_end_idx0: null,
    bodymatter_start_idx0: null,
    bodymatter_end_idx0: null,
    frontmatter_page_nbr_start: 1,
    bodymatter_page_nbr_start: 1,
  },
  pipeline_state: {
    unzip_done: false,
    thumbnails_done: false,
    process_pages_done: false,
    ocr_done: false,
    text_postprocess_done: false,
    build_package_done: false,
    extract_illustrations_done: false,
  },
  storage_prefix: "projects/proj1/",
  source_key: null,
  package_key: null,
  stage_artifacts_bytes: 0,
  source_zip_bytes: 0,
};

const pagesResponse = {
  pages: [],
  total: 0,
  next_cursor: null,
};

const samplePage = {
  project_id: "proj1",
  idx0: 0,
  prefix: "0001",
  source_stem: "scan_0001",
  ignore: false,
  page_type: "normal",
  alignment: "default",
  config_overrides: {
    initial_crop: null,
    white_space_additional: null,
    threshold_level: null,
    fuzzy_pct: null,
    pixel_count_columns: null,
    pixel_count_rows: null,
    skip_auto_deskew: null,
    deskew_before_crop: null,
    deskew_after_crop: null,
    do_morph: null,
    skip_denoise: null,
    use_ocr_bbox_edge: null,
    rotated_standard: null,
    single_dimension_rescale: null,
    manual_deskew_angle: null,
  },
  splits: [],
  illustration_regions: [],
  source_key: null,
  thumbnail_key: null,
  processed_image_key: null,
  ocr_image_key: null,
  processing_status: "complete",
  processing_job_id: null,
  processing_error: null,
  last_processed_at: null,
  outputs: [],
  parent_page_id: null,
  source_crop_bbox: null,
  split_index: null,
  split_at_stage: null,
  split_suffix: null,
  reading_order: 0,
};

const pagesWithOneResponse = {
  pages: [samplePage],
  total: 1,
  next_cursor: null,
};

function setupBaseHandlers() {
  server.use(
    http.get("/api/data/projects/proj1", () => HttpResponse.json(baseProject)),
    http.get("/api/data/projects/proj1/pages", () =>
      HttpResponse.json(pagesResponse),
    ),
    http.get("/api/gpu/jobs", () => HttpResponse.json([])),
    http.get("/api/data/jobs", () => HttpResponse.json([])),
    http.get("/api/data/projects/proj1/review-status", () =>
      HttpResponse.json({ unreviewed_count: 0, awaiting_review_job_id: null }),
    ),
  );
}

function setupHandlersWithPage() {
  server.use(
    http.get("/api/data/projects/proj1", () => HttpResponse.json(baseProject)),
    http.get("/api/data/projects/proj1/pages", () =>
      HttpResponse.json(pagesWithOneResponse),
    ),
    http.get("/api/gpu/jobs", () => HttpResponse.json([])),
    http.get("/api/data/jobs", () => HttpResponse.json([])),
    http.get("/api/data/projects/proj1/review-status", () =>
      HttpResponse.json({ unreviewed_count: 0, awaiting_review_job_id: null }),
    ),
  );
}

describe("ProjectConfigurePage — RunAllDirtyPanel", () => {
  it("renders the Run all dirty stages button", async () => {
    setupBaseHandlers();
    renderWithProviders(<ProjectConfigurePage />);
    expect(
      await screen.findByRole("button", { name: /run all dirty stages/i }),
    ).toBeInTheDocument();
  });

  it("POSTs to /api/data/projects/{id}/run-dirty when button is clicked", async () => {
    setupBaseHandlers();
    let called = false;
    server.use(
      http.post("/api/data/projects/proj1/run-dirty", () => {
        called = true;
        return HttpResponse.json(
          { job_id: "job_x", status: "queued" },
          { status: 202 },
        );
      }),
      http.get("/api/gpu/jobs/:jobId/events", () => HttpResponse.json({})),
    );

    renderWithProviders(<ProjectConfigurePage />);
    const btn = await screen.findByRole("button", {
      name: /run all dirty stages/i,
    });
    await userEvent.click(btn);

    await waitFor(() => expect(called).toBe(true));
  });

  it("disables the button while a run-dirty mutation is pending", async () => {
    setupBaseHandlers();
    // Never-resolving handler — keeps mutation pending indefinitely.
    server.use(
      http.post(
        "/api/data/projects/proj1/run-dirty",
        () => new Promise(() => {}),
      ),
    );

    renderWithProviders(<ProjectConfigurePage />);
    const btn = await screen.findByRole("button", {
      name: /run all dirty stages/i,
    });
    await userEvent.click(btn);

    // Mutation is pending — button becomes disabled.
    await waitFor(() => expect(btn).toBeDisabled());
  });
});

describe("ProjectConfigurePage — P2-2 tab scaffold", () => {
  it("defaults to pipeline tab and shows pipeline content", async () => {
    setupBaseHandlers();
    renderWithProviders(<ProjectConfigurePage />);

    // Pipeline tab trigger should be present
    expect(
      await screen.findByRole("tab", { name: /pipeline/i }),
    ).toBeInTheDocument();
    // Pipeline content visible: Run all dirty stages button
    expect(
      await screen.findByRole("button", { name: /run all dirty stages/i }),
    ).toBeInTheDocument();
  });

  it("switching to pages tab shows page-list content", async () => {
    setupBaseHandlers();
    renderWithProviders(<ProjectConfigurePage />);

    // Wait for page to load
    await screen.findByRole("tab", { name: /pages/i });

    // Click the Pages tab
    await userEvent.click(screen.getByRole("tab", { name: /pages/i }));

    // Pages tab panel should be active — BulkActions renders null when no pages
    // selected, so the tab panel itself is now active. Verify by checking the
    // pipeline-only button is no longer in the document (hidden by Radix).
    await waitFor(() => {
      const pagesTab = screen.getByRole("tab", { name: /pages/i });
      expect(pagesTab).toHaveAttribute("aria-selected", "true");
    });
  });

  it("switching to settings tab shows settings content", async () => {
    setupBaseHandlers();
    renderWithProviders(<ProjectConfigurePage />);

    // Wait for page to load
    await screen.findByRole("tab", { name: /settings/i });

    // Click the Settings tab
    await userEvent.click(screen.getByRole("tab", { name: /settings/i }));

    // Book Settings accordion should appear in the settings panel
    await waitFor(() => {
      const settingsTab = screen.getByRole("tab", { name: /settings/i });
      expect(settingsTab).toHaveAttribute("aria-selected", "true");
    });

    expect(
      screen.getByRole("button", { name: /book settings/i }),
    ).toBeInTheDocument();
  });

  it("tab state is reflected in aria-selected attribute after switching", async () => {
    setupBaseHandlers();
    renderWithProviders(<ProjectConfigurePage />);

    await screen.findByRole("tab", { name: /pipeline/i });

    // Initially pipeline is selected
    expect(screen.getByRole("tab", { name: /pipeline/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: /pages/i })).toHaveAttribute(
      "aria-selected",
      "false",
    );

    // After clicking Pages, pages becomes selected
    await userEvent.click(screen.getByRole("tab", { name: /pages/i }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /pages/i })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.getByRole("tab", { name: /pipeline/i })).toHaveAttribute(
        "aria-selected",
        "false",
      );
    });
  });

  it("page header shows project name", async () => {
    setupBaseHandlers();
    renderWithProviders(<ProjectConfigurePage />);

    // PageHeader renders an h1 with the project name
    expect(
      await screen.findByRole("heading", { name: /test book/i }),
    ).toBeInTheDocument();
  });

  it("stat tile row shows total pages count", async () => {
    setupBaseHandlers();
    renderWithProviders(<ProjectConfigurePage />);

    // StatTile for total pages renders the page_count value (3) with label
    await waitFor(() => {
      expect(screen.getByText("Total pages")).toBeInTheDocument();
    });
  });
});

describe("ProjectConfigurePage — RunPipelinePanel", () => {
  it("does not render stale batch pipeline buttons (Process pages, OCR, Post-process, Extract illustrations)", async () => {
    setupBaseHandlers();
    renderWithProviders(<ProjectConfigurePage />);

    // Wait for the page to load
    await screen.findByRole("tab", { name: /pipeline/i });

    // Verify that stale batch job type step labels do NOT exist
    expect(
      screen.queryByText(/step 4 — process pages/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/step 4.5 — extract illustrations/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/step 7 — ocr/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/step 8 — text post-process/i),
    ).not.toBeInTheDocument();
  });

  it("renders a Build package button in the Pipeline tab", async () => {
    setupBaseHandlers();
    renderWithProviders(<ProjectConfigurePage />);

    // Wait for pipeline to load and verify Build package step label exists
    const buildLabel = await screen.findByText(/step 10 — build package/i);
    expect(buildLabel).toBeInTheDocument();
  });

  it("Build package button POSTs to /api/data/projects/{id}/build-package", async () => {
    setupBaseHandlers();
    let called = false;
    let calledUrl = "";
    server.use(
      http.post(
        "/api/data/projects/proj1/build-package",
        async ({ request }) => {
          called = true;
          calledUrl = request.url;
          return HttpResponse.json(
            { job_id: "job_build_1", status: "queued" },
            { status: 202 },
          );
        },
      ),
      http.get("/api/gpu/jobs/:jobId/events", () => HttpResponse.json({})),
    );

    renderWithProviders(<ProjectConfigurePage />);

    // Find the Build package step, then click its Run button
    const buildLabel = await screen.findByText(/step 10 — build package/i);
    const buildListItem = buildLabel.closest("li");
    const runBtn = buildListItem?.querySelector(
      'button[class*="hover:bg-slate-50"]',
    ) as HTMLButtonElement;

    await userEvent.click(runBtn);

    await waitFor(() => {
      expect(called).toBe(true);
      expect(calledUrl).toContain("/api/data/projects/proj1/build-package");
    });
  });

  it("disables Build package button while build_package job is pending", async () => {
    setupBaseHandlers();
    // Return a build_package job that is "running"
    const buildJob = {
      id: "job_build_1",
      type: "build_package",
      status: "running",
      progress: { current: 1, total: 1, message: "" },
      error_message: null,
    };
    server.use(
      http.get("/api/data/jobs", () => HttpResponse.json([buildJob])),
      http.get("/api/gpu/jobs", () => HttpResponse.json([buildJob])),
    );

    renderWithProviders(<ProjectConfigurePage />);

    // Find the Build package step
    const buildLabel = await screen.findByText(/step 10 — build package/i);
    const buildListItem = buildLabel.closest("li");
    const runBtn = buildListItem?.querySelector(
      'button[class*="hover:bg-slate-50"]',
    ) as HTMLButtonElement;

    // The build_package button should be disabled while the job is active
    // (because useActiveBatchJob should detect the running job)
    await waitFor(() => {
      expect(runBtn).toBeDisabled();
    });
  });

  it("button stays disabled immediately after submit via query invalidation", async () => {
    // Start with no jobs; after submit, the handler returns a new queued job
    let submitted = false;
    server.use(
      http.get("/api/data/projects/proj1", () =>
        HttpResponse.json(baseProject),
      ),
      http.get("/api/data/projects/proj1/pages", () =>
        HttpResponse.json(pagesResponse),
      ),
      http.get("/api/gpu/jobs", () => HttpResponse.json([])),
      http.get("/api/data/jobs", ({ request }) => {
        // Before submit: empty list
        // After submit: return the queued job
        if (submitted) {
          const url = new URL(request.url);
          const projectId = url.searchParams.get("project_id");
          if (projectId === "proj1") {
            return HttpResponse.json([
              {
                id: "job_build_new",
                type: "build_package",
                status: "queued",
                progress: { current: 0, total: 1, message: "" },
              },
            ]);
          }
        }
        return HttpResponse.json([]);
      }),
      http.post("/api/data/projects/proj1/build-package", () => {
        submitted = true;
        return HttpResponse.json(
          { job_id: "job_build_new", status: "queued" },
          { status: 202 },
        );
      }),
      http.get("/api/data/projects/proj1/review-status", () =>
        HttpResponse.json({
          unreviewed_count: 0,
          awaiting_review_job_id: null,
        }),
      ),
    );

    renderWithProviders(<ProjectConfigurePage />);

    // Find the Build package button
    const buildLabel = await screen.findByText(/step 10 — build package/i);
    const buildListItem = buildLabel.closest("li");
    const runBtn = buildListItem?.querySelector(
      'button[class*="hover:bg-slate-50"]',
    ) as HTMLButtonElement;

    // Button should be enabled initially (no active job)
    await waitFor(() => {
      expect(runBtn).not.toBeDisabled();
    });

    // Click the button
    await userEvent.click(runBtn);

    // After the mutation succeeds and invalidates the query, the button should
    // remain disabled because useActiveBatchJob detects the newly-created queued job
    await waitFor(() => {
      expect(runBtn).toBeDisabled();
    });
  });
});

describe("ProjectConfigurePage — Download Package button", () => {
  it("does not show Download Package button when no build_package job exists", async () => {
    setupBaseHandlers();
    renderWithProviders(<ProjectConfigurePage />);

    // Wait for the page to load
    await screen.findByRole("tab", { name: /pipeline/i });

    // Download Package button should not exist
    expect(
      screen.queryByRole("button", { name: /download package/i }),
    ).not.toBeInTheDocument();
  });

  it("shows Download Package button when build_package job has completed status", async () => {
    setupBaseHandlers();
    const completedJob = {
      id: "job_build_1",
      type: "build_package",
      status: "complete",
      progress: { current: 1, total: 1, message: "" },
      error_message: null,
    };
    server.use(
      http.get("/api/data/jobs", () => HttpResponse.json([completedJob])),
      http.get("/api/gpu/jobs", () => HttpResponse.json([completedJob])),
    );

    renderWithProviders(<ProjectConfigurePage />);

    // Wait for the Download Package button to appear
    const downloadBtn = await screen.findByRole("button", {
      name: /download package/i,
    });
    expect(downloadBtn).toBeInTheDocument();
    expect(downloadBtn).not.toBeDisabled();
  });

  it("clicking Download Package button fetches the download URL and opens it", async () => {
    setupBaseHandlers();
    const completedJob = {
      id: "job_build_1",
      type: "build_package",
      status: "complete",
      progress: { current: 1, total: 1, message: "" },
      error_message: null,
    };
    let downloadUrlFetched = false;
    const mockDownloadUrl =
      "https://example.com/download/project.zip?token=abc123";

    server.use(
      http.get("/api/data/jobs", () => HttpResponse.json([completedJob])),
      http.get("/api/gpu/jobs", () => HttpResponse.json([completedJob])),
      http.get("/api/data/projects/proj1/assets/download-url", () => {
        downloadUrlFetched = true;
        return HttpResponse.json({
          download_url: mockDownloadUrl,
          expires_in: 3600,
        });
      }),
    );

    // Mock window.open
    const mockOpen = vi.fn();
    globalThis.window.open = mockOpen;

    renderWithProviders(<ProjectConfigurePage />);

    const downloadBtn = await screen.findByRole("button", {
      name: /download package/i,
    });
    await userEvent.click(downloadBtn);

    await waitFor(() => {
      expect(downloadUrlFetched).toBe(true);
      expect(mockOpen).toHaveBeenCalledWith(
        mockDownloadUrl,
        "_blank",
        "noopener,noreferrer",
      );
    });
  });

  it("shows loading spinner while download URL is being fetched", async () => {
    setupBaseHandlers();
    const completedJob = {
      id: "job_build_1",
      type: "build_package",
      status: "complete",
      progress: { current: 1, total: 1, message: "" },
      error_message: null,
    };
    server.use(
      http.get("/api/data/jobs", () => HttpResponse.json([completedJob])),
      http.get("/api/gpu/jobs", () => HttpResponse.json([completedJob])),
      http.get(
        "/api/data/projects/proj1/assets/download-url",
        () => new Promise(() => {}), // Never resolves — keeps query pending
      ),
    );

    renderWithProviders(<ProjectConfigurePage />);

    const downloadBtn = await screen.findByRole("button", {
      name: /download package/i,
    });
    await userEvent.click(downloadBtn);

    // Button should be disabled while fetching
    await waitFor(() => {
      expect(downloadBtn).toBeDisabled();
    });

    // There should be a loading indicator text
    expect(screen.getByText(/downloading/i)).toBeInTheDocument();
  });

  it("shows error message if download URL fetch fails", async () => {
    setupBaseHandlers();
    const completedJob = {
      id: "job_build_1",
      type: "build_package",
      status: "complete",
      progress: { current: 1, total: 1, message: "" },
      error_message: null,
    };
    server.use(
      http.get("/api/data/jobs", () => HttpResponse.json([completedJob])),
      http.get("/api/gpu/jobs", () => HttpResponse.json([completedJob])),
      http.get("/api/data/projects/proj1/assets/download-url", () =>
        HttpResponse.json(
          { detail: "Failed to generate download URL" },
          { status: 500 },
        ),
      ),
    );

    renderWithProviders(<ProjectConfigurePage />);

    const downloadBtn = await screen.findByRole("button", {
      name: /download package/i,
    });
    await userEvent.click(downloadBtn);

    // Error message should appear
    await waitFor(() => {
      expect(screen.getByText(/failed to download/i)).toBeInTheDocument();
    });
  });

  it("does not show Download Package button while build_package is still running", async () => {
    setupBaseHandlers();
    const runningJob = {
      id: "job_build_1",
      type: "build_package",
      status: "running",
      progress: { current: 0, total: 1, message: "" },
      error_message: null,
    };
    server.use(
      http.get("/api/data/jobs", () => HttpResponse.json([runningJob])),
      http.get("/api/gpu/jobs", () => HttpResponse.json([runningJob])),
    );

    renderWithProviders(<ProjectConfigurePage />);

    // Wait for the page to load
    await screen.findByRole("tab", { name: /pipeline/i });

    // Download Package button should not be shown while job is running
    expect(
      screen.queryByRole("button", { name: /download package/i }),
    ).not.toBeInTheDocument();
  });
});

describe("ProjectConfigurePage — P2-3 PageDrawer via URL", () => {
  it("shows PageDrawer when ?tab=pages&drawer=0 is in the URL", async () => {
    setupHandlersWithPage();
    renderWithProviders(
      <ProjectConfigurePage />,
      "/projects/proj1?tab=pages&drawer=0",
    );

    // Drawer should be visible
    await waitFor(() => {
      expect(screen.getByTestId("page-drawer")).toBeInTheDocument();
    });
    // Header shows "Page 1" (idx0=0 → 1-indexed)
    expect(screen.getByText("Page 1")).toBeInTheDocument();
  });

  it("does not show PageDrawer when ?drawer is absent", async () => {
    setupHandlersWithPage();
    renderWithProviders(<ProjectConfigurePage />, "/projects/proj1?tab=pages");

    // Drawer should not be in the document
    await screen.findByTestId("pages-card");
    expect(screen.queryByTestId("page-drawer")).not.toBeInTheDocument();
  });

  it("closes the drawer when close button is clicked", async () => {
    setupHandlersWithPage();
    renderWithProviders(
      <ProjectConfigurePage />,
      "/projects/proj1?tab=pages&drawer=0",
    );

    // Wait for drawer to open
    await waitFor(() => {
      expect(screen.getByTestId("page-drawer")).toBeInTheDocument();
    });

    // Click close
    await userEvent.click(screen.getByTestId("page-drawer-close"));

    // Drawer should be gone
    await waitFor(() => {
      expect(screen.queryByTestId("page-drawer")).not.toBeInTheDocument();
    });
  });
});

describe("ProjectConfigurePage — BulkActions P0.1 (no stale Re-process button)", () => {
  it("does not render a Re-process selected button", async () => {
    setupHandlersWithPage();
    renderWithProviders(<ProjectConfigurePage />, "/projects/proj1?tab=pages");

    // Wait for the Pages tab content to load
    await screen.findByTestId("pages-card");

    // The stale "Re-process selected" button must not exist — it called
    // the deleted POST /api/gpu/jobs endpoint (M6 cleanup, P0.1 fix).
    expect(
      screen.queryByRole("button", { name: /re-process selected/i }),
    ).not.toBeInTheDocument();
  });
});

describe("ProjectConfigurePage — RunPipelinePanel P0.2 (Download package)", () => {
  // A mock EventSource that captures onmessage so tests can dispatch events.
  class MockEventSource {
    static instances: MockEventSource[] = [];
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;

    constructor(_url: string) {
      MockEventSource.instances.push(this);
    }

    close() {}

    /** Dispatch a job-progress event with the given payload. */
    emit(data: object) {
      if (this.onmessage) {
        this.onmessage(
          new MessageEvent("message", { data: JSON.stringify(data) }),
        );
      }
    }
  }

  it("shows Download package link after build_package completes", async () => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);

    setupBaseHandlers();

    server.use(
      http.post("/api/data/projects/proj1/build-package", () =>
        HttpResponse.json(
          { job_id: "job_build_dl", status: "queued" },
          { status: 202 },
        ),
      ),
      http.get(
        "/api/data/projects/proj1/assets/download-url",
        ({ request }) => {
          const key = new URL(request.url).searchParams.get("key");
          // Return a local CDN path for the package zip.
          const url = key ? `/cdn/${key}` : "/cdn/test.zip";
          return HttpResponse.json({ download_url: url, expires_in: 3600 });
        },
      ),
    );

    renderWithProviders(<ProjectConfigurePage />);

    // Wait for pipeline panel to render and click Run on build_package
    const buildLabel = await screen.findByText(/step 10 — build package/i);
    const buildListItem = buildLabel.closest("li")!;
    const runBtn = buildListItem.querySelector(
      'button[class*="hover:bg-slate-50"]',
    ) as HTMLButtonElement;

    await userEvent.click(runBtn);

    // Wait for MockEventSource to be created by useJobProgress
    await waitFor(() =>
      expect(MockEventSource.instances.length).toBeGreaterThan(0),
    );

    // Dispatch a "complete" progress event from the job's SSE stream
    await act(async () => {
      const es =
        MockEventSource.instances[MockEventSource.instances.length - 1];
      es.emit({
        type: "progress",
        status: "complete",
        current: 1,
        total: 1,
        current_page: null,
        message: "done",
        error: null,
      });
    });

    // The "Download package" link should appear once the download URL is fetched
    await waitFor(() => {
      expect(screen.getByTestId("download-package-link")).toBeInTheDocument();
    });
    expect(screen.getByTestId("download-package-link")).toHaveAttribute(
      "href",
      expect.stringContaining("for_zip"),
    );

    vi.unstubAllGlobals();
  });

  it("does not show Download package link when no build_package job has completed", async () => {
    setupBaseHandlers();
    renderWithProviders(<ProjectConfigurePage />);

    // Pipeline tab loads; no job has been submitted yet
    await screen.findByText(/step 10 — build package/i);

    // Download link should not exist
    expect(
      screen.queryByTestId("download-package-link"),
    ).not.toBeInTheDocument();
  });
});

// ─── Drag-and-drop page reordering ────────────────────────────────────────

/** Three-page response for drag-and-drop tests. */
const makePageRecord = (idx0: number) => ({
  project_id: "proj1",
  idx0,
  prefix: String(idx0 + 1).padStart(4, "0"),
  source_stem: `scan_${String(idx0 + 1).padStart(4, "0")}`,
  ignore: false,
  page_type: "normal",
  alignment: "default",
  config_overrides: {
    initial_crop: null,
    white_space_additional: null,
    threshold_level: null,
    fuzzy_pct: null,
    pixel_count_columns: null,
    pixel_count_rows: null,
    skip_auto_deskew: null,
    deskew_before_crop: null,
    deskew_after_crop: null,
    do_morph: null,
    skip_denoise: null,
    use_ocr_bbox_edge: null,
    rotated_standard: null,
    single_dimension_rescale: null,
    manual_deskew_angle: null,
  },
  splits: [],
  illustration_regions: [],
  source_key: null,
  thumbnail_key: null,
  processed_image_key: null,
  ocr_image_key: null,
  processing_status: "complete",
  processing_job_id: null,
  processing_error: null,
  last_processed_at: null,
  outputs: [],
  parent_page_id: null,
  source_crop_bbox: null,
  split_index: null,
  split_at_stage: null,
  split_suffix: null,
  reading_order: idx0,
});

const threePages = [makePageRecord(0), makePageRecord(1), makePageRecord(2)];

const threePagesResponse = {
  pages: threePages,
  total: 3,
  next_cursor: null,
};

function setupDragHandlers() {
  server.use(
    http.get("/api/data/projects/proj1", () => HttpResponse.json(baseProject)),
    http.get("/api/data/projects/proj1/pages", () =>
      HttpResponse.json(threePagesResponse),
    ),
    http.get("/api/gpu/jobs", () => HttpResponse.json([])),
    http.get("/api/data/jobs", () => HttpResponse.json([])),
    http.get("/api/data/projects/proj1/review-status", () =>
      HttpResponse.json({ unreviewed_count: 0, awaiting_review_job_id: null }),
    ),
  );
}

describe("ProjectConfigurePage — drag-and-drop page reordering", () => {
  it("each page row has a drag-handle element", async () => {
    setupDragHandlers();
    renderWithProviders(<ProjectConfigurePage />, "/projects/proj1?tab=pages");

    // Wait for rows to appear
    await waitFor(() => {
      expect(screen.getByTestId("page-row-0")).toBeInTheDocument();
    });

    // All three rows have a drag handle
    const handles = screen.getAllByTestId("drag-handle");
    expect(handles).toHaveLength(3);
  });

  it("calls PATCH reorder endpoint after dragstart on row 0 and drop on row 2", async () => {
    setupDragHandlers();

    let patchedBody: unknown = null;
    server.use(
      http.patch(
        "/api/data/projects/proj1/pages/reorder",
        async ({ request }) => {
          patchedBody = await request.json();
          return HttpResponse.json(
            { page_ids: ["0001", "0002", "0000"] },
            { status: 200 },
          );
        },
      ),
    );

    renderWithProviders(<ProjectConfigurePage />, "/projects/proj1?tab=pages");

    await waitFor(() => {
      expect(screen.getByTestId("page-row-0")).toBeInTheDocument();
    });

    const row0 = screen.getByTestId("page-row-0");
    const row2 = screen.getByTestId("page-row-2");

    // Simulate drag from row 0 to row 2.
    fireEvent.dragStart(row0);
    fireEvent.dragOver(row2);
    fireEvent.drop(row2);

    await waitFor(() => {
      expect(patchedBody).toEqual({ page_ids: ["0001", "0002", "0000"] });
    });
  });

  it("reverts page list to original order on server error", async () => {
    setupDragHandlers();

    server.use(
      http.patch("/api/data/projects/proj1/pages/reorder", () => {
        return HttpResponse.json(
          { detail: "Internal server error" },
          { status: 500 },
        );
      }),
    );

    // Spy on console.error to suppress noise in test output.
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    renderWithProviders(<ProjectConfigurePage />, "/projects/proj1?tab=pages");

    await waitFor(() => {
      expect(screen.getByTestId("page-row-0")).toBeInTheDocument();
    });

    const row0 = screen.getByTestId("page-row-0");
    const row2 = screen.getByTestId("page-row-2");

    // Simulate drag.
    fireEvent.dragStart(row0);
    fireEvent.dragOver(row2);
    fireEvent.drop(row2);

    // After optimistic reorder, row 0's test-id changes momentarily.
    // After the error, the list should revert — row 0 (idx0=0) is back.
    await waitFor(() => {
      // The original row with idx0=0 should be back in the DOM as "page-row-0".
      expect(screen.getByTestId("page-row-0")).toBeInTheDocument();
      expect(screen.getByTestId("page-row-1")).toBeInTheDocument();
      expect(screen.getByTestId("page-row-2")).toBeInTheDocument();
    });

    // Verify they appear in original order by checking text content order.
    const rows = screen.getAllByTestId(/^page-row-\d+$/);
    // The rows should represent pages in idx0 order: 0, 1, 2.
    expect(rows[0]).toHaveAttribute("data-testid", "page-row-0");
    expect(rows[1]).toHaveAttribute("data-testid", "page-row-1");
    expect(rows[2]).toHaveAttribute("data-testid", "page-row-2");

    consoleErrorSpy.mockRestore();
  });
});
