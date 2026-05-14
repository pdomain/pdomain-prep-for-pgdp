/**
 * api/client.ts integration tests for the page list + page-tag flows.
 *
 * Mirrors `client.test.ts` (the create-project flow) — wire-level only:
 * `api.get` / `api.patch` build a real Request, msw intercepts, the
 * handler's JSON response flows back through `request()` and parses
 * into typed values. We deliberately do **not** mount the page grid
 * component itself; that needs React Query + Router providers and
 * belongs to a later tick.
 *
 * Why these two endpoints together: page-listing and the per-page
 * `PATCH …/pages/{idx0}` page-type mutation are the actual "page
 * tagger" surface today (`ProjectReviewQueuePage` reads the list with
 * `?review_needed=true`; `ProjectConfigurePage`'s grid PATCHes
 * `page_type` per-page). The roadmap had pencilled in a
 * `POST …/pages/bulk-tag` for tick 10, but no such endpoint exists in
 * the backend — page tagging is per-page through PATCH. This test
 * locks the contract that does exist.
 */
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import type { components } from "./types.gen";

type ListPagesResponse = components["schemas"]["ListPagesResponse"];
type PageRecord = components["schemas"]["PageRecord"];
type UpdatePageRequest = components["schemas"]["UpdatePageRequest"];
import { api, setAuthToken } from "./client";
import { server } from "../test/server";

afterEach(() => {
  setAuthToken(null);
});

/** Minimal PageRecord builder. Keeps each test's intent visible by
 *  letting it override only the fields it cares about. */
function makePage(overrides: Partial<PageRecord> = {}): PageRecord {
  return {
    project_id: "prj_abc123",
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
    source_key: "projects/prj_abc123/source/scan_0001.png",
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

describe("api.get against /api/data/projects/{id}/pages (msw)", () => {
  it("forwards filter query params and parses ListPagesResponse", async () => {
    const seenUrls: string[] = [];

    server.use(
      http.get("/api/data/projects/prj_abc123/pages", ({ request }) => {
        seenUrls.push(request.url);
        const response: ListPagesResponse = {
          pages: [
            makePage({ idx0: 0, prefix: "f001" }),
            makePage({ idx0: 1, prefix: "f002", page_type: "blank" }),
            makePage({ idx0: 2, prefix: "p001", page_type: "plate_p" }),
          ],
          next_cursor: null,
          total: 3,
        };
        return HttpResponse.json(response);
      }),
    );

    const result = await api.get<ListPagesResponse>(
      "/api/data/projects/prj_abc123/pages",
      { query: { review_needed: true, limit: 500 } },
    );

    expect(seenUrls).toHaveLength(1);
    // `query` is encoded into the URL by `request()`.
    expect(seenUrls[0]).toContain("review_needed=true");
    expect(seenUrls[0]).toContain("limit=500");

    expect(result.total).toBe(3);
    expect(result.pages).toHaveLength(3);
    expect(result.pages[1].page_type).toBe("blank");
    expect(result.pages[2].page_type).toBe("plate_p");
    expect(result.next_cursor).toBeNull();
  });

  it("omits undefined / null query params from the URL", async () => {
    let seenUrl: string | null = null;
    server.use(
      http.get("/api/data/projects/prj_abc123/pages", ({ request }) => {
        seenUrl = request.url;
        return HttpResponse.json({
          pages: [],
          next_cursor: null,
          total: 0,
        } satisfies ListPagesResponse);
      }),
    );

    await api.get<ListPagesResponse>("/api/data/projects/prj_abc123/pages", {
      query: { limit: 50, page_type: undefined, cursor: null },
    });

    expect(seenUrl).not.toBeNull();
    expect(seenUrl as unknown as string).toContain("limit=50");
    expect(seenUrl as unknown as string).not.toContain("page_type");
    expect(seenUrl as unknown as string).not.toContain("cursor");
  });
});

describe("api.patch against /api/data/projects/{id}/pages/{idx0} (msw)", () => {
  it("sends the UpdatePageRequest body and returns the parsed PageRecord", async () => {
    const seenRequests: { body: unknown; contentType: string | null }[] = [];

    server.use(
      http.patch(
        "/api/data/projects/prj_abc123/pages/4",
        async ({ request }) => {
          seenRequests.push({
            body: await request.json(),
            contentType: request.headers.get("Content-Type"),
          });
          return HttpResponse.json(
            makePage({ idx0: 4, prefix: "f005", page_type: "blank" }),
          );
        },
      ),
    );

    const requestBody: UpdatePageRequest = { page_type: "blank" };
    const result = await api.patch<PageRecord>(
      "/api/data/projects/prj_abc123/pages/4",
      requestBody,
    );

    expect(seenRequests).toHaveLength(1);
    expect(seenRequests[0].contentType).toBe("application/json");
    expect(seenRequests[0].body).toEqual(requestBody);
    expect(result.idx0).toBe(4);
    expect(result.page_type).toBe("blank");
  });

  it("attaches the bearer token from localStorage when present", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.patch("/api/data/projects/prj_abc123/pages/0", ({ request }) => {
        seenAuth = request.headers.get("Authorization");
        return HttpResponse.json(makePage());
      }),
    );

    setAuthToken("page-tag-token");
    await api.patch<PageRecord>("/api/data/projects/prj_abc123/pages/0", {
      page_type: "normal",
    } satisfies UpdatePageRequest);

    expect(seenAuth).toBe("Bearer page-tag-token");
  });

  it("throws an Error with status + detail when the page is missing", async () => {
    server.use(
      http.patch("/api/data/projects/prj_abc123/pages/9999", () =>
        HttpResponse.json({ detail: "page not found" }, { status: 404 }),
      ),
    );

    await expect(
      api.patch<PageRecord>("/api/data/projects/prj_abc123/pages/9999", {
        page_type: "blank",
      } satisfies UpdatePageRequest),
    ).rejects.toMatchObject({
      message: "HTTP 404",
      status: 404,
      detail: { detail: "page not found" },
    });
  });

  it("surfaces 422 validation errors with the FastAPI detail array", async () => {
    server.use(
      http.patch("/api/data/projects/prj_abc123/pages/0", () =>
        HttpResponse.json(
          {
            detail: [
              {
                loc: ["body", "page_type"],
                msg: "value is not a valid enumeration member",
                type: "type_error.enum",
              },
            ],
          },
          { status: 422 },
        ),
      ),
    );

    await expect(
      api.patch<PageRecord>(
        "/api/data/projects/prj_abc123/pages/0",
        // Cast — we want msw to see a deliberately invalid payload so
        // the test mirrors what FastAPI would actually reject.
        { page_type: "not_a_real_type" } as unknown as UpdatePageRequest,
      ),
    ).rejects.toMatchObject({
      message: "HTTP 422",
      status: 422,
    });
  });
});
