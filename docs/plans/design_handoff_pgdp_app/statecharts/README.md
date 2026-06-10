# Component statecharts

Framework-neutral statechart specs for the PGDP-prep UI. One `.yaml` per
component machine. These are a **readable spec for the frontend**, not tied to
a specific library — but they map cleanly onto XState v5, Robot, or any
hierarchical state machine runtime (see [Porting](#porting) below).

Three surfaces are covered, end to end:

- **[Projects page](#projects-page)** — `final/projects/` (complete, incl. post-import).
- **[Project pipeline](#project-pipeline)** — `final/pipeline/` spine (complete). See
  [`pipeline-plan.md`](./pipeline-plan.md) for the architecture rationale.
- **[Per-stage tools](#stage-tools)** — every stage in `final/` now has a
  grounded machine (no stubs remain).

Authoring conventions live in [`../statechart-authoring-guide.md`](../statechart-authoring-guide.md).

<a name="projects-page"></a>
## Projects page

| File | Machine | Owns | Spawned by |
|------|---------|------|------------|
| [`project-detail.yaml`](./project-detail.yaml) | `projectDetail` | **Top-level page orchestration** — selection, detail tab strip, child lifecycle | _root_ |
| [`rail-list.yaml`](./rail-list.yaml) | `railList` | Left rail: Active/Archived filter, search, sort, row selection | `projectDetail` |
| [`recent-activity.yaml`](./recent-activity.yaml) | `recentActivity` | "Recent activity" tab: load/empty/error/loaded, polling, view-all | `projectDetail` |
| [`attributes-panel.yaml`](./attributes-panel.yaml) | `attributesPanel` | "Attributes" tab: per-section collapse + exclusive inline edit | `projectDetail` |
| [`manage-actions.yaml`](./manage-actions.yaml) | `manageActions` | "Manage" tab: clean / archive / save-copy / restore / **two-step delete** | `projectDetail` |
| [`project-lifecycle.yaml`](./project-lifecycle.yaml) | `projectLifecycle` | A project's status across the pipeline (badge tone + PipelineMini) | server-authoritative |
| [`post-import.yaml`](./post-import.yaml) | `postImport` | After "Start on a new project": import job (thumbnails→ingest→done), Pa auto-redirect vs Pb jobs-drawer placement, JobsPill/JobsDrawer | `projectDetail` |

### How they compose

```
projectDetail  (page)
├─ railList ───────────── SELECT ──────────┐  drives selection
├─ recentActivity  ⟵ re-keyed on selection │
├─ attributesPanel ⟵ re-keyed on selection │
├─ manageActions   ⟵ re-keyed on selection │
│       │                                   │
│       └── PROJECT_MUTATED ────────────────┘  archive/delete/restore → resync rail
└─ postImport  ── importing pseudo-row + JobsDrawer ── settles → PROJECT_MUTATED

projectLifecycle  (per project, server-authoritative)
        └── reflected by railList badges + projectDetail status + manageActions action set
```

- **Selection is the hinge.** When `railList` emits `SELECT`, `projectDetail`
  re-keys the three project-scoped children to the new `projectId`.
- **`postImport`** owns the gap between "Start" and "ready": a server-pushed
  import job plus *where the user is parked* (redirected into the new project,
  or anchored on their old selection with the JobsDrawer).
- **`projectLifecycle`** is the source of truth for status; `STATUS_PUSH` can
  move it to any state.

### Domain rules worth highlighting

- **Two-step delete.** `DELETE` on an *active* project only **archives** it
  (reversible). `DELETE` on an *archived* project is **permanent** and routes
  through the high-friction `confirmingDanger` gate. See `manage-actions.yaml`.
- **`archived` is reachable from every non-terminal status** and reversible via
  `RESTORE`; only `deleted` is truly terminal.
- **Attributes editing is exclusive**, collapse is independent (parallel regions).

### Status → badge tone

Mirrors `STATUS` in `projects.jsx`:

| status | tone | status | tone |
|--------|------|--------|------|
| queued | neutral | ready | clean |
| running | running | submitted | neutral |
| review | review | error | failed |
| | | archived | neutral |

---

<a name="project-pipeline"></a>
## Project pipeline (spine)

| File | Machine | Kind | Owns |
|------|---------|------|------|
| [`pipeline-shell.yaml`](./pipeline-shell.yaml) | `pipelineShell` | singleton | Spawns the stage runners; stage selection + tab strip; tool mounting; settings toggle; staleness fan-out |
| [`stage-runner.yaml`](./stage-runner.yaml) | `stageRunner` | **shared ×N stages** | One stage's run lifecycle: `notrun→queued→running→(clean\|flagged\|error)` + `stale`. The dots project this. |
| [`run-all-stale.yaml`](./run-all-stale.yaml) | `runAllStale` | coordinator | "Run all stale": orders + sequences the stale runners, aggregates progress |
| [`project-settings.yaml`](./project-settings.yaml) | `projectSettings` | spawned | Settings groups, autosave fields, automation toggles, guarded Danger zone |
| [`page-workbench.yaml`](./page-workbench.yaml) | `pageWorkbench` | **shared ×12 stages** | The "Page workbench" tab: page cursor, param draft + re-detect, compare view, Apply-&-Continue. Stage bodies (`WB_MAP`) are data. |

```
pipelineShell  (singleton, per open project)
├─ stageRunner ×N  ── runners.map(state) ──►  StageStrip dots + PipelineMini
│      (the dots are a PROJECTION, not machines)
├─ selection region ── currentStage + Prev/Next + dropdown
├─ tab region ── mounts the active stage's TOOL machine (table below)
│        └─ + pageWorkbench for the per-page deep-dive tab (12 stages)
├─ projectSettings  ⟵ OPEN_SETTINGS (replaces the stage body)
└─ runAllStale  ── reads `stale` runners ──► RUN each ──► aggregates
        ▲
        │ staleness: a runner completing a re-run makes DOWNSTREAM runners
        └── `stale` (auto-queued iff "re-run downstream on stale bump" is on)
```

- **No machine per dot**; pages are **data, not actors**; counts are aggregates.
- **Tools settle stages**: a tool clearing its last flag emits
  `PAGES_RESOLVED` / `RESOLVE`; the runner flips `flagged → clean`.
- **Server-authoritative**: optimistic `RUN`/`RETRY`/`RERUN` intents,
  `STAGE_PUSH` reconciles.

---

<a name="stage-tools"></a>
## Per-stage tools (complete)

Every stage tool traces to its `final/<stage>/` component. Three are **shared
machine definitions instantiated per stage** (the stageRunner pattern); the
rest are bespoke.

### Shared machines

| File | Machine | Instances |
|------|---------|-----------|
| [`tool-image-stage-review.yaml`](./tool-image-stage-review.yaml) | `imageStageReview` | **×7** — threshold · deskew · denoise · dewarp · post_transform_crop · post_ocr_crop · canvas_map. Flag-grid + bulk bar + exclusive inline editor (wipe compare, apply-to scope: this page / selected / same issue) + confirm gate. |
| [`page-workbench.yaml`](./page-workbench.yaml) | `pageWorkbench` | **×12** — per-page tune→re-detect→Apply-&-Continue loop; stage control schemas are `WB_MAP` data. |
| [`tool-pages-grid.yaml`](./tool-pages-grid.yaml) | `pagesGrid` | crop (and any plain thumbnail-grid stage). |
| [`tool-review-queue.yaml`](./tool-review-queue.yaml) | `reviewQueue` | generic cursor-style queue (alternative pattern; the shipped text_review uses `textReviewTool`). |

### Stage → machine map

| Stage | Machine | File |
|-------|---------|------|
| 01 Source | `sourceTool` | [`tool-source.yaml`](./tool-source.yaml) |
| 02 Grayscale | `grayscaleTool` | [`tool-grayscale.yaml`](./tool-grayscale.yaml) |
| 03 Crop | `pagesGrid` | [`tool-pages-grid.yaml`](./tool-pages-grid.yaml) |
| Threshold / Deskew / Denoise / Dewarp | `imageStageReview` ×4 | [`tool-image-stage-review.yaml`](./tool-image-stage-review.yaml) |
| Post-transform crop / Post-OCR crop | `imageStageReview` ×2 | 〃 |
| Page layout (text_zones) | `textZonesTool` | [`tool-text-zones.yaml`](./tool-text-zones.yaml) |
| OCR | `ocrTool` | [`tool-ocr.yaml`](./tool-ocr.yaml) |
| Page order (Order & numbering) | `pageOrderTool` | [`tool-page-order.yaml`](./tool-page-order.yaml) |
| Wordcheck (scannocheck) | `wordcheckTool` | [`tool-wordcheck.yaml`](./tool-wordcheck.yaml) |
| Canvas map | `imageStageReview` (+ extras) | [`tool-image-stage-review.yaml`](./tool-image-stage-review.yaml) |
| Hyphen join | `hyphenJoin` | [`tool-hyphen-join.yaml`](./tool-hyphen-join.yaml) |
| Text review | `textReviewTool` | [`tool-text-review.yaml`](./tool-text-review.yaml) |
| Illustrations | `illustrationsTool` | [`tool-illustrations.yaml`](./tool-illustrations.yaml) |
| Regex pass | `regexPass` | [`tool-regex.yaml`](./tool-regex.yaml) |
| Validation | `validationTool` | [`tool-validation.yaml`](./tool-validation.yaml) |
| Proof pack | `proofPackTool` | [`tool-proof-pack.yaml`](./tool-proof-pack.yaml) |
| Build package | `buildPackage` | [`tool-build-package.yaml`](./tool-build-package.yaml) |
| Zip | `zipTool` | [`tool-zip.yaml`](./tool-zip.yaml) |
| Submit check | `submitCheck` | [`tool-submit-check.yaml`](./tool-submit-check.yaml) |
| Archive (cold storage) | `archiveTool` | [`tool-archive.yaml`](./tool-archive.yaml) |

### Cross-cutting patterns the tools share

1. **The family lifecycle** — `running → review → settled` with a 3-state
   banner, per-page `running | clean | flagged | reviewed | failed` row enum,
   flag-filter toolbar, density S/M/L, bulk bar, exclusive inline editor.
   `imageStageReview` is the canonical write-up; bespoke tools note their
   deltas instead of repeating it.
2. **Settings inheritance tri-state** — every stage's Settings tab shows
   `default | modified | preset` with Save-as-default / Revert / Reset.
   Specified once in `tool-source.yaml` (settings region); implement once,
   parameterize by stageId.
3. **Confirm-and-advance gate** — compose/text stages gate on
   `flagged === reviewed` (text_review additionally on zero open discussions;
   page_order on a clean sequence; validation on zero blockers).
4. **Staleness** — any re-run or saved settings change emits
   `UPSTREAM_CHANGED` upward; `pipelineShell.fanOutStale` marks downstream
   runners. The "N downstream stages now stale" warnings are projections of
   stageIndex.
5. **Derived, never stored** — page labels (page_order), dot colors,
   confidence tones, counts, the Spreads tab: all pure projections.
6. **Cross-project writes** are rare and explicit: word-list library promotion
   (`wordcheckTool`), hyphen word rules (`hyphenJoin` → global library).
7. **Page-set mutation** happens in exactly one place: `textZonesTool`'s
   `APPLY_SPLIT` (one page → two). It fans out wider than normal staleness.

### Pipeline-wide gate chain (ship path)

```
validation.passed ──► buildPackage.BUILD (guard: preflightPassed)
        buildPackage.built ──► zipTool (deterministic archive + sha256)
                zipTool.built ──► submitCheck.dryRunning
                        submitCheck: ready ──SUBMIT──► confirming ──► submitted (final)
                                └──► archiveTool (cold storage; pipeline complete)
Any UPSTREAM_CHANGED along the chain invalidates everything after it.
```

---

<a name="conventions"></a>
## YAML conventions (`_CONVENTIONS`)

These specs use a small, consistent vocabulary:

| Key | Meaning |
|-----|---------|
| `machine` / `description` | machine id + prose summary |
| `context` | extended state (the data the machine carries); inline comments give the TS-ish shape |
| `initial` | initial child state of a compound node |
| `states` | child states |
| `type: parallel` | child regions are all active at once |
| `type: final` | terminal state |
| `on` | event → transition map. A list of transitions = guarded alternatives, evaluated top-to-bottom (first matching `guard` wins) |
| `target` | destination state. `.child` = relative; `#machine.path` = absolute by id |
| `guard` | named boolean predicate; defined under `guards:` |
| `actions` | named effects run on a transition; defined under `actions:` |
| `entry` / `exit` | actions run on entering / leaving a state |
| `invoke` | an async actor/service for that state, with `src` + `onDone` + `onError` |
| `after` | delayed transition (`200ms`, `10s`, …) — timers |
| `always` | eventless ("transient") transition taken immediately when guards pass |

Implementation hints live at the bottom of each file:
- `guards:` — pure predicates over `ctx` (context) + `event`.
- `actions:` — context writers; lines starting with `//` are **side effects**
  (network, navigation, actor spawn) rather than pure assignments.
- `services:` — async sources for `invoke`, annotated with the backing endpoint.

Event payloads are referenced as `event.<field>`; context as `ctx.<field>`.

<a name="porting"></a>
## Porting to XState v5

The mapping is mechanical:

- `machine`/`context`/`states`/`initial`/`on`/`entry`/`exit` → identical keys.
- `guard` → `guard` (string name resolved in `setup({ guards })`).
- `actions` → `actions` (names resolved in `setup({ actions })`).
- `invoke.src` → `invoke.src` (actor resolved in `setup({ actors })`);
  `onDone`/`onError` map directly.
- `after: { 200ms: … }` → `after: { 200: … }` (ms as a number).
- `always` → `always`.
- spawned children (`spawn(...)` in the action notes) → `spawnChild` / `invoke`
  with `systemId`, or `assign` + `spawn` from `xstate`.
- shared-×N machines (`stageRunner`, `imageStageReview`, `pageWorkbench`) →
  one `setup().createMachine()` definition, instantiated with
  `input: { stageId, … }` per stage.

The `guards:` / `actions:` / `services:` dictionaries at the bottom of each
file are the contents of your `setup({ guards, actions, actors })` call.
