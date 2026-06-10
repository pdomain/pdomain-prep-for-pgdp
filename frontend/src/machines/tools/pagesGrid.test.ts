/**
 * pagesGrid.test.ts — invariant tests for the pagesGrid machine.
 *
 * TDD invariants from tool-pages-grid.yaml:
 *
 * Suite 1 "load lifecycle" — loading → ready | loadError
 * Suite 2 "filter" — SET_FILTER updates visible
 * Suite 3 "editor open/close" — OPEN_EDITOR, CLOSE (clean / dirty paths)
 * Suite 4 "edit + save" — EDIT makes dirty, SAVE → saving → closed
 * Suite 5 "ACCEPT" — marks as clean without geometry edits
 * Suite 6 "confirm discard" — CLOSE/PREV/NEXT when dirty → confirmDiscard
 * Suite 7 "FLUSH_RESOLVED" — resolvedThisSession flushed to parent
 * Suite 8 "save error" — onError transitions back to editing
 */

import { describe, it, expect, vi } from "vitest";
import { createActor } from "xstate";
import {
  pagesGridMachine,
  type PagesGridInput,
  type PagesGridServices,
  type CropPageRow,
} from "./pagesGrid";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePage(overrides: Partial<CropPageRow> = {}): CropPageRow {
  return {
    pageId: "page-1",
    n: 1,
    thumbUrl: "/thumbs/page-1.jpg",
    flags: [],
    bbox: [10, 10, 90, 90],
    skewDeg: 0,
    ...overrides,
  };
}

function makeServices(
  overrides: Partial<PagesGridServices> = {},
): PagesGridServices {
  return {
    fetchPages: vi
      .fn()
      .mockResolvedValue([
        makePage({ pageId: "page-1", n: 1 }),
        makePage({ pageId: "page-2", n: 2, flags: ["skew"] }),
        makePage({ pageId: "page-3", n: 3 }),
      ]),
    savePage: vi
      .fn()
      .mockImplementation((_projectId, _stageId, draft: CropPageRow) =>
        Promise.resolve({ ...draft }),
      ),
    ...overrides,
  };
}

function makeInput(overrides: Partial<PagesGridInput> = {}): PagesGridInput {
  return {
    projectId: "proj-1",
    stageId: "crop",
    stageIndex: 2,
    services: makeServices(),
    ...overrides,
  };
}

async function waitForState(
  actor: ReturnType<typeof createActor<typeof pagesGridMachine>>,
  predicate: (snap: ReturnType<typeof actor.getSnapshot>) => boolean,
  maxMs = 500,
): Promise<ReturnType<typeof actor.getSnapshot>> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + maxMs;
    const check = () => {
      const snap = actor.getSnapshot();
      if (predicate(snap)) {
        resolve(snap);
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error("timeout"));
        return;
      }
      setTimeout(check, 10);
    };
    check();
  });
}

// ---------------------------------------------------------------------------
// Suite 1: load lifecycle
// ---------------------------------------------------------------------------

describe("pagesGrid — load lifecycle", () => {
  it("starts in loading and transitions to ready on fetchPages success", async () => {
    const actor = createActor(pagesGridMachine, { input: makeInput() });
    actor.start();
    expect(actor.getSnapshot().matches("loading")).toBe(true);

    const snap = await waitForState(actor, (s) => s.matches("ready"));
    expect(snap.context.pages).toHaveLength(3);
    expect(snap.context.visible).toHaveLength(3);
    actor.stop();
  });

  it("transitions to loadError when fetchPages rejects", async () => {
    const services = makeServices({
      fetchPages: vi.fn().mockRejectedValue(new Error("network")),
    });
    const actor = createActor(pagesGridMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    const snap = await waitForState(actor, (s) => s.matches("loadError"));
    expect(snap.context.error).toMatchObject({ message: "network" });
    actor.stop();
  });

  it("RETRY from loadError re-enters loading and clears error", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce([makePage({ pageId: "p1", n: 1 })]);
    const services = makeServices({ fetchPages: fetchFn });
    const actor = createActor(pagesGridMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("loadError"));
    actor.send({ type: "RETRY" });
    await waitForState(actor, (s) => s.matches("ready"));
    expect(actor.getSnapshot().context.error).toBeNull();
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 2: filter
// ---------------------------------------------------------------------------

describe("pagesGrid — filter", () => {
  it("SET_FILTER='flagged' shows only flagged pages", async () => {
    const actor = createActor(pagesGridMachine, { input: makeInput() });
    actor.start();
    await waitForState(actor, (s) => s.matches("ready"));

    actor.send({ type: "SET_FILTER", value: "flagged" });
    const snap = actor.getSnapshot();
    expect(snap.context.filter).toBe("flagged");
    expect(snap.context.visible.every((p) => p.flags.length > 0)).toBe(true);
    expect(snap.context.visible).toHaveLength(1); // only page-2 has flags
    actor.stop();
  });

  it("SET_FILTER='all' shows all pages", async () => {
    const actor = createActor(pagesGridMachine, { input: makeInput() });
    actor.start();
    await waitForState(actor, (s) => s.matches("ready"));
    actor.send({ type: "SET_FILTER", value: "flagged" });
    actor.send({ type: "SET_FILTER", value: "all" });
    expect(actor.getSnapshot().context.visible).toHaveLength(3);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 3: editor open/close (clean path)
// ---------------------------------------------------------------------------

describe("pagesGrid — editor open/close", () => {
  it("OPEN_EDITOR transitions editor to editing and sets draft", async () => {
    const actor = createActor(pagesGridMachine, { input: makeInput() });
    actor.start();
    await waitForState(actor, (s) => s.matches("ready"));

    actor.send({ type: "OPEN_EDITOR", pageId: "page-1" });
    const snap = actor.getSnapshot();
    expect(snap.matches({ ready: { editor: { editing: "clean" } } })).toBe(
      true,
    );
    expect(snap.context.selectedPageId).toBe("page-1");
    expect(snap.context.draft).toMatchObject({ pageId: "page-1" });
    actor.stop();
  });

  it("CLOSE from clean editing goes to closed without confirm", async () => {
    const actor = createActor(pagesGridMachine, { input: makeInput() });
    actor.start();
    await waitForState(actor, (s) => s.matches("ready"));
    actor.send({ type: "OPEN_EDITOR", pageId: "page-1" });

    actor.send({ type: "CLOSE" });
    const snap = actor.getSnapshot();
    expect(snap.matches({ ready: { editor: "closed" } })).toBe(true);
    expect(snap.context.draft).toBeNull();
    expect(snap.context.selectedPageId).toBeNull();
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 4: edit + save
// ---------------------------------------------------------------------------

describe("pagesGrid — edit and save", () => {
  it("EDIT transitions clean→dirty and patches the draft", async () => {
    const actor = createActor(pagesGridMachine, { input: makeInput() });
    actor.start();
    await waitForState(actor, (s) => s.matches("ready"));
    actor.send({ type: "OPEN_EDITOR", pageId: "page-1" });

    actor.send({ type: "EDIT", patch: { skewDeg: 3.5 } });
    const snap = actor.getSnapshot();
    expect(snap.matches({ ready: { editor: { editing: "dirty" } } })).toBe(
      true,
    );
    expect(snap.context.draft?.skewDeg).toBe(3.5);
    actor.stop();
  });

  it("SAVE from dirty goes to saving and then closed", async () => {
    const actor = createActor(pagesGridMachine, { input: makeInput() });
    actor.start();
    await waitForState(actor, (s) => s.matches("ready"));
    actor.send({ type: "OPEN_EDITOR", pageId: "page-1" });
    actor.send({ type: "EDIT", patch: { skewDeg: 3.5 } });
    actor.send({ type: "SAVE" });

    const snap = await waitForState(actor, (s) =>
      s.matches({ ready: { editor: "closed" } }),
    );
    expect(snap.context.draft).toBeNull();
    expect(snap.context.selectedPageId).toBeNull();
    actor.stop();
  });

  it("RESET from dirty reverts to clean and restores original draft", async () => {
    const actor = createActor(pagesGridMachine, { input: makeInput() });
    actor.start();
    await waitForState(actor, (s) => s.matches("ready"));
    actor.send({ type: "OPEN_EDITOR", pageId: "page-1" });
    actor.send({ type: "EDIT", patch: { skewDeg: 99 } });
    actor.send({ type: "RESET" });

    const snap = actor.getSnapshot();
    expect(snap.matches({ ready: { editor: { editing: "clean" } } })).toBe(
      true,
    );
    expect(snap.context.draft?.skewDeg).toBe(0); // reverted to original
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 5: ACCEPT
// ---------------------------------------------------------------------------

describe("pagesGrid — ACCEPT", () => {
  it("ACCEPT from clean editing saves with flags:[] and closes editor", async () => {
    const saveFn = vi
      .fn()
      .mockImplementation((_p, _s, draft: CropPageRow) =>
        Promise.resolve({ ...draft }),
      );
    const services = makeServices({ savePage: saveFn });
    const actor = createActor(pagesGridMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("ready"));

    actor.send({ type: "OPEN_EDITOR", pageId: "page-2" }); // page-2 has flags: ['skew']
    actor.send({ type: "ACCEPT" });

    await waitForState(actor, (s) =>
      s.matches({ ready: { editor: "closed" } }),
    );
    const draftSentToServer = saveFn.mock.calls[0]?.[2] as CropPageRow;
    expect(draftSentToServer.flags).toEqual([]);
    actor.stop();
  });

  it("ACCEPT records resolved if saved page has no flags", async () => {
    const actor = createActor(pagesGridMachine, { input: makeInput() });
    actor.start();
    await waitForState(actor, (s) => s.matches("ready"));
    actor.send({ type: "OPEN_EDITOR", pageId: "page-2" });
    actor.send({ type: "ACCEPT" });

    await waitForState(actor, (s) =>
      s.matches({ ready: { editor: "closed" } }),
    );
    expect(actor.getSnapshot().context.resolvedThisSession).toContain("page-2");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 6: confirm discard
// ---------------------------------------------------------------------------

describe("pagesGrid — confirm discard", () => {
  it("CLOSE when dirty transitions to confirmDiscard", async () => {
    const actor = createActor(pagesGridMachine, { input: makeInput() });
    actor.start();
    await waitForState(actor, (s) => s.matches("ready"));
    actor.send({ type: "OPEN_EDITOR", pageId: "page-1" });
    actor.send({ type: "EDIT", patch: { skewDeg: 5 } });
    actor.send({ type: "CLOSE" });

    expect(
      actor.getSnapshot().matches({ ready: { editor: "confirmDiscard" } }),
    ).toBe(true);
    actor.stop();
  });

  it("DISCARD from confirmDiscard closes editor and clears draft", async () => {
    const actor = createActor(pagesGridMachine, { input: makeInput() });
    actor.start();
    await waitForState(actor, (s) => s.matches("ready"));
    actor.send({ type: "OPEN_EDITOR", pageId: "page-1" });
    actor.send({ type: "EDIT", patch: { skewDeg: 5 } });
    actor.send({ type: "CLOSE" });
    actor.send({ type: "DISCARD" });

    const snap = actor.getSnapshot();
    expect(snap.matches({ ready: { editor: "closed" } })).toBe(true);
    expect(snap.context.draft).toBeNull();
    actor.stop();
  });

  it("KEEP from confirmDiscard returns to editing", async () => {
    const actor = createActor(pagesGridMachine, { input: makeInput() });
    actor.start();
    await waitForState(actor, (s) => s.matches("ready"));
    actor.send({ type: "OPEN_EDITOR", pageId: "page-1" });
    actor.send({ type: "EDIT", patch: { skewDeg: 5 } });
    actor.send({ type: "CLOSE" });
    actor.send({ type: "KEEP" });

    expect(actor.getSnapshot().matches({ ready: { editor: "editing" } })).toBe(
      true,
    );
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 7: FLUSH_RESOLVED
// ---------------------------------------------------------------------------

describe("pagesGrid — FLUSH_RESOLVED", () => {
  it("FLUSH_RESOLVED clears resolvedThisSession when it has entries", async () => {
    const actor = createActor(pagesGridMachine, { input: makeInput() });
    actor.start();
    await waitForState(actor, (s) => s.matches("ready"));
    // Accept page-2 to populate resolvedThisSession
    actor.send({ type: "OPEN_EDITOR", pageId: "page-2" });
    actor.send({ type: "ACCEPT" });
    await waitForState(actor, (s) =>
      s.matches({ ready: { editor: "closed" } }),
    );
    expect(actor.getSnapshot().context.resolvedThisSession).toHaveLength(1);

    actor.send({ type: "FLUSH_RESOLVED" });
    expect(actor.getSnapshot().context.resolvedThisSession).toHaveLength(0);
    actor.stop();
  });

  it("FLUSH_RESOLVED is ignored when resolvedThisSession is empty", async () => {
    const actor = createActor(pagesGridMachine, { input: makeInput() });
    actor.start();
    await waitForState(actor, (s) => s.matches("ready"));
    // No accepts — resolvedThisSession empty
    actor.send({ type: "FLUSH_RESOLVED" });
    expect(actor.getSnapshot().context.resolvedThisSession).toHaveLength(0);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 8: save error
// ---------------------------------------------------------------------------

describe("pagesGrid — save error", () => {
  it("save failure transitions back to editing with error set", async () => {
    const services = makeServices({
      savePage: vi.fn().mockRejectedValue(new Error("save failed")),
    });
    const actor = createActor(pagesGridMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("ready"));
    actor.send({ type: "OPEN_EDITOR", pageId: "page-1" });
    actor.send({ type: "EDIT", patch: { skewDeg: 2 } });
    actor.send({ type: "SAVE" });

    const snap = await waitForState(actor, (s) =>
      s.matches({ ready: { editor: "editing" } }),
    );
    expect(snap.context.error).toMatchObject({ message: "save failed" });
    actor.stop();
  });
});
