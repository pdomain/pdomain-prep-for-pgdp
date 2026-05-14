/**
 * api/client.ts integration tests via msw.
 *
 * These exercise the *wire* — `api.post` building a real Request, msw
 * intercepting it inside jsdom, the handler's JSON response flowing back
 * through `request()` and JSON-parsing into typed values. Component-level
 * tests for `CreateProjectModal` itself can layer on top once the basics
 * are nailed down; the value of this test is that it locks the
 * create-project request/response contract end-to-end without dragging
 * in React Query / Router providers.
 */
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import type { components } from "./types.gen";

type CreateProjectRequest = components["schemas"]["CreateProjectRequest"];
type CreateProjectResponse = components["schemas"]["CreateProjectResponse"];
import { api, setAuthToken } from "./client";
import { server } from "../test/server";

// The api client reads `localStorage` for an auth token. Make sure no
// stray token leaks into msw assertions across tests.
afterEach(() => {
  setAuthToken(null);
});

describe("api.post against /api/data/projects (msw)", () => {
  it("sends the CreateProjectRequest body and returns the parsed CreateProjectResponse", async () => {
    const seenRequests: { body: unknown; contentType: string | null }[] = [];

    server.use(
      http.post("/api/data/projects", async ({ request }) => {
        seenRequests.push({
          body: await request.json(),
          contentType: request.headers.get("Content-Type"),
        });
        const response: CreateProjectResponse = {
          project: {
            id: "prj_abc123",
            owner_id: "user_local",
            name: "Belloc — The Four Men",
            created_at: "2026-05-06T00:00:00Z",
            updated_at: "2026-05-06T00:00:00Z",
            status: "ingesting",
            page_count: 0,
            proof_page_count: 0,
            storage_prefix: "projects/prj_abc123",
            archived: false,
            pipeline_state: { steps: {} },
            config: {
              book_name: "Belloc — The Four Men",
              source_uri: "uploads/prj_abc123/source.zip",
              proof_start_idx0: 0,
              proof_end_idx0: 0,
              cover_idx0: null,
              title_idx0: null,
              frontmatter_start_idx0: 0,
              frontmatter_end_idx0: 0,
              bodymatter_start_idx0: 0,
              bodymatter_end_idx0: 0,
              frontmatter_page_nbr_start: 1,
              bodymatter_page_nbr_start: 1,
              initial_crop_all: [0, 0, 0, 0],
              ocr_crop_top: 0,
              ocr_crop_bottom: 0,
              ocr_crop_left: 0,
              ocr_crop_right: 0,
              custom_regex_passes: [],
              custom_scannos: {},
              layout_category_overrides: {},
              optimize_png: true,
              default_overrides: {},
            },
          },
          upload_url: "/cdn/uploads/prj_abc123/source.zip",
          upload_key: "uploads/prj_abc123/source.zip",
        };
        return HttpResponse.json(response, { status: 201 });
      }),
    );

    const requestBody: CreateProjectRequest = {
      name: "Belloc — The Four Men",
      source_type: "zip",
    };
    const result = await api.post<CreateProjectResponse>(
      "/api/data/projects",
      requestBody,
    );

    expect(seenRequests).toHaveLength(1);
    expect(seenRequests[0].contentType).toBe("application/json");
    expect(seenRequests[0].body).toEqual(requestBody);

    expect(result.project.id).toBe("prj_abc123");
    expect(result.project.status).toBe("ingesting");
    expect(result.upload_url).toBe("/cdn/uploads/prj_abc123/source.zip");
    expect(result.upload_key).toBe("uploads/prj_abc123/source.zip");
  });

  it("attaches the bearer token from localStorage when present", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.post("/api/data/projects", ({ request }) => {
        seenAuth = request.headers.get("Authorization");
        return HttpResponse.json(
          {
            project: {
              id: "prj_xyz",
              owner_id: "user_local",
              name: "x",
              created_at: "2026-05-06T00:00:00Z",
              updated_at: "2026-05-06T00:00:00Z",
              status: "ingesting",
              page_count: 0,
              proof_page_count: 0,
              storage_prefix: "projects/prj_xyz",
              config: {
                book_name: "x",
                source_uri: "",
                proof_start_idx0: 0,
                proof_end_idx0: 0,
                cover_idx0: null,
                title_idx0: null,
                frontmatter_start_idx0: 0,
                frontmatter_end_idx0: 0,
                bodymatter_start_idx0: 0,
                bodymatter_end_idx0: 0,
                frontmatter_page_nbr_start: 1,
                bodymatter_page_nbr_start: 1,
                initial_crop_all: [0, 0, 0, 0],
                ocr_crop_top: 0,
                ocr_crop_bottom: 0,
                ocr_crop_left: 0,
                ocr_crop_right: 0,
                custom_regex_passes: [],
                custom_scannos: {},
                layout_category_overrides: {},
                optimize_png: true,
                default_overrides: {},
              },
            },
            upload_url: null,
            upload_key: null,
          },
          { status: 201 },
        );
      }),
    );

    setAuthToken("test-token-123");
    await api.post<CreateProjectResponse>("/api/data/projects", {
      name: "x",
      source_type: "zip",
    } satisfies CreateProjectRequest);

    expect(seenAuth).toBe("Bearer test-token-123");
  });

  it("throws an Error with status + detail when the server returns a JSON error", async () => {
    server.use(
      http.post("/api/data/projects", () =>
        HttpResponse.json({ detail: "name already taken" }, { status: 409 }),
      ),
    );

    await expect(
      api.post<CreateProjectResponse>("/api/data/projects", {
        name: "dupe",
        source_type: "zip",
      } satisfies CreateProjectRequest),
    ).rejects.toMatchObject({
      message: "HTTP 409",
      status: 409,
      detail: { detail: "name already taken" },
    });
  });
});
