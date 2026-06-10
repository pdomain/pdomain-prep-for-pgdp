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

## #5 — `settleIfClear` internal event → `always` guard in browsing (imageStageReview)

**YAML:** `settleIfClear` is an action that raises an internal `SETTLED` event
to trigger auto-transition to the `settled` state when all flags are cleared.

**XState v5:** Internal event raising (`raise`) can cause unexpected ordering
with other pending transitions. The cleaner approach is an `always` guard on
the `browsing` sub-state that checks `totals.flagged === 0 && running === 0`.

**Resolution:** `always` guard placed on `browsing` (not the parent `review`
state) to avoid firing when the machine enters `review.editing` directly from
`settled`. The `settleIfClear` action slot is kept as a no-op for YAML
mapping completeness.

**Important:** The `always` must be on `browsing`, not `review`. If placed on
`review`, it fires on every entry to `review` — including `review.editing`
via `OPEN_EDITOR` from `settled` — and immediately re-settles before any
editing can happen.

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

## Notes for F3–F5

1. Every `onDone` that was `event.data` in YAML → use `event.output` + params pattern.
2. `always` transitions that need event data → store in a `_pending*` context
   field during the triggering action, read in the guard.
3. Parallel state entry/exit tracking (for top-level guards) → use a
   `_flag: boolean` context field with entry/exit actions.
4. `settleIfClear`-style "conditional raise" → prefer `always` guards in the
   browsing/idle sub-state rather than `raise()`.
