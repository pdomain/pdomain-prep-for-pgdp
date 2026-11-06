/**
 * W0.5 — applySplit posts the SplitPageRequest body the API accepts.
 */
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/server";
import { buildRealTextZonesToolServices } from "./textZonesTool";

describe("applySplit request body (W0.5)", () => {
  it("posts suffixes, normalized bboxes, and split_at_stage", async () => {
    const posts: { url: string; body: unknown }[] = [];

    server.use(
      http.post(
        "/api/data/projects/proj1/pages/:idx0/split",
        async ({ request, params }) => {
          posts.push({ url: request.url, body: await request.json() });
          expect(params["idx0"]).toBe("1");
          return HttpResponse.json({
            children: [
              { idx0: 2, prefix: "p002", split_suffix: "a" },
              { idx0: 3, prefix: "p003", split_suffix: "b" },
            ],
          });
        },
      ),
    );

    const services = buildRealTextZonesToolServices();
    const result = await services.applySplit("proj1", "0001", {
      axis: "col",
      into: 2,
      gutter: 0.4,
      conf: 0.9,
    });

    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({
      suffixes: ["a", "b"],
      bboxes: [
        [0, 0, 0.4, 1],
        [0.4, 0, 0.6, 1],
      ],
      split_at_stage: "text_zones",
      normalized: true,
    });
    expect(result.parentRow.state).toBe("split");
    expect(result.childRows[0]?.idx).toBe("0002");
    expect(result.childRows[1]?.idx).toBe("0003");
    expect(result.childRows.map((row) => row.prefix)).toEqual(["p002", "p003"]);
  });
});
