# Statechart Convergence — Implementation Notes

**Plan:** `docs/plans/2026-06-10-statechart-convergence.md`
**Spec:** `docs/specs/2026-06-10-statechart-convergence-design.md`
**Shipped:** 2026-06-11

This document records what landed, every known canvas/statechart divergence,
conscious omissions, and open questions for CT. It is the live companion to the
plan; the plan's checkbox trail is the commit-by-commit record.

---

## What landed

### Backend

#### Registry v2 and `project_stages`

- `core/pipeline/stage_registry.py` re-cut to exactly 24 stages, each with a
  `scope` field (`page` | `project`), launcher group, upstream deps, and
  folded-micro-step list. Authoritative table: `docs/specs/stage-registry-v2.md`.
- `REGISTRY_VERSION = 2` constant stamped on every new project row
  (`projects.registry_version`). A v1-project access returns HTTP 409
  `{"error": "registry_version_mismatch", "project_version": 1, "server_version": 2}`.
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
- Pack group (7 project-scoped): validation, proof_pack, build_package, zip,
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

The detailed per-divergence ledger is `frontend/src/machines/DIVERGENCES.md`.
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

The following items were explicitly deferred, not accidentally skipped.

### I1-scoped DRIFT stubs in `frontend/src/services/`

Several service factory methods contain `// DRIFT` or `// TODO(I2)` comments
marking known gaps between the mock and real API shapes. See each
`services/<group>Services.ts` for the inline list. Major ones:

- `textZonesToolServices.applySplit`: needs SplitDraft → API bbox translation
  (F5-3-I1 in DIVERGENCES.md).
- `imageStageReview` services: `_total` sentinel removal + server-provided page total.
- `zipTool` surface: `useEffect` simulation → real SSE actor (F5.6-12).
- `ocrTool`: engine/backend controls wired but not sent to server at F5 (F5-3-6).

### Missing routes not yet created

- `POST /api/data/projects/{id}/stages/text_zones/{page_id}/apply_split` — needed
  for the APPLY_SPLIT flow in `textZonesTool`. Mock exists; backend stub present;
  real implementation pending.
- `GET /api/data/projects/{id}/stages/page_order/folios` — folios endpoint for
  `pageOrderTool`; mock delivers `FOLIOS_DONE` via SSE; real SSE route pending.
- `POST /api/data/projects/{id}/stages/wordcheck/persist_layout` — needed by
  `textZonesTool` SAVE_LAYOUT flow; pending.

### ValidationTool settings stub

`validationTool` machine has `strictness` context (advisory / block / custom).
The settings endpoint (`PUT /api/.../stages/validation/settings`) is stubbed;
the `blockerCount(counts, strictness)` helper is implemented and tested. The
settings write path completes at I1.

### Accessibility deferrals

ARIA roles, keyboard nav for drag-and-drop (pageOrderTool, pagesGrid), and
focus-management on modal dialogs are not addressed at this release. These are
tracked as a follow-up concern, not blocked work.

### E2e pipeline walk depth

`tests/e2e/` (I2) covers: app loads, project create, source import, stage execution
(via API-driven run — `POST .../run`), basic SSE push verification, SPA sub-path
routes. The "full pipeline walk" from the plan (resolve a flag → page order →
text review attest → validate → build → zip → submit-check → archive in-browser)
is exercised at the API layer, not via full UI click-through. The click-through
path requires the backend stage implementations (B2–B5) to be end-to-end wired
with real OCR, which goes beyond the convergence scope. The `make e2e AI=1` suite
is green on the API-exercised subset and is wired into local release preflight.

### Dewarp UX vocabulary (F5-5 divergence)

Design canvas uses simplified end-user vocabulary (warp-strength segmented +
anchor-mode toggle); implementation ships the schema-panel vocabulary (model
algorithm + numeric stiffness + gutter toggle). Canvas vocabulary is I3 polish
if CT decides it is load-bearing.

---

## Open questions for CT

1. **pdomain-book-tools release gate.** Both B2 wrappers call book-tools
   APIs: `dewarp` uses `GeometryPipeline`/`TextlineDisparityDewarp` and
   `denoise` calls `denoise_binary` (added upstream during this effort,
   commit 6cd97ea on book-tools **local main** — NOT yet in any published
   release; the pinned 0.17.1 wheel lacks both `denoise_binary` and the
   `geometry_correction` package). Until CT cuts a book-tools release
   `>=0.18` and bumps the pin (`make update-pdomain-deps`), this repo's
   backend only works with the editable install
   (`uv pip install --no-deps -e ../pdomain-book-tools` + `UV_NO_SYNC=1`,
   or `make local-dev`). **Action: push book-tools main, cut the release,
   bump the pin.**

2. **pdomain-ui jsxDEV external fix and shim retirement.** The convergence
   ships a `react/jsx-dev-runtime` shim in `frontend/src/shims/` (commit
   `8bfc957`) to work around a pdomain-ui dist-compat issue where the
   `@pdomain/pdomain-ui` package's bundled output references
   `react/jsx-dev-runtime` but the consuming Vite build does not re-export
   it. The shim is a workaround, not a fix. The real fix is in pdomain-ui
   (either externalise the reference or bundle it correctly). When should the
   shim be removed?

3. **PGDP portal naming verification for `build_package` output.** ~~RESOLVED 2026-06-11.~~
   Per the DP wiki (<https://www.pgdp.net/wiki/DP_Official_Documentation:CP_and_PM/Content_Providing_FAQ>),
   individual proofing files must follow these rules: basename ≤ 8 chars,
   characters `[A-Za-z0-9_-]` only, extension lowercase `.png`/`.txt`/`.jpg` only,
   no `ad` substring in basename, matched `png`↔`txt` pairs per page, lexicographic
   sort order = reading order. The `compute_prefix` output (form `f{N:03d}`,
   `p{N:03d}`, suffix `b`/`p`/`r` — max 5 chars, alphabet f/p/digits/b/p/r) is
   proven to satisfy all rules. Enforcement is two-tier:
   - `validation` stage (blocker code `pgdp_naming`): actionable error before build.
   - `build_package` pre-zip hard assert (`PgdpNamingError`): defence-in-depth.
     Implementation: `core/pipeline/pgdp_naming.py` (`validate_pgdp_filename`,
     `validate_package_naming`). Tests: `tests/test_pgdp_naming.py`.

4. **Live submit flow.** ~~RESOLVED 2026-06-11.~~
   PGDP has no public upload API. Submission is always a manual step:
   the user downloads the zip via "Download package", uploads it to their
   `dpscans` folder on pgdp.net, then confirms here. The confirmation records
   a `GateConfirmation` event (gate="submit_confirm") in the project aggregate,
   marking the `submit_check` stage clean. The machine's `submitted` terminal
   state records the attestation timestamp in `context.submittedAt`.
   The async `liveSubmit` actor and `submitting` invoke state are removed;
   `CONFIRM` transitions directly to `submitted` via a synchronous
   `assignSubmittedNow` action. If DP exposes an upload API in future, see
   DIVERGENCES.md "CT 2026-06-11" entry for how to add it back.
