/**
 * illustrationsTool — XState v5 machine for the Illustrations stage tool.
 *
 * Ported from `docs/plans/design_handoff_pgdp_app/statecharts/tool-illustrations.yaml`
 *
 * Extracts illustration regions marked during Page layout (text_zones). Each
 * region has a status (extracted | review | flagged) and a kind (plate / line
 * art / initial / figure) that decides export treatment. Plates stay CONTONE.
 *
 * ## Divergences from YAML
 *
 * ### F5.4-6 — `settleIfClear` as `always` guard (DIVERGENCES.md #5 pattern)
 * The YAML calls `settleIfClear` as an action that raises an internal `SETTLED`
 * event. In XState v5, this is resolved using an `always` guard on `reviewing`
 * that fires when `counts.review + counts.flagged === 0`.
 *
 * The `always` guard auto-transitions to `extracted` (emitting `emitResolved`)
 * when all review/flagged regions are either confirmed or dropped. This is
 * equivalent to the YAML's `settleIfClear` intent.
 *
 * Per DIVERGENCES.md #5 pattern, the guard is placed directly on `reviewing`.
 * No separate `settleIfClear` action is implemented.
 *
 * ### F5.4-7 — `recount` folded into `markExtracted` / `removeRegion` (DIVERGENCES.md #9)
 * The YAML calls `recount` as a separate action after `markExtracted` and
 * `removeRegion`. In XState v5, the recount is folded into the preceding
 * `assign` action that mutates `items`. No standalone `recount` action exists.
 *
 * ### F5.4-8 — `persistRegion` and `exportCrops` are side-effect actions
 * Both are called as fire-and-forget side-effect actions (not invoke actors).
 * At I1, wrap in `fromPromise` with error handling.
 *
 * @see docs/plans/design_handoff_pgdp_app/statecharts/tool-illustrations.yaml
 * @see docs/plans/design_handoff_pgdp_app/final/illustrations/illustrations.jsx
 * @see src/machines/DIVERGENCES.md
 */

import { setup, assign, fromPromise } from "xstate";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type IllustrationKind = "plate" | "lineart" | "initial" | "figure";
export type IllustrationStatus = "extracted" | "review" | "flagged";
export type GalleryFilter =
  | "all"
  | "plates"
  | "lineart"
  | "initials"
  | "figures";

export interface IllustrationRegion {
  id: string;
  /** Source page ID */
  page: string;
  kind: IllustrationKind;
  /** Width in pixels */
  w: number;
  /** Height in pixels */
  h: number;
  status: IllustrationStatus;
  note: string;
}

export interface IllustrationCounts {
  detected: number;
  extracted: number;
  review: number;
  flagged: number;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface IllustrationsToolServices {
  /**
   * POST /api/projects/:id/stages/illustrations/detect
   * Returns detected illustration regions and counts.
   * YAML: `detectRegions -> { items, counts }`
   */
  detectRegions(projectId: string): Promise<{
    items: IllustrationRegion[];
    counts: IllustrationCounts;
  }>;

  /**
   * PATCH /api/projects/:id/stages/illustrations/regions/:regionId
   * Persists updated bounds, status, or note for a single region.
   * YAML: `persistRegion — SIDE EFFECT: PATCH region`
   */
  persistRegion(projectId: string, region: IllustrationRegion): Promise<void>;
}

// ---------------------------------------------------------------------------
// Input + Context
// ---------------------------------------------------------------------------

export interface IllustrationsToolInput {
  projectId: string;
  stageIndex: number;
  services: IllustrationsToolServices;
}

export interface IllustrationsToolContext {
  projectId: string;
  stageIndex: number;
  services: IllustrationsToolServices;
  items: IllustrationRegion[];
  counts: IllustrationCounts | null;
  galleryFilter: GalleryFilter;
  error: { message: string } | null;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type IllustrationsToolEvent =
  | { type: "CONFIRM_REGION"; regionId: string }
  | {
      type: "ADJUST_BOUNDS";
      regionId: string;
      patch: Partial<IllustrationRegion>;
    }
  | { type: "DROP_REGION"; regionId: string }
  | { type: "REDETECT" }
  | { type: "SET_GALLERY_FILTER"; value: GalleryFilter }
  | { type: "EXPORT_CROPS" }
  | { type: "UPSTREAM_CHANGED" }
  | { type: "RETRY" };

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function patchItemById(
  items: IllustrationRegion[],
  id: string,
  fn: (r: IllustrationRegion) => IllustrationRegion,
): IllustrationRegion[] {
  return items.map((r) => (r.id === id ? fn(r) : r));
}

/** YAML: `recount — PURE: recount from items` */
function recount(items: IllustrationRegion[]): IllustrationCounts {
  return {
    detected: items.length,
    extracted: items.filter((r) => r.status === "extracted").length,
    review: items.filter((r) => r.status === "review").length,
    flagged: items.filter((r) => r.status === "flagged").length,
  };
}

// ---------------------------------------------------------------------------
// Machine
// ---------------------------------------------------------------------------

export const illustrationsToolMachine = setup({
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  types: {} as {
    context: IllustrationsToolContext;
    events: IllustrationsToolEvent;
    input: IllustrationsToolInput;
  },

  actors: {
    /**
     * YAML: `invoke.src: detectRegions -> { items, counts }`
     * DIVERGENCE #3: onDone carries event.output not event.data.
     */
    detectRegions: fromPromise<
      { items: IllustrationRegion[]; counts: IllustrationCounts },
      { projectId: string; services: IllustrationsToolServices }
    >(({ input }) => input.services.detectRegions(input.projectId)),
  },

  guards: {
    /**
     * YAML: `needsALook: event.data.counts.review + event.data.counts.flagged > 0`
     * DIVERGENCE #3: params pattern to read event.output.
     */
    needsALook: (_args, params: { counts: IllustrationCounts }) =>
      params.counts.review + params.counts.flagged > 0,

    /**
     * F5.4-6 divergence: `settleIfClear` as always guard.
     * Fires when all regions are extracted (no review or flagged remaining).
     */
    allExtracted: ({ context }) => {
      if (!context.counts) return false;
      return context.counts.review + context.counts.flagged === 0;
    },
  },

  actions: {
    /**
     * YAML: `assignItems: ctx.items = event.data.items; ctx.counts = event.data.counts`
     * DIVERGENCE #3: params pattern.
     */
    assignItems: assign(
      (
        _args,
        params: {
          items: IllustrationRegion[];
          counts: IllustrationCounts;
        },
      ): Partial<IllustrationsToolContext> => ({
        items: params.items,
        counts: params.counts,
      }),
    ),

    /**
     * YAML: `markExtracted + recount`
     * F5.4-7 divergence: recount folded into markExtracted assign.
     */
    markExtracted: assign(
      ({ context, event }): Partial<IllustrationsToolContext> => {
        if (event.type !== "CONFIRM_REGION") return {};
        const items = patchItemById(context.items, event.regionId, (r) => ({
          ...r,
          status: "extracted" as const,
        }));
        return { items, counts: recount(items) };
      },
    ),

    markExtractedSideEffect: ({ context, event }) => {
      if (event.type !== "CONFIRM_REGION") return;
      const region = context.items.find((r) => r.id === event.regionId);
      if (region) {
        void context.services.persistRegion(context.projectId, {
          ...region,
          status: "extracted",
        });
      }
    },

    /**
     * YAML: `patchRegion + persistRegion`
     * Bounds editing: ADJUST_BOUNDS patches region props.
     */
    patchRegion: assign(
      ({ context, event }): Partial<IllustrationsToolContext> => {
        if (event.type !== "ADJUST_BOUNDS") return {};
        return {
          items: patchItemById(context.items, event.regionId, (r) => ({
            ...r,
            ...event.patch,
          })),
        };
      },
    ),

    patchRegionSideEffect: ({ context, event }) => {
      if (event.type !== "ADJUST_BOUNDS") return;
      const region = context.items.find((r) => r.id === event.regionId);
      if (region) {
        void context.services.persistRegion(context.projectId, {
          ...region,
          ...event.patch,
        });
      }
    },

    /**
     * YAML: `removeRegion + recount`
     * F5.4-7 divergence: recount folded inline.
     */
    removeRegion: assign(
      ({ context, event }): Partial<IllustrationsToolContext> => {
        if (event.type !== "DROP_REGION") return {};
        const items = context.items.filter((r) => r.id !== event.regionId);
        return { items, counts: recount(items) };
      },
    ),

    removeRegionSideEffect: ({ context, event }) => {
      if (event.type !== "DROP_REGION") return;
      // At I1: call DELETE /api/projects/:id/stages/illustrations/regions/:regionId
      // For now, no-op (region removed from client state)
      void context.services.persistRegion(context.projectId, {
        id: event.regionId,
        page: "",
        kind: "plate",
        w: 0,
        h: 0,
        status: "extracted",
        note: "__dropped__",
      });
    },

    /** YAML: `assignFilter: ctx.galleryFilter = event.value` */
    assignFilter: assign({
      galleryFilter: ({ event }) => {
        if (event.type !== "SET_GALLERY_FILTER") return "all" as const;
        return event.value;
      },
    }),

    /**
     * YAML: `assignError: ctx.error = event.error`
     * DIVERGENCE #3: params pattern.
     */
    assignError: assign(
      (
        _args,
        params: { error: unknown },
      ): Partial<IllustrationsToolContext> => {
        let msg: string;
        if (params.error instanceof Error) {
          msg = params.error.message;
        } else if (typeof params.error === "string") {
          msg = params.error;
        } else {
          msg = "Unknown error";
        }
        return { error: { message: msg } };
      },
    ),

    /** YAML: `clearError: ctx.error = null` */
    clearError: assign({ error: () => null }),

    /** YAML: `exportCrops — SIDE EFFECT: download extracted crops` (no-op at F5) */
    exportCrops: () => {
      /* At I1: trigger crop download via GET /api/projects/:id/stages/illustrations/export */
    },

    /** YAML: `emitResolved — send parent: RESOLVE` (no-op at F5) */
    emitResolved: () => {
      /* At I1: send RESOLVE to the parent stageRunner actor */
    },
  },
}).createMachine({
  id: "illustrationsTool",
  initial: "detecting",

  context: ({
    input,
  }: {
    input: IllustrationsToolInput;
  }): IllustrationsToolContext => ({
    projectId: input.projectId,
    stageIndex: input.stageIndex,
    services: input.services,
    items: [],
    counts: null,
    galleryFilter: "all",
    error: null,
  }),

  states: {
    // -------------------------------------------------------------------------
    // detecting — invoke detectRegions
    // -------------------------------------------------------------------------
    detecting: {
      invoke: {
        src: "detectRegions",
        input: ({ context }) => ({
          projectId: context.projectId,
          services: context.services,
        }),
        onDone: [
          {
            // F5.4-6: needsALook guard uses params pattern (DIVERGENCE #3)
            guard: {
              type: "needsALook",
              params: ({ event }) => ({
                counts: event.output.counts,
              }),
            },
            target: "reviewing",
            actions: {
              type: "assignItems",
              params: ({ event }) => ({
                items: event.output.items,
                counts: event.output.counts,
              }),
            },
          },
          {
            // All extracted path
            target: "extracted",
            actions: [
              {
                type: "assignItems",
                params: ({ event }) => ({
                  items: event.output.items,
                  counts: event.output.counts,
                }),
              },
              "emitResolved",
            ],
          },
        ],
        onError: {
          target: "failed",
          actions: {
            type: "assignError",
            params: ({ event }) => ({ error: event.error }),
          },
        },
      },
    },

    // -------------------------------------------------------------------------
    // reviewing — flagged regions need confirmation or adjustment
    // -------------------------------------------------------------------------
    reviewing: {
      // F5.4-6: settleIfClear as always guard
      always: {
        guard: "allExtracted",
        target: "extracted",
        actions: ["emitResolved"],
      },
      on: {
        CONFIRM_REGION: {
          actions: ["markExtracted", "markExtractedSideEffect"],
        },
        ADJUST_BOUNDS: {
          actions: ["patchRegion", "patchRegionSideEffect"],
        },
        DROP_REGION: {
          actions: ["removeRegion", "removeRegionSideEffect"],
        },
        REDETECT: { target: "detecting" },
        SET_GALLERY_FILTER: { actions: ["assignFilter"] },
      },
    },

    // -------------------------------------------------------------------------
    // extracted — all crops named and ready for the proof pack
    // -------------------------------------------------------------------------
    extracted: {
      on: {
        EXPORT_CROPS: { actions: ["exportCrops"] },
        SET_GALLERY_FILTER: { actions: ["assignFilter"] },
        REDETECT: { target: "detecting" },
        UPSTREAM_CHANGED: { target: "detecting" },
      },
    },

    // -------------------------------------------------------------------------
    // failed — detection error
    // -------------------------------------------------------------------------
    failed: {
      on: {
        RETRY: {
          target: "detecting",
          actions: ["clearError"],
        },
      },
    },
  },
});
