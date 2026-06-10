/**
 * railList invariant tests.
 *
 * Key invariants:
 * 1. Active/Archived filter (railTab) affects `visible`.
 * 2. Search debounce: SEARCH_INPUT enters debouncing; after 200ms visible updates.
 * 3. Sort order affects visible ordering.
 * 4. Row selection: SELECT emits onSelect callback.
 * 5. PROJECTS_CHANGED causes reload.
 * 6. selectIfSelectionHidden after filter change.
 */

import { describe, it, expect, vi } from "vitest";
import { createActor } from "xstate";
import {
  railListMachine,
  type RailListInput,
  type RailListServices,
} from "./railList";
import type { ProjectRecord } from "@/mocks/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(
  overrides: Partial<ProjectRecord> & { id: string; title: string },
): ProjectRecord {
  return {
    id: overrides.id,
    title: overrides.title,
    author: overrides.author ?? "Author",
    pages: overrides.pages ?? 100,
    totalStages: 23,
    currentStage: 0,
    status: overrides.status ?? "queued",
    archived: overrides.archived ?? false,
    updatedRel: "2 hours ago",
    updatedAbs: "2026-06-10T10:00:00Z",
    created: "2026-06-01",
    size: overrides.size ?? "10.0 MB",
    registry_version: 1,
  };
}

const ACTIVE_PROJECTS: ProjectRecord[] = [
  makeProject({ id: "p1", title: "Active Alpha", status: "running" }),
  makeProject({ id: "p2", title: "Active Beta", status: "queued" }),
  makeProject({ id: "p3", title: "Active Gamma", status: "ready" }),
];

const ARCHIVED_PROJECTS: ProjectRecord[] = [
  makeProject({ id: "p4", title: "Archived One", archived: true }),
  makeProject({ id: "p5", title: "Archived Two", archived: true }),
];

const ALL_PROJECTS = [...ACTIVE_PROJECTS, ...ARCHIVED_PROJECTS];

function makeServices(
  projects: ProjectRecord[] = ALL_PROJECTS,
  overrides: Partial<RailListServices> = {},
): RailListServices {
  return {
    fetchProjects: vi.fn().mockResolvedValue(projects),
    ...overrides,
  };
}

function makeInput(overrides: Partial<RailListInput> = {}): RailListInput {
  return {
    services: makeServices(),
    ...overrides,
  };
}

async function startLoadedActor(
  projects: ProjectRecord[] = ALL_PROJECTS,
  overrides: Partial<RailListInput> = {},
) {
  const actor = createActor(railListMachine, {
    input: {
      services: makeServices(projects),
      ...overrides,
    },
  });
  actor.start();
  // Wait for loading to complete
  await vi.waitFor(() => {
    expect(actor.getSnapshot().matches("ready")).toBe(true);
  });
  return actor;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

describe("railList — loading", () => {
  it("starts in loading state", () => {
    const actor = createActor(railListMachine, { input: makeInput() });
    actor.start();
    expect(actor.getSnapshot().value).toBe("loading");
    actor.stop();
  });

  it("transitions to ready.idle after successful fetch", async () => {
    const actor = await startLoadedActor();
    expect(actor.getSnapshot().matches({ ready: "idle" })).toBe(true);
    actor.stop();
  });

  it("transitions to error on fetch failure", async () => {
    const services: RailListServices = {
      fetchProjects: vi.fn().mockRejectedValue(new Error("network")),
    };
    const actor = createActor(railListMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    await vi.waitFor(() => {
      expect(actor.getSnapshot().value).toBe("error");
    });
    actor.stop();
  });

  it("RETRY from error re-enters loading", async () => {
    const services: RailListServices = {
      fetchProjects: vi.fn().mockRejectedValue(new Error("network")),
    };
    const actor = createActor(railListMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    await vi.waitFor(() => {
      expect(actor.getSnapshot().value).toBe("error");
    });
    actor.send({ type: "RETRY" });
    expect(actor.getSnapshot().value).toBe("loading");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Active / Archived filter (railTab)
// ---------------------------------------------------------------------------

describe("railList — Active/Archived filter", () => {
  it("default railTab=active shows only active projects", async () => {
    const actor = await startLoadedActor(ALL_PROJECTS);
    const snap = actor.getSnapshot();
    expect(snap.context.railTab).toBe("active");
    expect(snap.context.visible.every((p) => !p.archived)).toBe(true);
    expect(snap.context.visible).toHaveLength(ACTIVE_PROJECTS.length);
    actor.stop();
  });

  it("SET_RAIL_TAB to archived shows only archived projects", async () => {
    const actor = await startLoadedActor(ALL_PROJECTS);
    actor.send({ type: "SET_RAIL_TAB", tab: "archived" });
    const snap = actor.getSnapshot();
    expect(snap.context.railTab).toBe("archived");
    expect(snap.context.visible.every((p) => p.archived === true)).toBe(true);
    expect(snap.context.visible).toHaveLength(ARCHIVED_PROJECTS.length);
    actor.stop();
  });

  it("counts.active and counts.archived reflect full all list", async () => {
    const actor = await startLoadedActor(ALL_PROJECTS);
    const { counts } = actor.getSnapshot().context;
    expect(counts.active).toBe(ACTIVE_PROJECTS.length);
    expect(counts.archived).toBe(ARCHIVED_PROJECTS.length);
    actor.stop();
  });

  it("SET_RAIL_TAB to same tab is ignored", async () => {
    const actor = await startLoadedActor(ALL_PROJECTS);
    const snap1 = actor.getSnapshot();
    actor.send({ type: "SET_RAIL_TAB", tab: "active" }); // same as default
    const snap2 = actor.getSnapshot();
    // visible length should stay the same
    expect(snap2.context.visible).toHaveLength(snap1.context.visible.length);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Search / debouncing
// ---------------------------------------------------------------------------

describe("railList — search and debounce", () => {
  it("SEARCH_INPUT enters debouncing state", async () => {
    const actor = await startLoadedActor(ALL_PROJECTS);
    actor.send({ type: "SEARCH_INPUT", value: "Alpha" });
    expect(actor.getSnapshot().matches({ ready: "debouncing" })).toBe(true);
    actor.stop();
  });

  it("after debounce delay, visible is filtered by query", async () => {
    const actor = await startLoadedActor(ALL_PROJECTS);
    actor.send({ type: "SEARCH_INPUT", value: "Alpha" });
    // Wait for the 200ms debounce to fire
    await vi.waitFor(
      () => {
        expect(actor.getSnapshot().matches({ ready: "idle" })).toBe(true);
      },
      { timeout: 500 },
    );
    const visible = actor.getSnapshot().context.visible;
    expect(visible).toHaveLength(1);
    expect(visible[0]?.id).toBe("p1");
    actor.stop();
  });

  it("CLEAR_SEARCH from debouncing returns to idle with all active visible", async () => {
    const actor = await startLoadedActor(ALL_PROJECTS);
    actor.send({ type: "SEARCH_INPUT", value: "Alpha" });
    actor.send({ type: "CLEAR_SEARCH" });
    expect(actor.getSnapshot().matches({ ready: "idle" })).toBe(true);
    expect(actor.getSnapshot().context.query).toBe("");
    actor.stop();
  });

  it("multiple SEARCH_INPUT resets the debounce timer", async () => {
    const actor = await startLoadedActor(ALL_PROJECTS);
    actor.send({ type: "SEARCH_INPUT", value: "Al" });
    // Second keystroke before timer fires
    actor.send({ type: "SEARCH_INPUT", value: "Alpha" });
    await vi.waitFor(
      () => {
        expect(actor.getSnapshot().matches({ ready: "idle" })).toBe(true);
      },
      { timeout: 500 },
    );
    // Should have applied the last query
    expect(actor.getSnapshot().context.query).toBe("Alpha");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Sort order
// ---------------------------------------------------------------------------

describe("railList — sort order", () => {
  it("SET_SORT by title sorts visible alphabetically", async () => {
    const projects = [
      makeProject({ id: "p1", title: "Zebra" }),
      makeProject({ id: "p2", title: "Alpha" }),
      makeProject({ id: "p3", title: "Mango" }),
    ];
    const actor = await startLoadedActor(projects);
    actor.send({ type: "SET_SORT", sort: "title" });
    const visible = actor.getSnapshot().context.visible;
    expect(visible.map((p) => p.title)).toEqual(["Alpha", "Mango", "Zebra"]);
    actor.stop();
  });

  it("SET_SORT by pages sorts descending", async () => {
    const projects = [
      makeProject({ id: "p1", title: "Few Pages", pages: 50 }),
      makeProject({ id: "p2", title: "Many Pages", pages: 500 }),
      makeProject({ id: "p3", title: "Medium Pages", pages: 200 }),
    ];
    const actor = await startLoadedActor(projects);
    actor.send({ type: "SET_SORT", sort: "pages" });
    const visible = actor.getSnapshot().context.visible;
    expect(visible.map((p) => p.pages)).toEqual([500, 200, 50]);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Row selection — emits onSelect
// ---------------------------------------------------------------------------

describe("railList — row selection", () => {
  it("SELECT visible row updates selectedId", async () => {
    const actor = await startLoadedActor(ACTIVE_PROJECTS);
    actor.send({ type: "SELECT", id: "p2" });
    expect(actor.getSnapshot().context.selectedId).toBe("p2");
    actor.stop();
  });

  it("SELECT visible row calls onSelect callback", async () => {
    const onSelect = vi.fn();
    const actor = await startLoadedActor(ACTIVE_PROJECTS, { onSelect });
    actor.send({ type: "SELECT", id: "p2" });
    expect(onSelect).toHaveBeenCalledWith("p2");
    actor.stop();
  });

  it("SELECT non-visible row is ignored", async () => {
    const actor = await startLoadedActor(ACTIVE_PROJECTS);
    const prev = actor.getSnapshot().context.selectedId;
    actor.send({ type: "SELECT", id: "nonexistent" });
    expect(actor.getSnapshot().context.selectedId).toBe(prev);
    actor.stop();
  });

  it("autoSelectFirst picks first visible on load", async () => {
    const actor = await startLoadedActor(ACTIVE_PROJECTS);
    expect(actor.getSnapshot().context.selectedId).toBe("p1");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// selectIfSelectionHidden after filter
// ---------------------------------------------------------------------------

describe("railList — selection hidden after filter", () => {
  it("switches to archived: previously selected active project moves selection to first archived", async () => {
    const actor = await startLoadedActor(ALL_PROJECTS);
    // Select active project p2
    actor.send({ type: "SELECT", id: "p2" });
    expect(actor.getSnapshot().context.selectedId).toBe("p2");
    // Switch to archived tab — p2 is no longer visible
    actor.send({ type: "SET_RAIL_TAB", tab: "archived" });
    const selectedId = actor.getSnapshot().context.selectedId;
    // Should have moved to first archived
    expect(selectedId).toBe("p4");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// PROJECTS_CHANGED reload
// ---------------------------------------------------------------------------

describe("railList — PROJECTS_CHANGED", () => {
  it("PROJECTS_CHANGED from ready transitions back to loading", async () => {
    const actor = await startLoadedActor(ALL_PROJECTS);
    actor.send({ type: "PROJECTS_CHANGED" });
    expect(actor.getSnapshot().value).toBe("loading");
    actor.stop();
  });
});
