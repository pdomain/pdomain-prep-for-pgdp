# Library placement contract

**Date:** 2026-06-10
**Status:** Phase 0 gate — frozen. Changes require editing this doc in the
same commit as any code that diverges from it.
**Spec:** `docs/specs/2026-06-10-statechart-convergence-design.md` §6
**Inputs:**

- `docs/plans/design_handoff_pgdp_app/design-system/ui-base.jsx`
- `docs/plans/design_handoff_pgdp_app/design-system/template.jsx`
- `docs/plans/design_handoff_pgdp_app/design-system/tokens.css`
- `docs/plans/design_handoff_pgdp_app/COMPONENT_INDEX.md`
- `docs/specs/stage-registry-v2.md` §7 (placement flags)
- pdomain-ui current exports (`src/index.ts`, `theme/tokens.css`)
- pdomain-ops protocols (`gpu/protocols.py`)
- pdomain-book-tools `image_processing/`, `geometry_correction/`

---

## 1. Frontend disposition table

Every identifier exported by `design-system/ui-base.jsx` and
`design-system/template.jsx`, plus the multi-file identifiers from the
**Frequency table** in `COMPONENT_INDEX.md`, is given a three-way
disposition:

- **reuse pdomain-ui** — the equivalent already exists in the library;
  import from `@pdomain/pdomain-ui` without porting.
- **promote to pdomain-ui** — does not exist yet; promote before Task F1a
  consumes it (Task F1b, dispatched to the `pdomain-ui` agent).
- **stays app-local** — PGDP-specific surface; lives in
  `frontend/src/design/` or the relevant stage component directory.

### 1.1 Identifiers from `ui-base.jsx`

| Identifier | Disposition | pdomain-ui mapping / rationale |
|---|---|---|
| `Icon` | reuse pdomain-ui | `@pdomain/pdomain-ui/icons` re-exports the full lucide-react icon set; design icon names map to lucide identifiers. Import from the icons subpath; do not port the inline SVG set. |
| `Button` | reuse pdomain-ui | `Button` in `@pdomain/pdomain-ui` (primitives). Supports `variant`, `size`, `icon*` props; matches the design's sm/md/lg + default/primary/ghost/danger variants. No new token needed. |
| `Input` | reuse pdomain-ui | `Input` in `@pdomain/pdomain-ui` (primitives). Supports `mono`, `suffix`, `autoFocus`; maps directly. |
| `Badge` | reuse pdomain-ui | `Badge` + `Chip` in `@pdomain/pdomain-ui` (primitives). The design's tone vocabulary (`clean`/`exact`/`dirty`/`fuzzy`/`running`/`ocr`/`failed`/`mismatch`/`error`/`gt`) maps to existing status token names. Extend with any missing tone aliases in pdomain-ui if needed (see §1.4). |
| `KeyCap` | reuse pdomain-ui | `KeyCap` in `@pdomain/pdomain-ui` (primitives). Verified exported. |
| `Divider` | reuse pdomain-ui | `Separator` in `@pdomain/pdomain-ui` (primitives). Horizontal and vertical variants both supported. |
| `StepDots` | reuse pdomain-ui | `StepDots` in `@pdomain/pdomain-ui` (primitives). Exported with `StepDotsProps`. |
| `TopNav` | reuse pdomain-ui | **Maps to `AppHeader`** in `@pdomain/pdomain-ui` (shell). pdomain-ui exports both `TopNav` (bare layout wrapper) and `AppHeader` (full header with icon+name, search, bell+unread, avatar). The design's `TopNav` is a proto of the shipped `AppHeader`; import `AppHeader` — do not use pdomain-ui's `TopNav`. |
| `ServerFooter` | stays app-local | PGDP-specific server-address footer (`127.0.0.1:<port>`). No parallel in pdomain-ui; stays in `frontend/src/design/ServerFooter.tsx`. |
| `PageHeader` | reuse pdomain-ui | `ConfigureHeader` in `@pdomain/pdomain-ui` (templates) covers the title + sub + action-slot pattern. Alternatively use the `ProjectInfoBand` template for pipeline views. |
| `ProjectListBackdrop` | stays app-local | Prototype scaffolding used only in the design canvas; never port. Replaced by the proper `ProjectsPage` surface (Task F3). |
| `AppFrame` | reuse pdomain-ui | `AppShell` + `PipelineTemplate` / `AppTemplate` in `@pdomain/pdomain-ui` (shell + templates). The design `AppFrame` is the proto shell; `AppShell` is the shipped equivalent. |

### 1.2 Identifiers from `template.jsx`

| Identifier | Disposition | pdomain-ui mapping / rationale |
|---|---|---|
| `AppHeader` | reuse pdomain-ui | `AppHeader` in `@pdomain/pdomain-ui` (shell). The design `AppHeader` matches the shipped version: left icon+name, center search, right jobs+bell+user. |
| `JobsPill` | reuse pdomain-ui | `JobsPill` in `@pdomain/pdomain-ui` (shell). The design `JobsPill` matches the shipped component (active/idle states, count badge, hover popover). |
| `JobsDrawer` | reuse pdomain-ui | `JobsDrawer` in `@pdomain/pdomain-ui` (shell). Present in installed @pdomain/pdomain-ui (v0.2.2). Modes: `expanded` / `collapsed` / `dismissed`. Exported with `JobsDrawerProps`. |
| `JobRow` | reuse pdomain-ui | `JobRow` in `@pdomain/pdomain-ui` (shell). Inline hover actions (Open/Pause/Discard) are part of the shipped component. |
| `Breadcrumb` | reuse pdomain-ui | `Breadcrumb` in `@pdomain/pdomain-ui` (shell). Trail + controls slot pattern matches. |
| `ControlsPlaceholder` | stays app-local | Dev-only striped placeholder; never port to production code. |
| `AppTemplate` | reuse pdomain-ui | `PipelineTemplate` + `AppShell` in `@pdomain/pdomain-ui` (templates + shell). `AppTemplate` is the per-screen frame; `PipelineTemplate` covers the pipeline shell use case; `AppShell` covers the global outer frame. |

### 1.3 Multi-file identifiers (`COMPONENT_INDEX.md` frequency table)

These identifiers appear in two or more `final/` stage files. Disposition
applies to ALL occurrences; the impl lives in one place.

| Identifier | Frequency | Disposition | pdomain-ui mapping / rationale |
|---|---|---|---|
| `App`, `DC`, `DC_STATE_FILE`, `DCArtboard`, `DCArtboardFrame`, `DCCtx`, `DCEditable`, `DCFocusOverlay`, `DCPostIt`, `DCSection`, `DCViewport`, `DesignCanvas` | 27 each | never port | Prototype design-canvas scaffolding; `COMPONENT_INDEX.md` explicitly marks these "do not port." Replaced by real XState + Storybook fixtures per the plan. |
| `Body` | 8 | stays app-local | Page-level content wrapper used inside pack-group stage tools (archive, build_package, etc.); PGDP-specific layout. |
| `Card` | 8 | stays app-local | Per-stage card atom used across pack-group tools; PGDP-specific. Distinct from the `Card` exported by pdomain-ui (that one is the generic tile). Do not shadow — use a stage-local name e.g. `StageCard`. |
| `Gate` | 8 | stays app-local | Confirmation gate banner (e.g. "validation passed before build"); PGDP-specific gate-chain UI. |
| `Seg` | 8 | stays app-local | Abbreviated segment/tab row used in pack-group tools; PGDP-specific. |
| `SetRow` | 8 | stays app-local | Settings row layout used inside stage settings panels; PGDP-specific. See also `FieldRow` in pdomain-ui (primitives) which may cover the generic case — evaluate per stage during Task F1a. |
| `Stat` | 8 | stays app-local | Summary statistic display (count, label, tone); PGDP-stage-specific. Evaluate against `StatTile` in pdomain-ui (primitives) — if `StatTile` covers the shape, prefer it. |
| `Toggle2` | 8 | stays app-local | Two-way toggle control appearing in pack-group settings panels; PGDP-specific. Evaluate against `Toggle` / `ToggleGroup` in pdomain-ui (primitives). |
| `Tree` | 6 | stays app-local | File-tree display used in archive/build_package/proof_pack/zip/submit_check/validation; PGDP-specific artefact-tree shape. |
| `Segmented` | 5 | reuse pdomain-ui | `Segmented` already exists in `@pdomain/pdomain-ui` (primitives). Verified in installed package (v0.2.2): `SegmentedProps`, `SegmentedSize`, `SegmentedOption` all exported. API: `options: SegmentedOption[]`, `value`, `onChange`, `size?: 'sm'\|'md'`. Import directly; no promotion needed. |
| `SettingRow` | 5 | stays app-local | Per-stage settings row (label + control) inside stage step-settings panels. Evaluate against pdomain-ui `FieldRow`; if the API matches, reuse. If not (PGDP slider/label shape diverges), keep app-local. |
| `SettingSlider` | 5 | stays app-local | Numeric slider control in stage step-settings panels; PGDP-specific range semantics. Evaluate against pdomain-ui `Progress` / any slider primitive; if no match, keep app-local. |
| `Check` | 3 | stays app-local | Checkbox control with PGDP-specific tone/label pairing used in submit_check/validation/build_package; evaluate against pdomain-ui `CheckIcon` + generic checkbox patterns. |

### 1.4 Promotion summary

**Task F1b reduces to: confirm reuse mappings + version bump; no new pdomain-ui
components needed.**

`Segmented` is already present in the installed `@pdomain/pdomain-ui` (v0.2.2,
confirmed via `dist/primitives.d.ts`). There are zero components to promote.
Task F1b's scope is: (1) verify the version pinned in `package.json` exposes
all reused components; (2) bump if the resolved version is below the minimum
that ships them; (3) confirm import paths in the stage-tool components.

Components confirmed present in pdomain-ui and reusable without change
(all verified in installed v0.2.2 unless noted):
`Icon` (icons subpath), `Button`, `Input`, `Badge`/`Chip`, `KeyCap`, `Separator`,
`StepDots`, `Segmented` (primitives — `SegmentedProps`/`SegmentedSize` exported),
`AppHeader`, `JobsPill`, `JobsDrawer`, `JobRow`,
`Breadcrumb`, `AppShell`, `PipelineTemplate`, `ConfigureHeader`.

Note on `TopNav` vs `AppHeader`: pdomain-ui exports **both** `TopNav` (a bare
layout wrapper for child content) **and** `AppHeader` (the full header shell
with icon, search, bell + unread, avatar slots). The design's `TopNav` maps to
`AppHeader`, not pdomain-ui's `TopNav`. See §1.1 (`TopNav` row) for the
explicit mapping.

---

## 2. Token reconciliation table

Every custom property in `design-system/tokens.css` is mapped to either an
existing pdomain-ui token (identical name in `pdomain-ui/theme/tokens.css`) or
flagged as a new addition needed in pdomain-ui.

The pdomain-ui `tokens.css` uses `:root` scope; the design tokens use `.pgd`
scope. At integration, the app wraps in `.pgd` + `data-theme` per the existing
pattern. Token names are identical across both files where values match.

| Design token | Status | pdomain-ui token | Notes |
|---|---|---|---|
| `--bg-page` | identical | `--bg-page` | Dark `#0c0c10`, light `#f6f4ef`. Exact match. |
| `--bg-surface` | identical | `--bg-surface` | Dark `#15151b`, light `#ffffff`. Exact match. |
| `--bg-raised` | identical | `--bg-raised` | Exact match. |
| `--bg-sunk` | identical | `--bg-sunk` | Exact match. |
| `--border-1` | identical | `--border-1` | Exact match. |
| `--border-2` | identical | `--border-2` | Exact match. |
| `--border-3` | identical | `--border-3` | Exact match. |
| `--ink-1` | identical | `--ink-1` | Exact match. |
| `--ink-2` | identical | `--ink-2` | Exact match. |
| `--ink-3` | identical | `--ink-3` | Exact match. |
| `--ink-4` | identical | `--ink-4` | Exact match. |
| `--accent` | identical | `--accent` | Exact match. |
| `--accent-ink` | identical | `--accent-ink` | Exact match. |
| `--exact` | identical | `--exact` | Exact match. |
| `--fuzzy` | identical | `--fuzzy` | Exact match. |
| `--mismatch` | identical | `--mismatch` | Exact match. |
| `--ocr` | identical | `--ocr` | Exact match. |
| `--gt` | identical | `--gt` | Exact match. |
| `--block` | identical | `--block` | Exact match. |
| `--para` | identical | `--para` | Exact match. |
| `--line` | identical | `--line` | Exact match. |
| `--word` | identical | `--word` | Exact match. |
| `--ui-font` | identical | `--ui-font` | Both `'Inter', system-ui, sans-serif`. |
| `--mono-font` | identical | `--mono-font` | Both `'JetBrains Mono', ui-monospace, monospace`. |
| `--shadow-floating` | identical | `--shadow-floating` | Dark: `0 3px 10px rgba(0,0,0,0.35)`. Exact match. |
| `--font-sans` | design-only alias | not needed | Back-compat alias for `--ui-font`; do not promote. Import `--ui-font` directly. |
| `--font-mono` | design-only alias | not needed | Back-compat alias for `--mono-font`; do not promote. |

**Tokens in pdomain-ui not in the design file (used by pdomain-ui components
and therefore available to this app at no cost):**

`--accent-subtle`, `--ocr-subtle`, `--exact-subtle` (translucent fills),
`--book-font`, spacing scale (`--space-1` … `--space-8`), radius scale
(`--radius-sm` … `--radius-pill`), type size scale (`--text-xs` … `--text-lg`),
transitions, shadow variants (`--shadow-sm`, `--shadow-dock`, `--shadow-overlay`,
`--shadow-card`), `--overlay-scrim`.

**Decision:** No new tokens need to be added to pdomain-ui. The design file
has 27 unique custom properties: 25 identical matches to existing pdomain-ui
tokens, plus 2 design-only back-compat aliases (`--font-sans`, `--font-mono`)
that are not promoted — use canonical names (`--ui-font`, `--mono-font`).

The app's `frontend/src/design/tokens.css` contains only the `.pgd` scoping
wrapper and `data-theme` overrides; it imports and defers to pdomain-ui's
`:root` token set.

---

## 3. Backend → book-tools dispositions

For each new or re-cut pipeline stage, this section records whether the
algorithm belongs in pdomain-book-tools (reusable by labeler-spa, pdomain-ocr-cli)
or is PGDP-specific and stays here.

| Stage | Algorithm disposition | Rationale |
|---|---|---|
| `denoise` | **propose pdomain-book-tools addition** | No denoise implementation exists in pdomain-book-tools today (confirmed: no `denoise` / `NlMeans` / `fastNlMeans` exports in `image_processing/`). A morphology-based or NlMeans denoise on binary scans is generic — pdomain-ocr-cli and the labeler would both benefit. Proposed addition: `image_processing.cv2_processing.denoise` module with `denoise_binary(image: np.ndarray, *, method: Literal["nlmeans","morph"] = "morph") -> np.ndarray`. Route to `pdomain-book-tools` agent before Task B2 consumes it. The thin `steps/denoise.py` in this repo calls the book-tools API. |
| `dewarp` | **use existing pdomain-book-tools API** | `TextlineDisparityDewarp` and `UVDocDewarp` both exist in `geometry_correction/backends/dewarp/`. The `GeometryPipeline` (default from `geometry_correction.defaults.scanned_pipeline` or `default_pipeline(with_dewarp=True)`) is the correct call site. Register via `geometry_correction.registry.get_dewarp`. The thin `steps/dewarp.py` here wraps the pipeline call; no new book-tools work needed. |
| `wordcheck` | **stays app-local** | Wordcheck (aka scannocheck) is about comparing OCR words against PGDP-specific word lists (project word lists, common scannos for the PGDP community). The logic depends on PGDP project-level word-list storage and promotion events (`WordlistPromotion`). pdomain-book-tools provides `Page.word_list()` and word-level iteration, but the list-management, flag-generation, and promotion events are PGDP-domain. Stays in `core/pipeline/steps/wordcheck.py`. |
| `hyphen_join` | **stays app-local** | End-of-line hyphen resolution requires knowledge of the PGDP text submission format (hyphens at page break vs. in-word), the project word list, and the `HyphenJoin` event semantics. `pgdp_results.py` in pdomain-book-tools has `split_hyphen_asterisk` (PGDP-format asterisk handling), but the decision/review loop and event model are PGDP-specific. Stays in `core/pipeline/steps/hyphen_join.py`. |
| `regex` (re-cut of `text_postprocess`) | **stays app-local** | The existing `text_postprocess.py` implements curly-quote normalization, em-dash conversion, and per-project scanno regex rules. These rules are project-configurable and PGDP-submission-specific. pdomain-book-tools exports `PGDPResults` which has some text normalization, but the per-project regex-rule engine is not generic. Stays in `core/pipeline/steps/regex.py` (re-keyed from `text_postprocess.py`). |
| `validation` (project-scoped) | **stays app-local** | Aggregates page-level flags from `wordcheck`, `text_review`, and `illustrations` into a PGDP submission blockers/warnings report. The PGDP submission rules (what constitutes a blocker vs. warning) are app-domain. Stays in `core/pipeline/steps/validation.py`. |

**Cross-repo recommendation — denoise:**

Target: pdomain-book-tools
Reason: A generic `denoise_binary` for scanned pages belongs in book-tools so
pdomain-ocr-cli and labeler-spa can reuse it.

```
gh issue create -R ConcaveTrillion/pdomain-book-tools \
  -l kind:feature-request -l status:backlog \
  --title "Add denoise_binary to image_processing.cv2_processing" \
  --body "Tracks: (none yet)\nContext: Discovered while working on pdomain-prep-for-pgdp statechart convergence (Task 0.4 library placement).\n\nProposed addition: \`image_processing.cv2_processing.denoise\` module with \`denoise_binary(image: np.ndarray, *, method: Literal[\"nlmeans\",\"morph\"] = \"morph\") -> np.ndarray\`. Reusable by pdomain-ocr-cli and pdomain-ocr-labeler-spa. Prep-for-pgdp Task B2 (denoise stage) is the first consumer."
```

---

## 4. Backend → ops dispositions

### 4.1 Event store

**Current state:** The repo already uses pdomain-ops eventsourcing. The
`build_page_service` factory (`core/page_store_factory.py`) creates a
`PagesApplication` (eventsourcing library backed by per-project SQLite
`events.db`) using `pdomain_ops.page_aggregate.PagesApplication` and
`pdomain_ops.page_server.LocalPageStore`. The `BlobStore` is also from
`pdomain_ops.blob_store`. This is the event store; it is already adopted.

**Direction from stage-registry-v2.md §5.3:** New v2 event types are appended
to a new `PrepProjectAggregate` in this repo (`src/pdomain_prep_for_pgdp/core/pipeline/prep_aggregate.py`),
not on `pdomain_ops.page_aggregate.ProjectAggregate`. The eventsourcing library
routes by aggregate UUID so both coexist in `events.db`.

**Decision: wrap pdomain-ops eventsourcing aggregates for the existing
page-model events; add a new app-local `PrepProjectAggregate` for v2
pipeline events.**

Rationale: The existing page-model events (`ImageIngested`, `OcrCompleted`,
`PageAdded`, etc.) remain on `ProjectAggregate` as today — changing that would
break the event log for any existing project. The ten new v2 event types
(`StageRunStarted`, `StageRunCompleted`, `StageRunFailed`, `StageForcedStale`,
`ReviewDecision`, `PageReorder`, `GateConfirmation`, `SettingsChange`,
`WordlistPromotion`, `SplitFanout`) belong on `PrepProjectAggregate` because
they are PGDP-pipeline-domain events, not generic page-record events that
pdomain-ops should own.

D5 traceability is satisfied: every state-changing action appends an event to
the eventsourcing store; `pgdp-prep reindex` reads both aggregates.

The `PrepProjectAggregate` is not promoted to pdomain-ops. It is
PGDP-domain logic with PGDP-specific event vocabulary that other pdomain-*
apps would not reuse.

### 4.2 Stage execution dispatch

**Current state:** The repo has its own `IDispatcher` Protocol
(`dispatcher/base.py`) with `BatchDispatcher` and `ImmediateDispatcher`
implementations. The `adapters/gpu/__init__.py` is already a shim that
re-exports from `pdomain_ops.gpu` (confirmed: `GPUBackend`, `BatchJobItem`,
`BatchJobResult`, `OcrPageRequest`, `OcrPageResponse`, `ProcessPageRequest`,
`ProcessPageResponse`). The shim comment explicitly states the dispatcher files
are pending migration to `pdomain_ops.gpu`.

**pdomain-ops protocols:** `StageDispatcher` (`run_stage`, `run_ocr_batch`)
and `LongJobRunner` (`submit`, `status`, `cancel`, `stream_events`) exist in
`pdomain_ops.gpu.protocols`.

**Decision: migrate in-repo `IDispatcher` to pdomain-ops `StageDispatcher`
for GPU/OCR stage dispatch; use `LongJobRunner` for long-running project-scoped
stages (proof_pack, build_package, zip, archive).**

Rationale:

1. The GPU adapter shim already imports from `pdomain_ops.gpu`; the migration
   is already started and intended by the shim's own comment.
2. `StageDispatcher.run_stage(stage_id, page_id, **kwargs)` maps directly to
   the per-stage dispatch pattern in Task B2–B4.
3. `LongJobRunner` covers the project-scoped tail stages that are long-running
   (proof_pack, build_package, zip, archive) and need job-level status +
   cancellation — the current `InProcessJobRunner` does not expose SSE-safe
   streaming; `LongJobRunner.stream_events` fills that gap.
4. The in-repo `IDispatcher.submit` / `flush` / `run_forever` pattern (for
   Modal batching) is a thin wrapper; it can be expressed as an `IDispatcher`
   → `StageDispatcher` adapter so both continue to work during transition.

**Scope of migration:** Complete the migration of `dispatcher/` to
`pdomain_ops.gpu.StageDispatcher` in Task B1 (as part of the stage runner
re-cut). Long-running tail stages (B4) adopt `LongJobRunner`. The in-repo
`adapters/gpu/__init__.py` shim is removed once all callers are updated.

---

## 5. Open items

None blocking Phase 0. All decisions are explicit.

### Placement flags from `stage-registry-v2.md` §7 — all resolved

`stage-registry-v2.md` §7 raised three placement flags for Task 0.4 to decide:

1. **`denoise` algorithm** — resolved: **propose pdomain-book-tools addition**.
   `denoise_binary` is generic (reusable by pdomain-ocr-cli + labeler-spa) and
   belongs in `image_processing.cv2_processing.denoise`. Cross-repo
   recommendation issued (§3). This repo's `steps/denoise.py` calls the
   book-tools API; no PGDP-specific logic in the algorithm.

2. **`wordcheck` / `hyphen_join` text logic** — resolved: **both stay
   app-local**. Both depend on PGDP project word lists, `WordlistPromotion`
   events, and PGDP submission format semantics. pdomain-book-tools provides
   `Page.word_list()` and word iteration but does not own the list-management
   or decision loops. See §3 for full rationale.

3. **`PrepProjectAggregate` eventsourcing aggregate** — resolved: **app-local**
   (`src/pdomain_prep_for_pgdp/core/pipeline/prep_aggregate.py`, new in B1).
   The ten v2 event types are PGDP-pipeline-domain; pdomain-ops owns the
   eventsourcing library and generic page-record events but not PGDP-specific
   pipeline events. See §4.1 for full rationale.

### Downstream task dependencies from this contract

- Task F1b (`pdomain-ui` agent): **confirm reuse mappings + version bump only;
  no new pdomain-ui components needed** (see §1.4).
- Task B2 (denoise stage): route to `pdomain-book-tools` agent for
  `denoise_binary` addition **before** wiring the step wrapper.
- Task B1 (registry + DAG core): implement `PrepProjectAggregate`
  (`src/pdomain_prep_for_pgdp/core/pipeline/prep_aggregate.py`);
  migrate `IDispatcher` to wrap `StageDispatcher`.
- Task B4 (tail stages): adopt `LongJobRunner` for proof_pack, build_package,
  zip, archive.
