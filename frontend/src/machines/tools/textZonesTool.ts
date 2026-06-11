/**
 * textZonesTool — XState v5 machine for the Text Zones stage tool.
 *
 * Ported from `docs/plans/design_handoff_pgdp_app/statecharts/tool-text-zones.yaml`
 * with the mechanical conventions in DIVERGENCES.md.
 *
 * Stage: text_zones (page-scoped, OCR group)
 *
 * ## Exclusive editors
 * The zone editor (draw/re-type/delete zones, fix reading order) and the split
 * editor (confirm/tune a suggested split) are EXCLUSIVE — only one row open at a
 * time, one editor kind. Same single-draft rule as attributesPanel.
 *
 * ## APPLY_SPLIT critical invariant
 * APPLY_SPLIT is the ONLY edge in any tool that mutates the PAGE SET. Applying a
 * split turns one page into N sibling pages. Staleness fan-out is NARROW:
 *
 *   STALE on APPLY_SPLIT: page_order (project-scope), canvas_map (each child)
 *   NOT STALE: ocr — text_zones and ocr are sibling DAG paths (ocr depends on
 *              post_ocr_crop → canvas_map, NOT on text_zones directly)
 *
 * Per STAGE_DEPS: text_zones → (no direct downstream except page_order via
 * cross-scope dep). The split produces new sibling pages that need canvas_map
 * re-run for their crop-edge margins. ocr waits on canvas_map anyway.
 *
 * The machine emits PAGE_SET_CHANGED event (via side-effect action) with the
 * new child page IDs so the shell can re-key the page set.
 *
 * @see docs/plans/design_handoff_pgdp_app/statecharts/tool-text-zones.yaml
 * @see src/machines/DIVERGENCES.md — general divergences (esp. #3, #5)
 * @see src/mocks/fixtures.ts STAGE_DEPS — DAG for narrow staleness assertion
 */

import { setup, assign, fromPromise } from "xstate";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/** A detected region on a page. */
export interface Zone {
  id: string;
  type: ZoneType;
  /** Normalised [0, 1] coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Reading order (1-based integer). Null for non-text zones. */
  order: number | null;
}

export type ZoneType =
  | "body"
  | "heading"
  | "header"
  | "footer"
  | "caption"
  | "footnote"
  | "illustration"
  | "table"
  | "marginalia";

export interface SplitDraft {
  axis: "col" | "row";
  into: 2;
  /** Normalised [0, 1] position of the split line. */
  gutter: number;
  /** Detection confidence [0, 1]. */
  conf: number;
}

/** Row in the text_zones page grid.
 *
 * `split` is present when the detector suggested a split.
 * `state` extends the base PageRow enum with 'split' for pages that have been
 * split into children. */
export interface ZonePageRow {
  idx: string;
  prefix: string;
  state: "running" | "clean" | "flagged" | "reviewed" | "split" | "failed";
  flags?: string[];
  layoutKind?: string;
  zones?: number; // zone count for display
  lines?: number; // line count for display
  words?: number; // word count for display
  pageNumber?: number;
  split?: SplitDraft & { applied?: boolean };
  [key: string]: unknown;
}

export interface ZoneTotals {
  total: number;
  done: number;
  clean: number;
  flagged: number;
  reviewed: number;
  splits: number;
  rateHz?: number;
  zonesAvg?: number;
  [key: string]: unknown;
}

/** Result of applySplit — server returns parent row (state:'split') + 2 child rows. */
export interface SplitResult {
  parentRow: ZonePageRow;
  childRows: [ZonePageRow, ZonePageRow];
}

// ---------------------------------------------------------------------------
// Services interface
// ---------------------------------------------------------------------------

export interface TextZonesToolServices {
  /**
   * GET /api/projects/:id/stages/text_zones/pages -> { rows, totals }
   */
  fetchZonePages(
    projectId: string,
  ): Promise<{ rows: ZonePageRow[]; totals: ZoneTotals }>;

  /**
   * POST /api/projects/:id/stages/text_zones/pages/:pageId/split
   * -> { parentRow, childRows }
   *
   * CRITICAL: this is the APPLY_SPLIT edge — mutates the page set.
   */
  applySplit(
    projectId: string,
    pageId: string,
    draft: SplitDraft,
  ): Promise<SplitResult>;

  /**
   * POST /api/projects/:id/stages/text_zones/pages/:pageId/detect
   * -> { zones }
   */
  redetectLayout(
    projectId: string,
    pageId: string,
    currentDraft: Zone[] | null,
  ): Promise<{ zones: Zone[] }>;

  /**
   * PUT /api/projects/:id/stages/text_zones/pages/:pageId/layout
   * -> { ok }  (side effect)
   */
  persistLayout(
    projectId: string,
    pageId: string,
    data: { zones?: Zone[]; dismissed?: boolean },
  ): Promise<{ ok: boolean }>;

  /**
   * POST /api/projects/:id/stages/text_zones/confirm -> { ok }
   */
  confirmStage(projectId: string): Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// Input + Context
// ---------------------------------------------------------------------------

export interface TextZonesToolInput {
  projectId: string;
  stageIndex: number;
  services: TextZonesToolServices;
}

export interface TextZonesToolContext {
  projectId: string;
  stageIndex: number;
  services: TextZonesToolServices;

  rows: ZonePageRow[];
  totals: ZoneTotals | null;
  filter: string; // 'all' | 'flagged' | 'splits' | 'clean' | 'reviewed'
  density: "S" | "M" | "L";
  selected: string[];

  /** W5.1 — settings fields moved from local useState to machine context. */
  splitsOn: boolean;
  granularity: "block" | "paragraph" | "line" | "word";

  /** idx of the row currently open in an inline editor, or null. */
  editing: string | null;
  /** Which editor is open for the editing row. */
  editorKind: "zones" | "split" | null;

  /** Active drawing tool in the zone editor. */
  tool: "select" | "box" | "lasso";

  /** Working copy of zones for the zone editor. */
  zoneDraft: Zone[] | null;
  /** Working copy of the split suggestion for the split editor. */
  splitDraft: SplitDraft | null;

  error: { message: string } | null;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type TextZonesToolEvent =
  // Browsing
  | { type: "OPEN_ZONE_EDITOR"; idx: string }
  | { type: "OPEN_SPLIT_EDITOR"; idx: string }
  // Zone editor
  | { type: "SET_TOOL"; tool: "select" | "box" | "lasso" }
  | {
      type: "DRAW_ZONE";
      box: { x: number; y: number; w: number; h: number };
      zoneType?: ZoneType;
    }
  | { type: "RETYPE_ZONE"; zoneId: string; zoneType: ZoneType }
  | { type: "DELETE_ZONE"; zoneId: string }
  | { type: "REORDER_ZONE"; from: number; to: number }
  | { type: "REDETECT" }
  | { type: "SAVE_LAYOUT" }
  // Split editor
  | { type: "SET_AXIS"; patch: Partial<SplitDraft> }
  | { type: "DRAG_GUTTER"; patch: Partial<SplitDraft> }
  | { type: "APPLY_SPLIT" }
  | { type: "KEEP_AS_ONE" }
  // Shared editor controls
  | { type: "CANCEL" }
  // Global controls
  | { type: "SET_FILTER"; value: string }
  | { type: "SET_DENSITY"; value: "S" | "M" | "L" }
  // W5.1 — settings controls (moved from local useState to machine events)
  | { type: "SET_SPLITS_ON"; value: boolean }
  | { type: "SET_GRANULARITY"; value: "block" | "paragraph" | "line" | "word" }
  | { type: "RETRY" }
  | { type: "CONFIRM_ADVANCE" }
  | { type: "UPSTREAM_CHANGED" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function recountZone(rows: ZonePageRow[]): ZoneTotals {
  const total = rows.length;
  const running = rows.filter((r) => r.state === "running").length;
  const flagged = rows.filter((r) => r.state === "flagged").length;
  const clean = rows.filter((r) => r.state === "clean").length;
  const reviewed = rows.filter((r) => r.state === "reviewed").length;
  const splits = rows.filter((r) =>
    (r.flags ?? []).includes("splitSuggested"),
  ).length;
  const done = total - running;
  return { total, done, clean, flagged, reviewed, splits };
}

function setZoneRowState(
  rows: ZonePageRow[],
  idxList: string[],
  state: ZonePageRow["state"],
): ZonePageRow[] {
  return rows.map((r) => (idxList.includes(r.idx) ? { ...r, state } : r));
}

function zonesOf(rows: ZonePageRow[], idx: string): Zone[] {
  const row = rows.find((r) => r.idx === idx);
  // In a real impl, zones would come from a richer row shape.
  // For mock purposes, return an empty array.
  if (!row) return [];
  return (row["_zones"] as Zone[] | undefined) ?? [];
}

function cloneZones(zones: Zone[]): Zone[] {
  return zones.map((z) => ({ ...z }));
}

function newZone(
  box: { x: number; y: number; w: number; h: number },
  type: ZoneType,
  existingZones: Zone[],
): Zone {
  return {
    id: `zone-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    order: existingZones.length + 1,
  };
}

function reorderZones(zones: Zone[], from: number, to: number): Zone[] {
  const copy = [...zones];
  const [item] = copy.splice(from, 1);
  if (item) copy.splice(to, 0, item);
  // Re-assign order values to match new positions
  return copy.map((z, i) => ({ ...z, order: i + 1 }));
}

// ---------------------------------------------------------------------------
// Machine
// ---------------------------------------------------------------------------

export const textZonesToolMachine = setup({
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  types: {} as {
    context: TextZonesToolContext;
    events: TextZonesToolEvent;
    input: TextZonesToolInput;
  },

  actors: {
    /**
     * YAML: `invoke.src: fetchZonePages`
     * DIVERGENCE #3: onDone uses event.output not event.data.
     */
    fetchZonePages: fromPromise<
      { rows: ZonePageRow[]; totals: ZoneTotals },
      { projectId: string; services: TextZonesToolServices }
    >(({ input }) => input.services.fetchZonePages(input.projectId)),

    /**
     * YAML: `invoke.src: applySplit`
     * CRITICAL: This actor mutates the PAGE SET.
     * Result: parentRow (state:'split') + 2 child ZonePageRows.
     * The shell must be notified via emitPageCountChanged (side-effect).
     *
     * Narrow staleness after APPLY_SPLIT:
     *   - page_order (project-scope) → dirty (new pages change sequence)
     *   - canvas_map for each child page → needs re-run (split-edge margins)
     *   - NOT ocr: text_zones and ocr are sibling DAG paths
     *     (ocr depends on post_ocr_crop → canvas_map, not text_zones)
     */
    applySplit: fromPromise<
      SplitResult,
      {
        projectId: string;
        pageId: string;
        draft: SplitDraft;
        services: TextZonesToolServices;
      }
    >(({ input }) =>
      input.services.applySplit(input.projectId, input.pageId, input.draft),
    ),

    /** YAML: `invoke.src: redetectLayout` */
    redetectLayout: fromPromise<
      { zones: Zone[] },
      {
        projectId: string;
        pageId: string;
        currentDraft: Zone[] | null;
        services: TextZonesToolServices;
      }
    >(({ input }) =>
      input.services.redetectLayout(
        input.projectId,
        input.pageId,
        input.currentDraft,
      ),
    ),

    /** YAML: `invoke.src: confirmStage` */
    confirmStage: fromPromise<
      { ok: boolean },
      { projectId: string; services: TextZonesToolServices }
    >(({ input }) => input.services.confirmStage(input.projectId)),
  },

  guards: {
    /**
     * YAML: `allFlagsReviewed: ctx.totals.flagged === 0 || ctx.totals.flagged === ctx.totals.reviewed`
     */
    allFlagsReviewed: ({ context }) => {
      if (!context.totals) return false;
      return (
        context.totals.flagged === 0 ||
        context.totals.flagged === context.totals.reviewed
      );
    },
  },

  actions: {
    /** YAML: `assignRows` — DIVERGENCE #3: uses event.output not event.data */
    assignRows: assign(
      (
        _args,
        params: { output: { rows: ZonePageRow[]; totals: ZoneTotals } },
      ) => ({
        rows: params.output.rows,
        totals: params.output.totals,
      }),
    ),

    /** YAML: `assignError` */
    assignError: assign((_args, params: { error: unknown }) => {
      let msg: string;
      if (params.error instanceof Error) {
        msg = params.error.message;
      } else if (typeof params.error === "string") {
        msg = params.error;
      } else {
        msg = "Unknown error";
      }
      return { error: { message: msg } };
    }),

    /** YAML: `clearError` */
    clearError: assign({ error: () => null }),

    /** YAML: `assignFilter` */
    assignFilter: assign({
      filter: ({ event }) => {
        if (event.type !== "SET_FILTER") return "all";
        return event.value;
      },
    }),

    /** YAML: `assignDensity` */
    assignDensity: assign({
      density: ({ event }) => {
        if (event.type !== "SET_DENSITY") return "M" as const;
        return event.value;
      },
    }),

    /** W5.1 — `assignSplitsOn`: move splitsOn from local useState to machine context. */
    assignSplitsOn: assign({
      splitsOn: ({ context, event }) => {
        if (event.type !== "SET_SPLITS_ON") return context.splitsOn;
        return event.value;
      },
    }),

    /** W5.1 — `assignGranularity`: move granularity from local useState to machine context. */
    assignGranularity: assign({
      granularity: ({ context, event }) => {
        if (event.type !== "SET_GRANULARITY") return context.granularity;
        return event.value;
      },
    }),

    /** YAML: `assignEditing` */
    assignEditing: assign({
      editing: ({ event }) => {
        if (
          event.type !== "OPEN_ZONE_EDITOR" &&
          event.type !== "OPEN_SPLIT_EDITOR"
        )
          return null;
        return event.idx;
      },
    }),

    /**
     * YAML: `beginZoneDraft: ctx.editorKind = 'zones'; ctx.zoneDraft = clone(zonesOf(ctx.rows, event.idx))`
     */
    beginZoneDraft: assign({
      editorKind: () => "zones" as const,
      zoneDraft: ({ context, event }) => {
        if (event.type !== "OPEN_ZONE_EDITOR") return null;
        return cloneZones(zonesOf(context.rows, event.idx));
      },
    }),

    /**
     * YAML: `beginSplitDraft: ctx.editorKind = 'split'; ctx.splitDraft = clone(ctx.rows[event.idx].split)`
     */
    beginSplitDraft: assign({
      editorKind: () => "split" as const,
      splitDraft: ({ context, event }) => {
        if (event.type !== "OPEN_SPLIT_EDITOR") return null;
        const row = context.rows.find((r) => r.idx === event.idx);
        const s = row?.split;
        if (!s)
          return {
            axis: "col" as const,
            into: 2 as const,
            gutter: 0.5,
            conf: 0.8,
          };
        return {
          axis: s.axis,
          into: s.into,
          gutter: s.gutter,
          conf: s.conf,
        };
      },
    }),

    /** YAML: `assignTool` */
    assignTool: assign({
      tool: ({ event }) => {
        if (event.type !== "SET_TOOL") return "box" as const;
        return event.tool;
      },
    }),

    /**
     * YAML: `appendZone: ctx.zoneDraft = [...ctx.zoneDraft, newZone(event.box, event.type ?? 'body')]`
     */
    appendZone: assign({
      zoneDraft: ({ context, event }) => {
        if (event.type !== "DRAW_ZONE") return context.zoneDraft;
        const current = context.zoneDraft ?? [];
        const zone = newZone(event.box, event.zoneType ?? "body", current);
        return [...current, zone];
      },
    }),

    /**
     * YAML: `patchZoneType: ctx.zoneDraft = patchZone(ctx.zoneDraft, event.zoneId, z => ({ ...z, type: event.type }))`
     */
    patchZoneType: assign({
      zoneDraft: ({ context, event }) => {
        if (event.type !== "RETYPE_ZONE") return context.zoneDraft;
        return (context.zoneDraft ?? []).map((z) =>
          z.id === event.zoneId ? { ...z, type: event.zoneType } : z,
        );
      },
    }),

    /**
     * YAML: `removeZone: ctx.zoneDraft = ctx.zoneDraft.filter(z => z.id !== event.zoneId)`
     */
    removeZone: assign({
      zoneDraft: ({ context, event }) => {
        if (event.type !== "DELETE_ZONE") return context.zoneDraft;
        return (context.zoneDraft ?? []).filter((z) => z.id !== event.zoneId);
      },
    }),

    /**
     * YAML: `moveZoneOrder: ctx.zoneDraft = reorder(ctx.zoneDraft, event.from, event.to)`
     */
    moveZoneOrder: assign({
      zoneDraft: ({ context, event }) => {
        if (event.type !== "REORDER_ZONE") return context.zoneDraft;
        return reorderZones(context.zoneDraft ?? [], event.from, event.to);
      },
    }),

    /**
     * YAML: `patchSplit: ctx.splitDraft = { ...ctx.splitDraft, ...event.patch }`
     * Handles both SET_AXIS and DRAG_GUTTER.
     */
    patchSplit: assign({
      splitDraft: ({ context, event }) => {
        if (event.type !== "SET_AXIS" && event.type !== "DRAG_GUTTER")
          return context.splitDraft;
        return {
          ...(context.splitDraft ?? {
            axis: "col" as const,
            into: 2 as const,
            gutter: 0.5,
            conf: 0.8,
          }),
          ...event.patch,
        };
      },
    }),

    /**
     * YAML: `commitZones` — write zoneDraft back onto the matching row.
     * Inline fold per DIVERGENCES.md #9 pattern.
     */
    commitZones: assign({
      rows: ({ context }) => {
        if (!context.editing || !context.zoneDraft) return context.rows;
        return context.rows.map((r) =>
          r.idx === context.editing
            ? {
                ...r,
                _zones: context.zoneDraft,
                zones: (context.zoneDraft ?? []).length,
              }
            : r,
        );
      },
    }),

    /**
     * YAML: `dismissSplit` — drop the splitSuggested flag from the row.
     */
    dismissSplit: assign({
      rows: ({ context }) => {
        if (!context.editing) return context.rows;
        return context.rows.map((r): ZonePageRow => {
          if (r.idx !== context.editing) return r;
          const updated: ZonePageRow = {
            ...r,
            flags: (r.flags ?? []).filter((f) => f !== "splitSuggested"),
          };
          if (r.split) {
            updated.split = { ...r.split, applied: false };
          }
          return updated;
        });
      },
    }),

    /**
     * YAML: `replaceWithChildren` — swap parent row for child rows.
     *
     * APPLY_SPLIT critical path: page set is mutated. The parent row gets
     * state:'split'; child rows are inserted after parent position. The machine
     * emits PAGE_SET_CHANGED (via emitPageCountChanged) so the shell re-keys.
     *
     * NARROW STALE fan-out assertion:
     *   page_order → stale (page sequence changes)
     *   canvas_map for each child page → stale (crop-edge margins)
     *   ocr → NOT stale (sibling DAG path: ocr depends on post_ocr_crop → canvas_map,
     *                    not on text_zones; text_zones and ocr are independent)
     */
    replaceWithChildren: assign(
      (
        { context },
        params: { output: SplitResult },
      ): Partial<TextZonesToolContext> => {
        const { parentRow, childRows } = params.output;
        const idx = context.rows.findIndex((r) => r.idx === parentRow.idx);
        if (idx === -1) {
          // Fallback: append children
          return {
            rows: [...context.rows, ...childRows],
            totals: recountZone([...context.rows, ...childRows]),
          };
        }
        const newRows = [
          ...context.rows.slice(0, idx),
          parentRow,
          ...childRows,
          ...context.rows.slice(idx + 1),
        ];
        return {
          rows: newRows,
          totals: recountZone(newRows),
        };
      },
    ),

    /** YAML: `assignRedetected: ctx.zoneDraft = event.data.zones` — DIVERGENCE #3 */
    assignRedetected: assign(
      (
        _args,
        params: { output: { zones: Zone[] } },
      ): Partial<TextZonesToolContext> => ({
        zoneDraft: params.output.zones,
      }),
    ),

    /**
     * YAML: `markReviewed: ctx.rows = setState(ctx.rows, [ctx.editing], 'reviewed')`
     * Inline recount per DIVERGENCES.md #9.
     */
    markReviewed: assign({
      rows: ({ context }) => {
        if (!context.editing) return context.rows;
        return setZoneRowState(context.rows, [context.editing], "reviewed");
      },
      totals: ({ context }) => {
        if (!context.editing) return context.totals;
        const newRows = setZoneRowState(
          context.rows,
          [context.editing],
          "reviewed",
        );
        return recountZone(newRows);
      },
    }),

    /**
     * YAML: `recount` — DIVERGENCES.md #9: fold into preceding assign.
     * This is a no-op slot; recount is inlined in markReviewed / replaceWithChildren.
     */
    recount: () => {
      // Inlined in markReviewed, replaceWithChildren.
    },

    /**
     * YAML: `clearEditor: ctx.editing = null; ctx.editorKind = null; ctx.zoneDraft = null; ctx.splitDraft = null`
     */
    clearEditor: assign({
      editing: () => null,
      editorKind: () => null,
      zoneDraft: () => null,
      splitDraft: () => null,
    }),

    // Side-effect slots — no-op at F5; wired at I1.

    /**
     * YAML: `persistLayout` — SIDE EFFECT: PUT page layout (zones + order | dismissed split)
     * Called from SAVE_LAYOUT and KEEP_AS_ONE transitions.
     */
    persistLayout: ({ context }) => {
      // SIDE EFFECT: at I1, PUT /api/projects/:id/stages/text_zones/pages/:pageId/layout
      void context;
    },

    /**
     * YAML: `emitZonesChanged` — illustration zones changed → illustrationsTool UPSTREAM_CHANGED
     * Called when SAVE_LAYOUT produces zone type changes.
     */
    emitZonesChanged: () => {
      // SIDE EFFECT: at I1, notify illustrationsTool of zone type changes
    },

    /**
     * YAML: `emitPageCountChanged` — page set changed → page_order, canvas_map, counts everywhere
     *
     * APPLY_SPLIT staleness: page_order + canvas_map for each child page.
     * NOT ocr (sibling DAG path).
     * The shell (pipelineShell) must receive this event to re-key the page set
     * and mark page_order + canvas_map(children) as dirty.
     */
    emitPageCountChanged: () => {
      // SIDE EFFECT: at I1, emit PAGE_SET_CHANGED to pipelineShell with new child page IDs
      // pipelineShell marks page_order dirty + canvas_map dirty for each child
    },

    /**
     * YAML: `emitResolved` — send parent: RESOLVE — stageRunner[text_zones] → clean
     */
    emitResolved: () => {
      // SIDE EFFECT: at I1, send RESOLVE to pipelineShell for text_zones runner
    },
  },
}).createMachine({
  id: "textZonesTool",

  context: ({ input }) => ({
    projectId: input.projectId,
    stageIndex: input.stageIndex,
    services: input.services,
    rows: [],
    totals: null,
    filter: "all",
    density: "M",
    selected: [],
    // W5.1 — settings fields with defaults
    splitsOn: true,
    granularity: "line" as const,
    editing: null,
    editorKind: null,
    tool: "box",
    zoneDraft: null,
    splitDraft: null,
    error: null,
  }),

  initial: "loading",

  states: {
    /** YAML: loading — fetch page rows */
    loading: {
      invoke: {
        id: "fetchZonePages",
        src: "fetchZonePages",
        input: ({ context }) => ({
          projectId: context.projectId,
          services: context.services,
        }),
        onDone: {
          target: "reviewing",
          actions: [
            {
              type: "assignRows",
              params: ({
                event,
              }: {
                event: {
                  output: { rows: ZonePageRow[]; totals: ZoneTotals };
                };
              }) => ({ output: event.output }),
            },
          ],
        },
        onError: {
          target: "loadError",
          actions: [
            {
              type: "assignError",
              params: ({ event }: { event: { error: unknown } }) => ({
                error: event.error,
              }),
            },
          ],
        },
      },
    },

    /** YAML: loadError */
    loadError: {
      on: {
        RETRY: { target: "loading", actions: ["clearError"] },
      },
    },

    /**
     * YAML: reviewing — grid shell with browsing / editingZones / editingSplit /
     * applyingSplit / redetecting sub-states.
     *
     * The two editors are EXCLUSIVE (same single-draft rule as attributesPanel).
     */
    reviewing: {
      initial: "browsing",

      on: {
        SET_FILTER: { actions: ["assignFilter"] },
        SET_DENSITY: { actions: ["assignDensity"] },
        // W5.1 — settings controls wired to machine context
        SET_SPLITS_ON: { actions: ["assignSplitsOn"] },
        SET_GRANULARITY: { actions: ["assignGranularity"] },
        CONFIRM_ADVANCE: {
          target: "confirming",
          guard: "allFlagsReviewed",
        },
      },

      states: {
        /** YAML: browsing */
        browsing: {
          on: {
            OPEN_ZONE_EDITOR: {
              target: "editingZones",
              actions: ["assignEditing", "beginZoneDraft"],
            },
            OPEN_SPLIT_EDITOR: {
              target: "editingSplit",
              actions: ["assignEditing", "beginSplitDraft"],
            },
          },
        },

        /**
         * YAML: editingZones — draw / re-type / delete zones; drag reading order.
         * Tools: select | box | lasso.
         */
        editingZones: {
          on: {
            SET_TOOL: { actions: ["assignTool"] },
            DRAW_ZONE: { actions: ["appendZone"] },
            RETYPE_ZONE: { actions: ["patchZoneType"] },
            DELETE_ZONE: { actions: ["removeZone"] },
            REORDER_ZONE: { actions: ["moveZoneOrder"] },
            REDETECT: { target: "redetecting" },
            SAVE_LAYOUT: {
              target: "browsing",
              actions: [
                "commitZones",
                "persistLayout",
                "markReviewed",
                "clearEditor",
                "emitZonesChanged",
              ],
            },
            CANCEL: { target: "browsing", actions: ["clearEditor"] },
          },
        },

        /**
         * YAML: editingSplit — column/row split with gutter handle + confidence.
         * APPLY_SPLIT transitions to applyingSplit which mutates the page set.
         */
        editingSplit: {
          on: {
            SET_AXIS: { actions: ["patchSplit"] },
            DRAG_GUTTER: { actions: ["patchSplit"] },
            APPLY_SPLIT: { target: "applyingSplit" },
            KEEP_AS_ONE: {
              target: "browsing",
              actions: [
                "dismissSplit",
                "persistLayout",
                "markReviewed",
                "recount",
                "clearEditor",
              ],
            },
            CANCEL: { target: "browsing", actions: ["clearEditor"] },
          },
        },

        /**
         * YAML: applyingSplit — invokes applySplit service.
         *
         * APPLY_SPLIT critical invariant:
         * - Turns one page into N sibling pages (re-keys the page set)
         * - replaceWithChildren: parent row gets state:'split'; child rows inserted
         * - emitPageCountChanged: notifies shell to re-key + mark page_order dirty
         *   and canvas_map dirty for each child
         * - Narrow stale: page_order + canvas_map(children), NOT ocr
         */
        applyingSplit: {
          invoke: {
            id: "applySplit",
            src: "applySplit",
            input: ({ context }) => ({
              projectId: context.projectId,
              pageId: context.editing ?? "",
              draft: context.splitDraft ?? {
                axis: "col",
                into: 2,
                gutter: 0.5,
                conf: 0.8,
              },
              services: context.services,
            }),
            onDone: {
              target: "browsing",
              actions: [
                {
                  type: "replaceWithChildren",
                  params: ({ event }: { event: { output: SplitResult } }) => ({
                    output: event.output,
                  }),
                },
                "clearEditor",
                "emitPageCountChanged",
              ],
            },
            onError: {
              target: "editingSplit",
              actions: [
                {
                  type: "assignError",
                  params: ({ event }: { event: { error: unknown } }) => ({
                    error: event.error,
                  }),
                },
              ],
            },
          },
        },

        /**
         * YAML: redetecting — re-run layout detection for the current editing row.
         */
        redetecting: {
          invoke: {
            id: "redetectLayout",
            src: "redetectLayout",
            input: ({ context }) => ({
              projectId: context.projectId,
              pageId: context.editing ?? "",
              currentDraft: context.zoneDraft,
              services: context.services,
            }),
            onDone: {
              target: "editingZones",
              actions: [
                {
                  type: "assignRedetected",
                  params: ({
                    event,
                  }: {
                    event: { output: { zones: Zone[] } };
                  }) => ({
                    output: event.output,
                  }),
                },
              ],
            },
            onError: {
              target: "editingZones",
              actions: [
                {
                  type: "assignError",
                  params: ({ event }: { event: { error: unknown } }) => ({
                    error: event.error,
                  }),
                },
              ],
            },
          },
        },
      },
    },

    /** YAML: confirming */
    confirming: {
      invoke: {
        id: "confirmStage",
        src: "confirmStage",
        input: ({ context }) => ({
          projectId: context.projectId,
          services: context.services,
        }),
        onDone: {
          target: "settled",
          actions: ["emitResolved"],
        },
        onError: {
          target: "reviewing",
          actions: [
            {
              type: "assignError",
              params: ({ event }: { event: { error: unknown } }) => ({
                error: event.error,
              }),
            },
          ],
        },
      },
    },

    /**
     * YAML: settled — zones confirmed; feeds OCR, Illustrations, reading order.
     */
    settled: {
      on: {
        UPSTREAM_CHANGED: { target: "loading" },
      },
    },
  },
});
