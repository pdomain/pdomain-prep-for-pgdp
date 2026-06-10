/**
 * archiveTool — XState v5 machine for the Archive stage tool.
 *
 * Ported from
 * `docs/plans/design_handoff_pgdp_app/statecharts/tool-archive.yaml`
 *
 * The last pipeline stage: hand the project to cold storage. Each artifact
 * class is keep or drop. Destination, retention, and keep toggles come from
 * settings. The `archived` state is terminal for the pipeline.
 *
 * Gate chain position: submit_check → archive (terminal)
 *
 * ## Divergences from YAML
 *   - DIVERGENCE #3: `onDone` uses `event.output` (not `event.data`).
 *   - F5.6-11: `toggleItem` and `persistItem` are separated per YAML but fire
 *     on the same TOGGLE_KEEP transition. XState v5 fires actions in order —
 *     `toggleItem` (assign, mutates items) runs first, then `persistItem`
 *     (side-effect). This is equivalent to the YAML's sequential action list.
 *   - F5.6-12: `result` stores `{ kept, dropped }` strings (not numeric bytes)
 *     matching the YAML's display-oriented shape from the canvas ("3.5 GB").
 *     At I1 the real API returns structured bytes; the surface formats them.
 *
 * Note: This is the PIPELINE archive stage (cold-storage handoff).
 * Do NOT conflate with project-level archive in manage-actions.yaml (reversible
 * hide-from-Active). They are distinct concepts.
 *
 * @see docs/plans/design_handoff_pgdp_app/statecharts/tool-archive.yaml
 * @see src/machines/DIVERGENCES.md
 */

import { setup, assign, fromPromise } from "xstate";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface ArchiveItem {
  name: string;
  meta: string;
  keep: boolean;
}

export interface ArchiveResult {
  kept: string; // human-readable e.g. "3.5 GB"
  dropped: string; // human-readable e.g. "18.4 GB"
}

export type ArchiveDestination = "glacier" | "nas" | "custom";
export type ArchiveRetention = "5yr" | "10yr" | "forever";

export interface ArchiveSettings {
  destination: ArchiveDestination;
  retention: ArchiveRetention;
}

// ---------------------------------------------------------------------------
// Services interface
// ---------------------------------------------------------------------------

export interface ArchiveToolServices {
  /**
   * POST /api/projects/:id/stages/archive/run
   * (items, destination, retention) -> { kept, dropped }
   */
  archiveProject(
    projectId: string,
    items: ArchiveItem[],
    destination: ArchiveDestination,
    retention: ArchiveRetention,
  ): Promise<ArchiveResult>;

  /**
   * PATCH /api/projects/:id/stages/archive/items/:name
   * { keep } -> { ok }
   */
  persistItem(
    projectId: string,
    name: string,
    keep: boolean,
  ): Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// Input + Context
// ---------------------------------------------------------------------------

export interface ArchiveToolInput {
  projectId: string;
  stageIndex: number;
  services: ArchiveToolServices;
  initialItems?: ArchiveItem[];
  settings?: Partial<ArchiveSettings>;
}

export interface ArchiveToolContext {
  projectId: string;
  stageIndex: number;
  services: ArchiveToolServices;
  items: ArchiveItem[];
  destination: ArchiveDestination;
  retention: ArchiveRetention;
  result: ArchiveResult | null;
  error: Error | null;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type ArchiveToolEvent =
  | { type: "TOGGLE_KEEP"; name: string }
  | { type: "ARCHIVE_NOW" }
  | { type: "RE_ARCHIVE" }
  | { type: "UPSTREAM_CHANGED" };

// ---------------------------------------------------------------------------
// Default item manifest
// ---------------------------------------------------------------------------

const DEFAULT_ARCHIVE_ITEMS: ArchiveItem[] = [
  { name: "Original scans", meta: "source TIFFs / JPEGs", keep: true },
  { name: "Finished package", meta: "zip + manifest + provenance", keep: true },
  { name: "Grayscale pages", meta: "re-derivable from source", keep: false },
  { name: "Processed pages", meta: "re-derivable from source", keep: false },
  { name: "OCR crops", meta: "re-derivable", keep: false },
  { name: "Text review output", meta: "embedded in package", keep: false },
];

// ---------------------------------------------------------------------------
// Machine
// ---------------------------------------------------------------------------

export const archiveToolMachine = setup({
  types: {
    input: {} as ArchiveToolInput,
    context: {} as ArchiveToolContext,
    events: {} as ArchiveToolEvent,
  },
  actors: {
    archiveProject: fromPromise<
      ArchiveResult,
      {
        projectId: string;
        services: ArchiveToolServices;
        items: ArchiveItem[];
        destination: ArchiveDestination;
        retention: ArchiveRetention;
      }
    >(({ input }) =>
      input.services.archiveProject(
        input.projectId,
        input.items,
        input.destination,
        input.retention,
      ),
    ),
  },
  guards: {},
  actions: {
    toggleItem: assign({
      items: ({
        context,
        event,
      }: {
        context: ArchiveToolContext;
        event: ArchiveToolEvent;
      }) => {
        if (event.type !== "TOGGLE_KEEP") return context.items;
        return context.items.map((it) =>
          it.name === event.name ? { ...it, keep: !it.keep } : it,
        );
      },
    }),
    persistItem: ({
      context,
      event,
    }: {
      context: ArchiveToolContext;
      event: ArchiveToolEvent;
    }) => {
      // SIDE EFFECT: PATCH keep/drop choice — at I1
      if (event.type !== "TOGGLE_KEEP") return;
      const item = context.items.find((it) => it.name === event.name);
      if (item) {
        void context.services.persistItem(
          context.projectId,
          event.name,
          !item.keep,
        );
      }
    },
    /**
     * DIVERGENCE #3: event.output (not event.data). params pattern.
     */
    assignResult: assign(
      (
        _args,
        params: { output: ArchiveResult },
      ): Partial<ArchiveToolContext> => ({
        result: params.output,
      }),
    ),
    assignError: assign(
      (_args, params: { error: unknown }): Partial<ArchiveToolContext> => ({
        error:
          params.error instanceof Error
            ? params.error
            : new Error(String(params.error)),
      }),
    ),
  },
}).createMachine({
  id: "archiveTool",
  context: ({ input }: { input: ArchiveToolInput }) => ({
    projectId: input.projectId,
    stageIndex: input.stageIndex,
    services: input.services,
    items: input.initialItems ?? DEFAULT_ARCHIVE_ITEMS,
    destination: input.settings?.destination ?? "glacier",
    retention: input.settings?.retention ?? "10yr",
    result: null,
    error: null,
  }),
  initial: "reviewing",
  states: {
    reviewing: {
      on: {
        TOGGLE_KEEP: { actions: ["toggleItem", "persistItem"] },
        ARCHIVE_NOW: { target: "archiving" },
      },
    },

    archiving: {
      invoke: {
        src: "archiveProject",
        input: ({ context }: { context: ArchiveToolContext }) => ({
          projectId: context.projectId,
          services: context.services,
          items: context.items,
          destination: context.destination,
          retention: context.retention,
        }),
        onDone: {
          target: "archived",
          actions: [
            {
              type: "assignResult",
              params: ({ event }: { event: { output: ArchiveResult } }) => ({
                output: event.output,
              }),
            },
          ],
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

    archived: {
      on: {
        RE_ARCHIVE: { target: "archiving" },
        UPSTREAM_CHANGED: { target: "reviewing" },
      },
    },
  },
});
