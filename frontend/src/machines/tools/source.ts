/**
 * sourceToolMachine — XState v5 machine for the Source-stage tool.
 *
 * Ported mechanically from
 * `docs/plans/design_handoff_pgdp_app/statecharts/tool-source.yaml`.
 *
 * Three parallel regions:
 *   1. thumbnails  — generation job (skeleton + progress banner) gates Confirm
 *   2. files       — marking UX: filter/density/search, multi-select + BulkBar,
 *                    insert-page dialog, guarded "Confirm selection" advance
 *   3. settings    — settings-inheritance banner (default|modified|preset)
 *                    reused by all other stage tools via stageSettings.ts
 *
 * ## Divergences
 *   F5-1 — recorded in DIVERGENCES.md
 *   F5-2 — `canConfirm` reads `context.settingsState` via machine-level context
 *           mirror (not via snapshot.matches) — see below.
 *   F5-3 — `confirmSelection` actor is the only invoke.src; thumb-progress and
 *           insert mutations are modelled as synchronous assign actions (no
 *           server round-trips at F5 — they'll flip to real calls at I1).
 *   F5-4 — `thumbnailsRegionIn` guard in the YAML reads a parallel region state;
 *           in XState v5 we mirror it as `context._thumbsDone: boolean`.
 *   F5-5 — `recountTotals` is NOT a separate action; it is folded into the
 *           preceding assign that mutates files/marks (DIVERGENCES.md #9).
 *
 * @see docs/plans/design_handoff_pgdp_app/statecharts/tool-source.yaml
 * @see src/machines/tools/stageSettings.ts — reusable settings region
 * @see src/machines/DIVERGENCES.md — F5-1 through F5-5
 */

import { setup, assign, fromPromise } from "xstate";
import {
  stageSettingsActors,
  STAGE_SETTINGS_INITIAL,
  type StageSettingsContext,
  type StageSettingsEvent,
  type StageSettingsServices,
  type StageSettingsState,
} from "./stageSettings";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type FileState =
  | "pending" // thumbnail not yet generated
  | "ready" // thumbnail done, unmarked
  | "page" // body page
  | "cover" // front cover / endpapers
  | "back" // back matter
  | "blank" // blank scan
  | "duplicate" // duplicate file
  | "inserted"; // synthetic inserted page

export type InsertKind = "missing" | "blank" | "errata" | "manual";

export interface FileRow {
  idx: number;
  stem: string;
  state: FileState;
  pageNumber?: string;
  kind?: InsertKind;
  note?: string;
  tone?: "light" | "mid" | "dark";
  hue?: number;
}

export interface FileTotals {
  files: number;
  thumbed: number;
  rateHz: number;
  remaining: number;
  marked: {
    page: number;
    cover: number;
    back: number;
    blank: number;
    duplicate: number;
    inserted: number;
  };
  unmarked: number;
}

export type FileFilter = "all" | "page" | "skipped" | "unmarked" | "inserts";
export type FileDensity = "S" | "M" | "L";

export interface InsertDraft {
  anchorStem: string | null;
  position: "before" | "after";
  kind: InsertKind;
  note: string;
  image: null; // image upload deferred to I1
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface SourceToolContext extends StageSettingsContext {
  projectId: string;
  stageId: string;
  services: SourceToolServices;

  // --- thumbnails region ---
  /** DIVERGENCE F5-4: mirrors thumbnails sub-state to enable canConfirm guard. */
  _thumbsDone: boolean;

  // --- files region ---
  files: FileRow[];
  totals: FileTotals | null;
  filter: FileFilter;
  density: FileDensity;
  query: string;
  selected: number[]; // idx[]
  insertDraft: InsertDraft | null;

  // --- shared ---
  error: string | null;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface SourceToolInput {
  projectId: string;
  stageId: string;
  services: SourceToolServices;
  /** Optional initial files (from a previous snapshot — injected at I1). */
  initialFiles?: FileRow[];
  /** Optional initial totals. */
  initialTotals?: FileTotals | null;
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export interface SourceToolServices extends StageSettingsServices {
  /**
   * POST /api/projects/:id/stages/source/confirm
   * Commits the page set; resolves with { pages: N }.
   */
  confirmSelection(
    projectId: string,
    files: FileRow[],
  ): Promise<{ pages: number }>;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** Events from the files region. */
export type FilesRegionEvent =
  | { type: "SELECT_FILE"; idx: number }
  | { type: "SELECT_RANGE"; anchorIdx: number; endIdx: number }
  | { type: "CLEAR_SELECTION" }
  | { type: "MARK_AS"; state: FileState }
  | { type: "REMOVE_FILES" }
  | { type: "SET_FILTER"; value: FileFilter }
  | { type: "SET_DENSITY"; value: FileDensity }
  | { type: "SET_QUERY"; value: string }
  | { type: "OPEN_INSERT"; anchorStem?: string }
  | { type: "SET_INSERT_FIELD"; patch: Partial<InsertDraft> }
  | { type: "CONFIRM_INSERT" }
  | { type: "CANCEL_INSERT" }
  | { type: "SET_ROLE"; idx: number; role: FileState }
  | { type: "CONFIRM_SELECTION" };

/** Events from the thumbnails region. */
export type ThumbnailsRegionEvent =
  | {
      type: "THUMB_PROGRESS";
      thumbed: number;
      rateHz: number;
      remaining: number;
    }
  | { type: "THUMBS_DONE" }
  | { type: "REGENERATE" };

export type SourceToolEvent =
  | FilesRegionEvent
  | ThumbnailsRegionEvent
  | StageSettingsEvent;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function recount(files: FileRow[]): FileTotals {
  const marked = {
    page: 0,
    cover: 0,
    back: 0,
    blank: 0,
    duplicate: 0,
    inserted: 0,
  };
  let thumbed = 0;
  let unmarked = 0;

  for (const f of files) {
    if (f.state !== "pending") thumbed++;
    if (f.state === "ready") unmarked++;
    if (f.state in marked) {
      const m = marked as Record<string, number>;
      m[f.state] = (m[f.state] ?? 0) + 1;
    }
  }

  return {
    files: files.length,
    thumbed,
    rateHz: 0,
    remaining: files.length - thumbed,
    marked,
    unmarked,
  };
}

function xorSelection(selected: number[], idx: number): number[] {
  if (selected.includes(idx)) {
    return selected.filter((i) => i !== idx);
  }
  return [...selected, idx];
}

function rangeSelection(
  selected: number[],
  anchorIdx: number,
  endIdx: number,
): number[] {
  const lo = Math.min(anchorIdx, endIdx);
  const hi = Math.max(anchorIdx, endIdx);
  const range: number[] = [];
  for (let i = lo; i <= hi; i++) range.push(i);
  // Union with existing selection
  return Array.from(new Set([...selected, ...range]));
}

function insertAt(files: FileRow[], draft: InsertDraft): FileRow[] {
  const anchorIdx = draft.anchorStem
    ? files.findIndex((f) => f.stem === draft.anchorStem)
    : files.length - 1;
  const insertAfter = draft.position === "after" ? anchorIdx : anchorIdx - 1;

  const newFile: FileRow = {
    idx: files.length,
    stem: `__inserted_${String(files.filter((f) => f.state === "inserted").length + 1).padStart(3, "0")}`,
    state: "inserted",
    kind: draft.kind,
    ...(draft.note ? { note: draft.note } : {}),
  };

  const result = [...files];
  result.splice(insertAfter + 1, 0, newFile);
  // Re-index
  return result.map((f, i) => ({ ...f, idx: i }));
}

// ---------------------------------------------------------------------------
// Machine
// ---------------------------------------------------------------------------

export const sourceToolMachine = setup({
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  types: {} as {
    context: SourceToolContext;
    events: SourceToolEvent;
    input: SourceToolInput;
  },

  actors: {
    /**
     * YAML: services.confirmSelection
     * POST /api/projects/:id/stages/source/confirm -> { pages: N }
     */
    confirmSelection: fromPromise<
      { pages: number },
      { projectId: string; files: FileRow[]; services: SourceToolServices }
    >(({ input }) =>
      input.services.confirmSelection(input.projectId, input.files),
    ),

    // --- settings actors (reused from stageSettings.ts) ---
    ...stageSettingsActors,
  },

  guards: {
    /**
     * YAML: canConfirm: ctx.totals.unmarked === 0 && thumbnailsRegionIn('done')
     *
     * DIVERGENCE F5-4: `thumbnailsRegionIn('done')` is mirrored via
     * `context._thumbsDone` because XState v5 guards cannot read parallel
     * sub-state without a snapshot traversal. `_thumbsDone` is set by
     * `markAllThumbed` and cleared by `requestRegenerate`.
     *
     * DIVERGENCE F5-2: totals may be null during initial load. Guard returns
     * false if totals is null (Confirm stays disabled).
     */
    canConfirm: ({ context }: { context: SourceToolContext }) => {
      if (!context.totals) return false;
      return context.totals.unmarked === 0 && context._thumbsDone;
    },
  },

  actions: {
    // ---- thumbnails region actions ------------------------------------------

    /**
     * YAML: assignThumbProgress
     * Updates thumbed / rateHz / remaining in totals.
     * DIVERGENCE F5-5: folds totals update inline (no separate recountTotals call).
     *
     * Uses the params-extractor pattern (called via { type, params } in transitions).
     */
    assignThumbProgress: assign(
      (
        { context }: { context: SourceToolContext },
        params: { thumbed: number; rateHz: number; remaining: number },
      ) => ({
        totals: context.totals
          ? {
              ...context.totals,
              thumbed: params.thumbed,
              rateHz: params.rateHz,
              remaining: params.remaining,
            }
          : null,
      }),
    ) as never,

    /**
     * YAML: markAllThumbed
     * Transitions pending→ready; sets _thumbsDone = true.
     * DIVERGENCE F5-4: also sets _thumbsDone to enable canConfirm guard.
     */
    markAllThumbed: assign({
      files: ({ context }: { context: SourceToolContext }) =>
        context.files.map(
          (f): FileRow =>
            f.state === "pending" ? { ...f, state: "ready" } : f,
        ),
      _thumbsDone: () => true as const,
      totals: ({ context }: { context: SourceToolContext }) => {
        const files = context.files.map(
          (f): FileRow =>
            f.state === "pending" ? { ...f, state: "ready" } : f,
        );
        return recount(files);
      },
    }),

    /**
     * YAML: requestRegenerate — side effect only (POST regenerate-thumbnails).
     * Clears _thumbsDone so canConfirm is re-blocked until THUMBS_DONE.
     */
    requestRegenerate: assign({
      _thumbsDone: () => false as const,
      totals: ({ context }: { context: SourceToolContext }) =>
        context.totals
          ? {
              ...context.totals,
              thumbed: 0,
              rateHz: 0,
              remaining: context.totals.files,
            }
          : null,
      files: ({ context }: { context: SourceToolContext }) =>
        context.files.map((f): FileRow => ({ ...f, state: "pending" })),
    }),

    // ---- files region actions -----------------------------------------------

    /**
     * YAML: assignFilter — reads event.value directly.
     */
    assignFilter: assign({
      filter: ({ event }: { event: SourceToolEvent }) => {
        if (event.type !== "SET_FILTER") return "all";
        return event.value;
      },
    }),

    /**
     * YAML: assignDensity — reads event.value directly.
     */
    assignDensity: assign({
      density: ({ event }: { event: SourceToolEvent }) => {
        if (event.type !== "SET_DENSITY") return "M";
        return event.value;
      },
    }),

    /**
     * YAML: assignQuery — reads event.value directly.
     */
    assignQuery: assign({
      query: ({ event }: { event: SourceToolEvent }) => {
        if (event.type !== "SET_QUERY") return "";
        return event.value;
      },
    }),

    /**
     * YAML: addToSelection — click starts a new single-item selection.
     */
    addToSelection: assign({
      selected: ({ event }: { event: SourceToolEvent }) => {
        if (event.type !== "SELECT_FILE") return [] as number[];
        return [event.idx];
      },
    }),

    /**
     * YAML: toggleSelection — subsequent click toggles.
     */
    toggleSelection: assign({
      selected: ({
        context,
        event,
      }: {
        context: SourceToolContext;
        event: SourceToolEvent;
      }) => {
        if (event.type !== "SELECT_FILE") return context.selected;
        return xorSelection(context.selected, event.idx);
      },
    }),

    /**
     * YAML: addRangeToSelection — shift+click extends.
     */
    addRangeToSelection: assign({
      selected: ({
        context,
        event,
      }: {
        context: SourceToolContext;
        event: SourceToolEvent;
      }) => {
        if (event.type !== "SELECT_RANGE") return context.selected;
        return rangeSelection(context.selected, event.anchorIdx, event.endIdx);
      },
    }),

    /**
     * YAML: emptySelection
     */
    emptySelection: assign({ selected: () => [] as number[] }),

    /**
     * YAML: markSelected + recountTotals (folded — DIVERGENCES #9).
     */
    markSelected: assign(
      ({
        context,
        event,
      }: {
        context: SourceToolContext;
        event: SourceToolEvent;
      }) => {
        if (event.type !== "MARK_AS") return {};
        const files = context.files.map((f) =>
          context.selected.includes(f.idx) ? { ...f, state: event.state } : f,
        );
        return { files, totals: recount(files) };
      },
    ),

    /**
     * YAML: assignRole + recountTotals (folded — DIVERGENCES #9).
     * Single-page variant used from the workbench role segment.
     */
    assignRole: assign(
      ({
        context,
        event,
      }: {
        context: SourceToolContext;
        event: SourceToolEvent;
      }) => {
        if (event.type !== "SET_ROLE") return {};
        const files = context.files.map((f) =>
          f.idx === event.idx ? { ...f, state: event.role } : f,
        );
        return { files, totals: recount(files) };
      },
    ),

    /**
     * YAML: removeSelected + recountTotals (folded — DIVERGENCES #9).
     */
    removeSelected: assign(({ context }: { context: SourceToolContext }) => {
      const files = context.files.filter(
        (f) => !context.selected.includes(f.idx),
      );
      return { files, selected: [] as number[], totals: recount(files) };
    }),

    /**
     * YAML: beginInsertDraft
     */
    beginInsertDraft: assign({
      insertDraft: ({ event }: { event: SourceToolEvent }): InsertDraft => {
        const anchorStem =
          event.type === "OPEN_INSERT" ? (event.anchorStem ?? null) : null;
        return {
          anchorStem,
          position: "after",
          kind: "missing",
          note: "",
          image: null,
        };
      },
    }),

    /**
     * YAML: patchInsertDraft
     */
    patchInsertDraft: assign({
      insertDraft: ({
        context,
        event,
      }: {
        context: SourceToolContext;
        event: SourceToolEvent;
      }) => {
        if (event.type !== "SET_INSERT_FIELD" || !context.insertDraft)
          return context.insertDraft;
        return { ...context.insertDraft, ...event.patch };
      },
    }),

    /**
     * YAML: createInsertedRow + recountTotals + clearInsertDraft (folded).
     */
    createInsertedRow: assign(({ context }: { context: SourceToolContext }) => {
      if (!context.insertDraft) return {};
      const files = insertAt(context.files, context.insertDraft);
      return { files, insertDraft: null, totals: recount(files) };
    }),

    /**
     * YAML: clearInsertDraft
     */
    clearInsertDraft: assign({ insertDraft: () => null }),

    /**
     * YAML: assignError (from onError in confirmSelection invoke).
     */
    assignError: assign(
      (_: { context: SourceToolContext }, params: { error: string }) => ({
        error: params.error,
      }),
    ) as never,

    /**
     * YAML: emitStageComplete
     * Signals the parent pipelineShell that source is confirmed.
     * At F5 this is a log-only side effect; at I1 pipelineShell routes the
     * STAGE_COMPLETED event.
     */
    emitStageComplete: (_: { context: SourceToolContext }) => {
      // Side effect only — pipelineShell parent listens via STAGE_COMPLETED
      // This will be wired as sendTo(parentActor) at I1.
    },

    // --- settings actions ---
    // Inline definitions typed to SourceToolContext / SourceToolEvent.
    // Shared logic lives in makeStageSettingsActions() in stageSettings.ts,
    // but XState v5's phantom-type markers on ActionFunction prevent spreading
    // generically-typed actions into a machine with a different (even extending)
    // context/event pair — see DIVERGENCES.md F5-1.
    //
    // These mirror makeStageSettingsActions() exactly; keep in sync with it.

    /** Merges event.patch into _settingsDraft. */
    recordSettingChange: assign(
      ({
        context,
        event,
      }: {
        context: SourceToolContext;
        event: SourceToolEvent;
      }) => {
        if (event.type !== "CHANGE_SETTING") return {};
        return {
          _settingsDraft: { ...(context._settingsDraft ?? {}), ...event.patch },
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
          settingsState: "modified" as StageSettingsState,
        };
      },
    ),

    /** Records the chosen preset ID. */
    assignPreset: assign(
      ({ event }: { context: SourceToolContext; event: SourceToolEvent }) => {
        if (event.type !== "LOAD_PRESET") return {};
        return {
          _presetId: event.presetId,
          _settingsDraft: null,
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
          settingsState: "preset" as StageSettingsState,
        };
      },
    ),

    /** Clears draft; returns to default. */
    revertSettingsAction: assign({
      _settingsDraft: (): null => null,
      _presetId: (): null => null,
      settingsState: (): StageSettingsState => "default",
    }),

    /** Called after save-as-default resolves. */
    onSavedAsDefault: assign({
      _settingsDraft: (): null => null,
      _presetId: (): null => null,
      settingsState: (): StageSettingsState => "default",
    }),

    /** Called on SAVE_AS_PRESET. */
    onSavedAsPreset: assign({
      _settingsDraft: (): null => null,
      _presetId: ({ context }: { context: SourceToolContext }) =>
        context._presetId,
      settingsState: (): StageSettingsState => "preset",
    }),

    enterSettingsDefault: assign({
      settingsState: (): StageSettingsState => "default",
    }),
    enterSettingsModified: assign({
      settingsState: (): StageSettingsState => "modified",
    }),
    enterSettingsPreset: assign({
      settingsState: (): StageSettingsState => "preset",
    }),
  },
}).createMachine({
  id: "sourceTool",

  // YAML: type: parallel
  type: "parallel",

  context: ({ input }: { input: SourceToolInput }) => {
    const files = input.initialFiles ?? [];
    return {
      projectId: input.projectId,
      stageId: input.stageId,
      services: input.services,
      // thumbnails
      _thumbsDone: false,
      // files
      files,
      totals: files.length > 0 ? recount(files) : null,
      filter: "all",
      density: "M",
      query: "",
      selected: [] as number[],
      insertDraft: null,
      // error
      error: null,
      // settings (from stageSettings.ts)
      ...STAGE_SETTINGS_INITIAL,
    };
  },

  states: {
    // ---- Region: thumbnails -------------------------------------------------
    thumbnails: {
      initial: "generating",
      states: {
        generating: {
          on: {
            // assignThumbProgress uses `as never` cast and reads params — keep params extractor
            THUMB_PROGRESS: {
              actions: [
                {
                  type: "assignThumbProgress",
                  params: ({
                    event,
                  }: {
                    event: {
                      type: "THUMB_PROGRESS";
                      thumbed: number;
                      rateHz: number;
                      remaining: number;
                    };
                  }) => ({
                    thumbed: event.thumbed,
                    rateHz: event.rateHz,
                    remaining: event.remaining,
                  }),
                },
              ],
            },
            THUMBS_DONE: {
              target: "done",
              actions: ["markAllThumbed"],
            },
          },
        },
        done: {
          on: {
            REGENERATE: {
              target: "generating",
              actions: ["requestRegenerate"],
            },
          },
        },
      },
    },

    // ---- Region: files ------------------------------------------------------
    files: {
      initial: "browsing",
      states: {
        browsing: {
          on: {
            SELECT_FILE: {
              target: "selecting",
              actions: ["addToSelection"],
            },
          },
        },

        selecting: {
          on: {
            SELECT_FILE: {
              actions: ["toggleSelection"],
            },
            SELECT_RANGE: {
              actions: ["addRangeToSelection"],
            },
            MARK_AS: {
              actions: ["markSelected"],
            },
            REMOVE_FILES: {
              actions: ["removeSelected"],
            },
            CLEAR_SELECTION: {
              target: "browsing",
              actions: ["emptySelection"],
            },
          },
        },

        inserting: {
          on: {
            SET_INSERT_FIELD: {
              actions: ["patchInsertDraft"],
            },
            CONFIRM_INSERT: {
              target: "browsing",
              actions: ["createInsertedRow"],
            },
            CANCEL_INSERT: {
              target: "browsing",
              actions: ["clearInsertDraft"],
            },
          },
        },

        confirming: {
          invoke: {
            id: "confirmSelection",
            src: "confirmSelection",
            input: ({ context }: { context: SourceToolContext }) => ({
              projectId: context.projectId,
              files: context.files,
              services: context.services,
            }),
            onDone: {
              target: "confirmed",
              actions: ["emitStageComplete"],
            },
            onError: {
              target: "browsing",
              actions: [
                // assignError uses `as never` cast and reads params — keep params extractor
                {
                  type: "assignError",
                  params: ({
                    event,
                  }: {
                    event: { output?: unknown; error?: unknown };
                  }) => ({
                    error:
                      (event.output as string | undefined) ??
                      (event.error as string | undefined) ??
                      "Confirm failed",
                  }),
                },
              ],
            },
          },
        },

        confirmed: {
          type: "final",
        },
      },

      // Files-region-level events (available in all files sub-states)
      on: {
        SET_FILTER: { actions: ["assignFilter"] },
        SET_DENSITY: { actions: ["assignDensity"] },
        SET_QUERY: { actions: ["assignQuery"] },
        OPEN_INSERT: {
          target: ".inserting",
          actions: ["beginInsertDraft"],
        },
        SET_ROLE: { actions: ["assignRole"] },
        CONFIRM_SELECTION: {
          target: ".confirming",
          guard: "canConfirm",
        },
      },
    },

    // ---- Region: settings ---------------------------------------------------
    // YAML: settings.initial = default (default|modified|preset tri-state)
    settings: {
      initial: "default",
      states: {
        default: {
          entry: ["enterSettingsDefault"],
          on: {
            // recordSettingChange and assignPreset are from stageSettingsActions (cast as any)
            CHANGE_SETTING: {
              target: "modified",
              actions: ["recordSettingChange"],
            },
            LOAD_PRESET: {
              target: "preset",
              actions: ["assignPreset"],
            },
          },
        },

        modified: {
          entry: ["enterSettingsModified"],
          on: {
            CHANGE_SETTING: {
              actions: ["recordSettingChange"],
            },
            SAVE_AS_DEFAULT: {
              target: "default",
              actions: ["onSavedAsDefault"],
            },
            REVERT: {
              target: "default",
              actions: ["revertSettingsAction"],
            },
            SAVE_AS_PRESET: {
              target: "preset",
              actions: ["onSavedAsPreset"],
            },
          },
        },

        preset: {
          entry: ["enterSettingsPreset"],
          on: {
            CHANGE_SETTING: {
              target: "modified",
              actions: ["recordSettingChange"],
            },
            RESET_TO_DEFAULT: {
              target: "default",
              actions: ["revertSettingsAction"],
            },
          },
        },
      },
    },
  },
});

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------

export type SourceToolMachineType = typeof sourceToolMachine;

// Re-export for convenience — F5 callers use these types for services injection
export type { StageSettingsServices } from "./stageSettings";
export type { SaveAsDefaultInput, RevertResetInput } from "./stageSettings";
