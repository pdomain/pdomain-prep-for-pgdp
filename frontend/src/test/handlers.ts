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
import { http, HttpResponse } from "msw";
import type { RequestHandler } from "msw";

export const handlers: RequestHandler[] = [
  http.get("/api/jobs", () => HttpResponse.json([])),
];
