/**
 * pagesGrid — XState v5 machine for the generic per-stage Pages tool.
 *
 * Ported from `docs/plans/design_handoff_pgdp_app/statecharts/tool-pages-grid.yaml`
 *
 * Used by the `crop` stage as its primary tool machine (see machine-stage-map.md §2).
 * Parallel regions: grid (browse / filter) and editor (closed / editing / saving /
 * confirmDiscard).
 *
 * ## Key invariants
 * - Only one page can be open in the editor at a time. OPEN_EDITOR always
 *   sets selectedPageId and transitions editor to `editing`.
 * - Dirty guard: `isDirty` checks draft !== null && draft ≠ original page.
 * - CLOSE / PREV_PAGE / NEXT_PAGE trigger `confirmDiscard` if dirty.
 * - Resolving a page (flags cleared after SAVE) emits PAGES_RESOLVED upstream.
 *
 * ## DIVERGENCES from YAML
 *   - DIVERGENCE #3: onDone uses event.output not event.data.
 *   - F5-3 (pagesGrid): `ready.editor.editing.PREV_PAGE` / `NEXT_PAGE` —
 *     the YAML uses `stepToPrevPage` / `stepToNextPage` as actions, but in
 *     XState v5 "actions + stay-in-state" semantics do not involve a target
 *     change, so these actions fire in-place inside `editing`. The YAML implies
 *     re-entering `editing` after navigation; we call `beginDraft` after
 *     `stepToNextPage` / `stepToPrevPage` to refresh the draft in-place. No
 *     explicit `target` is needed; XState v5 fires the actions and stays put.
 *   - F5-4 (pagesGrid): The `saveError` path targets `editing` rather than
 *     introducing a separate error substate inside saving. This matches the
 *     YAML's `onError: { target: editing, actions: [assignError] }`.
 *
 * @see docs/plans/design_handoff_pgdp_app/statecharts/tool-pages-grid.yaml
 * @see src/machines/DIVERGENCES.md
 */

import { setup, assign, fromPromise } from "xstate";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface CropPageRow {
  pageId: string;
  n: number;
  thumbUrl: string;
  flags: string[];
  bbox?: [number, number, number, number] | null;
  skewDeg?: number | null;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface PagesGridServices {
  /**
   * GET /api/projects/:id/stages/:stageId/pages -> CropPageRow[]
   */
  fetchPages(projectId: string, stageId: string): Promise<CropPageRow[]>;

  /**
   * PATCH /api/projects/:id/stages/:stageId/pages/:pageId -> CropPageRow
   */
  savePage(
    projectId: string,
    stageId: string,
    draft: CropPageRow,
  ): Promise<CropPageRow>;
}

// ---------------------------------------------------------------------------
// Input + Context
// ---------------------------------------------------------------------------

export interface PagesGridInput {
  projectId: string;
  stageId: string;
  stageIndex: number;
  services: PagesGridServices;
}

export interface PagesGridContext {
  projectId: string;
  stageId: string;
  stageIndex: number;
  services: PagesGridServices;
  pages: CropPageRow[];
  filter: string; // "all" | "flagged" | <flag-key>
  visible: CropPageRow[];
  selectedPageId: string | null;
  draft: CropPageRow | null;
  resolvedThisSession: string[];
  error: { message: string } | null;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type PagesGridEvent =
  | { type: "RETRY" }
  | { type: "SET_FILTER"; value: string }
  | { type: "SELECT_PAGE"; pageId: string }
  | { type: "OPEN_EDITOR"; pageId: string }
  | { type: "CLOSE" }
  | { type: "EDIT"; patch: Partial<CropPageRow> }
  | { type: "SAVE" }
  | { type: "ACCEPT" }
  | { type: "RESET" }
  | { type: "PREV_PAGE" }
  | { type: "NEXT_PAGE" }
  | { type: "DISCARD" }
  | { type: "KEEP" }
  | { type: "REFRESH" }
  | { type: "FLUSH_RESOLVED" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyFilter(pages: CropPageRow[], filter: string): CropPageRow[] {
  if (filter === "all") return pages;
  if (filter === "flagged") return pages.filter((p) => p.flags.length > 0);
  return pages.filter((p) => p.flags.includes(filter));
}

function deepEqualPage(a: CropPageRow, b: CropPageRow): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function findPage(
  pages: CropPageRow[],
  pageId: string,
): CropPageRow | undefined {
  return pages.find((p) => p.pageId === pageId);
}

function upsertPage(pages: CropPageRow[], page: CropPageRow): CropPageRow[] {
  const idx = pages.findIndex((p) => p.pageId === page.pageId);
  if (idx === -1) return [...pages, page];
  return pages.map((p, i) => (i === idx ? page : p));
}

function prevPageId(visible: CropPageRow[], currentId: string): string | null {
  const idx = visible.findIndex((p) => p.pageId === currentId);
  if (idx <= 0) return null;
  return visible[idx - 1]?.pageId ?? null;
}

function nextPageId(visible: CropPageRow[], currentId: string): string | null {
  const idx = visible.findIndex((p) => p.pageId === currentId);
  if (idx === -1 || idx >= visible.length - 1) return null;
  return visible[idx + 1]?.pageId ?? null;
}

// ---------------------------------------------------------------------------
// Machine
// ---------------------------------------------------------------------------

export const pagesGridMachine = setup({
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  types: {} as {
    context: PagesGridContext;
    events: PagesGridEvent;
    input: PagesGridInput;
  },

  actors: {
    /**
     * YAML: `invoke.src: fetchPages`
     * DIVERGENCE #3: onDone carries event.output.
     */
    fetchPages: fromPromise<
      CropPageRow[],
      { projectId: string; stageId: string; services: PagesGridServices }
    >(({ input }) => input.services.fetchPages(input.projectId, input.stageId)),

    /**
     * YAML: `invoke.src: savePage`
     * DIVERGENCE #3: onDone carries event.output.
     */
    savePage: fromPromise<
      CropPageRow,
      {
        projectId: string;
        stageId: string;
        draft: CropPageRow;
        services: PagesGridServices;
      }
    >(({ input }) =>
      input.services.savePage(input.projectId, input.stageId, input.draft),
    ),
  },

  guards: {
    /**
     * YAML: `isDirty: ctx.draft != null && !deepEqual(ctx.draft, pageOf(ctx.pages, ctx.selectedPageId))`
     */
    isDirty: ({ context }) => {
      if (!context.draft || !context.selectedPageId) return false;
      const original = findPage(context.pages, context.selectedPageId);
      if (!original) return false;
      return !deepEqualPage(context.draft, original);
    },

    /**
     * YAML: `hasResolved: ctx.resolvedThisSession.length > 0`
     */
    hasResolved: ({ context }) => context.resolvedThisSession.length > 0,
  },

  actions: {
    /**
     * YAML: `assignPages: ctx.pages = event.data`
     * DIVERGENCE #3: params pattern.
     */
    assignPages: assign(
      (
        _args,
        params: { output: CropPageRow[] },
      ): Partial<PagesGridContext> => ({
        pages: params.output,
      }),
    ),

    /**
     * YAML: `applyFilter: ctx.visible = ...`
     * Called after assignPages to compute the visible list from the new pages
     * and the current filter. Also called after assignFilter.
     */
    applyFilter: assign({
      visible: ({ context }) => applyFilter(context.pages, context.filter),
    }),

    /** YAML: `assignFilter: ctx.filter = event.value` */
    assignFilter: assign({
      filter: ({ event }) => {
        if (event.type !== "SET_FILTER") return "all";
        return event.value;
      },
      // Re-compute visible immediately (DIVERGENCE: inline vs two-action sequence)
      visible: ({ context, event }) => {
        if (event.type !== "SET_FILTER") return context.visible;
        return applyFilter(context.pages, event.value);
      },
    }),

    /** YAML: `assignSelected: ctx.selectedPageId = event.pageId` */
    assignSelected: assign({
      selectedPageId: ({ event }) => {
        if (event.type !== "SELECT_PAGE" && event.type !== "OPEN_EDITOR")
          return null;
        return event.pageId;
      },
    }),

    /** YAML: `beginDraft: ctx.draft = clone(pageOf(ctx.pages, ctx.selectedPageId))` */
    beginDraft: assign({
      draft: ({ context }) => {
        const page = context.selectedPageId
          ? findPage(context.pages, context.selectedPageId)
          : null;
        return page ? { ...page } : null;
      },
    }),

    /** YAML: `updateDraft: ctx.draft = { ...ctx.draft, ...event.patch }` */
    updateDraft: assign({
      draft: ({ context, event }) => {
        if (event.type !== "EDIT") return context.draft;
        return context.draft ? { ...context.draft, ...event.patch } : null;
      },
    }),

    /** YAML: `revertDraft: ctx.draft = clone(pageOf(ctx.pages, ctx.selectedPageId))` */
    revertDraft: assign({
      draft: ({ context }) => {
        const page = context.selectedPageId
          ? findPage(context.pages, context.selectedPageId)
          : null;
        return page ? { ...page } : null;
      },
    }),

    /** YAML: `clearDraft: ctx.draft = null; ctx.selectedPageId = null` */
    clearDraft: assign({
      draft: () => null,
      selectedPageId: () => null,
    }),

    /**
     * YAML: `markAccept: ctx.draft = { ...clone(page), flags: [] }`
     * Marks a flagged page as acceptable without geometry edits.
     */
    markAccept: assign({
      draft: ({ context }) => {
        const page = context.selectedPageId
          ? findPage(context.pages, context.selectedPageId)
          : null;
        return page ? { ...page, flags: [] } : null;
      },
    }),

    /**
     * YAML: `stepToPrevPage: selectedPageId = prev in ctx.visible`
     * F5-3: sets selectedPageId to prev in visible, then beginDraft refreshes.
     */
    stepToPrevPage: assign({
      selectedPageId: ({ context }) => {
        if (!context.selectedPageId) return null;
        return (
          prevPageId(context.visible, context.selectedPageId) ??
          context.selectedPageId
        );
      },
    }),

    /**
     * YAML: `stepToNextPage: selectedPageId = next in ctx.visible`
     */
    stepToNextPage: assign({
      selectedPageId: ({ context }) => {
        if (!context.selectedPageId) return null;
        return (
          nextPageId(context.visible, context.selectedPageId) ??
          context.selectedPageId
        );
      },
    }),

    /**
     * YAML: `commitPage: merge event.data back into ctx.pages + re-applyFilter`
     * DIVERGENCE #3: params pattern.
     */
    commitPage: assign(
      (
        { context },
        params: { output: CropPageRow },
      ): Partial<PagesGridContext> => {
        const newPages = upsertPage(context.pages, params.output);
        return {
          pages: newPages,
          visible: applyFilter(newPages, context.filter),
        };
      },
    ),

    /**
     * YAML: `recordResolved: if saved page has no flags, push pageId to resolvedThisSession`
     * DIVERGENCE #3: params pattern.
     */
    recordResolved: assign(
      (
        { context },
        params: { output: CropPageRow },
      ): Partial<PagesGridContext> => {
        if (params.output.flags.length === 0) {
          return {
            resolvedThisSession: [
              ...context.resolvedThisSession,
              params.output.pageId,
            ],
          };
        }
        return {};
      },
    ),

    /** YAML: `emitResolvedMaybe` — side effect slot, no-op at F5 */
    emitResolvedMaybe: () => {
      // SIDE EFFECT: emit PAGES_RESOLVED immediately if page flags cleared — at I1
    },

    /** YAML: `emitResolved: send to parent PAGES_RESOLVED` */
    emitResolved: () => {
      // SIDE EFFECT: send parent PAGES_RESOLVED with stageIndex + resolvedIds — at I1
    },

    /** YAML: `clearResolvedBuffer: ctx.resolvedThisSession = []` */
    clearResolvedBuffer: assign({
      resolvedThisSession: () => [] as string[],
    }),

    /** YAML: `assignError` (from onError) */
    assignError: assign(
      (_args, params: { error: unknown }): Partial<PagesGridContext> => {
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

    /** YAML: `clearError` */
    clearError: assign({ error: () => null }),
  },
}).createMachine({
  id: "pagesGrid",

  context: ({ input }) => ({
    projectId: input.projectId,
    stageId: input.stageId,
    stageIndex: input.stageIndex,
    services: input.services,
    pages: [],
    filter: "all",
    visible: [],
    selectedPageId: null,
    draft: null,
    resolvedThisSession: [],
    error: null,
  }),

  initial: "loading",

  states: {
    loading: {
      invoke: {
        id: "fetchPages",
        src: "fetchPages",
        input: ({ context }) => ({
          projectId: context.projectId,
          stageId: context.stageId,
          services: context.services,
        }),
        onDone: {
          target: "ready",
          actions: [
            {
              type: "assignPages",
              params: ({ event }: { event: { output: CropPageRow[] } }) => ({
                output: event.output,
              }),
            },
            "applyFilter",
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

    loadError: {
      on: {
        RETRY: { target: "loading", actions: ["clearError"] },
      },
    },

    ready: {
      type: "parallel",

      states: {
        // ---- Region: grid -------------------------------------------------
        grid: {
          initial: "browsing",
          states: {
            browsing: {
              on: {
                SET_FILTER: { actions: ["assignFilter"] },
                SELECT_PAGE: { actions: ["assignSelected"] },
                REFRESH: { target: "#pagesGrid.loading" },
              },
            },
          },
        },

        // ---- Region: editor (exclusive inline page editor) ----------------
        editor: {
          initial: "closed",
          states: {
            closed: {
              on: {
                OPEN_EDITOR: {
                  target: "editing",
                  actions: ["assignSelected", "beginDraft"],
                },
              },
            },

            editing: {
              initial: "clean",
              on: {
                CLOSE: [
                  {
                    target: "confirmDiscard",
                    guard: "isDirty",
                  },
                  {
                    target: "closed",
                    actions: ["clearDraft"],
                  },
                ],
                PREV_PAGE: [
                  {
                    target: "confirmDiscard",
                    guard: "isDirty",
                  },
                  {
                    // F5-3 divergence: stay in editing, step + refresh draft
                    actions: ["stepToPrevPage", "beginDraft"],
                  },
                ],
                NEXT_PAGE: [
                  {
                    target: "confirmDiscard",
                    guard: "isDirty",
                  },
                  {
                    actions: ["stepToNextPage", "beginDraft"],
                  },
                ],
              },
              states: {
                clean: {
                  on: {
                    EDIT: { target: "dirty", actions: ["updateDraft"] },
                    ACCEPT: {
                      target: "#pagesGrid.ready.editor.saving",
                      actions: ["markAccept"],
                    },
                  },
                },
                dirty: {
                  on: {
                    EDIT: { actions: ["updateDraft"] },
                    SAVE: { target: "#pagesGrid.ready.editor.saving" },
                    RESET: { target: "clean", actions: ["revertDraft"] },
                  },
                },
              },
            },

            saving: {
              invoke: {
                id: "savePage",
                src: "savePage",
                input: ({ context }) => ({
                  projectId: context.projectId,
                  stageId: context.stageId,
                  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- save only fires when editor is in saving (draft always non-null)
                  draft: context.draft!,
                  services: context.services,
                }),
                onDone: {
                  target: "closed",
                  actions: [
                    {
                      type: "commitPage",
                      params: ({
                        event,
                      }: {
                        event: { output: CropPageRow };
                      }) => ({ output: event.output }),
                    },
                    {
                      type: "recordResolved",
                      params: ({
                        event,
                      }: {
                        event: { output: CropPageRow };
                      }) => ({ output: event.output }),
                    },
                    "emitResolvedMaybe",
                    "clearDraft",
                  ],
                },
                onError: {
                  target: "editing",
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

            confirmDiscard: {
              on: {
                DISCARD: { target: "closed", actions: ["clearDraft"] },
                KEEP: { target: "editing" },
              },
            },
          },
        },
      },

      on: {
        FLUSH_RESOLVED: {
          guard: "hasResolved",
          actions: ["emitResolved", "clearResolvedBuffer"],
        },
      },
    },
  },
});
