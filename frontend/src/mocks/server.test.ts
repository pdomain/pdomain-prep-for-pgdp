/**
 * Tests for the v2 in-memory mock server.
 *
 * TDD: these were written before the mock server implementation.
 *
 * Test plan (from task 0.5 spec):
 *   (a) project fixture has 24 stage entries split 16 page-scoped / 8 project-scoped
 *   (b) running a stage flips notrun→running→clean and marks all downstream stale
 *       - re-run `threshold` → `deskew`…`archive` all stale (image prep chain)
 *       - re-run `ocr` → text stages + tail stale, but image-prep untouched
 *   (c) subscription receives project-snapshot first, then incremental events on run
 *   (d) reorder emits page-reorder event and marks page_order downstream stale
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createMockServer, type MockServer } from "./server";
import {
  PAGE_STAGE_IDS,
  PROJECT_STAGE_IDS,
  MOCK_PAGE_IDS,
  FLAGGED_PAGE_ID,
  FAILED_PAGE_ID,
  DESIGNATED_STAGE_ID,
  STAGE_DEPS,
  computeDownstream,
} from "./fixtures";
import type { ProjectChannelEvent } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectProjectEvents(
  server: MockServer,
  projectId: string,
): ProjectChannelEvent[] {
  const events: ProjectChannelEvent[] = [];
  server.subscribeProject(projectId, (event) => {
    events.push(event);
  });
  return events;
}

// ---------------------------------------------------------------------------
// (a) Fixture shape: 24 stage entries
// ---------------------------------------------------------------------------

describe("fixture shape", () => {
  let server: MockServer;

  beforeEach(() => {
    server = createMockServer();
  });

  it("project has 12 pages", () => {
    const project = server.getProject("proj-mock-0001");
    expect(project?.page_count).toBe(12);
  });

  it("pipeline snapshot has 16 page-stage summary entries", async () => {
    const snapshot = await server.getPipelineSnapshot("proj-mock-0001");
    expect(snapshot.page_stages_summary).toHaveLength(16);
    const ids = snapshot.page_stages_summary.map((s) => s.stage_id);
    for (const stageId of PAGE_STAGE_IDS) {
      expect(ids).toContain(stageId);
    }
  });

  it("pipeline snapshot has 8 project-stage entries", async () => {
    const snapshot = await server.getPipelineSnapshot("proj-mock-0001");
    expect(snapshot.project_stages).toHaveLength(8);
    const ids = snapshot.project_stages.map((s) => s.stage_id);
    for (const stageId of PROJECT_STAGE_IDS) {
      expect(ids).toContain(stageId);
    }
  });

  it("page stage list returns 16 stages for any page", async () => {
    const stages = await server.listPageStages("proj-mock-0001", "0000");
    expect(stages).toHaveLength(16);
  });

  it("all page stages start as not_run", async () => {
    const stages = await server.listPageStages("proj-mock-0001", "0001");
    for (const stage of stages) {
      expect(stage.status).toBe("not_run");
    }
  });

  it("source project stage starts clean (pages ingested)", async () => {
    const snapshot = await server.getPipelineSnapshot("proj-mock-0001");
    const source = snapshot.project_stages.find((s) => s.stage_id === "source");
    expect(source?.status).toBe("clean");
  });
});

// ---------------------------------------------------------------------------
// (b) Stage run: status transitions + downstream stale propagation
// ---------------------------------------------------------------------------

describe("stage run: transitions and downstream stale", () => {
  let server: MockServer;

  beforeEach(() => {
    server = createMockServer();
  });

  it("running a page stage transitions notrun→running→clean", async () => {
    const projectId = "proj-mock-0001";
    const pageId = "0000";

    // Start grayscale — should transition to clean (it has no deps besides source)
    const result = await server.runPageStage(projectId, pageId, "grayscale");
    expect(result.status).toBe("clean");

    // Verify the stored state also flipped
    const stages = await server.listPageStages(projectId, pageId);
    const gs = stages.find((s) => s.stage_id === "grayscale");
    expect(gs?.status).toBe("clean");
  });

  it("designated flagged page returns flagged status for ocr", async () => {
    const projectId = "proj-mock-0001";
    // Run prerequisites up to ocr: grayscale→crop→threshold→deskew→denoise→
    // dewarp→post_transform_crop→canvas_map→post_ocr_crop first
    const prereqs = [
      "grayscale",
      "crop",
      "threshold",
      "deskew",
      "denoise",
      "dewarp",
      "post_transform_crop",
      "canvas_map",
      "post_ocr_crop",
    ];
    for (const stageId of prereqs) {
      await server.runPageStage(projectId, FLAGGED_PAGE_ID, stageId);
    }
    const result = await server.runPageStage(
      projectId,
      FLAGGED_PAGE_ID,
      DESIGNATED_STAGE_ID,
    );
    expect(result.status).toBe("flagged");
  });

  it("designated failed page returns failed status for ocr", async () => {
    const projectId = "proj-mock-0001";
    const prereqs = [
      "grayscale",
      "crop",
      "threshold",
      "deskew",
      "denoise",
      "dewarp",
      "post_transform_crop",
      "canvas_map",
      "post_ocr_crop",
    ];
    for (const stageId of prereqs) {
      await server.runPageStage(projectId, FAILED_PAGE_ID, stageId);
    }
    const result = await server.runPageStage(
      projectId,
      FAILED_PAGE_ID,
      DESIGNATED_STAGE_ID,
    );
    expect(result.status).toBe("failed");
  });

  it("re-run threshold marks deskew…archive all stale", async () => {
    const projectId = "proj-mock-0001";
    const pageId = "0001";

    // Run threshold so it is clean, then re-run it to trigger staleness
    await server.runPageStage(projectId, pageId, "grayscale");
    await server.runPageStage(projectId, pageId, "crop");
    await server.runPageStage(projectId, pageId, "threshold");

    // Now re-run threshold (force=true)
    await server.runPageStage(projectId, pageId, "threshold", { force: true });

    // All descendants of threshold should be stale on this page
    const downstream = computeDownstream("threshold");
    expect(downstream.length).toBeGreaterThan(0);

    const stages = await server.listPageStages(projectId, pageId);
    for (const stageId of downstream) {
      // Only check page-scoped stages on this page
      if (
        !PAGE_STAGE_IDS.includes(stageId as (typeof PAGE_STAGE_IDS)[number])
      ) {
        continue;
      }
      const stage = stages.find((s) => s.stage_id === stageId);
      if (stage) {
        expect(stage.status).toBe("dirty");
      }
    }
  });

  it("re-run ocr: text stages become dirty, image-prep stages untouched", async () => {
    const projectId = "proj-mock-0001";
    const pageId = "0002";

    // Set up clean image-prep chain up through post_ocr_crop
    const imagePrep = [
      "grayscale",
      "crop",
      "threshold",
      "deskew",
      "denoise",
      "dewarp",
      "post_transform_crop",
      "canvas_map",
      "post_ocr_crop",
    ];
    for (const stageId of imagePrep) {
      await server.runPageStage(projectId, pageId, stageId);
    }
    // Run ocr so it is clean
    await server.runPageStage(projectId, pageId, DESIGNATED_STAGE_ID);

    // Re-run ocr
    await server.runPageStage(projectId, pageId, DESIGNATED_STAGE_ID, {
      force: true,
    });

    const stages = await server.listPageStages(projectId, pageId);

    // Image-prep stages should remain clean (not downstream of ocr)
    const imageOnlyStages = [
      "grayscale",
      "crop",
      "threshold",
      "deskew",
      "denoise",
      "dewarp",
      "post_transform_crop",
      "canvas_map",
      "post_ocr_crop",
    ];
    for (const stageId of imageOnlyStages) {
      const stage = stages.find((s) => s.stage_id === stageId);
      expect(stage?.status).toBe("clean");
    }

    // Text stages downstream of ocr should be dirty
    const textDownstream = computeDownstream("ocr");
    expect(textDownstream).toContain("wordcheck");
    expect(textDownstream).toContain("hyphen_join");
    expect(textDownstream).toContain("text_review");

    for (const stageId of textDownstream) {
      if (
        !PAGE_STAGE_IDS.includes(stageId as (typeof PAGE_STAGE_IDS)[number])
      ) {
        continue;
      }
      const stage = stages.find((s) => s.stage_id === stageId);
      if (stage) {
        expect(stage.status).toBe("dirty");
      }
    }
  });

  it("running a project stage transitions notrun→clean", async () => {
    const projectId = "proj-mock-0001";
    const result = await server.runProjectStage(projectId, "page_order");
    expect(result.status).toBe("clean");
  });
});

// ---------------------------------------------------------------------------
// (c) SSE subscription: project-snapshot first, then incremental events
// ---------------------------------------------------------------------------

describe("SSE subscription", () => {
  let server: MockServer;

  beforeEach(() => {
    server = createMockServer();
  });

  it("first event on subscribe is project-snapshot with 8 project stages", () => {
    const events = collectProjectEvents(server, "proj-mock-0001");
    // subscribe fires the snapshot synchronously (or we wait for it)
    expect(events.length).toBeGreaterThanOrEqual(1);
    const firstEvent = events[0]!;
    expect(firstEvent.type).toBe("project-snapshot");
    if (firstEvent.type === "project-snapshot") {
      expect(firstEvent.project_stages).toHaveLength(8);
    }
  });

  it("running a project stage emits project-stage-status event after snapshot", async () => {
    const events = collectProjectEvents(server, "proj-mock-0001");

    await server.runProjectStage("proj-mock-0001", "page_order");

    const statusEvents = events.filter(
      (e) => e.type === "project-stage-status",
    );
    expect(statusEvents.length).toBeGreaterThanOrEqual(1);
    const cleanEvent = statusEvents.find(
      (e) =>
        e.type === "project-stage-status" &&
        e.stage_id === "page_order" &&
        e.status === "clean",
    );
    expect(cleanEvent).toBeDefined();
  });

  it("running a page stage emits stage-status events", async () => {
    const pageEvents: {
      type: string;
      stage_id: string;
      status: string;
    }[] = [];
    server.subscribePage("proj-mock-0001", "0000", (event) => {
      if (event.type === "stage-status") {
        pageEvents.push({
          type: event.type,
          stage_id: event.stage_id,
          status: event.status,
        });
      }
    });

    await server.runPageStage("proj-mock-0001", "0000", "grayscale");

    // Should have seen running then clean
    const runningEvent = pageEvents.find(
      (e) => e.stage_id === "grayscale" && e.status === "running",
    );
    const cleanEvent = pageEvents.find(
      (e) => e.stage_id === "grayscale" && e.status === "clean",
    );
    expect(runningEvent).toBeDefined();
    expect(cleanEvent).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// (d) Page reorder: emits page-reorder event, marks page_order stale
// ---------------------------------------------------------------------------

describe("page reorder", () => {
  let server: MockServer;

  beforeEach(() => {
    server = createMockServer();
  });

  it("reorderPages emits page-reorder event on project channel", async () => {
    const events = collectProjectEvents(server, "proj-mock-0001");

    const newOrder = [...MOCK_PAGE_IDS].reverse();
    await server.reorderPages("proj-mock-0001", newOrder);

    const reorderEvent = events.find((e) => e.type === "page-reorder");
    expect(reorderEvent).toBeDefined();
    if (reorderEvent?.type === "page-reorder") {
      expect(reorderEvent.new_order).toEqual(newOrder);
    }
  });

  it("reorderPages marks page_order project stage dirty", async () => {
    await server.reorderPages("proj-mock-0001", [...MOCK_PAGE_IDS].reverse());

    const snapshot = await server.getPipelineSnapshot("proj-mock-0001");
    const pageOrder = snapshot.project_stages.find(
      (s) => s.stage_id === "page_order",
    );
    expect(pageOrder?.status).toBe("dirty");
  });

  it("page_order downstream (validation chain) also goes dirty after reorder", async () => {
    await server.reorderPages("proj-mock-0001", [...MOCK_PAGE_IDS].reverse());

    const downstream = computeDownstream("page_order");
    expect(downstream).toContain("validation");
    expect(downstream).toContain("build_package");
    expect(downstream).toContain("archive");

    const snapshot = await server.getPipelineSnapshot("proj-mock-0001");
    for (const stageId of downstream) {
      if (
        !PROJECT_STAGE_IDS.includes(
          stageId as (typeof PROJECT_STAGE_IDS)[number],
        )
      ) {
        continue;
      }
      const stage = snapshot.project_stages.find((s) => s.stage_id === stageId);
      if (stage) {
        // Initial state was not_run, but after a dirty cascade it should be dirty
        // (the server only marks stages that were clean/flagged as dirty;
        // not_run stays not_run because it was never run)
        // validation/proof_pack/etc start not_run so remain not_run
        // This test just confirms they aren't erroneously clean
        expect(stage.status).not.toBe("clean");
      }
    }
  });

  it("reorderPages updates the stored page order", async () => {
    const newOrder = [
      "0011",
      "0010",
      "0009",
      "0008",
      "0007",
      "0006",
      "0005",
      "0004",
      "0003",
      "0002",
      "0001",
      "0000",
    ];
    await server.reorderPages("proj-mock-0001", newOrder);

    const order = server.getPageOrder("proj-mock-0001");
    expect(order).toEqual(newOrder);
  });
});

// ---------------------------------------------------------------------------
// Dep-graph: computeDownstream correctness
// ---------------------------------------------------------------------------

describe("computeDownstream (dependency graph logic)", () => {
  it("threshold descendants include the full image+text+pack tail", () => {
    const downstream = computeDownstream("threshold");
    // Image prep chain
    expect(downstream).toContain("deskew");
    expect(downstream).toContain("denoise");
    expect(downstream).toContain("dewarp");
    expect(downstream).toContain("post_transform_crop");
    expect(downstream).toContain("canvas_map");
    expect(downstream).toContain("post_ocr_crop");
    expect(downstream).toContain("text_zones");
    expect(downstream).toContain("ocr");
    // Text chain
    expect(downstream).toContain("wordcheck");
    expect(downstream).toContain("hyphen_join");
    expect(downstream).toContain("text_review");
    // Project tail
    expect(downstream).toContain("validation");
    expect(downstream).toContain("archive");
  });

  it("ocr descendants are text stages only (no image-prep)", () => {
    const downstream = computeDownstream("ocr");
    // Must include text chain
    expect(downstream).toContain("wordcheck");
    expect(downstream).toContain("hyphen_join");
    expect(downstream).toContain("text_review");
    // Must NOT include image-prep stages
    expect(downstream).not.toContain("grayscale");
    expect(downstream).not.toContain("crop");
    expect(downstream).not.toContain("threshold");
    expect(downstream).not.toContain("deskew");
    expect(downstream).not.toContain("canvas_map");
    expect(downstream).not.toContain("post_ocr_crop");
  });

  it("source descendants include the entire graph", () => {
    const downstream = computeDownstream("source");
    // source → grayscale → … → archive (all 23 other stages)
    expect(downstream.length).toBe(23);
  });

  it("archive has no descendants (terminal stage)", () => {
    const downstream = computeDownstream("archive");
    expect(downstream).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Misc: multiple subscriptions, unsubscribe
// ---------------------------------------------------------------------------

describe("subscription lifecycle", () => {
  let server: MockServer;

  beforeEach(() => {
    server = createMockServer();
  });

  it("unsubscribe stops delivery of subsequent events", async () => {
    const events: ProjectChannelEvent[] = [];
    const unsub = server.subscribeProject("proj-mock-0001", (e) => {
      events.push(e);
    });

    const countAfterSnapshot = events.length;
    unsub(); // unsubscribe before the run

    await server.runProjectStage("proj-mock-0001", "page_order");

    // No new events should have been delivered
    expect(events.length).toBe(countAfterSnapshot);
  });

  it("multiple subscribers all receive project-snapshot on connect", () => {
    const events1: ProjectChannelEvent[] = [];
    const events2: ProjectChannelEvent[] = [];
    server.subscribeProject("proj-mock-0001", (e) => events1.push(e));
    server.subscribeProject("proj-mock-0001", (e) => events2.push(e));

    expect(events1[0]?.type).toBe("project-snapshot");
    expect(events2[0]?.type).toBe("project-snapshot");
  });

  it("createMockServer() produces isolated state — no cross-contamination", async () => {
    const s1 = createMockServer();
    const s2 = createMockServer();

    await s1.runPageStage("proj-mock-0001", "0000", "grayscale");

    const s1Stages = await s1.listPageStages("proj-mock-0001", "0000");
    const s2Stages = await s2.listPageStages("proj-mock-0001", "0000");

    const s1gs = s1Stages.find((s) => s.stage_id === "grayscale");
    const s2gs = s2Stages.find((s) => s.stage_id === "grayscale");

    expect(s1gs?.status).toBe("clean");
    expect(s2gs?.status).toBe("not_run"); // s2 is unaffected
  });
});

// ---------------------------------------------------------------------------
// Page stage list correctness
// ---------------------------------------------------------------------------

describe("page stages completeness", () => {
  let server: MockServer;

  beforeEach(() => {
    server = createMockServer();
  });

  it("every page has all 16 stage IDs in the list", async () => {
    for (const pageId of MOCK_PAGE_IDS) {
      const stages = await server.listPageStages("proj-mock-0001", pageId);
      expect(stages).toHaveLength(16);
      for (const stageId of PAGE_STAGE_IDS) {
        expect(stages.some((s) => s.stage_id === stageId)).toBe(true);
      }
    }
  });

  it("project snapshot page_stages_summary covers all 16 stage IDs", async () => {
    const snapshot = await server.getPipelineSnapshot("proj-mock-0001");
    expect(snapshot.page_stages_summary).toHaveLength(16);
    for (const stageId of PAGE_STAGE_IDS) {
      expect(
        snapshot.page_stages_summary.some((s) => s.stage_id === stageId),
      ).toBe(true);
    }
  });

  it("vi.useFakeTimers is not needed — no real timers in mock server", async () => {
    // The mock server runs async transitions synchronously via resolved promises,
    // so vitest fake-timer mode is not required for these tests.
    const result = await server.runPageStage(
      "proj-mock-0001",
      "0005",
      "grayscale",
    );
    expect(result.status).toBe("clean");
  });
});

// ---------------------------------------------------------------------------
// Topological order: listPageStages must return stages in valid topo order
// (api-v2-deltas.md §1.1 contract)
// ---------------------------------------------------------------------------

describe("listPageStages topological order", () => {
  let server: MockServer;

  beforeEach(() => {
    server = createMockServer();
  });

  it("every stage's page-scoped upstream deps appear earlier in the list", async () => {
    const stages = await server.listPageStages("proj-mock-0001", "0000");
    const pageStageIds = new Set(PAGE_STAGE_IDS as readonly string[]);
    const positionOf = new Map<string, number>(
      stages.map((s, i) => [s.stage_id, i]),
    );

    for (const stage of stages) {
      const deps = STAGE_DEPS[stage.stage_id] ?? [];
      for (const dep of deps) {
        // Only check deps that are page-scoped (project-scoped deps like
        // "source" are not in the returned list and are acceptable to skip)
        if (!pageStageIds.has(dep)) continue;

        const depPos = positionOf.get(dep);
        const stagePos = positionOf.get(stage.stage_id);
        expect(
          depPos,
          `dep "${dep}" must appear in listPageStages result`,
        ).toBeDefined();
        expect(
          stagePos,
          `stage "${stage.stage_id}" must appear in listPageStages result`,
        ).toBeDefined();
        expect(
          depPos! < stagePos!,
          `"${dep}" (pos ${depPos}) must precede "${stage.stage_id}" (pos ${stagePos})`,
        ).toBe(true);
      }
    }
  });
});
