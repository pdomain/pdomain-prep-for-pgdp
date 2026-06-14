/**
 * grayscaleTool.test.ts — invariant tests for the grayscaleTool machine.
 *
 * TDD invariants from tool-grayscale.yaml:
 *
 * Suite 1 "detect lifecycle" — detecting → converting → done
 * Suite 2 "draft / tuned sub-state" — SET_PARAM, SET_MODE, RESET, APPLY_RUN
 * Suite 3 "navigation" — PREV_PAGE, NEXT_PAGE (guarded)
 * Suite 4 "filter" — SET_FILTER
 * Suite 5 "error" — onError → error state, RETRY
 * Suite 6 "isLastPage" — PAGE_PUSH with _total sentinel
 */

import { describe, it, expect, vi } from "vitest";
import { createActor } from "xstate";
import {
  grayscaleToolMachine,
  type GrayscaleToolInput,
  type GrayscaleToolServices,
  type GrayscalePage,
} from "./grayscaleTool";
import { stubStageSettingsServices } from "./stageSettings";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeServices(
  overrides: Partial<GrayscaleToolServices> = {},
): GrayscaleToolServices {
  return {
    ...stubStageSettingsServices(),
    detectProfile: vi.fn().mockResolvedValue({
      mode: "perceptual",
      why: "newsprint · low contrast",
      backend: "gpu",
    }),
    runStage: vi.fn().mockResolvedValue(undefined),
    runPageStage: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeInput(
  overrides: Partial<GrayscaleToolInput> = {},
): GrayscaleToolInput {
  return {
    projectId: "proj-1",
    stageIndex: 1,
    services: makeServices(),
    ...overrides,
  };
}

function makePage(overrides: Partial<GrayscalePage> = {}): GrayscalePage {
  return { id: "p001", idx0: 0, mode: "perceptual", ...overrides };
}

async function waitForState(
  actor: ReturnType<typeof createActor<typeof grayscaleToolMachine>>,
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
        reject(new Error("timeout waiting for state"));
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

describe("grayscaleTool — detect lifecycle", () => {
  it("starts in detecting and transitions to converting on detect success", async () => {
    const actor = createActor(grayscaleToolMachine, { input: makeInput() });
    actor.start();
    expect(actor.getSnapshot().matches("detecting")).toBe(true);

    const snap = await waitForState(actor, (s) => s.matches("converting"));
    expect(snap.context.detected).toMatchObject({ mode: "perceptual" });
    expect(snap.context.backend).toBe("gpu");
    actor.stop();
  });

  it("assigns correct detected mode and why from detectProfile output", async () => {
    const services = makeServices({
      detectProfile: vi.fn().mockResolvedValue({
        mode: "standard",
        why: "clean modern scan",
        backend: "cpu",
      }),
    });
    const actor = createActor(grayscaleToolMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    const snap = await waitForState(actor, (s) => s.matches("converting"));
    expect(snap.context.detected).toEqual({
      mode: "standard",
      why: "clean modern scan",
    });
    expect(snap.context.backend).toBe("cpu");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 2: draft / tuned sub-state
// ---------------------------------------------------------------------------

describe("grayscaleTool — draft and tuned sub-state", () => {
  it("starts in done.idle after all pages convert, enters tuned on SET_PARAM", async () => {
    const actor = createActor(grayscaleToolMachine, { input: makeInput() });
    actor.start();
    // Wait until converting
    await waitForState(actor, (s) => s.matches("converting"));

    // Simulate PAGE_PUSH with _total = 1 to trigger isLastPage
    actor.send({
      type: "PAGE_PUSH",
      page: { id: "p001", mode: "perceptual", _total: 1 } as GrayscalePage & {
        _total: number;
      },
    });

    await waitForState(actor, (s) => s.matches({ done: "idle" }));

    actor.send({ type: "SET_PARAM", patch: { samplerRadius: 5 } });
    const snap = actor.getSnapshot();
    expect(snap.matches({ done: "tuned" })).toBe(true);
    expect(snap.context.draft).toMatchObject({ samplerRadius: 5 });
    actor.stop();
  });

  it("RESET from tuned returns to idle and clears draft", async () => {
    const actor = createActor(grayscaleToolMachine, { input: makeInput() });
    actor.start();
    await waitForState(actor, (s) => s.matches("converting"));
    actor.send({
      type: "PAGE_PUSH",
      page: { id: "p001", mode: "perceptual", _total: 1 } as GrayscalePage & {
        _total: number;
      },
    });
    await waitForState(actor, (s) => s.matches({ done: "idle" }));

    actor.send({ type: "SET_MODE", mode: "standard" });
    expect(actor.getSnapshot().matches({ done: "tuned" })).toBe(true);

    actor.send({ type: "RESET" });
    const snap = actor.getSnapshot();
    expect(snap.matches({ done: "idle" })).toBe(true);
    expect(snap.context.draft).toBeNull();
    actor.stop();
  });

  it("APPLY_RUN from tuned transitions back to converting", async () => {
    const actor = createActor(grayscaleToolMachine, { input: makeInput() });
    actor.start();
    await waitForState(actor, (s) => s.matches("converting"));
    actor.send({
      type: "PAGE_PUSH",
      page: { id: "p001", mode: "perceptual", _total: 1 } as GrayscalePage & {
        _total: number;
      },
    });
    await waitForState(actor, (s) => s.matches({ done: "idle" }));

    actor.send({ type: "SET_PARAM", patch: { gamma: 1.2 } });
    actor.send({ type: "APPLY_RUN" });

    const snap = actor.getSnapshot();
    expect(snap.matches("converting")).toBe(true);
    // draft cleared after commitDraft
    expect(snap.context.draft).toBeNull();
    actor.stop();
  });

  it("SET_MODE sets draft with the given mode", async () => {
    const actor = createActor(grayscaleToolMachine, { input: makeInput() });
    actor.start();
    await waitForState(actor, (s) => s.matches("converting"));
    actor.send({
      type: "PAGE_PUSH",
      page: { id: "p001", mode: "perceptual", _total: 1 } as GrayscalePage & {
        _total: number;
      },
    });
    await waitForState(actor, (s) => s.matches({ done: "idle" }));

    actor.send({ type: "SET_MODE", mode: "standard" });
    expect(actor.getSnapshot().context.draft).toMatchObject({
      mode: "standard",
    });
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 3: navigation
// ---------------------------------------------------------------------------

describe("grayscaleTool — navigation guards", () => {
  async function getDoneActor() {
    const services = makeServices();
    const actor = createActor(grayscaleToolMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("converting"));
    // Push 3 pages
    actor.send({ type: "PAGE_PUSH", page: makePage({ id: "p001" }) });
    actor.send({ type: "PAGE_PUSH", page: makePage({ id: "p002" }) });
    actor.send({
      type: "PAGE_PUSH",
      page: { ...makePage({ id: "p003" }), _total: 3 } as GrayscalePage & {
        _total: number;
      },
    });
    await waitForState(actor, (s) => s.matches({ done: "idle" }));
    return actor;
  }

  it("PREV_PAGE is blocked at cursor=0 (notFirst guard)", async () => {
    const actor = await getDoneActor();
    expect(actor.getSnapshot().context.cursor).toBe(0);
    actor.send({ type: "PREV_PAGE" });
    expect(actor.getSnapshot().context.cursor).toBe(0);
    actor.stop();
  });

  it("NEXT_PAGE advances cursor when not at last page", async () => {
    const actor = await getDoneActor();
    actor.send({ type: "NEXT_PAGE" });
    expect(actor.getSnapshot().context.cursor).toBe(1);
    actor.stop();
  });

  it("NEXT_PAGE is blocked at last page (notLast guard)", async () => {
    const actor = await getDoneActor();
    actor.send({ type: "NEXT_PAGE" });
    actor.send({ type: "NEXT_PAGE" });
    actor.send({ type: "NEXT_PAGE" }); // should be blocked at index 2
    expect(actor.getSnapshot().context.cursor).toBe(2);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 4: filter
// ---------------------------------------------------------------------------

describe("grayscaleTool — filter", () => {
  it("SET_FILTER updates context.filter in done state", async () => {
    const actor = createActor(grayscaleToolMachine, { input: makeInput() });
    actor.start();
    await waitForState(actor, (s) => s.matches("converting"));
    actor.send({
      type: "PAGE_PUSH",
      page: { id: "p001", mode: "perceptual", _total: 1 } as GrayscalePage & {
        _total: number;
      },
    });
    await waitForState(actor, (s) => s.matches({ done: "idle" }));

    actor.send({ type: "SET_FILTER", value: "standard" });
    expect(actor.getSnapshot().context.filter).toBe("standard");
    actor.stop();
  });

  it("REDETECT from done returns to detecting", async () => {
    const actor = createActor(grayscaleToolMachine, { input: makeInput() });
    actor.start();
    await waitForState(actor, (s) => s.matches("converting"));
    actor.send({
      type: "PAGE_PUSH",
      page: { id: "p001", mode: "perceptual", _total: 1 } as GrayscalePage & {
        _total: number;
      },
    });
    await waitForState(actor, (s) => s.matches({ done: "idle" }));

    actor.send({ type: "REDETECT" });
    expect(actor.getSnapshot().matches("detecting")).toBe(true);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 5: error handling
// ---------------------------------------------------------------------------

describe("grayscaleTool — error handling", () => {
  it("transitions to error state when detectProfile rejects", async () => {
    const services = makeServices({
      detectProfile: vi.fn().mockRejectedValue(new Error("network error")),
    });
    const actor = createActor(grayscaleToolMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    const snap = await waitForState(actor, (s) => s.matches("error"));
    expect(snap.context.error).toMatchObject({ message: "network error" });
    actor.stop();
  });

  it("RETRY from error state re-enters detecting and clears error", async () => {
    const detectFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce({
        mode: "perceptual",
        why: "retry ok",
        backend: "gpu",
      });

    const services = makeServices({ detectProfile: detectFn });
    const actor = createActor(grayscaleToolMachine, {
      input: makeInput({ services }),
    });
    actor.start();
    await waitForState(actor, (s) => s.matches("error"));

    actor.send({ type: "RETRY" });
    await waitForState(actor, (s) => s.matches("converting"));
    expect(actor.getSnapshot().context.error).toBeNull();
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 6: isLastPage
// ---------------------------------------------------------------------------

describe("grayscaleTool — isLastPage sentinel", () => {
  it("stays in converting without _total regardless of push count", async () => {
    const actor = createActor(grayscaleToolMachine, { input: makeInput() });
    actor.start();
    await waitForState(actor, (s) => s.matches("converting"));

    // Push without _total — should stay in converting
    actor.send({ type: "PAGE_PUSH", page: makePage({ id: "p001" }) });
    actor.send({ type: "PAGE_PUSH", page: makePage({ id: "p002" }) });
    expect(actor.getSnapshot().matches("converting")).toBe(true);
    actor.stop();
  });

  it("transitions to done when _total matches push count", async () => {
    const actor = createActor(grayscaleToolMachine, { input: makeInput() });
    actor.start();
    await waitForState(actor, (s) => s.matches("converting"));

    actor.send({ type: "PAGE_PUSH", page: makePage({ id: "p001" }) });
    actor.send({
      type: "PAGE_PUSH",
      page: { id: "p002", mode: "standard", _total: 2 } as GrayscalePage & {
        _total: number;
      },
    });
    const snap = actor.getSnapshot();
    expect(snap.matches("done")).toBe(true);
    expect(snap.context.pages).toHaveLength(2);
    actor.stop();
  });
});
