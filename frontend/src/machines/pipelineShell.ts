/**
 * pipelineShell — XState v5 machine for the per-project pipeline orchestrator.
 *
 * Ported from `docs/plans/design_handoff_pgdp_app/statecharts/pipeline-shell.yaml`
 * per the mechanical mapping in `statecharts/README.md §Porting to XState v5`.
 *
 * Singleton — one instance per open project.
 *
 * ## Responsibilities
 *   • Spawns 23 `stageRunner` actors (one per runner stage, indices 0–22).
 *   • Owns stage SELECTION: currentStageId, Prev/Next, dropdown.
 *   • Owns per-stage TAB strip: currentTab within the selected stage.
 *   • Mounts ONE tool slot for the active stage's workbench tab (F5 fills it).
 *   • Toggles between pipeline mode and PROJECT SETTINGS mode (spawns projectSettings).
 *   • Fans out staleness: on STAGE_COMPLETED, marks all downstream runners stale
 *     and auto-queues them when automation.rerunDownstreamOnStale is true.
 *   • Translates PROGRESS_PUSH / STAGE_PUSH from sseActor and routes to matching runner.
 *
 * ## DIVERGENCES.md references
 *   #10  — PROGRESS_PUSH { stage_id, progress } → PROGRESS { value } translation before
 *          forwarding to the matching stageRunner.
 *   reconcile-todo — reconcile action now implemented (push-wins, see stageRunner.ts).
 *   F4-1 — spawnSettings / stopSettings delegate to React component layer (same as
 *           F3-4 / F3-6 for projectDetail) — see DIVERGENCES.md §F4-1.
 *   F4-2 — runAllStale coordination deferred to component via onRunAllStale callback.
 *   F4-3 — tab region uses `initial: active` idiom from the YAML; `SET_TAB` guarded by
 *           `tabExistsForStage` reads tabsForStage() at guard time.
 *
 * @see docs/plans/design_handoff_pgdp_app/statecharts/pipeline-shell.yaml
 * @see docs/specs/machine-stage-map.md §3 — 23 stageRunner instances (source excluded)
 * @see src/machines/DIVERGENCES.md
 * @see src/machines/stageRunner.ts
 */

import { setup, assign, fromPromise, type ActorRefFrom } from "xstate";
import { stageRunnerMachine } from "./stageRunner";
import type { StageRunnerServices } from "./stageRunner";
import type { StagePushEvent, ProgressPushEvent } from "./lib/sseActor";
import { computeDownstream } from "@/mocks/fixtures";
import type { PipelineSnapshot, ProjectAutomation } from "@/mocks/types";

// ---------------------------------------------------------------------------
// Stage definitions (mirroring pipeline-template.jsx STAGE_DEFS)
// Source is NOT a stageRunner instance (machine-stage-map.md §3).
// ---------------------------------------------------------------------------

export interface StageDef {
  id: string;
  short: string;
  group: string;
  pageScoped: boolean;
}

/**
 * All 24 stages in topological (execution) order.
 * Index 0 = source (no runner); indices 1–23 = runner stages.
 *
 * Order is derived from STAGE_DEPS (Kahn's algorithm) — mirrors
 * fixtures.ts PAGE_STAGE_IDS for page-scoped stages with project-scoped
 * stages slotted at their earliest valid position:
 *
 *   source (root)
 *   grayscale → crop → threshold → deskew → denoise → dewarp → post_transform_crop
 *   canvas_map ← post_transform_crop (also blank_proof_synth alt)
 *   text_zones ← post_transform_crop
 *   post_ocr_crop ← canvas_map
 *   ocr ← post_ocr_crop
 *   page_order ← source + text_zones (project-scoped; must follow text_zones)
 *   wordcheck ← ocr
 *   hyphen_join ← wordcheck
 *   regex ← hyphen_join
 *   text_review ← hyphen_join + regex
 *   illustrations ← source (project-scoped; slotted before validation gate)
 *   validation ← text_review + illustrations + page_order
 *   proof_pack → build_package → zip → submit_check → archive
 *
 * Display labels (short) and groups are unchanged from the design numbering —
 * only the list order changed to satisfy the topological constraint.
 * See docs/specs/machine-stage-map.md for the design-numbering table.
 */
export const STAGE_DEFS: StageDef[] = [
  { id: "source", short: "source", group: "Source", pageScoped: false },
  { id: "grayscale", short: "grayscale", group: "Image", pageScoped: true },
  { id: "crop", short: "rough", group: "Image", pageScoped: true },
  { id: "threshold", short: "threshold", group: "Image", pageScoped: true },
  { id: "deskew", short: "deskew", group: "Image", pageScoped: true },
  { id: "denoise", short: "denoise", group: "Image", pageScoped: true },
  { id: "dewarp", short: "dewarp", group: "Image", pageScoped: true },
  {
    id: "post_transform_crop",
    short: "recrop",
    group: "Image",
    pageScoped: true,
  },
  { id: "canvas_map", short: "canvas", group: "Compose", pageScoped: true },
  { id: "text_zones", short: "zones", group: "OCR", pageScoped: true },
  {
    id: "post_ocr_crop",
    short: "crop2",
    group: "Compose",
    pageScoped: true,
  },
  { id: "ocr", short: "ocr", group: "OCR", pageScoped: true },
  { id: "page_order", short: "order", group: "Compose", pageScoped: false },
  { id: "wordcheck", short: "wordcheck", group: "Text", pageScoped: true },
  { id: "hyphen_join", short: "hyphen", group: "Text", pageScoped: true },
  { id: "regex", short: "regex", group: "Text", pageScoped: true },
  { id: "text_review", short: "review", group: "Text", pageScoped: true },
  { id: "illustrations", short: "illust", group: "Compose", pageScoped: true },
  { id: "validation", short: "validate", group: "Pack", pageScoped: false },
  { id: "proof_pack", short: "proof", group: "Pack", pageScoped: false },
  { id: "build_package", short: "package", group: "Pack", pageScoped: false },
  { id: "zip", short: "zip", group: "Pack", pageScoped: false },
  { id: "submit_check", short: "submit", group: "Pack", pageScoped: false },
  { id: "archive", short: "archive", group: "Pack", pageScoped: false },
];

/** Stages that get a stageRunner — all except source (index 0). */
export const RUNNER_STAGE_DEFS: StageDef[] = STAGE_DEFS.slice(1);

/** Look up a stageId → RUNNER index (0-based within RUNNER_STAGE_DEFS). */
export function runnerIndexOf(stageId: string): number {
  return RUNNER_STAGE_DEFS.findIndex((s) => s.id === stageId);
}

/** Look up a stageId → STAGE_DEFS index (0-based, includes source). */
export function stageDefIndexOf(stageId: string): number {
  return STAGE_DEFS.findIndex((s) => s.id === stageId);
}

// ---------------------------------------------------------------------------
// Per-stage tabs (from pipeline-template.jsx STAGE_TABS)
// ---------------------------------------------------------------------------

export interface StageTab {
  id: string;
  name: string;
}

const DEFAULT_TABS: StageTab[] = [
  { id: "overview", name: "Overview" },
  { id: "pages", name: "Pages" },
  { id: "workbench", name: "Page workbench" },
  { id: "settings", name: "Stage settings" },
];

const STAGE_TABS_MAP: Record<string, StageTab[]> = {
  source: [
    { id: "overview", name: "Overview" },
    { id: "files", name: "Files" },
    { id: "workbench", name: "Page workbench" },
    { id: "settings", name: "Stage settings" },
  ],
  ocr: [
    { id: "overview", name: "Overview" },
    { id: "pages", name: "Pages" },
    { id: "recognition", name: "Recognition" },
    { id: "workbench", name: "Page workbench" },
    { id: "settings", name: "Stage settings" },
  ],
  text_review: [
    { id: "overview", name: "Overview" },
    { id: "pages", name: "Pages" },
    { id: "queue", name: "Review queue" },
    { id: "comments", name: "Comments" },
    { id: "workbench", name: "Page workbench" },
    { id: "settings", name: "Stage settings" },
  ],
  build_package: [
    { id: "overview", name: "Overview" },
    { id: "manifest", name: "Manifest" },
    { id: "preflight", name: "Pre-flight" },
    { id: "settings", name: "Stage settings" },
  ],
  hyphen_join: [
    { id: "overview", name: "Overview" },
    { id: "queue", name: "Undecided" },
    { id: "joined", name: "Auto-joined" },
    { id: "mismatch", name: "Mismatch" },
    { id: "workbench", name: "Page workbench" },
    { id: "settings", name: "Stage settings" },
  ],
  text_zones: [
    { id: "overview", name: "Overview" },
    { id: "pages", name: "Pages" },
    { id: "splits", name: "Page splits" },
    { id: "workbench", name: "Page workbench" },
    { id: "settings", name: "Stage settings" },
  ],
  canvas_map: [
    { id: "overview", name: "Overview" },
    { id: "pages", name: "Pages" },
    { id: "spreads", name: "Facing pages" },
    { id: "settings", name: "Stage settings" },
  ],
  page_order: [
    { id: "overview", name: "Overview" },
    { id: "sequence", name: "Sequence" },
    { id: "pages", name: "Pages" },
    { id: "settings", name: "Stage settings" },
  ],
  wordcheck: [
    { id: "overview", name: "Overview" },
    { id: "suspects", name: "Suspects" },
    { id: "lists", name: "Word lists" },
    { id: "pages", name: "Pages" },
    { id: "workbench", name: "Page workbench" },
    { id: "settings", name: "Stage settings" },
  ],
  illustrations: [
    { id: "overview", name: "Overview" },
    { id: "illustrations", name: "Illustrations" },
    { id: "workbench", name: "Page workbench" },
    { id: "settings", name: "Stage settings" },
  ],
  regex: [
    { id: "overview", name: "Overview" },
    { id: "rules", name: "Rules" },
    { id: "pages", name: "Pages" },
    { id: "settings", name: "Stage settings" },
  ],
};

export function tabsForStage(stageId: string): StageTab[] {
  return STAGE_TABS_MAP[stageId] ?? DEFAULT_TABS;
}

function defaultTabForStage(stageId: string): string {
  const tabs = tabsForStage(stageId);
  return tabs.find((t) => t.id !== "overview")?.id ?? tabs[0]?.id ?? "overview";
}

// ---------------------------------------------------------------------------
// Automation defaults
// ---------------------------------------------------------------------------

export interface AutomationToggles {
  autoRunAfterIngest: boolean;
  rerunDownstreamOnStale: boolean;
  notifyOnError: boolean;
  pauseOnFlagPct: number;
}

function fromProjectAutomation(pa: ProjectAutomation): AutomationToggles {
  return {
    autoRunAfterIngest: pa.auto_run_after_ingest,
    rerunDownstreamOnStale: pa.rerun_downstream_on_stale,
    notifyOnError: pa.notify_on_error,
    pauseOnFlagPct: pa.pause_on_flag_pct,
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StageRunnerRef = ActorRefFrom<typeof stageRunnerMachine>;

export interface PipelineShellServices {
  /**
   * GET /api/data/projects/:id/pipeline
   * Returns the snapshot used to hydrate the 23 runners.
   */
  fetchPipeline(projectId: string): Promise<PipelineSnapshot>;

  /** Services forwarded to each spawned stageRunner. */
  runnerServices: StageRunnerServices;
}

export interface PipelineShellInput {
  projectId: string;
  services: PipelineShellServices;
  /**
   * Initial stageId from URL (?stage= query param or path segment).
   * If null, defaults to the first non-clean runner stage (or grayscale).
   */
  initialStageId?: string | null;
  /**
   * Callback for OPEN_PROJECT_NAV / navigation side-effects.
   * F4-divergence: navigation is a side effect outside the machine.
   */
  onNavigate?: (path: string) => void;
  /**
   * Callback to launch "run all stale" coordinator in the component layer.
   * F4-2 divergence: runAllStale machine coordination delegated to component.
   */
  onRunAllStale?: (staleIndices: number[]) => void;
  /**
   * Callbacks for settings panel lifecycle (F4-1 divergence — same as F3-4).
   */
  onOpenSettings?: (projectId: string) => void;
  onCloseSettings?: (automation: AutomationToggles) => void;
}

export interface PipelineShellContext {
  projectId: string;
  services: PipelineShellServices;
  runners: StageRunnerRef[];
  currentStageId: string;
  currentIndex: number; // index in STAGE_DEFS (includes source at 0)
  currentTab: string;
  automation: AutomationToggles;
  error: string | null;
  onNavigate: ((path: string) => void) | undefined;
  onRunAllStale: ((staleIndices: number[]) => void) | undefined;
  onOpenSettings: ((projectId: string) => void) | undefined;
  onCloseSettings: ((automation: AutomationToggles) => void) | undefined;
  /**
   * Tracks whether mode.settings is active. Used by the parallel region guard.
   * Context flag pattern from DIVERGENCES.md #6.
   */
  _inSettings: boolean;
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type PipelineShellEvent =
  // Selection
  | { type: "SELECT_STAGE"; stageId: string }
  | { type: "PREV" }
  | { type: "NEXT" }
  | { type: "SET_TAB"; tab: string }
  // Settings mode
  | { type: "OPEN_SETTINGS" }
  | { type: "CLOSE_SETTINGS"; automation?: AutomationToggles }
  // Stage outcomes
  | { type: "STAGE_COMPLETED"; stageId: string; fromIndex: number }
  | { type: "STAGE_SETTINGS_CHANGED" }
  | {
      type: "PAGES_RESOLVED";
      stageId: string;
      stageIndex: number;
      resolvedIds: string[];
    }
  // SSE push routing
  | StagePushEvent
  | ProgressPushEvent
  // Navigation
  | { type: "OPEN_PROJECT_NAV" }
  // Run all stale
  | { type: "RUN_ALL_STALE" }
  // Boot lifecycle
  | { type: "RETRY" };

// ---------------------------------------------------------------------------
// Machine definition
// ---------------------------------------------------------------------------

export const pipelineShellMachine = setup({
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  types: {} as {
    context: PipelineShellContext;
    events: PipelineShellEvent;
    input: PipelineShellInput;
  },

  actors: {
    /**
     * YAML: `invoke.src: fetchPipeline`
     * GET /api/data/projects/:id/pipeline
     */
    fetchPipeline: fromPromise<
      PipelineSnapshot,
      { projectId: string; services: PipelineShellServices }
    >(({ input }) => input.services.fetchPipeline(input.projectId)),

    stageRunner: stageRunnerMachine,
  },

  guards: {
    /**
     * YAML: `stageChanged: event.stageId !== ctx.currentStageId`
     */
    stageChanged: ({ context, event }) => {
      if (event.type !== "SELECT_STAGE") return false;
      return event.stageId !== context.currentStageId;
    },

    /**
     * YAML: `hasPrev: ctx.currentIndex > 0`
     * Clamp to STAGE_DEFS (source is index 0 — it's always the first).
     */
    hasPrev: ({ context }) => context.currentIndex > 0,

    /**
     * YAML: `hasNext: ctx.currentIndex < 22`
     * 24 stages total (indices 0–23); 22 = last runner stage index.
     */
    hasNext: ({ context }) => context.currentIndex < STAGE_DEFS.length - 1,

    /**
     * YAML: `tabExistsForStage: tabsForStage(ctx.currentStageId).some(t => t.id === event.tab)`
     */
    tabExistsForStage: ({ context, event }) => {
      if (event.type !== "SET_TAB") return false;
      return tabsForStage(context.currentStageId).some(
        (t) => t.id === event.tab,
      );
    },
  },

  actions: {
    /**
     * YAML: `assignProject` + `spawnRunners` + `resolveInitialSelection` + `assignAutomation`
     * Combined because they all fire together on booting.onDone.
     *
     * Spawns 23 stageRunner actors (runner stages 1–23, skipping source).
     */
    assignAndSpawnRunners: assign(
      (
        { context, spawn },
        params: { snapshot: PipelineSnapshot; initialStageId?: string | null },
      ) => {
        const { snapshot, initialStageId } = params;

        // Build per-runner initial status from the snapshot.
        // page_stages_summary covers page-scoped stages (16 entries).
        // project_stages covers project-scoped stages (8 entries, including source).
        // At F4, runners all start in `notrun`; the machine reconciles via STAGE_PUSH.
        // snapshot.page_stages_summary / project_stages are available for I1 initial-state seeding.

        const runners: StageRunnerRef[] = RUNNER_STAGE_DEFS.map((def, i) => {
          return spawn("stageRunner", {
            id: `runner-${def.id}`,
            input: {
              stageId: def.id,
              index: i,
              group: def.group,
              projectId: context.projectId,
              pageScoped: def.pageScoped,
              services: context.services.runnerServices,
            },
          });
        });

        // Resolve initial selection from URL param or first non-source stage.
        let resolvedStageId = initialStageId ?? "threshold";
        let resolvedIndex = stageDefIndexOf(resolvedStageId);
        if (resolvedIndex < 0) {
          resolvedStageId = "threshold";
          resolvedIndex = stageDefIndexOf("threshold");
        }
        const resolvedTab = defaultTabForStage(resolvedStageId);

        const automation = fromProjectAutomation(snapshot.automation);

        return {
          runners,
          currentStageId: resolvedStageId,
          currentIndex: resolvedIndex,
          currentTab: resolvedTab,
          automation,
        };
      },
    ),

    /** YAML: `assignSelection: ctx.currentStageId = event.stageId; ctx.currentIndex = indexOf` */
    assignSelection: assign({
      currentStageId: ({ event }) => {
        if (event.type !== "SELECT_STAGE") return "threshold";
        return event.stageId;
      },
      currentIndex: ({ event }) => {
        if (event.type !== "SELECT_STAGE") return 3;
        return stageDefIndexOf(event.stageId);
      },
      currentTab: ({ event }) => {
        if (event.type !== "SELECT_STAGE") return "pages";
        return defaultTabForStage(event.stageId);
      },
    }),

    /** YAML: `selectPrev` */
    selectPrev: assign({
      currentIndex: ({ context }) => context.currentIndex - 1,
      currentStageId: ({ context }) =>
        STAGE_DEFS[context.currentIndex - 1]?.id ?? context.currentStageId,
      currentTab: ({ context }) =>
        defaultTabForStage(
          STAGE_DEFS[context.currentIndex - 1]?.id ?? context.currentStageId,
        ),
    }),

    /** YAML: `selectNext` */
    selectNext: assign({
      currentIndex: ({ context }) => context.currentIndex + 1,
      currentStageId: ({ context }) =>
        STAGE_DEFS[context.currentIndex + 1]?.id ?? context.currentStageId,
      currentTab: ({ context }) =>
        defaultTabForStage(
          STAGE_DEFS[context.currentIndex + 1]?.id ?? context.currentStageId,
        ),
    }),

    /** YAML: `assignTab` */
    assignTab: assign({
      currentTab: ({ event }) => {
        if (event.type !== "SET_TAB") return "overview";
        return event.tab;
      },
    }),

    /**
     * YAML: `fanOutStale`
     * Sends UPSTREAM_CHANGED to every stageRunner downstream of the completed stage.
     * Uses STAGE_DEPS + computeDownstream from fixtures.ts (imported, not duplicated).
     *
     * XState v5 does not support multi-target sendTo — using a side-effect action.
     * Documented as F4-4 in DIVERGENCES.md.
     *
     * autoRerun = automation.rerunDownstreamOnStale
     */
    fanOutStaleSideEffect: ({ context, event }) => {
      if (
        event.type !== "STAGE_COMPLETED" &&
        event.type !== "STAGE_SETTINGS_CHANGED"
      )
        return;

      const fromStageId =
        event.type === "STAGE_COMPLETED"
          ? event.stageId
          : context.currentStageId;

      const downstreamIds = computeDownstream(fromStageId);
      const autoRerun = context.automation.rerunDownstreamOnStale;

      for (const stageId of downstreamIds) {
        const runnerIdx = runnerIndexOf(stageId);
        const runnerRef = context.runners[runnerIdx];
        if (runnerRef) {
          runnerRef.send({ type: "UPSTREAM_CHANGED", autoRerun });
        }
      }
    },

    /**
     * YAML: `markStageSettingsStale`
     * Sends SETTINGS_CHANGED to the current stage's runner.
     */
    markStageSettingsStale: ({ context }) => {
      const runnerIdx = runnerIndexOf(context.currentStageId);
      const runnerRef = context.runners[runnerIdx];
      if (runnerRef) {
        runnerRef.send({ type: "SETTINGS_CHANGED" });
      }
    },

    /**
     * YAML: `forwardResolveToRunner`
     * Routes PAGES_RESOLVED to the owning runner.
     */
    forwardResolveToRunner: ({ context, event }) => {
      if (event.type !== "PAGES_RESOLVED") return;
      const runnerIdx = runnerIndexOf(event.stageId);
      const runnerRef = context.runners[runnerIdx];
      if (runnerRef) {
        runnerRef.send({ type: "RESOLVE", resolvedIds: event.resolvedIds });
      }
    },

    /**
     * YAML: `routeStagePush`
     *
     * DIVERGENCE #10 (PROGRESS_PUSH translation):
     *   - STAGE_PUSH { variant: "progress", stage_id, progress } → PROGRESS { value }
     *     forwarded to the matching stageRunner.
     *   - STAGE_PUSH { variant: "status", stage_id, status } → STAGE_PUSH forwarded as-is.
     *   - PROGRESS_PUSH { stage_id, progress } → PROGRESS { value } (project-scoped stages).
     *
     * See DIVERGENCES.md #10.
     */
    routeStagePush: ({ context, event }) => {
      if (event.type === "STAGE_PUSH") {
        const runnerIdx = runnerIndexOf(event.stage_id);
        const runnerRef = context.runners[runnerIdx];
        if (!runnerRef) return;

        if (event.variant === "progress") {
          // Translate STAGE_PUSH(progress) → PROGRESS { value }  (DIVERGENCES #10)
          runnerRef.send({ type: "PROGRESS", value: event.progress });
        } else {
          // variant === "status" — forward STAGE_PUSH as-is for reconcile
          runnerRef.send(event);
        }
        return;
      }

      if (event.type === "PROGRESS_PUSH") {
        // Project-scoped stage progress — translate to PROGRESS { value }  (DIVERGENCES #10)
        const runnerIdx = runnerIndexOf(event.stage_id);
        const runnerRef = context.runners[runnerIdx];
        if (!runnerRef) return;
        runnerRef.send({ type: "PROGRESS", value: event.progress });
      }
    },

    /**
     * YAML: `launchRunAllStale`
     * F4-2 divergence: delegates to the component layer via callback.
     */
    launchRunAllStale: ({ context }) => {
      if (!context.onRunAllStale) return;
      // Collect stale runner indices
      const staleIndices: number[] = [];
      for (let i = 0; i < context.runners.length; i++) {
        const ref = context.runners[i];
        if (ref) {
          const snap = ref.getSnapshot();
          if (snap.value === "stale" || snap.value === "notrun") {
            staleIndices.push(i);
          }
        }
      }
      if (staleIndices.length > 0) {
        context.onRunAllStale(staleIndices);
      }
    },

    /**
     * YAML: `spawnSettings`
     * F4-1 divergence: delegates to component layer via callback.
     */
    spawnSettings: assign({
      _inSettings: () => true,
    }),

    openSettingsSideEffect: ({ context }) => {
      if (context.onOpenSettings) {
        context.onOpenSettings(context.projectId);
      }
    },

    /**
     * YAML: `stopSettings`
     * F4-1 divergence: delegates to component layer.
     */
    stopSettings: assign({
      _inSettings: () => false,
    }),

    /**
     * YAML: `syncAutomationFromSettings`
     * On CLOSE_SETTINGS, pull automation toggles back from the settings actor.
     */
    syncAutomationFromSettings: assign({
      automation: ({ context, event }) => {
        if (event.type !== "CLOSE_SETTINGS") return context.automation;
        return event.automation ?? context.automation;
      },
    }),

    closeSettingsSideEffect: ({ context, event }) => {
      if (event.type !== "CLOSE_SETTINGS") return;
      if (context.onCloseSettings) {
        context.onCloseSettings(event.automation ?? context.automation);
      }
    },

    /** YAML: `navigate` — side effect, router call */
    navigate: ({ context }) => {
      if (context.onNavigate) {
        context.onNavigate(`/projects/${context.projectId}`);
      }
    },

    assignError: assign({
      error: ({ event }) => {
        if (event.type !== "RETRY") return "Load failed";
        return null;
      },
    }),

    clearError: assign({ error: () => null }),

    /**
     * Stop all 23 runner actors on cleanup / reload.
     * Used when entering loadError so we don't leak actors.
     */
    stopRunners: ({ context }) => {
      for (const ref of context.runners) {
        if (ref) {
          // runners are spawned children — XState v5 manages their lifecycle
          // automatically when the parent stops, but we record this for clarity.
          void ref;
        }
      }
    },
  },
}).createMachine({
  id: "pipelineShell",
  context: ({ input }) => ({
    projectId: input.projectId,
    services: input.services,
    runners: [],
    currentStageId: input.initialStageId ?? "threshold",
    currentIndex: stageDefIndexOf(input.initialStageId ?? "threshold"),
    currentTab: defaultTabForStage(input.initialStageId ?? "threshold"),
    automation: {
      autoRunAfterIngest: true,
      rerunDownstreamOnStale: true,
      notifyOnError: true,
      pauseOnFlagPct: 10,
    },
    error: null,
    onNavigate: input.onNavigate,
    onRunAllStale: input.onRunAllStale,
    onOpenSettings: input.onOpenSettings,
    onCloseSettings: input.onCloseSettings,
    _inSettings: false,
  }),

  initial: "booting",

  states: {
    /** YAML: booting — load project + stage states, spawn 23 runners. */
    booting: {
      invoke: {
        id: "fetchPipeline",
        src: "fetchPipeline",
        input: ({ context }) => ({
          projectId: context.projectId,
          services: context.services,
        }),
        onDone: {
          target: "pipeline",
          actions: [
            {
              type: "assignAndSpawnRunners",
              params: ({
                event,
                context,
              }: {
                event: { output: PipelineSnapshot };
                context: PipelineShellContext;
              }) => ({
                snapshot: event.output,
                initialStageId: context.currentStageId,
              }),
            },
          ],
        },
        onError: {
          target: "loadError",
        },
      },
      on: {
        // Buffer early SSE pushes during boot — route if runners already exist
        STAGE_PUSH: { actions: ["routeStagePush"] },
        PROGRESS_PUSH: { actions: ["routeStagePush"] },
      },
    },

    loadError: {
      on: {
        RETRY: { target: "booting", actions: ["clearError"] },
      },
    },

    /**
     * Normal pipeline view.
     * Three parallel regions: mode, selection, tab.
     *
     * YAML: `type: parallel` with mode / selection / tab regions.
     */
    pipeline: {
      type: "parallel",

      states: {
        // ---- Region: mode (pipeline body vs project settings) -----------
        mode: {
          initial: "stages",
          states: {
            stages: {
              on: {
                OPEN_SETTINGS: {
                  target: "settings",
                  actions: ["spawnSettings", "openSettingsSideEffect"],
                },
              },
            },
            settings: {
              on: {
                CLOSE_SETTINGS: {
                  target: "stages",
                  actions: [
                    "stopSettings",
                    "syncAutomationFromSettings",
                    "closeSettingsSideEffect",
                  ],
                },
              },
            },
          },
        },

        // ---- Region: stage selection ------------------------------------
        selection: {
          initial: "selected",
          states: {
            selected: {
              on: {
                SELECT_STAGE: {
                  guard: "stageChanged",
                  actions: ["assignSelection"],
                },
                PREV: {
                  guard: "hasPrev",
                  actions: ["selectPrev"],
                },
                NEXT: {
                  guard: "hasNext",
                  actions: ["selectNext"],
                },
              },
            },
          },
        },

        // ---- Region: tab within the active stage -----------------------
        tab: {
          initial: "active",
          states: {
            active: {
              on: {
                SET_TAB: {
                  guard: "tabExistsForStage",
                  actions: ["assignTab"],
                },
              },
            },
          },
        },
      },

      // ---- Events handled at the pipeline level (any region) -----------
      on: {
        /**
         * A runner finished a (re)run → mark all downstream runners stale.
         * DIVERGENCE #10 / fan-out: fanOutStaleSideEffect sends to multiple runners.
         */
        STAGE_COMPLETED: {
          actions: ["fanOutStaleSideEffect"],
        },

        /** "Run all stale" button in ProjectInfoBand. */
        RUN_ALL_STALE: {
          actions: ["launchRunAllStale"],
        },

        /** Tool resolved flagged pages → forward to the owning runner. */
        PAGES_RESOLVED: {
          actions: ["forwardResolveToRunner"],
        },

        /**
         * Backend push for any stage → route to that runner.
         * DIVERGENCE #10: PROGRESS_PUSH and STAGE_PUSH(progress) are translated
         * to PROGRESS { value } before forwarding.
         */
        STAGE_PUSH: {
          actions: ["routeStagePush"],
        },
        PROGRESS_PUSH: {
          actions: ["routeStagePush"],
        },

        /** Stage settings changed from tool's Stage settings tab. */
        STAGE_SETTINGS_CHANGED: {
          actions: ["markStageSettingsStale", "fanOutStaleSideEffect"],
        },

        /** Navigation side-effect. */
        OPEN_PROJECT_NAV: {
          actions: ["navigate"],
        },
      },
    },
  },
});
