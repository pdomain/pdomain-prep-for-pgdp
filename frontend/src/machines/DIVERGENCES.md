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

## #10 — `PROGRESS_PUSH` is NOT wired unchanged at I1 (stageRunner) {#resolved-I1}

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

**Resolved at I1:** `PipelinePage.tsx` (I1 wiring) subscribes to the project
SSE channel via `subscribeProject` + `mapProjectEvent` and forwards `STAGE_PUSH`
and `PROGRESS_PUSH` to `pipelineShellMachine`. The shell's `routeStagePush`
action translates `PROGRESS_PUSH` into `PROGRESS { value }` when forwarding to
the matching `stageRunner` actor. See `PipelinePage.tsx:subscribeProjectSse`.

**STATUS_PUSH resolved (R4):** `StatusPushEvent` is in `PipelineShellEvent` and
`PipelinePage` forwards all four variants. `routeStatusPush` routes snapshot/
stage-status to the matching runner via `STAGE_PUSH`, and sends
`UPSTREAM_CHANGED` to `page_order` (on page-reorder) and `validation` (on
validation-updated). See DIVERGENCES.md §F4-8 for the full routing contract.

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

## F4-8 — Project SSE subscription in component layer (PipelinePage)

**YAML:** SSE actor is spawned inside the machine and delivers `STAGE_PUSH` /
`PROGRESS_PUSH` events to the parent via `sendBack`.

**XState v5 (I1):** The project SSE subscription lives in `PipelinePage`'s
`useEffect`, not inside `pipelineShellMachine`. This matches the F4-1
pattern (projectSettings), F3-4/F3-6 (projectDetail):

```ts
useEffect(() => {
  const unsubscribe = subscribeProject(projectId, (event) => {
    const machineEvent = mapProjectEvent(event);
    if (
      machineEvent.type === "STAGE_PUSH" ||
      machineEvent.type === "PROGRESS_PUSH"
    ) {
      send(machineEvent);
    }
  });
  return unsubscribe;
}, [projectId, send]);
```

**Resolved (STAGE_PUSH + PROGRESS_PUSH):** Both event types are forwarded at I1.
`routeStagePush` in `pipelineShellMachine` routes them to the matching
`stageRunner` actor. See also DIVERGENCES.md #10 for the PROGRESS_PUSH shape
translation.

**Resolved (STATUS_PUSH — R4):** `StatusPushEvent` is included in
`PipelineShellEvent`. `routeStatusPush` now handles all four project-channel
variants:

- `snapshot` — seeds/reconciles every runner from `project_stages` via
  `STAGE_PUSH { variant: "status" }`. Source stage (no runner) is silently
  skipped. Fires on (re)connect so runners are never cold.
- `stage-status` — routes incremental project-stage transitions to the
  matching runner as `STAGE_PUSH { variant: "status" }`.
- `page-reorder` — sends `UPSTREAM_CHANGED { autoRerun: false }` to the
  `page_order` runner so it re-fetches the page ordering.
- `validation-updated` — sends `UPSTREAM_CHANGED { autoRerun: false }` to
  the `validation` runner so it re-checks.

`page-snapshot` arrives on the per-page channel and is handled separately.

---

---

## Task F5.1 (source tool) divergences

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

## Task F5.2 (image-prep tools) divergences

## F5-1 — `APPLY_RUN` uses absolute state ID `#grayscaleTool.converting` (grayscaleTool)

**YAML:** `done.tuned.APPLY_RUN` has `target: '#grayscaleTool.converting'` — a
YAML cross-parent target using the anchor-ID syntax.

**XState v5:** Absolute state ID targets that cross a parent boundary must be
written as string literal `"#grayscaleTool.converting"` in XState v5. The
YAML's notation is preserved exactly, but the `#` prefix must be present
(without it, XState v5 resolves relative to the `done.tuned` parent, looking
for a `converting` sibling of `idle/tuned` — which doesn't exist).

**Impact:** The transition works. At I1, if the machine ID changes, this
string literal must be updated to match. Document the machine `id` alongside
this divergence: `id: "grayscaleTool"`.

---

## F5-2 — `isLastPage` uses `_total` sentinel on page object (grayscaleTool)

**YAML:** `isLastPage: doneCount(ctx.pages) + 1 === ctx.pages.length`

The YAML assumes `ctx.pages` is pre-populated with placeholder entries for
ALL expected pages (total count known in advance). `doneCount` counts filled
entries; the guard fires when the incoming push fills the last slot.

**XState v5 (F5):** At F5, the machine does not receive the total page count
from the server before PAGE_PUSH events arrive. `ctx.pages` starts empty and
grows with each push. Without a known total, `isLastPage` would never fire.

**Resolution:** The page object carries an optional `_total: number` field.
When present, `isLastPage = nextPages.length >= _total`. The mock adapter
sets `_total` on the final page. When `_total` is absent, the guard returns
`false` (machine waits).

**At I1:** Remove `_total` from the page shape. Instead, receive the page
count from the `fetchStageState` pre-flight call (server knows the total
before streaming begins). Store it in `context._pageTotal` and use that
in the guard.

---

## F5-3 — `PREV_PAGE` / `NEXT_PAGE` in editing stay in editing via in-place actions (pagesGrid)

**YAML:** `ready.editor.editing.PREV_PAGE` and `NEXT_PAGE` call
`stepToPrevPage` + `beginDraft` as actions and stay in `editing`. The YAML
implies a re-entry into `editing` with a fresh draft.

**XState v5:** Actions without a `target` fire in-place — the machine stays in
`editing`. `stepToPrevPage` is an `assign` that moves `selectedPageId` to the
prior visible page. `beginDraft` refreshes the draft from the new selected page.
The net effect (draft refreshed, editor stays open) is identical to a re-entry.

**Impact:** No separate `target: editing` needed. The YAML's `stepToPrevPage +
beginDraft` pattern ports directly as an action-only handler.

---

## F5-4 — `saveError` targets `editing` (not a separate error sub-state) (pagesGrid)

**YAML:** `ready.editor.editing.saving.onError: { target: editing, actions: [assignError] }`

The YAML targets `editing` on save failure — the user stays in the editor with
an error displayed.

**XState v5:** Implemented as `onError: { target: "#pagesGrid.ready.editor.editing",
actions: ["assignError"] }`. The error is stored in `context.error` and cleared
on the next `EDIT` or `OPEN_EDITOR` event. No separate `saveError` leaf state.

**Impact:** The machine has no `saveError` sub-state; the inline error is surfaced
via `context.error` while in `editing`. The component renders it as an inline
banner inside the editor.

---

## F5-5 — Dewarp inline-editor controls differ from design canvas (stageSchemas) {#I1-reconcile}

**Design canvas (`dewarp.jsx` DewarpReviewEditor) inline-editor controls:**

- `Warp strength` (Off / Mild / Standard / Strong) — 4-position segmented
- `Anchor mode` (Auto / Manual anchors) — 2-position segmented

These are canvas-design controls for interactive per-page warp tuning.

**`stageSchemas.ts` DEWARP_SCHEMA controls:**

- `model` (select: thin_plate_spline / polynomial / cylinder)
- `stiffness` (slider: 0.0–1.0)
- `gutterRemove` (toggle)

**Delta:** The schema uses the settings-panel control vocabulary (model
algorithm + numeric stiffness + gutter toggle) while the design canvas uses a
simplified end-user vocabulary (warp-strength segmented + anchor-mode toggle).
Neither set is wrong — they represent different levels of the same
configuration.

**Resolution (I1):** Option 1 chosen — keep the schema controls (model +
stiffness + gutterRemove) as the canonical inline-editor controls. These
controls are already implemented and exercised in tests. The canvas vocabulary
(`warpStrength` / `anchorMode`) is a UX polish concern appropriate for I3 if
CT decides the simplified vocabulary is load-bearing for end-user workflows.
No mapping layer needed at I1.

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

---

---

## F5-3-1 — `runComplete` guard checks post-merge totals not YAML's `done + 1 === total` (ocrTool)

**YAML:** `runComplete: ctx.totals.done + 1 === ctx.totals.total`

The YAML assumes exactly one `PAGE_PUSH` event arrives at a time (serial stream).
The check `done + 1 === total` means "this push is the last one."

**XState v5 (F5.3):** Guards run before `mergePage` fires on the same transition.
`context.totals.done` does NOT yet reflect the incoming `event.row`. Furthermore,
in a batched mock scenario multiple pages may already be done when the guard fires.
The YAML's `done + 1 === total` formula can miss the terminal case if 2+ pages
arrive before the guard runs.

**Resolution:** `runComplete` calls `upsertOcrRow(context.rows, event.row)` inline
and checks `running === 0` on the post-merge set. This is equivalent in the
single-page case and correct in the multi-page case.

**Impact:** Guard reads post-merge state; `mergePage` assign fires on the same
transition immediately after. No double-merge (upsert is idempotent by idx).

---

## F5-3-2 — `density` / `filter` are local React state in OcrTool (view-only) (ocrTool)

**YAML:** `tool-ocr.yaml` implies `density` and `filter` as machine context fields.
The canvas shows them as grid display controls (filter chip set, density toggle).

**XState v5 (F5.3) / DIVERGENCES.md #8:** `density` and `filter` are never read by
a guard or service in `ocrTool`. They are pure display preferences — the machine never
transitions based on them. Storing them in machine context adds noise to snapshots.

**Resolution:** Both fields are local `useState` in `OcrTool.tsx`. The component
derives the filtered row list from `rows` using the local filter value.

**Convention:** Any YAML field that is (a) never guarded on and (b) never passed to
a service is a view-only field. Own it in local React state; do not put it in the
machine. (Same rule as `_wipe`, `_split`, `compare` — documented in #8.)

---

## F5-3-3 — `textZonesTool` starts in `loading` (not active) vs `ocrTool` starts in `recognising` (ocrTool, textZonesTool)

**YAML:** Both tools start with a fetch/run phase.

- `text_zones` fetches existing zone data before showing the page grid.
- `ocr` starts already running; there is no initial fetch — the tool receives
  PAGE_PUSH events from the SSE actor.

**XState v5 (F5.3):**

- `textZonesToolMachine` initial state: `"loading"` (invokes `fetchZonePages`).
- `ocrToolMachine` initial state: `"recognising"` (waits for PAGE_PUSH events).

This asymmetry is intentional and faithful to the YAML intents. The two tools are
behaviorally distinct: text_zones reviews existing detector output; ocr runs and
streams live results.

**Impact at I1:** When wiring the SSE actor, the integrator must start `ocrTool`
before the SSE stream begins (or buffer early PAGE_PUSH events). `textZonesTool`
can be mounted at any time since it fetches on entry to `loading`.

---

## F5-3-4 — `_weights` kept in context despite DIVERGENCES.md #8 view-field rule (ocrTool)

**YAML:** `SET_WEIGHTS: ctx._weights = { ...ctx._weights, ...event.patch }`

**DIVERGENCES.md #8** says view-only fields should be omitted from context. At first
glance `_weights` looks view-only (underscore prefix, display-preference-like name).

**Resolution:** `_weights` IS kept in context because it is not view-only. At I1
it is read by the `confirmStage` / engine-config service input to select the
detection + recognition checkpoint. A field passed to a service is NOT view-only
regardless of naming convention.

**Convention:** The `_` prefix in the YAML does NOT automatically mean view-only.
Check whether the field is read by a guard or service. If yes, keep it in context.
Only omit if it is exclusively used for display.

---

## F5-3-5 — ZoneStepSettings uses local state only (no stageSettings machine) (textZonesTool)

**Spec / F5.1:** The `stageSettings.ts` machine pattern (defined in F5.1) provides
a shared `stageSettingsMachine` with `stageSettingsActions` for storing and
applying stage configuration. The ActionFunction phantom-type constraint in
`stageSettings.ts` requires each consumer to inline the 9 settings actions
typed to its own `Context/Event` union — they cannot be spread from a shared
`stageSettingsActions` object.

**XState v5 (F5.3, original claim):** This entry previously stated that
`stageSettings.ts` was "NOT present in this worktree at the time F5.3 was
written." That claim is now stale — `stageSettings.ts` IS present in the tree
(rebased in from the F5.1 worktree). The file lives at
`src/machines/tools/stageSettings.ts`.

**Current status:** `ZoneStepSettingsTab` still uses local `useState` for
`splitsOn` and `granularity` with no-op handlers (the W1 settings-threading
work is not yet done). This is an open W1.x gap, not a worktree-isolation
artifact.

**At I1 / W1:** Wire `textZonesToolMachine` to the `stageSettings` pattern —
add the 9 settings actions inline (typed to `TextZonesToolContext /
TextZonesToolEvent`) and connect `ZoneStepSettingsTab` to the machine.
Do NOT spread `stageSettingsActions` from `stageSettings.ts` — that breaks
the ActionFunction phantom-type (see F5-1 for the inlining rule).

---

## F5-3-6 — OcrStepSettings uses local state only (no stageSettings machine) (ocrTool)

**Same situation as F5-3-5** but for `OcrStepSettingsTab`. The `engine` and `backend`
props are passed from `snapshot.context` (both fields are machine context, not
view-only — they will be passed to `confirmStage` at I1). The Settings tab renders
them as read-only display cards at F5; no active controls (the engine selector is
display-only and the backend segmented control shows the current value but is not
interactive).

**At I1:** Wire the engine / backend controls to `SET_ENGINE` / `SET_BACKEND`
events on `ocrToolMachine`. When `stageSettings.ts` is rebased in, inline the 9
settings actions as per the ActionFunction phantom-type rule (see F5-3-5).

---

## F5-3-I1 — SplitDraft mock shape vs real API shape (textZonesTool — I1 translation note)

**F5 mock shape (SplitDraft):**

```ts
{ axis: "col" | "row", into: 2, gutter: number, conf: number }
```

`SplitDraft` is the F5 internal representation used in the mock split editor and
carried in `context.splitDraft` for the gutter-drag preview. `axis`, `into`,
`gutter`, and `conf` are all derived from the mock layout detector's output.

**Real API shape (I1 — POST .../text_zones/apply_split response):**
The real backend responds with:

```json
{ "suffixes": ["a", "b"], "bbox": { "x": ..., "y": ..., "w": ..., "h": ... }, "split_at_stage": "post_transform_crop" }
```

where `suffixes` are the child page ID suffixes, `bbox` is the split boundary, and
`split_at_stage` identifies which pipeline stage owns the split geometry.

**Translation required at I1:**

- `SplitDraft.gutter` → must be mapped to `bbox` coordinates for the `applySplit` API call.
- The `parentRow` / `childRows` result returned by the real endpoint will have proper
  `parent_page_id` / `source_crop_bbox` / `split_index` set (spec: splits-as-sibling-pages).
  The mock `SplitResult` shape only carries `parentRow` + `childRows` — this is
  sufficient for F5 but the real result will carry more fields.
- At I1, `textZonesToolServices.applySplit` must translate the `SplitDraft` into
  the API's expected request body and map the API response back to `SplitResult`.

**SAVE_LAYOUT recount note:**
`SAVE_LAYOUT` in the machine calls `persistLayout` and transitions to `browsing`.
The `markReviewed` action updates the single row in `context.rows` and recomputes
`totals` inline (DIVERGENCES.md #9 pattern). There is no separate `recountTotals`
step. The inline recount is correct for the mock (single row updated); at I1 the
same pattern applies to the real persist response.

---

## Task F5.4 (compose tools) divergences

### F5.4-1 — Naming as workspace-level event, not parallel region (pageOrderTool)

**YAML:** Defines `naming` as a fourth parallel region alongside `ledger`,
`inspector`, and `runs`. The naming region has no sub-states — it only handles
`SET_NAME_PART` to update `namingScheme`.

**XState v5:** Four-region parallel states impose a combinatorial explosion of
compound state keys with no behavioral benefit when one region is stateless.

**Resolution:** Naming is implemented as a `SET_NAME_PART` event handler on the
`workspace` state directly (not a parallel child). `namingScheme` lives in
machine context and is updated by an inline `assign` action. The three genuine
parallel regions are retained: `ledger` × `inspector` × `runs`.

**Impact:** Machine snapshot has three parallel sub-states instead of four. No
semantic difference — naming behaviour is identical.

---

### F5.4-2 — Inspector watches `SELECT_LEAF` directly (pageOrderTool)

**YAML:** `ledger.browsing` dispatches `assignSelectedLeaf` which raises an
internal `LEAF_SELECTED` event; `inspector.closed` listens for `LEAF_SELECTED`
to open.

**XState v5:** Internal events raised via `raise()` from one parallel region are
not reliably delivered to sibling regions in the same microstep (the precise
ordering depends on XState v5 internals and is not part of the public contract).

**Resolution:** `inspector.closed` listens for `SELECT_LEAF` (the original
external event) directly. Both `ledger.browsing` and `inspector.closed` handle
`SELECT_LEAF`: ledger assigns the selected leaf into context; inspector
transitions from `closed` → `open`. No internal `LEAF_SELECTED` event is raised.

**Impact:** Same outward behaviour. Eliminates a cross-region raise that was
fragile in XState v5's parallel delivery model.

---

### F5.4-3 — `computeLabels` + `reconcile` as pure assign helpers (pageOrderTool)

**YAML:** Models `computeLabels` and `reconcile` as named actions that update
context.

**XState v5:** Both are pure functions of `(leaves, runs, namingScheme)` →
updated context. Implemented as private module-level functions (`computeLabels`,
`reconcile`) called inside `assign` callbacks. No separate named action entries
in the machine definition are needed — the calling `assign` is the action.

**Impact:** No behavioural difference. The `assign` callbacks are the XState v5
equivalent of named context-mutating actions.

---

### F5.4-4 — Side-effect services paired with assign actions (pageOrderTool)

**YAML:** Some actions both update context and call a persistence service
(e.g. `persistLeaf`, `persistOrder`, `persistRuns`, `persistNaming`,
`emitOrderChanged`).

**XState v5:** `assign` is pure — it must not call services. Side effects
belong in separate `void`-typed action entries.

**Resolution:** Each mutation spawns two action entries in sequence:

1. An `assign(...)` action that updates context.
2. A companion `({ context }, _ev, { input }) => { input.services.persistFoo(...) }`
   action that calls the injected service (fire-and-forget, no awaiting).

Both actions are listed in the event's `actions` array in order.

**Impact:** Two action entries per mutating event instead of one, but the
XState v5 action contract is preserved (assigns are pure; side effects are
separate).

---

### F5.4-5 — `needsALook` guard uses params pattern (illustrationsTool)

**YAML:** `needsALook` reads `event.output.counts` from the `detectRegions`
`onDone` transition to decide whether to enter `reviewing` or `extracted`.

**XState v5:** DIVERGENCES.md #3: `event.data` is `event.output` in XState v5.
Additionally, the guard cannot access `event.output` directly at the call site
without a params extraction.

**Resolution:** `needsALook` uses the params pattern (DIVERGENCES.md #3):

```ts
guard: {
  type: "needsALook",
  params: ({ event }) => ({ counts: event.output.counts }),
},
```

The guard function signature is `(_args, params: { counts: IllustrationCounts })`.
The implementation reads `params.counts.review + params.counts.flagged > 0`.

**Impact:** Same semantic as the YAML guard. Fully type-safe under XState v5's
static inference.

---

### F5.4-6 — `settleIfClear` → `always` guard on `reviewing` (illustrationsTool)

**YAML:** `settleIfClear` is a named action that inspects context and raises
`SETTLED` internally when all items are extracted.

**XState v5:** Internal `raise` inside a non-entry action to trigger a
state-machine transition is an anti-pattern in XState v5 (creates implicit
ordering dependencies). DIVERGENCES.md #5 establishes the canonical pattern.

**Resolution:** `reviewing` has an `always` transition with `guard: "allExtracted"`
that targets `extracted` and runs `emitResolved`. This fires automatically after
any action that modifies `context.counts` (e.g. `markExtracted`, `removeRegion`).

**Impact:** Same externally observable behaviour — `reviewing` auto-transitions
to `extracted` when all items are confirmed or dropped. No internal event needed.

---

### F5.4-7 — `recount` folded into assign actions (illustrationsTool)

**YAML:** `recount` is a separate named action called after `markExtracted` and
`removeRegion`.

**XState v5:** DIVERGENCES.md #9 pattern. `counts` is recomputed inline within
the `assign` callback of `markExtracted` and `removeRegion` by reducing over
`context.items`. No separate `recount` action entry is needed.

**Impact:** One fewer action entry per mutation. The `always` guard
(`allExtracted`) fires immediately after the assign, so `counts` is fresh before
the guard evaluates.

---

### F5.4-8 — Mock FOLIOS_DONE trigger (pageOrderTool surface)

**RESOLVED at I1.** The `_mockLeaves`/`_mockRuns` convention and the
`setTimeout(0)` mock seam have been removed. `PageOrderTool` now uses
`buildRealPageOrderToolServices()`. The machine stays in `readingFolios` until
the SSE actor delivers `FOLIOS_DONE` from the real backend.

---

### F5.4-emitOrderChanged — `emitOrderChanged` is a no-op stub at F5 (pageOrderTool)

**YAML:** The `DROP` action list includes `emitOrderChanged` — a side-effect
call that notifies `pipelineShell` that the page order has changed, causing it
to fan-out `UPSTREAM_CHANGED` to all downstream stage runners.

**XState v5 (F5):** At F5 there is no parent actor to notify. `emitOrderChanged`
is implemented as an explicit no-op action stub (matching the pattern of
`emitResolved`). It is listed in the `DROP` `actions` array so the YAML
coverage is complete and the I1 integrator has a named action to fill in.

**Resolution:** No-op stub:

```ts
emitOrderChanged: () => {
  /* At I1: send ORDER_CHANGED to the parent pipelineShell actor */
},
```

Added to the DROP event's `actions: ["moveLeaves", "moveLeavesSideEffect", "emitOrderChanged"]`.

**At I1:** Wire to `pipelineShell` fan-out. The fan-out itself lives in
`pipelineShell.ts` `fanOutStaleSideEffect` (see DIVERGENCES.md F4-4).

---

### F5.4-dropTarget — `_dropTarget` stored in context, not omitted (pageOrderTool)

**DIVERGENCES.md #8** establishes a convention: view-only fields (`_wipe`,
`_split`, `compare`) should be omitted from machine context and owned in local
React state.

**`_dropTarget` exception:** `_dropTarget: { scan: number; after: boolean } | null`
IS stored in machine context, contrary to what an earlier draft of the machine
docstring claimed. This is intentional. The `moveLeaves` assign action reads
`context._dropTarget` at `DROP` time to determine where to splice the dragged
leaves into the order. An `assign` action cannot access local React state —
`_dropTarget` must be in machine context to be visible to the action.

**Why the docstring was wrong:** A draft of the machine docstring (F5.4-4
inline comment) stated `_over` was "never read by a guard or service" and
therefore omitted. This was incorrect — `moveLeaves` reads it. The docstring
has been corrected.

**Rule:** The `_` prefix in the YAML does NOT automatically mean view-only.
Cross-check whether the field is read by any guard or action — if yes, keep
it in context (see also DIVERGENCES.md F5-3-4 `_weights` rule).

---

## Task F5.5 (text tools) divergences

### F5.5-D1 — wordcheckTool: parallel regions (suspects + listBuilder)

The spec yaml describes the wordcheck machine as a flat linear flow. The
implementation uses a XState v5 `type: "parallel"` machine with two independent
regions:

- `suspects` — the per-token scan → reviewing → settled flow with FIX/KEEP events.
- `listBuilder` — the candidate curation flow (ADD_TO_LIST / SKIP / DEFER /
  PROMOTE_TO_LIBRARY).

This matches the actual UI separation (suspects tab vs word-list tab) and
prevents the list builder from blocking the suspects flow or vice versa.

**I1 note:** `WordcheckToolServices.confirmStage` is called when the `suspects`
region settles — the `listBuilder` region may still be active. At I1, confirm
must wait for both regions to reach a stable state before calling the backend.

### F5.5-D2 — wordcheckTool: SCAN_DONE mock vs real SSE

The real wordcheck/scannocheck stage emits scan progress via SSE as:
`{ type: "SCAN_PROGRESS", done: N, suspects: M }` followed by a terminal
`{ type: "SCAN_DONE", ... }`.

At F5 the `WordcheckTool.tsx` surface simulates this on mount by sending
`SCAN_DONE` with a minimal mock fixture (3 suspects). The `scanning` state
accepts `SCAN_PROGRESS` and `SCAN_DONE` events per the machine contract —
F5 just short-circuits directly to `SCAN_DONE`.

**I1 note:** Replace the `SCAN_DONE` mount-stub with a real SSE subscription
to `GET /api/projects/:id/stages/scannocheck/scan-stream`.

### F5.5-D3 — hyphenJoin: hasNothingToDecide checks all 4 dimensions

The spec `allDecided` guard only checks undecided + flagged. The implementation
widens it to all 4 dimensions that can block settlement:

```ts
function hasNothingToDecide(
  cases: HyphenCase[],
  totals: HyphenTotals,
): boolean {
  return (
    totals.undecided === 0 &&
    totals.flagged === 0 &&
    totals.unvalidated === 0 &&
    totals.mismatch === 0
  );
}
```

`unvalidated` (joined-but-not-validated) and `mismatch` cases must both be
resolved before the stage can advance. This is a conservative extension — the
UI will not gate on items the user cannot clear.

### F5.5-D4 — hyphenJoin: nothingPendingAfter guard reads params not context

XState v5 fires guards **before** the matching action on the same transition.
In `regexPass.ts`, the `nothingPendingAfter` guard checks whether the stage
should auto-settle after a `RUN_RULE` response. The guard must read
`params.output.counts` (the fresh counts from the actor response) rather than
`context.counts` (still the pre-action stale value):

```ts
nothingPendingAfter: (
  _args,
  params: { output: { rule: RegexRule; counts: RegexCounts } },
) => params.output.counts.review + params.output.counts.pending === 0,
```

This pattern applies to any guard that needs a value an `assign` action would
have set on the same transition. Always use `params` (event output) in such guards.

### F5.5-D5 — textReviewTool: DISCUSSIONS-GATE invariant

Named invariant: `gateOpen` blocks `CONFIRM_ADVANCE` when:

```
ctx.totals.discuss > 0
  OR (ctx._settings.requireCommentsResolved AND any thread.status === "open")
```

The guard fires even when the queue appears empty. An item in `discuss` status
does **not** count toward the queue-clear `always` guard — so a queue with only
`discuss` items does not auto-settle. The UI shows a gate warning banner when
`!gateOpen` at the reviewing stage.

`requireCommentsResolved` is a machine-level display preference (convention
\#7 in this file) — toggled via `SET_REQUIRE_COMMENTS_RESOLVED` and stored in
`context._settings`. It is **not** sent to the server; it is a client-side
review discipline setting.

### F5.5-D6 — textReviewTool: queueClearAndGateOpen always guard fires immediately

The `reviewing` state has an `always` transition:

```yaml
always:
  - guard: queueClearAndGateOpen
    target: confirming
```

This fires immediately on every entry into `reviewing`, including after
`APPROVE_ITEM`. Tests that approve the last item must NOT expect the machine to
stay in `reviewing` — it will auto-advance to `confirming` (or `settled` if
`confirmStage` resolves immediately).

Test pattern for REOPEN: approve items, reach `settled`, send `REOPEN`, then
verify the machine is in `settled` or `confirming` (not `reviewing`), because
the always guard fires before any test assertion.

### F5.5-D7 — regexPass: `requirePreviewToCommit` and `rerunOnTextChange` are read-only at F5

The `RegexPassInput` type accepts `requirePreviewToCommit` and
`rerunOnTextChange`. At F5, `RegexTool.tsx` hard-codes both to `false` (the
permissive defaults). The settings tab displays these as read-only fields.

**I1 note:** Wire these to the stage settings API so users can toggle them via
`putStageSettings` / `saveStageSettingsAsDefault`.

### F5.5-D8 — Mock server: scannocheck routes use shared wordcheck endpoint names

The mock server `MockServer` interface exposes `acceptDictionaryFixes`,
`acceptHighConfidence`, `promoteToLibrary`, `confirmWordcheck` under their
canonical names (matching the real route paths for the `scannocheck` stage).
The `wordcheck` stage in the registry is an alias — both stages share the same
backend route prefix `/api/projects/:id/stages/scannocheck/`.

**I1 note:** At I1, confirm whether `wordcheck` and `scannocheck` share a single
route namespace or have separate prefixes, and update the service adapters
accordingly.

### F5.5-D9 — TOOL_REGISTRY: `scannocheck` key removed (phantom stage_id)

The backend `V2_STAGE_DAG` exposes only `wordcheck` as a real stage_id.
`scannocheck` does NOT appear in the DAG and therefore is never passed as
`stageId` to the tool slot. The `scannocheck: WordcheckTool` registry entry
was a phantom — adding it caused no runtime error but created a misleading
impression that `scannocheck` is a distinct pipeline stage.

**Resolution (F5.5 fix round):** The `scannocheck` key is removed from
`TOOL_REGISTRY`. `WordcheckTool` is registered only under `wordcheck`. The
D8 note above remains accurate about the shared backend route namespace:
the backend stage is canonically `scannocheck` in the route path, but the
stage_id the shell passes to the tool slot is `wordcheck`.

### F5.5-D10 — hyphenJoin: `VALIDATE_WORD_GROUP` has no canvas affordance (omitted at F5)

**Machine event:** `VALIDATE_WORD_GROUP { word: string }` — validates all
auto-joined instances of one word in bulk.

**Canvas check (hyphen.jsx):** The `HyphenPageWorkbench`, `HyphenQueueTab`,
`HyphenJoinedTab` components do not render a word-group-level "Validate all"
button. The closest canvas control is `VALIDATE_JOIN` per individual case
(the "Validate" button on each joined/crosspage row — wired in
`CaseActionButtons`).

**Resolution (F5.5 fix round):** `VALIDATE_WORD_GROUP` is not surfaced at F5.
The machine event is wired; the UI affordance is deferred to I1 where the
word-grouping panel (likely a word-frequency histogram overlay) will make the
interaction meaningful.

### F5.5-D11 — hyphenJoin: `ADD_WORD_RULE` not in main views (omitted at F5)

**Machine event:** `ADD_WORD_RULE { rule: string; join: boolean }` — appends a
word to the join-rule library.

**Canvas check (hyphen.jsx):** The queue/joined/mismatch tab views and the
page workbench do not show an "Add word rule" inline button. Rule management
is concentrated in the global library dialog (triggered by `OPEN_GLOBAL_LIBRARY`
— see `HyphenSubhead` "Edit global library" button, wired in F5.5 fix round).
The `ADD_WORD_RULE` event is intended for use inside that dialog.

**Resolution (F5.5 fix round):** `ADD_WORD_RULE` is not surfaced at F5 in
the main tool panel. The machine event is wired; the UI affordance lives inside
the global library dialog, which is the I1 workstream.

## Task F5.6 (pack tools) divergences

Pack group: `validationTool`, `proofPackTool`, `buildPackageTool`, `zipTool`,
`submitCheckTool`, `archiveTool`.

### F5.6-1 — `blockerCount` helper (advisory/block/custom)

**YAML:** Gate transitions use a raw `blockerCount > 0` guard without parameterisation.

**XState v5:** The `validationTool` exports a standalone `blockerCount(counts, strictness)`
helper. `advisory` = errors only; `block` = errors + warnings; `custom` = advisory at F5.
The `always` guard in `blocked` calls `blockerCount(ctx.counts, ctx.strictness) === 0`.

**Rationale:** Strictness mode is a user-configurable setting that should not be
hardcoded into individual guards. The helper also makes the unit tests (Suite C in
`packTools.test.ts`) self-contained.

**I1 migration:** No change needed — the helper is a pure function and the guard is
already correct for all three modes.

---

### F5.6-2 — `always` guard for noBlockersRemain (instead of raised ALL_CLEAR)

**YAML:** When a waiver reduces the blocker count to zero, an `ALL_CLEAR` event
is raised internally (self-dispatch).

**XState v5:** Self-dispatch of internal events is error-prone in v5 and causes
ordering hazards (see DIVERGENCES.md #5). Instead, the `blocked` state has an
`always` transition guarded by `noBlockersRemain` that fires automatically after
any context mutation.

**Impact:** `CONFIRM_WAIVE` → `applyWaiver` (reduces counts) → XState re-evaluates
`always` guards → if zero blockers, transitions to `passed` without an explicit event.
This is more deterministic than event-based self-dispatch.

---

### F5.6-3 — `zipTool` is event-driven (no fromPromise)

**YAML:** The zip actor models compression as a streaming operation that emits
`ZIP_PROGRESS` ticks and terminates with `ZIP_DONE` or `ZIP_FAILED`.

**XState v5:** `zipTool` has no `fromPromise` actor. The machine starts in
`compressing` and receives server-pushed events (`ZIP_PROGRESS`, `ZIP_DONE`,
`ZIP_FAILED`) directly. The `requestRebuild` action fires on entry to `compressing`
(and on `UPSTREAM_CHANGED` from `built`) and triggers the server to begin streaming.

**Impact:** At I1, the SSE channel for zip progress integrates unchanged — the
machine already handles the exact event shapes the real server will push. The
surface component's `useEffect` simulation has been removed (see F5.6-12).

---

### F5.6-4 — `requestRebuild` fires on compressing entry AND UPSTREAM_CHANGED

**YAML:** `requestRebuild` is modeled as a single entry action on the `compressing`
state.

**XState v5:** In addition to the state entry action, `requestRebuild` also fires
on the `UPSTREAM_CHANGED` event from `built` (which auto-transitions back to
`compressing`). This ensures the server re-starts compression whenever the upstream
build changes without requiring an explicit user action.

---

### F5.6-5 — `submitCheckTool` SUBMIT → guarded branch (GateConfirmation)

**YAML:** `SUBMIT` transitions directly to `submitting`.

**XState v5:** `SUBMIT` dispatches to an array of guarded transitions:

- First guard: `{ guard: "confirmOnSubmit", target: "confirmingSubmit" }`
- Default (no guard): `{ target: "submitting" }`

XState v5 evaluates guards in order; the first matching guard wins. When
`ctx.confirmOnSubmit` is false, the machine skips `confirmingSubmit` entirely.

**Impact:** The `confirmingSubmit` state and `CONFIRM`/`CANCEL` events do not
exist in the YAML — they are an XState-idiomatic implementation of the
GateConfirmation pattern specified in the design handoff.

---

### F5.6-6 — `submitted` has `type: "final"`

**YAML:** `submitted` is the terminal state for `submitCheckTool` but is not
explicitly typed as final.

**XState v5:** `submitted` has `type: "final"`. This enables the parent machine
(`pipelineShell`) to detect completion via `onDone` at I1. The `submitted` state
also carries `submittedAt` in context for the UI to display the submission timestamp.

---

### F5.6-7 — `proofPackTool` and `buildPackageTool` share `TreeRow`

**YAML:** Both tools define their own tree-row type inline.

**XState v5:** `TreeRow` is exported from `proofPackTool.ts` and re-imported by
`buildPackageTool.ts`, `zipTool.ts`, and the surface components. This avoids a
duplicated interface that would drift.

**I1 migration:** When proper API types are generated (openapi-typescript), `TreeRow`
should be replaced with the canonical generated type and the re-export removed.

---

### F5.6-8 — `archiveTool` TOGGLE_KEEP fires two actions in sequence

**YAML:** `TOGGLE_KEEP` is a single `updateItem` mutation.

**XState v5:** `TOGGLE_KEEP` triggers an action array `["toggleItem", "persistItem"]`.
`toggleItem` is a pure `assign` that flips `item.keep`; `persistItem` is a side-effect
action that calls `ctx.services.persistItem` (fire-and-forget). This separates the
optimistic UI update from the persistence side-effect without introducing a child actor.

**I1 migration:** At I1, `persistItem` should be replaced with a spawned actor so
persistence errors can be surfaced to the user.

---

### F5.6-9 — `buildPackageTool` preflight gate via PREFLIGHT_PUSH

**YAML:** The build gate is modeled as a guard on the page entering `build_package`
stage, not as a machine-level event.

**XState v5:** `buildPackageToolMachine` tracks preflight status in `ctx.preflight`
(type `PreflightStatus = "passed" | "blocked" | "unknown"`). The `BUILD` event is
silently ignored when `ctx.preflight !== "passed"` (guard `preflightPassed`). The
`PREFLIGHT_PUSH` event updates `ctx.preflight` from outside the machine (fan-in from
`pipelineShell` at I1 or from `validationTool` via the orchestrator).

**Impact:** Surface components should not render the BUILD button as enabled when
preflight is unknown or blocked — the machine won't accept the event anyway, but
the UI should be consistent with the gate semantics.

---

### F5.6-10 — Mock-only services injected via `input` (no closure capture)

All six pack-group machines receive services via `input.services`. The surface
components each define a `makeMock*Services` factory that constructs deterministic
mock implementations. At I1, these factories are replaced with real service adapters.

No machine directly imports from `server.ts` or any network layer — the dependency
inversion is complete.

---

### F5.6-11 — `archiveTool` starts in `reviewing` (not a loading state)

**YAML:** `archiveTool` enters `reviewing` directly with a default item list.

**XState v5:** The machine is initialized with `initialItems` via `input`. There is
no async load in the `reviewing` state — the item list is injected at construction.
If items need to be loaded from the server, a loading state should be added at I1.

---

### F5.6-12 — `zipTool` surface auto-simulates via `useEffect` {#resolved-I1}

**RESOLVED at I1.** The `useEffect` block that fired `ZIP_PROGRESS` and
`ZIP_DONE` events with `setTimeout` delays has been removed from `ZipTool.tsx`.
The machine now receives real SSE events via the project subscription in
`PipelinePage` (F4-8 pattern). Machine tests in `packTools.test.ts` continue to
drive events directly and are unaffected by this removal.

---

### CT 2026-06-11 — `submitCheckTool` live upload removed; manual attestation only

**Original YAML:** The `submitCheckTool` YAML models a `submitting` state that
invokes a `liveSubmit` actor to POST the package to pgdp.net. The machine
completes when the upload acknowledges.

**Resolution (CT directive 2026-06-11):** PGDP has no public upload API.
Submission is always a manual step:

1. User downloads the zip via the "Download package" affordance.
2. User uploads the zip to their `dpscans` folder on pgdp.net.
3. User attests here ("Mark as submitted") — recording a `GateConfirmation`
   event (gate="submit_confirm") in the project aggregate.

**Changes:**

- `liveSubmit` actor and `submitting` invoke state removed.
- `SubmitCheckToolServices.liveSubmit(projectId, target)` replaced by
  `markAsSubmitted(projectId)`. No `target` parameter — there is no sandbox
  vs. production distinction for a manual upload.
- `SUBMIT` without `confirmOnSubmit` → transitions directly to `submitted` via
  `assignSubmittedNow` (synchronous assign, not async actor).
- `CONFIRM` from `confirmingSubmit` → same path.
- `submitted` context carries `submittedAt: string` (ISO timestamp of attestation).
- `IPackGroupServices.dryRunSubmitCheck` lost the `target` parameter.
- `IPackGroupServices.liveSubmit` replaced by `markAsSubmitted(projectId)`.

**F5.6-5 update:** The F5.6-5 entry above mentions the "default (no guard)
target: `submitting`" branch. That branch is now "default (no guard) target:
`submitted` with `assignSubmittedNow` action". F5.6-5 text predates this CT
directive; this entry supersedes the default-branch description.

**If DP exposes an upload API in future:** Add a `liveSubmit` actor back into
`submitting` state; gate it behind a new setting `useApiSubmit` (default off).
The manual attestation flow remains valid as a fallback.

---

## Task naming-wire — pageOrderTool service wiring divergences

### F5.4-services — `persistRuns`, `persistNaming`, `confirmStage` are no-ops (pageOrderTool)

**Intent (YAML):** `PageOrderToolServices` defines five service methods:

- `persistLeaf` — PATCH page metadata (role / page_type)
- `persistOrder` — PATCH page order
- `persistRuns` — PUT run configuration
- `persistNaming` — PUT naming scheme
- `confirmStage` — POST stage confirm

**Current wiring (naming-wire):** `persistLeaf` and `persistOrder` are fully wired
to the backend (`PATCH /api/data/projects/{id}/pages/{idx0}` and
`PATCH /api/data/projects/{id}/pages/reorder` respectively). The role→PageType
mapping is: text→normal, blank→blank, skip→skip, cover→cover, plate→plate_p.

`persistRuns`, `persistNaming`, and `confirmStage` are explicit no-ops. The
machine controls that depend on them (run editing, naming scheme apply, stage
confirm) operate locally in machine context but the persistence side-effect is
a no-op until the backend routes are landed.

**Pending routes (I1):**

- `PUT /api/projects/{id}/stages/page_order/runs` — persist run configuration
- `PUT /api/projects/{id}/stages/page_order/naming` — persist naming scheme
- `POST /api/projects/{id}/stages/page_order/confirm` — confirm stage and trigger downstream

**Impact:** The naming preview panel (ledger column) reads from the manifest
served by the backend via `GET /api/data/projects/{id}/project-stages/page_order/artifact`.
This is the real backend manifest (JSON naming artifact from `page_order_v2_cpu`).
Only the write-back for runs/naming/confirm is deferred — the read path is live.

**Controls that are NOT hidden:** Per workspace rules, controls must be either
visible + enabled + functional, or not rendered at all. These three services back
affordances (run editing, naming scheme apply button, confirm button) that are
rendered and clickable. They update machine context correctly — only the
persistence side-effect is a no-op. At I1, swap the no-op implementations for
real API calls. Do not hide the controls.

**Reference:** `frontend/src/services/tools/pageOrderTool.ts` — service factory.

---

## W5 wiring

Records of wiring and fixes applied in the W5 task (2026-06-11).
Append new items here; do not modify existing sections above.

### W5.3 — emitOrderChanged → pipelineShell fan-out

`emitOrderChanged` was a no-op in the machine. It is now wired to call
`context.services.onOrderChanged?.()`, and `ToolSlotProps` gains an optional
`shellSend` prop so `PageOrderTool` can forward a `STAGE_COMPLETED` event to
`pipelineShell` after every DROP reorder. `PipelinePage` passes `shellSend={send}`
to the active tool slot.

**Files changed:** `pageOrderTool.ts`, `PageOrderTool.tsx`, `toolSlot.tsx`,
`PipelinePage.tsx`, `services/tools/pageOrderTool.ts`.

### W5.4 — WordcheckTool mock-leak removal

`WordcheckTool` mounted a `setTimeout(..., 200)` that fired `SCAN_DONE` with
hardcoded `MOCK_SUSPECTS` in production. The timer was removed. Tests now
use a `_testScanDone` prop (fires the event synchronously on mount) so no fake
timers are needed and no mock data reaches the production code path.

**Files changed:** `WordcheckTool.tsx`, `WordcheckTool.test.tsx`.

### W5.5 — fetchFolios replaces FOLIO_PUSH/FOLIOS_DONE streaming

The `readingFolios` state accumulated `FOLIO_PUSH` events until a `FOLIOS_DONE`
arrived via SSE. That streaming pipeline was never wired to a backend emitter,
so the machine started and stalled.

**CT decision 2026-06-11:** drop the streaming design. Replace `readingFolios`
with a `loading` state that invokes `fetchFolios` (a `fromPromise` actor).
`fetchFolios` calls `GET /api/data/projects/{id}/pages?limit=500` and returns a
fully-hydrated `{ leaves, runs, totals }` payload in one HTTP round-trip.

`FOLIOS_DONE` is kept as a bypass event in `loading` so test helpers using the
old YAML-driven pattern still work without changes. A new `loadError` state
surfaces the fetch error with a retry button.

**Files changed:** `pageOrderTool.ts`, `pageOrderTool.test.ts`,
`services/tools/pageOrderTool.ts`, `PageOrderTool.tsx`.

### W5.6 — canonical types and stageDeps out of @/mocks/

`PageStageStatus`, `ProjectStageStatus`, `PageStageState`, `PipelineSnapshot`,
`ProjectAutomation`, `ImportJob` and related types were defined in
`@/mocks/types`. `STAGE_DEPS` and `computeDownstream` were defined in
`@/mocks/fixtures`. Five machines, `sseActor.ts`, and `PostImportPage` imported
from those mock-namespace paths.

**Fix:** move canonical definitions to `@/types/pipeline.ts` (types) and
`@/lib/stageDeps.ts` (STAGE_DEPS + computeDownstream). `@/mocks/types` and
`@/mocks/fixtures` re-export from the new homes so existing test imports keep
working. Consumers (`sseActor.ts`, `pipelineShell.ts`, `PostImportPage.tsx`)
updated to import from the canonical paths.

**Files changed:** `types/pipeline.ts` (new), `lib/stageDeps.ts` (new),
`mocks/types.ts`, `mocks/fixtures.ts`, `machines/lib/sseActor.ts`,
`machines/pipelineShell.ts`, `pages/projects/PostImportPage.tsx`.

### W5.7 — MANIFEST_PUSH refetch gap after confirm

After `CONFIRM_ADVANCE → confirming → settled`, the naming manifest was not
re-fetched. The component's `useEffect` that fetches the manifest and sends
`MANIFEST_PUSH` only fired when `isWorkspace` changed; `settled` was not
covered. Separately, the machine had no `MANIFEST_PUSH` handler in `settled`,
so any send arriving after confirm was silently dropped.

**Fix (machine):** add `MANIFEST_PUSH: { actions: ["assignPrefixes"] }` to the
`settled` state.

**Fix (component):** derive `shouldFetchManifest = isWorkspace || isSettled` and
use it as the `useEffect` guard and dependency. The effect now fires on both
workspace entry and settled entry.

**Files changed:** `pageOrderTool.ts`, `pageOrderTool.test.ts`,
`PageOrderTool.tsx`.
