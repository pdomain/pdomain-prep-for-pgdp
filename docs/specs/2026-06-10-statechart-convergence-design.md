# Statechart convergence — design

**Date:** 2026-06-10
**Status:** Approved (CT, 2026-06-10)
**Design package:** `docs/plans/design_handoff_pgdp_app/` (canvases, statecharts, design system)
**Supersedes:** the greenfield framing of `docs/plans/design_handoff_pgdp_app/PROMPT.md`
(rewritten same day as a convergence brief)

## 1. Goal

Converge the working app onto the design package:

- Backend re-cut to the design's **24 user-facing pipeline stages** (1:1, replacing
  the current 22 micro-stage registry).
- Frontend rebuilt on **XState v5** implementing all 28 statechart machines, with
  surfaces recreated from the high-fidelity `final/` canvases.
- Generic UI promoted into **pdomain-ui**; stage tools stay app-local.
- The **event-sourced historized data model is preserved and extended** — every
  state-changing action is an appended event; all changes remain traceable.

Pre-1.0 **breaking change**: no data migration. Registry version is stamped per
project; old projects must be re-ingested and re-run.

## 2. Current state (what we converge from)

- **Backend:** FastAPI, 22-stage per-page DAG with dirty propagation,
  splits-as-sibling-pages, dual-write contract (artifact + `page_stages` row +
  event log), SSE per-page stage events. Shipped through pipeline-task-model M6.
- **Frontend:** React 19 + Vite + TS, 9 routes, TanStack Query (server cache) +
  Zustand (theme), Konva canvas, OpenAPI-generated types, SSE hooks, word-delete
  undo buffer. **No XState.** UI is a linear stage rail + generic artifact viewer;
  far short of the design's per-stage tools and projects detail surfaces.
- **Gap:** ~8 design stages have no backend counterpart (page_order, wordcheck,
  hyphen_join, validation, proof_pack, zip, submit_check, archive — only
  `build_package` exists for the tail). The design decomposes image prep
  differently (denoise/dewarp exist; invert/morph_fill/rescale don't surface).

## 3. Decisions (locked in brainstorm, 2026-06-10)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Scope | Full convergence — backend re-cut + frontend rebuild |
| D2 | Stage model | Re-cut backend registry to the design's 24 stages, 1:1 |
| D3 | Existing data | Breaking change; no migration; re-ingest old projects |
| D4 | Frontend landing | Rebuild surfaces, reuse plumbing; promote generic UI into pdomain-ui |
| D5 | Data model | Event-driven historized model kept and extended (traceability is a requirement) |
| D6 | Build order | Contract-first: short Phase 0 freezes contracts, then parallel backend + frontend tracks |

## 4. Backend re-cut (stage registry v2)

### 4.1 The 24 stages

Design order (launcher groups in parentheses):

1. `source` (Source) — import/ingest; **project-scoped**
2. `grayscale` (Image prep)
3. `crop` (Image prep)
4. `threshold` (Image prep)
5. `deskew` (Image prep)
6. `denoise` (Image prep) — **new**
7. `dewarp` (Image prep) — **new**
8. `post_transform_crop` (Image prep)
9. `post_ocr_crop` (Image prep)
10. `text_zones` (OCR) — page-layout zones; owns `APPLY_SPLIT` page-set mutation
11. `ocr` (OCR)
12. `page_order` (Compose) — **new**; **project-scoped**
13. `wordcheck` (Text) — **new** (design alias: scannocheck)
14. `canvas_map` (Compose)
15. `hyphen_join` (Text) — **new**
16. `text_review` (Text)
17. `illustrations` (Compose)
18. `regex` (Text) — re-cut of `text_postprocess`
19. `validation` (Pack) — **new**; **project-scoped**
20. `proof_pack` (Pack) — **new**; **project-scoped**
21. `build_package` (Pack) — **project-scoped** (exists)
22. `zip` (Pack) — **new**; **project-scoped**
23. `submit_check` (Pack) — **new**; **project-scoped**
24. `archive` (Pack) — **new**; **project-scoped**

Exact ordering, per-stage inputs/outputs, and page- vs project-scope per stage are
frozen in the Phase 0 registry contract; the statecharts' Stage → machine map
(`statecharts/README.md`) is the authoritative lookup.

### 4.2 Micro-stage folding

Old micro-stages survive as **internal steps** of the new stages — execution code
is reused, not rewritten:

- `crop` = initial_crop + find_content_edges + crop_to_content
- `threshold` = threshold + invert
- `deskew` = manual_deskew_pre + auto_deskew
- `canvas_map` absorbs morph_fill + rescale + proofing-image synthesis
- `source` absorbs ingest_source + thumbnail + auto_detect_attrs + decode_source
- `illustrations` absorbs auto_detect_illustrations + extract_illustrations

The registry, `page_stages` rows, artifact directories, and the dirty-propagation
graph are re-keyed to the new stage IDs.

### 4.3 Two stage scopes

- **Page-scoped** (grayscale … text_review, illustrations, regex, wordcheck,
  hyphen_join, text_zones, ocr, canvas_map): per-page rows as today.
- **Project-scoped** (source, page_order, validation, proof_pack, build_package,
  zip, submit_check, archive): new `project_stages` state, same dual-write +
  event contract. A project-scoped stage's status may still be a projection over
  page facts (e.g. validation aggregates page flags).

Dirty propagation spans both scopes: re-running any stage marks all downstream
stages stale (page- and project-scoped alike); the validation → build → zip →
submit_check chain is invalidated by any upstream change.

### 4.4 Event model (D5)

- The existing event store remains the system of record. Vocabulary extends to:
  new stage IDs, review decisions, reorder operations, gate confirmations
  (two-step delete, submit confirm), settings changes (with before/after),
  word-list promotions, split fan-out.
- Every stage write remains a transaction across artifact + stage-state row +
  event log (dual-write contract, unchanged).
- `pgdp-prep reindex` remains the source-of-truth arbiter and is updated for the
  v2 registry.
- Registry version is stamped per project at creation; API returns a structured
  "re-ingest required" error on version mismatch.

## 5. Frontend architecture

### 5.1 State management split (pinned)

- **XState v5** owns interaction and orchestration state, exactly per the
  statechart YAMLs (mechanical mapping per the porting guide in
  `statecharts/README.md`).
- **TanStack Query** remains the server cache for fetched data.
- Existing SSE hooks are wrapped as **XState actors** translating server pushes
  into `STAGE_PUSH` / `STATUS_PUSH` machine events (server-authoritative status;
  optimistic intents reconciled by push).
- Derived data stays derived: page labels, dot colors, counts, badge tones are
  projections, never stored state.

### 5.2 Machines

All 28 machines implemented from the YAMLs. Shared machines are **one definition
each**, instantiated with `input: { stageId, … }`:

- `stageRunner` ×23 (spawned by `pipelineShell`; dots are projections, no
  per-dot machine)
- `imageStageReview` ×7 (threshold, deskew, denoise, dewarp, post_transform_crop,
  post_ocr_crop, canvas_map)
- `pageWorkbench` ×12 (per-stage control schemas are `WB_MAP` data)

Unit tests required for the named invariants: two-step delete (archive vs
permanent), staleness fan-out, validation→build→zip→submit gate chain,
`textZonesTool.APPLY_SPLIT` page-set mutation.

### 5.3 Surfaces

Rebuilt per the `final/` canvases; an old route is deleted when its replacement
lands. Reused plumbing: OpenAPI client + generated types, SSE hooks, Konva
canvas components (PageImageCanvas-family), word-delete undo buffer. Every
`DCArtboard` becomes a Storybook story or test fixture. Prototype scaffolding
(`DesignCanvas`, `*-data.js`, Babel/window-sharing, `FakeThumb`) is never ported.

## 6. Library placement (D4, broadened 2026-06-10)

Every task must ask "does this belong upstream?" before implementing in-repo.
Placement targets and default dispositions:

- **pdomain-book-tools** — image/OCR/text primitives. Candidates here: denoise
  and dewarp implementations (book-tools ships textline dewarp), hyphen-join
  and wordcheck text logic if labeler/CLI could reuse them.
- **pdomain-ops** — suite plumbing, eventsourcing aggregates
  (PageRecord/BlobStore shipped in ops v0.6.0), StageDispatcher/LongJobRunner
  protocols. The event-store work converges on ops machinery where it fits
  rather than growing a parallel implementation.
- **pdomain-ui** — shared frontend kit (tokens, atoms, chrome, hooks; possibly
  generic XState machine patterns if a second SPA would reuse them).
- **Stays here** — PGDP-specific pipeline logic, stage tools, app surfaces.

Phase 0 produces the placement contract (per-component disposition); a task
that discovers a placement candidate mid-flight flags it rather than silently
implementing locally.

### 6.1 pdomain-ui promotion (D4)

- Design `tokens.css` reconciles into pdomain-ui's token set; no new token where
  an equivalent exists; app keeps zero hard-coded colors/spacing.
- Generic atoms/chrome promote to pdomain-ui. Candidates: KeyCap, Segmented,
  StepDots, JobsDrawer/JobsPill, Badge tone extensions. The definitive list is a
  Phase 0 deliverable: diff `design-system/ui-base.jsx` + `template.jsx` against
  pdomain-ui's current exports.
- Development uses local-dev linked mode (`make local-dev`); pdomain-ui releases
  are cut before each integration checkpoint that consumes them.

## 7. Plan shape (D6 — contract-first tracks)

- **Phase 0 (sequential, small):** freeze contracts — 24-stage registry table
  (scope, inputs/outputs, folded micro-stages, event types per stage), OpenAPI
  route/schema deltas, machine ↔ stage map confirmation, pdomain-ui promotion
  list, mock fixtures for not-yet-built backend.
- **Track B (backend, parallel by group):** registry + DAG core and event
  vocabulary; image-prep stage re-cut; OCR/text stages; new tail stages;
  project-scoped plumbing + routes + SSE.
- **Track F (frontend, parallel):** design system + pdomain-ui promotion; shared
  machines + invariant tests; projects shells; pipeline shell; stage tools
  batched by the six launcher groups (Source / Image prep / OCR / Compose /
  Text / Pack).
- **Integration:** per stage group, frontend flips mock → real. Final e2e covers
  create → import → run all → resolve flags → validate → build → zip →
  submit-check → archive. `IMPLEMENTATION_NOTES.md` records divergences from the
  designs with reasons.

Detailed task decomposition lives in the implementation plan (written next via
writing-plans; sized for parallel subagents).

## 8. Testing

- **Machine unit tests** for every statechart invariant named in §5.2.
- **Backend stage tests** per group: TDD for pure functions; integration-shaped
  tests on synthetic inputs for cv2/pdomain-book-tools stages (existing pattern).
- **Event-model tests:** every mutating route appends the expected event(s);
  reindex reproduces state from events + artifacts.
- **SPA serving contract tests** (`test_spa_fallback.py`) stay green throughout.
- **Storybook/fixtures:** one per `DCArtboard` state.
- **E2e (Playwright):** the full pipeline walk on mock/cpu backend, plus the
  two-step delete and staleness fan-out flows.

## 9. Risks

| Risk | Mitigation |
|------|------------|
| Contract drift between parallel tracks | Phase 0 contracts are frozen artifacts; changes require a contract PR touching both tracks; per-group integration checkpoints catch drift early |
| XState ↔ TanStack Query interplay invents ad-hoc patterns | The split in §5.1 is pinned; first shared-machine task (Track F) establishes the canonical wiring, reviewed before fan-out |
| Breaking change surprises a user mid-project | Registry version check at startup/API with explicit "re-ingest required" error; release notes |
| Canvas/statechart contradictions | Statecharts win on behavior, canvases on appearance; contradictions are flagged in `IMPLEMENTATION_NOTES.md`, never silently resolved |
| pdomain-ui release sequencing stalls app work | Local-dev linked mode during development; releases only at integration checkpoints |
