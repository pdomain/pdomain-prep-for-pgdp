/**
 * Wire-level tests for the workbench drag-create surfaces.
 *
 * The `PageWorkbenchPage` component itself isn't mounted here — that
 * needs Konva + Router + QueryClient and belongs to a later tick. What
 * we lock here is the contract the component *uses*:
 *
 *   1. `PATCH /api/data/projects/{id}/pages/{idx0}` with a `splits`
 *      array body — the path drag-create takes after the user releases
 *      the mouse on a split rectangle (`handleAddSplit` ->
 *      `commitOverrides.mutate({ splits: [...]})`). The `pages.test.ts`
 *      already covers the page-type PATCH; this asserts the
 *      array-shaped split body that drag-create actually sends.
 *
 *   2. Same PATCH with an `illustration_regions` array body — drag-
 *      create's other branch (`handleAddRegion`).
 *
 * Note: `POST /api/gpu/process-page` tests removed in M6 — the Preview
 * button now calls the per-stage endpoint (canvas_map) via the existing
 * runStage mutation.
 */
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import type { components } from "./types.gen";

type PageRecord = components["schemas"]["PageRecord"];
import { api, setAuthToken } from "./client";
import { server } from "../test/server";

afterEach(() => {
  setAuthToken(null);
});

// ─── PageRecord helper (smaller copy from pages.test.ts to keep this file
//     standalone; once the third file lands the boilerplate moves to a
//     shared fixture in test/). ────────────────────────────────────────────

function makePage(overrides: Partial<PageRecord> = {}): PageRecord {
  return {
    project_id: "prj_abc123",
    idx0: 4,
    prefix: "f005",
    source_stem: "scan_0005",
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
      flip_horizontal: null,
      flip_vertical: null,
    },
    splits: [],
    illustration_regions: [],
    source_key: "projects/prj_abc123/source/scan_0005.png",
    thumbnail_key: null,
    processed_image_key: null,
    ocr_image_key: null,
    processing_status: "pending",
    processing_job_id: null,
    processing_error: null,
    last_processed_at: null,
    outputs: [],
    // Split-child fields (M2 §E). All null on a root page; reading_order=0.
    parent_page_id: null,
    source_crop_bbox: null,
    split_index: null,
    split_at_stage: null,
    split_suffix: null,
    reading_order: 0,
    ...overrides,
  };
}

describe("workbench drag-create PATCH /api/data/projects/{id}/pages/{idx0} (msw)", () => {
  it("sends the splits[] body when a split rectangle is committed", async () => {
    let seenBody: Record<string, unknown> | null = null;

    server.use(
      http.patch(
        "/api/data/projects/prj_abc123/pages/4",
        async ({ request }) => {
          seenBody = (await request.json()) as Record<string, unknown>;
          // Server echoes the resulting page record with the new split
          // appended — same shape `commitOverrides.onSuccess` re-reads.
          return HttpResponse.json(
            makePage({
              splits: [
                {
                  suffix: "a",
                  reading_order: 0,
                  L: 10,
                  R: 600,
                  T: 20,
                  B: 1700,
                  scale_to_standard_page: true,
                  alignment: null,
                  ocr_engine: null,
                },
              ] as unknown as PageRecord["splits"],
            }),
          );
        },
      ),
    );

    // Mirror what `handleAddSplit` builds in PageWorkbenchPage.tsx.
    const newSplit = {
      suffix: "a",
      reading_order: 0,
      L: 10,
      R: 600,
      T: 20,
      B: 1700,
      scale_to_standard_page: true,
      alignment: null,
      ocr_engine: null,
    };
    const result = await api.patch<PageRecord>(
      "/api/data/projects/prj_abc123/pages/4",
      { splits: [newSplit] },
    );

    expect(seenBody).not.toBeNull();
    // Body must be exactly `{ splits: [...] }` — no other fields touched
    // (commitOverrides only sends the patch keys it cares about). Narrow
    // through `unknown` because tsc can't see the runtime null-guard above
    // and `seenBody`'s static type still includes `null`.
    const body = seenBody as unknown as { splits: (typeof newSplit)[] };
    expect(Object.keys(body)).toEqual(["splits"]);
    expect(body.splits).toHaveLength(1);
    expect(body.splits[0]).toMatchObject({
      suffix: "a",
      reading_order: 0,
      L: 10,
      R: 600,
      T: 20,
      B: 1700,
    });
    expect(result.splits).toHaveLength(1);
  });

  it("sends the illustration_regions[] body when a region rectangle is committed", async () => {
    let seenBody: Record<string, unknown> | null = null;

    server.use(
      http.patch(
        "/api/data/projects/prj_abc123/pages/4",
        async ({ request }) => {
          seenBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(
            makePage({
              illustration_regions: [
                {
                  index: 1,
                  label: "",
                  type: "illustration",
                  L: 50,
                  R: 700,
                  T: 100,
                  B: 900,
                  output_format: "jpg",
                  jpeg_quality: 85,
                  convert_to_grayscale: false,
                },
              ] as unknown as PageRecord["illustration_regions"],
            }),
          );
        },
      ),
    );

    const region = {
      index: 1,
      label: "",
      type: "illustration" as const,
      L: 50,
      R: 700,
      T: 100,
      B: 900,
      output_format: "jpg" as const,
      jpeg_quality: 85,
      convert_to_grayscale: false,
    };
    const result = await api.patch<PageRecord>(
      "/api/data/projects/prj_abc123/pages/4",
      { illustration_regions: [region] },
    );

    expect(seenBody).not.toBeNull();
    // Same `unknown`-bridge as the splits case — runtime null-guard above
    // is invisible to tsc, so we narrow once and reuse the typed alias.
    const body = seenBody as unknown as { illustration_regions: unknown[] };
    expect(Object.keys(body)).toEqual(["illustration_regions"]);
    expect(body.illustration_regions).toHaveLength(1);
    expect(result.illustration_regions).toHaveLength(1);
  });

  it("surfaces 422 when the workbench commits an invalid split (e.g. R<=L)", async () => {
    server.use(
      http.patch("/api/data/projects/prj_abc123/pages/4", () =>
        HttpResponse.json(
          {
            detail: [
              {
                loc: ["body", "splits", 0, "R"],
                msg: "R must be greater than L",
                type: "value_error",
              },
            ],
          },
          { status: 422 },
        ),
      ),
    );

    await expect(
      api.patch<PageRecord>("/api/data/projects/prj_abc123/pages/4", {
        splits: [
          {
            suffix: "a",
            reading_order: 0,
            L: 600,
            R: 100, // invalid
            T: 20,
            B: 1700,
            scale_to_standard_page: true,
            alignment: null,
            ocr_engine: null,
          },
        ],
      }),
    ).rejects.toMatchObject({
      message: "HTTP 422",
      status: 422,
    });
  });
});
