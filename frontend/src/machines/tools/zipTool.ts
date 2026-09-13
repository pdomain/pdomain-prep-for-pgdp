/**
 * zipTool — XState v5 machine for the Zip stage tool.
 *
 * Ported from
 * `docs/plans/design_handoff_pgdp_app/statecharts/tool-zip.yaml`
 *
 * Builds the deterministic archive: sorted entries, fixed timestamps,
 * stripped metadata. Identical inputs → byte-identical archive. SHA-256
 * stat is the cross-check used by submit_check's dry run.
 *
 * Gate chain position: build_package → (gates) → zip → submit_check
 *
 * ## Divergences from YAML
 *   - F5.6-6: Zip runs server-side and the machine receives push events
 *     (ZIP_PROGRESS / ZIP_DONE / ZIP_FAILED) rather than invoking a promise.
 *     `requestRebuild` is a side-effect action that POSTs the rebuild request
 *     and then the server streams events back. No `fromPromise` actor.
 *   - F5.6-7: `patchSettings` is not stored in a settings sub-machine. At F5
 *     settings are local context fields. At I1 wire to stageSettings pattern.
 *
 * No longer divergent: this machine used to start in `compressing` and carry
 * `entry: requestRebuild` there, which the YAML never specified. That made
 * mounting the surface re-run the zip stage, and made UPSTREAM_CHANGED fire
 * `requestRebuild` twice. Both the machine and the YAML now start in
 * `hydrating` and treat `requestRebuild` as a transition action.
 * Issue: ocr-container-meta#402.
 *
 * @see docs/plans/design_handoff_pgdp_app/statecharts/tool-zip.yaml
 * @see src/machines/DIVERGENCES.md
 */

import { setup, assign } from "xstate";
import type { TreeRow } from "./proofPackTool";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface ZipProgress {
  entries: number;
  total: number;
  pct: number;
}

export interface ZipArchive {
  name: string;
  entries: number;
  bytes: number;
  ratio: number;
  sha256: string;
}

export type ZipFormat = "zip" | "tar.gz";
export type ZipCompression = "store" | "fast" | "max";

export interface ZipSettings {
  format: ZipFormat;
  deterministic: boolean;
  compression: ZipCompression;
  emitChecksumSidecar: boolean;
}

// ---------------------------------------------------------------------------
// Services interface
// ---------------------------------------------------------------------------

export interface ZipToolServices {
  /**
   * POST /api/projects/:id/stages/zip/rebuild
   * Fire-and-forget — server will push ZIP_PROGRESS / ZIP_DONE / ZIP_FAILED
   */
  requestRebuild(projectId: string, settings: ZipSettings): Promise<void>;

  /**
   * Trigger a download of the zip artifact.
   * Returns a blob URL or presigned URL (I1).
   */
  downloadArchive(projectId: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Input + Context
// ---------------------------------------------------------------------------

export interface ZipToolInput {
  projectId: string;
  stageIndex: number;
  services: ZipToolServices;
}

export interface ZipToolContext {
  projectId: string;
  stageIndex: number;
  services: ZipToolServices;
  progress: ZipProgress | null;
  archive: ZipArchive | null;
  tree: TreeRow[];
  settings: ZipSettings;
  error: Error | null;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type ZipToolEvent =
  | { type: "ZIP_PROGRESS"; entries: number; total: number; pct: number }
  | { type: "ZIP_DONE"; archive: ZipArchive; tree: TreeRow[] }
  | { type: "ZIP_FAILED"; error: unknown }
  | { type: "DOWNLOAD" }
  | { type: "REBUILD" }
  | { type: "SET_FORMAT"; patch: Partial<ZipSettings> }
  | { type: "UPSTREAM_CHANGED" }
  | { type: "RETRY" }
  /**
   * The persisted stage status says the archive is missing or stale, so a
   * build is genuinely needed. Sent from `hydrating` once the surface has
   * read the stage status. See the `hydrating` state for why this is an
   * event rather than the initial state's entry action.
   */
  | { type: "NEEDS_REBUILD" };

// ---------------------------------------------------------------------------
// Machine
// ---------------------------------------------------------------------------

export const zipToolMachine = setup({
  types: {
    input: {} as ZipToolInput,
    context: {} as ZipToolContext,
    events: {} as ZipToolEvent,
  },
  guards: {},
  actions: {
    assignProgress: assign({
      progress: ({ event }: { event: ZipToolEvent }) => {
        if (event.type !== "ZIP_PROGRESS") return null;
        return { entries: event.entries, total: event.total, pct: event.pct };
      },
    }),
    assignArchive: assign({
      archive: ({ event }: { event: ZipToolEvent }) => {
        if (event.type !== "ZIP_DONE") return null;
        return event.archive;
      },
      tree: ({ event }: { event: ZipToolEvent }) => {
        if (event.type !== "ZIP_DONE") return [];
        return event.tree;
      },
      progress: null,
    }),
    patchSettings: assign({
      settings: ({
        context,
        event,
      }: {
        context: ZipToolContext;
        event: ZipToolEvent;
      }) => {
        if (event.type !== "SET_FORMAT") return context.settings;
        return { ...context.settings, ...event.patch };
      },
    }),
    assignError: assign({
      error: ({ event }: { event: ZipToolEvent }) => {
        if (event.type !== "ZIP_FAILED") return null;
        return event.error instanceof Error
          ? event.error
          : new Error(String(event.error));
      },
    }),
    clearError: assign({ error: null }),
    // Side effects — implemented at I1
    downloadArchive: ({ context }: { context: ZipToolContext }) => {
      // SIDE EFFECT: trigger download of archive + optional .sha256 sidecar
      void context.services.downloadArchive(context.projectId);
    },
    requestRebuild: ({ context }: { context: ZipToolContext }) => {
      // SIDE EFFECT: POST rebuild archive with current settings
      void context.services.requestRebuild(context.projectId, context.settings);
    },
  },
}).createMachine({
  id: "zipTool",
  context: ({ input }: { input: ZipToolInput }) => ({
    projectId: input.projectId,
    stageIndex: input.stageIndex,
    services: input.services,
    progress: null,
    archive: null,
    tree: [],
    settings: {
      format: "zip",
      deterministic: true,
      compression: "fast",
      emitChecksumSidecar: true,
    },
    error: null,
  }),
  initial: "hydrating",
  states: {
    /**
     * Read the persisted stage status before doing any work.
     *
     * `compressing` requests a real rebuild on entry, so making it the initial
     * state re-ran the whole zip stage on every mount of the surface, even
     * when the archive was already clean. On a large book that is slow, and it
     * churns a clean stage to dirty and back for nothing.
     *
     * This state has no entry action. The surface reads the stage status from
     * the project SSE channel's on-connect `project-snapshot` frame and then
     * sends exactly one of:
     *   - ZIP_DONE      — already clean, adopt the existing archive
     *   - NEEDS_REBUILD — missing or stale, go build it
     *
     * Explicit triggers (REBUILD, SET_FORMAT, UPSTREAM_CHANGED, RETRY) still
     * target `compressing` and so still recompress.
     *
     * Issue: ocr-container-meta#402.
     */
    hydrating: {
      on: {
        ZIP_DONE: { target: "built", actions: "assignArchive" },
        NEEDS_REBUILD: { target: "compressing", actions: "requestRebuild" },
        // A build is already running server-side (progress is being pushed).
        // Follow it; do NOT request another one.
        ZIP_PROGRESS: { target: "compressing", actions: "assignProgress" },
        ZIP_FAILED: { target: "failed", actions: "assignError" },
      },
    },

    /**
     * No entry action, per the YAML: `requestRebuild` is a transition action on
     * the events that mean "build it", not a consequence of being in this
     * state. The shipped machine previously carried `entry: requestRebuild`,
     * which is what re-ran the stage on every mount, and which also made
     * UPSTREAM_CHANGED fire `requestRebuild` twice.
     */
    compressing: {
      on: {
        ZIP_PROGRESS: { actions: "assignProgress" },
        ZIP_DONE: { target: "built", actions: "assignArchive" },
        ZIP_FAILED: { target: "failed", actions: "assignError" },
      },
    },

    built: {
      on: {
        DOWNLOAD: { actions: "downloadArchive" },
        REBUILD: { target: "compressing", actions: "requestRebuild" },
        SET_FORMAT: {
          target: "compressing",
          actions: ["patchSettings", "requestRebuild"],
        },
        UPSTREAM_CHANGED: {
          target: "compressing",
          actions: "requestRebuild",
        },
      },
    },

    failed: {
      on: {
        RETRY: {
          target: "compressing",
          actions: ["clearError", "requestRebuild"],
        },
      },
    },
  },
});
