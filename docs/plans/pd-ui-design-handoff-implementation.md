---
title: "pd-ui design handoff \u2014 implementation plan"
date: 2026-05-24
repo: ConcaveTrillion/pd-prep-for-pgdp
spec: docs/specs/2026-05-24-pd-ui-design-handoff-implementation.md
status: active
synced: 2026-05-24
milestone: 14
---

# pd-ui design handoff — implementation plan

**Source spec:** `docs/specs/2026-05-24-pd-ui-design-handoff-implementation.md`

**TL;DR:** Wire pd-ui design-system exports into pd-prep-for-pgdp stage by stage.
Each task targets one subagent session. Phases mirror the stage pipeline
(01=Source → 02=Grayscale → 03=Crop → …). Phase 0 lays the token/atom/shell
foundation everything else depends on.

**Coordination:** A separate Claude Code session is porting the
designs into `pd-ui` per its `PROMPT.md`. Every task below lists the
pd-ui exports it consumes. A task is blocked until its pd-ui exports
land on `main` of `pd-ui` (or are published to the `pd-index-npm` registry).

**Sizing:** Each task targets one subagent session (~200–400 LOC of
TS/TSX + a focused test file). Run `make ci AI=1` after every task.

**Conventions:**

- All paths relative to repo root (`pd-prep-for-pgdp/`).
- Slice IDs follow `Sxx-y`: `xx` is the stage (`01`=Source, `02`=
  Grayscale, ..., `15`=HyphenJoin, `19`=Validation, `PW`=Page
  Workbench cross-cutting, `SH`=Shell, `QF`=Quality flags, `S1`=upload).
- `pd-ui exports` = npm `@concavetrillion/pd-ui` paths.
- Plan synced to `ConcaveTrillion/pd-prep-for-pgdp` issues via
  `/decompose-spec --sync docs/plans/pd-ui-design-handoff-implementation.md`.

---

## Phase 0 · Foundation (no stage work yet)

## Task 1 — Token + Tailwind reconciliation against pd-ui  {#s0-a}

model: haiku  effort: S  area: tokens

Context: The frontend currently has its own `tokens.css` and Tailwind semantic
utilities (`frontend/src/styles/tokens.css`, `frontend/tailwind.config.ts`,
`frontend/src/index.css`) that may diverge from pd-ui's canonical names.

Approach: Replace `frontend/src/styles/tokens.css` with imports from
`@concavetrillion/pd-ui/tokens.css` and align Tailwind `theme.extend`
semantic utilities (`bg-surface`, `text-ink-2`, etc.) with pd-ui's
canonical names.

Blocked-by: (none internal)

External blockers: pd-ui Pass 2 (atoms + tokens) must land on pd-ui `main` first.

Verification: `make ci AI=1`

Acceptance:

- [ ] `frontend/src/styles/tokens.css` re-exports from `@concavetrillion/pd-ui/tokens.css` with no local overrides
- [ ] Tailwind `theme.extend` semantic utilities match pd-ui canonical names (`bg-surface`, `text-ink-2`, etc.)
- [ ] `ProjectListPage`, `JobsPage`, `PageWorkbenchPage` render unchanged (visual regression)
- [ ] `make ci AI=1` passes green

---

## Task 2 — Adopt pd-ui atom primitives  {#s0-b}

model: haiku  effort: S  area: atoms

Context: Several UI primitives (`Button`, `Badge`, `KeyCap`, `Divider`,
`StepDots`, `Input`) exist as local implementations in
`frontend/src/components/ui/*`; after Task 1 lands the token layer, these can
be replaced with pd-ui imports.

Approach: Replace ad-hoc `Button`, `Badge`, `KeyCap`, `Divider`,
`StepDots`, `Input` usages with pd-ui imports and remove local
re-implementations.

Blocked-by: #s0-a

External blockers: pd-ui Pass 2 (atoms + tokens) must export these primitives.

Verification: `make ci AI=1`

Acceptance:

- [ ] `pnpm test` green with no local Button/Badge/KeyCap/Divider/StepDots/Input definitions remaining
- [ ] All existing pages visually unchanged (regression check)
- [ ] No remaining local re-implementations in `frontend/src/components/ui/*` for covered atoms
- [ ] `make ci AI=1` passes green

---

## Task 3 — App shell (header + breadcrumb + jobs drawer)  {#s0-c}

model: sonnet  effort: M  area: shell

Context: `frontend/src/App.tsx` currently defines the root layout and shell
components; `useJobs.ts` polls `/api/jobs`. After atoms land (Task 2), the
shell can be replaced with pd-ui's `AppTemplate`/`AppHeader`/`Breadcrumb`/
`JobsPill`/`JobsDrawer` composition.

Approach: Wire `AppTemplate` + `AppHeader` + `Breadcrumb` + `JobsPill`
+ `JobsDrawer` as the root layout, replace existing `App.tsx` shell, and
re-fit `useJobs.ts` to feed `JobsPill`/`JobsDrawer` shape while preserving
existing job-poll integration.

Blocked-by: #s0-b

External blockers: pd-ui Pass 3 (templates) must export `AppTemplate`, `AppHeader`,
`Breadcrumb`, `JobsPill`, `JobsDrawer`, `JobRow`.

Verification: `make ci AI=1`

Acceptance:

- [ ] Every route renders inside the new shell with header and breadcrumb
- [ ] `JobsPill` reflects live job count from `/api/jobs` poll
- [ ] Existing e2e tests for header/jobs still pass
- [ ] `make ci AI=1` passes green

---

## Phase 1 · Stage 01 · Source

## Task 4 — Files tab — ThumbCard grid + FileToolbar + SourceBanner  {#s01-a}

model: sonnet  effort: M  area: source

Context: There is no `/projects/:id/source` route yet; the existing
`/api/projects/{id}/pages` endpoint provides page data that the new page will consume.

Approach: Create a new `/projects/:id/source` route rendering `SourceBanner`
(generating + selection states), `FileToolbar` (filter + density + "Insert page"),
and a `ThumbCard` grid backed by the existing pages endpoint.

Blocked-by: #s0-c

External blockers: pd-ui `Source/*` exports (`SourceBanner`, `FileToolbar`, `ThumbCard`, `FakeThumb`)
must be available.

Verification: `make ci AI=1`

Acceptance:

- [ ] Filter chips work and correctly filter the ThumbCard grid
- [ ] Density toggle works (at least two density levels)
- [ ] Page roles display correctly on each ThumbCard
- [ ] e2e covers filter/density/select interactions

---

## Task 5 — Multi-select + BulkBar  {#s01-b}

model: sonnet  effort: M  area: source

Context: `SourceStagePage` from Task 4 renders a static grid; selection state
and bulk actions are not yet implemented. A new Zustand store is needed for
selection management.

Approach: Add shift+click range select, `esc` clears, and wire `BulkBar`
actions to post to existing role-update endpoint.

Blocked-by: #s01-a

Verification: `make ci AI=1`

Acceptance:

- [ ] Shift+click selects a contiguous range of pages
- [ ] `Esc` clears the current selection
- [ ] `BulkBar` "Mark as page" posts to role-update endpoint correctly
- [ ] e2e covers range-select + bulk "Mark as page"

---

## Task 6 — Insert dialog + role taxonomy backend  {#s01-c}

model: sonnet  effort: M  area: source

Context: The `insert` role does not exist in the backend role enum; there is
no endpoint to insert a missing page. Task 4's FileToolbar shows the "Insert
page" button but it has no backend to call.

Approach: Build `InsertDialog` modal + new backend route
`POST /api/projects/{id}/pages/insert` + extend role enum to include `insert`.

Blocked-by: #s01-a

Verification: `make ci AI=1`

Acceptance:

- [ ] Backend unit tests cover insert position semantics (before/after)
- [ ] Role enum includes `insert` value in backend models
- [ ] `POST /api/projects/{id}/pages/insert` endpoint returns correct response
- [ ] e2e covers inserting a missing page before p005

---

## Task 7 — Per-page workbench + step settings  {#s01-d}

model: sonnet  effort: M  area: source

Context: There are no per-page workbench or step-settings routes for the source
stage yet; Task 4 established the stage list view.

Approach: Render `SourcePageWorkbench` under `/projects/:id/source/:prefix` and
`SourceStepSettings` under `/projects/:id/source/settings`.

Blocked-by: #s01-a

External blockers: pd-ui `Source/Workbench` and `SourceStepSettings` exports must be available.

Verification: `make ci AI=1`

Acceptance:

- [ ] `/projects/:id/source/:prefix` renders `SourcePageWorkbench` for the correct page
- [ ] `/projects/:id/source/settings` renders `SourceStepSettings`
- [ ] e2e covers per-page role change
- [ ] e2e covers concurrent-workers slider persisting after page reload

---

## Phase 2 · Stage 02 · Grayscale

## Task 8 — Overview + Pages tabs  {#s02-a}

model: sonnet  effort: M  area: grayscale

Context: There is no `/projects/:id/grayscale` route; the backend lacks an
auto-detect endpoint that the Overview tab requires.

Approach: Create `/projects/:id/grayscale` route with Overview (stat tiles +
`AutoDetectBanner`) and Pages (GrayThumb grid + filter segment) tabs.

Blocked-by: #s0-c

External blockers: pd-ui `Grayscale/*` exports (`GrayscaleOverview`, `AutoDetectBanner`,
`GrayThumb`, `BackendChip`); backend gap — new
`/api/projects/{id}/grayscale/auto-detect` endpoint must be tracked as a
separate issue before this slice starts.

Verification: `make ci AI=1`

Acceptance:

- [ ] `/projects/:id/grayscale` renders Overview and Pages tabs
- [ ] GPU/CPU chip reflects the current backend type
- [ ] Auto-detect rationale populates from the new endpoint
- [ ] `make ci AI=1` passes green

---

## Task 9 — Step Settings + WF11 variant F  {#s02-b}

model: sonnet  effort: M  area: grayscale

Context: Task 8 establishes the grayscale overview/pages view; the Step
Settings tab (Variant F: auto-detect + visual chooser + advanced accordion)
requires its own page and pd-ui Variant F export.

Approach: Build Step Settings tab using `StageControlsLeft` (Variant F:
auto-detect + visual chooser + advanced accordion).

Blocked-by: #s02-a

External blockers: pd-ui Variant F export (`StageControlsLeft`, `ModeCard`, `AdvancedParams`,
`CachedNote`) must be available.

Verification: `make ci AI=1`

Acceptance:

- [ ] Modify/revert sticky footer behaves correctly (dirty state tracking)
- [ ] CPU fallback warning shows when `backend=cpu`
- [ ] Advanced accordion expands and collapses
- [ ] `make ci AI=1` passes green

---

## Task 10 — Per-page PageViewer + split before/after  {#s02-c}

model: sonnet  effort: M  area: grayscale

Context: Task 9 establishes step settings; the per-page viewer at
`/projects/:id/grayscale/:prefix` is the final surface for this stage.

Approach: Build split-pane viewer under `/projects/:id/grayscale/:prefix`
using `pdUi/Grayscale/PageViewer`.

Blocked-by: #s02-b

Verification: `cd frontend && pnpm test:e2e grayscale.spec.ts`

Acceptance:

- [ ] Segmented toggle Before/Split/After changes the pane layout correctly
- [ ] "Re-run page" triggers re-processing for the current page
- [ ] Split pane shows original and grayscale versions side by side
- [ ] `make ci AI=1` passes green

---

## Phase 3 · Stage 03 · Crop

## Task 11 — CropsGridPage refit to CropCard + CropToolbar  {#s03-a}

model: sonnet  effort: M  area: crop

Context: An existing `CropsGridPage` exists but uses ad-hoc components; it
needs refitting to pd-ui's canonical crop components with the new flag taxonomy.

Approach: Migrate existing `CropsGridPage` to pd-ui's `CropCard`,
`CropToolbar`, `CropBanner` and adopt the canonical flag taxonomy.

Blocked-by: #s0-c

External blockers: pd-ui `Crop/*` exports (`CropCard`, `CropToolbar`, `CropBanner`)
must be available.

Verification: `make ci AI=1`

Acceptance:

- [ ] Existing e2e for CropsGridPage still passes
- [ ] Density toggle S/M/L works across all three sizes
- [ ] Canonical flag taxonomy renders correctly on CropCards
- [ ] `make ci AI=1` passes green

---

## Task 12 — BulkBar + bulk re-run backend  {#s03-b}

model: sonnet  effort: M  area: crop

Context: Task 11 establishes the crops grid; bulk re-run requires a new backend
endpoint `POST /api/projects/{id}/crops/rerun-flagged` which does not yet exist.

Approach: Wire `CropBulkBar` to new
`POST /api/projects/{id}/crops/rerun-flagged`.

Blocked-by: #s03-a

Verification: `make ci AI=1`

Acceptance:

- [ ] `POST /api/projects/{id}/crops/rerun-flagged` endpoint exists with unit tests
- [ ] Selecting 3 over-crop pages and triggering "Re-run" creates a job
- [ ] The re-run job appears in JobsDrawer
- [ ] e2e covers select 3 over-crop pages → "Re-run from initial_crop" → job in JobsDrawer

---

## Task 13 — BboxEditor inline  {#s03-c}

model: sonnet  effort: M  area: crop

Context: Task 11 established the crops grid; inline bbox adjustment with
before/after overlays and apply-to scope is a distinct interaction not yet present.

Approach: Add inline crop bbox adjustment with current/proposed overlays
+ apply-to scope using `pdUi/Crop/BboxEditor`.

Blocked-by: #s03-a

Verification: `make ci AI=1`

Acceptance:

- [ ] BboxEditor renders inline in the CropsGridPage with current and proposed overlays
- [ ] Apply-to scope selector works (this page / all flagged with same issue)
- [ ] e2e covers editing one page's bbox
- [ ] e2e covers apply-to-all-flagged-with-same-issue

---

## Task 14 — CropOverview + CropStepSettings  {#s03-d}

model: sonnet  effort: M  area: crop

Context: Task 11 established the crops grid tab; the Overview tab (stat tiles
+ flag distribution) and Step Settings tab are separate surfaces not yet built.

Approach: Build Overview tab (stat tiles + flag distribution + activity) +
Step Settings tab (strategy radio + sliders + toggles + stale-bump warning).

Blocked-by: #s03-a

Verification: `make ci AI=1`

Acceptance:

- [ ] CropOverview renders stat tiles and flag distribution
- [ ] Strategy switch in Step Settings marks the step as dirty
- [ ] Stale-bump warning fires when strategy changes
- [ ] `make ci AI=1` passes green

---

## Phase 4 · Stage 11 · Page order (NEW)

## Task 15 — Pages tab manual drag-reorder  {#s11-a}

model: sonnet  effort: M  area: page-order

Context: The `SourceStagePage` from Task 4 has no drag-reorder capability;
the UndoStrip and stage-dirty messaging are also absent.

Approach: Add drag-and-drop reorder inside the Source/Pages tab with UndoStrip
+ "build_package needs to re-run" messaging.

Blocked-by: #s01-a

External blockers: pd-ui `PageReorder/*` exports (`PagesToolbar`, `DropIndicator`,
`DragGhost`, `UndoStrip`, `RowActionsMenu`) must be available.

Verification: `make ci AI=1`

Acceptance:

- [ ] Single-row drag-reorder works and prefixes renumber atomically
- [ ] Multi-row range drag works
- [ ] Undo via UndoStrip restores previous order
- [ ] e2e covers single-row drag + multi-row range drag + undo

---

## Task 16 — Stage 11 page — ReorderScansStage  {#s11-b}

model: sonnet  effort: L  area: page-order

Context: The new `/projects/:id/page-order` route does not exist; the
auto-detect algorithm for out-of-order pages requires a new `pd-book-tools`
spec before the backend can be built.

Approach: Build `/projects/:id/page-order` route with auto-detect
banner + SwapRow list + per-swap accept/skip, and implement the backing
`src/pd_prep_for_pgdp/routers/page_order.py` router.

Blocked-by: #s11-a

External blockers: pd-book-tools spec for `pd_book_tools.page_order.detect_out_of_order_pages`
(Decision #1 in spec) must be filed as `pd-book-tools/docs/specs/<date>-page-order-detection.md`
before this slice starts. See sibling spec Open Question #1.

Verification: `make ci AI=1`

Acceptance:

- [ ] `/projects/:id/page-order` route renders with auto-detect banner and SwapRow list
- [ ] Accepting 2 high-confidence swaps renumbers prefixes atomically
- [ ] After-apply strip shows correct stage-dirty list post-accept
- [ ] e2e covers detect → accept 2 high-confidence swaps → prefixes renumber → after-apply strip

---

## Phase 5 · Stage 13 · Text review + scannos

Each WF-05B surface is one task (pipeline P · capture C1 · promote C2 · configure C3).

## Task 17 — Scannos pipeline stage (P)  {#s13-a}

model: sonnet  effort: M  area: scannos

Context: The scannos feature does not exist in the frontend or backend; it
requires a new `pd-book-tools` spec for the `pd_book_tools.scannos` module before
implementation can begin.

Approach: Build page-level scanno stats + "Re-scan all pages" + per-page
density bar using `pdUi/Scannos/PipelinePanel` and `pdUi/Scannos/PerPageDensityBar`.

Blocked-by: #s0-c

External blockers: pd-book-tools spec for `pd_book_tools.scannos` (Decision #3 in spec)
must be filed first. pd-ui `Scannos/*` exports must be available.

Verification: `make ci AI=1`

Acceptance:

- [ ] Page-level scanno stats render in the pipeline panel
- [ ] "Re-scan all pages" triggers re-processing job
- [ ] Per-page density bar reflects scanno density correctly
- [ ] `make ci AI=1` passes green

---

## Task 18 — Capture C1 — inline suspicion popover in PageWorkbench  {#s13-b}

model: sonnet  effort: M  area: scannos

Context: Task 17 builds the pipeline-level scannos view; the per-page inline
suspicion UX (underlined tokens + popover) requires both SPW-A (PageWorkbench
chrome) and the scannos backend from Task 17.

Approach: Add underlined suspicion tokens + inline accept/dismiss/promote
popover + right-pane suspicion list using `pdUi/Scannos/ScannoToken`,
`InlineMarkPopover`, `SuspicionList`.

Blocked-by: #s13-a, #spw-a

Verification: `make ci AI=1`

Acceptance:

- [ ] Suspicion tokens are underlined in the page text view
- [ ] Clicking a token opens the inline accept/dismiss/promote popover
- [ ] Right-pane suspicion list updates after accept/dismiss actions
- [ ] `make ci AI=1` passes green

---

## Task 19 — Promote C2 — per-book candidate triage  {#s13-c}

model: sonnet  effort: M  area: scannos

Context: Task 17 provides scanno detection; promoting candidates to the
per-book triage list requires a backend candidate store and a new UI surface.

Approach: Build per-book candidate triage using `pdUi/Scannos/CandidateDetail`
and `pdUi/Scannos/CandidateTable`.

Blocked-by: #s13-a

External blockers: Backend candidate store must be designed (track as separate backend issue).

Verification: `make ci AI=1`

Acceptance:

- [ ] CandidateTable renders the per-book candidate list
- [ ] CandidateDetail shows expanded context for a selected candidate
- [ ] Promoting a candidate from C1 (Task 18) appears in this view
- [ ] `make ci AI=1` passes green

---

## Task 20 — Configure C3 — global rule library  {#s13-d}

model: sonnet  effort: M  area: scannos

Context: Tasks 17–19 build the scanno capture and promote surfaces; the
global rule library is the final C3 configuration surface.

Approach: Build global rule library using `pdUi/Scannos/RuleDetail`,
`pdUi/atoms/ToggleBadge`, `pdUi/atoms/NavGroup`.

Blocked-by: #s13-a

Verification: `make ci AI=1`

Acceptance:

- [ ] RuleDetail renders the full rule definition and toggle state
- [ ] ToggleBadge enables/disables individual rules
- [ ] NavGroup provides navigation between rule categories
- [ ] `make ci AI=1` passes green

---

## Phase 6 · Stage 15 · Hyphen Join

Five surfaces ship as one task each: Overview, Undecided (V1+V2),
Queue (V3 keyboard-driven), Auto-joined (V5), Mismatch (V4), Step
Settings, Page Workbench (HJPageCaseRow / Before / After / Decision).

## Task 21 — Overview tab  {#s15-a}

model: sonnet  effort: M  area: hyphen-join

Context: The hyphen-join stage has no frontend or backend implementation;
Decision #2 in the spec establishes a JSON-first approach via a
`HyphenNgramsClient` interface, which must be designed before building begins.

Approach: Build the overview tab using `pdUi/HyphenJoin/HyphenOverview`
and `pdUi/HyphenJoin/PostBookNotesPreview`, wiring to the backend hyphen
list endpoint.

Blocked-by: #s0-c

External blockers: Backend hyphen list endpoint + ngram-fetch adapter (Decision #2 —
JSON-first via `HyphenNgramsClient` interface) must be designed first.

Verification: `make ci AI=1`

Acceptance:

- [ ] HyphenOverview renders overview stats and per-word breakdown
- [ ] PostBookNotesPreview shows current post-book notes
- [ ] Backend hyphen list endpoint wires correctly to the overview
- [ ] `make ci AI=1` passes green

---

## Task 22 — Undecided + Queue (V1+V2+V3)  {#s15-b}

model: sonnet  effort: M  area: hyphen-join

Context: Task 21 establishes the overview; V1/V2 (undecided list) and V3
(keyboard-driven queue) are the primary decision-making surfaces.

Approach: Build undecided and queue views using `pdUi/HyphenJoin/QueueSidebar`,
`QueueCase`, `HyphenCard`, `NgramsBlock`.

Blocked-by: #s15-a

Verification: `make ci AI=1`

Acceptance:

- [ ] QueueSidebar renders the list of undecided hyphen cases
- [ ] QueueCase shows ngrams and decision controls for each case
- [ ] Keyboard-driven navigation (V3) allows accepting/rejecting without mouse
- [ ] `make ci AI=1` passes green

---

## Task 23 — Auto-joined validation (V5)  {#s15-c}

model: sonnet  effort: M  area: hyphen-join

Context: Task 21 establishes the overview; V5 (auto-joined validation list)
lets the user audit cases that were automatically joined by rules.

Approach: Build auto-joined validation view using `pdUi/HyphenJoin/AutoJoinedList`,
`RuleChipInline`, `InstanceLine`.

Blocked-by: #s15-a

Verification: `make ci AI=1`

Acceptance:

- [ ] AutoJoinedList renders all auto-joined hyphen cases
- [ ] RuleChipInline shows which rule triggered the auto-join
- [ ] InstanceLine shows page context for each instance
- [ ] `make ci AI=1` passes green

---

## Task 24 — Mismatch report (V4)  {#s15-d}

model: sonnet  effort: M  area: hyphen-join

Context: Task 21 establishes the overview; V4 (mismatch report) surfaces
cases where the join decision conflicts between occurrences of the same word.

Approach: Build mismatch report using `pdUi/HyphenJoin/MismatchedReportV4`
and `MismatchRow`.

Blocked-by: #s15-a

Verification: `make ci AI=1`

Acceptance:

- [ ] MismatchedReportV4 renders all mismatch cases
- [ ] MismatchRow shows both conflicting decisions with page context
- [ ] User can manually resolve a mismatch from this view
- [ ] `make ci AI=1` passes green

---

## Task 25 — Step Settings (rule library + n-gram cache + thresholds)  {#s15-e}

model: sonnet  effort: M  area: hyphen-join

Context: Task 21 establishes the overview; the Step Settings surface
controls rule library, n-gram cache freshness, and decision thresholds.

Approach: Build Step Settings using `pdUi/HyphenJoin/HyphenStepSettings`.

Blocked-by: #s15-a

Verification: `make ci AI=1`

Acceptance:

- [ ] HyphenStepSettings renders rule library, cache, and threshold controls
- [ ] Changing thresholds marks the step dirty
- [ ] Cache freshness indicator shows when n-gram data was last fetched
- [ ] `make ci AI=1` passes green

---

## Task 26 — Page workbench (HJDecisionCard + Before/After split)  {#s15-f}

model: sonnet  effort: L  area: hyphen-join

Context: Tasks 21–25 build the hyphen-join list surfaces; the per-page
workbench view requires both the hyphen-join backend (Task 21) and the
PageWorkbench chrome (SPW-A).

Approach: Build per-page workbench using `pdUi/HyphenJoin/HyphenPageWorkbench`,
`HJDecisionCard`, `HJBeforeView`, `HJAfterView`.

Blocked-by: #s15-a, #spw-a

Verification: `make ci AI=1`

Acceptance:

- [ ] HyphenPageWorkbench renders with Before/After split pane
- [ ] HJDecisionCard shows the hyphen decision with accept/reject controls
- [ ] Decision made in workbench persists and updates the queue view
- [ ] `make ci AI=1` passes green

---

## Phase 7 · Stage 19 · Validation

## Task 27 — ValidationPanel in Pipeline tab  {#s19-a}

model: sonnet  effort: M  area: validation

Context: The validation panel is intended to render inside `ProjectConfigurePage`
Pipeline tab; that tab exists but currently has no validation surface. This
task depends only on the shell (S0-C) so it can ship early.

Approach: Render `SummaryHeader` + `PanelToolbar` + `CheckRow` rows
+ `DownloadFooter` inside `ProjectConfigurePage` Pipeline tab.

Blocked-by: #s0-c

Verification: `make ci AI=1`

Acceptance:

- [ ] ValidationPanel renders in the Pipeline tab with pass/warn/error states
- [ ] Download button is disabled when any check is in error state
- [ ] e2e covers pass / warn / error states
- [ ] `make ci AI=1` passes green

---

## Task 28 — Per-check auto-fix endpoints (safe-rename whitelist)  {#s19-b}

model: sonnet  effort: M  area: validation

Context: Task 27 renders the validation panel; Decision #4 in the spec
restricts auto-fix to a cosmetic-only whitelist (filename NFC-normalisation,
prefix renumbering, trailing-whitespace in metadata).

Approach: Ship `POST /api/projects/{id}/validate/{check}/fix` for the
cosmetic-only whitelist: filename NFC-normalisation, prefix renumbering
(non-contiguous), trailing-whitespace in metadata. Other checks render
`CheckRow` without the "Fix automatically" button.

Blocked-by: #s19-a

Verification: `make ci AI=1`

Acceptance:

- [ ] Unit tests cover each whitelisted fix (NFC-normalisation, prefix renumbering, trailing-whitespace)
- [ ] Non-whitelisted checks render `CheckRow` without "Fix automatically" button
- [ ] e2e covers running each whitelisted fix and confirming the check resolves
- [ ] `make ci AI=1` passes green

---

## Phase 8 · Quality flags (`wf03/`)

## Task 29 — QualityBanner + flag taxonomy  {#sqf-a}

model: sonnet  effort: M  area: quality-flags

Context: `ProjectConfigurePage` Pages tab has no quality flag awareness; a new
`/api/projects/{id}/pages/flag-counts` endpoint is needed to drive the banner.

Approach: Render `QualityBanner` at top of `ProjectConfigurePage` Pages tab
when flagged > threshold; adopt canonical flag taxonomy.

Blocked-by: #s0-c

External blockers: `/api/projects/{id}/pages/flag-counts` endpoint must be implemented
(track as separate backend issue if not already present).

Verification: `make ci AI=1`

Acceptance:

- [ ] QualityBanner renders when flag count exceeds threshold
- [ ] FlagChip renders correctly for each flag type in the canonical taxonomy
- [ ] Banner is hidden when no flags exceed threshold
- [ ] `make ci AI=1` passes green

---

## Task 30 — PageThumb + PageRow with flag pills  {#sqf-b}

model: sonnet  effort: M  area: quality-flags

Context: Task 29 establishes the quality banner; the Pages tab thumbnails need
to be replaced with pd-ui's `PageThumb`/`PageRow` components with flag pills,
thumb-size toggle, and list/thumb view toggle.

Approach: Replace existing Pages tab thumbnails with `PageThumb` / `PageRow`
from pd-ui; add thumb-size toggle (S/M/L) and list/thumb view toggle.

Blocked-by: #sqf-a

Verification: `make ci AI=1`

Acceptance:

- [ ] PageThumb renders with flag pills showing the canonical flag taxonomy
- [ ] Thumb-size toggle (S/M/L) resizes thumbnails correctly
- [ ] List/thumb view toggle switches between PageRow and PageThumb layouts
- [ ] `make ci AI=1` passes green

---

## Task 31 — StageJumpPopover (⌘P)  {#sqf-c}

model: sonnet  effort: S  area: quality-flags

Context: The keyboard layer exists but has no stage-jump shortcut; `⌘P`/`Ctrl+P`
should open a searchable dropdown that jumps to any stage. This is cross-cutting
but grouped with quality-flags because it uses `StageContextStrip`.

Approach: Wire searchable stage-jump dropdown using `pdUi/molecules/StageJumpPopover`
and `pdUi/molecules/StageContextStrip` into the existing keyboard layer.

Blocked-by: #s0-c

Verification: `make ci AI=1`

Acceptance:

- [ ] `⌘P`/`Ctrl+P` opens the stage-jump popover
- [ ] Typing filters the stage list
- [ ] Selecting a stage navigates to that stage route
- [ ] `make ci AI=1` passes green

---

## Phase 9 · Page Workbench cross-cutting (`wf-pw/`)

## Task 32 — PWHeader + EditModeSelector + PageAttributesBar  {#spw-a}

model: sonnet  effort: M  area: page-workbench

Context: The existing `PageWorkbenchPage` has its own chrome (header,
attribute display) that diverges from pd-ui's canonical layout; this is the
first PageWorkbench task and unblocks the inline scannos and hyphen workbench.

Approach: Refit existing `PageWorkbenchPage` chrome to pd-ui's header +
edit-mode segmented + attribute pills + popover editor.

Blocked-by: #s0-c

External blockers: pd-ui `PageWorkbench/*` exports (`PWHeader`, `EditModeSelector`,
`PageAttributesBar`, `AttrEditorPopover`) must be available.

Verification: `make ci AI=1`

Acceptance:

- [ ] PWHeader renders with correct page title and navigation controls
- [ ] EditModeSelector segmented control switches between edit modes
- [ ] PageAttributesBar renders attribute pills with popover editor on click
- [ ] `make ci AI=1` passes green

---

## Task 33 — ArtifactViewer + overlays  {#spw-b}

model: sonnet  effort: M  area: page-workbench

Context: Task 32 establishes the PageWorkbench chrome; the existing
`ArtifactViewer` component needs replacement with pd-ui's version, which
supports stage-specific overlays (`SplitOverlay`, `IllustOverlay`, `WordBboxOverlay`).

Approach: Replace existing `ArtifactViewer` component with pd-ui version; wire
`SplitOverlay`, `IllustOverlay`, `WordBboxOverlay` based on `EditMode`.

Blocked-by: #spw-a

Verification: `make ci AI=1`

Acceptance:

- [ ] pd-ui `ArtifactViewer` replaces local implementation
- [ ] `SplitOverlay` renders when EditMode is "split"
- [ ] `IllustOverlay` renders when EditMode is "illust"
- [ ] `WordBboxOverlay` renders when EditMode is "word-bbox"

---

## Task 34 — StageControlsPanel + per-stage sub-components  {#spw-c}

model: sonnet  effort: M  area: page-workbench

Context: Tasks 32–33 establish the workbench chrome and viewer; the left
drawer with stage-specific controls is the next layer. Each stage's controls
is a separate pd-ui export consumed through a stage map.

Approach: Build left drawer rendering the correct `StageControls` for the
current stage via a stage map over six per-stage control exports
(`ThresholdControls`, `CanvasMapControls`, `GrayscaleControls`,
`DeskewControls`, `InitialCropControls`, `OcrControls`).

Blocked-by: #spw-a

Verification: `make ci AI=1`

Acceptance:

- [ ] Left drawer renders the correct StageControls for each active stage
- [ ] All six per-stage control exports wire through the stage map
- [ ] Changing controls in the left drawer updates the viewer overlay
- [ ] `make ci AI=1` passes green

---

## Task 35 — Right drawer tabs — four panels  {#spw-d}

model: sonnet  effort: L  area: page-workbench

Context: Tasks 32–33 establish the workbench chrome and viewer; the tabbed
right drawer (372px or 760px depending on stage) hosting the four panels is
a substantial surface requiring both SPW-A and SPW-B.

Approach: Build tabbed right drawer hosting `PageAttributesPanel`,
`HierarchyTreePanel`, `BlockTypePickerPanel`, `OcrTextPanel` using
`pdUi/molecules/Drawer`.

Blocked-by: #spw-a, #spw-b

Verification: `make ci AI=1`

Acceptance:

- [ ] Right drawer renders at 372px (default) and 760px (wide stages) correctly
- [ ] All four tabs (PageAttributes, HierarchyTree, BlockTypePicker, OcrText) render
- [ ] Tab state persists across page navigation within the workbench
- [ ] `make ci AI=1` passes green

---

## Task 36 — TextReviewPane (collapsible bottom)  {#spw-e}

model: sonnet  effort: M  area: page-workbench

Context: Task 32 establishes workbench chrome; the collapsible bottom pane with
OCR text + likely-scannos sidebar integrates with the scannos highlighting from
Task 18 (S13-B).

Approach: Build 280px-open / 44px-collapsed bottom pane with OCR text +
likely-scannos sidebar using `pdUi/PageWorkbench/TextReviewPane`.

Blocked-by: #spw-a

Verification: `make ci AI=1`

Acceptance:

- [ ] TextReviewPane collapses to 44px and expands to 280px
- [ ] OCR text renders correctly in the open state
- [ ] Scanno highlights from S13-B integrate when that slice is landed
- [ ] `make ci AI=1` passes green

---

## Task 37 — LabelerCanvas (text_zones stage)  {#spw-f}

model: sonnet  effort: M  area: page-workbench

Context: Task 32 establishes workbench chrome; the SVG block-overlay canvas
for the `text_zones` stage is a distinct mode within the workbench.

Approach: Build SVG block-overlay canvas + layer toggles for `text_zones`
stage using `pdUi/PageWorkbench/LabelerCanvas` and `LayerToggle`.

Blocked-by: #spw-a

Verification: `make ci AI=1`

Acceptance:

- [ ] LabelerCanvas renders SVG overlays for text_zones stage
- [ ] Layer toggles show/hide individual block-type layers
- [ ] Canvas interactions (select, hover) work correctly
- [ ] `make ci AI=1` passes green

---

## Phase 10 · Projects landing (`final/projects/`)

## Task 38 — ProjectsPage shell refit  {#spr-a}

model: sonnet  effort: M  area: projects

Context: The existing `ProjectListPage` is a flat list; pd-ui's `ProjectsPage`
is a split-pane layout with sidebar + detail tabs that replaces it.

Approach: Refit existing `ProjectListPage` to pd-ui's split-pane
`ProjectsPage` (sidebar + detail tabs).

Blocked-by: #s0-c

External blockers: pd-ui `Projects/*` exports (`ProjectsPage`, `PipelineMini`,
`CoverPlaceholder`) must be available.

Verification: `make ci AI=1`

Acceptance:

- [ ] `ProjectListPage` is replaced by the split-pane `ProjectsPage` layout
- [ ] Selecting a project in the sidebar loads the detail tabs
- [ ] `PipelineMini` renders the pipeline status for the selected project
- [ ] `make ci AI=1` passes green

---

## Task 39 — Attributes panel (collapsible sections)  {#spr-b}

model: sonnet  effort: M  area: projects

Context: Task 38 establishes the split-pane projects shell; the attributes
panel (Bibliographic / PGDP project / Format & content / Project comments)
requires a backend field audit since the prototype shows fields not yet in
the API.

Approach: Render `AttributesPanel` with Bibliographic / PGDP project /
Format & content / Project comments collapsibles, wiring to existing
`/api/projects/{id}/metadata` endpoint and adding fields where the prototype
shows fields the backend lacks.

Blocked-by: #spr-a

External blockers: Backend field audit (small sub-spec) needed to identify which metadata
fields to add to the endpoint.

Verification: `make ci AI=1`

Acceptance:

- [ ] AttributesPanel renders all four collapsible sections
- [ ] All fields from the prototype are backed by API data
- [ ] Collapsibles expand and collapse correctly
- [ ] `make ci AI=1` passes green

---

## Task 40 — ProjectsEmpty (first-time hero)  {#spr-c}

model: sonnet  effort: S  area: projects

Context: Task 38 establishes the projects shell; when no projects exist, the
detail pane should show a first-time hero instead of empty state.

Approach: Wire `pdUi/Projects/ProjectsEmpty` as the empty state in the
projects page.

Blocked-by: #spr-a

Verification: `make ci AI=1`

Acceptance:

- [ ] `ProjectsEmpty` renders when the projects list is empty
- [ ] Hero CTA ("Create your first project") opens the upload modal
- [ ] `make ci AI=1` passes green

---

## Task 41 — Manage tab (archive / clean / save copy / delete)  {#spr-d}

model: sonnet  effort: M  area: projects

Context: Task 38 establishes the projects shell; the Manage tab requires
2-step confirmation for delete and may need new backend endpoints for
clean-artifacts and save-copy.

Approach: Wire manage actions with 2-step confirmation for delete; archive
uses existing endpoint; clean-artifacts and save-copy may need new endpoints
(small sub-spec).

Blocked-by: #spr-a

External blockers: Confirm with pd-ui session that `pdUi/Projects/ManageTab` export is
available and its interface is finalized.

Verification: `make ci AI=1`

Acceptance:

- [ ] Archive action uses existing endpoint and succeeds
- [ ] Delete action requires 2-step confirmation before proceeding
- [ ] Clean-artifacts and save-copy actions work (or stubs render with "coming soon" state)
- [ ] `make ci AI=1` passes green

---

## Phase 11 · Folder upload modal (`wf01/`)

## Task 42 — ModalC desktop variant  {#sup-a}

model: sonnet  effort: M  area: upload

Context: The existing create-project modal is ad-hoc; `ModalC` (right-side
sheet + 4-step left rail) replaces it while reusing the existing client-side
JSZip path.

Approach: Replace existing create-project modal with `ModalC`
(right-side sheet + 4-step left rail), reusing existing client-side JSZip path.

Blocked-by: #s0-c

External blockers: pd-ui `Upload/*` exports (`ModalC`, `ManifestTable`, `PhaseCard`,
`Thumb`) must be available.

Verification: `make ci AI=1`

Acceptance:

- [ ] `ModalC` opens as a right-side sheet with the 4-step left rail
- [ ] Each step (select/manifest/review/confirm) renders correctly
- [ ] Existing JSZip client-side path is reused without modification
- [ ] `make ci AI=1` passes green

---

## Task 43 — ModalB mobile fallback (<768px)  {#sup-b}

model: sonnet  effort: S  area: upload

Context: Task 42 ships the desktop upload modal; viewports narrower than 768px
need the simpler `ModalB` variant.

Approach: Wire `pdUi/Upload/ModalB` as the mobile fallback at viewports below 768px.

Blocked-by: #sup-a

Verification: `make ci AI=1`

Acceptance:

- [ ] At viewport <768px `ModalB` renders instead of `ModalC`
- [ ] `ModalB` completes the upload flow correctly on mobile
- [ ] `make ci AI=1` passes green

---

## Cross-cutting

## Task 44 — Routing — pipeline sub-tabs in ProjectConfigurePage  {#scr-a}

model: sonnet  effort: M  area: routing

Context: `ProjectConfigurePage` currently does not use a `?stage=<name>`
querystring scheme; adding typed stage querystring routing and registering
sub-tabs for each stage is cross-cutting infrastructure that enables
deep-linking.

Approach: Extend `ProjectConfigurePage` with `?stage=<name>` querystring routing
(additional params like `?stage=grayscale&prefix=p019` for per-page workbenches);
the pipeline shell (header + 23-dot `StageStrip` + `TabsBand`) stays mounted
across stage switches.

Blocked-by: #s0-c

Verification: `cd frontend && pnpm test:e2e routing.spec.ts`

Acceptance:

- [ ] SPA catch-all test still passes
- [ ] Deep-link to `?stage=grayscale&prefix=p019` lands on the correct per-page viewer
- [ ] Back/forward navigation preserves the stage tab
- [ ] Sub-tabs registered: `source`, `grayscale`, `crop`, `page-order`, `hyphen-join`

---

## Task 45 — Storybook consumer demo  {#scr-b}

model: sonnet  effort: M  area: source

Context: Per `PROMPT.md` Done-when criteria, pd-prep-for-pgdp must demonstrate
it can replace any `final/<stage>.jsx` with pd-ui imports + thin glue. All
Stage 01 slices (Tasks 4–7) must be complete first.

Approach: Pick `final/source/source.jsx` and produce a side-by-side parity
comparison demonstrating pd-prep-for-pgdp can replace it with pd-ui imports.

Blocked-by: #s01-a, #s01-b, #s01-c, #s01-d

Verification: `make ci AI=1`

Acceptance:

- [ ] Side-by-side parity comparison produced for `final/source/source.jsx`
- [ ] All source stage behaviors covered by pd-ui imports with thin glue
- [ ] Any divergences are filed as new issues
- [ ] `make ci AI=1` passes green

---

## Task 46 — MIGRATION_NOTES.md in pd-ui  {#scr-c}

model: sonnet  effort: S  area: routing

Context: Per `PROMPT.md` Pass 6, the pd-ui session writes migration notes;
this slice confirms our consumer assumptions match what landed and surfaces
any divergences.

Approach: Consume the `MIGRATION_NOTES.md` written by the pd-ui session,
confirm consumer assumptions match what landed, and surface divergences as
new issues.

Blocked-by: (none internal)

External blockers: pd-ui Pass 6 must complete and publish `MIGRATION_NOTES.md` first.

Verification: `make ci AI=1`

Acceptance:

- [ ] `MIGRATION_NOTES.md` has been read and cross-referenced against our usage
- [ ] Any divergences between our assumptions and pd-ui's published API are filed as issues
- [ ] A brief confirmation comment or note is added to this task's issue
- [ ] `make ci AI=1` passes green

---

## Dependency graph (high-level)

```
S0-A → S0-B → S0-C → most stage slices
                  ↘  SPW-A → SPW-B/C/D/E/F
                  ↘  S01-A → S01-B/C/D → S11-A → S11-B
                  ↘  S02-A → S02-B/C
                  ↘  S03-A → S03-B/C/D
                  ↘  SQF-A → SQF-B
                  ↘  S19-A
                  ↘  S15-A → S15-B/C/D/E/F
                  ↘  S13-A → S13-B/C/D
                  ↘  SPR-A → SPR-B/C/D
                  ↘  SUP-A → SUP-B
```

## Sync to issues

Run `/decompose-spec --sync docs/plans/pd-ui-design-handoff-implementation.md`
once the parallel pd-ui session has named its first set of exports —
slice labels and `blockedBy` edges will be created in
`ConcaveTrillion/pd-prep-for-pgdp` issues.
