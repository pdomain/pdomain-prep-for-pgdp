/**
 * W0.4 — multi-page shell runStage must not hard-code pages/0000.
 */
import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/server";
import { buildRealStageRunnerServices } from "./pipeline";

describe("runStage multi-page fan-out (W0.4)", () => {
  it("posts project-stages/{stage}/rerun with all page_ids, not pages/0000 only", async () => {
    const posts: { url: string; body: unknown }[] = [];
    const zeroOnlyPosts: string[] = [];

    server.use(
      http.get("/api/data/projects/proj1/pages", () =>
        HttpResponse.json({
          pages: [{ idx0: 0 }, { idx0: 1 }, { idx0: 2 }],
          next_cursor: null,
          total: 3,
        }),
      ),
      http.post(
        "/api/data/projects/proj1/project-stages/:stageId/rerun",
        async ({ request, params }) => {
          const body = await request.json();
          posts.push({ url: request.url, body });
          expect(params["stageId"]).toBe("crop");
          return HttpResponse.json({ rows: [] });
        },
      ),
      http.post(
        "/api/data/projects/proj1/pages/:idx0/stages/:stageId/run",
        ({ request }) => {
          zeroOnlyPosts.push(request.url);
          return HttpResponse.json({
            project_id: "proj1",
            page_id: "0000",
            stage_id: "crop",
            status: "clean",
          });
        },
      ),
    );

    const services = buildRealStageRunnerServices();
    const outcome = await services.runStage("proj1", "crop");

    expect(outcome).toEqual({ status: "running" });
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({ page_ids: ["0000", "0001", "0002"] });
    expect(zeroOnlyPosts).toHaveLength(0);
  });

  it("returns error when project has no pages", async () => {
    server.use(
      http.get("/api/data/projects/empty/pages", () =>
        HttpResponse.json({ pages: [], next_cursor: null, total: 0 }),
      ),
    );
    const services = buildRealStageRunnerServices();
    const outcome = await services.runStage("empty", "threshold");
    expect(outcome.status).toBe("error");
  });
});
