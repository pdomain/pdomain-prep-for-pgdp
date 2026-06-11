/**
 * ocrTool — XState v5 machine for the OCR stage tool.
 *
 * Ported from `docs/plans/design_handoff_pgdp_app/statecharts/tool-ocr.yaml`
 * with the mechanical conventions in DIVERGENCES.md.
 *
 * Stage: ocr (page-scoped, OCR group)
 *
 * ## Recognition loop
 * `recognising` → PAGE_PUSH events merge per-page results → `reviewing` when
 * the last page completes. DIVERGENCE: `runComplete` checks `done + 1 === total`
 * in the YAML but in XState v5 we check the post-merge totals (all running === 0).
 *
 * ## Per-page word-box review (Recognition tab)
 * `reviewing.recognition` — one page open, low-score tokens with a suggested
 * reading. ACCEPT_TOKEN swaps a token to its suggestion; ACCEPT_PAGE marks the
 * page reviewed; NEXT_FLAGGED advances to the next flagged page or returns to
 * the grid.
 *
 * ## Engine config
 * SET_ENGINE / SET_BACKEND / SET_WEIGHTS / ADD_OVERRIDE / EDIT_OVERRIDE are
 * machine-level events per DIVERGENCES.md #7 (available throughout, not scoped
 * to a single super-state). Saving engine/backend/model changes re-runs OCR and
 * stales 15 downstream stages — the most expensive settings edit after
 * grayscale.
 *
 * @see docs/plans/design_handoff_pgdp_app/statecharts/tool-ocr.yaml
 * @see src/machines/DIVERGENCES.md — conventions
 */

import { setup, assign, fromPromise } from "xstate";
// W5.2 — import StageSettingsServices so OcrToolServices can extend it
import type { StageSettingsServices } from "./stageSettings";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface OcrPageRow {
  idx: string;
  prefix: string;
  state: "running" | "clean" | "flagged" | "reviewed" | "failed";
  flags?: string[];
  meanConf?: number; // 0–1 mean OCR confidence
  lowConf?: number; // count of low-score words
  words?: number; // total recognised word count
  illust?: boolean; // illustration page (no text)
  override?: OcrOverride | null;
  pageNumber?: number;
  [key: string]: unknown;
}

export interface OcrTotals {
  total: number;
  done: number;
  words: number;
  meanConf: number; // 0–1
  lowConfWords: number;
  flagged: number;
  clean: number;
  reviewed: number;
  rateHz?: number;
  running?: number;
  [key: string]: unknown;
}

export interface OcrToken {
  id: string;
  word: string;
  suggest: string;
  conf: number; // 0–1
}

export interface OcrOverride {
  pages: string; // page range label e.g. "0015–0023"
  count: number;
  engine: "doctr" | "tesseract";
  lang: string;
  reason: string;
  label?: string; // short display label
}

export type OcrEngine = "doctr" | "tesseract";
export type OcrBackend = "gpu" | "cpu";

// ---------------------------------------------------------------------------
// Services interface
// ---------------------------------------------------------------------------

/** W5.2 — OcrToolServices extends StageSettingsServices (save-as-default/revert/reset). */
export interface OcrToolServices extends StageSettingsServices {
  /**
   * GET /api/projects/:id/stages/ocr/pages -> low-score tokens for one page
   */
  fetchPageTokens(
    projectId: string,
    pageId: string,
  ): Promise<{ tokens: OcrToken[] }>;

  /**
   * POST /api/projects/:id/stages/ocr/confirm -> { ok }
   */
  confirmStage(projectId: string): Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// Input + Context
// ---------------------------------------------------------------------------

export interface OcrToolInput {
  projectId: string;
  stageIndex: number;
  services: OcrToolServices;
}

export interface OcrToolContext {
  projectId: string;
  stageIndex: number;
  services: OcrToolServices;

  rows: OcrPageRow[];
  totals: OcrTotals | null;

  engine: OcrEngine;
  backend: OcrBackend;
  /** Custom weights patch — shape TBD at I1. */
  _weights: Record<string, string>;
  overrides: OcrOverride[];

  /** Page open in the Recognition tab, or null. */
  cursor: string | null;
  /** Low-score tokens for the cursor page. */
  tokens: OcrToken[];
  /** Token IDs accepted this page session. */
  accepted: string[];

  error: { message: string } | null;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type OcrToolEvent =
  // Recognition loop
  | { type: "PAGE_PUSH"; row: OcrPageRow }
  | { type: "PAUSE" }
  // Grid sub-state
  | { type: "OPEN_RECOGNITION"; idx: string }
  | { type: "RE_OCR_SELECTION" }
  // Recognition sub-state
  | { type: "ACCEPT_TOKEN"; tokenId: string }
  | { type: "ACCEPT_PAGE" }
  | { type: "NEXT_FLAGGED" }
  | { type: "RE_OCR_PAGE" }
  | { type: "CLOSE" }
  // Confirm gate
  | { type: "CONFIRM_ADVANCE" }
  // Machine-level engine config — available throughout (DIVERGENCES.md #7)
  | { type: "SET_ENGINE"; value: OcrEngine }
  | { type: "SET_BACKEND"; value: OcrBackend }
  | { type: "SET_WEIGHTS"; patch: Record<string, string> }
  | { type: "ADD_OVERRIDE"; override: OcrOverride }
  | { type: "EDIT_OVERRIDE"; index: number; patch: Partial<OcrOverride> }
  // Lifecycle
  | { type: "UPSTREAM_CHANGED" }
  | { type: "SETTINGS_CHANGED" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function recountOcr(rows: OcrPageRow[]): OcrTotals {
  const total = rows.length;
  const running = rows.filter((r) => r.state === "running").length;
  const flagged = rows.filter((r) => r.state === "flagged").length;
  const clean = rows.filter((r) => r.state === "clean").length;
  const reviewed = rows.filter((r) => r.state === "reviewed").length;
  const done = total - running;
  const words = rows.reduce((s, r) => s + (r.words ?? 0), 0);
  const nonIllust = rows.filter((r) => !r.illust && r.state !== "running");
  const meanConf =
    nonIllust.length > 0
      ? nonIllust.reduce((s, r) => s + (r.meanConf ?? 1), 0) / nonIllust.length
      : 1;
  const lowConfWords = rows.reduce((s, r) => s + (r.lowConf ?? 0), 0);
  return {
    total,
    done,
    words,
    meanConf,
    lowConfWords,
    flagged,
    clean,
    reviewed,
    running,
  };
}

function upsertOcrRow(rows: OcrPageRow[], row: OcrPageRow): OcrPageRow[] {
  const idx = rows.findIndex((r) => r.idx === row.idx);
  if (idx === -1) return [...rows, row];
  return rows.map((r, i) => (i === idx ? row : r));
}

function nextFlaggedAfter(
  rows: OcrPageRow[],
  cursor: string | null,
): string | null {
  if (!cursor) return null;
  const flaggedIdxs = rows
    .filter((r) => r.state === "flagged")
    .map((r) => r.idx);
  if (flaggedIdxs.length === 0) return null;
  const pos = flaggedIdxs.indexOf(cursor);
  if (pos === -1 || pos === flaggedIdxs.length - 1) return null;
  return flaggedIdxs[pos + 1] ?? null;
}

// ---------------------------------------------------------------------------
// Machine
// ---------------------------------------------------------------------------

export const ocrToolMachine = setup({
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  types: {} as {
    context: OcrToolContext;
    events: OcrToolEvent;
    input: OcrToolInput;
  },

  // NOTE: ocrTool receives PAGE_PUSH events from the SSE actor (at I1).
  // The only invoked actor is confirmStage.
  // fetchPageTokens is a side-effect triggered by loadTokens action (at I1).
  actors: {
    /** YAML: `invoke.src: confirmStage` */
    confirmStage: fromPromise<
      { ok: boolean },
      { projectId: string; services: OcrToolServices }
    >(({ input }) => input.services.confirmStage(input.projectId)),
  },

  guards: {
    /**
     * YAML: `runComplete: ctx.totals.done + 1 === ctx.totals.total`
     *
     * We check post-merge totals (all pages done), consistent with
     * DIVERGENCES.md #4 pattern for PAGE_PUSH guards.
     */
    runComplete: ({ context, event }) => {
      if (event.type !== "PAGE_PUSH") return false;
      const updatedRows = upsertOcrRow(context.rows, event.row);
      const running = updatedRows.filter((r) => r.state === "running").length;
      return running === 0;
    },

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

    /**
     * YAML: `hasNextFlagged: nextFlaggedAfter(ctx.rows, ctx.cursor) != null`
     */
    hasNextFlagged: ({ context }) =>
      nextFlaggedAfter(context.rows, context.cursor) !== null,
  },

  actions: {
    /**
     * YAML: `mergePage` — upsert event.row; recount totals.
     * DIVERGENCES.md #9: recount inlined.
     */
    mergePage: assign({
      rows: ({ context, event }) => {
        if (event.type !== "PAGE_PUSH") return context.rows;
        return upsertOcrRow(context.rows, event.row);
      },
      totals: ({ context, event }) => {
        if (event.type !== "PAGE_PUSH") return context.totals;
        const newRows = upsertOcrRow(context.rows, event.row);
        return recountOcr(newRows);
      },
    }),

    /**
     * YAML: `assignCursor: ctx.cursor = event.idx`
     */
    assignCursor: assign({
      cursor: ({ event }) => {
        if (event.type !== "OPEN_RECOGNITION") return null;
        return event.idx;
      },
    }),

    /**
     * YAML: `clearCursor: ctx.cursor = null`
     */
    clearCursor: assign({ cursor: () => null }),

    /**
     * YAML: `loadTokens` — SIDE EFFECT: GET low-score tokens for cursor page.
     * At F5: no-op; at I1 wires into fetchPageTokens service.
     */
    loadTokens: () => {
      // SIDE EFFECT: at I1, GET /api/projects/:id/stages/ocr/pages/:pageId/tokens
      // Result updates ctx.tokens
    },

    /**
     * YAML: `applySuggestion` — swap token word to suggested reading.
     */
    applySuggestion: assign({
      tokens: ({ context, event }) => {
        if (event.type !== "ACCEPT_TOKEN") return context.tokens;
        return context.tokens.map((t) =>
          t.id === event.tokenId ? { ...t, word: t.suggest } : t,
        );
      },
      accepted: ({ context, event }) => {
        if (event.type !== "ACCEPT_TOKEN") return context.accepted;
        return context.accepted.includes(event.tokenId)
          ? context.accepted
          : [...context.accepted, event.tokenId];
      },
    }),

    /**
     * YAML: `clearAccepted: ctx.accepted = []`
     */
    clearAccepted: assign({ accepted: () => [] as string[] }),

    /**
     * YAML: `markPageReviewed: ctx.rows = setState(ctx.rows, [ctx.cursor], 'reviewed')`
     * Inline recount per DIVERGENCES.md #9.
     */
    markPageReviewed: assign({
      rows: ({ context }) => {
        if (!context.cursor) return context.rows;
        return context.rows.map((r) =>
          r.idx === context.cursor ? { ...r, state: "reviewed" as const } : r,
        );
      },
      totals: ({ context }) => {
        if (!context.cursor) return context.totals;
        const newRows = context.rows.map((r) =>
          r.idx === context.cursor ? { ...r, state: "reviewed" as const } : r,
        );
        return recountOcr(newRows);
      },
    }),

    /**
     * YAML: `stepToNextFlagged: ctx.cursor = nextFlaggedAfter(ctx.rows, ctx.cursor)`
     * Then loadTokens fires as a side-effect action.
     */
    stepToNextFlagged: assign({
      cursor: ({ context }) => nextFlaggedAfter(context.rows, context.cursor),
    }),

    /**
     * YAML: `recount` — DIVERGENCES.md #9: inlined in mergePage / markPageReviewed.
     */
    recount: () => {
      // Inlined in mergePage, markPageReviewed.
    },

    /** YAML: `assignEngine: ctx.engine = event.value` */
    assignEngine: assign({
      engine: ({ event }) => {
        if (event.type !== "SET_ENGINE") return "doctr" as const;
        return event.value;
      },
    }),

    /** YAML: `assignBackend: ctx.backend = event.value` */
    assignBackend: assign({
      backend: ({ event }) => {
        if (event.type !== "SET_BACKEND") return "gpu" as const;
        return event.value;
      },
    }),

    /**
     * YAML: `assignWeights: ctx._weights = { ...ctx._weights, ...event.patch }`
     * DIVERGENCES.md #8: view-only context field. We keep it as a context field
     * because it IS read by service input (engine config at I1), unlike pure
     * display coords (_wipe, _split) which were omitted.
     */
    assignWeights: assign({
      _weights: ({ context, event }) => {
        if (event.type !== "SET_WEIGHTS") return context._weights;
        return { ...context._weights, ...event.patch };
      },
    }),

    /** YAML: `appendOverride: ctx.overrides = [...ctx.overrides, event.override]` */
    appendOverride: assign({
      overrides: ({ context, event }) => {
        if (event.type !== "ADD_OVERRIDE") return context.overrides;
        return [...context.overrides, event.override];
      },
    }),

    /**
     * YAML: `patchOverride: ctx.overrides = patchAt(ctx.overrides, event.index, event.patch)`
     */
    patchOverride: assign({
      overrides: ({ context, event }) => {
        if (event.type !== "EDIT_OVERRIDE") return context.overrides;
        return context.overrides.map((o, i) =>
          i === event.index ? { ...o, ...event.patch } : o,
        );
      },
    }),

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

    // Side-effect slots — no-op at F5; wired at I1.

    /** YAML: `requestPause` */
    requestPause: () => {
      // SIDE EFFECT: POST .../stages/ocr/pause
    },

    /** YAML: `requestReOcr` — RE_OCR_SELECTION */
    requestReOcr: () => {
      // SIDE EFFECT: POST .../stages/ocr/rerun (selected pages)
    },

    /** YAML: `requestPageReOcr` — RE_OCR_PAGE */
    requestPageReOcr: () => {
      // SIDE EFFECT: POST .../stages/ocr/rerun (cursor page)
    },

    /** YAML: `requestReOcrAll` — triggered from settled on UPSTREAM/SETTINGS change */
    requestReOcrAll: () => {
      // SIDE EFFECT: POST .../stages/ocr/rerun (all | flagged)
    },

    /** YAML: `persistToken` */
    persistToken: () => {
      // SIDE EFFECT: PATCH token text
    },

    /** YAML: `persistPage` */
    persistPage: () => {
      // SIDE EFFECT: PATCH page state
    },

    /** YAML: `persistOverride` */
    persistOverride: () => {
      // SIDE EFFECT: PUT overrides table
    },

    /** YAML: `emitResolved` */
    emitResolved: () => {
      // SIDE EFFECT: at I1, send RESOLVE to pipelineShell for ocr runner
    },
  },
}).createMachine({
  id: "ocrTool",

  context: ({ input }) => ({
    projectId: input.projectId,
    stageIndex: input.stageIndex,
    services: input.services,
    rows: [],
    totals: null,
    engine: "doctr",
    backend: "gpu",
    _weights: {},
    overrides: [],
    cursor: null,
    tokens: [],
    accepted: [],
    error: null,
  }),

  initial: "recognising",

  /**
   * Machine-level events — engine configuration (settings tab).
   * Available throughout per DIVERGENCES.md #7.
   * Saving engine/backend changes re-runs OCR (most expensive settings edit
   * after grayscale — stales 15 downstream stages).
   */
  on: {
    SET_ENGINE: { actions: ["assignEngine"] },
    SET_BACKEND: { actions: ["assignBackend"] },
    SET_WEIGHTS: { actions: ["assignWeights"] },
    ADD_OVERRIDE: {
      actions: ["appendOverride", "persistOverride"],
    },
    EDIT_OVERRIDE: {
      actions: ["patchOverride", "persistOverride"],
    },
  },

  states: {
    /**
     * YAML: recognising — "Recognising text…" N/M · engine name; Pause available.
     *
     * Receives PAGE_PUSH events from the SSE actor (at I1). Each push upserts
     * the row and recounts totals. When all pages are done, transitions to
     * reviewing.
     *
     * DIVERGENCE: `runComplete` guard checks post-merge totals (all running=0)
     * rather than YAML's `done + 1 === total` to handle multi-page batches.
     */
    recognising: {
      on: {
        PAGE_PUSH: [
          {
            target: "reviewing",
            guard: "runComplete",
            actions: ["mergePage"],
          },
          {
            actions: ["mergePage"],
          },
        ],
        PAUSE: { actions: ["requestPause"] },
      },
    },

    /**
     * YAML: reviewing — Grid review + the Recognition deep-dive.
     * Initial: grid (the page-grid view); can open recognition (per-page tab).
     */
    reviewing: {
      initial: "grid",

      on: {
        CONFIRM_ADVANCE: {
          target: "confirming",
          guard: "allFlagsReviewed",
        },
      },

      states: {
        /**
         * YAML: grid — confidence-tinted page grid; filter/density controls;
         * Re-OCR selection; open a page in Recognition.
         */
        grid: {
          on: {
            OPEN_RECOGNITION: {
              target: "recognition",
              actions: ["assignCursor", "loadTokens"],
            },
            RE_OCR_SELECTION: {
              target: "#ocrTool.recognising",
              actions: ["requestReOcr"],
            },
          },
        },

        /**
         * YAML: recognition — one page, word boxes tinted by confidence,
         * token list with suggestions.
         *
         * ACCEPT_TOKEN: swap to suggested reading (inline, persisted at I1)
         * ACCEPT_PAGE: mark page reviewed; recount
         * NEXT_FLAGGED: advance to next or return to grid
         * RE_OCR_PAGE: re-run OCR on the cursor page
         * CLOSE: back to grid
         */
        recognition: {
          on: {
            ACCEPT_TOKEN: {
              actions: ["applySuggestion", "persistToken"],
            },
            ACCEPT_PAGE: {
              actions: ["markPageReviewed", "recount", "persistPage"],
            },
            NEXT_FLAGGED: [
              {
                guard: "hasNextFlagged",
                actions: ["stepToNextFlagged", "loadTokens", "clearAccepted"],
              },
              {
                target: "grid", // no more flagged pages
              },
            ],
            RE_OCR_PAGE: { actions: ["requestPageReOcr"] },
            CLOSE: { target: "grid", actions: ["clearCursor"] },
          },
        },
      },
    },

    /**
     * YAML: confirming — invoke confirmStage.
     */
    confirming: {
      invoke: {
        id: "confirmStage",
        src: "confirmStage" as const,
        input: ({ context }: { context: OcrToolContext }) => ({
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
     * YAML: settled — every page recognised + reviewed; text flows to Page order.
     *
     * UPSTREAM_CHANGED and SETTINGS_CHANGED both re-trigger OCR
     * (SETTINGS_CHANGED stales 15 downstream stages).
     */
    settled: {
      on: {
        UPSTREAM_CHANGED: {
          target: "recognising",
          actions: ["requestReOcrAll"],
        },
        SETTINGS_CHANGED: {
          target: "recognising",
          actions: ["requestReOcrAll"],
        },
      },
    },
  },
});
