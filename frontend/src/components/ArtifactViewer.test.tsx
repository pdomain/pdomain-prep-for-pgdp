/**
 * Tests for ArtifactViewer — M3 side-by-side artifact viewer.
 *
 * Spec: docs/specs/2026-05-11-workbench-artifact-viewer-design.md §Decision #2
 *
 * Acceptance bullets verified here:
 *   - threshold auto-selects grayscale as Compare; both render as <img>
 *   - Selectors only offer stages with present artifacts (clean | dirty)
 *   - Non-image stages render as text, not <img> (find_content_edges)
 *   - extract_illustrations shows illustration panel, not <img>
 *   - Switching selectors changes artifact URL (includes ?v= cache-bust)
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type React from "react";
import { describe, expect, it } from "vitest";

import type { components } from "../api/types.gen";
import { server } from "../test/server";
import { ArtifactViewer } from "./ArtifactViewer";

type PageStageState = components["schemas"]["PageStageState"];
type PageStageStatus = components["schemas"]["PageStageStatus"];

// Canonical stage id list — mirrors PAGE_STAGE_IDS in core/models.py
const STAGE_IDS = [
  "ingest_source",
  "thumbnail",
  "auto_detect_attrs",
  "auto_detect_illustrations",
  "decode_source",
  "initial_crop",
  "manual_deskew_pre",
  "grayscale",
  "threshold",
  "invert",
  "find_content_edges",
  "crop_to_content",
  "auto_deskew",
  "morph_fill",
  "rescale",
  "canvas_map",
  "blank_proof_synth",
  "ocr_crop",
  "extract_illustrations",
  "ocr",
  "text_postprocess",
  "text_review",
];

function makeRow(
  stage_id: string,
  status: PageStageStatus = "not-run",
  overrides: Partial<PageStageState> = {},
): PageStageState {
  return {
    project_id: "p1",
    page_id: "0000",
    stage_id,
    status,
    stage_version: 1,
    artifact_key: null,
    config_hash: null,
    input_hash: null,
    last_run_at: null,
    duration_ms: null,
    error_message: null,
    job_id: null,
    ...overrides,
  };
}

function renderViewer(
  props: Partial<React.ComponentProps<typeof ArtifactViewer>> = {},
) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ArtifactViewer projectId="p1" idx0={0} {...props} />
    </QueryClientProvider>,
  );
}

// ─── Acceptance 1: threshold auto-selects grayscale as Compare ────────────────

describe("ArtifactViewer: default Compare selection", () => {
  it("opening with selectedStageId=threshold auto-selects grayscale as Compare", async () => {
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json([
          makeRow("grayscale", "clean", { last_run_at: 1000 }),
          makeRow("threshold", "clean", { last_run_at: 2000 }),
          ...STAGE_IDS.filter(
            (s) => s !== "grayscale" && s !== "threshold",
          ).map((s) => makeRow(s)),
        ]),
      ),
    );

    renderViewer({ selectedStageId: "threshold" });

    await waitFor(() => {
      const compareSelect = screen.getByTestId("artifact-compare-select");
      expect(compareSelect).toHaveValue("grayscale");
    });
  });

  it("both panes render as <img> when both selected stages are image-type", async () => {
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json([
          makeRow("grayscale", "clean", { last_run_at: 1000 }),
          makeRow("threshold", "clean", { last_run_at: 2000 }),
          ...STAGE_IDS.filter(
            (s) => s !== "grayscale" && s !== "threshold",
          ).map((s) => makeRow(s)),
        ]),
      ),
    );

    renderViewer({ selectedStageId: "threshold" });

    await waitFor(() => {
      expect(screen.getByTestId("artifact-primary-img")).toBeInTheDocument();
      expect(screen.getByTestId("artifact-compare-img")).toBeInTheDocument();
    });
  });
});

// ─── Acceptance 2: Selectors only offer stages with present artifacts ─────────

describe("ArtifactViewer: selector filtering", () => {
  it("Stage selector only lists stages with clean or dirty status", async () => {
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json([
          makeRow("grayscale", "clean"),
          makeRow("threshold", "dirty"),
          ...STAGE_IDS.filter(
            (s) => s !== "grayscale" && s !== "threshold",
          ).map((s) => makeRow(s, "not-run")),
        ]),
      ),
    );

    renderViewer();

    await waitFor(() => {
      const primarySelect = screen.getByTestId("artifact-primary-select");
      const options = Array.from(
        primarySelect.querySelectorAll<HTMLOptionElement>(
          "option:not([value=''])",
        ),
      ).map((o) => o.value);
      expect(options).toContain("grayscale");
      expect(options).toContain("threshold");
      // not-run stages must not appear
      expect(options).not.toContain("invert");
      expect(options).not.toContain("ingest_source");
    });
  });

  it("Compare selector also only lists stages with present artifacts", async () => {
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json([
          makeRow("grayscale", "clean"),
          makeRow("threshold", "clean"),
          ...STAGE_IDS.filter(
            (s) => s !== "grayscale" && s !== "threshold",
          ).map((s) => makeRow(s, "not-run")),
        ]),
      ),
    );

    renderViewer();

    await waitFor(() => {
      const compareSelect = screen.getByTestId("artifact-compare-select");
      const options = Array.from(
        compareSelect.querySelectorAll<HTMLOptionElement>(
          "option:not([value=''])",
        ),
      ).map((o) => o.value);
      expect(options).toContain("grayscale");
      expect(options).toContain("threshold");
      expect(options).not.toContain("invert");
    });
  });
});

// ─── Acceptance 3: Non-image stages render as text, not img ──────────────────

describe("ArtifactViewer: non-image stage rendering", () => {
  it("find_content_edges pane renders text container, not <img>", async () => {
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json([
          makeRow("find_content_edges", "clean", { last_run_at: 1000 }),
          ...STAGE_IDS.filter((s) => s !== "find_content_edges").map((s) =>
            makeRow(s),
          ),
        ]),
      ),
    );

    renderViewer({ selectedStageId: "find_content_edges" });

    await waitFor(() => {
      expect(
        screen.queryByTestId("artifact-primary-img"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("artifact-primary-text")).toBeInTheDocument();
    });
  });

  it("auto_detect_attrs (page_attrs JSON) renders text container, not <img>", async () => {
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json([
          makeRow("auto_detect_attrs", "clean", { last_run_at: 1000 }),
          ...STAGE_IDS.filter((s) => s !== "auto_detect_attrs").map((s) =>
            makeRow(s),
          ),
        ]),
      ),
    );

    renderViewer({ selectedStageId: "auto_detect_attrs" });

    await waitFor(() => {
      expect(
        screen.queryByTestId("artifact-primary-img"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("artifact-primary-text")).toBeInTheDocument();
    });
  });
});

// ─── Acceptance 3 (cont): extract_illustrations shows illustration panel ──────

describe("ArtifactViewer: extract_illustrations special case", () => {
  it("extract_illustrations renders illustration panel placeholder, not <img>", async () => {
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json([
          makeRow("extract_illustrations", "clean", { last_run_at: 1000 }),
          ...STAGE_IDS.filter((s) => s !== "extract_illustrations").map((s) =>
            makeRow(s),
          ),
        ]),
      ),
    );

    renderViewer({ selectedStageId: "extract_illustrations" });

    await waitFor(() => {
      expect(
        screen.queryByTestId("artifact-primary-img"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId("artifact-illustrations-panel"),
      ).toBeInTheDocument();
    });
  });
});

// ─── Acceptance 4: Cache-busting ?v= URL ─────────────────────────────────────

describe("ArtifactViewer: cache-busting artifact URLs", () => {
  it("artifact img src includes ?v=last_run_at when last_run_at is set", async () => {
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json([
          makeRow("grayscale", "clean", { last_run_at: 1717171717 }),
          ...STAGE_IDS.filter((s) => s !== "grayscale").map((s) => makeRow(s)),
        ]),
      ),
    );

    renderViewer({ selectedStageId: "grayscale" });

    await waitFor(() => {
      const img = screen.getByTestId("artifact-primary-img");
      expect(img).toHaveAttribute(
        "src",
        "/api/data/projects/p1/pages/0/stages/grayscale/artifact?v=1717171717",
      );
    });
  });

  it("switching primary selector changes artifact URL", async () => {
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json([
          makeRow("grayscale", "clean", { last_run_at: 1111 }),
          makeRow("threshold", "clean", { last_run_at: 2222 }),
          ...STAGE_IDS.filter(
            (s) => s !== "grayscale" && s !== "threshold",
          ).map((s) => makeRow(s)),
        ]),
      ),
    );

    renderViewer({ selectedStageId: "grayscale" });

    // Initial: grayscale selected as primary
    await waitFor(() => {
      const img = screen.getByTestId("artifact-primary-img");
      expect(img).toHaveAttribute("src", expect.stringContaining("grayscale"));
    });

    // Switch to threshold via selector
    const primarySelect = screen.getByTestId("artifact-primary-select");
    const user = userEvent.setup();
    await user.selectOptions(primarySelect, "threshold");

    await waitFor(() => {
      const img = screen.getByTestId("artifact-primary-img");
      expect(img).toHaveAttribute("src", expect.stringContaining("threshold"));
      expect(img).toHaveAttribute("src", expect.stringContaining("?v=2222"));
    });
  });
});
