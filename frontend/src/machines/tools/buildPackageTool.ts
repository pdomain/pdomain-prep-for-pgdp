/**
 * buildPackageTool — XState v5 machine for the Build Package stage tool.
 *
 * Ported from
 * `docs/plans/design_handoff_pgdp_app/statecharts/tool-build-package.yaml`
 *
 * Assembles the final PGDP deliverable: manifest + deterministic archive +
 * metadata + provenance README. Builds are gated on validation's pre-flight
 * passing (`preflightPassed` guard).
 *
 * Gate chain position: validation (passed) → build_package → (gates) → zip
 *
 * ## Divergences from YAML
 *   - DIVERGENCE #3: `onDone` uses `event.output` (not `event.data`).
 *   - F5.6-4: `PREFLIGHT_PUSH` is the event through which validationTool
 *     notifies buildPackageTool of its gate status. At F5 this is sent
 *     explicitly from the test / parent. At I1 pipelineShell fans it out.
 *   - F5.6-5: BUILD guard `preflightPassed` checks `context.preflight === 'passed'`.
 *     When preflight is 'unknown', the BUILD is silently ignored (guard fails).
 *
 * @see docs/plans/design_handoff_pgdp_app/statecharts/tool-build-package.yaml
 * @see src/machines/DIVERGENCES.md
 */

import { setup, assign, fromPromise } from "xstate";
import type { TreeRow } from "./proofPackTool";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type PreflightStatus = "passed" | "blocked" | "unknown";
export type ChecksumAlgo = "sha256" | "sha1" | "md5";

export interface BuildManifest {
  project: string;
  pages: number;
  canvas: string;
  built: string;
  pipeline: string;
  files: number;
  sha256: string;
}

export interface BuildDeliverable {
  files: TreeRow[];
  count: number;
}

// ---------------------------------------------------------------------------
// Services interface
// ---------------------------------------------------------------------------

export interface BuildPackageToolServices {
  /**
   * POST /api/projects/:id/stages/build_package/build
   * -> { deliverable: BuildDeliverable, manifest: BuildManifest }
   */
  buildArtifacts(
    projectId: string,
    checksumAlgo: ChecksumAlgo,
  ): Promise<{
    deliverable: BuildDeliverable;
    manifest: BuildManifest;
  }>;
}

// ---------------------------------------------------------------------------
// Input + Context
// ---------------------------------------------------------------------------

export interface BuildPackageToolInput {
  projectId: string;
  stageIndex: number;
  services: BuildPackageToolServices;
}

export interface BuildPackageToolContext {
  projectId: string;
  stageIndex: number;
  services: BuildPackageToolServices;
  deliverable: BuildDeliverable | null;
  manifest: BuildManifest | null;
  preflight: PreflightStatus;
  checksumAlgo: ChecksumAlgo;
  error: Error | null;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type BuildPackageToolEvent =
  | { type: "BUILD" }
  | { type: "REBUILD" }
  | { type: "CONTINUE_TO_SUBMIT" }
  | { type: "UPSTREAM_CHANGED" }
  | { type: "PREFLIGHT_PUSH"; status: PreflightStatus };

// ---------------------------------------------------------------------------
// Machine
// ---------------------------------------------------------------------------

export const buildPackageToolMachine = setup({
  types: {
    input: {} as BuildPackageToolInput,
    context: {} as BuildPackageToolContext,
    events: {} as BuildPackageToolEvent,
  },
  actors: {
    buildArtifacts: fromPromise<
      { deliverable: BuildDeliverable; manifest: BuildManifest },
      {
        projectId: string;
        services: BuildPackageToolServices;
        checksumAlgo: ChecksumAlgo;
      }
    >(({ input }) =>
      input.services.buildArtifacts(input.projectId, input.checksumAlgo),
    ),
  },
  guards: {
    preflightPassed: ({ context }: { context: BuildPackageToolContext }) =>
      context.preflight === "passed",
  },
  actions: {
    /**
     * DIVERGENCE #3: event.output (not event.data). params pattern (DIVERGENCES.md).
     */
    assignBuild: assign(
      (
        _args,
        params: {
          output: { deliverable: BuildDeliverable; manifest: BuildManifest };
        },
      ): Partial<BuildPackageToolContext> => ({
        deliverable: params.output.deliverable,
        manifest: params.output.manifest,
      }),
    ),
    assignPreflight: assign({
      preflight: ({ event }: { event: BuildPackageToolEvent }) => {
        if (event.type !== "PREFLIGHT_PUSH") return "unknown";
        return event.status;
      },
    }),
    assignError: assign(
      (
        _args,
        params: { error: unknown },
      ): Partial<BuildPackageToolContext> => ({
        error:
          params.error instanceof Error
            ? params.error
            : new Error(String(params.error)),
      }),
    ),
    markBuildStale: assign({
      deliverable: null,
      manifest: null,
    }),
    // Side effect — navigates pipelineShell to submit_check stage
    navigateToSubmitCheck: () => {
      // SIDE EFFECT: pipelineShell SELECT_STAGE(submit_check) — at I1
    },
  },
}).createMachine({
  id: "buildPackageTool",
  context: ({ input }: { input: BuildPackageToolInput }) => ({
    projectId: input.projectId,
    stageIndex: input.stageIndex,
    services: input.services,
    deliverable: null,
    manifest: null,
    preflight: "unknown",
    checksumAlgo: "sha256",
    error: null,
  }),
  initial: "idle",
  states: {
    idle: {
      on: {
        BUILD: {
          target: "building",
          guard: "preflightPassed",
        },
        PREFLIGHT_PUSH: { actions: "assignPreflight" },
      },
    },

    building: {
      invoke: {
        src: "buildArtifacts",
        input: ({ context }: { context: BuildPackageToolContext }) => ({
          projectId: context.projectId,
          services: context.services,
          checksumAlgo: context.checksumAlgo,
        }),
        onDone: {
          target: "built",
          actions: [
            {
              type: "assignBuild",
              params: ({
                event,
              }: {
                event: {
                  output: {
                    deliverable: BuildDeliverable;
                    manifest: BuildManifest;
                  };
                };
              }) => ({ output: event.output }),
            },
          ],
        },
        onError: {
          target: "idle",
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

    built: {
      on: {
        REBUILD: { target: "building" },
        CONTINUE_TO_SUBMIT: { actions: "navigateToSubmitCheck" },
        UPSTREAM_CHANGED: {
          target: "idle",
          actions: "markBuildStale",
        },
      },
    },
  },
});
