---
title: pd-ui design handoff — feature implementation in pd-prep-for-pgdp
date: 2026-05-24
status: draft
owner: ConcaveTrillion
related:
  - pd-ui/docs/templates/design_handoff_pd_ui/README.md
  - pd-ui/docs/templates/design_handoff_pd_ui/PROMPT.md
  - pd-prep-for-pgdp/docs/specs/2026-05-15-hifi-redesign-plan.md
  - pd-prep-for-pgdp/docs/specs/design-brief-index.md
---

## TL;DR

The `pd-ui/docs/templates/design_handoff_pd_ui/` bundle is the design
source-of-truth for the **entire pd-prep-for-pgdp pipeline UI**: four
fully-wired stages (`Source`, `Grayscale`, `Crop`, `Hyphen Join`), a
new Stage 11 (`Page order` auto-detect), the Projects landing page, a
shared Pipeline shell, plus six placeholder stages with canonical
wireframes (Page reorder/scans, Scannos, Validation, Quality flags,
Page Workbench cross-cutting primitives, Folder upload).

This spec catalogues **every user-facing feature** found in the bundle
and maps each to:

1. The pd-ui export it expects to import (the **parallel pd-ui port** —
   tracked in `pd-ui/MIGRATION_NOTES.md` once it lands — is the source
   of those exports).
2. The pd-prep-for-pgdp route / page / store that hosts it.
3. The backend contract (existing route, new route needed, or n/a).

The companion plan
(`docs/plans/pd-ui-design-handoff-implementation.md`) breaks
implementation into slices each gated on the pd-ui exports they
consume.

## Context

- A separate Claude Code session is executing `PROMPT.md` against the
  `pd-ui` repo. That session will land typed React+TS components and
  Storybook entries for every primitive, molecule, template, and
  stage-specific component referenced in this spec. We **do not block**
  that work; we describe what we expect to consume.
- pd-prep-for-pgdp already ships a working FastAPI + React/Vite/TS
  pipeline. Existing pages (`ProjectListPage`, `ProjectConfigurePage`,
  `PageWorkbenchPage`, `TextReviewPage`, `CropsGridPage`,
  `ProjectReviewQueuePage`, `JobsPage`, `SettingsPage`, `LoginPage`)
  cover M0–M4. They use ad-hoc Tailwind + a partial shadcn/Radix set.
- A prior hi-fi redesign plan (`2026-05-15-hifi-redesign-plan.md`)
  established the token system, Tailwind→CSS-vars, shadcn primitive
  list, and studio shell direction. That plan **stops short of the
  full stage-by-stage UX** the design handoff now specifies. This spec
  extends it: same token layer, same shell — but with the full set of
  stages, panels, controls, and data displays wired up.
- The handoff bundle was authored as **plain JSX prototypes loaded via
  Babel-standalone**. Treat the JSX as a *specification*; the actual
  typed React+TS implementations live in pd-ui.

### Catalog provenance

Five Explore subagents read the bundle in parallel:

- `final/` (Source, Grayscale, Crop, Hyphen Join, Projects, Pipeline
  template, Canvas Nav)
- `wf01`, `wf09`, `wf10`, `wf11`
- `wf02` (validation), `wf03` (quality flags), `wf-pw` (Page Workbench
  primitives)
- `wf05`, `wf05b` (hyphen-join + scannos workbenches)
- `design-system/` (ui-base, template, tokens, COMPONENT_INDEX)

Each cataloged screens, regions, controls, data displays, molecules
(with `file:line` refs), and variations. The §"Catalog of features"
section below condenses that into per-stage user stories so this spec
can be implemented without re-reading every `.jsx` prototype.

## Goals / Non-Goals

### Goals

- Implement every feature shown in `final/` (4 wired stages, Projects,
  Pipeline shell) in pd-prep-for-pgdp.
- Implement every feature shown in `wf02`, `wf03`, `wf05b`, `wf09` (new
  Stage 11), `wf-pw` (cross-cutting Page Workbench primitives), and
  `wf01` (folder-upload modal variants) since these are canonical for
  pipeline stages still marked placeholder in `final/index.html`.
- Each implementation consumes pd-ui primitives/molecules; no design
  tokens or stage-component logic is duplicated inside
  pd-prep-for-pgdp.
- Preserve every `data-testid` / `data-comment-anchor` /
  `data-screen-label` attribute the JSX prototypes expose so existing
  Playwright e2e tests stay valid (see also the e2e-acceptance memory
  in `.claude/agent-memory/`).
- Acceptance is per stage: a user can complete the stage's task using
  only pd-ui imports + thin glue (data fetching, store wiring,
  routing).

### Non-Goals

- We do **not** port `DesignCanvas`, `DCSection`, `DCArtboard`, or any
  Babel-standalone scaffolding — pd-ui is using Storybook for that.
- We do **not** invent backend routes for stages that have no design
  yet (Dewarp, Deskew, Threshold, Denoise, Canvas map, Text zones,
  OCR, Spellcheck, Illustrations, Regex, Page split, Proof pack, Zip,
  Build package, Submit check, Archive — listed in
  `final/index.html` as having no design).
- We do **not** change the existing OpenAPI contract except where a
  cataloged feature genuinely needs new data (each such case is
  flagged in the §"Backend gaps" subsection).
- We do **not** ship the post-book hyphen resolver — `final/hyphen_join`
  surfaces cross-page cases and bundles them into
  `post-processing-notes.json` for that tool.
- Visual finish (animations, hover micro-interactions beyond the JSX
  prototypes) is best-effort: the JSX is the spec for **what** exists,
  not pixel-perfect timing.

## Constraints

- Local-first remains the deployment shape (`SQLite + filesystem +
  CPU` per AD-4). Stages that show backend chips (GPU/CPU) must
  function on CPU.
- `make ci AI=1` must stay green slice-by-slice.
- SPA serving contract tests (`test_spa_fallback.py`) must keep
  passing — any new React Router paths must not be shadowed by the
  catch-all.
- pd-ui consumption is via `@concavetrillion/pd-ui` from
  pd-index-npm — slices that depend on a pd-ui export **must**
  blockedBy that export's PR landing in pd-ui.
- Stage 11 (`page_order`) is **new**; it must integrate with the
  existing pipeline-task model without breaking the M1–M6 contracts
  already shipped (see `docs/architecture/03-pipeline.md`).
- Hyphen-join + scannos features depend on Google Books n-gram data
  and a rule library. The spec describes the UI; the data layer
  (Google Books unofficial JSON vs. pre-indexed SQLite, scanno rule
  storage location) is owned by a sibling spec referenced under
  §"Open Questions" — not blocked on it.

## Options Considered

### O-A · One big bang port (rejected)

Port everything at once, single PR. Rejected: too large to review,
high risk of token-system regressions to working pages, no way to
ship incrementally if pd-ui exports stagger in.

### O-B · Stage-by-stage slices with pd-ui gating (chosen)

Each slice maps to one stage (or one cross-cutting molecule set), is
~200-400 LOC, lists its pd-ui import dependencies, and `blockedBy` the
PRs that land those imports. Allows independent shipping; matches
existing `2026-05-15-hifi-redesign-plan.md` cadence.

### O-C · Wait for full pd-ui release before starting

Rejected: stretches calendar. pd-ui will land primitives → molecules →
templates → stage components in passes; we can start consuming the
moment a pass lands.

## Decision

Adopt **O-B**. Companion plan groups slices by stage and lists pd-ui
dependencies. Slices that consume **only** primitives can start as
soon as pd-ui's Pass 2 (atoms reconciliation) lands; slices that
consume stage components must wait until pd-ui's Pass 3 lands the
relevant stage folder.

## Implementation Plan

See `docs/plans/pd-ui-design-handoff-implementation.md` for the full
slice plan. This section enumerates the **catalog of features** the
plan implements, organized by stage.

---

### Stage 01 · Source (`final/source/`)

**Route:** `/projects/:id/configure?stage=source` (sub-tab of
`ProjectConfigurePage`, per Decision #7).

**User tasks:**

1. Ingest scans, watch them generate (progress banner).
2. Mark each page as `page` / `cover` / `back` / `blank` / `duplicate`
   / `insert` either individually or in bulk.
3. Insert synthetic pages (missing / blank / errata / manual) at a
   specific position.
4. Edit per-page metadata in the per-page workbench.
5. Adjust step settings (thumbnail quality, worker concurrency,
   auto-confirm).

**Tabs:** `Files` · `Overview` · `Metadata` · `Step Settings`.

**Panels / regions:**

| Region | Source (file:line) | pd-ui export expected |
|---|---|---|
| `SourceBanner` (generating / selection states) | `final/source/source.jsx:238-341` | `pdUi/Source/SourceBanner` |
| `FileToolbar` (filter chips + density + "Insert page") | `:344-406` | `pdUi/Source/FileToolbar` |
| `ThumbCard` grid | `:126-208` | `pdUi/Source/ThumbCard` |
| `BulkBar` (sticky bottom on multi-select) | `:409-458` | `pdUi/Source/BulkBar` |
| `InsertDialog` (modal) | `:461-595` | `pdUi/Source/InsertDialog` |
| `SourcePageWorkbench` (per-page deep-dive) | `:1240-1267` | `pdUi/Source/SourcePageWorkbench` |
| `SourceStepSettings` (preset + sliders + toggles) | (Step Settings tab block) | `pdUi/Source/SourceStepSettings` |

**Controls:**

- Filter chips: All / Marked as page / Skipped / Unmarked / Inserts
  (each with count). `/` opens search overlay.
- Density toggle S/M/L.
- Multi-select via shift+click range; `esc` clears.
- `BulkBar` actions: Mark as Page / Cover / Back / Blank / Duplicate /
  Remove from project (danger).
- `InsertDialog`: Position (Before/After), Anchor filename, Kind
  (Missing / Blank / Errata / Manual), Note (0/280 char counter),
  Replacement image dropzone, Cancel / Insert.
- `SourcePageWorkbench`: 5-button role segment (Cover / Body / Blank /
  Insert / Skip), page number, rotation, tone hint, before/after
  image viewer, prev/next/apply.
- `SourceStepSettings`: inheritance banner, preset dropdown, Save as
  preset, Thumbnail quality (Fast/Standard/High), Concurrent workers
  slider 1–8, Re-generate thumbnails, Auto-confirm toggle.

**Density toggle note:** The S/M/L thumbnail size toggle is consumer-owned
local state — pd-ui ships `ThumbSizeToggle` (the UI control) and
`ThumbGrid` (CSS grid primitive); the consumer wires the toggle's state
value and derives the grid's column count from it. pd-ui does not own the
selected size state.

**Backend contract:**

- Existing: `/api/projects/{id}/pages` (list), `/api/projects/{id}/ingest`.
- **New required:** `POST /api/projects/{id}/pages/insert` to support
  synthetic-page insertion (no field for this in current spec).
- **New required:** `PATCH /api/projects/{id}/pages/{prefix}/role` to
  set page role atomically (existing route accepts type but not the
  six-role taxonomy with `insert`).

---

### Stage 02 · Grayscale (`final/grayscale/`) + WF11 variants

**Route:** `/projects/:id/configure?stage=grayscale`.

**User tasks:**

1. Decide perceptual vs. standard grayscale (auto-detect default).
2. Tune sampler radius, gamma, output range per page or globally.
3. Preview before/after split.

**Tabs:** `Overview` · `Pages` · `Step Settings`.

**Panels:**

| Region | Source (file:line) | pd-ui export expected |
|---|---|---|
| `BackendChip` (GPU/CPU) | `final/grayscale/grayscale.jsx:43-63` | `pdUi/atoms/BackendChip` |
| `AutoDetectBanner` (rationale + re-detect) | `:70-112` | `pdUi/Grayscale/AutoDetectBanner` |
| `ModeCard` (two-up chooser) | `:119-209` | `pdUi/Grayscale/ModeCard` |
| `AdvancedParams` (3 sliders) | `:215-296` | `pdUi/Grayscale/AdvancedParams` |
| `GrayscaleOverview` (stat tiles + cards) | `:351-419` | `pdUi/Grayscale/GrayscaleOverview` |
| `GrayThumb` grid | `:425-462` | `pdUi/Grayscale/GrayThumb` |
| `PageViewer` (split before/after, page strip) | `:888-1013` | `pdUi/Grayscale/PageViewer` |
| `StageControlsLeft` (per-page drawer) | `:673-823` | `pdUi/Grayscale/StageControlsLeft` |

**WF11 variants** (`wf11/wf11-variations.jsx`) provide six exploratory
designs for the same control panel — pd-ui ships **Variant F** (auto-detect,
visual chooser, advanced accordion, CPU-fallback warning, cached note) as
the production component. The remaining variants are Storybook stories only.

**Controls:**

- `ModeCard`: Standard / Perceptual side-by-side with checkmark +
  time estimate badge (exact green or fuzzy amber).
- `AdvancedParams`: Sampler radius, Gamma (1–3), Output range — each
  with slider + numeric input + reset.
- `PageViewer`: Before/Split/After segmented toggle, per-page time
  estimate, "Re-run page" button, 13-page thumbnail scroller.
- `StageControlsLeft`: inheritance banner (clean/modified/preset),
  CPU-fallback warning, mode chooser, advanced params, sticky footer
  with Revert + "Save as default" (visible only when modified).

**Backend contract:**

- Existing: `/api/projects/{id}/grayscale/run`.
- **New required:** auto-detect endpoint returning `{ recommendedMode,
  detectedProfile, estimatedSecondsPerPage }` so the banner can
  populate without running.

---

### Stage 03 · Crop (`final/crop/`) + WF10

**Route:** `/projects/:id/crops` (already exists as `CropsGridPage`).

**User tasks:**

1. Review auto-crop bboxes for 387 pages.
2. Filter by flag (over-crop, asymmetric, finger, etc.).
3. Bulk re-run with new strategy.
4. Edit one page's bbox interactively.

**Tabs:** `Pages` · `Overview` · `Step Settings`.

**Panels:**

| Region | Source (file:line) | pd-ui export expected |
|---|---|---|
| `CropBanner` (running / review / done) | `final/crop/crop.jsx:268-384` | `pdUi/Crop/CropBanner` |
| `CropToolbar` (filter + per-flag drill-down + density) | `:387-476` | `pdUi/Crop/CropToolbar` |
| `CropCard` grid | `:154-263` | `pdUi/Crop/CropCard` |
| `CropBulkBar` | `:479-522` | `pdUi/Crop/CropBulkBar` |
| `BboxEditor` (magnified + handles + apply-to scope) | `:552-754` | `pdUi/Crop/BboxEditor` |
| `CropOverview` (flag distribution + activity) | `:849-941` | `pdUi/Crop/CropOverview` |
| `CropStepSettings` | `:947-1211` | `pdUi/Crop/CropStepSettings` |

WF10 (`wf10/crops-grid.jsx`) is canonical for `CropCard` density
modes (S=9-col, M=6-col, L=4-col) and the inline `CropBboxEditor`.

**Crop flag taxonomy** (final source: `wf10/crops-grid.jsx:9-18`):

```
cropped     (over-crop)     tone mismatch
asymmetric                  tone gt
loose                       tone ocr
overflow                    tone mismatch
blank                       tone ink-3
misaligned                  tone gt
deskewFail  (deskew·fail)   tone fuzzy
nearEdge    (near edge)     tone fuzzy
```

**Controls:**

- `CropToolbar`: filter chips (All / Flagged / Clean / Reviewed /
  Errors), per-flag drill-down (only when filter=flagged), "Re-run
  with new strategy", density toggle.
- `CropCard`: checkbox (M/L only), page number, status dot, flag
  chips (max 1/2/4 visible per density + "+N" overflow), CroppedThumb
  with bbox overlay.
- `CropBulkBar`: count + flag summary + Re-deskew only / Re-run from
  initial_crop (N) / Accept as-is / Restore default bbox.
- `BboxEditor`: 8 draggable handles, T/R/B/L margin inputs (px/% unit
  toggle) with delta-from-default, apply-to scope (This page /
  Selected N / All flagged with same issue N), Cancel / Accept as-is
  / Re-crop.
- `CropStepSettings`: strategy radio (Edge-detect / ML model / Manual
  / From source), margin slack slider (0–40px), symmetry guard
  toggle, min page area slider, auto-accept on green toggle, re-deskew
  after crop toggle, stale-bump warning if modified.

**Backend contract:**

- Existing: `/api/projects/{id}/crops`, `/api/projects/{id}/crops/{prefix}/bbox`.
- **New required:** `POST /api/projects/{id}/crops/rerun-flagged` with
  filter payload `{ flags: [...], pages: [...] }`.

---

### Stage 11 · Page order (NEW) (`wf09/variations.jsx :: ReorderScansStage`)

**Route:** `/projects/:id/configure?stage=page-order` (new sub-tab).

**User task:** Auto-detect out-of-order scans; accept/skip per swap.

**Panels:**

| Region | Source (file:line) | pd-ui export expected |
|---|---|---|
| `ReorderScansBanner` (detected vs clean) | `wf09/pages-tab.jsx:530-578` | `pdUi/PageReorder/ReorderScansBanner` |
| `SwapRow` list | `:414-487` | `pdUi/PageReorder/SwapRow` |
| `PageThumb` pair w/ swap icon | `:379-412` | `pdUi/PageReorder/PageThumb` |
| After-apply confirmation strip | `:630-645` | `pdUi/PageReorder/AfterApplyStrip` |

**Auto-detection presentation:**

- Banner: sparkles icon + "Found N likely out-of-order scans" + summary
  "N detected · M high · K medium" + sort dropdown + "Skip stage"
  (outline) + "Auto-apply (M high)" (primary).
- Clean banner: green checkmark + "Scans look in order" + "Re-detect".

**Per-swap controls:**

- Pending: Skip (ghost) · Inspect (outline, eye icon) · Accept
  (primary, check icon).
- Post-decision: static badge "Accepted" (clean) or "Skipped"
  (neutral); row fades.

**Signal display per swap:** number badge (28×28, tone-colored,
mono), PageThumb pair with central swap icon, confidence badge
(high/medium), reasoning text + mono signal list (`ocr page #`,
`filename seq`, `similarity`, `confidence`).

**Backend contract:**

- **New required:** `/api/projects/{id}/page-order/detect` → returns
  array of `{ idA, idB, confidence, signals }`.
- **New required:** `/api/projects/{id}/page-order/apply` with array
  of accepted swap IDs; mutates prefixes (renumber).

---

### Stage 13 · Text review + scannos (`wf05b/`)

**Routes:** `/projects/:id/pages/:idx0/review` (exists), plus new
sub-views for scanno triage.

**User tasks:** *(see catalog provenance § for full WF-05B / WF-05
detail — the spec lists every screen, control, and molecule)*

1. **Pipeline P:** Toggle scannos pipeline stage on/off; review
   page-level stat density; jump to per-page workbench.
2. **Capture C1:** Proofread a page; suspicion tokens are underlined
   (color by source: rule / OCR / manual); inline popover for
   accept/dismiss/promote on click; right-pane suspicion list sorted
   by confidence.
3. **Promote C2:** Per-book candidate triage table; filter by
   pending/accepted-local/promoted/dismissed and by source; right-pane
   detail with evidence (3 of N contexts), promote-preview form,
   bulk actions ("Dismiss all OCR ≥ noise", "Promote strong matches").
4. **Configure C3:** Global rule library (Scannos category); sortable
   table; per-rule auto-apply toggle; conflict warnings; rule detail
   with evidence (hits / contributing books / contributors).

**Panels:**

| Region | Source (file:line) | pd-ui export expected |
|---|---|---|
| `ScannoToken` (underlined span) | `wf05b/scanno-capture.jsx:77-92` | `pdUi/Scannos/ScannoToken` |
| `InlineMarkPopover` | `:366-413` | `pdUi/Scannos/InlineMarkPopover` |
| `CandidateDetail` (right-pane) | `wf05b/scanno-promote.jsx:300-410` | `pdUi/Scannos/CandidateDetail` |
| `RuleDetail` (global library) | `wf05b/scanno-configure.jsx:290-406` | `pdUi/Scannos/RuleDetail` |
| `ToggleBadge` (auto-apply mini switch) | `:265-288` | `pdUi/atoms/ToggleBadge` |
| `NavGroup` (side-nav library category) | `:236-263` | `pdUi/atoms/NavGroup` |

**Hyphen-join companion** (`wf05/`, also surfaced in `final/hyphen_join/`):
five decision surfaces (Undecided list V1, Undecided cards V2, Queue
mode V3, Mismatch report V4, Auto-joined validation V5) with keyboard
shortcuts (J/K navigate, Y/N/B/S decide, F flag for post-book).
Cross-page hyphens are first-class (`PageBreak` purple pill with
`p036↓ · skip running head · ↑p037`); ngrams sparkline (1700–2020)
inline in cards via `NgramsBlock` / `Sparkline`.

**Backend contract:** Scanno rule store + book-local candidate store
are owned by a sibling spec (see Open Questions). Hyphen-join uses
existing rule library + Google Books unofficial JSON for ngrams
(prototype path).

---

### Stage 15 · Hyphen Join (`final/hyphen_join/`)

**Route:** `/projects/:id/configure?stage=hyphen-join` (new sub-tab).

**Tabs:** `Overview` · `Undecided` · `Auto-joined` · `Mismatch` ·
`Step Settings`.

**Panels:** see `final/hyphen_join/hyphen.jsx`:

- `HyphenOverview` (workflow cards + stat tiles + `PostBookNotesPreview`)
- `HyphenUndecided` (queue sidebar + focused case detail)
- `HyphenAutoJoined` (grouped-by-word validation)
- `HyphenMismatch` (`MismatchedReportV4`)
- `HyphenStepSettings` (rule library, n-gram cache controls,
  auto-flag thresholds)
- `HyphenPageWorkbench` (`:1059-1193`) — per-page before/after split
  with `HJDecisionCard` (Validate join / Accept / Keep / Flag).

**Status pills** (`HJStatusPill`, `:534-568`): cross-page (purple,
gt tone), validated (green/exact), auto-joined (dashed-outline
exact), undecided (amber/fuzzy), flagged (red/mismatch).

**Keyboard shortcuts:** J/K to navigate queue, Y/N to accept/keep, F
to flag.

**Backend contract:**

- **New required:** `/api/projects/{id}/hyphens` (list with state),
  `/api/projects/{id}/hyphens/{id}/decide` (accept/keep/flag),
  `/api/projects/{id}/hyphens/notes` (export of flagged for
  `post-processing-notes.json`).
- **New required:** ngram-cache endpoint (Google Books unofficial JSON
  proxy + SQLite-backed cache; sibling spec owns the data layer).

---

### Stage 19 · Validation (`wf02/validation-panel.jsx`)

**Route:** Renders inside `ProjectConfigurePage` under the Pipeline
tab (per `2026-05-15-hifi-redesign-plan.md`'s pre-existing pattern).

**User task:** Review pre-flight validation against PGDP rules;
download package or fix errors.

**Panels:**

| Region | Source (file:line) | pd-ui export expected |
|---|---|---|
| `SummaryHeader` (pass/warn/error banner) | `wf02/validation-panel.jsx:102-148` | `pdUi/Validation/SummaryHeader` |
| `PanelToolbar` (re-validate + last-run) | `:150-168` | `pdUi/Validation/PanelToolbar` |
| `CheckRow` (collapsible with affected pages) | `:42-100` | `pdUi/Validation/CheckRow` |
| `CheckIcon` (pass/warn/error/running/skip) | `:7-25` | `pdUi/atoms/CheckIcon` |
| `PageChip` (mono prefix navigation) | `:28-40` | `pdUi/atoms/PageChip` |
| `DownloadFooter` (contextual CTA) | `:170-206` | `pdUi/Validation/DownloadFooter` |

**Variations:** pass (all 8 green) · warn (with affected page chips,
dual buttons "Download anyway" + "Fix & rebuild") · error (download
disabled, "Fix all (N)" CTA) · running (per-check loader) · fixing
(per-check spinner).

**Backend contract:**

- Existing: `/api/projects/{id}/validate`.
- **New required:** per-check `/api/projects/{id}/validate/{check}/fix`
  endpoints for the "Fix automatically" affordance.

---

### Source-quality banner & quality-flag taxonomy (`wf03/`)

**Route:** Renders inside `ProjectConfigurePage` Pages tab.

**Panels:**

| Region | Source (file:line) | pd-ui export expected |
|---|---|---|
| `QualityBanner` (extreme / moderate tones) | `wf03/wf03-variations.jsx:75-129` | `pdUi/QualityFlags/QualityBanner` |
| `StageContextStrip` (variant=`configure`) | `:375-451` | `pdUi/molecules/StageContextStrip` |
| `StageJumpPopover` (⌘P) | `:273-372` | `pdUi/molecules/StageJumpPopover` |
| `FilterToolbar` (filter pills + search + view mode + thumb size) | `:706-756` | `pdUi/molecules/FilterToolbar` |
| `PageThumb` (full) | `:489-569` | `pdUi/QualityFlags/PageThumb` |
| `PageRow` (list mode) | `:781-827` | `pdUi/QualityFlags/PageRow` |
| `BulkActionBar` | `:651-678` | `pdUi/molecules/BulkActionBar` |

**Flag taxonomy** (canonical):

- **Source stage** (pre-pipeline): `blurry` (Laplacian <80 / fuzzy),
  `skew` (>5° / purple `#a855f7`), `dark` (σ<22 / ink-2), `sparse`
  (bbox<20% / `#0ea5e9`).
- **Threshold stage**: `over` (fg>38% / fuzzy), `under` (fg<4% /
  `#0ea5e9`), `halftone` (purple), `mixed` (`#f97316`).
- **OCR stage**: `low-conf` (mean<0.74 / fuzzy), `no-text` (0
  baselines / ink-2), `garbled` (≥30% non-word / mismatch),
  `mixed-lang` (purple).
- **Cross-stage**: `errored` (mismatch).

**Density toggle note:** As in the Source stage, the thumb size toggle
(S/M/L) is consumer-owned local state. pd-ui ships `ThumbSizeToggle` and
`ThumbGrid`; the consumer wires state and column count.

**Backend contract:**

- Existing: `/api/projects/{id}/pages` returns per-page flags array.
- **New required:** `/api/projects/{id}/pages/flag-counts` (denormalised
  count per flag for the banner + filter chip counts).
- **New required:** `/api/projects/{id}/rerun-from-stage?stage=X` with
  page-id filter for the "Re-run from {stage}" bulk action.

---

### Page Workbench cross-cutting primitives (`wf-pw/`)

**Route:** `/projects/:id/pages/:idx0` (exists as `PageWorkbenchPage`).

**Panels:**

| Region | Source (file:line) | pd-ui export expected |
|---|---|---|
| `PWHeader` (breadcrumb + Prev/Next + edit-mode + actions) | `wf-pw/wf-pw-variations.jsx:19-52` | `pdUi/PageWorkbench/PWHeader` |
| `EditModeSelector` (View/Split/Illustration/Rotate) | `:54-83` | `pdUi/PageWorkbench/EditModeSelector` |
| `PageAttributesBar` + `AttrEditorPopover` | `:100-223` | `pdUi/PageWorkbench/PageAttributesBar` |
| `ArtifactViewer` + `ArtifactPlate` + `PaperRender` | `:264-444` | `pdUi/PageWorkbench/ArtifactViewer` (pd-ui export) |
| `SplitOverlay` / `IllustOverlay` / `WordBboxOverlay` | `:340-398` | `pdUi/PageWorkbench/overlays/*` (pd-ui export) |
| `StageControlsPanel` + per-stage controls | `:457-668` | `pdUi/PageWorkbench/StageControlsPanel` (with sub-export per stage) |
| `LabelerCanvas` + `LayerToggle` | `:1132-1287` | `pdUi/PageWorkbench/LabelerCanvas` |
| `HierarchyTreePanel` + `TreeRow` | `:1296-1414` | `pdUi/PageWorkbench/HierarchyTreePanel` |
| `BlockTypePickerPanel` + `TypeGrid` | `:1440-1534` | `pdUi/PageWorkbench/BlockTypePickerPanel` |
| `PageAttributesPanel` (right-drawer full editor) | `:1538-1622` | `pdUi/PageWorkbench/PageAttributesPanel` |
| `OcrTextPanel` + `LineBlockCards` / `LineBlockRows` / `WordCard` / `WordRow` / `ConfPip` | `:1763-1983` | `pdUi/PageWorkbench/OcrTextPanel` |
| `Drawer` (left/right, collapsed/expanded with tabs) | `:1636-1723` | `pdUi/molecules/Drawer` |
| `TextReviewPane` (collapsible bottom) | `:711-785` | `pdUi/PageWorkbench/TextReviewPane` |

**Layout modes:**

- 3-column (>1280px): left drawer (372px stage controls) | center
  (artifact viewer, flex) | right drawer (372px page attrs / hierarchy
  / block-type / OCR text — tabbed).
- 2-column (OCR stage or <1280px): left strip (48px collapsed) |
  center | right drawer (760px wide for OCR workbench).
- `TextReviewPane`: 280px when open, 44px collapsed.

**Per-stage controls** (each is its own pd-ui export):
`ThresholdControls`, `CanvasMapControls`, `GrayscaleControls`,
`DeskewControls`, `InitialCropControls`, `OcrControls`.

**Note on ArtifactViewer ownership:** `ArtifactViewer` is the shared
pd-* image-annotation viewer (used by pd-prep-for-pgdp PageWorkbench AND
pd-ocr-labeler-spa). It is a pd-ui export, not a consumer-owned component.
`ArtifactViewer` + `ArtifactPlate` + `PaperRender` + `SplitOverlay` +
`IllustOverlay` + `WordBboxOverlay` all compose on top of pd-ui's
lower-level `PageImageCanvas` (Konva stage with 6-slot API). These exports
land in pd-ui Phase 2 (see follow-up spec
`pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md` —
referenced but not yet filed at edit time).

---

### Projects landing page (`final/projects/`)

**Route:** `/` (exists as `ProjectListPage`).

**Panels:**

| Region | Source (file:line) | pd-ui export expected |
|---|---|---|
| `ProjectsPage` (sidebar + detail) | `final/projects/projects.jsx:292-649` | `pdUi/Projects/ProjectsPage` |
| `CoverPlaceholder` (initials avatar) | `:119-133` | `pdUi/atoms/CoverPlaceholder` |
| `PipelineMini` (23-dot strip) | `:93-116` | `pdUi/Projects/PipelineMini` |
| `AttributesPanel` (collapsible 2-col) | `:157-285` | `pdUi/Projects/AttributesPanel` |
| `ProjectsEmpty` (first-time hero) | `:656-723` | `pdUi/Projects/ProjectsEmpty` |

**Tabs (right pane):** Recent activity · Attributes · Manage.

**Attribute sections** (collapsible): Bibliographic · PGDP project ·
Format & content · Project comments.

**Status badges** (from existing taxonomy): queued · running · review ·
ready · submitted · error · archived.

**Active vs archived:** archived shows "Open (read-only)" +
restore/save/delete; active shows "Open project" + clean/archive/save/
delete (with 2-step confirmation for delete).

---

### Folder upload modal (`wf01/`)

**Route:** Triggered from `ProjectListPage` "Create new project" CTA.

The handoff offers **five modal variants** (`ModalA` through `ModalE`).
Per the parallel pd-ui work, the production component will be
**ModalC** (right-side sheet with 4-step left rail) for desktop and
fall back to ModalB (compact drop target) below 768px. The other
variants are Storybook stories only.

**Flow:**

1. **Name** — book name + project slug (mono, auto suffix).
2. **Choose source** — Zip / Folder / Local path / IA URL (segmented
   tabs in ModalD; selection card in ModalC; auto-detect in ModalE).
3. **Review** — manifest table (file · size · dimensions · status),
   thumbnail strip, warnings box (with "Open Settings" if non-image
   files skipped).
4. **Upload** — `PhaseCard` trio (Zip · Upload · Ingest), progress
   bar with mono stats (% · part N of M · speed · ETA), "Do not
   close this tab" note.

**Existing implementation:** pd-prep-for-pgdp already ships
client-side JSZip folder upload (P0.3 shipped 2026-05-16). This slice
replaces the modal chrome and surfaces the manifest review step.

**Backend contract:** existing
`/api/projects/create` + `/api/projects/{id}/ingest` chain. ModalE's
"IA / HathiTrust" external-source chips require new fetch endpoints
(scope-deferred — sibling spec).

---

### Pipeline shell + PipelineTemplate

Sources: `final/template/`, `final/pipeline/`, `design-system/template.jsx`

**Components:**

| Region | Source (file:line) | pd-ui export expected |
|---|---|---|
| `AppHeader` (logo + search + jobs pill + bell + avatar) | `design-system/template.jsx:10-98` | `pdUi/shell/AppHeader` |
| `JobsPill` + `JobsDrawer` + `JobRow` | `:100-194, :304-547` | `pdUi/shell/Jobs*` |
| `Breadcrumb` (with content-controls slot) | `:201-241` | `pdUi/shell/Breadcrumb` |
| `PipelineTemplate` (full page chrome) | `:264-291` | `pdUi/templates/PipelineTemplate` |
| `ProjectInfoBand` | (`final/pipeline-template/`) | `pdUi/molecules/ProjectInfoBand` |
| `StageStrip` (23-dot progress) | (`final/pipeline-template/`) | `pdUi/molecules/StageStrip` |
| `TabsBand` (per-stage tabs) | (`final/pipeline-template/`) | `pdUi/molecules/TabsBand` |
| `CanvasNav` (theme toggle + stage shortcuts) | `final/canvas-nav.jsx` | **NOT PORTED** — design-only |

`CanvasNav` is design-canvas chrome, not production. Theme handling
in pd-prep-for-pgdp uses pd-ui's existing theme provider.

`AppShell` (generic) + `PipelineTemplate` (per-project) compose the full
page chrome. `AppShell` wraps the top-level app frame (header, nav rail,
theme); `PipelineTemplate` slots in the pipeline-specific chrome
(`ProjectInfoBand`, `StageStrip`, `TabsBand`) for project-scoped routes.

pd-ui's `getTabsForStage(stageId)` has defaults for `source`, `ocr`,
`text_review`, `build_package`, and `hyphen_join` only. All other stages
fall back to a generic 4-tab default (Overview / Pages / Workbench /
Settings). Consumer must pass an explicit `tabsSlot` override per stage
where the design specifies non-default tabs — for example, Grayscale's
Overview / Pages / Step Settings layout has no Workbench tab and therefore
requires a `tabsSlot` override rather than relying on the default.

---

### Atoms & molecules to consume from pd-ui

The full list of atoms is in `design-system/ui-base.jsx` (`Icon`,
`Button`, `Input`, `Badge`, `KeyCap`, `Divider`, `StepDots`, `TopNav`,
`ServerFooter`, `PageHeader`, `ProjectListBackdrop`, `AppFrame`) and
the molecule frequency table in `COMPONENT_INDEX.md`. All atoms are
imported through `@concavetrillion/pd-ui`; pd-prep-for-pgdp keeps no
ad-hoc duplicates.

**Badge `tone` prop status:** `Badge` ships in pd-ui Phase 1 with
structural variants (`default` / `primary` / `danger`). The semantic
`tone` prop (`clean` / `fuzzy` / `mismatch` / etc.) that this spec assumes
is declared as a TypeScript type (`BadgeTone`) at `Badge.tsx:16-29` but is
**not yet wired into the component** (tracked in pd-ui issue #339).
Consumer must not pass `tone` until pd-ui issue #339 lands; use `variant`
for structural styling and inline color tokens for status indicators until
then.

**Tokens** (CSS custom properties; identical names across both apps):

- Surfaces: `--bg-page` / `--bg-surface` / `--bg-raised` / `--bg-sunk`
- Borders: `--border-1` / `--border-2` / `--border-3`
- Ink: `--ink-1` / `--ink-2` / `--ink-3` / `--ink-4`
- Tones: `--exact` (clean / done) · `--fuzzy` (dirty / review) ·
  `--ocr` (running) · `--mismatch` (failed / error) · `--gt` (ground
  truth / reference) · `--accent` (primary action — amber on charcoal)
- Canvas layers: `--block`, `--para`, `--line`, `--word`
- Typefaces: `--ui-font` (Inter), `--mono-font` (JetBrains Mono)

Existing `pd-prep-for-pgdp/frontend/src/styles/tokens.css` (introduced
by the 2026-05-15 hi-fi plan) is the implementation surface; the
design handoff is canonical for any new tokens.

## Test Plan

Per-slice acceptance:

- **Type check + lint:** `make ci AI=1` green.
- **Unit:** existing per-component test files (`*.test.tsx`); new
  components add their own test file alongside.
- **e2e:** Playwright e2e at `frontend/tests/e2e/` exercises every
  cataloged user task. The acceptance rule (per
  `.claude/agent-memory/.../feedback_driver_vs_e2e.md`) is **e2e
  Playwright tests covering every spec'd item/button** — not a
  separate driver agent.
- **SPA contract:** `test_spa_fallback.py` keeps passing — new routes
  added in this spec (`/projects/:id/source`, `/projects/:id/grayscale`,
  `/projects/:id/page-order`, `/projects/:id/hyphen-join`) must each
  have an entry exercising the catch-all without shadowing `/api/*`.
- **Visual:** Storybook snapshot tests for each new pd-ui consumer
  (pd-ui is the snapshot owner; pd-prep-for-pgdp consumes).

## Decisions (resolved 2026-05-24)

1. **Stage 11 heuristic — pd-book-tools owns it.** A new
   `pd_book_tools.page_order.detect_out_of_order_pages(...)` helper
   consumes filename-sequence + OCR-page-number + thumbnail-similarity
   signals. Pd-prep-for-pgdp's
   `/api/projects/{id}/page-order/detect` endpoint is a thin wrapper.
   **Sequencing:** S11-A (manual drag) ships unblocked; S11-B is
   `blockedBy` a pd-book-tools spec for the helper (filed separately).
2. **Hyphen-join ngrams — JSON-first, SQLite later.** S15-* consumes
   Google Books unofficial JSON through a thin adapter
   (`HyphenNgramsClient` interface). A follow-up spec covers
   migrating to a pre-indexed ~50MB SQLite in pd-book-tools. Adapter
   shape is stable across both backends.
3. **Scanno rule + candidate store — pd-book-tools owns it.** A new
   `pd_book_tools.scannos` module owns both `ScannoRule` (global
   library) and `ScannoCandidate` (per-book triage) schemas + storage.
   Pd-prep-for-pgdp's scanno API routes are thin wrappers.
   **Sequencing:** every S13-* slice is `blockedBy` the pd-book-tools
   spec for `pd_book_tools.scannos` (filed separately).
4. **Validation auto-fix — safe-rename whitelist only.** v1 ships
   auto-fix for cosmetic / mechanical checks only: filename
   normalisation (NFC), prefix renumbering (non-contiguous), trailing
   whitespace in metadata. Semantic checks (missing metadata, OCR
   confidence floor, schema violations) show "View log" / "Show
   pages" but no "Fix automatically" button. S19-B inventories the
   whitelist precisely; semantic auto-fix deferred to a sibling spec.
5. **WF11 grayscale — Variant F (combined).** Auto-detect banner +
   visual chooser + advanced accordion + cached note + CPU-fallback
   warning. Other variants stay as Storybook stories in pd-ui.
6. **Upload modal — ModalC desktop + ModalB mobile.** Right-side
   sheet with 4-step left rail above 768px; compact drop target
   below. The other variants (A, D, E) stay as Storybook stories.
7. **Routing — sub-tabs inside `ProjectConfigurePage`.** Per
   `final/pipeline/`, stages are tabs within a pipeline container.
   Deep links use querystring (`?stage=source`,
   `?stage=grayscale&prefix=p019`). The 23-dot `StageStrip` stays
   mounted across stage changes; no full-page navigation between
   stages.

## Implementation status (audit 2026-05-24)

The 4-way audit (pd-ui repo state vs. this spec) found the following:

- **Foundation layer shipped.** pd-ui milestone #333 landed 61 components
  covering atoms, molecules, shell, `AppShell`, `PipelineTemplate`, token
  system, `PageImageCanvas` (Konva stage with 6-slot API), `ThumbSizeToggle`,
  `ThumbGrid`, and all structural `Badge` variants.
- **Per-stage component layer deferred.** 43 stage-specific components
  (across Source, Grayscale, Crop, Scannos, Validation, Quality flags,
  Page Workbench overlays, ArtifactViewer family) are deferred to pd-ui
  Phase 2. See follow-up spec
  `pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md`
  (referenced but not yet filed at edit time).
- **Slice readiness split.** Of the 46 slices in the companion plan
  (`docs/plans/pd-ui-design-handoff-implementation.md`):
  - **15 ready-to-start** — foundation, Projects landing page, Folder
    upload modal, Quality flags (banner + filter, primitives-only),
    Routing + React Router registration, Storybook consumer entries.
  - **31 blocked** on pd-ui Phase 2 exports landing (per-stage components,
    ArtifactViewer family, stage-specific overlays).
  - Slices marked blocked may be co-located in pd-prep-for-pgdp using
    pd-ui primitives + canvas slots as a stopgap if Phase 2 stretches;
    the components would be refactored into pd-ui exports in a later pass.

## Open Questions

None blocking. Filed as separate specs:

- `pd-book-tools/docs/specs/<date>-page-order-detection.md` (gates S11-B)
- `pd-book-tools/docs/specs/<date>-scanno-rule-library.md` (gates all S13-*)
- `pd-book-tools/docs/specs/<date>-hyphen-ngrams-sqlite.md` (post-v1 follow-up to Decision #2)
- `pd-prep-for-pgdp/docs/specs/<date>-validation-semantic-autofix.md` (post-v1 follow-up to Decision #4)
