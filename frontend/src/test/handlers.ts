// Default msw handlers shared across the test suite.
//
// Empty by design for the toolchain bring-up tick: roadmap §9 step 1
// only wires the harness. Handlers for the three target flows
// (create-project, page-tagger bulk actions, workbench drag-create)
// land in subsequent ticks alongside the tests that need them. Tests
// that need request interception today should register their own
// handlers via `server.use(...)`.
//
// /api/jobs: Task #155 (s0-c) — useActiveJobs polls this endpoint every 5 s
// from the AppHeader header slot. The default handler returns an empty list
// so all tests render cleanly without noisy MSW "unhandled request" errors.
//
// R2 imagetools — stage detection/operation endpoints used by XState tool machines.
// These return sensible defaults so tests that mount tool components without
// injecting _testServices do not hit "unhandled request" MSW errors.
import { http, HttpResponse } from "msw";
import type { RequestHandler } from "msw";

export const handlers: RequestHandler[] = [
  http.get("/api/jobs", () => HttpResponse.json([])),

  // hifi-source: useSourcePages — pages list (empty default so SourceTool
  // exits the loading state and renders the Files tab content in tests
  // that do not need real page data).
  http.get("/api/data/projects/:projectId/pages", () =>
    HttpResponse.json({ pages: [], next_cursor: null }),
  ),

  // hifi-source-wire: ingest thumbnail (default 404 — thumbnail not yet generated).
  // Tests that need a real thumb override this handler with server.use().
  http.get("/api/data/projects/:projectId/pages/:idx0/thumbnail", () =>
    HttpResponse.json(
      { detail: "thumbnail not yet available" },
      { status: 404 },
    ),
  ),

  // hifi-source-wire: PATCH page (mark role / soft-exclude).
  // Default returns a minimal PageRecord with the patched fields.
  http.patch(
    "/api/data/projects/:projectId/pages/:idx0",
    async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({
        idx0: parseInt(String(params["idx0"]), 10),
        source_stem: `img${String(params["idx0"]).padStart(4, "0")}`,
        ignore: body["ignore"] === true,
        manual_ignore: body["ignore"] === true,
        page_type: body["page_type"] ?? "normal",
        thumbnail_key: null,
      });
    },
  ),

  // hifi-source-wire: POST insert page (default returns a single-page list).
  http.post(
    "/api/data/projects/:projectId/pages/insert",
    async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      const afterIdx0 = (body["after_idx0"] as number | undefined) ?? 0;
      return HttpResponse.json({
        inserted_page: {
          idx0: afterIdx0 + 1,
          source_stem: "inserted",
          ignore: false,
          page_type: "normal",
          thumbnail_key: null,
        },
        pages: [
          {
            idx0: afterIdx0 + 1,
            source_stem: "inserted",
            ignore: false,
            page_type: "normal",
            thumbnail_key: null,
          },
        ],
      });
    },
  ),

  // R2: grayscaleTool — detectProfile
  http.post(
    "/api/data/projects/:projectId/project-stages/grayscale/detect",
    () =>
      HttpResponse.json({
        mode: "perceptual",
        why: "test default: sampled 0 images — perceptual is safe default",
        backend: "cpu",
      }),
  ),

  // R2: regexPass — fetch rules
  http.get("/api/data/projects/:projectId/project-stages/regex/rules", () =>
    HttpResponse.json({
      rules: [],
      counts: { rules: 0, applied: 0, review: 0, pending: 0, matches: 0 },
      snapshotId: null,
    }),
  ),

  // R2: illustrationsTool — detect regions
  http.post(
    "/api/data/projects/:projectId/project-stages/illustrations/detect",
    () =>
      HttpResponse.json({
        items: [],
        counts: { detected: 0, extracted: 0, review: 0, flagged: 0 },
      }),
  ),
];
