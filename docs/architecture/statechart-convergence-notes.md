# Statechart Convergence — Implementation Notes

## Agent Index

- **Kind:** architecture
- **Status:** built
- **Last verified:** 2026-11-13
- **Read when:** changing canvas tools or the XState registry integration.
- **Search terms:** statechart, XState, canvas, tool registry, convergence.

**Lifecycle record:** [migration decisions](../context/decisions.md)
**Shipped:** 2026-06-11

This document preserves the June 2026 convergence history. The current service, persistence, and deferral
sections below supersede older claims in that history. Current execution authority is the pipeline architecture.

---

## What landed

### Backend

#### Registry v2 and `project_stages`

- `core/pipeline/stage_registry.py` re-cut to exactly 24 stages, each with a
  `scope` field (`page` | `project`), launcher group, upstream deps, and
  folded-micro-step list. Current authority: [pipeline architecture](03-pipeline.md)
  and `core/pipeline/stage_registry.py`.
- The design shipped with registry version 2. Current code uses registry version 3,
  which adds the page-numbering runs model and migration.
  (`projects.registry_version`). A v1-project access returns HTTP 409
  `{"error": "registry_version_mismatch", "project_version": 1, "server_version": 3}`.
- `core/pipeline/project_stages.py` — new dual-write store for the 8 project-scoped
  stages (source, page_order, validation, proof_pack, build_package, zip,
  submit_check, archive), mirroring the `page_stages` contract: every write is a
  transaction across on-disk artifact + DB row + eventsourcing event.
- `PrepProjectAggregate` — new eventsourcing aggregate in
  `core/pipeline/prep_aggregate.py`. New event vocabulary (10 types: StageRunStarted,
  StageRunCompleted, StageRunFailed, StageForcedStale, ReviewDecision, PageReorder,
  GateConfirmation, SettingsChange, WordlistPromotion, SplitFanout) lives here, not
  on `pdomain_ops.page_aggregate.ProjectAggregate`, to avoid stomping ops event names.

#### Stage groups (B2–B4)

- Image-prep group (8 page-scoped stages): grayscale, crop, threshold, deskew,
  denoise, dewarp, post_transform_crop, post_ocr_crop — re-keyed and folded from v1
  micro-stages. `denoise` and `dewarp` are new; dewarp wraps the pdomain-book-tools
  textline dewarp already shipped as of v0.17.x. Denoise is PGDP-local at this
  release (see open questions).
- OCR/Compose group (4 page-scoped + 1 project-scoped): text_zones (owns
  APPLY_SPLIT page-set mutation + SplitFanout event), ocr, canvas_map (absorbs
  morph_fill + rescale + blank_proof_synth alt path), illustrations, page_order.
- Text group (4 page-scoped): wordcheck, hyphen_join, text_review, regex
  (re-keyed from text_postprocess).
- Pack group (6 project-scoped): validation, proof_pack, build_package, zip,
  submit_check, archive.

#### Routes and SSE (B5)

- Project-level SSE channel: `GET /api/data/projects/{id}/events` emits
  `project-snapshot`, `project-stage-status`, `project-stage-progress`,
  `page-reorder`, `validation-updated` type strings. Separate from the
  per-page `stage-status` / `stage-progress` / `snapshot` channel.
- All 24 stage run routes keyed by v2 `stage_id`. Registry-version mismatch
  handler on all data routes.
- OpenAPI regenerated; `frontend/src/api/types.gen.ts` up to date.

#### Services layer

A new `services/` module beneath `core/pipeline/` provides typed service factories
that the frontend tool-surface machines consume (injected via `input.services`). Each
factory returns a real implementation backed by the fetch client; tests inject mocks.
This inverts the dependency so machines are never coupled to the network layer.

---

### Frontend

28 XState v5 machines shipped across 6 launcher groups:

| Group      | Machines                                                                                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source     | `sourceTool`                                                                                                                                                         |
| Image prep | `grayscaleTool`, `pagesGrid` (crop), `imageStageReview` (shared: threshold / deskew / denoise / dewarp / post_transform_crop / post_ocr_crop / canvas_map)           |
| OCR        | `textZonesTool`, `ocrTool`                                                                                                                                           |
| Compose    | `pageOrderTool`, `illustrationsTool`                                                                                                                                 |
| Text       | `wordcheckTool`, `hyphenJoin`, `textReviewTool`, `regexPass`                                                                                                         |
| Pack       | `validationTool`, `proofPackTool`, `buildPackageTool`, `zipTool`, `submitCheckTool`, `archiveTool`                                                                   |
| Shell      | `pipelineShellMachine`, `runAllStaleMachine`, `projectSettingsMachine`                                                                                               |
| Projects   | `projectDetailMachine`, `railListMachine`, `recentActivityMachine`, `attributesPanelMachine`, `manageActionsMachine`, `postImportMachine`, `projectLifecycleMachine` |

#### TOOL_REGISTRY

`frontend/src/pages/pipeline/toolSlot.tsx` maps every v2 `stage_id` to its React
surface component. All 24 stages registered; the registry is the single join point
between the pipeline shell and the per-stage tool surfaces.

#### Shared machine infrastructure

- `frontend/src/machines/lib/sseActor.ts` — wraps SSE subscriptions as an XState
  actor emitting `STATUS_PUSH`, `STAGE_PUSH`, `PROGRESS_PUSH`.
- `frontend/src/machines/lib/query.ts` — `bindQueryClient<TServices>` type-safety
  shim; machines never cache server data.
- `frontend/src/machines/tools/stageSettings.ts` — settings region pattern
  (default / modified / preset; 9 actions); each tool inlines the typed copy
  (see DIVERGENCES #F5-1 for the ActionFunction phantom-type constraint).

#### SSE channels wired (I1)

`PipelinePage.tsx` subscribes to the project SSE channel and translates push events
into machine events dispatched to `pipelineShellMachine`. The mapping layer sits in
the component (F4-8 divergence). Legacy mock `setTimeout` seams removed.

#### Legacy surfaces removed (I1)

`PageWorkbenchPage`, `TextReviewPage`, `CropsGridPage`, `ProjectReviewQueuePage`,
`StageControlsPanel` — all removed. Routes cleaned up in `App.tsx`.

---

## Canvas and statechart divergences

The detailed per-divergence ledger stays beside the machines at
`frontend/src/machines/DIVERGENCES.md`; this architecture document preserves
the durable changed-direction summary for retrieval.
Summary by section:

### Core (stageRunner / imageStageReview / pageWorkbench) — #1–#10, reconcile-todo, compare-context-omission

| Key      | Topic                                                | Short summary                                                                                                 |
| -------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| #1 / #10 | Streaming services → promise + SSE                   | `fromPromise` + PROGRESS_PUSH split; pipelineShell translates SSE shape to PROGRESS event (not a 1:1 forward) |
| #2       | `always` guard reads `_pendingAutoRerun`             | `event.autoRerun` stored in context during triggering action; `always` reads context                          |
| #3       | `event.data` → `event.output`                        | XState v5 canonical naming; all onDone params use `params` pattern                                            |
| #4       | PAGE_PUSH guard reads post-merge rows                | Guard calls `upsertRow()` inline; YAML's pre-merge assumption misses multi-page                               |
| #5       | `settleIfClear` → `always` on browsing AND selecting | Internal `raise` anti-pattern replaced; guard in both sub-states to cover BULK_ACCEPT path                    |
| #6       | APPLY guard blocks parallel redetecting region       | `_redetecting` context flag; top-level APPLY guarded                                                          |
| #7       | SET_FILTER / SET_DENSITY → machine-level `on`        | Promoted for usability (available in all states)                                                              |
| #8       | `_wipe` / `_split` / `compare` omitted               | View-only fields → local React state                                                                          |
| #9       | `recountTotals` folded inline                        | Inlined into every `assign` that mutates rows                                                                 |

### F3 (Projects surfaces) — F3-1 through F3-7

Poll timer uses `after:` idiom; `isDirty` computed inline; 4-section collapse into a
`Set<>` context field; child actor spawning delegated to React component layer (F3-4,
F3-6); `size`/`reclaimable` stats deferred; Paste-URL / Import-archive entry points
omitted from empty-state (no backend support — workspace visible+enabled+effect rule).

### F4 (Pipeline shell) — F4-1 through F4-8

`projectSettings` and `runAllStale` actor spawning delegated to React; tab `initial:`
idiom (no `settleInitialTab` entry action); fan-out `UPSTREAM_CHANGED` via side-effect
action (XState `sendTo` is single-target); tool slot placeholder intentionally visible
at F4 (filled by F5); `hasNext` uses `STAGE_DEFS.length - 1` not literal `< 22`;
`queueDrained` strengthened to include `currentIndex === null` (prevents premature done
on last stage); project SSE subscription in component layer.

### F5.1 (source) — F5-1 through F5-5

Settings region phantom-type constraint; `canConfirm` reads `_thumbsDone` context
mirror; settings actors fully wired as `fromPromise`.

### F5.2 (image-prep) — F5-1 through F5-5

`APPLY_RUN` absolute state ID; `isLastPage` uses `_total` sentinel (I1: remove,
use server-provided total from pre-flight call); PREV_PAGE/NEXT_PAGE in-place
actions (no target needed); `saveError` targets `editing`; dewarp inline-editor
controls differ from design canvas (schema vocabulary kept at I1, canvas vocabulary
is I3 polish if load-bearing).

### F5.3 (OCR) — F5-3-1 through F5-3-I1

`runComplete` reads post-merge totals; `density`/`filter` local React state;
`textZonesTool` starts in `loading`, `ocrTool` starts in `recognising` (intentional
asymmetry); `_weights` kept in context (read by service, not view-only); ZoneStepSettings
/ OcrStepSettings use local state only at F5 (stageSettings wired at I1); SplitDraft
mock shape vs real API shape translation note for I1.

### F5.4 (Compose) — F5.4-1 through F5.4-dropTarget

Naming as workspace-level event (not 4th parallel region); inspector watches
`SELECT_LEAF` directly (internal raise fragile in parallel delivery);
`computeLabels` / `reconcile` as pure assign helpers; side-effect services paired
with assign actions; `needsALook` uses params pattern; `settleIfClear` → `always`
guard on `reviewing`; `recount` folded inline; `emitOrderChanged` no-op stub at
F5 (I1: wire to pipelineShell fan-out); `_dropTarget` kept in context (read by
`moveLeaves` action, not view-only).

### F5.5 (Text) — F5.5-D1 through F5.5-D11

`wordcheckTool` parallel regions (suspects + listBuilder); `SCAN_DONE` mount-stub
replaces SSE at F5; `hasNothingToDecide` widens to 4 dimensions; `nothingPendingAfter`
guard reads params not context; DISCUSSIONS-GATE invariant; `queueClearAndGateOpen`
always guard fires immediately on `reviewing` entry; `requirePreviewToCommit` and
`rerunOnTextChange` read-only at F5; mock server scannocheck routes share wordcheck
names; `scannocheck` key removed from TOOL_REGISTRY (phantom stage_id); D10 /
`VALIDATE_WORD_GROUP` omitted (no canvas affordance); D11 / `ADD_WORD_RULE` not
in main views (belongs in global library dialog, I1).

### F5.6 (Pack) — F5.6-1 through F5.6-12 + CT 2026-06-11

`blockerCount` helper (advisory/block/custom); `always` guard replaces raised
`ALL_CLEAR`; `zipTool` event-driven (no fromPromise, receives server-pushed events
directly); `requestRebuild` fires on entry AND UPSTREAM_CHANGED; `submitCheckTool`
SUBMIT → guarded branch (GateConfirmation); `submitted` has `type: "final"`;
`proofPackTool` / `buildPackageTool` share `TreeRow`; `archiveTool` TOGGLE_KEEP
fires two actions; `buildPackageTool` preflight gate via PREFLIGHT_PUSH; services
injected via `input` (no closure); `archiveTool` starts in `reviewing` with input
items; `zipTool` surface auto-simulates via `useEffect` (I1: replace with real SSE).
CT 2026-06-11: `submitCheckTool` `liveSubmit` actor and `submitting` state removed;
replaced by manual attestation flow — see "CT 2026-06-11" entry in DIVERGENCES.md.

---

## Conscious omissions and deferrals

The detailed F3/F4/F5 account above is the historical 2026-06-11 convergence record.
It is not a list of current blockers. Current source was checked on 2026-11-07.

### Current service contracts

- Split translation is implemented: `applySplit` converts gutter drafts to normalized boxes and posts
  `pages/{idx0}/split` with suffixes, boxes, stage, and coordinate mode.
- Layout saving uses `PUT pages/{idx0}/stages/text_zones/layout`.
- Page-order hydration loads pages and the numbering-runs artifact; `fetchFolios` replaces the old initial
  streaming design. `sequenceClean` already guards confirmation. A real detector remains W3.9.
- ZipTool now subscribes to project events and fetches its manifest.
- Shared image review uses real images and validated backend settings. Rerun persists page overrides;
  source badges and page/project saves share the tier resolver. See [image settings](09-image-prep-settings.md).
- Validation strictness controls remain placeholder UI; the helper does not establish a persisted backend
  strictness setting.

See [the issue index](../issues/README.md) for active work. Stage cancellation now has an owned backend
route and visible frontend failure handling; [events and jobs](05-events-and-jobs.md) records its cooperative limits.

### Current persistence and registry

The stage vocabulary remains v2 with 24 entries, while the registry schema is version 3.
Version-2 projects migrate their numbering runs; unsupported versions use the current mismatch response.
Project-stage rows use `project_stages.db`. Project jobs write artifacts, then rows, then best-effort workflow
events. The older blanket atomic transaction claim does not describe that path.

The original workflow event list has grown with creation, page, and numbering events.
The Pack group has six project-scoped stages; Source and page_order bring the project total to eight.
Frontend service factories live under `frontend/src/services/`, not `core/pipeline/services/`.

### Verification limits

The prior API/browser observations remain dated convergence history.
This audit inspects current source; it does not claim a fresh full browser walkthrough or accessibility audit.
Browser smoke and fixture-backed text approval shipped in `59470c4` and `532777a`.
Dewarp exposes no adjustable settings, matching its backend. These current-contract corrections were checked
against source and the tests linked from [testing](07-testing.md) on 2026-11-13.

## Open questions for CT

The earlier release gate is resolved in this checkout: `pyproject.toml` now requires book-tools `>=0.28.0`.
Denoise/dewarp no longer depend on an unpublished 0.18 release. This does not verify every external deployment.

The former jsxDEV shim is removed: `frontend/src/shims/` is absent and Vite has no shim alias.
Source absence establishes removal, not the precise upstream cause.

Submission remains a manual attestation flow in the implementation. The tool has no live upload actor.
Naming is enforced by the validation stage and build's pre-ZIP checks; see `core/pipeline/pgdp_naming.py`,
`tests/test_pgdp_naming.py`, and [numbering architecture](08-page-numbering.md).
This repository audit did not recheck external PGDP policies.

## Evidence

Verified 2026-11-07 against `core/pipeline/stage_dag.py`, `prep_aggregate.py`, `core/job_runner.py`,
the text-zones/page-order/zip frontend service modules, their tool components, and `frontend/vite.config.ts`.
Python paths are under `src/pdomain_prep_for_pgdp/`; the earlier implementation notes remain historical.
