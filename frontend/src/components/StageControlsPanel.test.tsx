/**
 * Tests for StageControlsPanel — M3 stage-filtered config controls.
 *
 * Mounts the component against an msw-mocked API and asserts:
 *   - Only the fields declared for the selected stage are shown.
 *   - Fields not in the stage's read-list are absent.
 *   - Apply fires PATCH /api/data/projects/{id}/pages/{idx0} with updated
 *     config_overrides.
 *   - Run fires POST .../stages/{stage_id}/run.
 *   - When no stageId is selected the panel renders nothing.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import type { components } from "../api/types.gen";
import { server } from "../test/server";
import { StageControlsPanel } from "./StageControlsPanel";

type PageRecord = components["schemas"]["PageRecord"];
type PageStageState = components["schemas"]["PageStageState"];

function makePage(overrides: Partial<PageRecord> = {}): PageRecord {
  return {
    project_id: "p1",
    idx0: 0,
    prefix: "f001",
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
    source_key: "projects/p1/source/scan_0001.png",
    thumbnail_key: null,
    processed_image_key: null,
    ocr_image_key: null,
    processing_status: "pending",
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
    ...overrides,
  };
}

function makeStageRow(stage_id: string): PageStageState {
  return {
    project_id: "p1",
    page_id: "0000",
    stage_id,
    status: "clean",
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

function renderPanel(
  props: Partial<React.ComponentProps<typeof StageControlsPanel>> = {},
) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <StageControlsPanel
        projectId="p1"
        idx0={0}
        stageId="threshold"
        page={makePage()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

// ─── Render: field filtering ───────────────────────────────────────────────

describe("StageControlsPanel field filtering", () => {
  it("renders threshold_level input when stage=threshold", async () => {
    server.use(
      http.get("/api/data/pipeline/stages/threshold/fields", () =>
        HttpResponse.json({
          stage_id: "threshold",
          fields: ["threshold_level"],
        }),
      ),
    );

    renderPanel();

    await waitFor(() => {
      expect(screen.getByTestId("field-threshold_level")).toBeInTheDocument();
    });
  });

  it("does NOT render fuzzy_pct for stage=threshold", async () => {
    server.use(
      http.get("/api/data/pipeline/stages/threshold/fields", () =>
        HttpResponse.json({
          stage_id: "threshold",
          fields: ["threshold_level"],
        }),
      ),
    );

    renderPanel();

    await waitFor(() => {
      expect(screen.getByTestId("field-threshold_level")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("field-fuzzy_pct")).not.toBeInTheDocument();
  });

  it("renders all declared fields for find_content_edges", async () => {
    server.use(
      http.get("/api/data/pipeline/stages/find_content_edges/fields", () =>
        HttpResponse.json({
          stage_id: "find_content_edges",
          fields: ["fuzzy_pct", "pixel_count_columns", "pixel_count_rows"],
        }),
      ),
    );

    renderPanel({ stageId: "find_content_edges" });

    await waitFor(() => {
      expect(screen.getByTestId("field-fuzzy_pct")).toBeInTheDocument();
      expect(
        screen.getByTestId("field-pixel_count_columns"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("field-pixel_count_rows")).toBeInTheDocument();
    });
  });

  it("renders empty state when stage has no config fields", async () => {
    server.use(
      http.get("/api/data/pipeline/stages/grayscale/fields", () =>
        HttpResponse.json({ stage_id: "grayscale", fields: [] }),
      ),
    );

    renderPanel({ stageId: "grayscale" });

    await waitFor(() => {
      expect(screen.getByTestId("stage-controls-panel")).toBeInTheDocument();
    });
    // No field inputs
    expect(screen.queryAllByTestId(/^field-/).length).toBe(0);
  });

  it("renders nothing when stageId is undefined", () => {
    renderPanel({ stageId: undefined });
    expect(
      screen.queryByTestId("stage-controls-panel"),
    ).not.toBeInTheDocument();
  });
});

// ─── Apply button ──────────────────────────────────────────────────────────

describe("StageControlsPanel Apply button", () => {
  it("Apply fires PATCH /api/data/projects/p1/pages/0 with updated config_overrides", async () => {
    let seenBody: Record<string, unknown> | null = null;

    server.use(
      http.get("/api/data/pipeline/stages/threshold/fields", () =>
        HttpResponse.json({
          stage_id: "threshold",
          fields: ["threshold_level"],
        }),
      ),
      http.patch("/api/data/projects/p1/pages/0", async ({ request }) => {
        seenBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(makePage());
      }),
    );

    renderPanel();

    await waitFor(() => {
      expect(screen.getByTestId("field-threshold_level")).toBeInTheDocument();
    });

    const input = screen.getByTestId("field-threshold_level");
    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, "160");

    const applyBtn = screen.getByRole("button", { name: /apply/i });
    await user.click(applyBtn);

    await waitFor(() => {
      expect(seenBody).not.toBeNull();
    });
    const body = seenBody as unknown as {
      config_overrides: Record<string, unknown>;
    };
    expect(body.config_overrides?.threshold_level).toBe(160);
  });
});

// ─── Run button ────────────────────────────────────────────────────────────

describe("StageControlsPanel Run button", () => {
  it("Run fires POST .../stages/threshold/run", async () => {
    let runCalled = false;

    server.use(
      http.get("/api/data/pipeline/stages/threshold/fields", () =>
        HttpResponse.json({
          stage_id: "threshold",
          fields: ["threshold_level"],
        }),
      ),
      http.post("/api/data/projects/p1/pages/0/stages/threshold/run", () => {
        runCalled = true;
        return HttpResponse.json(makeStageRow("threshold"));
      }),
    );

    renderPanel();

    await waitFor(() => {
      expect(screen.getByTestId("stage-controls-panel")).toBeInTheDocument();
    });

    const runBtn = screen.getByRole("button", { name: /run/i });
    const user = userEvent.setup();
    await user.click(runBtn);

    await waitFor(() => {
      expect(runCalled).toBe(true);
    });
  });

  it("Run fires POST .../stages/ocr/run?async=true for the ocr slow stage", async () => {
    let asyncCalled = false;
    let syncCalled = false;

    server.use(
      http.get("/api/data/pipeline/stages/ocr/fields", () =>
        HttpResponse.json({ stage_id: "ocr", fields: [] }),
      ),
      // async path handler — URL ends with "?async=true"
      http.post(
        "/api/data/projects/p1/pages/0/stages/ocr/run",
        ({ request }) => {
          const url = new URL(request.url);
          if (url.searchParams.get("async") === "true") {
            asyncCalled = true;
            return HttpResponse.json(makeStageRow("ocr"), { status: 202 });
          }
          syncCalled = true;
          return HttpResponse.json(makeStageRow("ocr"));
        },
      ),
    );

    renderPanel({ stageId: "ocr" });

    await waitFor(() => {
      expect(screen.getByTestId("stage-controls-panel")).toBeInTheDocument();
    });

    const runBtn = screen.getByRole("button", { name: /run/i });
    const user = userEvent.setup();
    await user.click(runBtn);

    await waitFor(() => {
      expect(asyncCalled).toBe(true);
    });
    expect(syncCalled).toBe(false);
  });

  it("Run fires POST .../stages/extract_illustrations/run?async=true for the extract_illustrations slow stage", async () => {
    let asyncCalled = false;

    server.use(
      http.get("/api/data/pipeline/stages/extract_illustrations/fields", () =>
        HttpResponse.json({
          stage_id: "extract_illustrations",
          fields: [],
        }),
      ),
      http.post(
        "/api/data/projects/p1/pages/0/stages/extract_illustrations/run",
        ({ request }) => {
          const url = new URL(request.url);
          if (url.searchParams.get("async") === "true") {
            asyncCalled = true;
          }
          return HttpResponse.json(makeStageRow("extract_illustrations"), {
            status: asyncCalled ? 202 : 200,
          });
        },
      ),
    );

    renderPanel({ stageId: "extract_illustrations" });

    await waitFor(() => {
      expect(screen.getByTestId("stage-controls-panel")).toBeInTheDocument();
    });

    const runBtn = screen.getByRole("button", { name: /run/i });
    const user = userEvent.setup();
    await user.click(runBtn);

    await waitFor(() => {
      expect(asyncCalled).toBe(true);
    });
  });

  it("Run fires sync path (no ?async) for normal stages like grayscale", async () => {
    let asyncCalled = false;
    let syncCalled = false;

    server.use(
      http.get("/api/data/pipeline/stages/grayscale/fields", () =>
        HttpResponse.json({ stage_id: "grayscale", fields: [] }),
      ),
      http.post(
        "/api/data/projects/p1/pages/0/stages/grayscale/run",
        ({ request }) => {
          const url = new URL(request.url);
          if (url.searchParams.get("async") === "true") {
            asyncCalled = true;
          } else {
            syncCalled = true;
          }
          return HttpResponse.json(makeStageRow("grayscale"));
        },
      ),
    );

    renderPanel({ stageId: "grayscale" });

    await waitFor(() => {
      expect(screen.getByTestId("stage-controls-panel")).toBeInTheDocument();
    });

    const runBtn = screen.getByRole("button", { name: /run/i });
    const user = userEvent.setup();
    await user.click(runBtn);

    await waitFor(() => {
      expect(syncCalled).toBe(true);
    });
    expect(asyncCalled).toBe(false);
  });
});
