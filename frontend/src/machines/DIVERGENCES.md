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

## reconcile-todo (stageRunner — I1 placeholder)

**Current state (F2):** The `reconcile` action in `stageRunner` is a no-op.
`STAGE_PUSH` tests assert only that the action does not throw, not that it
drives state transitions.

**Required at I1:** Implement `reconcile` to compare the `STAGE_PUSH` server
payload against the machine's current state. When the server's status diverges
from optimistic local state (e.g. server says "clean" but machine is still
"running"), the machine must navigate to the authoritative state.
**Push must win.**

**Test to add at I1:** `"STAGE_PUSH(status=clean) while machine is running →
transitions to clean"` — the conflicting-push case that proves server authority.

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
