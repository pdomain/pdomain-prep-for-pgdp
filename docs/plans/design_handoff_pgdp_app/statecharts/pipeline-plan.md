# Pipeline statecharts — breakdown plan

A plan for decomposing the **project pipeline** (`final/pipeline/pipeline-template.jsx`
+ the per-stage tools in `final/crop`, `final/hyphen_join`, …) into statecharts,
following the conventions in `../statechart-authoring-guide.md`.

This is a **plan, not the YAML** — it settles the architecture (and the
"shared machine for the dots" question) before we write files.

---

## 1. The core insight: what is the *unit* of state?

The pipeline UI has three visual layers, and only some of them are real machines:

| Layer | Example in code | Is it a machine? |
|-------|-----------------|------------------|
| The **23-stage progression** | `STAGE_DEFS`, `StageStrip` dots, `PipelineMini` | **No — a projection.** Derived from each stage's run state. |
| A **single stage's run** | `STAGE_STATE(idx,i)` → `clean`/`running`/`notrun` (+ `error`/`flagged`/`stale`) | **Yes — the atomic unit.** This is `stageRunner`, instantiated per stage. |
| The **shell + navigation** | `PipelineTemplate`, `StageStrip` selector, `TabsBand`, prev/next | **Yes — a singleton orchestrator.** |
| A **stage's tool** | crop bbox editor, hyphen queue, review queue | **Yes — one machine per distinct tool.** |

The mistake to avoid: treating each **dot** as a machine. A dot has no
independent behavior — its color (`done` / `current` / `clean` / `notrun` /
`error` / `running`) is a **pure function of the owning stage's run state**.

So the answer to *"will there be shared machines for the dots?"* is:

> **There is no per-dot machine.** The dots render a projection. But there
> **is** a single *shared machine definition* — `stageRunner` — that is
> **instantiated once per stage** (23 live actors). The strip of dots is just
> the array of those actors' current states. That parameterized,
> spawned-N-times machine is the real "shared machine," not the dot.

This is the central design decision; everything below follows from it.

---

## 2. The two-dimensional truth (stages × pages)

The pipeline is a grid, and the charts must respect both axes:

- **Stage axis (23):** source → grayscale → … → ocr → text_review → … →
  build_package → submit_check → archive. A stage runs, completes clean, or
  flags pages.
- **Page axis (N pages):** each page flows through the stages; the counts the
  UI shows — `387 pages`, `31 flagged`, `167 stale`, review queues — are
  **aggregates over pages within a stage**.

We do **not** want a live machine per page (hundreds of actors). Pages are
**data inside a stage's context** (`flaggedPages: PageRef[]`). The *review*
of a single page is a transient sub-flow inside the stage tool, not a
persistent actor.

---

## 3. Proposed machine inventory

### Singletons (one per open project)

| Machine | File | Owns |
|---------|------|------|
| `pipelineShell` | `pipeline-shell.yaml` | Top-level: which stage is selected, the tab strip, project-settings mode toggle, spawning the 23 `stageRunner`s, prev/next nav |
| `stageNav` | _folded into shell_ | Current-stage selection + prev/next + dropdown. Likely a region inside `pipelineShell` rather than its own file. |
| `runAllStale` | `run-all-stale.yaml` | The "Run all stale" command: confirm → enqueue all stale stages → drive them → report. Coordinates many `stageRunner`s. |
| `projectSettings` | `project-settings.yaml` | The `ProjectSettingsTemplate` left-rail groups (general/bib/pgdp/format/defaults/members/storage/danger) + per-group save flow + the automation toggles. |

### The shared, per-instance machine (spawned ×23)

| Machine | File | Instances | Owns |
|---------|------|-----------|------|
| `stageRunner` | `stage-runner.yaml` | one per `STAGE_DEFS` entry | A single stage's lifecycle: `notrun → queued → running → (clean \| flagged \| error)`, plus `stale` when an upstream stage re-runs. Holds `flaggedPages`, timing, artifact size. |

This is **the** answer to the dots question. `pipelineShell` spawns 23 of these
(or a `stageRunner` per stage lazily). `StageStrip` and `PipelineMini` render
`runners.map(r => r.state)`.

### Per-stage tool machines (one per distinct interaction)

Most stages share the generic Pages-grid tool; a few have bespoke tools. One
machine each, mounted by `pipelineShell` for the active stage's workbench tab:

| Machine | File | Backs | Owns |
|---------|------|-------|------|
| `pagesGrid` | `tool-pages-grid.yaml` | the default `Pages` tab (crop, grayscale, threshold…) | grid load, flag-filter, select page → inline editor, bbox/skew edit + save |
| `reviewQueue` | `tool-review-queue.yaml` | `text_review` queue, hyphen `Undecided` | a queue of flagged items: cursor, decision (accept/reject/edit), keyboard nav, submit-decision, advance |
| `hyphenJoin` | `tool-hyphen-join.yaml` | `hyphen_join` (queue / joined / mismatch sub-tabs) | the three review modes + per-case decision + global-library handoff |
| `buildPackage` | `tool-build-package.yaml` | `build_package` (manifest / pre-flight) | preflight checks run → pass/fail list → build artifact |

> **Decision needed:** how many bespoke tool machines do you actually want now?
> `pagesGrid` + `reviewQueue` cover most stages by generalizing. `hyphenJoin`
> and `buildPackage` are genuinely different. Crop's bbox editor could be a
> sub-flow of `pagesGrid` or its own `cropEditor` — see Open Questions.

### NOT machines (pure projections / static)

- Individual **dots** in `StageStrip` / `PipelineMini` (derived).
- **Badge tone**, stage colors (derived from status).
- `TabsBand`, `ProjectInfoBand` layout, `PipelineEmptySlot` (presentational).
- The `flagged` / `stale` **counts** (aggregates over `stageRunner` contexts).

---

## 4. Composition

```
pipelineShell  (singleton, per open project)
│
├─ stageRunner ×23  ───────────┐   spawned, one per STAGE_DEFS entry
│   (notrun│queued│running│     │
│    clean│flagged│error│stale) │   StageStrip + PipelineMini render
│                               │   runners.map(state)  ← the "dots"
│
├─ selection region            │   currentStage + prev/next + dropdown
├─ tab region                  │   Overview │ Pages │ Workbench │ Settings…
│      └─ mounts ONE tool for the active stage:
│             pagesGrid │ reviewQueue │ hyphenJoin │ buildPackage
│
├─ projectSettings  ⟵ toggled by "Project settings" (replaces stage UI)
│
└─ runAllStale  ── reads which runners are `stale` ──► drives them ──► reports
        ▲
        │ staleness propagation:
        └── when stageRunner[i] completes a re-run, mark all DOWNSTREAM
            runners `stale` (if "re-run downstream on stale bump" is on,
            auto-enqueue them instead).
```

Two cross-cutting flows worth calling out explicitly in the README later:

1. **Staleness propagation.** Editing/re-running stage *i* makes stages
   *i+1…22* `stale`. This is an event (`UPSTREAM_CHANGED`) that `pipelineShell`
   fans out to the downstream runners. The automation toggle "Re-run downstream
   on stale bump" decides whether `stale` auto-advances to `queued`.
2. **Run-all-stale.** `runAllStale` collects every `stale` runner, runs them in
   dependency order, and aggregates progress — a coordinator over the shared
   runners, not a duplicate of their logic.

---

## 5. `stageRunner` — sketch of the shared machine

The most important file. Rough state set (full version comes in the YAML):

```
notrun ──RUN──► queued ──START──► running ──┬─ DONE(clean)    ─► clean
   ▲                                         ├─ DONE(flagged>0)─► flagged
   │                                         └─ FAIL           ─► error
   │
clean / flagged / error ──UPSTREAM_CHANGED──► stale
stale ──RUN──► queued            (or auto-queued if automation on)
flagged ──RESOLVE(all)──► clean   (driven by the stage's tool machine)
error ──RETRY──► queued
```

- **context:** `stageId`, `index`, `group`, `flaggedPages: PageRef[]`,
  `staleReason`, `startedAt`, `durationMs`, `artifactBytes`, `progress`.
- **projection helper** (documented, lives in the view): `dotState(runner)` →
  `current` (if selected) else the run state → the exact color logic already in
  `StageStrip`/`PipelineMini`.
- **invoke:** `runStage` service while `running`, with progress ticks.
- **note:** `flagged → clean` is *driven by the tool* (e.g. `reviewQueue`
  emits `RESOLVE` as the queue empties) — the runner doesn't own per-page
  review, it owns the aggregate count.

---

## 6. Suggested build order

1. **`stage-runner.yaml`** — the shared unit. Everything references it; nail
   its state set + the staleness edge first.
2. **`pipeline-shell.yaml`** — spawn the 23 runners, selection + tab regions,
   settings toggle, the projection note for the dots.
3. **`run-all-stale.yaml`** — the coordinator (depends on runner semantics).
4. **`tool-pages-grid.yaml`** + **`tool-review-queue.yaml`** — the two
   generalizable tools that cover most stages.
5. **`tool-hyphen-join.yaml`** + **`tool-build-package.yaml`** — bespoke tools,
   only if in scope.
6. **`project-settings.yaml`** — settings groups + automation toggles (these
   toggles are the inputs to staleness/auto-run behavior).
7. **README** — composition diagram + the two cross-cutting flows + the
   "dots are a projection" note.

A natural **phase 1** is files 1–3 (the spine: runner + shell + run-all), which
already make the dots, prev/next, and staleness fully specified. Tools are
phase 2.

---

## 7. Open questions before writing YAML

1. **Scope of tool machines.** Do you want all four tool machines now, or just
   the spine (runner + shell + run-all) plus a single generic `pagesGrid`?
2. **Crop bbox editor** — its own `cropEditor` machine, or a sub-flow inside
   `pagesGrid`? (It has a real edit/drag/save lifecycle, so it may deserve one.)
3. **Staleness model** — is "stale" truly a *substate per stage* (my
   assumption), or a separate boolean flag orthogonal to run state? The strip
   shows `flagged` and `stale` as independent counts, which suggests a page can
   be stale within an otherwise-clean stage. Confirm whether stale is
   stage-level, page-level, or both.
4. **Page actors** — confirm you're happy with pages-as-data (not per-page
   machines). I strongly recommend data; flagging hundreds of actors is a smell.
5. **Server authority** — same as the projects lifecycle: do stages advance via
   a backend `STAGE_PUSH` we reconcile to, with the UI firing optimistic
   `RUN`/`RETRY` intents? I'll mirror that pattern unless told otherwise.
6. **Run ordering / dependencies** — does `runAllStale` run stages strictly in
   index order, or is there a real dependency graph (e.g. some stages
   parallelizable)? Affects whether the coordinator is a sequence or a DAG.

---

## 8. TL;DR

- **No machine per dot.** Dots are a projection of stage state.
- **`stageRunner` is the shared machine**, defined once and **spawned ×23** —
  that's where the "shared" lives.
- `pipelineShell` is the singleton that spawns them and owns selection + tabs.
- **Pages are data, not actors**; counts are aggregates over runners.
- Two cross-cutting flows — **staleness propagation** and **run-all-stale** —
  are coordinators over the shared runners, modeled explicitly.
- Build the spine first (runner → shell → run-all), tools second.
