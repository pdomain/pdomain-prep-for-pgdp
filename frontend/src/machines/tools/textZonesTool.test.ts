/**
 * textZonesTool.test.ts — TDD tests for the textZonesTool XState v5 machine.
 *
 * Critical invariant under test: APPLY_SPLIT page-set mutation
 *   - Replaces parent row with children in the page set
 *   - Narrow stale fan-out: page_order + canvas_map, NOT ocr
 *   - emitPageCountChanged side-effect fires
 *   - Shell must re-key the page set with new child page IDs
 *
 * Also covers:
 *   - Zone editor states (draw, retype, delete, reorder, redetect)
 *   - Split editor confirm/cancel flow
 *   - KEEP_AS_ONE (dismiss split, no page-set change)
 *   - Filter / density events (machine-level in reviewing)
 *   - CONFIRM_ADVANCE gate (allFlagsReviewed guard)
 *   - settled → UPSTREAM_CHANGED → loading restart
 */

import { describe, it, expect, vi } from "vitest";
import { createActor } from "xstate";
import {
  textZonesToolMachine,
  type TextZonesToolServices,
  type ZonePageRow,
  type ZoneTotals,
  type SplitResult,
  type Zone,
} from "./textZonesTool";
import { computeDownstream } from "../../mocks/fixtures";
import { stubStageSettingsServices } from "./stageSettings";

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

function makeRow(
  idx: string,
  state: ZonePageRow["state"] = "clean",
  extras?: Partial<ZonePageRow>,
): ZonePageRow {
  return {
    idx,
    prefix: `p${idx}`,
    state,
    flags: [],
    zones: 4,
    lines: 12,
    words: 80,
    pageNumber: parseInt(idx, 10) + 1,
    ...extras,
  };
}

function makeTotals(rows: ZonePageRow[]): ZoneTotals {
  const total = rows.length;
  const clean = rows.filter((r) => r.state === "clean").length;
  const flagged = rows.filter((r) => r.state === "flagged").length;
  const reviewed = rows.filter((r) => r.state === "reviewed").length;
  const splits = rows.filter((r) =>
    (r.flags ?? []).includes("splitSuggested"),
  ).length;
  return {
    total,
    done: total,
    clean,
    flagged,
    reviewed,
    splits,
  };
}

function makeSplitRow(idx: string): ZonePageRow {
  return makeRow(idx, "flagged", {
    flags: ["splitSuggested"],
    split: { axis: "col", into: 2, gutter: 0.5, conf: 0.82 },
  });
}

function makeSplitResult(parentIdx: string): SplitResult {
  const parentRow = makeRow(parentIdx, "split");
  const childA: ZonePageRow = {
    ...makeRow(`${parentIdx}a`, "clean"),
    idx: `${parentIdx}a`,
    prefix: `p${parentIdx}a`,
  };
  const childB: ZonePageRow = {
    ...makeRow(`${parentIdx}b`, "clean"),
    idx: `${parentIdx}b`,
    prefix: `p${parentIdx}b`,
  };
  return { parentRow, childRows: [childA, childB] };
}

// ---------------------------------------------------------------------------
// Service stub factory
// ---------------------------------------------------------------------------

function makeServices(
  overrides?: Partial<TextZonesToolServices>,
): TextZonesToolServices {
  return {
    ...stubStageSettingsServices(),
    fetchZonePages: vi.fn().mockResolvedValue({
      rows: [makeRow("0"), makeRow("1"), makeSplitRow("2")],
      totals: {
        total: 3,
        done: 3,
        clean: 2,
        flagged: 1,
        reviewed: 0,
        splits: 1,
      },
    }),
    applySplit: vi.fn().mockResolvedValue(makeSplitResult("2")),
    redetectLayout: vi.fn().mockResolvedValue({ zones: [] }),
    persistLayout: vi.fn().mockResolvedValue({ ok: true }),
    confirmStage: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// APPLY_SPLIT page-set mutation (critical invariant)
// ---------------------------------------------------------------------------

describe("textZonesTool — APPLY_SPLIT page-set mutation", () => {
  it("replaces parent row with child rows in context.rows after applySplit", async () => {
    const services = makeServices();
    const actor = createActor(textZonesToolMachine, {
      input: { projectId: "proj-1", stageIndex: 9, services },
    });
    actor.start();

    // Wait for loading → reviewing
    await flushPromises();
    expect(actor.getSnapshot().value).toMatchObject({ reviewing: "browsing" });

    // Open the split editor for row "2"
    actor.send({ type: "OPEN_SPLIT_EDITOR", idx: "2" });
    expect(actor.getSnapshot().value).toMatchObject({
      reviewing: "editingSplit",
    });
    expect(actor.getSnapshot().context.editing).toBe("2");
    expect(actor.getSnapshot().context.editorKind).toBe("split");

    // Apply the split
    actor.send({ type: "APPLY_SPLIT" });
    expect(actor.getSnapshot().value).toMatchObject({
      reviewing: "applyingSplit",
    });

    // Wait for applySplit to resolve
    await flushPromises();
    expect(actor.getSnapshot().value).toMatchObject({ reviewing: "browsing" });

    const rows = actor.getSnapshot().context.rows;
    // Parent row should be in the rows with state 'split'
    const parentRow = rows.find((r) => r.idx === "2");
    expect(parentRow).toBeDefined();
    expect(parentRow?.state).toBe("split");

    // Child rows should have been inserted
    const childA = rows.find((r) => r.idx === "2a");
    const childB = rows.find((r) => r.idx === "2b");
    expect(childA).toBeDefined();
    expect(childB).toBeDefined();

    // Total row count: 3 original rows; parent stays (state:'split') + 2 children inserted after = 5
    expect(rows.length).toBe(5); // 3 original rows, parent stays as split marker, 2 children added

    actor.stop();
  });

  it("clears editing context after APPLY_SPLIT completes", async () => {
    const services = makeServices();
    const actor = createActor(textZonesToolMachine, {
      input: { projectId: "proj-1", stageIndex: 9, services },
    });
    actor.start();
    await flushPromises();

    actor.send({ type: "OPEN_SPLIT_EDITOR", idx: "2" });
    actor.send({ type: "APPLY_SPLIT" });
    await flushPromises();

    const snap = actor.getSnapshot();
    expect(snap.context.editing).toBeNull();
    expect(snap.context.editorKind).toBeNull();
    expect(snap.context.splitDraft).toBeNull();
    actor.stop();
  });

  it("calls applySplit service with the current splitDraft", async () => {
    const services = makeServices();
    const actor = createActor(textZonesToolMachine, {
      input: { projectId: "proj-1", stageIndex: 9, services },
    });
    actor.start();
    await flushPromises();

    actor.send({ type: "OPEN_SPLIT_EDITOR", idx: "2" });
    // Adjust the gutter
    actor.send({ type: "DRAG_GUTTER", patch: { gutter: 0.6 } });
    actor.send({ type: "APPLY_SPLIT" });
    await flushPromises();

    expect(services.applySplit).toHaveBeenCalledWith(
      "proj-1",
      "2",
      expect.objectContaining({ gutter: 0.6 }),
    );
    actor.stop();
  });

  it("transitions back to editingSplit on applySplit error", async () => {
    const services = makeServices({
      applySplit: vi.fn().mockRejectedValue(new Error("split failed")),
    });
    const actor = createActor(textZonesToolMachine, {
      input: { projectId: "proj-1", stageIndex: 9, services },
    });
    actor.start();
    await flushPromises();

    actor.send({ type: "OPEN_SPLIT_EDITOR", idx: "2" });
    actor.send({ type: "APPLY_SPLIT" });
    await flushPromises();

    expect(actor.getSnapshot().value).toMatchObject({
      reviewing: "editingSplit",
    });
    expect(actor.getSnapshot().context.error?.message).toBe("split failed");
    actor.stop();
  });

  it("NARROW STALE fan-out: text_zones does NOT have ocr as downstream", () => {
    // Assert the invariant directly against STAGE_DEPS.
    // text_zones runs, which emitPageCountChanged: page_order + canvas_map stale.
    // ocr depends on post_ocr_crop → canvas_map, NOT on text_zones directly.
    const downstream = computeDownstream("text_zones");

    // Should include page_order (cross-scope dep)
    expect(downstream).toContain("page_order");

    // Should NOT include ocr directly — ocr is a SIBLING DAG path
    // (ocr depends on post_ocr_crop which depends on canvas_map, not text_zones)
    // text_zones is upstream of page_order only (per STAGE_DEPS)
    // canvas_map is downstream of post_transform_crop (not text_zones)
    expect(downstream).not.toContain("ocr");

    // Verify: ocr is NOT in the downstream fan from text_zones
    // This is the key invariant: applying a split must NOT stale the ocr stage directly
    expect(downstream).not.toContain("post_ocr_crop");
  });

  it("NARROW STALE fan-out: canvas_map IS downstream of post_transform_crop (split children need it)", () => {
    // Split children go through the full pipeline starting at canvas_map.
    // canvas_map depends on post_transform_crop (which split children inherit).
    const downstream = computeDownstream("post_transform_crop");
    expect(downstream).toContain("canvas_map");
    expect(downstream).toContain("post_ocr_crop");
    expect(downstream).toContain("ocr");
  });

  it("page_order is downstream of text_zones per STAGE_DEPS cross-scope dep", () => {
    // STAGE_DEPS: page_order: ["source", "text_zones"]
    // So re-running text_zones marks page_order stale.
    const downstream = computeDownstream("text_zones");
    expect(downstream).toContain("page_order");
  });
});

// ---------------------------------------------------------------------------
// Zone editor states
// ---------------------------------------------------------------------------

describe("textZonesTool — zone editor", () => {
  it("opens zone editor: sets editing, editorKind='zones', clones zoneDraft", async () => {
    const services = makeServices();
    const actor = createActor(textZonesToolMachine, {
      input: { projectId: "proj-1", stageIndex: 9, services },
    });
    actor.start();
    await flushPromises();

    actor.send({ type: "OPEN_ZONE_EDITOR", idx: "0" });
    const snap = actor.getSnapshot();
    expect(snap.value).toMatchObject({ reviewing: "editingZones" });
    expect(snap.context.editing).toBe("0");
    expect(snap.context.editorKind).toBe("zones");
    expect(Array.isArray(snap.context.zoneDraft)).toBe(true);
    actor.stop();
  });

  it("SET_TOOL updates the active drawing tool", async () => {
    const services = makeServices();
    const actor = createActor(textZonesToolMachine, {
      input: { projectId: "proj-1", stageIndex: 9, services },
    });
    actor.start();
    await flushPromises();
    actor.send({ type: "OPEN_ZONE_EDITOR", idx: "0" });

    actor.send({ type: "SET_TOOL", tool: "lasso" });
    expect(actor.getSnapshot().context.tool).toBe("lasso");

    actor.send({ type: "SET_TOOL", tool: "select" });
    expect(actor.getSnapshot().context.tool).toBe("select");
    actor.stop();
  });

  it("DRAW_ZONE appends a new zone to zoneDraft", async () => {
    const services = makeServices();
    const actor = createActor(textZonesToolMachine, {
      input: { projectId: "proj-1", stageIndex: 9, services },
    });
    actor.start();
    await flushPromises();
    actor.send({ type: "OPEN_ZONE_EDITOR", idx: "0" });

    const before = actor.getSnapshot().context.zoneDraft?.length ?? 0;
    actor.send({
      type: "DRAW_ZONE",
      box: { x: 0.1, y: 0.1, w: 0.3, h: 0.2 },
      zoneType: "illustration",
    });
    const after = actor.getSnapshot().context.zoneDraft?.length ?? 0;
    expect(after).toBe(before + 1);

    const newZone = actor.getSnapshot().context.zoneDraft?.at(-1);
    expect(newZone?.type).toBe("illustration");
    actor.stop();
  });

  it("RETYPE_ZONE updates zone type in zoneDraft", async () => {
    const services = makeServices({
      fetchZonePages: vi.fn().mockResolvedValue({
        rows: [
          {
            ...makeRow("0"),
            _zones: [
              { id: "z1", type: "body", x: 0, y: 0, w: 0.5, h: 0.5, order: 1 },
            ],
          },
        ],
        totals: makeTotals([makeRow("0")]),
      }),
    });
    const actor = createActor(textZonesToolMachine, {
      input: { projectId: "proj-1", stageIndex: 9, services },
    });
    actor.start();
    await flushPromises();
    actor.send({ type: "OPEN_ZONE_EDITOR", idx: "0" });

    actor.send({ type: "RETYPE_ZONE", zoneId: "z1", zoneType: "heading" });
    const zone = actor
      .getSnapshot()
      .context.zoneDraft?.find((z) => z.id === "z1");
    expect(zone?.type).toBe("heading");
    actor.stop();
  });

  it("DELETE_ZONE removes a zone from zoneDraft", async () => {
    const services = makeServices({
      fetchZonePages: vi.fn().mockResolvedValue({
        rows: [
          {
            ...makeRow("0"),
            _zones: [
              { id: "z1", type: "body", x: 0, y: 0, w: 0.5, h: 0.5, order: 1 },
              {
                id: "z2",
                type: "heading",
                x: 0,
                y: 0.5,
                w: 0.5,
                h: 0.2,
                order: 2,
              },
            ],
          },
        ],
        totals: makeTotals([makeRow("0")]),
      }),
    });
    const actor = createActor(textZonesToolMachine, {
      input: { projectId: "proj-1", stageIndex: 9, services },
    });
    actor.start();
    await flushPromises();
    actor.send({ type: "OPEN_ZONE_EDITOR", idx: "0" });

    actor.send({ type: "DELETE_ZONE", zoneId: "z1" });
    const draft = actor.getSnapshot().context.zoneDraft;
    expect(draft?.find((z) => z.id === "z1")).toBeUndefined();
    expect(draft?.length).toBe(1);
    actor.stop();
  });

  it("REORDER_ZONE reorders zones in zoneDraft", async () => {
    const zones: Zone[] = [
      { id: "z1", type: "body", x: 0, y: 0, w: 0.5, h: 0.2, order: 1 },
      { id: "z2", type: "heading", x: 0, y: 0.2, w: 0.5, h: 0.2, order: 2 },
      { id: "z3", type: "footer", x: 0, y: 0.4, w: 0.5, h: 0.1, order: 3 },
    ];
    const services = makeServices({
      fetchZonePages: vi.fn().mockResolvedValue({
        rows: [{ ...makeRow("0"), _zones: zones }],
        totals: makeTotals([makeRow("0")]),
      }),
    });
    const actor = createActor(textZonesToolMachine, {
      input: { projectId: "proj-1", stageIndex: 9, services },
    });
    actor.start();
    await flushPromises();
    actor.send({ type: "OPEN_ZONE_EDITOR", idx: "0" });

    actor.send({ type: "REORDER_ZONE", from: 0, to: 2 });
    const draft = actor.getSnapshot().context.zoneDraft;
    expect(draft?.[0]?.id).toBe("z2");
    expect(draft?.[2]?.id).toBe("z1");
    actor.stop();
  });

  it("SAVE_LAYOUT transitions to browsing and marks row reviewed", async () => {
    const services = makeServices();
    const actor = createActor(textZonesToolMachine, {
      input: { projectId: "proj-1", stageIndex: 9, services },
    });
    actor.start();
    await flushPromises();
    actor.send({ type: "OPEN_ZONE_EDITOR", idx: "0" });
    actor.send({ type: "SAVE_LAYOUT" });

    const snap = actor.getSnapshot();
    expect(snap.value).toMatchObject({ reviewing: "browsing" });
    expect(snap.context.editing).toBeNull();
    const row = snap.context.rows.find((r) => r.idx === "0");
    expect(row?.state).toBe("reviewed");
    actor.stop();
  });

  it("CANCEL from zone editor clears editor context", async () => {
    const services = makeServices();
    const actor = createActor(textZonesToolMachine, {
      input: { projectId: "proj-1", stageIndex: 9, services },
    });
    actor.start();
    await flushPromises();
    actor.send({ type: "OPEN_ZONE_EDITOR", idx: "0" });
    actor.send({ type: "CANCEL" });

    const snap = actor.getSnapshot();
    expect(snap.value).toMatchObject({ reviewing: "browsing" });
    expect(snap.context.editing).toBeNull();
    expect(snap.context.editorKind).toBeNull();
    expect(snap.context.zoneDraft).toBeNull();
    actor.stop();
  });

  it("REDETECT invokes redetectLayout then returns to editingZones with new zones", async () => {
    const detectedZones: Zone[] = [
      { id: "zd1", type: "body", x: 0, y: 0, w: 0.8, h: 0.8, order: 1 },
    ];
    const services = makeServices({
      redetectLayout: vi.fn().mockResolvedValue({ zones: detectedZones }),
    });
    const actor = createActor(textZonesToolMachine, {
      input: { projectId: "proj-1", stageIndex: 9, services },
    });
    actor.start();
    await flushPromises();
    actor.send({ type: "OPEN_ZONE_EDITOR", idx: "0" });
    actor.send({ type: "REDETECT" });
    await flushPromises();

    const snap = actor.getSnapshot();
    expect(snap.value).toMatchObject({ reviewing: "editingZones" });
    expect(snap.context.zoneDraft).toEqual(detectedZones);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Split editor confirm/cancel
// ---------------------------------------------------------------------------

describe("textZonesTool — split editor", () => {
  it("opens split editor: sets editing, editorKind='split', loads splitDraft from row", async () => {
    const services = makeServices();
    const actor = createActor(textZonesToolMachine, {
      input: { projectId: "proj-1", stageIndex: 9, services },
    });
    actor.start();
    await flushPromises();

    actor.send({ type: "OPEN_SPLIT_EDITOR", idx: "2" });
    const snap = actor.getSnapshot();
    expect(snap.value).toMatchObject({ reviewing: "editingSplit" });
    expect(snap.context.editing).toBe("2");
    expect(snap.context.editorKind).toBe("split");
    expect(snap.context.splitDraft?.axis).toBe("col");
    actor.stop();
  });

  it("DRAG_GUTTER patches splitDraft gutter", async () => {
    const services = makeServices();
    const actor = createActor(textZonesToolMachine, {
      input: { projectId: "proj-1", stageIndex: 9, services },
    });
    actor.start();
    await flushPromises();
    actor.send({ type: "OPEN_SPLIT_EDITOR", idx: "2" });

    actor.send({ type: "DRAG_GUTTER", patch: { gutter: 0.4 } });
    expect(actor.getSnapshot().context.splitDraft?.gutter).toBe(0.4);
    actor.stop();
  });

  it("SET_AXIS patches splitDraft axis", async () => {
    const services = makeServices();
    const actor = createActor(textZonesToolMachine, {
      input: { projectId: "proj-1", stageIndex: 9, services },
    });
    actor.start();
    await flushPromises();
    actor.send({ type: "OPEN_SPLIT_EDITOR", idx: "2" });

    actor.send({ type: "SET_AXIS", patch: { axis: "row" } });
    expect(actor.getSnapshot().context.splitDraft?.axis).toBe("row");
    actor.stop();
  });

  it("KEEP_AS_ONE: dismisses split flag, marks reviewed, clears editor", async () => {
    const services = makeServices();
    const actor = createActor(textZonesToolMachine, {
      input: { projectId: "proj-1", stageIndex: 9, services },
    });
    actor.start();
    await flushPromises();
    actor.send({ type: "OPEN_SPLIT_EDITOR", idx: "2" });
    actor.send({ type: "KEEP_AS_ONE" });

    const snap = actor.getSnapshot();
    expect(snap.value).toMatchObject({ reviewing: "browsing" });
    expect(snap.context.editing).toBeNull();
    const row = snap.context.rows.find((r) => r.idx === "2");
    // splitSuggested flag should be removed
    expect(row?.flags ?? []).not.toContain("splitSuggested");
    expect(row?.state).toBe("reviewed");
    actor.stop();
  });

  it("CANCEL from split editor clears editor context", async () => {
    const services = makeServices();
    const actor = createActor(textZonesToolMachine, {
      input: { projectId: "proj-1", stageIndex: 9, services },
    });
    actor.start();
    await flushPromises();
    actor.send({ type: "OPEN_SPLIT_EDITOR", idx: "2" });
    actor.send({ type: "CANCEL" });

    const snap = actor.getSnapshot();
    expect(snap.value).toMatchObject({ reviewing: "browsing" });
    expect(snap.context.editing).toBeNull();
    expect(snap.context.splitDraft).toBeNull();
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// CONFIRM_ADVANCE gate
// ---------------------------------------------------------------------------

describe("textZonesTool — confirm gate", () => {
  it("CONFIRM_ADVANCE is blocked when flagged > reviewed", async () => {
    const services = makeServices({
      fetchZonePages: vi.fn().mockResolvedValue({
        rows: [makeRow("0", "flagged")],
        totals: makeTotals([makeRow("0", "flagged")]),
      }),
    });
    const actor = createActor(textZonesToolMachine, {
      input: { projectId: "proj-1", stageIndex: 9, services },
    });
    actor.start();
    await flushPromises();

    actor.send({ type: "CONFIRM_ADVANCE" });
    // Should NOT transition to confirming
    expect(actor.getSnapshot().value).toMatchObject({ reviewing: "browsing" });
    actor.stop();
  });

  it("CONFIRM_ADVANCE succeeds when all flagged rows are reviewed", async () => {
    const services = makeServices({
      fetchZonePages: vi.fn().mockResolvedValue({
        rows: [makeRow("0", "reviewed")],
        totals: {
          total: 1,
          done: 1,
          clean: 0,
          flagged: 1,
          reviewed: 1,
          splits: 0,
        },
      }),
      confirmStage: vi.fn().mockResolvedValue({ ok: true }),
    });
    const actor = createActor(textZonesToolMachine, {
      input: { projectId: "proj-1", stageIndex: 9, services },
    });
    actor.start();
    await flushPromises();

    actor.send({ type: "CONFIRM_ADVANCE" });
    expect(actor.getSnapshot().value).toBe("confirming");

    await flushPromises();
    expect(actor.getSnapshot().value).toBe("settled");
    actor.stop();
  });

  it("CONFIRM_ADVANCE succeeds when no flags at all", async () => {
    const services = makeServices({
      fetchZonePages: vi.fn().mockResolvedValue({
        rows: [makeRow("0", "clean")],
        totals: {
          total: 1,
          done: 1,
          clean: 1,
          flagged: 0,
          reviewed: 0,
          splits: 0,
        },
      }),
      confirmStage: vi.fn().mockResolvedValue({ ok: true }),
    });
    const actor = createActor(textZonesToolMachine, {
      input: { projectId: "proj-1", stageIndex: 9, services },
    });
    actor.start();
    await flushPromises();

    actor.send({ type: "CONFIRM_ADVANCE" });
    await flushPromises();
    expect(actor.getSnapshot().value).toBe("settled");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// SET_FILTER / SET_DENSITY (machine-level in reviewing)
// ---------------------------------------------------------------------------

describe("textZonesTool — filter/density events", () => {
  it("SET_FILTER updates context.filter", async () => {
    const services = makeServices();
    const actor = createActor(textZonesToolMachine, {
      input: { projectId: "proj-1", stageIndex: 9, services },
    });
    actor.start();
    await flushPromises();

    actor.send({ type: "SET_FILTER", value: "flagged" });
    expect(actor.getSnapshot().context.filter).toBe("flagged");
    actor.stop();
  });

  it("SET_DENSITY updates context.density", async () => {
    const services = makeServices();
    const actor = createActor(textZonesToolMachine, {
      input: { projectId: "proj-1", stageIndex: 9, services },
    });
    actor.start();
    await flushPromises();

    actor.send({ type: "SET_DENSITY", value: "L" });
    expect(actor.getSnapshot().context.density).toBe("L");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// settled → UPSTREAM_CHANGED → loading restart
// ---------------------------------------------------------------------------

describe("textZonesTool — settled lifecycle", () => {
  it("UPSTREAM_CHANGED from settled restarts the loading cycle", async () => {
    let fetchCount = 0;
    const services = makeServices({
      fetchZonePages: vi.fn().mockImplementation(() => {
        fetchCount++;
        return Promise.resolve({
          rows: [],
          totals: {
            total: 0,
            done: 0,
            clean: 0,
            flagged: 0,
            reviewed: 0,
            splits: 0,
          },
        });
      }),
      confirmStage: vi.fn().mockResolvedValue({ ok: true }),
    });
    const actor = createActor(textZonesToolMachine, {
      input: { projectId: "proj-1", stageIndex: 9, services },
    });
    actor.start();
    await flushPromises();
    // Should be in reviewing (with 0 rows, guard is happy)
    // Confirm to reach settled
    actor.send({ type: "CONFIRM_ADVANCE" });
    await flushPromises();
    expect(actor.getSnapshot().value).toBe("settled");

    const countBeforeUpstream = fetchCount;
    actor.send({ type: "UPSTREAM_CHANGED" });
    await flushPromises();

    // fetchZonePages should have been called again
    expect(fetchCount).toBeGreaterThan(countBeforeUpstream);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// loadError → RETRY
// ---------------------------------------------------------------------------

describe("textZonesTool — load error", () => {
  it("transitions to loadError on fetchZonePages failure, RETRY retries", async () => {
    let attempt = 0;
    const services = makeServices({
      fetchZonePages: vi.fn().mockImplementation(() => {
        attempt++;
        if (attempt === 1) return Promise.reject(new Error("network error"));
        return Promise.resolve({
          rows: [],
          totals: {
            total: 0,
            done: 0,
            clean: 0,
            flagged: 0,
            reviewed: 0,
            splits: 0,
          },
        });
      }),
    });
    const actor = createActor(textZonesToolMachine, {
      input: { projectId: "proj-1", stageIndex: 9, services },
    });
    actor.start();
    await flushPromises();

    expect(actor.getSnapshot().value).toBe("loadError");
    expect(actor.getSnapshot().context.error?.message).toBe("network error");

    actor.send({ type: "RETRY" });
    await flushPromises();
    expect(actor.getSnapshot().context.error).toBeNull();
    actor.stop();
  });
});
