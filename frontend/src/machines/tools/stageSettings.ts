/**
 * stageSettings — reusable settings-inheritance region for stage tool machines.
 *
 * Every stage tool's Settings tab shows the same three-state inheritance banner:
 *   default  — "Using project default · Standard quality preset"
 *   modified — "Modified · N changes vs project default" (Save / Revert offered)
 *   preset   — "Using preset · <name>" (Reset to default offered)
 *
 * This module defines:
 *   1. `StageSettingsState`     — the valid state values (mirrors YAML)
 *   2. `StageSettingsContext`   — the settings fields stored in machine context
 *   3. `StageSettingsEvent`     — events that drive settings transitions
 *   4. `StageSettingsServices`  — async operations (load, save-as-default, revert, reset)
 *   5. `stageSettingsActors`    — `fromPromise` actors parameterized by services
 *   6. `stageSettingsGuards`    — named guards for the transitions
 *   7. `stageSettingsActions`   — named assign actions
 *
 * ## Usage pattern (F5.1–F5.6)
 *
 * Each stage tool machine spreads these into its own `setup({ actors, guards, actions })`:
 *
 * ```ts
 * import {
 *   stageSettingsActors, stageSettingsGuards, stageSettingsActions,
 *   type StageSettingsContext, type StageSettingsEvent, type StageSettingsServices,
 * } from "@/machines/tools/stageSettings";
 *
 * const sourceToolMachine = setup({
 *   types: {} as {
 *     context: SourceToolContext & StageSettingsContext;
 *     events:  SourceToolEvent | StageSettingsEvent;
 *     input:   SourceToolInput;
 *   },
 *   actors:  { ...stageSettingsActors },
 *   guards:  { ...stageSettingsGuards },
 *   actions: { ...stageSettingsActions },
 * }).createMachine({ ... });
 * ```
 *
 * The parallel `settings` region is defined in the YAML as:
 *   settings:
 *     initial: default
 *     states: { default, modified, preset }
 *
 * Callers reproduce that region mechanically; the actors/guards/actions from
 * this module wire into the event handlers declared there.
 *
 * ## Wire shape (api-v2-deltas.md §1.8)
 *
 * GET    .../stages/{stage_id}/settings          → dict (effective settings)
 * PUT    .../stages/{stage_id}/settings           → dict (save project override)
 * POST   .../stages/{stage_id}/settings/save-as-default → dict
 * POST   .../stages/{stage_id}/settings/revert   → dict
 * POST   .../stages/{stage_id}/settings/reset    → dict
 *
 * The mock server exposes these via `StageSettingsServer` below.
 *
 * @see docs/plans/design_handoff_pgdp_app/statecharts/tool-source.yaml §settings
 * @see docs/specs/api-v2-deltas.md §1.8
 * @see src/machines/DIVERGENCES.md — F5-1 (settings region parallel)
 */

import { assign, fromPromise } from "xstate";

// ---------------------------------------------------------------------------
// State / context / events
// ---------------------------------------------------------------------------

/** The three-state inheritance banner values from the YAML. */
export type StageSettingsState = "default" | "modified" | "preset";

/**
 * Context fields owned by the settings region.
 * Every stage tool machine includes these fields.
 *
 * `_settingsDraft`  — in-flight changes not yet persisted (null = no changes)
 * `_presetId`       — active preset id when settingsState === 'preset' (null otherwise)
 * `settingsState`   — mirrors the machine region sub-state for read convenience
 *                     (updated by the region's entry actions so components can
 *                     read it without calling snapshot.matches)
 */
export interface StageSettingsContext {
  settingsState: StageSettingsState;
  _settingsDraft: Record<string, unknown> | null;
  _presetId: string | null;
}

/** Initial values for the settings portion of machine context. */
export const STAGE_SETTINGS_INITIAL: StageSettingsContext = {
  settingsState: "default",
  _settingsDraft: null,
  _presetId: null,
};

/** Events declared in the settings region (tool-source.yaml §settings.states.*.on). */
export type StageSettingsEvent =
  | { type: "CHANGE_SETTING"; patch: Record<string, unknown> }
  | { type: "SAVE_AS_DEFAULT" }
  | { type: "REVERT" }
  | { type: "SAVE_AS_PRESET" }
  | { type: "LOAD_PRESET"; presetId: string }
  | { type: "RESET_TO_DEFAULT" };

// ---------------------------------------------------------------------------
// Services interface
// ---------------------------------------------------------------------------

/**
 * Async operations for stage settings persistence.
 * Parameterized by `stageId` so F5.2–F5.6 can pass any v2 page-scoped stage.
 *
 * All routes from api-v2-deltas.md §1.8.
 * At F5 these are wired to the mock server; at I1 they flip to real routes.
 */
export interface StageSettingsServices {
  /**
   * POST .../stages/{stage_id}/settings/save-as-default
   * Persists `_settingsDraft` as the project-level default.
   * Returns the new effective settings dict.
   */
  saveAsDefault(
    projectId: string,
    stageId: string,
    draft: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;

  /**
   * POST .../stages/{stage_id}/settings/revert
   * Deletes the project override; returns the new effective settings.
   */
  revertSettings(
    projectId: string,
    stageId: string,
  ): Promise<Record<string, unknown>>;

  /**
   * POST .../stages/{stage_id}/settings/reset
   * Deletes both override and saved default; returns registry default.
   */
  resetSettings(
    projectId: string,
    stageId: string,
  ): Promise<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Actors (fromPromise wrappers)
// ---------------------------------------------------------------------------

/**
 * Input type for the save-as-default actor.
 * Passed as `invoke input` inside the machine.
 */
export interface SaveAsDefaultInput {
  projectId: string;
  stageId: string;
  draft: Record<string, unknown>;
  services: StageSettingsServices;
}

/**
 * Input type for revert/reset actors.
 */
export interface RevertResetInput {
  projectId: string;
  stageId: string;
  services: StageSettingsServices;
}

/**
 * Named actors for stage settings. Spread into the tool machine's `setup({ actors })`.
 *
 * Each machine that uses stageSettings must declare these in its actors block.
 */
export const stageSettingsActors = {
  saveAsDefault: fromPromise<Record<string, unknown>, SaveAsDefaultInput>(
    ({ input }) =>
      input.services.saveAsDefault(input.projectId, input.stageId, input.draft),
  ),

  revertSettings: fromPromise<Record<string, unknown>, RevertResetInput>(
    ({ input }) =>
      input.services.revertSettings(input.projectId, input.stageId),
  ),

  resetSettings: fromPromise<Record<string, unknown>, RevertResetInput>(
    ({ input }) => input.services.resetSettings(input.projectId, input.stageId),
  ),
} as const;

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** Named guards for the settings region. */
export const stageSettingsGuards = {
  /** True when there is an in-flight draft to save. */
  hasDraft: ({ context }: { context: StageSettingsContext }) =>
    context._settingsDraft !== null &&
    Object.keys(context._settingsDraft).length > 0,
} as const;

// ---------------------------------------------------------------------------
// Actions (assign)
// ---------------------------------------------------------------------------

/**
 * Named actions for settings transitions. Typed for `StageSettingsContext` /
 * `StageSettingsEvent` directly.
 *
 * ## Usage in stage tool machines
 *
 * XState v5's `ActionFunction` phantom types (`_out_TEvent`, `_out_TActor`, etc.)
 * make it impossible to spread a pre-built actions object typed with
 * `StageSettingsContext` into a machine whose context *extends*
 * `StageSettingsContext` — the type check rejects the spread even though the
 * contexts are structurally compatible.
 *
 * Each stage tool machine must therefore inline its own copies of these actions,
 * typed with its own `TContext`/`TEvent`. The implementations are identical;
 * only the type annotations differ. The canonical implementations live in this
 * file as documentation; individual machines inline them in `setup({ actions })`.
 *
 * See `src/machines/tools/source.ts` for the reference inline pattern.
 *
 * DIVERGENCE F5-1 (recorded in DIVERGENCES.md): The YAML's `recountTotals`
 * pattern (inline recount after assign) is applied here too — `settingsState`
 * is updated in the same assign that changes `_settingsDraft` / `_presetId`.
 */
export const stageSettingsActions = {
  /** YAML: recordSettingChange — merges event.patch into _settingsDraft. */
  recordSettingChange: assign(
    ({
      context,
      event,
    }: {
      context: StageSettingsContext;
      event: StageSettingsEvent;
    }) => {
      if (event.type !== "CHANGE_SETTING") return {};
      return {
        _settingsDraft: { ...(context._settingsDraft ?? {}), ...event.patch },
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        settingsState: "modified" as StageSettingsState,
      };
    },
  ),

  /** YAML: assignPreset — records the chosen preset ID. */
  assignPreset: assign(
    ({
      event,
    }: {
      context: StageSettingsContext;
      event: StageSettingsEvent;
    }) => {
      if (event.type !== "LOAD_PRESET") return {};
      return {
        _presetId: event.presetId,
        _settingsDraft: null,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        settingsState: "preset" as StageSettingsState,
      };
    },
  ),

  /** YAML: revertSettings — clears draft; returns to default. */
  revertSettingsAction: assign({
    _settingsDraft: (): null => null,
    _presetId: (): null => null,
    settingsState: () => "default" as StageSettingsState,
  }),

  /** Called after save-as-default resolves. */
  onSavedAsDefault: assign({
    _settingsDraft: (): null => null,
    _presetId: (): null => null,
    settingsState: () => "default" as StageSettingsState,
  }),

  /** Called on SAVE_AS_PRESET. */
  onSavedAsPreset: assign({
    _settingsDraft: (): null => null,
    _presetId: ({ context }: { context: StageSettingsContext }) =>
      context._presetId,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    settingsState: () => "preset" as StageSettingsState,
  }),

  enterSettingsDefault: assign({
    settingsState: () => "default" as StageSettingsState,
  }),
  enterSettingsModified: assign({
    settingsState: () => "modified" as StageSettingsState,
  }),
  enterSettingsPreset: assign({
    settingsState: () => "preset" as StageSettingsState,
  }),
} as const;

// ---------------------------------------------------------------------------
// Count of pending settings changes (utility, used by component display)
// ---------------------------------------------------------------------------

/**
 * Returns the number of keys in the current settings draft.
 * Used by the banner label "Modified · N changes vs project default".
 */
export function countDraftChanges(
  draft: Record<string, unknown> | null,
): number {
  if (!draft) return 0;
  return Object.keys(draft).length;
}

// ---------------------------------------------------------------------------
// Mock server extension — stage settings endpoints (§1.8)
// ---------------------------------------------------------------------------

/**
 * W5.2 — Minimal no-op stub satisfying StageSettingsServices.
 *
 * For tests that only care about tool-specific behaviour and don't exercise
 * save-as-default / revert / reset. Spread into test service objects:
 *
 * ```ts
 * const services: GrayscaleToolServices = {
 *   ...stubStageSettingsServices(),
 *   detectProfile: vi.fn(...),
 * };
 * ```
 */
export function stubStageSettingsServices(): StageSettingsServices {
  return {
    saveAsDefault: () => Promise.resolve({}),
    revertSettings: () => Promise.resolve({}),
    resetSettings: () => Promise.resolve({}),
  };
}

/**
 * A minimal mock for stage settings that F5 machines can inject.
 *
 * Maintains per-(projectId × stageId) override and default layers.
 * Registry default is an empty dict (no real registry in the mock).
 * All methods are deterministic and return promptly.
 */
export function createMockStageSettingsServer(): StageSettingsServices &
  StageSettingsMockExt {
  // override layer: projectId → stageId → Record
  const overrides = new Map<string, Map<string, Record<string, unknown>>>();
  // saved-default layer: projectId → stageId → Record
  const savedDefaults = new Map<string, Map<string, Record<string, unknown>>>();

  function getLayer(
    map: Map<string, Map<string, Record<string, unknown>>>,
    projectId: string,
    stageId: string,
  ): Record<string, unknown> | undefined {
    return map.get(projectId)?.get(stageId);
  }

  function setLayer(
    map: Map<string, Map<string, Record<string, unknown>>>,
    projectId: string,
    stageId: string,
    value: Record<string, unknown>,
  ): void {
    if (!map.has(projectId)) {
      map.set(projectId, new Map());
    }
    map.get(projectId)!.set(stageId, value);
  }

  function deleteLayer(
    map: Map<string, Map<string, Record<string, unknown>>>,
    projectId: string,
    stageId: string,
  ): void {
    map.get(projectId)?.delete(stageId);
  }

  function effectiveSettings(
    projectId: string,
    stageId: string,
  ): Record<string, unknown> {
    // override > saved default > registry default (empty)
    return (
      getLayer(overrides, projectId, stageId) ??
      getLayer(savedDefaults, projectId, stageId) ??
      {}
    );
  }

  return {
    async saveAsDefault(projectId, stageId, draft) {
      setLayer(savedDefaults, projectId, stageId, { ...draft });
      deleteLayer(overrides, projectId, stageId);
      return effectiveSettings(projectId, stageId);
    },

    async revertSettings(projectId, stageId) {
      deleteLayer(overrides, projectId, stageId);
      return effectiveSettings(projectId, stageId);
    },

    async resetSettings(projectId, stageId) {
      deleteLayer(overrides, projectId, stageId);
      deleteLayer(savedDefaults, projectId, stageId);
      return effectiveSettings(projectId, stageId);
    },

    // Extension methods for testing
    _setSavedDefault(
      projectId: string,
      stageId: string,
      value: Record<string, unknown>,
    ) {
      setLayer(savedDefaults, projectId, stageId, value);
    },
    _getEffective(projectId: string, stageId: string): Record<string, unknown> {
      return effectiveSettings(projectId, stageId);
    },
  };
}

/** Test extension methods for the mock settings server. */
export interface StageSettingsMockExt {
  _setSavedDefault(
    projectId: string,
    stageId: string,
    value: Record<string, unknown>,
  ): void;
  _getEffective(projectId: string, stageId: string): Record<string, unknown>;
}
