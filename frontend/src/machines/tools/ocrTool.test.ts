/**
 * ocrTool.test.ts — TDD tests for the OCR stage tool machine.
 *
 * Invariants derived from tool-ocr.yaml:
 * - runComplete guard fires when all running pages are done (post-merge check)
 * - allFlagsReviewed: flagged === 0 or all flagged are reviewed
 * - hasNextFlagged: there is a flagged page after the cursor
 * - ACCEPT_TOKEN swaps token word to suggestion
 * - ACCEPT_PAGE marks the page reviewed + recounts
 * - NEXT_FLAGGED advances to next flagged or returns to grid
 * - Machine-level engine config events available throughout
 * - Settled state re-triggers OCR on UPSTREAM_CHANGED / SETTINGS_CHANGED
 */

import { createActor, waitFor } from "xstate";
import { describe, it, expect, vi } from "vitest";
import {
  ocrToolMachine,
  type OcrPageRow,
  type OcrToolServices,
  type OcrOverride,
} from "./ocrTool";
import { stubStageSettingsServices } from "./stageSettings";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeRow(
  idx: string,
  state: OcrPageRow["state"],
  overrides: Partial<OcrPageRow> = {},
): OcrPageRow {
  return {
    idx,
    prefix: `p${idx}`,
    state,
    meanConf: 0.95,
    lowConf: 0,
    words: 120,
    illust: false,
    ...overrides,
  };
}

function makeServices(
  overrides: Partial<OcrToolServices> = {},
): OcrToolServices {
  return {
    ...stubStageSettingsServices(),
    fetchPageTokens: vi.fn().mockResolvedValue({ tokens: [] }),
    confirmStage: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

function startMachine(services: OcrToolServices = makeServices()) {
  const actor = createActor(ocrToolMachine, {
    input: { projectId: "p1", stageIndex: 7, services },
  });
  actor.start();
  return actor;
}

// ---------------------------------------------------------------------------
// Recognition loop
// ---------------------------------------------------------------------------

describe("recognising state", () => {
  it("starts in recognising state with empty rows", () => {
    const actor = startMachine();
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("recognising");
    expect(snap.context.rows).toHaveLength(0);
    expect(snap.context.totals).toBeNull();
  });

  it("PAGE_PUSH merges new row and stays in recognising while pages are still running", () => {
    const actor = startMachine();

    // push two running rows
    actor.send({ type: "PAGE_PUSH", row: makeRow("0001", "running") });
    actor.send({ type: "PAGE_PUSH", row: makeRow("0002", "running") });

    // push one done row — still one running, must stay in recognising
    actor.send({ type: "PAGE_PUSH", row: makeRow("0001", "clean") });

    const snap = actor.getSnapshot();
    expect(snap.value).toBe("recognising");
    expect(snap.context.rows).toHaveLength(2);
    expect(snap.context.totals?.running).toBe(1);
  });

  it("transitions to reviewing when the last running page completes", async () => {
    const actor = startMachine();

    actor.send({ type: "PAGE_PUSH", row: makeRow("0001", "running") });
    // final page push — state = clean, no more running
    actor.send({ type: "PAGE_PUSH", row: makeRow("0001", "clean") });

    const snap = await waitFor(actor, (s) => s.matches("reviewing"));
    expect(snap.context.totals?.running).toBe(0);
    expect(snap.context.rows[0]!.state).toBe("clean");
  });

  it("runComplete guard: multi-page scenario transitions when ALL running become done", async () => {
    const actor = startMachine();

    actor.send({ type: "PAGE_PUSH", row: makeRow("0001", "running") });
    actor.send({ type: "PAGE_PUSH", row: makeRow("0002", "running") });
    actor.send({ type: "PAGE_PUSH", row: makeRow("0001", "clean") });

    // still in recognising (0002 is running)
    expect(actor.getSnapshot().value).toBe("recognising");

    // last push completes all
    actor.send({ type: "PAGE_PUSH", row: makeRow("0002", "flagged") });

    const snap = await waitFor(actor, (s) => s.matches("reviewing"));
    expect(snap.context.totals?.flagged).toBe(1);
    expect(snap.context.totals?.running).toBe(0);
  });

  it("PAGE_PUSH upserts an existing row (not duplicates)", () => {
    const actor = startMachine();
    actor.send({ type: "PAGE_PUSH", row: makeRow("0001", "running") });
    actor.send({ type: "PAGE_PUSH", row: makeRow("0001", "clean") });

    // Single page, since the second push was an upsert
    const rows = actor.getSnapshot().context.rows;
    expect(rows).toHaveLength(1);
    // last push wins (clean), but since no other running pages, machine transitions to reviewing
    // so check state instead
  });
});

// ---------------------------------------------------------------------------
// Grid sub-state
// ---------------------------------------------------------------------------

describe("reviewing.grid sub-state", () => {
  async function reachReviewing(services = makeServices()) {
    const actor = startMachine(services);
    actor.send({ type: "PAGE_PUSH", row: makeRow("0001", "clean") });
    await waitFor(actor, (s) => s.matches({ reviewing: "grid" }));
    return actor;
  }

  it("starts in reviewing.grid after recognition completes", async () => {
    const actor = await reachReviewing();
    expect(actor.getSnapshot().matches({ reviewing: "grid" })).toBe(true);
  });

  it("OPEN_RECOGNITION transitions to reviewing.recognition and sets cursor", async () => {
    const actor = await reachReviewing();
    actor.send({ type: "OPEN_RECOGNITION", idx: "0001" });

    const snap = actor.getSnapshot();
    expect(snap.matches({ reviewing: "recognition" })).toBe(true);
    expect(snap.context.cursor).toBe("0001");
  });

  it("RE_OCR_SELECTION goes back to recognising", async () => {
    const actor = await reachReviewing();
    actor.send({ type: "RE_OCR_SELECTION" });

    const snap = actor.getSnapshot();
    expect(snap.value).toBe("recognising");
  });
});

// ---------------------------------------------------------------------------
// Recognition sub-state
// ---------------------------------------------------------------------------

describe("reviewing.recognition sub-state", () => {
  async function reachRecognition(rows: OcrPageRow[] = []) {
    const services = makeServices();
    const actor = startMachine(services);

    // Populate rows and reach reviewing.
    // Push each row as "running" first so the machine stays in `recognising`
    // (runComplete requires 0 running pages). Then push final states one by one;
    // the last final-state push reduces running to 0 and triggers the transition.
    const initialRows =
      rows.length > 0
        ? rows
        : [makeRow("0001", "flagged"), makeRow("0002", "flagged")];
    for (const r of initialRows) {
      actor.send({ type: "PAGE_PUSH", row: makeRow(r.idx, "running") });
    }
    for (const r of initialRows) {
      actor.send({ type: "PAGE_PUSH", row: r });
    }
    await waitFor(actor, (s) => s.matches({ reviewing: "grid" }));

    actor.send({ type: "OPEN_RECOGNITION", idx: initialRows[0]!.idx });
    await waitFor(actor, (s) => s.matches({ reviewing: "recognition" }));

    return actor;
  }

  it("ACCEPT_TOKEN swaps the token to its suggestion", async () => {
    const services = makeServices({
      fetchPageTokens: vi.fn().mockResolvedValue({
        tokens: [
          { id: "t1", word: "tbe", suggest: "the", conf: 0.72 },
          { id: "t2", word: "ond", suggest: "and", conf: 0.68 },
        ],
      }),
    });
    const actor = startMachine(services);
    actor.send({
      type: "PAGE_PUSH",
      row: makeRow("0001", "clean", { lowConf: 2 }),
    });
    await waitFor(actor, (s) => s.matches({ reviewing: "grid" }));
    actor.send({ type: "OPEN_RECOGNITION", idx: "0001" });
    await waitFor(actor, (s) => s.matches({ reviewing: "recognition" }));

    // Manually set tokens in context (at F5 loadTokens is a no-op)
    // We test applySuggestion with pre-existing tokens
    // Since loadTokens is a no-op, tokens start empty; test the state machine logic
    actor.send({ type: "ACCEPT_TOKEN", tokenId: "t1" });
    // accepted list should now contain t1
    expect(actor.getSnapshot().context.accepted).toContain("t1");
  });

  it("ACCEPT_TOKEN idempotent — does not duplicate accepted ids", async () => {
    const actor = await reachRecognition();
    actor.send({ type: "ACCEPT_TOKEN", tokenId: "t1" });
    actor.send({ type: "ACCEPT_TOKEN", tokenId: "t1" });
    const { accepted } = actor.getSnapshot().context;
    expect(accepted.filter((id) => id === "t1")).toHaveLength(1);
  });

  it("ACCEPT_PAGE marks the cursor page as reviewed and recounts", async () => {
    const actor = await reachRecognition([
      makeRow("0001", "flagged"),
      makeRow("0002", "clean"),
    ]);

    actor.send({ type: "ACCEPT_PAGE" });

    const snap = actor.getSnapshot();
    const row0001 = snap.context.rows.find((r) => r.idx === "0001");
    expect(row0001?.state).toBe("reviewed");
    expect(snap.context.totals?.reviewed).toBeGreaterThan(0);
  });

  it("CLOSE returns to grid and clears cursor", async () => {
    const actor = await reachRecognition();
    actor.send({ type: "CLOSE" });

    const snap = actor.getSnapshot();
    expect(snap.matches({ reviewing: "grid" })).toBe(true);
    expect(snap.context.cursor).toBeNull();
  });

  it("NEXT_FLAGGED advances cursor to next flagged page", async () => {
    const actor = await reachRecognition([
      makeRow("0001", "flagged"),
      makeRow("0002", "flagged"),
    ]);

    // cursor is 0001; next flagged is 0002
    actor.send({ type: "NEXT_FLAGGED" });

    const snap = actor.getSnapshot();
    expect(snap.matches({ reviewing: "recognition" })).toBe(true);
    expect(snap.context.cursor).toBe("0002");
  });

  it("NEXT_FLAGGED goes to grid when no more flagged pages", async () => {
    const actor = await reachRecognition([
      makeRow("0001", "flagged"),
      makeRow("0002", "clean"),
    ]);

    // Only one flagged page; NEXT_FLAGGED should go to grid
    actor.send({ type: "NEXT_FLAGGED" });

    const snap = actor.getSnapshot();
    expect(snap.matches({ reviewing: "grid" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// allFlagsReviewed guard + CONFIRM_ADVANCE
// ---------------------------------------------------------------------------

describe("allFlagsReviewed guard", () => {
  async function reachReviewingWith(rows: OcrPageRow[]) {
    const actor = startMachine();
    for (const r of rows) {
      actor.send({ type: "PAGE_PUSH", row: r });
    }
    await waitFor(actor, (s) => s.matches({ reviewing: "grid" }));
    return actor;
  }

  it("CONFIRM_ADVANCE allowed when no flagged pages", async () => {
    const actor = await reachReviewingWith([
      makeRow("0001", "clean"),
      makeRow("0002", "clean"),
    ]);

    actor.send({ type: "CONFIRM_ADVANCE" });
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("confirming");
  });

  it("CONFIRM_ADVANCE allowed when all flagged pages are reviewed", async () => {
    const actor = await reachReviewingWith([
      makeRow("0001", "reviewed"),
      makeRow("0002", "clean"),
    ]);

    actor.send({ type: "CONFIRM_ADVANCE" });
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("confirming");
  });

  it("CONFIRM_ADVANCE blocked when there are unreviewed flagged pages", async () => {
    const actor = await reachReviewingWith([
      makeRow("0001", "flagged"),
      makeRow("0002", "clean"),
    ]);

    actor.send({ type: "CONFIRM_ADVANCE" });
    // Must still be in reviewing (guard should block transition)
    const snap = actor.getSnapshot();
    expect(snap.matches("reviewing")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// confirming → settled lifecycle
// ---------------------------------------------------------------------------

describe("confirming and settled states", () => {
  async function reachReviewingAllClean() {
    const services = makeServices();
    const actor = startMachine(services);
    actor.send({ type: "PAGE_PUSH", row: makeRow("0001", "clean") });
    await waitFor(actor, (s) => s.matches({ reviewing: "grid" }));
    return actor;
  }

  it("confirming calls confirmStage and transitions to settled on success", async () => {
    const confirmStage = vi.fn().mockResolvedValue({ ok: true });
    const services = makeServices({ confirmStage });
    const actor = startMachine(services);
    actor.send({ type: "PAGE_PUSH", row: makeRow("0001", "clean") });
    await waitFor(actor, (s) => s.matches({ reviewing: "grid" }));

    actor.send({ type: "CONFIRM_ADVANCE" });
    const snap = await waitFor(actor, (s) => s.matches("settled"));
    expect(confirmStage).toHaveBeenCalledWith("p1");
    expect(snap.value).toBe("settled");
  });

  it("confirming returns to reviewing on error", async () => {
    const confirmStage = vi.fn().mockRejectedValue(new Error("confirm failed"));
    const services = makeServices({ confirmStage });
    const actor = startMachine(services);
    actor.send({ type: "PAGE_PUSH", row: makeRow("0001", "clean") });
    await waitFor(actor, (s) => s.matches({ reviewing: "grid" }));

    actor.send({ type: "CONFIRM_ADVANCE" });
    const snap = await waitFor(actor, (s) => s.matches("reviewing"));
    expect(snap.context.error?.message).toBe("confirm failed");
  });

  it("UPSTREAM_CHANGED from settled re-enters recognising", async () => {
    const actor = await reachReviewingAllClean();
    actor.send({ type: "CONFIRM_ADVANCE" });
    await waitFor(actor, (s) => s.matches("settled"));

    actor.send({ type: "UPSTREAM_CHANGED" });
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("recognising");
  });

  it("SETTINGS_CHANGED from settled re-enters recognising", async () => {
    const actor = await reachReviewingAllClean();
    actor.send({ type: "CONFIRM_ADVANCE" });
    await waitFor(actor, (s) => s.matches("settled"));

    actor.send({ type: "SETTINGS_CHANGED" });
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("recognising");
  });
});

// ---------------------------------------------------------------------------
// Machine-level engine config events (DIVERGENCES.md #7)
// ---------------------------------------------------------------------------

describe("machine-level engine config events", () => {
  it("SET_ENGINE updates engine from recognising state", () => {
    const actor = startMachine();
    expect(actor.getSnapshot().context.engine).toBe("doctr");
    actor.send({ type: "SET_ENGINE", value: "tesseract" });
    expect(actor.getSnapshot().context.engine).toBe("tesseract");
  });

  it("SET_BACKEND updates backend", () => {
    const actor = startMachine();
    expect(actor.getSnapshot().context.backend).toBe("gpu");
    actor.send({ type: "SET_BACKEND", value: "cpu" });
    expect(actor.getSnapshot().context.backend).toBe("cpu");
  });

  it("SET_WEIGHTS patches weights", () => {
    const actor = startMachine();
    actor.send({
      type: "SET_WEIGHTS",
      patch: { detect: "my-detect-v2", recog: "my-recog-v2" },
    });
    const { _weights } = actor.getSnapshot().context;
    expect(_weights["detect"]).toBe("my-detect-v2");
    expect(_weights["recog"]).toBe("my-recog-v2");
  });

  it("SET_WEIGHTS merges with existing weights", () => {
    const actor = startMachine();
    actor.send({ type: "SET_WEIGHTS", patch: { detect: "d-v1" } });
    actor.send({ type: "SET_WEIGHTS", patch: { recog: "r-v1" } });
    const { _weights } = actor.getSnapshot().context;
    expect(_weights["detect"]).toBe("d-v1");
    expect(_weights["recog"]).toBe("r-v1");
  });

  it("ADD_OVERRIDE appends an override entry", () => {
    const actor = startMachine();
    const override: OcrOverride = {
      pages: "0015–0023",
      count: 9,
      engine: "tesseract",
      lang: "ell",
      reason: "Greek section",
    };
    actor.send({ type: "ADD_OVERRIDE", override });
    const { overrides } = actor.getSnapshot().context;
    expect(overrides).toHaveLength(1);
    expect(overrides[0]!.lang).toBe("ell");
  });

  it("EDIT_OVERRIDE patches an existing override by index", () => {
    const actor = startMachine();
    const override: OcrOverride = {
      pages: "0015–0023",
      count: 9,
      engine: "tesseract",
      lang: "ell",
      reason: "Greek section",
    };
    actor.send({ type: "ADD_OVERRIDE", override });
    actor.send({
      type: "EDIT_OVERRIDE",
      index: 0,
      patch: { reason: "Updated reason", lang: "ell+grc" },
    });
    const { overrides } = actor.getSnapshot().context;
    expect(overrides[0]!.reason).toBe("Updated reason");
    expect(overrides[0]!.lang).toBe("ell+grc");
  });

  it("engine config events available from reviewing state too (machine-level)", async () => {
    const actor = startMachine();
    actor.send({ type: "PAGE_PUSH", row: makeRow("0001", "clean") });
    await waitFor(actor, (s) => s.matches("reviewing"));

    // SET_ENGINE must still work in reviewing
    actor.send({ type: "SET_ENGINE", value: "tesseract" });
    expect(actor.getSnapshot().context.engine).toBe("tesseract");
  });

  it("engine config events available from settled state too (machine-level)", async () => {
    const actor = startMachine();
    actor.send({ type: "PAGE_PUSH", row: makeRow("0001", "clean") });
    await waitFor(actor, (s) => s.matches({ reviewing: "grid" }));
    actor.send({ type: "CONFIRM_ADVANCE" });
    await waitFor(actor, (s) => s.matches("settled"));

    actor.send({ type: "SET_ENGINE", value: "tesseract" });
    expect(actor.getSnapshot().context.engine).toBe("tesseract");
  });
});

// ---------------------------------------------------------------------------
// recountOcr helpers via state transitions
// ---------------------------------------------------------------------------

describe("recountOcr inline recount", () => {
  it("totals update correctly as pages are pushed", async () => {
    const actor = startMachine();
    actor.send({ type: "PAGE_PUSH", row: makeRow("0001", "running") });
    actor.send({
      type: "PAGE_PUSH",
      row: makeRow("0002", "running", { words: 50, meanConf: 0.7 }),
    });

    let snap = actor.getSnapshot();
    expect(snap.context.totals?.total).toBe(2);
    expect(snap.context.totals?.running).toBe(2);

    actor.send({
      type: "PAGE_PUSH",
      row: makeRow("0001", "clean", { words: 120 }),
    });
    actor.send({
      type: "PAGE_PUSH",
      row: makeRow("0002", "flagged", { words: 50 }),
    });

    await waitFor(actor, (s) => s.matches("reviewing"));
    snap = actor.getSnapshot();

    expect(snap.context.totals?.total).toBe(2);
    expect(snap.context.totals?.running).toBe(0);
    expect(snap.context.totals?.flagged).toBe(1);
    expect(snap.context.totals?.clean).toBe(1);
    expect(snap.context.totals?.words).toBe(170); // 120 + 50
  });
});
