/**
 * Tests for StageChainRail — the M3 polished workbench chip rail.
 *
 * Mounts the component against an msw-mocked API and asserts:
 *   - 22 chips render when the API returns 22 stages.
 *   - Status colors map correctly (one assertion per status enum value).
 *   - Click-to-select: clean/dirty chips call onStageSelect; others are disabled.
 *   - Thumbnails render for clean/dirty chips only.
 *   - Failed-stage tooltip surfaces error_message.
 *
 * The component pulls real PageStageState shapes from the codegen schema,
 * so the mock factory uses the exact field set the server emits. We avoid
 * `Partial<>` here for the same reason the API integration tests do —
 * ApiModel forces every field present on output.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { components } from "../api/types.gen";
import { server } from "../test/server";
import { TooltipProvider } from "./ui/Tooltip";
import { StageChainRail } from "./StageChainRail";

type PageStageState = components["schemas"]["PageStageState"];
type PageStageStatus = components["schemas"]["PageStageStatus"];

// Canonical stage id list — mirrors PAGE_STAGE_IDS in core/models.py
// (kept in sync with the Python tuple via the OpenAPI codegen). The list
// is hand-mirrored here to keep the tests self-contained, but the
// "22 chips" assertion below would fail if a stage were ever added/removed
// without updating this fixture.
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

function renderRail(
  props: Partial<React.ComponentProps<typeof StageChainRail>> = {},
) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <StageChainRail projectId="p1" idx0={0} {...props} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Render: 22 chips ──────────────────────────────────────────────────────

describe("StageChainRail render", () => {
  it("renders one chip per stage when the API returns 22 rows", async () => {
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json(STAGE_IDS.map((sid) => makeRow(sid))),
      ),
    );

    renderRail();

    await waitFor(() => {
      expect(screen.queryByText(/Loading stages/)).not.toBeInTheDocument();
    });

    const rail = screen.getByTestId("stage-chain-rail");
    expect(rail).toBeInTheDocument();
    // 22 chips, one per stage_id.
    const chips = rail.querySelectorAll('[data-testid^="stage-chip-"]');
    expect(chips.length).toBe(22);
  });

  it("each canonical stage_id has its own chip", async () => {
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json(STAGE_IDS.map((sid) => makeRow(sid))),
      ),
    );

    renderRail();

    await waitFor(() => {
      for (const sid of STAGE_IDS) {
        expect(screen.getByTestId(`stage-chip-${sid}`)).toBeInTheDocument();
      }
    });
  });
});

// ─── Status colors ─────────────────────────────────────────────────────────

describe("StageChainRail status colors", () => {
  // The chip carries a `data-status` attr matching the row.status; tests
  // assert via that attribute rather than computed className strings to
  // stay resilient to Tailwind class-name shuffles.

  it.each([
    ["not-run", "not-run"],
    ["running", "running"],
    ["clean", "clean"],
    ["dirty", "dirty"],
    ["failed", "failed"],
    ["not-applicable", "not-applicable"],
  ] as const)(
    "renders status %s with data-status=%s",
    async (incoming, expected) => {
      server.use(
        http.get("/api/data/projects/p1/pages/0/stages", () =>
          HttpResponse.json([
            makeRow("grayscale", incoming as PageStageStatus),
            ...STAGE_IDS.filter((s) => s !== "grayscale").map((s) =>
              makeRow(s),
            ),
          ]),
        ),
      );
      renderRail();
      await waitFor(() => {
        const chip = screen.getByTestId("stage-chip-grayscale");
        expect(chip).toHaveAttribute("data-status", expected);
      });
    },
  );
});

// ─── Failed-stage tooltip ──────────────────────────────────────────────────

describe("StageChainRail tooltip", () => {
  it("uses Radix Tooltip wrapper instead of native title attribute", async () => {
    // This test verifies that the chip is wrapped in a Radix Tooltip component
    // (indicated by the presence of data-state attribute added by Radix Tooltip's trigger).
    // The native title attribute has been removed in favor of the Radix wrapper.
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json([
          makeRow("grayscale", "failed", {
            error_message: "synthetic boom",
            stage_version: 7,
          }),
          ...STAGE_IDS.filter((s) => s !== "grayscale").map((s) => makeRow(s)),
        ]),
      ),
    );

    renderRail();
    const chip = await screen.findByTestId("stage-chip-grayscale");

    // Verify Radix Tooltip's trigger attributes are present
    // (data-state is added by Radix Tooltip's Trigger component)
    expect(chip).toHaveAttribute("data-state");

    // Verify the native title attribute is no longer used
    // (it was removed in favor of Radix Tooltip wrapper)
    expect(chip).not.toHaveAttribute("title");
  });

  it("tooltip content renders on hover with status, version, hash, and error message", async () => {
    // Verify that the tooltip portal content actually renders when the user
    // hovers over the chip. The Radix Tooltip renders its content into a portal
    // on interaction, not at initial mount.
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json([
          makeRow("grayscale", "failed", {
            error_message: "synthetic boom",
            stage_version: 7,
            input_hash: "abcd1234567890",
          }),
          ...STAGE_IDS.filter((s) => s !== "grayscale").map((s) => makeRow(s)),
        ]),
      ),
    );

    renderRail();
    const chip = await screen.findByTestId("stage-chip-grayscale");

    // Hover over the chip to trigger tooltip content rendering in the portal.
    const user = userEvent.setup();
    await user.hover(chip);

    // Verify that all expected tooltip content appears in the portal.
    // Radix Tooltip renders content twice: once in the visible <div> and once in
    // a visually-hidden <span role="tooltip"> for a11y. Use getAllByText and assert
    // the first match is in the document — avoids "Found multiple elements" error.
    expect(
      (await screen.findAllByText(/status: failed/))[0],
    ).toBeInTheDocument();
    expect((await screen.findAllByText(/v7/))[0]).toBeInTheDocument();
    expect(
      (await screen.findAllByText(/hash: abcd1234/))[0],
    ).toBeInTheDocument();
    expect(
      (await screen.findAllByText(/error: synthetic boom/))[0],
    ).toBeInTheDocument();
  });

  it("tooltip content includes last_run_at timestamp when present", async () => {
    const lastRunTimestamp = 1713139200; // 2024-04-15T00:00:00Z
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json([
          makeRow("grayscale", "clean", {
            last_run_at: lastRunTimestamp,
            stage_version: 3,
          }),
          ...STAGE_IDS.filter((s) => s !== "grayscale").map((s) => makeRow(s)),
        ]),
      ),
    );

    renderRail();
    const chip = await screen.findByTestId("stage-chip-grayscale");

    const user = userEvent.setup();
    await user.hover(chip);

    // Verify status and version appear (use findAllByText — Radix renders tooltip content twice)
    expect(
      (await screen.findAllByText(/status: clean/))[0],
    ).toBeInTheDocument();
    expect((await screen.findAllByText(/v3/))[0]).toBeInTheDocument();
    // Verify timestamp appears (ISO format from tooltipFor)
    expect(
      (await screen.findAllByText(/last run: 2024-04-15/))[0],
    ).toBeInTheDocument();
  });
});

// ─── M3: Click-to-select ───────────────────────────────────────────────────

describe("StageChainRail M3 click-to-select", () => {
  it("clicking a clean chip calls onStageSelect with the stage_id", async () => {
    const onSelect = vi.fn();
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json([
          makeRow("grayscale", "clean"),
          ...STAGE_IDS.filter((s) => s !== "grayscale").map((s) => makeRow(s)),
        ]),
      ),
    );

    renderRail({ onStageSelect: onSelect });
    const chip = await screen.findByTestId("stage-chip-grayscale");
    const user = userEvent.setup();
    await user.click(chip);

    expect(onSelect).toHaveBeenCalledWith("grayscale");
  });

  it("clicking a dirty chip calls onStageSelect with the stage_id", async () => {
    const onSelect = vi.fn();
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json([
          makeRow("grayscale", "dirty"),
          ...STAGE_IDS.filter((s) => s !== "grayscale").map((s) => makeRow(s)),
        ]),
      ),
    );

    renderRail({ onStageSelect: onSelect });
    const chip = await screen.findByTestId("stage-chip-grayscale");
    const user = userEvent.setup();
    await user.click(chip);

    expect(onSelect).toHaveBeenCalledWith("grayscale");
  });

  it("not-run chip is selectable so onStageSelect is called (allows Run in controls panel)", async () => {
    const onSelect = vi.fn();
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json(STAGE_IDS.map((sid) => makeRow(sid, "not-run"))),
      ),
    );

    renderRail({ onStageSelect: onSelect });
    const chip = await screen.findByTestId("stage-chip-grayscale");
    expect(chip).not.toBeDisabled();
    const user = userEvent.setup();
    await user.click(chip);

    expect(onSelect).toHaveBeenCalledWith("grayscale");
  });

  it("not-applicable chip is disabled so onStageSelect is never called", async () => {
    const onSelect = vi.fn();
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json([
          makeRow("grayscale", "not-applicable"),
          ...STAGE_IDS.filter((s) => s !== "grayscale").map((s) => makeRow(s)),
        ]),
      ),
    );

    renderRail({ onStageSelect: onSelect });
    const chip = await screen.findByTestId("stage-chip-grayscale");
    expect(chip).toBeDisabled();
    const user = userEvent.setup();
    await user.click(chip);

    expect(onSelect).not.toHaveBeenCalled();
  });
});

// ─── M3: data-stage-id attribute ──────────────────────────────────────────────

describe("StageChainRail M3 data-stage-id", () => {
  it("each chip has a data-stage-id attribute matching its stage_id", async () => {
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json(STAGE_IDS.map((sid) => makeRow(sid))),
      ),
    );

    renderRail();

    await waitFor(() => {
      for (const sid of STAGE_IDS) {
        const chip = screen.getByTestId(`stage-chip-${sid}`);
        expect(chip).toHaveAttribute("data-stage-id", sid);
      }
    });
  });
});

// ─── M3: Inline thumbnails ─────────────────────────────────────────────────

describe("StageChainRail M3 thumbnails", () => {
  it("clean image-type chip renders a thumbnail img pointing at the thumbnail endpoint", async () => {
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json([
          makeRow("grayscale", "clean"),
          ...STAGE_IDS.filter((s) => s !== "grayscale").map((s) => makeRow(s)),
        ]),
      ),
    );

    renderRail();

    await waitFor(() => {
      const thumb = screen.queryByTestId("stage-thumb-grayscale");
      expect(thumb).toBeInTheDocument();
      expect(thumb).toHaveAttribute(
        "src",
        "/api/data/projects/p1/pages/0/stages/grayscale/thumbnail",
      );
    });
  });

  it("thumbnail src has no ?v= cache-busting param (ETag revalidation path)", async () => {
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json([
          makeRow("grayscale", "clean", { last_run_at: 9999999 }),
          ...STAGE_IDS.filter((s) => s !== "grayscale").map((s) => makeRow(s)),
        ]),
      ),
    );

    renderRail();

    await waitFor(() => {
      const thumb = screen.queryByTestId("stage-thumb-grayscale");
      expect(thumb).toBeInTheDocument();
      // No query string — browser's native If-None-Match / ETag handles freshness
      expect(thumb?.getAttribute("src") ?? "").not.toContain("?v=");
    });
  });

  it("dirty image-type chip renders a thumbnail img", async () => {
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json([
          makeRow("grayscale", "dirty"),
          ...STAGE_IDS.filter((s) => s !== "grayscale").map((s) => makeRow(s)),
        ]),
      ),
    );

    renderRail();

    await waitFor(() => {
      expect(screen.queryByTestId("stage-thumb-grayscale")).toBeInTheDocument();
    });
  });

  it("clean non-image chip (find_content_edges) shows text icon, not a thumbnail img", async () => {
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json([
          makeRow("find_content_edges", "clean"),
          ...STAGE_IDS.filter((s) => s !== "find_content_edges").map((s) =>
            makeRow(s),
          ),
        ]),
      ),
    );

    renderRail();

    await waitFor(() => {
      // No thumbnail for text-output stage
      expect(
        screen.queryByTestId("stage-thumb-find_content_edges"),
      ).not.toBeInTheDocument();
      // Text icon shown instead
      expect(
        screen.queryByTestId("stage-icon-find_content_edges"),
      ).toBeInTheDocument();
    });
  });

  it("not-run chips do NOT render thumbnail imgs", async () => {
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json(STAGE_IDS.map((sid) => makeRow(sid, "not-run"))),
      ),
    );

    renderRail();

    await waitFor(() => {
      // All chips are rendered but none have thumbnails.
      expect(screen.queryByTestId("stage-chip-grayscale")).toBeInTheDocument();
      expect(screen.queryAllByTestId(/^stage-thumb-/).length).toBe(0);
    });
  });
});

// ─── P2-4: StageCell tile rendering ───────────────────────────────────────────

describe("StageChainRail P2-4 StageCell tiles", () => {
  it("each stage chip renders the stage name text via StageCell", async () => {
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json([
          makeRow("grayscale", "clean"),
          ...STAGE_IDS.filter((s) => s !== "grayscale").map((s) => makeRow(s)),
        ]),
      ),
    );

    renderRail();

    // StageCell renders the stage name as visible text inside the chip button.
    await waitFor(() => {
      // The chip button should contain the stage name text (rendered by StageCell).
      const chip = screen.getByTestId("stage-chip-grayscale");
      expect(chip).toBeInTheDocument();
      // StageCell renders the stage id as a text node inside the chip.
      expect(chip.textContent).toContain("grayscale");
    });
  });

  it("clean chip renders a StageCell with matching stage name", async () => {
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json([
          makeRow("threshold", "clean"),
          ...STAGE_IDS.filter((s) => s !== "threshold").map((s) => makeRow(s)),
        ]),
      ),
    );

    renderRail();

    await waitFor(() => {
      const chip = screen.getByTestId("stage-chip-threshold");
      // Stage name appears inside the tile (via StageCell's text span).
      expect(chip.textContent).toContain("threshold");
    });
  });
});

// ─── M3: Run button in selected chip ──────────────────────────────────────────

describe("StageChainRail M3 run button", () => {
  it("selected chip shows a Run button", async () => {
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json([
          makeRow("grayscale", "clean"),
          ...STAGE_IDS.filter((s) => s !== "grayscale").map((s) => makeRow(s)),
        ]),
      ),
    );

    renderRail({ selectedStageId: "grayscale" });

    await waitFor(() => {
      expect(screen.getByTestId("stage-run-btn-grayscale")).toBeInTheDocument();
    });
  });

  it("non-selected chips do NOT show a Run button", async () => {
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json([
          makeRow("grayscale", "clean"),
          makeRow("threshold", "clean"),
          ...STAGE_IDS.filter(
            (s) => s !== "grayscale" && s !== "threshold",
          ).map((s) => makeRow(s)),
        ]),
      ),
    );

    // grayscale is selected; threshold is not
    renderRail({ selectedStageId: "grayscale" });

    await waitFor(() => {
      expect(screen.getByTestId("stage-run-btn-grayscale")).toBeInTheDocument();
      expect(
        screen.queryByTestId("stage-run-btn-threshold"),
      ).not.toBeInTheDocument();
    });
  });

  it("Run button calls onStageRun with the stage_id when clicked", async () => {
    const onRun = vi.fn();
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json([
          makeRow("grayscale", "clean"),
          ...STAGE_IDS.filter((s) => s !== "grayscale").map((s) => makeRow(s)),
        ]),
      ),
    );

    renderRail({ selectedStageId: "grayscale", onStageRun: onRun });

    const runBtn = await screen.findByTestId("stage-run-btn-grayscale");
    const user = userEvent.setup();
    await user.click(runBtn);

    expect(onRun).toHaveBeenCalledWith("grayscale");
  });

  it("Run button appears for not-run selected chips so user can advance the chain", async () => {
    // not-run chips are now selectable so the user can pick any stage and hit Run
    // — this is the primary affordance for advancing a fresh page's chain.
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json(STAGE_IDS.map((sid) => makeRow(sid, "not-run"))),
      ),
    );

    renderRail({ selectedStageId: "grayscale" });

    await waitFor(() => {
      expect(
        screen.queryByTestId("stage-run-btn-grayscale"),
      ).toBeInTheDocument();
    });
  });

  it("Run button does not appear for not-applicable chips even if selectedStageId matches", async () => {
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json([
          makeRow("grayscale", "not-applicable"),
          ...STAGE_IDS.filter((s) => s !== "grayscale").map((s) => makeRow(s)),
        ]),
      ),
    );

    renderRail({ selectedStageId: "grayscale" });

    await waitFor(() => {
      expect(
        screen.queryByTestId("stage-run-btn-grayscale"),
      ).not.toBeInTheDocument();
    });
  });
});
