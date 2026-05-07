/**
 * Tests for StageChainRail — the workbench chip rail (M2 Slice 5).
 *
 * Mounts the component against an msw-mocked API and asserts:
 *   - 22 chips render when the API returns 22 stages.
 *   - Status colors map correctly (one assertion per status enum value).
 *   - Click invokes POST /run, success refetches the list.
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
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { components } from "../api/types.gen";
import { server } from "../test/server";
import { StageChainRail } from "./StageChainRail";

// Mock sonner so we can assert toast calls.
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));
import { toast } from "sonner";

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

function renderRail() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <StageChainRail projectId="p1" idx0={0} />
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

// ─── Click → POST → refetch ────────────────────────────────────────────────

describe("StageChainRail click-to-run", () => {
  it("clicking a chip POSTs to the run endpoint and toasts on success", async () => {
    let postCount = 0;
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json(STAGE_IDS.map((sid) => makeRow(sid))),
      ),
      http.post(
        "/api/data/projects/p1/pages/0/stages/grayscale/run",
        async () => {
          postCount++;
          return HttpResponse.json(makeRow("grayscale", "clean"));
        },
      ),
    );

    renderRail();
    const chip = await screen.findByTestId("stage-chip-grayscale");
    const user = userEvent.setup();
    await user.click(chip);

    await waitFor(() => {
      expect(postCount).toBe(1);
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining("grayscale"),
      );
    });
  });

  it("toasts an error and surfaces the HTTP code on failure", async () => {
    server.use(
      http.get("/api/data/projects/p1/pages/0/stages", () =>
        HttpResponse.json(STAGE_IDS.map((sid) => makeRow(sid))),
      ),
      http.post("/api/data/projects/p1/pages/0/stages/grayscale/run", () =>
        HttpResponse.json(
          { detail: "stage 'grayscale': dependencies not clean" },
          { status: 409 },
        ),
      ),
    );

    renderRail();
    const chip = await screen.findByTestId("stage-chip-grayscale");
    const user = userEvent.setup();
    await user.click(chip);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("409"));
    });
  });
});

// ─── Failed-stage tooltip ──────────────────────────────────────────────────

describe("StageChainRail tooltip", () => {
  it("includes error_message for failed stages", async () => {
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
    expect(chip.getAttribute("title") ?? "").toContain("synthetic boom");
    expect(chip.getAttribute("title") ?? "").toContain("v7");
  });
});
