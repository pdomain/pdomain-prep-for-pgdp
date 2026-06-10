/**
 * illustrationsTool.test.ts — invariant tests for the illustrationsTool machine.
 *
 * TDD invariants from tool-illustrations.yaml:
 *
 * Suite 1 "detect lifecycle" — detecting → reviewing (needsALook) or extracted
 * Suite 2 "reviewing: confirm / drop / adjust" — CONFIRM_REGION, DROP_REGION
 * Suite 3 "settleIfClear" — auto-transition from reviewing to extracted
 * Suite 4 "gallery filter" — SET_GALLERY_FILTER
 * Suite 5 "REDETECT" — resets to detecting from reviewing or extracted
 * Suite 6 "UPSTREAM_CHANGED" — resets to detecting from extracted
 * Suite 7 "failed path" — detectRegions rejects → failed → RETRY
 */

import { describe, it, expect, vi } from "vitest";
import { createActor } from "xstate";
import {
  illustrationsToolMachine,
  type IllustrationsToolInput,
  type IllustrationsToolServices,
  type IllustrationRegion,
  type IllustrationCounts,
} from "./illustrationsTool";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRegion(
  overrides: Partial<IllustrationRegion> = {},
): IllustrationRegion {
  return {
    id: "r1",
    page: "p001",
    kind: "plate",
    w: 800,
    h: 600,
    status: "review",
    note: "",
    ...overrides,
  };
}

function makeCounts(
  overrides: Partial<IllustrationCounts> = {},
): IllustrationCounts {
  return {
    detected: 2,
    extracted: 0,
    review: 2,
    flagged: 0,
    ...overrides,
  };
}

function makeServices(
  overrides: Partial<IllustrationsToolServices> = {},
): IllustrationsToolServices {
  return {
    detectRegions: vi.fn().mockResolvedValue({
      items: [
        makeRegion({ id: "r1", status: "review" }),
        makeRegion({ id: "r2", status: "review" }),
      ],
      counts: makeCounts(),
    }),
    persistRegion: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<IllustrationsToolInput> = {},
): IllustrationsToolInput {
  return {
    projectId: "proj-1",
    stageIndex: 11,
    services: makeServices(),
    ...overrides,
  };
}

async function waitForState(
  actor: ReturnType<typeof createActor<typeof illustrationsToolMachine>>,
  predicate: (snapshot: ReturnType<typeof actor.getSnapshot>) => boolean,
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
        reject(
          new Error(
            `timeout waiting for state — current: ${JSON.stringify(snap.value)}`,
          ),
        );
        return;
      }
      setTimeout(check, 10);
    };
    check();
  });
}

// ---------------------------------------------------------------------------
// Suite 1: detect lifecycle
// ---------------------------------------------------------------------------

describe("illustrationsTool — detect lifecycle", () => {
  it("starts in detecting", () => {
    const actor = createActor(illustrationsToolMachine, {
      input: makeInput(),
    });
    actor.start();
    expect(actor.getSnapshot().matches("detecting")).toBe(true);
    actor.stop();
  });

  it("transitions to reviewing when needsALook (review > 0)", async () => {
    const actor = createActor(illustrationsToolMachine, {
      input: makeInput(),
    });
    actor.start();
    const snap = await waitForState(actor, (s) => s.matches("reviewing"));
    expect(snap.context.items).toHaveLength(2);
    expect(snap.context.counts?.review).toBe(2);
    actor.stop();
  });

  it("transitions to extracted when all items are extracted", async () => {
    const services = makeServices({
      detectRegions: vi.fn().mockResolvedValue({
        items: [makeRegion({ status: "extracted" })],
        counts: makeCounts({
          detected: 1,
          extracted: 1,
          review: 0,
          flagged: 0,
        }),
      }),
    });
    const actor = createActor(illustrationsToolMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    const snap = await waitForState(actor, (s) => s.matches("extracted"));
    expect(snap.context.counts?.extracted).toBe(1);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 2: reviewing — confirm / drop
// ---------------------------------------------------------------------------

describe("illustrationsTool — reviewing mutations", () => {
  async function enterReviewing(services?: IllustrationsToolServices) {
    const svc = services ?? makeServices();
    const actor = createActor(illustrationsToolMachine, {
      input: makeInput({ services: svc }),
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("reviewing"));
    return actor;
  }

  it("CONFIRM_REGION marks region extracted and recounts", async () => {
    const services = makeServices();
    const actor = await enterReviewing(services);
    actor.send({ type: "CONFIRM_REGION", regionId: "r1" });
    const snap = actor.getSnapshot();
    const r1 = snap.context.items.find((i) => i.id === "r1");
    expect(r1?.status).toBe("extracted");
    expect(services.persistRegion).toHaveBeenCalledOnce();
    actor.stop();
  });

  it("DROP_REGION removes the region and recounts", async () => {
    const actor = await enterReviewing();
    const countBefore = actor.getSnapshot().context.items.length;
    actor.send({ type: "DROP_REGION", regionId: "r1" });
    expect(actor.getSnapshot().context.items).toHaveLength(countBefore - 1);
    actor.stop();
  });

  it("ADJUST_BOUNDS patches region and persists", async () => {
    const services = makeServices();
    const actor = await enterReviewing(services);
    actor.send({
      type: "ADJUST_BOUNDS",
      regionId: "r1",
      patch: { w: 900, h: 700 },
    });
    const r1 = actor.getSnapshot().context.items.find((i) => i.id === "r1");
    expect(r1?.w).toBe(900);
    expect(services.persistRegion).toHaveBeenCalledOnce();
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 3: settleIfClear — auto-transition
// ---------------------------------------------------------------------------

describe("illustrationsTool — settleIfClear", () => {
  it("settles to extracted when last review region is confirmed", async () => {
    const services = makeServices({
      detectRegions: vi.fn().mockResolvedValue({
        items: [makeRegion({ id: "only", status: "review" })],
        counts: makeCounts({
          detected: 1,
          extracted: 0,
          review: 1,
          flagged: 0,
        }),
      }),
    });
    const actor = createActor(illustrationsToolMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("reviewing"));
    actor.send({ type: "CONFIRM_REGION", regionId: "only" });
    const snap = await waitForState(actor, (s) => s.matches("extracted"));
    expect(snap.matches("extracted")).toBe(true);
    actor.stop();
  });

  it("settles to extracted when last review region is dropped", async () => {
    const services = makeServices({
      detectRegions: vi.fn().mockResolvedValue({
        items: [makeRegion({ id: "only", status: "review" })],
        counts: makeCounts({
          detected: 1,
          extracted: 0,
          review: 1,
          flagged: 0,
        }),
      }),
    });
    const actor = createActor(illustrationsToolMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("reviewing"));
    actor.send({ type: "DROP_REGION", regionId: "only" });
    const snap = await waitForState(actor, (s) => s.matches("extracted"));
    expect(snap.matches("extracted")).toBe(true);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 4: gallery filter
// ---------------------------------------------------------------------------

describe("illustrationsTool — gallery filter", () => {
  async function enterReviewing() {
    const actor = createActor(illustrationsToolMachine, {
      input: makeInput(),
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("reviewing"));
    return actor;
  }

  it("SET_GALLERY_FILTER updates context.galleryFilter in reviewing", async () => {
    const actor = await enterReviewing();
    actor.send({ type: "SET_GALLERY_FILTER", value: "plates" });
    expect(actor.getSnapshot().context.galleryFilter).toBe("plates");
    actor.stop();
  });

  it("SET_GALLERY_FILTER works in extracted state too", async () => {
    const services = makeServices({
      detectRegions: vi.fn().mockResolvedValue({
        items: [makeRegion({ status: "extracted" })],
        counts: makeCounts({
          detected: 1,
          extracted: 1,
          review: 0,
          flagged: 0,
        }),
      }),
    });
    const actor = createActor(illustrationsToolMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("extracted"));
    actor.send({ type: "SET_GALLERY_FILTER", value: "lineart" });
    expect(actor.getSnapshot().context.galleryFilter).toBe("lineart");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 5: REDETECT from reviewing or extracted
// ---------------------------------------------------------------------------

describe("illustrationsTool — REDETECT", () => {
  it("REDETECT from reviewing transitions back to detecting", async () => {
    let callCount = 0;
    const services = makeServices({
      detectRegions: vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          items: [makeRegion({ status: "review" })],
          counts: makeCounts({
            detected: 1,
            extracted: 0,
            review: 1,
            flagged: 0,
          }),
        });
      }),
    });
    const actor = createActor(illustrationsToolMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("reviewing"));
    actor.send({ type: "REDETECT" });
    await waitForState(actor, (s) => s.matches("reviewing"), 600);
    expect(callCount).toBeGreaterThan(1);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 6: UPSTREAM_CHANGED from extracted
// ---------------------------------------------------------------------------

describe("illustrationsTool — UPSTREAM_CHANGED", () => {
  it("UPSTREAM_CHANGED from extracted resets to detecting", async () => {
    const services = makeServices({
      detectRegions: vi.fn().mockResolvedValue({
        items: [makeRegion({ status: "extracted" })],
        counts: makeCounts({
          detected: 1,
          extracted: 1,
          review: 0,
          flagged: 0,
        }),
      }),
    });
    const actor = createActor(illustrationsToolMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("extracted"));
    actor.send({ type: "UPSTREAM_CHANGED" });
    expect(actor.getSnapshot().matches("detecting")).toBe(true);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 7: failed path
// ---------------------------------------------------------------------------

describe("illustrationsTool — failed path", () => {
  it("detectRegions rejection → failed state", async () => {
    const services = makeServices({
      detectRegions: vi.fn().mockRejectedValue(new Error("detect error")),
    });
    const actor = createActor(illustrationsToolMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    const snap = await waitForState(actor, (s) => s.matches("failed"));
    expect(snap.context.error?.message).toBe("detect error");
    actor.stop();
  });

  it("RETRY from failed transitions back to detecting", async () => {
    let callCount = 0;
    const services = makeServices({
      detectRegions: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error("detect error"));
        }
        return Promise.resolve({
          items: [makeRegion({ status: "extracted" })],
          counts: makeCounts({
            detected: 1,
            extracted: 1,
            review: 0,
            flagged: 0,
          }),
        });
      }),
    });
    const actor = createActor(illustrationsToolMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("failed"));
    actor.send({ type: "RETRY" });
    await waitForState(actor, (s) => s.matches("extracted"), 600);
    expect(actor.getSnapshot().matches("extracted")).toBe(true);
    actor.stop();
  });
});
