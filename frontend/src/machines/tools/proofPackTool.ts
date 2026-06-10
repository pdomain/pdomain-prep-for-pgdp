/**
 * proofPackTool — XState v5 machine for the Proof Pack stage tool.
 *
 * Ported from
 * `docs/plans/design_handoff_pgdp_app/statecharts/tool-proof-pack.yaml`
 *
 * Assembles the proof pack: page images + proofer text + illustration crops
 * + project metadata in the layout PGDP expects. The invariant: every page
 * must carry both an image and a text file (completeness bar, 387/387).
 *
 * ## Divergences from YAML
 *   - DIVERGENCE #3: `onDone` uses `event.output` (not `event.data`).
 *   - F5.6-3: `patchInclude` triggers a re-assemble by targeting `assembling`
 *     (SET_INCLUDE on `assembled` transitions to `assembling` with patchInclude
 *     action first). YAML shows the action + target together — XState v5
 *     fires actions before transitioning, so this is equivalent.
 *
 * @see docs/plans/design_handoff_pgdp_app/statecharts/tool-proof-pack.yaml
 * @see src/machines/DIVERGENCES.md
 */

import { setup, assign, fromPromise } from "xstate";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface TreeRow {
  name: string;
  dir?: boolean;
  d?: number; // indent depth
  meta?: string;
}

export interface CompletenessStats {
  complete: number;
  total: number;
}

export interface PackInclude {
  images: boolean;
  text: boolean;
  illustrations: boolean;
}

// ---------------------------------------------------------------------------
// Services interface
// ---------------------------------------------------------------------------

export interface ProofPackToolServices {
  /**
   * POST /api/projects/:id/stages/proof_pack/assemble
   * -> { tree: TreeRow[], completeness: CompletenessStats }
   */
  assemblePack(
    projectId: string,
    include: PackInclude,
  ): Promise<{
    tree: TreeRow[];
    completeness: CompletenessStats;
  }>;
}

// ---------------------------------------------------------------------------
// Input + Context
// ---------------------------------------------------------------------------

export interface ProofPackToolInput {
  projectId: string;
  stageIndex: number;
  services: ProofPackToolServices;
}

export interface ProofPackToolContext {
  projectId: string;
  stageIndex: number;
  services: ProofPackToolServices;
  tree: TreeRow[];
  completeness: CompletenessStats | null;
  include: PackInclude;
  error: Error | null;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type ProofPackToolEvent =
  | { type: "RETRY" }
  | { type: "REASSEMBLE" }
  | { type: "UPSTREAM_CHANGED" }
  | { type: "OPEN_MISSING"; pageId: string }
  | { type: "PREVIEW_FILE"; fileId: string }
  | { type: "SET_INCLUDE"; patch: Partial<PackInclude> };

// ---------------------------------------------------------------------------
// Machine
// ---------------------------------------------------------------------------

export const proofPackToolMachine = setup({
  types: {
    input: {} as ProofPackToolInput,
    context: {} as ProofPackToolContext,
    events: {} as ProofPackToolEvent,
  },
  actors: {
    assemblePack: fromPromise<
      { tree: TreeRow[]; completeness: CompletenessStats },
      {
        projectId: string;
        services: ProofPackToolServices;
        include: PackInclude;
      }
    >(({ input }) =>
      input.services.assemblePack(input.projectId, input.include),
    ),
  },
  guards: {
    /**
     * Receives params extracted in the transition:
     *   `params: ({ event }) => ({ completeness: event.output.completeness })`
     * Returns true when fewer than total pages are complete.
     */
    pagesMissing: (
      _args: unknown,
      params: { completeness: CompletenessStats },
    ) => params.completeness.complete < params.completeness.total,
  },
  actions: {
    /**
     * DIVERGENCE #3: event.output (not event.data). params pattern.
     */
    assignPack: assign(
      (
        _args,
        params: {
          output: { tree: TreeRow[]; completeness: CompletenessStats };
        },
      ): Partial<ProofPackToolContext> => ({
        tree: params.output.tree,
        completeness: params.output.completeness,
      }),
    ),
    patchInclude: assign({
      include: ({
        context,
        event,
      }: {
        context: ProofPackToolContext;
        event: ProofPackToolEvent;
      }) => {
        if (event.type !== "SET_INCLUDE") return context.include;
        return { ...context.include, ...event.patch };
      },
    }),
    assignError: assign(
      (_args, params: { error: unknown }): Partial<ProofPackToolContext> => ({
        error:
          params.error instanceof Error
            ? params.error
            : new Error(String(params.error)),
      }),
    ),
    clearError: assign({ error: null }),
    // Side effects — implemented at I1
    openPreview: () => {
      /* SIDE EFFECT: open file preview overlay */
    },
    navigateToGap: () => {
      /* SIDE EFFECT: route to stage missing output */
    },
  },
}).createMachine({
  id: "proofPackTool",
  context: ({ input }: { input: ProofPackToolInput }) => ({
    projectId: input.projectId,
    stageIndex: input.stageIndex,
    services: input.services,
    tree: [],
    completeness: null,
    include: { images: true, text: true, illustrations: true },
    error: null,
  }),
  initial: "assembling",
  states: {
    assembling: {
      invoke: {
        src: "assemblePack",
        input: ({ context }: { context: ProofPackToolContext }) => ({
          projectId: context.projectId,
          services: context.services,
          include: context.include,
        }),
        onDone: [
          {
            target: "incomplete",
            guard: {
              type: "pagesMissing",
              params: ({
                event,
              }: {
                event: {
                  output: { tree: TreeRow[]; completeness: CompletenessStats };
                };
              }) => ({ completeness: event.output.completeness }),
            },
            actions: [
              {
                type: "assignPack",
                params: ({
                  event,
                }: {
                  event: {
                    output: {
                      tree: TreeRow[];
                      completeness: CompletenessStats;
                    };
                  };
                }) => ({ output: event.output }),
              },
            ],
          },
          {
            target: "assembled",
            actions: [
              {
                type: "assignPack",
                params: ({
                  event,
                }: {
                  event: {
                    output: {
                      tree: TreeRow[];
                      completeness: CompletenessStats;
                    };
                  };
                }) => ({ output: event.output }),
              },
            ],
          },
        ],
        onError: {
          target: "failed",
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

    incomplete: {
      on: {
        OPEN_MISSING: { actions: "navigateToGap" },
        REASSEMBLE: { target: "assembling" },
        UPSTREAM_CHANGED: { target: "assembling" },
      },
    },

    assembled: {
      on: {
        PREVIEW_FILE: { actions: "openPreview" },
        REASSEMBLE: { target: "assembling" },
        SET_INCLUDE: {
          target: "assembling",
          actions: "patchInclude",
        },
        UPSTREAM_CHANGED: { target: "assembling" },
      },
    },

    failed: {
      on: {
        RETRY: { target: "assembling", actions: "clearError" },
      },
    },
  },
});
