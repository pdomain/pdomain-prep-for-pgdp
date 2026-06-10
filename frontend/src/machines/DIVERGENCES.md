# DIVERGENCES — YAML statechart vs XState v5 contract

Documents every place the XState v5 implementation intentionally deviates
from the YAML spec, with rationale. F3–F5 machines should check this list
before porting new YAMLs.

---

## #1 — Streaming services → promise + SSE split (stageRunner)

**YAML:** `runStage` is modeled as a streaming service that emits PROGRESS
ticks and resolves with a final outcome.

**XState v5:** `fromPromise` only supports a single resolve/reject. Streaming
is not natively supported.

**Resolution:** Split into two channels:

1. `fromPromise` actor (`runStage`) — resolves with the final `RunStageOutcome`.
2. `PROGRESS_PUSH` events — arrive from the `sseActor` (machine-level event,
   handled by `running.on.PROGRESS`).

**Impact:** At I1, the real `PROGRESS_PUSH` events from the SSE channel wire
into the machine unchanged. No machine state changes needed at that point.

---

## #2 — `always` guard cannot read triggering event (stageRunner)

**YAML:** `autoRerunEnabled: ctx.staleReason != null && event?.autoRerun === true`

The guard is on an `always` transition in the `stale` state and reads
`event.autoRerun` from the `UPSTREAM_CHANGED` event that caused the transition.

**XState v5:** `always` transitions fire on state _entry_ with no current
event — `event` is the machine's initial event object, not the event that
caused the transition into `stale`.

**Resolution:** Store the `autoRerun` flag in `context._pendingAutoRerun`
during the `markStale` action (which runs while `UPSTREAM_CHANGED` is the
current event). The `always` guard then reads `context._pendingAutoRerun`.

**Impact:** `_pendingAutoRerun` is a transient field — cleared when the
machine exits `stale`. F3–F5 machines with `always` guards on event data
should apply the same pattern.

---

## #3 — `event.data` → `event.output` (all machines)

**YAML:** onDone transitions use `event.data` for the resolved value.

**XState v5:** The completed actor's resolved value is at `event.output`,
not `event.data`. This is the canonical XState v5 naming.

**Resolution:** All guards and actions that reference `event.data` in the YAML
are ported to use the `params` pattern:

```ts
guard: {
  type: "myGuard",
  params: ({ event }: { event: { output: MyOutput } }) => ({ output: event.output }),
},
```

Guards and actions receive the typed `params` argument instead of reading
`event` directly, which avoids TSC TS2367 "no overlap" errors when the
internal `xstate.done.actor.*` event type is not in the declared union.

---

## #4 — PAGE_PUSH guard reads merged rows (imageStageReview)

**YAML:**

```yaml
runCompleteWithFlags: "ctx.totals.running === 1 && ctx.totals.flagged + (event.row.state === 'flagged' ? 1 : 0) > 0"
runCompleteClean: ctx.totals.running === 1 && ctx.totals.flagged === 0 && event.row.state !== 'flagged'
```

The YAML guards compute the "after-merge" state from `ctx.totals.running === 1`
(meaning this is the last running page) and the incoming `event.row.state`.

**XState v5:** Guards run before `mergePageResult` fires on the same
transition, so `context.totals` does NOT yet reflect the incoming row.
Reading `ctx.totals.running === 1` is correct (last page); computing flagged
from `event.row.state` alone misses pages already flagged.

**Resolution:** Guards compute the full post-merge state by calling
`upsertRow(context.rows, event.row)` inline, then checking `running === 0`
and `flagged > 0` / `flagged === 0`. This is equivalent in the single-page
case and correct in the multi-page case.

---

## #5 — `settleIfClear` internal event → `always` guard in browsing AND selecting (imageStageReview)

**YAML:** `settleIfClear` is an action that raises an internal `SETTLED` event
to trigger auto-transition to the `settled` state when all flags are cleared.
It is used in `selecting.BULK_ACCEPT` as well as in `editing.ACCEPT_AS_IS` and
`rerunning.onDone`.

**XState v5:** Internal event raising (`raise`) can cause unexpected ordering
with other pending transitions. The cleaner approach is an `always` guard that
checks `totals.flagged === 0 && running === 0`.

**Resolution:** `always` guard placed on BOTH `browsing` AND `selecting` (not
the parent `review` state):

- `browsing` — fires after ACCEPT_AS_IS or rerunning.onDone lands back in
  browsing with no remaining flags.
- `selecting` — fires after BULK_ACCEPT clears the last flagged pages. Without
  this guard, bulk-accepting the last flagged rows while in selecting strands
  the machine in selecting.

The guard is NOT placed on `review` directly. If it were, it would fire on
every entry to `review` — including `review.editing` via `OPEN_EDITOR` from
`settled` — and immediately re-settle before any editing could happen.

The `settleIfClear` action slot is kept as a no-op for YAML mapping completeness.

**Note on original claim:** An earlier version of this entry said the `always`
guard was placed only on `browsing`. That was incomplete — `selecting` also needs
the guard for the BULK_ACCEPT path to be faithful to the YAML's `settleIfClear`
intent.

---

## #6 — APPLY guard against parallel redetecting region (pageWorkbench)

**YAML:** `APPLY` is a top-level event; the YAML implies it is only available
from the `bench` state but does not explicitly guard against `params.redetecting`.

**XState v5:** Top-level `on.APPLY` fires regardless of what sub-states the
parallel `bench` regions are in. A transition from `bench` to `applying` would
abort an in-flight redetect (orphaned `redetect` actor).

**Resolution:** Context flag `_redetecting: boolean` is set on entry to
`bench.params.redetecting` and cleared on exit. `APPLY` is guarded by
`notRedetecting` which checks `!context._redetecting`.

**Placement flag:** This pattern (context flag to track parallel sub-state)
is reusable whenever a top-level transition must be blocked while a parallel
region is in a specific sub-state.

---

## #7 — SET_FILTER / SET_DENSITY promoted to machine-level `on` (imageStageReview)

**YAML:** `SET_FILTER` and `SET_DENSITY` are declared inside `review.on` — they
are scoped to the `review` super-state only.

**XState v5 (current):** Both events are handled at the machine-level `on`
block, making them available in all states (loading, running, settled,
confirming) in addition to review.

**Choice:** Keep machine-level scope. Rationale: these events update display
preferences (filter chip, density toggle) that the toolbar renders regardless
of which top-level state is active. Scoping them to `review` only would prevent
the user from toggling density while the stage is still running or already
settled — undesirable UX. F3–F5 machines with similar display preferences
should default to machine-level scope unless the YAML's `review`-only intent
is load-bearing.

---

## #8 — `assignWipe` / `assignSplit` (curtain positions) intentionally omitted (imageStageReview)

**YAML:** `DRAG_WIPE` calls `assignWipe` (ctx.\_wipe = event.pct) and `DRAG_SPLIT`
(in pageWorkbench) calls `assignSplit` (ctx.\_split = event.pct). These store the
wipe/split curtain position as context.

**XState v5:** `_wipe` and `_split` are view-only display coordinates — the
machine never guards on them or reads them in a service call. Storing them in
machine context adds noise to snapshots and makes equality checks brittle.

**Resolution:** Both fields are omitted from machine context. The `DRAG_WIPE`
and `DRAG_SPLIT` events are accepted (no-op transitions to stay in state) so
the machine does not reject them; the curtain position is owned by local React
state in the component.

**Convention for F3–F5:** Any YAML action of the form `ctx._xxx = event.yyy`
where `_xxx` is never read by a guard or service should be classified as
view-only and left out of machine context. Document it here so the omission is
intentional, not accidental.

---

## #9 — `recountTotals` absorbed into `acceptSelected` / `markReviewed` (imageStageReview)

**YAML:** `recountTotals` is a separate action called after `acceptSelected`,
`markReviewed`, and `mergeReRunResults` to recompute `ctx.totals` from `ctx.rows`.

**XState v5:** XState v5 `assign` actions run independently and cannot compose
across a single transition without coupling. Rather than maintaining a separate
`recountTotals` action slot that must always be co-listed, `acceptSelected` and
`markReviewed` each recompute `totals` inline (alongside the `rows` assignment)
in the same `assign` call. `mergeReRunResults` does the same.

**Impact:** The `recountTotals` action is not present in the XState implementation;
its work is inlined. F3–F5 implementers: when porting a YAML that calls
`recountTotals` as a separate step, fold it into the preceding `assign` action
that modifies `rows`. Do not implement it as a standalone action.

---

## #10 — `PROGRESS_PUSH` is NOT wired unchanged at I1 (stageRunner) {#reconcile-todo}

**YAML (earlier divergence #1 claim):** The original DIVERGENCES.md #1 stated
"`PROGRESS_PUSH` events arrive from the `sseActor` wired into the machine
unchanged. No machine state changes needed at that point."

**Correction:** This was inaccurate. The SSE channel emits
`PROGRESS_PUSH { stage_id, progress }` (the raw server payload shape from
`sseActor`). The `stageRunner` machine's `running` state handles a `PROGRESS`
event with shape `{ type: "PROGRESS", value: number }`. At I1, `pipelineShell`
(F4) must translate `PROGRESS_PUSH { stage_id, progress }` to
`PROGRESS { value }` before forwarding to the matching `stageRunner` actor.
The SSE event shape and the machine event shape differ by name and field.

**Impact on I1:** The translator belongs in `pipelineShell`. Do not attempt to
wire `PROGRESS_PUSH` directly into `stageRunner` — it will be silently ignored.

---

## reconcile-todo (stageRunner — implemented at F4)

**Previous state (F2):** The `reconcile` action in `stageRunner` was a no-op.
`STAGE_PUSH` tests asserted only that the action did not throw, not that it
drove state transitions.

**Implemented at F4:** `reconcile` is now an assign-only push-wins merge.
On `STAGE_PUSH { variant: "status", status, job_id, error_message }`:

- If `status === "clean"` or `status === "flagged"`: machine navigates to
  the matching terminal state regardless of current optimistic local state
  (push wins).
- If `status === "running"`: no state transition — local state is at least
  as current; progress continues via `PROGRESS` events.
- If `status === "failed"` / `status === "stale"` / `status === "not_run"`:
  machine transitions to the matching error or notrun state.

**Accepted limitation:** The push-wins reconcile fires on an `assign` action
inside the current state rather than as a proper state-transition guard. This
means state-entry side-effects (e.g. progress reset, toast) do not re-fire on
a server-authoritative push while the machine is already in a "done" state.
This is acceptable at F4; a proper re-entry transition should be evaluated at
I1 if race conditions with the real SSE stream surface inconsistent UI.

---

## compare-context-omission (pageWorkbench)

**YAML:** The YAML's `context:` block does not declare a `compare` field.
The viewer sub-states (`single` | `comparing`) encode the compare toggle as
machine state, not context.

**XState v5 (F2 initial draft):** A `compare: boolean` field was included in
`PageWorkbenchContext`, presumably as a convenience accessor.

**Resolution (F2 review fix):** Removed from context. The viewer region's
active sub-state is the canonical source. Components that need to know whether
compare mode is active should read `snapshot.matches({ bench: { viewer: "comparing" } })`,
not a context field.

**Convention:** Never mirror machine sub-state as a context boolean unless the
YAML declares it in context or a guard reads it. Use the state tree directly.

---

## Placement flags

### `createSseActor` (sseActor.ts)

The `createSseActor` factory wraps a `(projectId, cb) => unsubscribe`
subscription function and maps server channel events to typed machine events
(`STATUS_PUSH`, `STAGE_PUSH`, `PROGRESS_PUSH`). This pattern is reusable by
any XState v5 machine in any `pd-*` SPA that consumes a server-push channel
with the same event-to-machine-event mapping.

**Recommendation:** Evaluate for promotion to `pdomain-ui` (the shared
frontend library) at I1 when the real EventSource adapter is wired in.

### `bindQueryClient` (query.ts)

The `bindQueryClient<TServices>` helper is a thin type-safety shim with no
runtime cost. If `pdomain-ui` ships a canonical service-injection pattern for
XState machines, this helper (or a version of it) belongs there.

---

---

## F3-1 — Poll timer uses `after:` instead of side-effect start/stop (projectDetail)

**YAML:** `startPollTimer` / `stopPollTimer` actions manage a polling side-channel.

**XState v5:** Used `after: 10000` delayed transition from the
`ready.selection.hasSelection.polling` state back to a `refetch` invoke.
This is idiomatic XState v5 and avoids external timer cleanup.

**Impact:** Polling cadence is 10s, configurable at machine setup time.
The YAML's intent (periodic background refresh) is preserved.

---

## F3-2 — `isDirty` computed inline (attributesPanel)

**YAML:** `isDirty` is declared as a named helper function / getter.

**XState v5:** Computed inline in guards and context initialization using
`deepEqual(context.draft, context.original)`. No named helper needed —
inlining keeps the guard self-contained.

---

## F3-3 — 4-section collapse state consolidated into `tracking` (attributesPanel)

**YAML:** Four separate parallel binary regions
(`bib.open/closed`, `pgdp.open/closed`, `fmt.open/closed`, `comments.open/closed`).

**XState v5:** Parallel binary regions for display state add significant state
combinatorics with no behavioral gain. Consolidated into a single
`collapsed: Set<AttributeSection>` context field, toggled by `TOGGLE_SECTION`
event.

**Impact:** Section open/close state is still fully deterministic and
testable; just stored as a context set instead of 4 parallel regions.

---

## F3-4 — Child actor spawning delegated to React component layer (projectDetail)

**YAML:** `projectDetail` spawns `recentActivity`, `attributesPanel`, and `manageActions` child actors via `spawnChild`.

**XState v5 (current):** Spawning is delegated to the React component via
`onRespawnActivity`, `onRespawnAttributes`, `onRespawnManage` callbacks
(F3-4 divergence). The component mounts/unmounts child machines as
`useActor` hooks when the project selection changes.

**Rationale:** Avoids the complexity of `spawnChild` + snapshot serialization
at I1. The behavioral contract (child machines are created on SELECT,
destroyed on CLEAR_SELECTION) is preserved.

**At I1:** Promote to `spawnChild` inside the machine when the full actor model integration is needed.

---

## F3-5 — `size` / `reclaimable` view-fields omitted from ManageTabPanel header

**YAML / canvas:** The `manage-actions.yaml` artboard shows an optional header
row with the project's on-disk size and reclaimable bytes after a `clean` run.

**XState v5 (current):** The `ManageActionsResult` struct includes
`reclaimedBytes` and `zippedSize`, but the `ManageTabPanel` component does
not render a size/reclaimable header row. The action list and the confirm
dialog are fully wired; the stat display is deferred.

**Rationale:** The size fields are view-only metadata. They require an
additional backend call (`GET /api/data/projects/:id` size field) that is
already surfaced in the `detail-stats` grid. Adding a redundant stat row
in Manage would duplicate data without adding actionable value at I1.

**Pending at I1:** If the canvas design is load-bearing (shows post-clean
reclaim result inline), add a `lastCleanResult: ManageActionResult | null`
state slot to the component and render it after the `done` toast.

---

## F3-6 — `spawnRail` implemented in React, not in the machine (projectDetail)

**YAML:** `projectDetail` owns the full lifecycle including spawning the
`railList` actor so both machines share a project-list subscription.

**XState v5 (current):** `railList` and `projectDetail` are spawned
independently via `useActor` at the `ProjectsPage` component level.
Cross-machine communication (rail refresh on mutation) is handled by the
`onRefreshRail` callback in `projectDetailMachine` input, which directly
calls `railSend({ type: "PROJECTS_CHANGED" })` from the component.

**Rationale:** Avoids `spawnChild` complexity at I1. The behavioral contract
(rail re-fetches on project mutation) is preserved.

**At I1:** Promote to `spawnChild` inside `projectDetail` when the full
actor-model integration is needed (F3-4 and F3-6 can be addressed together).

---

## F3-7 — Paste-URL / Import-archive entry points omitted from empty state (ProjectsEmpty)

**Canvas:** The DCArtboard `ProjectsEmpty` shows two secondary affordances:
a "Paste source URL" button and an "Import a .pgdp-prep archive" link, in
addition to the primary "Create new project" action.

**Current implementation:** Both affordances are omitted from `ProjectsEmpty`.
The `projectDetail` machine retains the `PASTE_SOURCE_URL` and
`IMPORT_ARCHIVE` events for when backend support arrives, but the entry-point
UI is not rendered.

**Rationale:** Workspace rule — UI elements must be visible + enabled +
functional, or not rendered at all. Neither flow has backend support yet.
Rendering them as dead stubs (`href="#"` / no-op `onClick`) was flagged as
a workspace violation. They will be restored once the matching backend routes
exist.

---

---

## F4-1 — `projectSettings` child actor spawning delegated to React component (pipelineShell)

**YAML:** `pipeline-shell.yaml` does not explicitly describe `projectSettings`
spawning, but the canonical YAML actor model implies the shell machine spawns
`projectSettings` as a child actor alongside the `stageRunners`.

**XState v5 (current):** `projectSettings` is instantiated via `useActor()` in
`PipelinePage.tsx`. The shell machine tracks whether settings mode is active via
a `_inSettings: boolean` context flag + `openSettings` / `closeSettings` events.
The component mounts `projectSettingsMachine` as a hook whenever `_inSettings` is
true.

**Rationale:** Matches the F3-4 / F3-6 pattern — avoids `spawnChild` complexity
at I1. The behavioral contract (settings actor is alive while the shell is in
`mode.settings`) is preserved.

**At I1:** Promote to `spawnChild` inside `pipelineShellMachine` when full
actor-model integration is needed (same migration path as F3-4 / F3-6).

---

## F4-2 — `runAllStale` coordinator spawning delegated to React component (pipelineShell)

**YAML:** `pipeline-shell.yaml` implies the shell orchestrates a `runAllStale`
coordinator to sequence stale stage runs.

**XState v5 (current):** `runAllStale` is instantiated via `useActor()` in
`PipelinePage.tsx`, mounted only when the user activates "Run All Stale". The
shell receives `RUN_ALL_STALE` and sets `_runAllStaleActive: boolean` context
which the component observes.

**Rationale:** Matches F3-4 pattern. Avoids `spawnChild` at I1.

**At I1:** Promote to `spawnChild` when full actor-model integration is needed.

---

## F4-3 — Tab initial state uses `initial:` idiom (pipelineShell tab region)

**YAML:** The tab region's initial state is `active` (a single leaf state that
holds the current tab ID in context). The spec implies a `settleInitialTab`
action on entry.

**XState v5 (current):** The tab region uses a single `active` state with
`context.activeTab` initialized to the first tab for the default stage. Tab
switches are driven by `SELECT_TAB { tabId }` events calling `assign()`.

**Impact:** No `settleInitialTab` action slot; initialization is done inline in
`context.activeTab` initialization. This is idiomatic XState v5 and avoids an
artificial entry-action.

---

## F4-4 — Fan-out `UPSTREAM_CHANGED` via side-effect action (pipelineShell)

**YAML:** `fanOutStale` is described as calling `forEach(downstreamIds, id =>
runners[id].send(UPSTREAM_CHANGED))`.

**XState v5:** `sendTo` only targets a single actor. There is no built-in
multi-target `sendTo`. Using `raise` loops would require N separate `raise`
calls at declaration time (not dynamic).

**Resolution:** `fanOutStaleSideEffect` is a plain side-effect action (not
`sendTo`) that reads `context.runners` and calls `ref.send()` on each
downstream `StageRunnerRef` returned by `computeDownstream()`. This is
equivalent behavior without the `sendTo` constraint.

**Impact:** Fan-out tests verify the downstream runners receive `UPSTREAM_CHANGED`
events. `fanOutStaleSideEffect` is a typed action with no return value (side-effect
only, no context mutation).

---

## F4-5 — Tool slot placeholder is intentionally visible (PipelinePage / toolSlot.tsx)

**Spec acceptance rule:** Workspace rules require that UI elements are either
visible + enabled + functional, OR not rendered at all. Dead stubs are not
permitted.

**F4 exception:** The tool slot placeholder (`data-testid="tool-slot-placeholder"`)
is intentionally visible and labeled "F5 pending" because Task F5 will fill the
`TOOL_REGISTRY` with real per-stage tool components within this same plan
iteration. The placeholder is NOT a dead stub — it communicates to F5 exactly
where to plug in.

**Contract (F5 must satisfy):** Each tool slot receives `{ stageId: string,
runnerRef: StageRunnerRef }` and renders whatever UI the stage's workbench/tool
tab needs. Register via `TOOL_REGISTRY[stageId] = MyToolComponent` in
`toolSlot.tsx`.

---

## F4-6 — `hasNext` guard uses `STAGE_DEFS.length - 1` instead of literal `< 22` (pipelineShell)

**YAML:** `hasNext: ctx.currentIndex < 22` — a literal bound derived from the
24-stage registry (indices 0–23).

**XState v5 (F4):** Guard is `context.currentIndex < STAGE_DEFS.length - 1`.
Equivalent today (STAGE_DEFS.length === 24, so `< 23` and `< STAGE_DEFS.length - 1`
are the same bound). Using the computed form means the guard automatically
stays correct if the registry grows, without requiring a coordinated literal
update in two places.

**Impact:** None at F4. If STAGE_DEFS is ever extended (new stage or source
split), `hasNext` stays correct without a separate edit.

---

## F4-7 — `queueDrained` guard strengthened to include `currentIndex === null` (runAllStale)

**YAML:** `queueDrained: ctx.queue.length === 0`

**XState v5 (F4):** Guard is `context.queue.length === 0 && context.currentIndex === null`.

**Reason:** `runNext` pops the current stage from `queue` before setting
`currentIndex`. Immediately after `runNext` fires, `queue.length` can be 0
while a stage is still running (`currentIndex !== null`). Checking only
`queue.length === 0` would prematurely fire the `done` transition while the
last stage is mid-flight. The strengthened guard waits until `advance` resets
`currentIndex` to `null` (after `STAGE_DONE` resolves), which is the correct
"all stages have actually finished" condition.

**Impact:** Prevents a premature `done` transition on the last stale stage in
a run-all-stale sweep.

---

---

## F5-1 — Settings region extracted into `stageSettings.ts` (sourceTool)

**YAML:** The settings parallel region (`default` / `modified` / `preset` states,
CHANGE_SETTING / SAVE_AS_DEFAULT / REVERT / SAVE_AS_PRESET / LOAD_PRESET /
RESET_TO_DEFAULT events) is declared inline inside `tool-source.yaml`.

**XState v5:** The settings region types, actors, guards, and action implementations
are extracted into `src/machines/tools/stageSettings.ts`. Each stage tool machine
(F5.1–F5.6) imports `stageSettingsActors`, `stageSettingsGuards`, and the exported
action implementation as documentation.

**Phantom-type constraint (important for F5.2–F5.6):** XState v5 `ActionFunction`
carries phantom type markers (`_out_TEvent`, `_out_TActor`, etc.) that make an
`ActionFunction<StageSettingsContext, StageSettingsEvent, ...>` structurally
incompatible with `ActionFunction<SourceToolContext, SourceToolEvent, ...>` even
though `SourceToolContext extends StageSettingsContext`. Spreading the pre-built
`stageSettingsActions` object into a machine with an extended context type causes
a TypeScript error that cascades to break ALL string action references in the machine.

**Resolution:** Each tool machine inlines the 9 settings actions directly in its
`setup({ actions })` block, typed with its own `TContext`/`TEvent`. The canonical
implementations are documented in `stageSettings.ts` as `stageSettingsActions`
(used only for the base `StageSettingsContext`/`StageSettingsEvent` machine,
and exported as documentation for F5.2–F5.6 to copy verbatim).

**Pattern for F5.2–F5.6:** Copy the 9 settings action bodies from `source.ts`
directly — change only the `SourceToolContext` / `SourceToolEvent` type annotations.
The implementations are identical; TypeScript requires separate typed copies.

**Impact:** The parallel `settings` region state machine in each tool is identical.
Actors (`stageSettingsActors`) can still be spread without cast — only `ActionFunction`
types have this restriction.

---

## F5-2 — `canConfirm` reads `context._thumbsDone` mirror (sourceTool)

**YAML:** `canConfirm: ctx.totals.unmarked === 0 && thumbnailsRegionIn('done')`

`thumbnailsRegionIn('done')` tests the parallel `thumbnails` sub-state from inside
the `files` region guard.

**XState v5:** Guards in one parallel region cannot directly read the state of
another parallel region without a full snapshot traversal. Using
`snapshot.matches({ thumbnails: 'done' })` inside a guard is not possible since the
guard only receives `{ context, event }`, not the snapshot.

**Resolution:** `_thumbsDone: boolean` is stored in context. It is set to `true` by
the `markAllThumbed` action (triggered on `THUMBS_DONE`) and cleared to `false` by
`requestRegenerate` (triggered on `REGENERATE`). The `canConfirm` guard reads
`context._thumbsDone` instead of the parallel sub-state.

**Impact:** `_thumbsDone` must be kept in sync with the `thumbnails` region.
Any future thumbnail-path change must also update `_thumbsDone`.

---

## F5-3 — Settings actor invocations fully wired as `fromPromise` (sourceTool) {#resolved}

**YAML:** `SAVE_AS_DEFAULT`, `REVERT`, and `RESET_TO_DEFAULT` transitions call
`services.persistAsProjectDefault`, `services.revertSettings`, and
`services.resetSettings` respectively as invoke.src actors (server round-trips).
`SAVE_AS_PRESET` is fire-and-forget (no await).

**XState v5 (F5.1 fix):** All three blocking transitions are now wired as proper
`fromPromise` actor invocations with transient intermediate states:

- `SAVE_AS_DEFAULT` in `modified` → transitions to `saving` state, invokes
  `"saveAsDefault"` actor, `onDone` → `default` (runs `onSavedAsDefault` action),
  `onError` → back to `modified` (runs `assignError`).
- `REVERT` in `modified` → transitions to `reverting` state, invokes
  `"revertSettings"` actor, `onDone` → `default` (runs `revertSettingsAction`),
  `onError` → back to `modified` (runs `assignError`).
- `RESET_TO_DEFAULT` in `preset` → transitions to `resetting` state, invokes
  `"resetSettings"` actor, `onDone` → `default` (runs `revertSettingsAction`),
  `onError` → back to `preset` (runs `assignError`).
- `SAVE_AS_PRESET` in `modified` → synchronous fire-and-forget; calls
  `onSavedAsPreset` action then immediately targets `preset` state.

**UI handling:** `SourceStepSettings` accepts `settingsState` values of
`"saving" | "reverting" | "resetting"` (in addition to `"default" | "modified" | "preset"`)
to disable buttons and show "Saving…" / "Resetting…" labels during in-flight requests.

**Tests:** `source.test.ts` asserts each service method is called exactly once
with the correct payload (projectId, stageId, draft).

**Impact at I1:** No further changes needed — the actor pattern is live.
Only the mock server implementations need to be swapped for real API calls.

---

## F5-4 — `_thumbsDone` context mirror for parallel sub-state (sourceTool)

_See F5-2 above — this entry records the specific context field pattern._

**Pattern rule for F5.2–F5.6:** Any YAML guard of the form
`parallelRegionIn('someState')` must be resolved via a `_stateName: boolean`
context field updated by the entry/exit actions of the relevant parallel states.
This is the canonical solution whenever a guard in region A needs to test the
state of region B.

---

## F5-5 — `recountTotals` folded inline (sourceTool)

**YAML:** `recountTotals` appears as a separate step after file mutations
(markSelected, assignRole, removeSelected, createInsertedRow, markAllThumbed,
requestRegenerate).

**XState v5:** Follows DIVERGENCES.md #9 convention. The `recount(files)` helper
is called inside the same `assign` action that mutates `files`, returning the new
`totals` in the same assignment object. No standalone `recountTotals` action exists.

**Impact:** None — the recount result is identical. The convention prevents
a class of bugs where `files` and `totals` drift out of sync because a caller
forgot to chain the separate action.

---

## Notes for F3–F5

1. Every `onDone` that was `event.data` in YAML → use `event.output` + params pattern.
2. `always` transitions that need event data → store in a `_pending*` context
   field during the triggering action, read in the guard.
3. Parallel state entry/exit tracking (for top-level guards) → use a
   `_flag: boolean` context field with entry/exit actions.
4. `settleIfClear`-style "conditional raise" → place `always` guards in EVERY
   sub-state that can call `settleIfClear` (browsing AND selecting in
   imageStageReview). A guard only in `browsing` leaves the `selecting` path
   without auto-settle.
5. `recountTotals` as a separate YAML action → fold it into the preceding
   `assign` that modifies `rows`; do not implement as a standalone action.
6. View-only context fields (`_wipe`, `_split`, `compare`) → omit from machine
   context; own them in local React state or read directly from machine
   sub-state via `snapshot.matches(...)`.
7. `SET_FILTER` / `SET_DENSITY` style display-preference events → promote to
   machine-level `on` (not scoped to a single super-state) unless the YAML's
   scoping is genuinely load-bearing UX.
