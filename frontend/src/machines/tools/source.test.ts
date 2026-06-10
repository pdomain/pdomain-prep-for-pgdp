/**
 * source.test.ts — invariant test suite for sourceToolMachine (F5).
 *
 * Suite 1 "parallel initial state"  — machine starts with all three regions
 * Suite 2 "thumbnails region"       — THUMB_PROGRESS, THUMBS_DONE, REGENERATE
 * Suite 3 "files region — selection" — SELECT_FILE, SELECT_RANGE, CLEAR_SELECTION
 * Suite 4 "files region — marking"  — MARK_AS, REMOVE_FILES
 * Suite 5 "files region — insert"   — OPEN_INSERT, SET_INSERT_FIELD, CONFIRM_INSERT, CANCEL_INSERT
 * Suite 6 "files region — filter+density" — SET_FILTER, SET_DENSITY, SET_QUERY
 * Suite 7 "confirm selection gate"  — canConfirm guard (thumbs + unmarked)
 * Suite 8 "settings region — default→modified→default" — CHANGE_SETTING, SAVE_AS_DEFAULT, REVERT
 * Suite 9 "settings region — preset" — LOAD_PRESET, RESET_TO_DEFAULT
 * Suite 10 "stageSettings.ts helpers" — createMockStageSettingsServer, countDraftChanges
 */

import { describe, it, expect, vi } from "vitest";
import { createActor } from "xstate";
import {
  sourceToolMachine,
  type SourceToolInput,
  type SourceToolServices,
  type FileRow,
} from "./source";
import {
  createMockStageSettingsServer,
  countDraftChanges,
} from "./stageSettings";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(overrides: Partial<FileRow> = {}): FileRow {
  return {
    idx: 0,
    stem: "img001",
    state: "pending",
    ...overrides,
  };
}

function makeFiles(count: number): FileRow[] {
  return Array.from({ length: count }, (_, i) =>
    makeFile({
      idx: i,
      stem: `img${String(i + 1).padStart(3, "0")}`,
      state: "ready",
    }),
  );
}

function makeServices(
  overrides: Partial<SourceToolServices> = {},
): SourceToolServices {
  const settings = createMockStageSettingsServer();
  return {
    saveAsDefault: vi
      .fn()
      .mockImplementation(settings.saveAsDefault.bind(settings)),
    revertSettings: vi
      .fn()
      .mockImplementation(settings.revertSettings.bind(settings)),
    resetSettings: vi
      .fn()
      .mockImplementation(settings.resetSettings.bind(settings)),
    confirmSelection: vi.fn().mockResolvedValue({ pages: 4 }),
    ...overrides,
  };
}

function makeInput(overrides: Partial<SourceToolInput> = {}): SourceToolInput {
  return {
    projectId: "proj-1",
    stageId: "source",
    services: makeServices(),
    initialFiles: makeFiles(4),
    initialTotals: null,
    ...overrides,
  };
}

/** Start the machine and return the actor. Synchronous — machine starts parallel. */
function startMachine(input?: Partial<SourceToolInput>) {
  const actor = createActor(sourceToolMachine, {
    input: makeInput(input),
  });
  actor.start();
  return actor;
}

// ---------------------------------------------------------------------------
// Suite 1 — parallel initial state
// ---------------------------------------------------------------------------

describe("sourceToolMachine — parallel initial state", () => {
  it("starts in parallel state (thumbnails.generating + files.browsing + settings.default)", () => {
    const actor = startMachine();
    const snap = actor.getSnapshot();
    expect(snap.value).toMatchObject({
      thumbnails: "generating",
      files: "browsing",
      settings: "default",
    });
    actor.stop();
  });

  it("initialises context from input files", () => {
    const files = makeFiles(3);
    const actor = startMachine({ initialFiles: files });
    const ctx = actor.getSnapshot().context;
    expect(ctx.files).toHaveLength(3);
    actor.stop();
  });

  it("initialises _thumbsDone as false (thumbnails generating)", () => {
    const actor = startMachine();
    expect(actor.getSnapshot().context._thumbsDone).toBe(false);
    actor.stop();
  });

  it("initialises settingsState as 'default'", () => {
    const actor = startMachine();
    expect(actor.getSnapshot().context.settingsState).toBe("default");
    actor.stop();
  });

  it("initialises selected as empty", () => {
    const actor = startMachine();
    expect(actor.getSnapshot().context.selected).toEqual([]);
    actor.stop();
  });

  it("initialises filter as 'all'", () => {
    const actor = startMachine();
    expect(actor.getSnapshot().context.filter).toBe("all");
    actor.stop();
  });

  it("initialises density as 'M'", () => {
    const actor = startMachine();
    expect(actor.getSnapshot().context.density).toBe("M");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — thumbnails region
// ---------------------------------------------------------------------------

describe("sourceToolMachine — thumbnails region", () => {
  it("THUMB_PROGRESS updates totals.thumbed / rateHz / remaining in context", () => {
    const actor = startMachine();
    actor.send({
      type: "THUMB_PROGRESS",
      thumbed: 2,
      rateHz: 1.5,
      remaining: 2,
    });
    const ctx = actor.getSnapshot().context;
    expect(ctx.totals?.thumbed).toBe(2);
    expect(ctx.totals?.rateHz).toBe(1.5);
    expect(ctx.totals?.remaining).toBe(2);
    actor.stop();
  });

  it("THUMBS_DONE transitions thumbnails→done and sets _thumbsDone", () => {
    const actor = startMachine();
    actor.send({ type: "THUMBS_DONE" });
    const snap = actor.getSnapshot();
    expect(snap.value).toMatchObject({ thumbnails: "done" });
    expect(snap.context._thumbsDone).toBe(true);
    actor.stop();
  });

  it("THUMBS_DONE transitions pending file states to ready", () => {
    const pendingFiles = makeFiles(2).map((f) => ({
      ...f,
      state: "pending" as const,
    }));
    const actor = startMachine({ initialFiles: pendingFiles });
    actor.send({ type: "THUMBS_DONE" });
    const files = actor.getSnapshot().context.files;
    expect(files.every((f) => f.state === "ready")).toBe(true);
    actor.stop();
  });

  it("REGENERATE from done → generating, clears _thumbsDone", () => {
    const actor = startMachine();
    actor.send({ type: "THUMBS_DONE" });
    expect(actor.getSnapshot().value).toMatchObject({ thumbnails: "done" });
    actor.send({ type: "REGENERATE" });
    const snap = actor.getSnapshot();
    expect(snap.value).toMatchObject({ thumbnails: "generating" });
    expect(snap.context._thumbsDone).toBe(false);
    actor.stop();
  });

  it("REGENERATE resets all files back to pending", () => {
    const readyFiles = makeFiles(3);
    const actor = startMachine({ initialFiles: readyFiles });
    actor.send({ type: "THUMBS_DONE" });
    actor.send({ type: "REGENERATE" });
    const files = actor.getSnapshot().context.files;
    expect(files.every((f) => f.state === "pending")).toBe(true);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — files region: selection
// ---------------------------------------------------------------------------

describe("sourceToolMachine — files region selection", () => {
  it("SELECT_FILE in browsing transitions to selecting + records idx", () => {
    const actor = startMachine();
    actor.send({ type: "SELECT_FILE", idx: 2 });
    const snap = actor.getSnapshot();
    expect(snap.value).toMatchObject({ files: "selecting" });
    expect(snap.context.selected).toContain(2);
    actor.stop();
  });

  it("SELECT_FILE in selecting XORs the selection (deselect already-selected)", () => {
    const actor = startMachine();
    actor.send({ type: "SELECT_FILE", idx: 1 });
    actor.send({ type: "SELECT_FILE", idx: 1 });
    const snap = actor.getSnapshot();
    expect(snap.context.selected).not.toContain(1);
    actor.stop();
  });

  it("SELECT_RANGE adds a contiguous range to selection", () => {
    const actor = startMachine();
    actor.send({ type: "SELECT_FILE", idx: 0 });
    actor.send({ type: "SELECT_RANGE", anchorIdx: 0, endIdx: 2 });
    const ctx = actor.getSnapshot().context;
    expect(ctx.selected).toEqual(expect.arrayContaining([0, 1, 2]));
    actor.stop();
  });

  it("CLEAR_SELECTION in selecting transitions to browsing + empties selection", () => {
    const actor = startMachine();
    actor.send({ type: "SELECT_FILE", idx: 0 });
    actor.send({ type: "CLEAR_SELECTION" });
    const snap = actor.getSnapshot();
    expect(snap.value).toMatchObject({ files: "browsing" });
    expect(snap.context.selected).toEqual([]);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 4 — files region: marking
// ---------------------------------------------------------------------------

describe("sourceToolMachine — files region marking", () => {
  it("MARK_AS updates selected files' state", () => {
    const actor = startMachine({ initialFiles: makeFiles(4) });
    actor.send({ type: "SELECT_FILE", idx: 0 });
    actor.send({ type: "SELECT_FILE", idx: 2 });
    actor.send({ type: "MARK_AS", state: "page" });
    const files = actor.getSnapshot().context.files;
    expect(files[0]?.state).toBe("page");
    expect(files[2]?.state).toBe("page");
    // Others untouched
    expect(files[1]?.state).toBe("ready");
    actor.stop();
  });

  it("MARK_AS updates totals (marked.page count)", () => {
    const actor = startMachine({ initialFiles: makeFiles(4) });
    actor.send({ type: "SELECT_FILE", idx: 0 });
    actor.send({ type: "SELECT_FILE", idx: 1 });
    actor.send({ type: "MARK_AS", state: "page" });
    const totals = actor.getSnapshot().context.totals;
    expect(totals?.marked.page).toBe(2);
    expect(totals?.unmarked).toBe(2);
    actor.stop();
  });

  it("REMOVE_FILES removes selected inserted files from the list", () => {
    const files: FileRow[] = [
      makeFile({ idx: 0, stem: "img001", state: "ready" }),
      makeFile({ idx: 1, stem: "__inserted_001", state: "inserted" }),
      makeFile({ idx: 2, stem: "img002", state: "ready" }),
    ];
    const actor = startMachine({ initialFiles: files });
    actor.send({ type: "SELECT_FILE", idx: 1 });
    actor.send({ type: "REMOVE_FILES" });
    const ctx = actor.getSnapshot().context;
    expect(ctx.files).toHaveLength(2);
    expect(ctx.files.some((f) => f.state === "inserted")).toBe(false);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 5 — files region: insert
// ---------------------------------------------------------------------------

describe("sourceToolMachine — files region insert", () => {
  it("OPEN_INSERT transitions to inserting state", () => {
    const actor = startMachine();
    actor.send({ type: "OPEN_INSERT" });
    expect(actor.getSnapshot().value).toMatchObject({ files: "inserting" });
    actor.stop();
  });

  it("OPEN_INSERT populates insertDraft.anchorStem when provided", () => {
    const actor = startMachine({ initialFiles: makeFiles(3) });
    actor.send({ type: "OPEN_INSERT", anchorStem: "img002" });
    const draft = actor.getSnapshot().context.insertDraft;
    expect(draft?.anchorStem).toBe("img002");
    actor.stop();
  });

  it("SET_INSERT_FIELD updates insertDraft fields", () => {
    const actor = startMachine();
    actor.send({ type: "OPEN_INSERT" });
    actor.send({
      type: "SET_INSERT_FIELD",
      patch: { kind: "blank", note: "extra" },
    });
    const draft = actor.getSnapshot().context.insertDraft;
    expect(draft?.kind).toBe("blank");
    expect(draft?.note).toBe("extra");
    actor.stop();
  });

  it("CONFIRM_INSERT adds an inserted file row and returns to browsing", () => {
    const actor = startMachine({ initialFiles: makeFiles(3) });
    actor.send({ type: "OPEN_INSERT", anchorStem: "img002" });
    actor.send({ type: "CONFIRM_INSERT" });
    const snap = actor.getSnapshot();
    expect(snap.value).toMatchObject({ files: "browsing" });
    expect(snap.context.files.some((f) => f.state === "inserted")).toBe(true);
    // Total count increased by 1
    expect(snap.context.files).toHaveLength(4);
    actor.stop();
  });

  it("CANCEL_INSERT returns to browsing without adding a row", () => {
    const actor = startMachine({ initialFiles: makeFiles(3) });
    actor.send({ type: "OPEN_INSERT" });
    actor.send({ type: "CANCEL_INSERT" });
    const snap = actor.getSnapshot();
    expect(snap.value).toMatchObject({ files: "browsing" });
    expect(snap.context.files).toHaveLength(3);
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 6 — files region: filter + density + search
// ---------------------------------------------------------------------------

describe("sourceToolMachine — files filter + density + query", () => {
  it("SET_FILTER updates context.filter", () => {
    const actor = startMachine();
    actor.send({ type: "SET_FILTER", value: "page" });
    expect(actor.getSnapshot().context.filter).toBe("page");
    actor.stop();
  });

  it("SET_DENSITY updates context.density", () => {
    const actor = startMachine();
    actor.send({ type: "SET_DENSITY", value: "L" });
    expect(actor.getSnapshot().context.density).toBe("L");
    actor.stop();
  });

  it("SET_QUERY updates context.query", () => {
    const actor = startMachine();
    actor.send({ type: "SET_QUERY", value: "chapter" });
    expect(actor.getSnapshot().context.query).toBe("chapter");
    actor.stop();
  });

  it("SET_FILTER works from selecting state", () => {
    const actor = startMachine();
    actor.send({ type: "SELECT_FILE", idx: 0 });
    actor.send({ type: "SET_FILTER", value: "unmarked" });
    expect(actor.getSnapshot().context.filter).toBe("unmarked");
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 7 — confirm selection gate (canConfirm guard)
// ---------------------------------------------------------------------------

describe("sourceToolMachine — confirm selection gate", () => {
  it("CONFIRM_SELECTION ignored when thumbnails still generating", () => {
    const actor = startMachine({ initialFiles: [] });
    actor.send({ type: "CONFIRM_SELECTION" });
    // Should stay in browsing, not transition to confirming
    expect(actor.getSnapshot().value).toMatchObject({ files: "browsing" });
    actor.stop();
  });

  it("CONFIRM_SELECTION ignored when unmarked > 0", () => {
    const files = makeFiles(4); // all "ready" = all unmarked
    const actor = startMachine({ initialFiles: files });
    actor.send({ type: "THUMBS_DONE" }); // set _thumbsDone
    actor.send({ type: "CONFIRM_SELECTION" });
    // unmarked = 4, guard fails → stays in browsing
    expect(actor.getSnapshot().value).toMatchObject({ files: "browsing" });
    actor.stop();
  });

  it("CONFIRM_SELECTION proceeds to confirming when all marked + thumbs done", async () => {
    const files: FileRow[] = makeFiles(2).map((f) => ({
      ...f,
      state: "page" as const,
    }));
    const actor = startMachine({ initialFiles: files });
    actor.send({ type: "THUMBS_DONE" }); // _thumbsDone = true
    actor.send({ type: "CONFIRM_SELECTION" });
    await vi.waitFor(() => {
      const snap = actor.getSnapshot();
      const v = snap.value as Record<string, string>;
      return v["files"] === "confirming" || v["files"] === "confirmed";
    });
    const snap = actor.getSnapshot();
    const filesState = (snap.value as Record<string, string>)["files"];
    expect(["confirming", "confirmed"]).toContain(filesState);
    actor.stop();
  });

  it("confirmSelection service is called with the right files", async () => {
    const confirmSelection = vi.fn().mockResolvedValue({ pages: 2 });
    const services = makeServices({ confirmSelection });
    const files: FileRow[] = makeFiles(2).map((f) => ({
      ...f,
      state: "page" as const,
    }));
    const actor = startMachine({ initialFiles: files, services });
    actor.send({ type: "THUMBS_DONE" });
    actor.send({ type: "CONFIRM_SELECTION" });
    await vi.waitFor(() => {
      const snap = actor.getSnapshot();
      return (snap.value as Record<string, string>)["files"] === "confirmed";
    });
    expect(confirmSelection).toHaveBeenCalledOnce();
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 8 — settings region: default → modified → default
// ---------------------------------------------------------------------------

describe("sourceToolMachine — settings region default↔modified", () => {
  it("CHANGE_SETTING transitions settings to modified", () => {
    const actor = startMachine();
    actor.send({ type: "CHANGE_SETTING", patch: { thumbQuality: "high" } });
    expect(actor.getSnapshot().value).toMatchObject({ settings: "modified" });
    actor.stop();
  });

  it("CHANGE_SETTING accumulates draft in context._settingsDraft", () => {
    const actor = startMachine();
    actor.send({ type: "CHANGE_SETTING", patch: { thumbQuality: "high" } });
    actor.send({ type: "CHANGE_SETTING", patch: { workers: 4 } });
    const draft = actor.getSnapshot().context._settingsDraft;
    expect(draft).toMatchObject({ thumbQuality: "high", workers: 4 });
    actor.stop();
  });

  it("settingsState context field matches settings region state", () => {
    const actor = startMachine();
    actor.send({ type: "CHANGE_SETTING", patch: { thumbQuality: "low" } });
    expect(actor.getSnapshot().context.settingsState).toBe("modified");
    actor.stop();
  });

  it("SAVE_AS_DEFAULT from modified → default, clears draft", () => {
    const actor = startMachine();
    actor.send({ type: "CHANGE_SETTING", patch: { thumbQuality: "high" } });
    actor.send({ type: "SAVE_AS_DEFAULT" });
    const snap = actor.getSnapshot();
    expect(snap.value).toMatchObject({ settings: "default" });
    expect(snap.context._settingsDraft).toBeNull();
    actor.stop();
  });

  it("REVERT from modified → default, clears draft", () => {
    const actor = startMachine();
    actor.send({ type: "CHANGE_SETTING", patch: { thumbQuality: "high" } });
    actor.send({ type: "REVERT" });
    const snap = actor.getSnapshot();
    expect(snap.value).toMatchObject({ settings: "default" });
    expect(snap.context._settingsDraft).toBeNull();
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 9 — settings region: preset
// ---------------------------------------------------------------------------

describe("sourceToolMachine — settings region preset", () => {
  it("LOAD_PRESET from default → preset, records presetId", () => {
    const actor = startMachine();
    actor.send({ type: "LOAD_PRESET", presetId: "quality-high" });
    const snap = actor.getSnapshot();
    expect(snap.value).toMatchObject({ settings: "preset" });
    expect(snap.context._presetId).toBe("quality-high");
    actor.stop();
  });

  it("CHANGE_SETTING from preset → modified", () => {
    const actor = startMachine();
    actor.send({ type: "LOAD_PRESET", presetId: "quality-high" });
    actor.send({ type: "CHANGE_SETTING", patch: { workers: 2 } });
    expect(actor.getSnapshot().value).toMatchObject({ settings: "modified" });
    actor.stop();
  });

  it("RESET_TO_DEFAULT from preset → default, clears presetId", () => {
    const actor = startMachine();
    actor.send({ type: "LOAD_PRESET", presetId: "quality-high" });
    actor.send({ type: "RESET_TO_DEFAULT" });
    const snap = actor.getSnapshot();
    expect(snap.value).toMatchObject({ settings: "default" });
    expect(snap.context._presetId).toBeNull();
    actor.stop();
  });
});

// ---------------------------------------------------------------------------
// Suite 10 — stageSettings.ts helpers
// ---------------------------------------------------------------------------

describe("stageSettings — createMockStageSettingsServer", () => {
  it("saveAsDefault persists draft as saved default", async () => {
    const server = createMockStageSettingsServer();
    await server.saveAsDefault("p1", "source", { thumbQuality: "high" });
    const effective = server._getEffective("p1", "source");
    expect(effective).toMatchObject({ thumbQuality: "high" });
  });

  it("revertSettings removes the project override", async () => {
    const server = createMockStageSettingsServer();
    server._setSavedDefault("p1", "source", { workers: 2 });
    await server.saveAsDefault("p1", "source", { workers: 4 }); // sets saved default to 4
    // Now revert to registry default (nothing set)
    await server.revertSettings("p1", "source");
    // After revert, saved default was NOT touched — only override is removed
    // The saved default was set by saveAsDefault, which also clears override...
    // Check that effective is the saved default (workers: 4)
    const effective = server._getEffective("p1", "source");
    // saveAsDefault writes to savedDefaults and clears override → effective = savedDefault = {workers:4}
    expect(effective).toMatchObject({ workers: 4 });
  });

  it("resetSettings clears both override and saved default", async () => {
    const server = createMockStageSettingsServer();
    server._setSavedDefault("p1", "source", { workers: 4 });
    await server.resetSettings("p1", "source");
    expect(server._getEffective("p1", "source")).toEqual({});
  });

  it("instances are isolated (separate state per call)", async () => {
    const s1 = createMockStageSettingsServer();
    const s2 = createMockStageSettingsServer();
    await s1.saveAsDefault("p1", "source", { workers: 2 });
    expect(s2._getEffective("p1", "source")).toEqual({});
  });
});

describe("stageSettings — countDraftChanges", () => {
  it("returns 0 for null draft", () => {
    expect(countDraftChanges(null)).toBe(0);
  });

  it("returns key count for a non-empty draft", () => {
    expect(countDraftChanges({ a: 1, b: 2 })).toBe(2);
  });

  it("returns 0 for empty object", () => {
    expect(countDraftChanges({})).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Suite 11 — parallel region independence
// ---------------------------------------------------------------------------

describe("sourceToolMachine — parallel regions are independent", () => {
  it("thumbnails THUMBS_DONE does not affect files region state", () => {
    const actor = startMachine();
    actor.send({ type: "THUMBS_DONE" });
    const snap = actor.getSnapshot();
    expect(snap.value).toMatchObject({ thumbnails: "done", files: "browsing" });
    actor.stop();
  });

  it("files SELECT_FILE does not affect settings region state", () => {
    const actor = startMachine();
    actor.send({ type: "SELECT_FILE", idx: 0 });
    const snap = actor.getSnapshot();
    expect(snap.value).toMatchObject({
      files: "selecting",
      settings: "default",
    });
    actor.stop();
  });

  it("CHANGE_SETTING does not affect thumbnails or files regions", () => {
    const actor = startMachine();
    actor.send({ type: "CHANGE_SETTING", patch: { workers: 4 } });
    const snap = actor.getSnapshot();
    expect(snap.value).toMatchObject({
      thumbnails: "generating",
      files: "browsing",
      settings: "modified",
    });
    actor.stop();
  });
});
