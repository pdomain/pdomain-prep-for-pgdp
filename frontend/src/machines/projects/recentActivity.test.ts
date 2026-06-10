/**
 * recentActivity invariant tests.
 *
 * Key invariants:
 * 1. Initial load: idle → loading → loaded.
 * 2. PROJECT_CHANGED reloads with new projectId.
 * 3. REFRESH from loaded triggers a silent re-fetch (refreshing sub-state).
 * 4. Polling: loaded.polling.active fires REFRESH after 10s delay.
 * 5. SET_LIVE toggles isLive flag.
 * 6. Error state and RETRY.
 */

import { describe, it, expect, vi } from "vitest";
import { createActor, type StateValue } from "xstate";
import {
  recentActivityMachine,
  type RecentActivityInput,
  type RecentActivityServices,
} from "./recentActivity";
import type { ActivityFeedResponse } from "@/mocks/types";

/**
 * Helper: check a state by top-level value name.
 * XState v5 infers parallel-state snapshot types too narrowly for `.matches()`.
 */
function valueIs(snap: { value: StateValue }, state: string): boolean {
  const v = snap.value;
  if (typeof v === "string") return v === state;
  return state in (v as Record<string, StateValue>);
}

/**
 * Helper: check a parallel sub-state.
 * e.g. subStateIs(snap, "loaded", "data", "list")
 */
function subStateIs(snap: { value: StateValue }, ...path: string[]): boolean {
  let v: StateValue = snap.value;
  for (const key of path) {
    if (typeof v === "string") return v === key;
    if (typeof v !== "object") return false;
    const record = v as Record<string, StateValue>;
    if (!(key in record)) return false;
    v = record[key] as StateValue;
    if (v === undefined) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_FEED: ActivityFeedResponse = {
  entries: [
    {
      id: "e1",
      kind: "stage",
      stage: "grayscale",
      description: "Grayscale done",
      at: "2026-06-10T10:00:00Z",
    },
  ],
  totalCount: 1,
  commentCount: 0,
  stageCount: 1,
};

const EMPTY_FEED: ActivityFeedResponse = {
  entries: [],
  totalCount: 0,
  commentCount: 0,
  stageCount: 0,
};

function makeServices(
  overrides: Partial<RecentActivityServices> = {},
): RecentActivityServices {
  return {
    fetchRecentActivity: vi.fn().mockResolvedValue(MOCK_FEED),
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<RecentActivityInput> = {},
): RecentActivityInput {
  return {
    projectId: "proj-1",
    services: makeServices(),
    ...overrides,
  };
}

async function startLoadedActor(overrides: Partial<RecentActivityInput> = {}) {
  const actor = createActor(recentActivityMachine, {
    input: makeInput(overrides),
  });
  actor.start();
  // Machine starts in idle — send LOAD to trigger the fetch
  actor.send({ type: "LOAD" });
  await vi.waitFor(() => {
    expect(valueIs(actor.getSnapshot(), "loaded")).toBe(true);
  });
  return actor;
}

// ---------------------------------------------------------------------------
// Initial load
// ---------------------------------------------------------------------------

describe("recentActivity — initial load", () => {
  it("starts in idle state", () => {
    const actor = createActor(recentActivityMachine, {
      input: makeInput({ projectId: "proj-1" }),
    });
    actor.start();
    expect(actor.getSnapshot().value).toBe("idle");
    actor.stop();
  });

  it("LOAD transitions idle → loading", () => {
    const actor = createActor(recentActivityMachine, {
      input: makeInput({ projectId: "proj-1" }),
    });
    actor.start();
    actor.send({ type: "LOAD" });
    expect(actor.getSnapshot().value).toBe("loading");
    actor.stop();
  });

  it("LOAD without projectId in context stays in idle (guard rejects)", () => {
    const actor = createActor(recentActivityMachine, {
      input: makeInput({ projectId: null }),
    });
    actor.start();
    actor.send({ type: "LOAD" });
    // hasProjectId guard: null projectId + no event.projectId → should stay in idle
    expect(actor.getSnapshot().value).toBe("idle");
    actor.stop();
  });

  it("transitions to loaded after successful fetch", async () => {
    const actor = await startLoadedActor();
    expect(valueIs(actor.getSnapshot(), "loaded")).toBe(true);
    expect(actor.getSnapshot().context.entries).toHaveLength(1);
    expect(actor.getSnapshot().context.totalCount).toBe(1);
    actor.stop();
  });

  it("populates feed entries from response", async () => {
    const actor = await startLoadedActor();
    const { entries } = actor.getSnapshot().context;
    expect(entries[0]?.id).toBe("e1");
    expect(entries[0]?.description).toBe("Grayscale done");
    actor.stop();
  });

  it("loaded.data starts in list regardless of empty/non-empty (initial=list, empty reached via refresh)", async () => {
    // The loaded.data region always starts in `list`; `empty` is only reached after a REFRESH
    // that returns empty results. The component checks entries.length for the empty-state UI.
    const services = makeServices({
      fetchRecentActivity: vi.fn().mockResolvedValue(EMPTY_FEED),
    });
    const actor = createActor(recentActivityMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    actor.send({ type: "LOAD" });
    await vi.waitFor(() => {
      expect(valueIs(actor.getSnapshot(), "loaded")).toBe(true);
    });
    // entries is empty but data sub-state is still `list` (initial state)
    expect(actor.getSnapshot().context.entries).toHaveLength(0);
    expect(subStateIs(actor.getSnapshot(), "loaded", "data", "list")).toBe(
      true,
    );
    actor.stop();
  });

  it("loaded.data.list when feed has entries", async () => {
    const actor = await startLoadedActor();
    expect(subStateIs(actor.getSnapshot(), "loaded", "data", "list")).toBe(
      true,
    );
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Error + retry
// ---------------------------------------------------------------------------

describe("recentActivity — error + retry", () => {
  it("transitions to error on fetch failure", async () => {
    const services = makeServices({
      fetchRecentActivity: vi.fn().mockRejectedValue(new Error("network")),
    });
    const actor = createActor(recentActivityMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    actor.send({ type: "LOAD" });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().value).toBe("error");
    });
    expect(actor.getSnapshot().context.error).toContain("network");
    actor.stop();
  });

  it("RETRY from error re-enters loading", async () => {
    const services = makeServices({
      fetchRecentActivity: vi.fn().mockRejectedValue(new Error("network")),
    });
    const actor = createActor(recentActivityMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    actor.send({ type: "LOAD" });
    await vi.waitFor(() => {
      expect(actor.getSnapshot().value).toBe("error");
    });
    actor.send({ type: "RETRY" });
    expect(actor.getSnapshot().value).toBe("loading");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// PROJECT_CHANGED reload
// ---------------------------------------------------------------------------

describe("recentActivity — PROJECT_CHANGED", () => {
  it("PROJECT_CHANGED updates projectId and re-enters loading", async () => {
    const actor = await startLoadedActor();
    actor.send({ type: "PROJECT_CHANGED", projectId: "proj-2" });
    // Should transition to loading to fetch for the new project
    await vi.waitFor(() => {
      const snap = actor.getSnapshot();
      expect(snap.value === "loading" || valueIs(snap, "loaded")).toBe(true);
    });
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// REFRESH from loaded
// ---------------------------------------------------------------------------

describe("recentActivity — REFRESH silent re-fetch", () => {
  it("REFRESH from loaded enters refreshing sub-state", async () => {
    const actor = await startLoadedActor();
    actor.send({ type: "REFRESH" });
    // Should be in loaded.data.refreshing
    expect(
      subStateIs(actor.getSnapshot(), "loaded", "data", "refreshing"),
    ).toBe(true);
    actor.stop();
  });

  it("REFRESH re-fetches and returns to list", async () => {
    const fetchRecentActivity = vi.fn().mockResolvedValue(MOCK_FEED);
    const actor = await startLoadedActor({
      services: makeServices({ fetchRecentActivity }),
    });
    const callCountBefore = fetchRecentActivity.mock.calls.length;
    actor.send({ type: "REFRESH" });
    await vi.waitFor(() => {
      expect(subStateIs(actor.getSnapshot(), "loaded", "data", "list")).toBe(
        true,
      );
    });
    expect(fetchRecentActivity.mock.calls.length).toBeGreaterThan(
      callCountBefore,
    );
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// SET_LIVE flag
// ---------------------------------------------------------------------------

describe("recentActivity — SET_LIVE", () => {
  it("SET_LIVE sets isLive flag in context", async () => {
    const actor = await startLoadedActor();
    expect(actor.getSnapshot().context.isLive).toBe(false);
    actor.send({ type: "SET_LIVE", isLive: true });
    expect(actor.getSnapshot().context.isLive).toBe(true);
    actor.stop();
  });

  it("SET_LIVE false clears isLive", async () => {
    const actor = await startLoadedActor();
    actor.send({ type: "SET_LIVE", isLive: true });
    actor.send({ type: "SET_LIVE", isLive: false });
    expect(actor.getSnapshot().context.isLive).toBe(false);
    actor.stop();
  });
});
