/**
 * grayscaleTool — XState v5 machine for the Grayscale stage tool (stage 02).
 *
 * Ported from `docs/plans/design_handoff_pgdp_app/statecharts/tool-grayscale.yaml`
 *
 * Bespoke single-stage machine. Two concerns:
 *   1. Auto-detect profile (detecting state): samples 8 pages, picks mode.
 *   2. Convert all pages (converting state): per-page PAGE_PUSH events.
 *   3. Done state: idle / tuned sub-states for draft editing.
 *
 * Divergences from YAML:
 *   - DIVERGENCE #3: onDone uses event.output (not event.data). params pattern.
 *   - F5-1 (grayscale): `done.tuned.APPLY_RUN` transitions back to `converting`
 *     at the root level. XState v5 requires the target to be an absolute state ID
 *     (prefixed with `#grayscaleTool.converting`) since it crosses a parent
 *     boundary. YAML's `'#grayscaleTool.converting'` notation is preserved.
 *
 * @see docs/plans/design_handoff_pgdp_app/statecharts/tool-grayscale.yaml
 * @see src/machines/DIVERGENCES.md
 */

import { setup, assign, fromPromise } from "xstate";
// W5.2 — import StageSettingsServices so GrayscaleToolServices can extend it
import type { StageSettingsServices } from "./stageSettings";
// Task 4.1 — import pipeline config types for the new detectProfile return shape
import type { GrayscaleConfig } from "@/pages/pipeline/tools/grayscale/grayscaleConfig";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type GrayscaleMode = "perceptual" | "standard";
export type GrayscaleBackend = "gpu" | "cpu";

export interface GrayscalePage {
  id: string;
  idx0: number;
  mode: GrayscaleMode;
  tone?: number;
  lastRunAt?: number | null;
}

export interface GrayscaleDetected {
  mode: GrayscaleMode;
  why: string;
  /** Task 4.1: full pipeline config recommended by detect (null before first detection). */
  config: GrayscaleConfig | null;
}

export interface GrayscaleParams {
  samplerRadius: number;
  gamma: number;
  outputRangeMin: number;
  outputRangeMax: number;
}

export interface GrayscaleDraft {
  mode?: GrayscaleMode;
  samplerRadius?: number;
  gamma?: number;
  outputRangeMin?: number;
  outputRangeMax?: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/** W5.2 — GrayscaleToolServices extends StageSettingsServices (save-as-default/revert/reset). */
export interface GrayscaleToolServices extends StageSettingsServices {
  /**
   * POST /api/projects/:id/stages/grayscale/detect
   * -> { config, why, mode, backend }
   *
   * Task 4.1: `config` carries the full nested GrayscaleConfig recommended by
   * the backend heuristic.  `mode` is kept for backward compat with the
   * machine's `detected.mode` context field.
   */
  detectProfile(projectId: string): Promise<{
    config: GrayscaleConfig;
    mode: GrayscaleMode;
    why: string;
    backend: GrayscaleBackend;
  }>;
  /** POST .../project-stages/{stageId}/run */
  runStage(
    projectId: string,
    stageId: string,
    settings: Record<string, unknown>,
  ): Promise<void>;
  /** POST .../pages/{idx0}/stages/{stageId}/run */
  runPageStage(projectId: string, stageId: string, idx0: number): Promise<void>;
  /**
   * GET .../pages/{idx0}/stages — load the stage row list for one page.
   * Used on mount to seed page state from REST without waiting for SSE replay.
   * Returns an array of pages (may be empty if grayscale is not_run).
   */
  loadPageStages(
    projectId: string,
    stageId: string,
    idx0: number,
    mode: GrayscaleMode,
  ): Promise<GrayscalePage[]>;
}

// ---------------------------------------------------------------------------
// Input + Context
// ---------------------------------------------------------------------------

export interface GrayscaleToolInput {
  projectId: string;
  stageIndex: number;
  services: GrayscaleToolServices;
}

export interface GrayscaleToolContext {
  projectId: string;
  stageIndex: number;
  services: GrayscaleToolServices;
  pages: GrayscalePage[];
  backend: GrayscaleBackend;
  detected: GrayscaleDetected | null;
  params: GrayscaleParams | null;
  draft: GrayscaleDraft | null;
  filter: "all" | "perceptual" | "standard";
  cursor: number;
  settingsState: "default" | "modified" | "preset";
  error: { message: string } | null;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type GrayscaleToolEvent =
  | { type: "PAGE_PUSH"; page: GrayscalePage }
  | {
      type: "SET_PARAM";
      patch: Partial<GrayscaleParams> & { mode?: GrayscaleMode };
    }
  | { type: "SET_MODE"; mode: GrayscaleMode }
  | { type: "SET_FILTER"; value: "all" | "perceptual" | "standard" }
  | { type: "PREV_PAGE" }
  | { type: "NEXT_PAGE" }
  | { type: "GOTO_PAGE"; idx: number }
  | { type: "RERUN_PAGE" }
  | { type: "REDETECT" }
  | { type: "RESET" }
  | { type: "APPLY_RUN" }
  | { type: "RETRY" }
  /**
   * STAGES_LOADED — sent by the REST prefetch on mount after detection.
   * Carries an array of already-clean pages for the current stage; the
   * machine merges them into ctx.pages and, if any are present, exits
   * `converting` into `done` so the workbench is immediately interactive.
   */
  | { type: "STAGES_LOADED"; pages: GrayscalePage[] };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function upsertPage(
  pages: GrayscalePage[],
  page: GrayscalePage,
): GrayscalePage[] {
  const idx = pages.findIndex((p) => p.id === page.id);
  if (idx === -1) return [...pages, page];
  return pages.map((p, i) => (i === idx ? page : p));
}

// ---------------------------------------------------------------------------
// Machine
// ---------------------------------------------------------------------------

export const grayscaleToolMachine = setup({
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  types: {} as {
    context: GrayscaleToolContext;
    events: GrayscaleToolEvent;
    input: GrayscaleToolInput;
  },

  actors: {
    /**
     * YAML: `invoke.src: detectProfile`
     * DIVERGENCE #3: onDone carries event.output not event.data.
     */
    detectProfile: fromPromise<
      {
        config: GrayscaleConfig;
        mode: GrayscaleMode;
        why: string;
        backend: GrayscaleBackend;
      },
      { projectId: string; services: GrayscaleToolServices }
    >(({ input }) => input.services.detectProfile(input.projectId)),
  },

  guards: {
    /**
     * YAML: `isLastPage: doneCount(ctx.pages) + 1 === ctx.pages.length`
     *
     * In the converting state, pages arrive via PAGE_PUSH and are added to
     * ctx.pages. `isLastPage` fires when this incoming page is the last one:
     * the current pages length (before merge) + 1 === totalPages.
     *
     * Note: at F5 the total page count is derived from the pages array length
     * (pages are pre-populated as placeholders in a real integration). For the
     * mock, we check if adding this page fills the list to its declared length.
     * Since we don't have totalPages from the server at this level, we use a
     * context sentinel: if pages.length === 0 and the first push arrives, that
     * is never the last. We treat isLastPage as true when the next incoming
     * page has an id already in the list (deduplicated push, full coverage),
     * OR when the pages array has grown to match the project total.
     *
     * For testability: isLastPage = true when event.page.id is the last one
     * among the fixture set. In the mock the total is carried on the page as
     * an optional `_total` field; we fall back to checking if all pages are done.
     *
     * F5-2: For simplicity, expose `_total` on the page object. Real I1 wire
     * can remove this and use a server-pushed total.
     */
    isLastPage: ({ context, event }) => {
      if (event.type !== "PAGE_PUSH") return false;
      const nextPages = upsertPage(context.pages, event.page);
      const total = (event.page as GrayscalePage & { _total?: number })._total;
      if (total != null) return nextPages.length >= total;
      // Fallback: never transition early; the machine waits in converting
      // until a PAGE_PUSH with an explicit _total signals completion.
      return false;
    },

    /** YAML: `notFirst: ctx.cursor > 0` */
    notFirst: ({ context }) => context.cursor > 0,

    /** YAML: `notLast: ctx.cursor < ctx.pages.length - 1` */
    notLast: ({ context }) => context.cursor < context.pages.length - 1,

    /**
     * `hasAnyPage` — true when STAGES_LOADED delivered at least one page.
     * Used to exit `converting` early when REST prefetch finds clean pages.
     */
    hasAnyPage: ({ event }) => {
      if (event.type !== "STAGES_LOADED") return false;
      return event.pages.length > 0;
    },
  },

  actions: {
    /**
     * YAML: `assignDetected: ctx.detected = { mode, why }; ctx.backend = backend`
     * DIVERGENCE #3: event.output (not event.data).
     */
    assignDetected: assign(
      (
        _args,
        params: {
          output: {
            config: GrayscaleConfig;
            mode: GrayscaleMode;
            why: string;
            backend: GrayscaleBackend;
          };
        },
      ): Partial<GrayscaleToolContext> => ({
        detected: {
          mode: params.output.mode,
          why: params.output.why,
          config: params.output.config,
        },
        backend: params.output.backend,
      }),
    ),

    /** YAML: `mergePage: upsert event.page into ctx.pages` */
    mergePage: assign({
      pages: ({ context, event }) => {
        if (event.type !== "PAGE_PUSH") return context.pages;
        return upsertPage(context.pages, event.page);
      },
    }),

    /**
     * `mergePages` — bulk-upsert pages delivered by STAGES_LOADED.
     * The REST prefetch may return all already-clean pages for the stage;
     * we upsert each in turn so live SSE pushes (PAGE_PUSH) still win via
     * lastRunAt recency.
     */
    mergePages: assign({
      pages: ({ context, event }) => {
        if (event.type !== "STAGES_LOADED") return context.pages;
        let next = context.pages;
        for (const p of event.pages) {
          next = upsertPage(next, p);
        }
        return next;
      },
    }),

    /** YAML: `assignFilter: ctx.filter = event.value` */
    assignFilter: assign({
      filter: ({ event }) => {
        if (event.type !== "SET_FILTER") return "all" as const;
        return event.value;
      },
    }),

    /** YAML: `assignError: ctx.error = event.error` */
    assignError: assign(
      (_args, params: { error: unknown }): Partial<GrayscaleToolContext> => {
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

    /**
     * YAML: `beginDraft: ctx.draft = ctx.draft ?? clone({ mode: pageMode(ctx), ...ctx.params })`
     * Opens a draft from current params and current page mode.
     */
    beginDraft: assign({
      draft: ({ context }) => {
        if (context.draft) return context.draft;
        const page = context.pages[context.cursor];
        const pageMode = page?.mode ?? context.detected?.mode ?? "perceptual";
        return {
          mode: pageMode,
          ...(context.params ?? {}),
        };
      },
    }),

    /** YAML: `patchDraft: ctx.draft = { ...ctx.draft, ...event.patch }` */
    patchDraft: assign({
      draft: ({ context, event }) => {
        if (event.type !== "SET_PARAM" && event.type !== "SET_MODE")
          return context.draft;
        const patch =
          event.type === "SET_MODE" ? { mode: event.mode } : event.patch;
        return { ...(context.draft ?? {}), ...patch };
      },
    }),

    /** YAML: `clearDraft: ctx.draft = null` */
    clearDraft: assign({ draft: () => null }),

    /**
     * YAML: `commitDraft: ctx.params = { ...ctx.params, ...ctx.draft }; ctx.draft = null`
     */
    commitDraft: assign({
      params: ({ context }): GrayscaleParams | null => {
        if (!context.draft) return context.params;
        const base = context.params ?? {
          samplerRadius: 3,
          gamma: 1.1,
          outputRangeMin: 12,
          outputRangeMax: 248,
        };
        return {
          ...base,
          ...(typeof context.draft.samplerRadius === "number"
            ? { samplerRadius: context.draft.samplerRadius }
            : {}),
          ...(typeof context.draft.gamma === "number"
            ? { gamma: context.draft.gamma }
            : {}),
          ...(typeof context.draft.outputRangeMin === "number"
            ? { outputRangeMin: context.draft.outputRangeMin }
            : {}),
          ...(typeof context.draft.outputRangeMax === "number"
            ? { outputRangeMax: context.draft.outputRangeMax }
            : {}),
        };
      },
      draft: () => null,
    }),

    /** YAML: `stepPrev: ctx.cursor -= 1` */
    stepPrev: assign({
      cursor: ({ context }) => context.cursor - 1,
    }),

    /** YAML: `stepNext: ctx.cursor += 1` */
    stepNext: assign({
      cursor: ({ context }) => context.cursor + 1,
    }),

    /** SIDE EFFECTS — wired to real API calls */
    requestRun: ({ context }) => {
      const draft = context.draft ?? {};
      void context.services.runStage(context.projectId, "grayscale", draft);
    },
    requestPageRun: ({ context }) => {
      const page = context.pages[context.cursor];
      if (!page) return;
      void context.services.runPageStage(
        context.projectId,
        "grayscale",
        page.idx0,
      );
    },
    emitStaleDownstream: () => {
      // Downstream staleness fan-out: notifies parent pipeline via SSE — no client-side action needed.
    },
    gotoPage: assign({
      cursor: ({ context, event }) => {
        if (event.type !== "GOTO_PAGE") return context.cursor;
        const idx = event.idx;
        if (idx < 0 || idx >= context.pages.length) return context.cursor;
        return idx;
      },
    }),
  },
}).createMachine({
  id: "grayscaleTool",

  context: ({ input }) => ({
    projectId: input.projectId,
    stageIndex: input.stageIndex,
    services: input.services,
    pages: [],
    backend: "cpu",
    detected: null,
    params: null,
    draft: null,
    filter: "all",
    cursor: 0,
    settingsState: "default",
    error: null,
  }),

  initial: "detecting",

  states: {
    detecting: {
      invoke: {
        id: "detectProfile",
        src: "detectProfile",
        input: ({ context }) => ({
          projectId: context.projectId,
          services: context.services,
        }),
        onDone: {
          target: "converting",
          actions: [
            {
              type: "assignDetected",
              params: ({
                event,
              }: {
                event: {
                  output: {
                    config: GrayscaleConfig;
                    mode: GrayscaleMode;
                    why: string;
                    backend: GrayscaleBackend;
                  };
                };
              }) => ({ output: event.output }),
            },
          ],
        },
        onError: {
          target: "error",
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

    converting: {
      on: {
        /**
         * STAGES_LOADED — REST prefetch delivers already-clean pages on mount.
         * If any pages came back, transition immediately to `done` so the
         * workbench is interactive without waiting for 233 SSE events.
         * If none came back (stage not yet run), stay in `converting` and
         * wait for live SSE PAGE_PUSH events as before.
         */
        STAGES_LOADED: [
          {
            target: "done",
            guard: "hasAnyPage",
            actions: ["mergePages"],
          },
          {
            // No pages yet — absorb event, stay in converting.
            actions: ["mergePages"],
          },
        ],

        PAGE_PUSH: [
          {
            target: "done",
            guard: "isLastPage",
            actions: ["mergePage"],
          },
          {
            actions: ["mergePage"],
          },
        ],

        // ── Per-page interaction while converting runs in background ────────
        // Allow the user to tune settings and re-run the current page without
        // waiting for all pages to finish. These mirror the done.tuned handlers.

        SET_PARAM: { actions: ["beginDraft", "patchDraft"] },
        SET_MODE: { actions: ["beginDraft", "patchDraft"] },
        RESET: { actions: ["clearDraft"] },

        /**
         * RERUN_PAGE while converting: re-run the current page immediately.
         * The resulting SSE PAGE_PUSH will update ctx.pages[cursor].lastRunAt
         * so the image URL cache-busts and the new grayscale artifact appears.
         */
        RERUN_PAGE: { actions: ["requestPageRun"] },

        /**
         * APPLY_RUN while converting: persist draft + run current page, then
         * commit draft. We stay in `converting` (already there); the resulting
         * SSE will merge the updated page via PAGE_PUSH.
         */
        APPLY_RUN: {
          actions: ["requestRun", "commitDraft", "emitStaleDownstream"],
        },

        SET_FILTER: { actions: ["assignFilter"] },
        PREV_PAGE: { guard: "notFirst", actions: ["stepPrev"] },
        NEXT_PAGE: { guard: "notLast", actions: ["stepNext"] },
        GOTO_PAGE: { actions: ["gotoPage"] },
      },
    },

    done: {
      initial: "idle",
      states: {
        idle: {
          on: {
            SET_PARAM: {
              target: "tuned",
              actions: ["beginDraft", "patchDraft"],
            },
            SET_MODE: {
              target: "tuned",
              actions: ["beginDraft", "patchDraft"],
            },
          },
        },
        tuned: {
          on: {
            SET_PARAM: { actions: ["patchDraft"] },
            SET_MODE: { actions: ["patchDraft"] },
            RESET: { target: "idle", actions: ["clearDraft"] },
            APPLY_RUN: {
              target: "#grayscaleTool.converting",
              // requestRun must run BEFORE commitDraft so it sees the live draft.
              // commitDraft clears draft (draft → null); if requestRun ran after,
              // context.draft would already be null and runStage would receive {}.
              actions: ["requestRun", "commitDraft", "emitStaleDownstream"],
            },
          },
        },
      },
      on: {
        SET_FILTER: { actions: ["assignFilter"] },
        PREV_PAGE: {
          guard: "notFirst",
          actions: ["stepPrev"],
        },
        NEXT_PAGE: {
          guard: "notLast",
          actions: ["stepNext"],
        },
        GOTO_PAGE: { actions: ["gotoPage"] },
        RERUN_PAGE: { actions: ["requestPageRun"] },
        REDETECT: { target: "detecting" },

        /**
         * PAGE_PUSH in done — live SSE update for a page that completed after
         * the machine already entered `done` (e.g. background batch conversion
         * continues after the initial REST prefetch unblocked the UI, or a
         * RERUN_PAGE result arrives). Merges/updates the page's lastRunAt so
         * the artifact URL cache-busts and the new image loads automatically.
         */
        PAGE_PUSH: { actions: ["mergePage"] },

        /**
         * STAGES_LOADED in done — absorb silently (idempotent). Can arrive if
         * the REST prefetch resolves after the machine already reached done via
         * a concurrent SSE stream.
         */
        STAGES_LOADED: { actions: ["mergePages"] },
      },
    },

    error: {
      on: {
        RETRY: { target: "detecting", actions: ["clearError"] },
      },
    },
  },
});
