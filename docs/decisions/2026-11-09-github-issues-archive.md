<!-- docgraph: ignore -->
<!-- markdownlint-disable-file -->
# pdomain-prep-for-pgdp GitHub issues archive (2026-11-09)

Verbatim export of all 179 issues on `pdomain/pdomain-prep-for-pgdp`, open and closed, with comments. Bodies are unedited and may be stale. See `docs/decisions/2026-11-09-github-issues-cutover.md`.

## #1 Tighten requires-python upper bound to <3.14 until regex ships stable wheels

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB0zNbg`
- Author: ConcaveTrillion
- Created: 2026-05-11T01:20:53Z
- Closed: 2026-05-14T09:46:30Z
- Labels: bot:ship-issue-ready, effort:S, kind:chore, model-effort:low, model:haiku, status:in-pr
- Milestone: none

### Body

~~~~~~~~text
## Problem

`requires-python = ">=3.13,<4.0"` allows uv to select Python 3.14 (currently pre-release/alpha). Transitive dependency `regex` (via `pd-book-tools`) does not yet ship pre-built wheels for 3.14, so uv falls back to a source build. On Windows that fails without MSVC Build Tools.

## Fix

Change to `requires-python = ">=3.13,<3.14"`. Revert to `<4.0` once Python 3.14 is stable and `regex` publishes matching wheels.

Tracked upstream: https://github.com/ConcaveTrillion/pd-book-tools/issues/23
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-13T17:32:50Z

~~~~~~~~text
Claimed by ship-issue-0.

- Model: `haiku` / effort: `low`
- Spec: `(none)`
- Pre-claim SHA: `aaefc96c53d6325017d034dd71b95ff442e2af31`

Acceptance:
(none)
~~~~~~~~

## #2 Use oxipng (via pyoxipng) for PNG optimization in the pipeline

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB0z6hg`
- Author: ConcaveTrillion
- Created: 2026-05-11T01:24:17Z
- Closed: 2026-05-14T23:16:14Z
- Labels: bot:ship-issue-ready, effort:M, kind:feature, model-effort:medium, model:sonnet, status:in-pr
- Milestone: none

### Body

~~~~~~~~text
## Decision

Use `pyoxipng` (Python bindings for the oxipng Rust crate) for lossless PNG optimization in the output pipeline rather than `pd-png-optimizer`.

`pd-png-optimizer` is a custom Rust/PyO3 optimizer with scanned-book-specific heuristics, but it is not yet production-ready and has no benchmarks. `oxipng` is battle-tested, widely used, and available as a library via `pyoxipng` — no subprocess overhead.

## What to do

- Add `pyoxipng` to `pyproject.toml` dependencies.
- Wire an optimization pass into the pipeline after page images are finalized (before they are written into the output zip/folder).
- Default optimization level: `oxipng -o4` equivalent (`level=4` in pyoxipng).
- Make it optional / skippable via a job config flag for speed during dev.

## Future

`pd-png-optimizer` is being kept as a future research project (scanned-book-specific filter heuristics + GPU-accelerated DEFLATE). If it matures and benchmarks show a win over oxipng for this corpus, swap it back in. For now, oxipng is the pragmatic choice.

Blocked-by: #106

Blocked-by: #107
~~~~~~~~

## #4 Build: pyproject force-include of static/ fails when Vite build hasn't run

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB3JIGg`
- Author: ConcaveTrillion
- Created: 2026-05-11T10:08:44Z
- Closed: 2026-05-11T10:33:34Z
- Labels: effort:S, kind:bug, status:backlog
- Milestone: none

### Body

~~~~~~~~text
## Summary

`uv sync` fails in CI with:

```
FileNotFoundError: Forced include not found:
.../src/pd_prep_for_pgdp/static
```

## Root cause

`pyproject.toml` declares `src/pd_prep_for_pgdp/static` as a forced wheel include, but the directory is .gitignored (Vite build output). On a fresh checkout (CI runner), the directory doesn't exist until `npm run build` (frontend) has produced it, but `uv sync` runs first and bails.

## Repro

```bash
git clone fresh && cd pd-prep-for-pgdp && uv sync
```

## Suggested fix paths

1. Make the force-include conditional (only when `static/` exists); or
2. Add a placeholder `static/.gitkeep` to the repo; or
3. Reorder CI to build frontend before `uv sync`; or
4. Drop the force-include and ship static/ via a separate manifest.

CT to triage which path.

## Surfaced by

PR #3 (`chore/lint-first-selectors`) — pre-existing build-config issue.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-11T10:33:33Z

~~~~~~~~text
Fixed by adding `src/pd_prep_for_pgdp/static/.gitkeep` in PR #3. The .gitignore already had the exception (`!static/.gitkeep`) in place; the placeholder file was simply missing. Force-include now resolves on fresh clones. Three additional CI issues were discovered and fixed in the same PR: e2e tests not excluded from CI pytest run, tesseract-dependent test lacking a skip guard, and CUDA teardown segfault from cupy on CPU-only runners.
~~~~~~~~

## #5 Pipeline: bounded deferred-write executor (Q8)

- State: CLOSED (NOT_PLANNED)
- Node ID: `I_kwDOSUyCB88AAAABB7GbEg`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:26:38Z
- Closed: 2026-05-12T00:12:28Z
- Labels: effort:M, kind:feature, model-effort:medium, model:sonnet, status:backlog
- Milestone: none

### Body

~~~~~~~~text
Implement the bounded deferred-write executor from the pipeline task-model spec (Q8).

**Spec:** `docs/specs/pipeline-task-model.md` §"Open questions — Locked (2026-05-07)" Q8
**Roadmap:** `docs/08-roadmap.md` §M2 "Queued for M2 follow-up slices"

## Context

Today all stage writes go through synchronously. The bounded queue lets a
"Run all dirty stages" fan-out limit how many writes pile up at once. Knobs:
`PGDP_STAGE_WRITE_POOL_SIZE` and `PGDP_STAGE_WRITE_QUEUE_CAP`.

## Acceptance

- Both env knobs are documented in README / Settings.
- Dual-write reconciler routes through the bounded queue instead of writing synchronously.
- A fan-out of N dirty stages does not enqueue more than `PGDP_STAGE_WRITE_QUEUE_CAP` writes simultaneously.
- Existing stage-runner integration tests pass unchanged.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:12:28Z

~~~~~~~~text
Superseded by #60 (Pipeline: bounded deferred-write executor — Q8/Q9 lock), filed as a kind:chore child of milestone `spec: pipeline-task-model-granular-per-page (#47)` via /decompose-spec on 2026-05-11.
~~~~~~~~

## #6 Pipeline: ResolvedPageConfig plumbing into stage runner

- State: CLOSED (NOT_PLANNED)
- Node ID: `I_kwDOSUyCB88AAAABB7Gc6Q`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:26:44Z
- Closed: 2026-05-12T00:12:29Z
- Labels: effort:M, kind:feature, model-effort:medium, model:sonnet, status:backlog
- Milestone: none

### Body

~~~~~~~~text
Plumb `ResolvedPageConfig` into the stage runner so config-aware stages read per-page config.

**Spec:** `docs/specs/pipeline-task-model.md`
**Roadmap:** `docs/08-roadmap.md` §M2 "Queued for M2 follow-up slices"

## Context

Three stages currently take no-op / default branches because the runner does not
pass config: `initial_crop` (should call real `crop_edges`), `manual_deskew_pre`
(should call `rotate_image` when angle is set), `threshold` (should respect manual
override). The M3 stage-controls panel needs this plumbing to be useful.

## Acceptance

- `initial_crop` calls the real `crop_edges` path (not the no-op default branch).
- `manual_deskew_pre` calls `rotate_image` when a manual angle is configured.
- `threshold` respects the manual override when set in `ResolvedPageConfig`.
- End-to-end chain test (ingest_source → canvas_map) still passes.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:12:29Z

~~~~~~~~text
Superseded by #61 (Pipeline: ResolvedPageConfig plumbing into stage runner), filed as a kind:chore child of milestone `spec: pipeline-task-model-granular-per-page (#47)` via /decompose-spec on 2026-05-11.
~~~~~~~~

## #7 Pipeline: optional ?async=true flag on stage run route

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB7Gfew`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:26:49Z
- Closed: 2026-05-12T00:12:31Z
- Labels: effort:S, kind:feature, model-effort:low, model:sonnet, status:backlog
- Milestone: none

### Body

~~~~~~~~text
Add `?async=true` query flag to `POST /api/data/projects/{id}/pages/{idx0}/stages/{stage_id}/run`.

**Spec:** `docs/specs/pipeline-task-model.md` §"API surface"
**Roadmap:** `docs/08-roadmap.md` §M2 "Queued for M2 follow-up slices"

## Context

Slow stages (`ocr`, `extract_illustrations`) now have real implementations. The
synchronous route times out for DocTR on large pages. The async flag returns a Job
ID immediately and runs the stage in the background.

## Acceptance

- Without flag: synchronous response, existing behavior unchanged.
- With `?async=true`: returns `{"job_id": "<uuid>"}` with HTTP 202; stage runs in background.
- Job status queryable via existing jobs endpoint.
- `ocr` chip in the workbench rail triggers the async path automatically when
  `?async=true` is wired into the frontend click handler.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:12:30Z

~~~~~~~~text
Shipped in M2 Slice 15 (commit `5abc7c9` — async run route + list-jobs endpoint). Closing as done.
~~~~~~~~

## #8 Pipeline: real impls for blank_proof_synth and auto_detect_attrs stages

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB7GjbQ`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:26:59Z
- Closed: 2026-05-12T00:12:32Z
- Labels: effort:S, kind:feature, model-effort:medium, model:sonnet, status:backlog
- Milestone: none

### Body

~~~~~~~~text
Implement the two remaining CPU placeholder stages that currently raise `StageNotImplemented`.

**Spec:** `docs/specs/pipeline-task-model.md` §"Stage registry"
**Roadmap:** `docs/08-roadmap.md` §M2 "Carry-forwards into M3 / next M2 slice"

## Stages

- **`blank_proof_synth`**: synthesise a blank proof page — white canvas at `canvas_map`
  dimensions (read from `canvas_map` artifact metadata or reconstruct from image shape).
  Output: PNG.
- **`auto_detect_attrs`**: detect page attributes from the `canvas_map` PNG (e.g.
  illustration-heavy, text-only, mixed). Output: JSON dict of detected attributes.
  Acceptable to return `{}` as a graceful stub if no detector is available,
  similar to `auto_detect_illustrations`.

## Acceptance

- Both stages transition `not-run → clean` when clicked in the chip rail.
- Artifacts appear at `pages/<id>/stages/<stage_id>/output.<ext>`.
- 21 of 22 stages have real CPU impls; only `extract_illustrations` remains deferred to M3.
- Existing end-to-end chain test (ingest_source → canvas_map) still passes.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:12:32Z

~~~~~~~~text
Real impls for blank_proof_synth and auto_detect_attrs shipped in M2 Slice 12 (commit `2a62346`). Closing as done. (The companion page-type short-circuit / not-applicable marking is now tracked under #58 as a separate concern.)
~~~~~~~~

## #9 M3: workbench artifact viewer + stage controls panel

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB7G4NQ`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:27:51Z
- Closed: 2026-05-15T09:16:25Z
- Labels: kind:feature-request, status:backlog, triage:approved
- Milestone: none

### Body

~~~~~~~~text
M3 (workbench artifact viewer + stage controls panel) needs design before implementation.

Roadmap: `docs/08-roadmap.md` §M3.

Spec: docs/specs/2026-05-11-workbench-artifact-viewer-design.md
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-11T21:45:54Z

~~~~~~~~text
Demoted to `kind:feature-request` on 2026-05-11.

This issue skipped the spec pipeline: no `/triage`, no spec file under `docs/specs/`, and its hand-rolled milestone children (#24, #25, #26, #27, #28) are `kind:feature` rather than `/decompose-spec` output (which produces `kind:chore`).

Re-entering the pipeline via `/triage` → `/spec-from-issue` → `/decompose-spec`. Premature design content (Scope to specify, Open questions to resolve in spec) stripped so `/triage` can re-derive without bias. Existing milestone children remain open and will be reconciled (close-superseded) once new pipeline products land.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-11T21:47:00Z

~~~~~~~~text
Triage forked child #44 (`kind:spec, effort:L, status:backlog`).
~~~~~~~~

### Comment 3 by ConcaveTrillion at 2026-05-11T21:47:03Z

~~~~~~~~text
Triage decision: approved + needs-spec. Spec child issue: #44. Run `/spec-from-issue 44` to write the design spec.
~~~~~~~~

### Comment 4 by ConcaveTrillion at 2026-05-12T23:05:13Z

~~~~~~~~text
Spec work completed via child issue #44 (9-section spec at `docs/specs/2026-05-11-workbench-artifact-viewer-design.md`, merged in PR #49). Closing parent as complete.
~~~~~~~~

### Comment 5 by ConcaveTrillion at 2026-05-12T23:06:25Z

~~~~~~~~text
Reopening — spec is complete but M3 implementation is not yet shipped.
~~~~~~~~

### Comment 6 by ConcaveTrillion at 2026-05-15T09:16:24Z

~~~~~~~~text
M3 scope fully delivered: polished StageChainRail with thumbnails (#83), side-by-side ArtifactViewer (#84), and StageControlsPanel with stage-filtered config fields — all wired in PageWorkbenchPage (commit e8e5254 + prior). SSE per-stage transitions live in StageChainRail. M3 pass criterion met.
~~~~~~~~

## #10 M4: lazy migration of existing projects + disk-cost UI

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB7G58Q`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:27:55Z
- Closed: 2026-05-13T10:51:02Z
- Labels: effort:M, kind:spec, model-effort:medium, model:sonnet, status:backlog
- Milestone: none

### Body

~~~~~~~~text
Design M4: lazy-migrate pre-M1 projects on first access, CLI force-rebuild path,
and disk-cost callout in the project header banner.

**Spec-file:** `docs/specs/pipeline-m4-migration.md` (to be written)
**Roadmap:** `docs/08-roadmap.md` §M4

## Scope to specify

- Lazy-migrate on first access: synthesise `page_stages` rows from legacy
  `processing_status`; mark every applicable stage `dirty`.
- `pgdp-prep migrate-projects --force-rebuild` CLI: clear `page_stages` rows
  and on-disk stage artifacts for a project; leave source images and thumbnails.
- Disk-cost callout in project header: "Stage artifacts for this project: X GB /
  ~Y GB estimated full-DAG. Reclaim space?" with placeholder click-through.

## Open questions to resolve in spec

- What `processing_status` values map to which stages being pre-marked `dirty`?
- How to estimate "full-DAG" disk cost without running all stages?
- Should `--force-rebuild` be scoped per-project or per-page?

Spec: docs/specs/2026-05-13-m4-migration-disk-cost-design.md
~~~~~~~~

## #11 M5: project-level fan-out + awaiting_review gate

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB7G7Og`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:27:59Z
- Closed: 2026-05-15T10:38:16Z
- Labels: kind:feature-request, status:backlog, triage:approved
- Milestone: none

### Body

~~~~~~~~text
M5 (project-level fan-out + `awaiting_review` gate) needs design before implementation.

Roadmap: `docs/08-roadmap.md` §M5.

Spec: docs/specs/2026-05-11-project-fanout-awaiting-review-design.md
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-11T21:45:57Z

~~~~~~~~text
Demoted to `kind:feature-request` on 2026-05-11.

This issue skipped the spec pipeline: no `/triage`, no spec file under `docs/specs/`, and its hand-rolled milestone children (#30, #31, #32, #33, #36) are `kind:feature` rather than `/decompose-spec` output (which produces `kind:chore`).

Re-entering the pipeline via `/triage` → `/spec-from-issue` → `/decompose-spec`. Premature design content (Scope to specify, Open questions to resolve in spec) stripped so `/triage` can re-derive without bias. Existing milestone children remain open and will be reconciled (close-superseded) once new pipeline products land.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-11T21:47:15Z

~~~~~~~~text
Triage forked child #45 (`kind:spec, effort:L, status:backlog`).
~~~~~~~~

### Comment 3 by ConcaveTrillion at 2026-05-11T21:47:18Z

~~~~~~~~text
Triage decision: approved + needs-spec. Spec child issue: #45. Run `/spec-from-issue 45` to write the design spec.
~~~~~~~~

### Comment 4 by ConcaveTrillion at 2026-05-12T23:05:40Z

~~~~~~~~text
Spec work completed via child issue #45 (9-section spec at `docs/specs/2026-05-11-project-fanout-awaiting-review-design.md`, merged in PR #50). Closing parent as complete.
~~~~~~~~

### Comment 5 by ConcaveTrillion at 2026-05-12T23:06:27Z

~~~~~~~~text
Reopening — spec is complete but M5 implementation is not yet shipped.
~~~~~~~~

### Comment 6 by ConcaveTrillion at 2026-05-15T10:38:15Z

~~~~~~~~text
M5 shipped: run-dirty fan-out, awaiting_review gate, auto-resume all merged. CI green.
~~~~~~~~

## #12 Word-delete editor: undo/soft-delete strategy (P1 #9a follow-up)

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB7G_nQ`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:28:11Z
- Closed: 2026-05-13T10:51:05Z
- Labels: effort:S, kind:spec, model-effort:medium, model:sonnet, status:backlog
- Milestone: none

### Body

~~~~~~~~text
Decide and specify the undo strategy for the word-delete editor.

**Spec-file:** `docs/specs/word-delete-undo-strategy.md` (to be written)
**Roadmap:** `docs/08-roadmap.md` §P1 "9a-followup"

## Context

The v1 endpoint hard-rewrites `<root>.words.json` + `<root>.txt`, so honest
single-level undo needs a decision between:

- **(a) Server-side soft-delete:** `OcrWord.deleted: bool` flag with flip-restore
  endpoint; `remaining_words` filtered to non-deleted rows.
- **(b) Client-side debounced commit:** five-second Undo banner that only fires
  the DELETE after dismissal; no server schema change.

## Spec must decide

- Which strategy (a) or (b)?
- Wire contract changes if (a): new `deleted` field on `OcrWord`, new
  `PATCH /api/data/.../words/{id}/restore` endpoint.
- UX spec if (b): Undo banner duration, keyboard shortcut (Ctrl+Z?), what
  happens on navigation away during the window.

Spec: docs/specs/2026-05-13-word-delete-undo-design.md
~~~~~~~~

## #13 Konva rotate/flip handles for workbench canvas (P2 #10)

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB7HAhA`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:28:12Z
- Closed: 2026-05-13T10:51:08Z
- Labels: effort:M, kind:spec, model-effort:medium, model:sonnet, status:backlog
- Milestone: none

### Body

~~~~~~~~text
Design rotate and flip affordances for the Konva canvas in the workbench.

**Spec-file:** `docs/specs/konva-rotate-flip.md` (to be written)
**Roadmap:** `docs/08-roadmap.md` §P2 "#10"

## Context

Currently `rotateEnabled=false`, `flipEnabled=false` on the Konva Transformer.
Proofers occasionally need to fix scanner-frame skew that falls outside the
auto-deskew range. Spec 06 does not ask for this, so spec must define scope carefully.

## Spec must decide

- Rotation granularity: free-rotate handles, or discrete 90°/180° buttons, or both?
- Flip: horizontal only, vertical only, or both?
- Persistence: does a manual rotate/flip write back to a stage artifact, or is it
  view-state only?
- Interaction with the `manual_deskew_pre` stage: does UI rotate feed into that
  stage's `ResolvedPageConfig` angle?
- Undo: does rotate/flip participate in the word-delete undo strategy or have
  its own undo?

Spec: docs/specs/2026-05-13-konva-rotate-design.md
~~~~~~~~

## #14 Search across pages (P2 #13)

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB7HBAw`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:28:14Z
- Closed: 2026-05-15T20:57:46Z
- Labels: kind:feature-request, status:backlog, triage:approved
- Milestone: none

### Body

~~~~~~~~text
Full-text search across OCR pages for large books. Needs design.

Roadmap: `docs/08-roadmap.md` §P2 "#13".

Spec: docs/specs/2026-05-11-search-across-pages-design.md
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-11T21:45:58Z

~~~~~~~~text
Demoted to `kind:feature-request` on 2026-05-11.

This issue skipped the spec pipeline: no `/triage`, no spec file under `docs/specs/`, and its hand-rolled milestone children (#34, #35, #37) are `kind:feature` rather than `/decompose-spec` output (which produces `kind:chore`).

Re-entering the pipeline via `/triage` → `/spec-from-issue` → `/decompose-spec`. Premature design content (Context, "Spec must decide") stripped so `/triage` can re-derive without bias. Existing milestone children remain open and will be reconciled (close-superseded) once new pipeline products land.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-11T21:47:30Z

~~~~~~~~text
Triage forked child #46 (`kind:spec, effort:L, status:backlog`).
~~~~~~~~

### Comment 3 by ConcaveTrillion at 2026-05-11T21:47:33Z

~~~~~~~~text
Triage decision: approved + needs-spec. Spec child issue: #46. Run `/spec-from-issue 46` to write the design spec.
~~~~~~~~

### Comment 4 by ConcaveTrillion at 2026-05-12T23:05:43Z

~~~~~~~~text
Spec work completed via child issue #46 (9-section spec at `docs/specs/2026-05-11-search-across-pages-design.md`, merged in PR #51). Closing parent as complete.
~~~~~~~~

### Comment 5 by ConcaveTrillion at 2026-05-12T23:06:28Z

~~~~~~~~text
Reopening — spec is complete but search implementation is not yet shipped.
~~~~~~~~

### Comment 6 by ConcaveTrillion at 2026-05-15T20:57:46Z

~~~~~~~~text
Shipped — §13 search across pages delivered as issue #76 on main (2026-05-15). `SearchPanel` component + integration in `ProjectConfigurePage`; 8 vitest tests. See `docs/08-roadmap-shipped.md` §"§13 search". This pre-triage feature-request issue is being closed as duplicate of the shipped tracking issue.
~~~~~~~~

## #15 M6: remove batch_* job types, LocalBackend, and process_page_cpu monolith

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB7HBXQ`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:28:15Z
- Closed: 2026-05-15T10:38:14Z
- Labels: bot:ship-issue-ready, effort:M, kind:chore, model-effort:medium, model:sonnet, status:ready
- Milestone: none

### Body

~~~~~~~~text
Blocked-by: #11

Deletion milestone: remove all deprecated code paths after M5 ships the full registry cutover.

**Roadmap:** `docs/08-roadmap.md` §M6

## Scope (deletions only, no new behaviour)

- Remove all `JobType.batch_*` enum values and their handlers.
- Remove legacy endpoints: `/api/gpu/process-page`, `/api/gpu/run-ocr-page`,
  the `batch_*` paths on `/api/gpu/jobs`.
- Delete `LocalBackend` and `CpuBackend` classes; `pick_device()` + the registry
  become the only path.
- Delete `process_page_cpu`'s monolithic body (now dead code after M5 registry cutover).
- Remove M2-era debug panel from the workbench if M3 left dead code paths.

## Acceptance

- `grep -r "JobType.batch_" src/` returns empty.
- `grep -r "class LocalBackend" src/` returns empty.
- `grep -r "process_page_cpu" src/` returns empty.
- `curl -X POST http://127.0.0.1:8765/api/gpu/process-page` returns 404.
- Full M5 smoke-test workflow still passes end-to-end.

**Blocked-by:** M5 must ship first (project-level fan-out + STAGE_IMPL cutover).

Blocked-by: #106

Blocked-by: #107
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-15T10:38:14Z

~~~~~~~~text
Shipped on main: feat/m6-cleanup merged 2026-05-15. All acceptance criteria met — batch_* removed, LocalBackend/CpuBackend deleted, process_page_cpu gone, legacy endpoints 404, 786 tests green.
~~~~~~~~

## #16 P2 #13a: remaining shadcn/ui Radix primitive swaps (Tabs, Select, Popover, Tooltip)

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB7HBvw`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:28:16Z
- Closed: 2026-05-15T11:08:12Z
- Labels: effort:S, kind:chore, model-effort:low, model:haiku, status:bounced
- Milestone: none

### Body

~~~~~~~~text
Swap remaining hand-rolled UI primitives to Radix-backed shadcn/ui components.

**Roadmap:** `docs/08-roadmap.md` §P2 "#13a"

## Context

Major library swaps are complete (Dialog, AlertDialog → Radix; toasts → sonner;
hotkeys → react-hotkeys-hook; path aliases via vite-tsconfig-paths). Four primitive
families remain: Tabs, Select, Popover, Tooltip.

The pattern from existing swaps (see `components/ui/dialog.tsx`):
1. `npm install @radix-ui/react-<primitive>`
2. Write thin wrapper in `frontend/src/components/ui/<primitive>.tsx`
3. Swap callers (grep for existing usage of the hand-rolled version)

## Acceptance

- Each primitive family has a wrapper in `frontend/src/components/ui/`.
- All callers in the SPA import from the wrapper, not directly from Radix.
- No hand-rolled Tabs, Select, Popover, or Tooltip implementations remain.
- Existing Vitest + Playwright tests pass.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-13T17:46:56Z

~~~~~~~~text
Claimed by ship-issue-1.

- Model: `haiku` / effort: `low`
- Spec: `(none)`
- Pre-claim SHA: `80ac2ac42582aaa1da6ede63693e2039fe296398`

Acceptance:
(none)
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-13T17:51:35Z

~~~~~~~~text
ship-issue: bounced.

**Reason:** make ci failed: Check the log at /home/claude-bot/.cache/pre-commit/pre-commit.log
🔄 Reinstalling pd-prep-for-pgdp so hatch-vcs picks up the current HEAD / tags...
Resolved 123 packages in 920ms
   Building pd-prep-for-pgdp @ file:///srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp
      Built pd-prep-for-pgdp @ file:///srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp
Prepared 1 package in 245ms
Uninstalled 2 packages in 2ms
Installed 2 packages in 8ms
 ~ pd-prep-for-pgdp==0.2.dev185+gce4bcf69a (from file:///srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp)
 - python-doctr==1.0.2a0 (from git+https://github.com/mindee/doctr.git@a8694b80b4e8ed067ec8299efd0f1374f0b08936)
 + python-doctr==1.0.2a0 (from git+https://github.com/mindee/doctr.git@bc0db21e030926b4b7641fe71f7b8367e3ab042a)
Uninstalled 1 package in 4ms
Installed 1 package in 3ms
0.2.dev185+gce4bcf69a
✅ Setup complete!
📦 Installing frontend deps...
  (via /home/claude-bot/.local/bin/mise exec)

up to date, audited 473 packages in 987ms

102 packages are looking for funding
  run `npm fund` for details

6 moderate severity vulnerabilities

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.
uv run pre-commit run --all-files
pre-commit-update........................................................Passed
trim trailing whitespace.................................................Passed
fix end of files.........................................................Passed
check yaml...............................................................Passed
check json...............................................................Passed
ruff check...............................................................Passed
ruff check...............................................................Passed
ruff format..............................................................Passed
markdownlint-cli2........................................................Passed
frontend tsc -b --noEmit.................................................Passed
frontend eslint..........................................................Passed
frontend prettier --check................................................Failed
- hook id: frontend-prettier
- exit code: 1

Checking formatting...
[warn] src/components/ui/Select.tsx
[warn] Code style issues found in the above file. Run Prettier with --write to fix.

make: *** [Makefile:250: pre-commit-check] Error 1

**Pre-claim SHA:** `80ac2ac42582aaa1da6ede63693e2039fe296398` (work is recoverable from reflog if you want it)

The issue has been moved to `status:bounced` and `bot:ship-issue-ready` removed. To retry: triage the bounce reason, then run `scripts/arm-issue.py` (or manually add `bot:ship-issue-ready` and swap `status:bounced` → `status:ready`).
~~~~~~~~

### Comment 3 by ConcaveTrillion at 2026-05-15T11:08:11Z

~~~~~~~~text
Shipped: 210547f

- **Popover** — already present from M5 hi-fi work (no change)
- **Tabs** — new wrapper `frontend/src/components/ui/Tabs.tsx`
- **Select** — new wrapper `frontend/src/components/ui/Select.tsx`
- **Tooltip** — new wrapper `frontend/src/components/ui/Tooltip.tsx`

Packages added: `@radix-ui/react-tabs`, `@radix-ui/react-select`, `@radix-ui/react-tooltip`.

Caller audit: existing SPA uses native `<select>` elements and `title` attributes — these are browser-native, not hand-rolled JS implementations, so no swap was required. Wrappers are ready for future callers needing custom styling or richer a11y.

`make ci AI=1` passed (pre-commit + tsc + eslint + prettier + vitest + backend tests).
~~~~~~~~

## #17 Spec: pipeline task model — granular per-page stages with dirty propagation

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB7NV-w`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:44:12Z
- Closed: 2026-05-12T23:03:51Z
- Labels: kind:feature-request, status:backlog, triage:approved
- Milestone: none

### Body

~~~~~~~~text
Pipeline task model — granular per-page stages with dirty propagation. Needs proper spec.

A freeform spec doc already exists at `docs/specs/pipeline-task-model.md` (the design driving M1 shipped + M2 in-flight work); however this issue was retro-fitted as a "backfill" rather than authored through the spec pipeline. Re-entering the pipeline so `/triage` and `/spec-from-issue` can produce a proper 9-section spec; the existing doc remains on disk untouched in this session.

Spec: docs/specs/2026-05-11-pipeline-task-model-design.md
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-11T21:46:02Z

~~~~~~~~text
Demoted to `kind:feature-request` on 2026-05-11.

This issue carried `kind:spec` but was created as a "backfill" of a pre-existing spec doc rather than authored through the pipeline. Strict-criteria audit:

- No `/triage` happened.
- The spec file at `docs/specs/pipeline-task-model.md` is freeform (17 `##` sections) rather than the 9-section `/spec-from-issue` template.
- No draft spec PR exists for it.
- Children #18, #19, #20, #21, #22 are `kind:feature` (hand-rolled) rather than `kind:chore` (`/decompose-spec` output). #19 has further fanned out into #39-#42 with its own milestone.

The existing spec file remains on disk untouched (M2 work continues to be driven by it). Re-entering the pipeline so `/triage` and `/spec-from-issue` can produce a proper spec wired to a draft PR; once that lands, `/decompose-spec` will produce `kind:chore` children. Existing children #18–#22 (and grandchildren #39–#42 via #19) will be reconciled as close-superseded once the new pipeline products land.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-11T21:48:17Z

~~~~~~~~text
Triage forked child #47 (`kind:spec, effort:L, status:backlog`).
~~~~~~~~

### Comment 3 by ConcaveTrillion at 2026-05-11T21:48:21Z

~~~~~~~~text
Triage decision: approved + needs-spec. Spec child issue: #47. Run `/spec-from-issue 47` to write the design spec.
~~~~~~~~

### Comment 4 by ConcaveTrillion at 2026-05-11T21:48:27Z

~~~~~~~~text
Note for /triage idempotency: `triage-fork.py` initially refused because children #18-#22 already carry `Tracks: #17` in their bodies — but those are the very hand-rolled children identified in the audit, not real `/triage` products. Re-ran with `--force`, producing the proper triage product #47. Existing #18-#22 (and grandchildren #39-#42 via #19) remain open for now and will be reconciled as `close-superseded` once `/spec-from-issue` + `/decompose-spec` produce the new pipeline children.
~~~~~~~~

### Comment 5 by ConcaveTrillion at 2026-05-12T23:03:50Z

~~~~~~~~text
Spec work completed via child issue #47 (9-section spec at `docs/specs/2026-05-11-pipeline-task-model-design.md`, merged in PR #48). Closing parent as complete.
~~~~~~~~

## #18 Pipeline: blank-page + plate short circuits — not-applicable stage marking

- State: CLOSED (NOT_PLANNED)
- Node ID: `I_kwDOSUyCB88AAAABB7QoZw`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:51:37Z
- Closed: 2026-05-12T00:12:34Z
- Labels: effort:M, kind:feature, model-effort:medium, model:sonnet, status:backlog
- Milestone: spec: pipeline-task-model-granular-per-page (#17)

### Body

~~~~~~~~text
Implement not-applicable stage marking for blank/plate page types per pipeline task-model spec.

**Spec:** `pd-prep-for-pgdp/docs/specs/pipeline-task-model.md` §Blank-page short circuit + §plate_p page
**Tracks:** #17

## Scope

- For `page_type ∈ {blank, plate_b, plate_r}`: mark stages `decode_source` through `morph_fill` as `not-applicable`; route through `blank_proof_synth` (which depends on `auto_detect_attrs`).
- For `page_type=plate_p`: mark OCR and text stages (`ocr_crop`, `ocr`, `text_postprocess`, `text_review`) as `not-applicable`; `extract_illustrations` does the real work.
- `not-applicable` is a distinct status from `clean`/`dirty`/`not-run` — the chip rail renders it as slate-50 italic (already wired in the frontend).
- The stage runner must detect `page_type` at run time and short-circuit rather than dispatching to STAGE_IMPL.

## Acceptance

- Uploading a blank page and clicking `ingest_source` → `auto_detect_attrs` causes `decode_source`…`morph_fill` chips to flip to `not-applicable` automatically.
- Clicking any `not-applicable` chip returns 422 (not executable) with a clear message.
- Existing integration tests for the normal chain still pass.

Tracks: #17
Spec: pd-prep-for-pgdp/docs/specs/pipeline-task-model.md
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:12:33Z

~~~~~~~~text
Superseded by #58 (Pipeline: blank-page + plate short circuits — not-applicable stage marking), filed as a kind:chore child of milestone `spec: pipeline-task-model-granular-per-page (#47)` via /decompose-spec on 2026-05-11.
~~~~~~~~

## #19 Pipeline: splits — backend (create sibling rows, decode_source bbox crop, prefix resolution)

- State: CLOSED (NOT_PLANNED)
- Node ID: `I_kwDOSUyCB88AAAABB7QqFQ`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:51:39Z
- Closed: 2026-05-12T00:12:35Z
- Labels: effort:L, kind:feature, model-effort:high, model:sonnet, status:backlog
- Milestone: spec: pipeline-task-model-granular-per-page (#17)

### Body

~~~~~~~~text
Implement the backend for splits-as-sibling-pages per pipeline task-model spec Q6.

**Spec:** `pd-prep-for-pgdp/docs/specs/pipeline-task-model.md` §Splits as sibling pages
**Tracks:** #17

## Scope

- API endpoint `POST /api/data/projects/{id}/pages/{idx0}/split` accepting `{bbox: [x,y,w,h], split_at_stage: str, suffixes: [str, ...]}`.
- Creates N sibling `Page` rows with `parent_page_id`, `source_crop_bbox`, `split_index`, `split_at_stage`, `split_suffix`, `reading_order` populated.
- `decode_source` on child pages reads the parent's source image and crops to `source_crop_bbox`; `input_hash` includes `(parent_id, bbox)` so a parent re-ingest dirtied correctly.
- `compute_prefix` recurses up `parent_page_id` chain and appends `split_suffix` (e.g. parent `p045` + suffix `a` → `p045a`).
- `build_package` iterates pages in `(parent_idx0, split_index)` order so siblings stay adjacent in the zip.

## Acceptance

- POSTing a split on page f001 creates 2 child page rows visible in the page list.
- Opening a child page in the workbench and running `decode_source` produces a cropped PNG matching the bbox.
- `pgdp-prep reindex` correctly reconciles child page stages.
- Existing single-page pipeline tests still pass.

Tracks: #17
Spec: pd-prep-for-pgdp/docs/specs/pipeline-task-model.md
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:12:35Z

~~~~~~~~text
Superseded by #52 + #53 + #54 (Splits: POST /split endpoint, decode_source bbox crop, compute_prefix recursion), all filed as kind:chore children of milestone `spec: pipeline-task-model-granular-per-page (#47)` via /decompose-spec on 2026-05-11. This issue's hand-rolled grandchildren #39-#42 are also being closed-superseded.
~~~~~~~~

## #20 Pipeline: splits — cross-page dirty propagation for split children

- State: CLOSED (NOT_PLANNED)
- Node ID: `I_kwDOSUyCB88AAAABB7Qqsw`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:51:41Z
- Closed: 2026-05-12T00:12:37Z
- Labels: effort:S, kind:feature, model-effort:medium, model:sonnet, status:backlog
- Milestone: spec: pipeline-task-model-granular-per-page (#17)

### Body

~~~~~~~~text
Blocked-by: #19

Implement dirty propagation from parent page to split children when a parent stage re-runs.

**Spec:** `pd-prep-for-pgdp/docs/specs/pipeline-task-model.md` §Cross-page dirty propagation: split children
**Tracks:** #17

## Scope

- When a parent page re-runs any stage at or before its `split_at_stage`, all of that page's split children must have their `decode_source` stage marked `dirty`.
- This must trigger on the existing eager dirty-cascade path (§Dirty propagation) — re-running `ingest_source` on the parent cascades the parent's descendants, then also cascades each child's `decode_source` and the child's downstream chain.
- Implemented in `run_stage` or the dirty-propagation utility; must query `Page` rows with matching `parent_page_id`.

## Acceptance

- Re-running `ingest_source` on a parent page that has 2 split children causes all 2 children's `decode_source` chips to flip to `dirty`.
- Re-running a stage *after* `split_at_stage` on the parent does not dirty the children (the split is already past).
- Existing single-page dirty-propagation tests still pass.

Tracks: #17
Spec: pd-prep-for-pgdp/docs/specs/pipeline-task-model.md
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:12:36Z

~~~~~~~~text
Superseded by #55 (Splits: cross-page dirty propagation for split children), filed as a kind:chore child of milestone `spec: pipeline-task-model-granular-per-page (#47)` via /decompose-spec on 2026-05-11.
~~~~~~~~

## #21 Pipeline: splits — workbench page-list + reverse-split UI

- State: CLOSED (NOT_PLANNED)
- Node ID: `I_kwDOSUyCB88AAAABB7QrTw`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:51:43Z
- Closed: 2026-05-12T00:12:43Z
- Labels: effort:M, kind:feature, model-effort:medium, model:sonnet, status:backlog
- Milestone: spec: pipeline-task-model-granular-per-page (#17)

### Body

~~~~~~~~text
Blocked-by: #19

Implement the workbench page-list affordances for split pages and the reverse-split action.

**Spec:** `pd-prep-for-pgdp/docs/specs/pipeline-task-model.md` §Workbench treatment
**Tracks:** #17

## Scope

- Page list hides split parents by default; a "Show split parents" toggle reveals them.
- Split children appear with auto-suffixed labels: parent prefix `f042` → children `f042-1`, `f042-2` (split_index); user-chosen `split_suffix` shown alongside.
- "Reverse split" affordance on any child: deletes all siblings of that child, restores parent to visible, marks deleted children's on-disk artifacts for cleanup by reindex.
- Does **not** modify the parent's `page_stages` rows.

## Acceptance

- Page list for a project with one split parent shows only the children by default; toggling "Show split parents" reveals the parent row.
- Clicking "Reverse split" on child 1 of 2 deletes both children and the parent reappears in the list.
- `pgdp-prep reindex` after reverse-split removes the orphaned stage artifact directories.

Tracks: #17
Spec: pd-prep-for-pgdp/docs/specs/pipeline-task-model.md
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:12:42Z

~~~~~~~~text
Superseded by #56 (Splits: workbench page-list + reverse-split UI), filed as a kind:chore child of milestone `spec: pipeline-task-model-granular-per-page (#47)` via /decompose-spec on 2026-05-11.
~~~~~~~~

## #22 Pipeline: stage versioning enforcement (dirty-on-version-bump)

- State: CLOSED (NOT_PLANNED)
- Node ID: `I_kwDOSUyCB88AAAABB7Qr8Q`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:51:44Z
- Closed: 2026-05-12T00:12:44Z
- Labels: effort:S, kind:feature, model-effort:low, model:sonnet, status:backlog
- Milestone: spec: pipeline-task-model-granular-per-page (#17)

### Body

~~~~~~~~text
Add `STAGE_VERSIONS` dict to `dag.py` and enforce dirty-on-version-bump when reading `page_stages` rows.

**Spec:** `pd-prep-for-pgdp/docs/specs/pipeline-task-model.md` §Stage versioning (Q4 lock)
**Tracks:** #17

## Scope

- Add `STAGE_VERSIONS: dict[str, int]` to `core/pipeline/dag.py` with all 22 stage IDs at version 1.
- In `run_stage` (or the lazy-init path that reads `page_stages` rows): if stored `stage_version < STAGE_VERSIONS[stage_id]`, treat the row as `dirty` regardless of stored status and update `stage_version` on the next successful run.
- `pgdp-prep reindex --heal` must also apply the version check and re-mark stale rows dirty.
- Manual bump instruction in `dag.py` docstring: bump `STAGE_VERSIONS[stage_id]` when the stage algorithm changes (e.g. after a `pd-book-tools` upgrade).

## Acceptance

- A `page_stages` row with `stage_version=1` and a bumped `STAGE_VERSIONS[stage_id]=2` is served as `dirty` by the GET /stages route.
- After re-running the stage, the row's `stage_version` is updated to 2 and status becomes `clean`.
- `pgdp-prep reindex --heal` marks all stale-version rows dirty without running the stages.

Tracks: #17
Spec: pd-prep-for-pgdp/docs/specs/pipeline-task-model.md
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:12:44Z

~~~~~~~~text
Superseded by #59 (Pipeline: stage versioning enforcement — STAGE_VERSIONS + dirty-on-bump), filed as a kind:chore child of milestone `spec: pipeline-task-model-granular-per-page (#47)` via /decompose-spec on 2026-05-11.
~~~~~~~~

## #23 M3: stage thumbnail endpoint — serve small inline PNGs per clean stage

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB7S7Iw`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:58:15Z
- Closed: 2026-05-11T20:58:53Z
- Labels: effort:S, kind:feature, model-effort:low, model:sonnet, status:backlog
- Milestone: none

### Body

~~~~~~~~text
Serve a small thumbnail PNG for each clean stage artifact, used by the polished chip rail.

**Tracks:** #9
**Roadmap:** `docs/08-roadmap.md` §M3

## Scope

- New route: `GET /api/data/projects/{id}/pages/{idx0}/stages/{stage_id}/thumbnail`
- Returns a JPEG or PNG thumbnail (max 64px wide) of the stage artifact, generated on-demand via cv2 resize.
- 404 if stage is not clean or has no image-type artifact.
- ETag based on `input_hash` for caching; responds 304 on `If-None-Match` match.
- Image-type stages only; JSON/text-type stages return 404.

## Acceptance

- GET on a clean image-type stage returns a small image (≤64px wide).
- GET on a non-clean stage returns 404.
- GET on a JSON-type stage (e.g. find_content_edges) returns 404.
- Repeated GET with matching ETag returns 304.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-11T20:58:53Z

~~~~~~~~text
Duplicate of #24. Closing.
~~~~~~~~

## #24 M3: stage thumbnail endpoint — serve small inline PNGs per clean stage

- State: CLOSED (NOT_PLANNED)
- Node ID: `I_kwDOSUyCB88AAAABB7S8bA`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:58:19Z
- Closed: 2026-05-12T00:15:00Z
- Labels: effort:S, kind:feature, model-effort:low, model:sonnet, status:backlog
- Milestone: feature: m3-workbench-artifact-viewer (#9)

### Body

~~~~~~~~text
Serve a small thumbnail PNG for each clean stage artifact, used by the polished chip rail.

**Tracks:** #9
**Roadmap:** `docs/08-roadmap.md` §M3

## Scope

- New route: `GET /api/data/projects/{id}/pages/{idx0}/stages/{stage_id}/thumbnail`
- Returns a JPEG or PNG thumbnail (max 64px wide) of the stage artifact, generated on-demand via cv2 resize.
- 404 if stage is not clean or has no image-type artifact.
- ETag based on `input_hash` for caching; responds 304 on `If-None-Match` match.
- Image-type stages only; JSON/text-type stages return 404.

## Acceptance

- GET on a clean image-type stage returns a small image (≤64px wide).
- GET on a non-clean stage returns 404.
- GET on a JSON-type stage (e.g. find_content_edges) returns 404.
- Repeated GET with matching ETag returns 304.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:14:59Z

~~~~~~~~text
Superseded by #62 (M3: stage thumbnail endpoint + artifact-URL cache-busting), filed as a kind:chore child of milestone `spec: m3-workbench-artifact-viewer-stage (#44)` via /decompose-spec on 2026-05-11.
~~~~~~~~

## #25 M3: polished chip rail — inline thumbnails, click-to-select, status pills

- State: CLOSED (NOT_PLANNED)
- Node ID: `I_kwDOSUyCB88AAAABB7S-qg`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:58:26Z
- Closed: 2026-05-12T00:15:01Z
- Labels: effort:M, kind:feature, model-effort:medium, model:sonnet, status:backlog
- Milestone: feature: m3-workbench-artifact-viewer (#9)

### Body

~~~~~~~~text
Replace the M2 chip rail with a polished stage-chain strip: per-stage thumbnails, status pills, click-to-select.

**Tracks:** #9
**Blocked-by:** #24
**Roadmap:** `docs/08-roadmap.md` §M3

## Scope

- Each chip shows a small inline thumbnail (from the thumbnail endpoint) when the stage is clean.
- Status pills: consistent colour coding (not-run slate, running sky+pulse, clean emerald, dirty amber, failed rose, not-applicable slate-50 italic).
- Clicking a chip selects it (highlights it, wires into the artifact viewer in Slice C).
- Currently-selected chip is visually distinct (ring or border).
- Existing click-to-run behaviour is preserved; selecting vs. running are distinct interactions.

## Acceptance

- Opening any clean page shows inline thumbnails on all clean chips.
- Clicking a chip selects it without triggering a run.
- A separate "Run" button (or double-click) triggers the POST /run route.
- Status colours match the spec.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:15:01Z

~~~~~~~~text
Superseded by #63 (M3: polished chip rail), filed as a kind:chore child of milestone `spec: m3-workbench-artifact-viewer-stage (#44)` via /decompose-spec on 2026-05-11.
~~~~~~~~

## #26 M3: side-by-side artifact viewer (Stage + Compare selectors)

- State: CLOSED (NOT_PLANNED)
- Node ID: `I_kwDOSUyCB88AAAABB7TAqQ`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:58:32Z
- Closed: 2026-05-12T00:15:02Z
- Labels: effort:M, kind:feature, model-effort:medium, model:sonnet, status:backlog
- Milestone: feature: m3-workbench-artifact-viewer (#9)

### Body

~~~~~~~~text
Side-by-side artifact comparison pane in the workbench.

**Tracks:** #9
**Roadmap:** `docs/08-roadmap.md` §M3

## Scope

- When a chip is selected (from polished rail), the artifact viewer opens below/beside the rail.
- Two selectors: `Stage: [▼]` (defaults to selected chip) and `Compare with: [▼]` (defaults to the selected stage's primary parent).
- Both selectors list all 22 stage IDs; selecting one streams the artifact from `GET /stages/{stage_id}/artifact`.
- Images rendered side-by-side at full resolution with horizontal scroll if needed.
- Non-image stages (JSON, text): render as formatted text instead of an image.
- Cache busted by `input_hash` in the URL query string.

## Acceptance

- Selecting a chip opens the viewer with the stage artifact on the left and its parent on the right.
- Changing the Compare selector to another stage swaps the right pane.
- Re-running a stage updates the left pane without a page reload (URL cache-buster changes).
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:15:02Z

~~~~~~~~text
Superseded by #64 (M3: side-by-side artifact viewer), filed as a kind:chore child of milestone `spec: m3-workbench-artifact-viewer-stage (#44)` via /decompose-spec on 2026-05-11.
~~~~~~~~

## #27 M3: stage-controls panel (ResolvedPageConfig fields filtered by stage; Apply + Run)

- State: CLOSED (NOT_PLANNED)
- Node ID: `I_kwDOSUyCB88AAAABB7TDGA`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:58:39Z
- Closed: 2026-05-12T00:15:04Z
- Labels: effort:M, kind:feature, model-effort:high, model:sonnet, status:backlog
- Milestone: feature: m3-workbench-artifact-viewer (#9)

### Body

~~~~~~~~text
Stage-controls panel: when a stage chip is selected, show only the ResolvedPageConfig fields that stage reads, with Apply + Run.

**Tracks:** #9
**Blocked-by:** #6
**Roadmap:** `docs/08-roadmap.md` §M3

## Scope

- Backend: a static map `STAGE_CONFIG_FIELDS: dict[str, list[str]]` in `dag.py` listing which `ResolvedPageConfig` field names each stage reads.
- New route `GET /api/data/projects/{id}/pages/{idx0}/config` returning the resolved config for that page.
- Frontend: when a chip is selected, fetch the resolved config and render only the fields listed in STAGE_CONFIG_FIELDS[stage_id].
- Each field renders an appropriate input (toggle for booleans, number input for ints/floats, select for enums).
- "Apply" saves the updated config field(s) to the page's config. "Apply + Run" saves then immediately POSTs /run on the stage.

## Acceptance

- Selecting the `threshold` chip shows only the threshold-relevant config field(s), not unrelated fields like `fuzzy_pct`.
- Changing a field value and clicking "Apply + Run" triggers a run; the chip transitions clean with updated artifact.
- Selecting a stage with no config fields shows an empty panel with a "No configurable fields" message.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:15:03Z

~~~~~~~~text
Superseded by #65 (M3: stage-controls panel — field-to-stage map + Apply + Run), filed as a kind:chore child of milestone `spec: m3-workbench-artifact-viewer-stage (#44)` via /decompose-spec on 2026-05-11. Blocked-by #61 (ResolvedPageConfig plumbing).
~~~~~~~~

## #28 M3: SSE endpoint + frontend live-rail stage status updates

- State: CLOSED (NOT_PLANNED)
- Node ID: `I_kwDOSUyCB88AAAABB7TFHA`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:58:45Z
- Closed: 2026-05-12T00:15:05Z
- Labels: effort:M, kind:feature, model-effort:medium, model:sonnet, status:backlog
- Milestone: feature: m3-workbench-artifact-viewer (#9)

### Body

~~~~~~~~text
Server-Sent Events for live stage status updates — chip rail updates across tabs without polling.

**Tracks:** #9
**Roadmap:** `docs/08-roadmap.md` §M3

## Scope

- New SSE route: `GET /api/data/projects/{id}/pages/{idx0}/stages/events` streams `{stage_id, status, last_run_at}` objects whenever a stage status changes.
- Events are emitted by `run_stage` and the dirty-cascade path after every status write.
- Frontend: the chip rail subscribes to SSE on page open; each event updates the matching chip's status and thumbnail without a full refetch.
- Subscription is torn down on page navigation.
- Fallback: if SSE is unavailable, the existing 2-second poll remains as the fallback.

## Acceptance

- Opening the same page in two browser tabs and running a stage in tab 1 causes tab 2's rail to update within 1 second.
- Closing tab 2 terminates the SSE connection (no server-side leak).
- The 2-second poll fallback still works when EventSource is disabled.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:15:05Z

~~~~~~~~text
Superseded by #66 (M3: SSE endpoint + frontend live-rail stage status updates), filed as a kind:chore child of milestone `spec: m3-workbench-artifact-viewer-stage (#44)` via /decompose-spec on 2026-05-11.
~~~~~~~~

## #29 M5: project_run_dirty job type + per-page async stage dispatch

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB7THhw`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:58:52Z
- Closed: 2026-05-11T21:03:27Z
- Labels: effort:M, kind:feature, model-effort:medium, model:sonnet, status:backlog
- Milestone: none

### Body

~~~~~~~~text
Add project-level job types that fan out per-page stage runs across all pages in the project.

**Tracks:** #11
**Roadmap:** `docs/08-roadmap.md` §M5

## Scope

- New `JobType.project_run_dirty`: dispatches a `run_stage` task for every dirty stage across all pages in the project.
- New route `POST /api/data/projects/{id}/run-dirty` that creates a `project_run_dirty` job and returns the job ID.
- The job runner fans out per-page tasks asynchronously; each page's dirty stages run in DAG order.
- Job row tracks overall progress: `pages_total`, `pages_complete` fields updated as pages finish.
- Existing single-page `POST /stages/{stage_id}/run` route is unchanged.

## Acceptance

- POSTing to /run-dirty on a project with 3 dirty pages creates a job row of type `project_run_dirty`.
- All dirty stages across all 3 pages complete; each page's stage statuses become clean.
- `pages_complete` increments as each page finishes.
- Existing per-page run route still works independently.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-11T21:03:26Z

~~~~~~~~text
Duplicate of #30 (filed concurrently by parallel agent). Closing this copy.
~~~~~~~~

## #30 M5: project_run_dirty job type + per-page async stage dispatch

- State: CLOSED (NOT_PLANNED)
- Node ID: `I_kwDOSUyCB88AAAABB7TJKQ`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:58:56Z
- Closed: 2026-05-12T00:16:55Z
- Labels: effort:M, kind:feature, model-effort:medium, model:sonnet, status:backlog
- Milestone: feature: m5-project-fanout-awaiting-review (#11)

### Body

~~~~~~~~text
Add project-level job types that fan out per-page stage runs across all pages in the project.

**Tracks:** #11
**Roadmap:** `docs/08-roadmap.md` §M5

## Scope

- New `JobType.project_run_dirty`: dispatches a `run_stage` task for every dirty stage across all pages in the project.
- New route `POST /api/data/projects/{id}/run-dirty` that creates a `project_run_dirty` job and returns the job ID.
- The job runner fans out per-page tasks asynchronously; each page's dirty stages run in DAG order.
- Job row tracks overall progress: `pages_total`, `pages_complete` fields updated as pages finish.
- Existing single-page `POST /stages/{stage_id}/run` route is unchanged.

## Acceptance

- POSTing to /run-dirty on a project with 3 dirty pages creates a job row of type `project_run_dirty`.
- All dirty stages across all 3 pages complete; each page's stage statuses become clean.
- `pages_complete` increments as each page finishes.
- Existing per-page run route still works independently.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:16:54Z

~~~~~~~~text
Superseded by #67 (M5: project_run_dirty + project_run_stage_all_pages job types), filed as a kind:chore child of milestone `spec: m5-project-level-orchestration-fan-out (#45)` via /decompose-spec on 2026-05-11.
~~~~~~~~

## #31 M5: JobsPage project-level progress row (per-page granularity)

- State: CLOSED (NOT_PLANNED)
- Node ID: `I_kwDOSUyCB88AAAABB7TNZA`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:59:05Z
- Closed: 2026-05-12T00:16:56Z
- Labels: effort:S, kind:feature, model-effort:low, model:sonnet, status:backlog
- Milestone: feature: m5-project-fanout-awaiting-review (#11)

### Body

~~~~~~~~text
Blocked-by: #30

Add a project-level progress row to the JobsPage for project_run_dirty jobs.

**Tracks:** #11
**Roadmap:** `docs/08-roadmap.md` §M5

## Scope

- JobsPage shows a progress bar for `project_run_dirty` jobs: "Pages complete: N / M".
- Progress bar ticks as `pages_complete` increments (poll every 2 s or via SSE if available).
- Per-page child stage jobs are shown as collapsible sub-rows under the parent job row.
- Completed project jobs show a summary: "3/3 pages clean".

## Acceptance

- Triggering /run-dirty and opening JobsPage shows the parent job row with a progress bar.
- The bar advances from 0 to N as pages complete.
- Expanding the row shows per-page sub-rows.
- Completed job shows the summary count.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:16:56Z

~~~~~~~~text
Superseded by #70 (M5: JobsPage project-level progress row), filed as a kind:chore child of milestone `spec: m5-project-level-orchestration-fan-out (#45)` via /decompose-spec on 2026-05-11.
~~~~~~~~

## #32 M5: awaiting_review job state — park build_package + auto-resume on last attestation

- State: CLOSED (NOT_PLANNED)
- Node ID: `I_kwDOSUyCB88AAAABB7TQjg`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:59:14Z
- Closed: 2026-05-12T00:16:57Z
- Labels: effort:M, kind:feature, model-effort:high, model:sonnet, status:backlog
- Milestone: feature: m5-project-fanout-awaiting-review (#11)

### Body

~~~~~~~~text
Blocked-by: #30

Implement the awaiting_review job state that parks build_package until all proof-range pages are reviewed.

**Tracks:** #11
**Roadmap:** `docs/08-roadmap.md` §M5

## Scope

- `POST /api/projects/{id}/build-package` checks if any proof-range page has `text_review != clean`. If so, sets job state to `awaiting_review` instead of `running`.
- `awaiting_review` job state stored in the jobs table; the job runner skips it.
- After each `text_review` clean write, the runner re-checks: if all proof-range pages are now clean, transitions the parked job from `awaiting_review` → `running` and continues.
- Unreviewed count available via `GET /api/projects/{id}/review-status` (returns `{unreviewed: N, total: M}`).

## Acceptance

- Triggering build_package with 3 unreviewed pages parks the job (`awaiting_review`).
- Marking each page reviewed decrements the count.
- After the last attestation the job auto-resumes and completes.
- If all pages are already reviewed, build_package proceeds immediately.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:16:57Z

~~~~~~~~text
Superseded by #69 (M5: awaiting_review job state — park build_package + auto-resume), filed as a kind:chore child of milestone `spec: m5-project-level-orchestration-fan-out (#45)` via /decompose-spec on 2026-05-11.
~~~~~~~~

## #33 M5: project banner unreviewed-page count + Open Tasks bell badge

- State: CLOSED (NOT_PLANNED)
- Node ID: `I_kwDOSUyCB88AAAABB7TVpg`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:59:26Z
- Closed: 2026-05-12T00:16:59Z
- Labels: effort:S, kind:feature, model-effort:medium, model:sonnet, status:backlog
- Milestone: feature: m5-project-fanout-awaiting-review (#11)

### Body

~~~~~~~~text
Blocked-by: #32

Show unreviewed page count in the project banner and the global Open Tasks bell.

**Tracks:** #11
**Roadmap:** `docs/08-roadmap.md` §M5

## Scope

- Project header banner: "N pages awaiting review before package can build" with a "Review next page" button that opens the workbench on the first unreviewed page.
- Banner only visible when a job is in `awaiting_review` state.
- Open Tasks bell (top-right nav): badge count = unreviewed pages across all projects with a parked build_package job.
- Badge updates live (poll or SSE).

## Acceptance

- Parking build_package on a 3-page project shows "3 pages awaiting review" in the banner.
- Clicking "Review next page" opens page f001 in the workbench.
- Marking f001 reviewed drops the banner to "2" and the bell badge to "2".
- After the last attestation, the banner disappears and the badge clears.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:16:58Z

~~~~~~~~text
Superseded by #71 (M5: project banner unreviewed-page count + Open Tasks bell badge), filed as a kind:chore child of milestone `spec: m5-project-level-orchestration-fan-out (#45)` via /decompose-spec on 2026-05-11.
~~~~~~~~

## #34 Search: SQLite FTS5 table + ocr_text population on text_postprocess clean write

- State: CLOSED (NOT_PLANNED)
- Node ID: `I_kwDOSUyCB88AAAABB7TVug`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:59:26Z
- Closed: 2026-05-12T00:18:20Z
- Labels: effort:M, kind:feature, model-effort:medium, model:sonnet, status:backlog
- Milestone: feature: search-across-pages (#14)

### Body

~~~~~~~~text
Add SQLite FTS5 full-text search index populated from text_postprocess stage artifacts.

**Tracks:** #14
**Roadmap:** `docs/08-roadmap.md` §P2 "#13"

## Scope

- New SQLite FTS5 virtual table `pages_fts(page_id, project_id, ocr_text)` with `content=pages` or as a separate table.
- Population trigger: after `text_postprocess` stage writes a clean artifact, read `output.txt` and upsert the page's row in `pages_fts`.
- Deletion: when a page is deleted or its `text_postprocess` stage is dirtied, remove/invalidate the FTS row.
- Migration: `pgdp-prep reindex` populates `pages_fts` from existing clean `text_postprocess` artifacts.
- Postgres note: implementation uses FTS5 for local SQLite; the query abstraction must be swappable for Postgres full-text search without changing the search endpoint.

## Acceptance

- After running text_postprocess on a page, a row appears in `pages_fts` with the page's OCR text.
- `pgdp-prep reindex` backfills FTS rows for all existing clean text_postprocess artifacts.
- Dirtying text_postprocess on a page removes/invalidates its FTS row.
- Direct SQLite query `SELECT page_id FROM pages_fts WHERE pages_fts MATCH 'hello'` returns matching pages.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:18:19Z

~~~~~~~~text
Superseded by #74 (Search: SQLite FTS5 table + text_postprocess clean-write upsert), filed as a kind:chore child of milestone `spec: full-text-search-across-ocr-pages (#46)` via /decompose-spec on 2026-05-11.
~~~~~~~~

## #35 Search: GET /api/data/projects/{id}/search endpoint + result shape

- State: CLOSED (NOT_PLANNED)
- Node ID: `I_kwDOSUyCB88AAAABB7TYOQ`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:59:34Z
- Closed: 2026-05-12T00:18:21Z
- Labels: effort:S, kind:feature, model-effort:low, model:sonnet, status:backlog
- Milestone: feature: search-across-pages (#14)

### Body

~~~~~~~~text
Blocked-by: #34

Backend search endpoint querying the FTS5 index.

**Tracks:** #14
**Roadmap:** `docs/08-roadmap.md` §P2 "#13"

## Scope

- Route: `GET /api/data/projects/{id}/search?q=<query>&limit=20&offset=0`
- Queries `pages_fts` with the FTS5 MATCH expression; returns paginated results.
- Result shape per item: `{page_id, idx0, prefix, snippet, score}` where `snippet` is a short extract (≤200 chars) around the match using SQLite `snippet()` function.
- 400 if `q` is empty or missing. 200 with `{results: [], total: 0}` if no matches.
- Filters by `project_id` and `user_id` (existing data-access rules apply).

## Acceptance

- Searching for a word that appears in a page's OCR text returns that page in results.
- `snippet` contains the matched word with surrounding context.
- Pagination: `limit` and `offset` work correctly.
- Searching for a word not in any page returns `{results: [], total: 0}`.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:18:21Z

~~~~~~~~text
Superseded by #75 (Search: GET /api/data/projects/{id}/search endpoint + result shape), filed as a kind:chore child of milestone `spec: full-text-search-across-ocr-pages (#46)` via /decompose-spec on 2026-05-11.
~~~~~~~~

## #36 M5: legacy batch_* job-type compatibility shims

- State: CLOSED (NOT_PLANNED)
- Node ID: `I_kwDOSUyCB88AAAABB7TZCw`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:59:36Z
- Closed: 2026-05-12T00:17:00Z
- Labels: effort:S, kind:feature, model-effort:low, model:sonnet, status:backlog
- Milestone: feature: m5-project-fanout-awaiting-review (#11)

### Body

~~~~~~~~text
Translate legacy batch_* job types to the new project_run_dirty model so existing callers keep working through M5.

**Tracks:** #11
**Roadmap:** `docs/08-roadmap.md` §M5

## Scope

- `JobType.batch_process_pages`, `batch_extract_illustrations`, `batch_ocr`, `batch_text_postprocess`: each shim translates to a `project_run_dirty` call scoped to the relevant stage IDs.
- Shims live in a `_legacy_shims.py` module; they are not new job-runner paths — they reuse the fan-out runner from Slice A.
- The legacy endpoints (`/api/gpu/jobs` with batch_* types) continue to accept and translate requests.
- Shims are deleted in M6 (#15).

## Acceptance

- POSTing `{"job_type": "batch_process_pages", "project_id": "..."}` to the legacy endpoint creates a project_run_dirty job and completes successfully.
- All four batch_* types translate correctly.
- M6 issue #15 can delete these shims without breaking anything else.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:17:00Z

~~~~~~~~text
Superseded by #68 (M5: legacy batch_* job-type compatibility shim), filed as a kind:chore child of milestone `spec: m5-project-level-orchestration-fan-out (#45)` via /decompose-spec on 2026-05-11.
~~~~~~~~

## #37 Search: search bar UI + results panel (snippet, page link)

- State: CLOSED (NOT_PLANNED)
- Node ID: `I_kwDOSUyCB88AAAABB7TbPA`
- Author: ConcaveTrillion
- Created: 2026-05-11T20:59:42Z
- Closed: 2026-05-12T00:18:23Z
- Labels: effort:M, kind:feature, model-effort:medium, model:sonnet, status:backlog
- Milestone: feature: search-across-pages (#14)

### Body

~~~~~~~~text
Blocked-by: #35

Frontend search bar and results panel for searching OCR text across pages.

**Tracks:** #14
**Roadmap:** `docs/08-roadmap.md` §P2 "#13"

## Scope

- Per-project search bar in the project header or sidebar (not global nav — scoped to the open project).
- Debounced input (300 ms) triggers GET /search; results appear in a dropdown/panel below the bar.
- Each result shows: page prefix (e.g. `f042`), the matched snippet with the query term highlighted, and a link that navigates to that page in the workbench.
- "No results" state shown when query returns empty.
- Loading spinner during fetch.
- Clear button resets the query.

## Acceptance

- Typing a word that appears in a page's OCR text shows that page in the results within ~500 ms.
- Clicking a result opens the workbench on the correct page.
- Clearing the search bar dismisses the results panel.
- Typing a word with no matches shows "No results found".
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:18:22Z

~~~~~~~~text
Superseded by #76 (Search: search bar UI + results panel), filed as a kind:chore child of milestone `spec: full-text-search-across-ocr-pages (#46)` via /decompose-spec on 2026-05-11.
~~~~~~~~

## #38 Splits: POST /split endpoint + create sibling Page rows

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB7TiZg`
- Author: ConcaveTrillion
- Created: 2026-05-11T21:00:00Z
- Closed: 2026-05-11T21:03:28Z
- Labels: effort:M, kind:feature, model-effort:medium, model:sonnet, status:backlog
- Milestone: none

### Body

~~~~~~~~text
Implement the split creation endpoint that produces N sibling child Page rows from a parent.

**Tracks:** #19
**Spec:** `pd-prep-for-pgdp/docs/specs/pipeline-task-model.md` §Splits as sibling pages
**Blocked-by:** #19

## Scope

- Route: `POST /api/data/projects/{id}/pages/{idx0}/split`
- Request body: `{crops: [{bbox: [x,y,w,h], suffix: "a"}, ...], split_at_stage: "auto_detect_attrs"}`
- Creates N child `Page` rows: `parent_page_id = parent.id`, `source_crop_bbox = bbox`, `split_index = 1..N`, `split_at_stage`, `split_suffix`, `reading_order = split_index`.
- Creates `page_stages` rows for each child (all `not-run`).
- Parent page remains in the DB; its stage rows are unchanged.
- `split_at_stage` must be a valid stage ID; returns 422 otherwise.
- Returns the list of created child page IDs.

## Acceptance

- POSTing a 2-crop split on page f001 creates 2 child Page rows with correct parent_page_id, bbox, suffix.
- Each child has 22 `page_stages` rows all in `not-run` status.
- The parent page's stage rows are unchanged.
- POSTing with an invalid stage ID returns 422.
- `pgdp-prep reindex` correctly reconciles the child page rows.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-11T21:03:28Z

~~~~~~~~text
Duplicate of #39 (filed concurrently by parallel agent). Closing this copy.
~~~~~~~~

## #39 Splits: POST /split endpoint + create sibling Page rows

- State: CLOSED (NOT_PLANNED)
- Node ID: `I_kwDOSUyCB88AAAABB7TitQ`
- Author: ConcaveTrillion
- Created: 2026-05-11T21:00:01Z
- Closed: 2026-05-12T00:12:46Z
- Labels: effort:M, kind:feature, model-effort:medium, model:sonnet, status:backlog
- Milestone: feature: splits-backend (#19)

### Body

~~~~~~~~text
https://github.com/ConcaveTrillion/pd-prep-for-pgdp/issues/38
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:12:45Z

~~~~~~~~text
Superseded by #52 (Splits: POST /split endpoint + create sibling Page rows), filed as a kind:chore child of milestone `spec: pipeline-task-model-granular-per-page (#47)` via /decompose-spec on 2026-05-11.
~~~~~~~~

## #40 Splits: decode_source bbox crop for child pages + (parent_id, bbox) input_hash

- State: CLOSED (NOT_PLANNED)
- Node ID: `I_kwDOSUyCB88AAAABB7TnMw`
- Author: ConcaveTrillion
- Created: 2026-05-11T21:00:13Z
- Closed: 2026-05-12T00:12:47Z
- Labels: effort:S, kind:feature, model-effort:medium, model:sonnet, status:backlog
- Milestone: feature: splits-backend (#19)

### Body

~~~~~~~~text
Blocked-by: #39

Implement decode_source for split child pages: crop the parent source image to the child's bbox.

**Tracks:** #19
**Spec:** `pd-prep-for-pgdp/docs/specs/pipeline-task-model.md` §Stage state on children

## Scope

- When `run_stage('decode_source')` is called on a child page (one with `parent_page_id IS NOT NULL`):
  - Load the parent page's source bytes from IStorage at `parent.source_key`.
  - Decode the image and crop to `source_crop_bbox` (x, y, w, h) in original-source coordinate space.
  - Write the cropped image as the child's `decode_source` artifact.
- `input_hash` for the child's `decode_source` row includes `(parent_page_id, source_crop_bbox)` in addition to the source bytes hash, so a parent re-ingest dirtied the child's decode_source correctly.
- Root pages (parent_page_id IS NULL) behave as before.

## Acceptance

- Running decode_source on a child page produces a cropped PNG matching the specified bbox.
- The child's decode_source input_hash differs from the parent's.
- Re-ingesting the parent page (changing source bytes) marks the child's decode_source dirty.
- Root page decode_source is unchanged.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:12:47Z

~~~~~~~~text
Superseded by #53 (Splits: decode_source bbox crop + (parent_id, bbox) input_hash), filed as a kind:chore child of milestone `spec: pipeline-task-model-granular-per-page (#47)` via /decompose-spec on 2026-05-11.
~~~~~~~~

## #41 Splits: compute_prefix recursion + split_suffix composition

- State: CLOSED (NOT_PLANNED)
- Node ID: `I_kwDOSUyCB88AAAABB7TqTw`
- Author: ConcaveTrillion
- Created: 2026-05-11T21:00:21Z
- Closed: 2026-05-12T00:12:49Z
- Labels: effort:S, kind:feature, model-effort:low, model:sonnet, status:backlog
- Milestone: feature: splits-backend (#19)

### Body

~~~~~~~~text
Blocked-by: #39

Extend compute_prefix to recurse up the parent_page_id chain and compose split_suffix.

**Tracks:** #19
**Spec:** `pd-prep-for-pgdp/docs/specs/pipeline-task-model.md` §Numbering / prefix resolution

## Scope

- `compute_prefix(page_id, project, pages)` already exists; extend it to handle split children.
- For a child page: compute the parent's prefix recursively, then append the child's `split_suffix`.
- Example: parent at idx0=49 resolves to `p045`; child with `split_suffix="a"` resolves to `p045a`.
- Recursive splits compose left-to-right: grandchild with parent `p045a` and suffix `b` → `p045ab`.
- Root pages (split_suffix IS NULL) behave as before.

## Acceptance

- A child page with parent prefix `p045` and suffix `a` gets prefix `p045a`.
- A grandchild with parent prefix `p045a` and suffix `b` gets prefix `p045ab`.
- Root pages still compute their prefix correctly (regression test).
- Existing `test_compute_prefix_*.py` tests still pass.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:12:48Z

~~~~~~~~text
Superseded by #54 (Splits: compute_prefix recursion + split_suffix composition), filed as a kind:chore child of milestone `spec: pipeline-task-model-granular-per-page (#47)` via /decompose-spec on 2026-05-11.
~~~~~~~~

## #42 Splits: build_package sibling sort order + reindex support for child pages

- State: CLOSED (NOT_PLANNED)
- Node ID: `I_kwDOSUyCB88AAAABB7Tvsw`
- Author: ConcaveTrillion
- Created: 2026-05-11T21:00:36Z
- Closed: 2026-05-12T00:12:50Z
- Labels: effort:S, kind:feature, model-effort:low, model:sonnet, status:backlog
- Milestone: feature: splits-backend (#19)

### Body

~~~~~~~~text
Blocked-by: #39

Ensure build_package iterates split siblings in order and reindex handles child page artifacts.

**Tracks:** #19
**Spec:** `pd-prep-for-pgdp/docs/specs/pipeline-task-model.md` §Numbering / prefix resolution

## Scope

- `build_package` iterates pages in `(parent_idx0, split_index)` order so sibling pages stay adjacent in the output zip. Root pages (split_index IS NULL) sort by their own idx0.
- Output filenames use the resolved prefix: `<full_prefix>.png` / `<full_prefix>.txt` per the existing convention.
- `pgdp-prep reindex` scans child page stage artifact directories (under `pages/<child_id>/stages/`) and reconciles their `page_stages` rows, same as root pages.
- `pgdp-prep reindex --heal` also heals child page rows.

## Acceptance

- A project with parent f001 and children f001a, f001b produces a zip with f001a and f001b adjacent and after f000 but before f002.
- f001 (the parent, now hidden) does NOT appear in the package.
- `pgdp-prep reindex` on a project with split children reports their stage rows correctly.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:12:50Z

~~~~~~~~text
Superseded by #57 (Splits: build_package sibling sort order + reindex support), filed as a kind:chore child of milestone `spec: pipeline-task-model-granular-per-page (#47)` via /decompose-spec on 2026-05-11.
~~~~~~~~

## #44 Spec: M3 workbench artifact viewer + stage controls panel

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB7jmQw`
- Author: ConcaveTrillion
- Created: 2026-05-11T21:46:59Z
- Closed: 2026-05-11T23:31:53Z
- Labels: effort:L, kind:spec, status:backlog, triage:proposed-by-agent
- Milestone: none

### Body

~~~~~~~~text
Tracks: #9

Tracks: #9

Spec for the M3 workbench experience: how proofers navigate and inspect the per-stage artifacts produced by the per-page DAG, with affordances to re-run individual stages on demand.

## Open questions for the spec to answer

- What is the navigation/comparison UX for per-stage artifacts on a page?
- How does the workbench expose per-stage inputs (which fields are surfaced where, with what edit/apply/run semantics)?
- How do stage-status transitions reflect in the UI without a page reload?
- How are artifact URLs addressed and cache-busted across re-runs?

Spec to be authored via `/spec-from-issue` and saved under `pd-prep-for-pgdp/docs/specs/`.

Spec: docs/specs/2026-05-11-workbench-artifact-viewer-design.md
~~~~~~~~

## #45 Spec: M5 project-level fan-out + awaiting_review gate

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB7jqww`
- Author: ConcaveTrillion
- Created: 2026-05-11T21:47:14Z
- Closed: 2026-05-11T23:32:15Z
- Labels: effort:L, kind:spec, status:backlog, triage:proposed-by-agent
- Milestone: none

### Body

~~~~~~~~text
Tracks: #11

Tracks: #11

Spec for the M5 project-level orchestration arc: fanning out per-page stage work across an entire project as a single user action, and the gate that holds final-package construction until human review is complete.

## Open questions for the spec to answer

- What is the job-type / dispatch model when a project-wide run is requested (one job per page? a parent job with child jobs? something else)?
- How is project-wide progress surfaced in the UI (per-stage, per-page, both, neither)?
- What is the precise trigger that releases the held package build, and where in the UI does the proofer act to advance pages through review?
- Which legacy job-type / call-site shims need to coexist with the new model, and how long do they live?

Spec to be authored via `/spec-from-issue` and saved under `pd-prep-for-pgdp/docs/specs/`.

Spec: docs/specs/2026-05-11-project-fanout-awaiting-review-design.md
~~~~~~~~

## #46 Spec: full-text search across OCR pages

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB7jvBA`
- Author: ConcaveTrillion
- Created: 2026-05-11T21:47:29Z
- Closed: 2026-05-11T23:32:28Z
- Labels: effort:L, kind:spec, status:backlog, triage:proposed-by-agent
- Milestone: none

### Body

~~~~~~~~text
Tracks: #14

Tracks: #14

Spec for full-text search across OCR pages within a project, motivated by usability for books with many hundreds of pages.

## Open questions for the spec to answer

- What is the underlying index (storage choice, schema) and how is it kept current as OCR text changes?
- What is the search entry point in the UI, and what does a result look like (snippet, ranking, navigation target)?
- What invariants tie the search index to the OCR pipeline (e.g., when is a page eligible to appear in results)?
- Does the design need to anticipate a future non-local backend, and if so, what does it commit to and defer?

Spec to be authored via `/spec-from-issue` and saved under `pd-prep-for-pgdp/docs/specs/`.

Spec: docs/specs/2026-05-11-search-across-pages-design.md
~~~~~~~~

## #47 Spec: per-page pipeline task model (granular stages + dirty propagation)

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB7j9Mg`
- Author: ConcaveTrillion
- Created: 2026-05-11T21:48:16Z
- Closed: 2026-05-11T23:27:39Z
- Labels: effort:L, kind:spec, status:backlog, triage:proposed-by-agent
- Milestone: none

### Body

~~~~~~~~text
Tracks: #17

Tracks: #17

Spec for the foundational per-page pipeline task model: how a page's work is broken into granular stages, how those stages relate, and how staleness propagates when any input changes.

## Open questions for the spec to answer

- What is the unit of work for a page's pipeline, and how do units relate (linear chain? DAG?)?
- How does the design treat re-entrant work — i.e., when an upstream input changes, what downstream state is invalidated and how is that visible?
- How does pipeline state persist between runs, and what guarantees does the storage layer give?
- What is the API surface for invoking a unit of work and inspecting its outputs?
- How does the runtime select which concrete implementation handles a given unit of work?
- How does the model accommodate pages that are not full DAG participants (e.g., variant page types) and pages that derive from other pages?

Spec to be authored via `/spec-from-issue` and saved under `pd-prep-for-pgdp/docs/specs/`. Note: a freeform pre-existing document at `pd-prep-for-pgdp/docs/specs/pipeline-task-model.md` already drives shipped M1 + in-flight M2 work; reconciliation between the new pipeline-authored spec and that existing document is out of scope for this triage and will be handled when the new spec PR lands.

Spec: docs/specs/2026-05-11-pipeline-task-model-design.md
~~~~~~~~

## #52 Splits: POST /split endpoint + create sibling Page rows

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB8MkqA`
- Author: ConcaveTrillion
- Created: 2026-05-12T00:11:09Z
- Closed: 2026-05-13T01:18:54Z
- Labels: bot:ship-issue-ready, effort:M, kind:feature, model-effort:medium, model:sonnet, status:in-pr
- Milestone: spec: pipeline-task-model-granular-per-page (#47)

### Body

~~~~~~~~text
Implement the backend endpoint that creates split-child sibling pages.

## Scope

- `POST /api/data/projects/{id}/pages/{idx0}/split` accepts `{bbox: [x,y,w,h], split_at_stage: str, suffixes: [str, ...]}`.
- Creates N sibling `Page` rows populated with `parent_page_id`, `source_crop_bbox`, `split_index`, `split_at_stage`, `split_suffix`, `reading_order`.
- Created children start at post-ingest state; their `page_stages` rows are created lazily as `not-run` per the existing per-page-stage shape.
- Recursive splits supported (a child of a child); `parent_page_id` chain is finite and acyclic by construction.

## Design context (from `docs/specs/pipeline-task-model.md` §Splits as sibling pages)

> A split turns one parent page into N sibling child pages, each of which starts at the post-ingest stage and runs the full pipeline independently. This replaces the older notion of splits as configuration on `ocr_crop`.
>
> Every page row carries: `parent_page_id` (FK to parent), `source_crop_bbox` (x,y,w,h on the parent's source image, original-source coords; required when `parent_page_id IS NOT NULL`), `split_index` (1-based among siblings), `split_at_stage` (the stage on the parent where the split was created, recorded as string), `reading_order`, `split_suffix` (user-chosen prefix suffix).

## Acceptance

- POSTing `{bbox: [...], split_at_stage: "auto_detect_attrs", suffixes: ["a","b"]}` creates 2 child page rows visible in the project page list.
- Each child row has the six split columns correctly populated.
- Existing single-page pipeline tests still pass.
- Recursive splits work (a child can be split into grandchildren).

Supersedes existing #39; close that issue as superseded after this lands.

Tracks: #47
Spec: docs/specs/2026-05-11-pipeline-task-model-design.md
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:25:06Z

~~~~~~~~text
Armed for ship-issue cycle by arm-issue.py. parent-spec: #47 (merged in PR #48). Override with `gh issue edit` if wrong.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-12T00:36:47Z

~~~~~~~~text
Claimed by ship-issue.

- Model: `sonnet` / effort: `medium`
- Spec: `docs/specs/2026-05-11-pipeline-task-model-design.md`
- Pre-claim SHA: `bcd33b92cce42dbbdaeee27fe1f52b59c9bc55ff`

Acceptance:
(none)
~~~~~~~~

## #53 Splits: decode_source bbox crop + (parent_id, bbox) input_hash

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB8Mk8Q`
- Author: ConcaveTrillion
- Created: 2026-05-12T00:11:10Z
- Closed: 2026-05-14T09:46:28Z
- Labels: bot:ship-issue-ready, effort:S, kind:feature, model-effort:medium, model:sonnet, status:in-pr
- Milestone: spec: pipeline-task-model-granular-per-page (#47)

### Body

~~~~~~~~text
Make split-child `decode_source` read the parent's source image and crop to the child's `source_crop_bbox`, with the input hash recording the parent reference.

## Scope

- When `STAGE_IMPL["decode_source"]` runs on a child page (`parent_page_id IS NOT NULL`), it reads the parent's `source_image` artifact and crops to `source_crop_bbox`.
- The stage's `input_hash` incorporates `(parent_page_id, source_crop_bbox)` so a parent re-ingest correctly marks the child's `decode_source` dirty.
- Coordinate space: bbox is in original-source coordinates (before any per-page transforms).

## Design context (from `docs/specs/pipeline-task-model.md` §Splits)

> A child page's `page_stages` rows look identical to a root page's rows. The row count is the same. Differences:
>
> + `decode_source` reads the parent's source image, then crops to `source_crop_bbox`. This is recorded in the stage's `input_hash` alongside the `(parent_id, bbox)` so a parent re-ingest correctly marks the child's `decode_source` dirty.

## Acceptance

- Running `decode_source` on a split child produces a cropped PNG matching the bbox region of the parent's source image.
- The child's `decode_source` `input_hash` is a deterministic function of `(parent_page_id, source_crop_bbox)` and changes if either changes.
- Re-running `ingest_source` on the parent dirties the child's `decode_source` (cross-page dirty propagation works through the bbox-input dependency).

Blocked-by: #52

Supersedes existing #40.

Tracks: #47
Spec: docs/specs/2026-05-11-pipeline-task-model-design.md

Blocked-by: #79
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:27:06Z

~~~~~~~~text
Armed for ship-issue cycle by arm-issue.py. parent-spec: #47 (merged in PR #48). Override with `gh issue edit` if wrong.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-12T17:37:54Z

~~~~~~~~text
Claimed by ship-issue-1.

- Model: `sonnet` / effort: `medium`
- Spec: `docs/specs/2026-05-11-pipeline-task-model-design.md`
- Pre-claim SHA: `4d64a25ff38d701bdab8b4623cc5ee7a8120b020`

Acceptance:
(none)
~~~~~~~~

### Comment 3 by ConcaveTrillion at 2026-05-12T17:55:40Z

~~~~~~~~text
ship-issue: bounced.

**Reason:** rebase conflict during push serialization onto wip/ship-issue

**Pre-claim SHA:** `4d64a25ff38d701bdab8b4623cc5ee7a8120b020` (work is recoverable from reflog if you want it)

The issue has been moved to `status:bounced` and `bot:ship-issue-ready` removed. To retry: triage the bounce reason, then run `scripts/arm-issue.py` (or manually add `bot:ship-issue-ready` and swap `status:bounced` → `status:ready`).
~~~~~~~~

### Comment 4 by ConcaveTrillion at 2026-05-13T10:22:43Z

~~~~~~~~text
Cleaned up by ship-issue-cleanup-bounced.py.

No escalation history found; model/effort labels unchanged. Deleted 0 escalation comment(s) so the retry counter resets to 0. Issue is re-armed (`status:ready` + `bot:ship-issue-ready`) and will be picked up on the next cycle.
~~~~~~~~

### Comment 5 by ConcaveTrillion at 2026-05-13T12:02:17Z

~~~~~~~~text
Claimed by ship-issue-0.

- Model: `sonnet` / effort: `medium`
- Spec: `docs/specs/2026-05-11-pipeline-task-model-design.md`
- Pre-claim SHA: `66d62b7789c9918dbc136119a4d58e821d36c1d1`

Acceptance:
(none)
~~~~~~~~

## #54 Splits: compute_prefix recursion + split_suffix composition

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB8MlNQ`
- Author: ConcaveTrillion
- Created: 2026-05-12T00:11:12Z
- Closed: 2026-05-13T01:18:56Z
- Labels: bot:ship-issue-ready, effort:S, kind:feature, model-effort:low, model:sonnet, status:in-pr
- Milestone: spec: pipeline-task-model-granular-per-page (#47)

### Body

~~~~~~~~text
Extend page-prefix resolution so split children get composite prefixes (`p045` + `a` -> `p045a`; grandchildren -> `p045ab`).

## Scope

- `compute_prefix(page_id, project, pages)` walks up the `parent_page_id` chain. For a child page: compute the parent's prefix as if the child didn't exist, then append the child's `split_suffix`.
- Recursive splits compose left-to-right.
- `build_package` flattens prefixes into PGDP filenames using `<full_prefix>.png` / `<full_prefix>.txt` (existing convention preserved).

## Design context (from `docs/specs/pipeline-task-model.md` §Splits > Numbering / prefix resolution)

> `compute_prefix(page_id, project, pages)` recurses up the `parent_page_id` chain. For a child page:
>
> 1. Compute the parent's prefix as if the child didn't exist.
> 2. Append the child's `split_suffix` to the parent's prefix.
>
> For example, a parent at `idx0=49` resolving to `p045` plus a child with `split_suffix="a"` resolves to `p045a`. Recursive splits compose left-to-right: a grandchild whose parent is `p045a` and whose own suffix is `b` resolves to `p045ab`.

## Acceptance

- `compute_prefix` returns `p045a` for a child of `idx0=49` parent (with parent prefix `p045`) and `split_suffix="a"`.
- Grandchild composition works (`p045ab`).
- Existing root-page prefix tests still pass (no regression for `parent_page_id IS NULL`).
- `build_package` filename generation uses the composite prefix.

Blocked-by: #52

Supersedes existing #41.

Tracks: #47
Spec: docs/specs/2026-05-11-pipeline-task-model-design.md
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:27:09Z

~~~~~~~~text
Armed for ship-issue cycle by arm-issue.py. parent-spec: #47 (merged in PR #48). Override with `gh issue edit` if wrong.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-12T17:42:38Z

~~~~~~~~text
Claimed by ship-issue-0.

- Model: `sonnet` / effort: `low`
- Spec: `docs/specs/2026-05-11-pipeline-task-model-design.md`
- Pre-claim SHA: `4d64a25ff38d701bdab8b4623cc5ee7a8120b020`

Acceptance:
(none)
~~~~~~~~

## #55 Splits: cross-page dirty propagation for split children

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB8Mlfw`
- Author: ConcaveTrillion
- Created: 2026-05-12T00:11:13Z
- Closed: 2026-05-14T09:46:28Z
- Labels: bot:ship-issue-ready, effort:S, kind:feature, model-effort:medium, model:sonnet, status:in-pr
- Milestone: spec: pipeline-task-model-granular-per-page (#47)

### Body

~~~~~~~~text
When a parent page's stage at or before `split_at_stage` re-runs, mark each split child's `decode_source` row dirty (their input -- the parent's K-output cropped to bbox -- has changed).

## Scope

- Eager dirty propagation extended across the parent->child boundary.
- Hook: on every `page_stages` UPDATE that flips a parent row to `clean`, check whether any child rows exist (`SELECT child page_ids WHERE parent_page_id = parent_id`). If the stage is at or before each child's `split_at_stage`, mark the child's `decode_source` dirty (which then cascades downstream within the child via existing eager rule).
- A stage **after** each child's `split_at_stage` does NOT dirty the child (the split is already past).

## Design context (from `docs/specs/pipeline-task-model.md` §Dirty propagation > Cross-page dirty propagation: split children)

> When a parent page's stage K reruns and that K is upstream of the split point, all child pages' `decode_source` rows are also marked dirty (their input -- the parent's K-output, cropped to `source_crop_bbox` -- has changed). The framework handles this by treating each split child as a normal downstream consumer of its parent's `split_at_stage` output.

## Acceptance

- Re-running `ingest_source` on a parent that has 2 split children flips both children's `decode_source` chips to `dirty`.
- Re-running a stage **after** `split_at_stage` on the parent does NOT dirty the children.
- Existing single-page dirty-propagation tests still pass.

Blocked-by: #52, #53

Supersedes existing #20.

Tracks: #47
Spec: docs/specs/2026-05-11-pipeline-task-model-design.md

Blocked-by: #79

Blocked-by: #106
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:27:13Z

~~~~~~~~text
Armed for ship-issue cycle by arm-issue.py. parent-spec: #47 (merged in PR #48). Override with `gh issue edit` if wrong.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-13T13:02:29Z

~~~~~~~~text
Claimed by ship-issue-0.

- Model: `sonnet` / effort: `medium`
- Spec: `docs/specs/2026-05-11-pipeline-task-model-design.md`
- Pre-claim SHA: `3e9a1ddf5321ee9a9f8e411eca14f130cbda84fc`

Acceptance:
(none)
~~~~~~~~

## #56 Splits: workbench page-list + reverse-split UI

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB8MmYQ`
- Author: ConcaveTrillion
- Created: 2026-05-12T00:11:14Z
- Closed: 2026-05-13T01:18:57Z
- Labels: bot:ship-issue-ready, effort:M, kind:feature, model-effort:medium, model:sonnet, status:in-pr
- Milestone: spec: pipeline-task-model-granular-per-page (#47)

### Body

~~~~~~~~text
Workbench affordances for split parents and children: page list hides parents by default, auto-suffix labels for children, reverse-split action.

## Scope

- Page list **hides split parents by default**. A "Show split parents" toggle reveals them.
- Split children appear with auto-suffixed labels: parent prefix `f042` -> children `f042-1`, `f042-2` (using `split_index`); user-facing `split_suffix` (`a`, `b`, `cl`) shown next to the numeric suffix when present.
- **Reverse split** affordance on each child page:
  1. Deletes all sibling rows of that child.
  2. Restores the parent to visible.
  3. Marks deleted children's on-disk artifacts for cleanup by reindex.
  4. Does **not** modify the parent's `page_stages` rows.
- Split-creation tooling: a "Create split" button on the parent's workbench enters bbox-drawing mode against the currently-selected stage artifact (typically `auto_detect_attrs` or `auto_deskew`); on commit calls `POST /split` and redirects to the first child.

## Design context (from `docs/specs/pipeline-task-model.md` §Splits > Workbench treatment)

> The page list **hides the parent by default**. A "Show split parents" toggle reveals it.
> Children appear as auto-suffixed entries: parent prefix `f042` -> children `f042-1`, `f042-2`, ... in the list. The numeric suffix is the `split_index`; the user-facing `split_suffix` is shown next to it.
> Each child page is a normal workbench target -- opening it shows the full stage chain, with `decode_source` driven by the `source_crop_bbox` rather than the parent's full source.
> A "Reverse split" affordance on any child: (1) deletes all sibling rows; (2) restores the parent to visible; (3) marks all derived stage state on the deleted children as discarded; (4) does NOT modify the parent's stage state.

## Acceptance

- Page list for a project with one split parent shows only the children by default; toggling "Show split parents" reveals the parent row.
- Clicking "Reverse split" on child 1 of 2 deletes both children and the parent reappears in the list.
- `pgdp-prep reindex` after reverse-split removes orphaned stage-artifact directories.
- "Create split" entry point produces the same backend call as `POST /split` directly.

Blocked-by: #52

Supersedes existing #21.

Tracks: #47
Spec: docs/specs/2026-05-11-pipeline-task-model-design.md
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:27:17Z

~~~~~~~~text
Armed for ship-issue cycle by arm-issue.py. parent-spec: #47 (merged in PR #48). Override with `gh issue edit` if wrong.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-12T17:49:27Z

~~~~~~~~text
Claimed by ship-issue-0.

- Model: `sonnet` / effort: `medium`
- Spec: `docs/specs/2026-05-11-pipeline-task-model-design.md`
- Pre-claim SHA: `d57ea0015080c6de54053da0b82425acb2373dd8`

Acceptance:
(none)
~~~~~~~~

### Comment 3 by ConcaveTrillion at 2026-05-12T21:18:04Z

~~~~~~~~text
Claimed by ship-issue-0.

- Model: `sonnet` / effort: `medium`
- Spec: `docs/specs/2026-05-11-pipeline-task-model-design.md`
- Pre-claim SHA: `1fc8d4ac3d80d0777578b9fbc9650cd45b238a94`

Acceptance:
(none)
~~~~~~~~

## #57 Splits: build_package sibling sort order + reindex support

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB8Mmsw`
- Author: ConcaveTrillion
- Created: 2026-05-12T00:11:16Z
- Closed: 2026-05-13T01:18:57Z
- Labels: bot:ship-issue-ready, effort:S, kind:feature, model-effort:low, model:sonnet, status:in-pr
- Milestone: spec: pipeline-task-model-granular-per-page (#47)

### Body

~~~~~~~~text
Make `build_package` iterate pages in `(parent_idx0, split_index)` order so sibling pages stay adjacent in the zip, and extend `pgdp-prep reindex` to reconcile child page stages.

## Scope

- `build_package` sort: pages iterate in `(parent_idx0, split_index)` order across the project. Root pages sort by `idx0`; siblings by their `split_index` within the parent's idx0 slot.
- `pgdp-prep reindex` and `pgdp-prep reindex --heal` correctly walk split children: synthesise missing `page_stages` rows, detect drift between DB rows and on-disk artifacts under `pages/<child_page_id>/stages/`.
- After a reverse-split, reindex cleans up orphaned on-disk artifact directories.

## Design context (from `docs/specs/pipeline-task-model.md` §Splits)

> `build_package` flattens prefixes into PGDP filenames using `<full_prefix>.png` / `<full_prefix>.txt` -- the existing convention. The package iterates pages in `(parent_idx0, split_index)` order so sibling pages stay adjacent in the zip.

## Acceptance

- Building a package on a project with one split (2 children) produces a zip whose files appear in `(parent_idx0=N, split_index=1)`, `(N, 2)`, then `(N+1, NULL)` order.
- `pgdp-prep reindex` on a project with split children does not error and produces a consistent state (DB rows match on-disk artifacts).
- After `pgdp-prep reindex --heal` runs, any drift is repaired without data loss on either side.
- A reverse-split followed by reindex cleans up the orphaned `pages/<deleted_child_id>/` directory.

Blocked-by: #52, #54

Supersedes existing #42.

Tracks: #47
Spec: docs/specs/2026-05-11-pipeline-task-model-design.md
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:27:21Z

~~~~~~~~text
Armed for ship-issue cycle by arm-issue.py. parent-spec: #47 (merged in PR #48). Override with `gh issue edit` if wrong.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-12T17:55:45Z

~~~~~~~~text
Claimed by ship-issue-1.

- Model: `sonnet` / effort: `low`
- Spec: `docs/specs/2026-05-11-pipeline-task-model-design.md`
- Pre-claim SHA: `4d64a25ff38d701bdab8b4623cc5ee7a8120b020`

Acceptance:
(none)
~~~~~~~~

## #58 Pipeline: blank-page + plate short circuits (not-applicable stage marking)

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB8MnAQ`
- Author: ConcaveTrillion
- Created: 2026-05-12T00:11:18Z
- Closed: 2026-05-13T01:18:54Z
- Labels: bot:ship-issue-ready, effort:M, kind:feature, model-effort:medium, model:sonnet, status:in-pr
- Milestone: spec: pipeline-task-model-granular-per-page (#47)

### Body

~~~~~~~~text
Mark stages `not-applicable` for blank and plate page types so the chip rail and dirty-cascade treat them correctly.

## Scope

- For `page_type in {blank, plate_b, plate_r}`: stages `decode_source` through `morph_fill` are marked `not-applicable`; the page routes through `blank_proof_synth` (which depends on `auto_detect_attrs`).
- For `page_type=plate_p`: OCR and text stages (`ocr_crop`, `ocr`, `text_postprocess`, `text_review`) are marked `not-applicable`; `extract_illustrations` does the real work.
- `not-applicable` is a distinct status from `clean`/`dirty`/`not-run` -- the chip rail renders it as slate-50 italic (frontend rendering already wired in M2).
- Stage runner detects `page_type` at run time and short-circuits rather than dispatching to `STAGE_IMPL`.
- Attempting to run a `not-applicable` chip returns HTTP 422 with a clear message.

## Design context (from `docs/specs/pipeline-task-model.md` §Per-page stage DAG)

The page-type variants are part of the canonical DAG: a `blank` or `plate_*` page does not run through the full image-cleanup chain. `auto_detect_attrs` writes `page_type` onto the `PageRecord`, and downstream stages key off that value to decide whether to execute or mark `not-applicable`.

## Acceptance

- Uploading a blank page and running ingest -> `auto_detect_attrs` flips `decode_source`...`morph_fill` chips to `not-applicable` automatically.
- Clicking a `not-applicable` chip's Run affordance returns 422 with a clear message.
- For `page_type=plate_p`, OCR/text stage chips are `not-applicable` and `extract_illustrations` is the meaningful work.
- Existing integration tests for the normal chain still pass.

Supersedes existing #18.

Tracks: #47
Spec: docs/specs/2026-05-11-pipeline-task-model-design.md
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:25:09Z

~~~~~~~~text
Armed for ship-issue cycle by arm-issue.py. parent-spec: #47 (merged in PR #48). Override with `gh issue edit` if wrong.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-12T02:20:13Z

~~~~~~~~text
Claimed by ship-issue.

- Model: `sonnet` / effort: `medium`
- Spec: `docs/specs/2026-05-11-pipeline-task-model-design.md`
- Pre-claim SHA: `e40f98ccf68df851f2b09b944e2c6d15804c8ee0`

Acceptance:
(none)
~~~~~~~~

## #59 Pipeline: stage versioning enforcement (STAGE_VERSIONS + dirty-on-bump)

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB8MnTg`
- Author: ConcaveTrillion
- Created: 2026-05-12T00:11:19Z
- Closed: 2026-05-13T01:18:55Z
- Labels: bot:ship-issue-ready, effort:S, kind:feature, model-effort:low, model:sonnet, status:in-pr
- Milestone: spec: pipeline-task-model-granular-per-page (#47)

### Body

~~~~~~~~text
Add the `STAGE_VERSIONS` dict to `core/pipeline/dag.py` and enforce dirty-on-version-bump when reading `page_stages` rows.

## Scope

- Add `STAGE_VERSIONS: dict[str, int]` to `core/pipeline/dag.py` with all 22 stage IDs at version 1.
- In `run_stage` and the lazy-init path that reads `page_stages` rows: if stored `stage_version < STAGE_VERSIONS[stage_id]`, treat the row as `dirty` regardless of stored status; update `stage_version` on the next successful run.
- `pgdp-prep reindex --heal` applies the version check and re-marks stale rows dirty without running the stages.
- Manual bump instruction in `dag.py` docstring: bump `STAGE_VERSIONS[stage_id]` when the stage algorithm changes (e.g. after a `pd-book-tools` upgrade).
- Auto-derive (hash of stage source) is explicitly deferred unless manual bumping becomes a chronic source of bugs.

## Design context (from `docs/specs/pipeline-task-model.md` §Stage versioning (Q4 lock))

> Each stage has an integer `stage_version` in a static registry: `STAGE_VERSIONS = {"ingest_source": 1, "thumbnail": 1, "auto_detect_attrs": 1, ...}`.
>
> Bump by hand when the stage's algorithm changes. On read of a `page_stages` row, if `stage_version < STAGE_VERSIONS[stage_id]`, the row is treated as `dirty` regardless of stored status. The next stage rerun overwrites the version.
>
> Auto-derive (hash of stage source) is deferred unless manual bumping becomes a chronic source of bugs.

## Acceptance

- A `page_stages` row with `stage_version=1` and a bumped `STAGE_VERSIONS[stage_id]=2` is served as `dirty` by the GET /stages route.
- After re-running the stage, the row's `stage_version` is updated to 2 and status becomes `clean`.
- `pgdp-prep reindex --heal` marks all stale-version rows dirty without running the stages.
- `dag.py` docstring documents the manual bump procedure.

Supersedes existing #22.

Tracks: #47
Spec: docs/specs/2026-05-11-pipeline-task-model-design.md
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:25:12Z

~~~~~~~~text
Armed for ship-issue cycle by arm-issue.py. parent-spec: #47 (merged in PR #48). Override with `gh issue edit` if wrong.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-12T02:50:13Z

~~~~~~~~text
Claimed by ship-issue.

- Model: `sonnet` / effort: `low`
- Spec: `docs/specs/2026-05-11-pipeline-task-model-design.md`
- Pre-claim SHA: `4ec7f615867df747ed2c8f8652252ebd40486ca6`

Acceptance:
(none)
~~~~~~~~

## #60 Pipeline: bounded deferred-write executor (Q8/Q9 lock)

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB8MnlQ`
- Author: ConcaveTrillion
- Created: 2026-05-12T00:11:20Z
- Closed: 2026-05-13T01:18:55Z
- Labels: bot:ship-issue-ready, effort:M, kind:feature, model-effort:medium, model:sonnet, status:in-pr
- Milestone: spec: pipeline-task-model-granular-per-page (#47)

### Body

~~~~~~~~text
Implement the bounded deferred-write executor that makes stage writes happen off the DAG critical path, with loud failure semantics.

## Scope

- Bounded `ThreadPoolExecutor` (or equivalent) with bounded queue submits stage-write tasks: serialize the in-memory artifact, write to disk, commit the `page_stages` row transactionally.
- Default pool size: `min(cpu_count(), 4)`; queue cap: `4 x pool_size`.
- Knobs: `PGDP_STAGE_WRITE_POOL_SIZE` and `PGDP_STAGE_WRITE_QUEUE_CAP` env vars.
- Queue full -> executor blocks submitter (DAG pauses). This is intentional back-pressure: the alternative is unbounded RAM growth.
- Any write failure marks the stage `status='failed'` and propagates dirty to descendants (Q9 -- fail loudly).
- Drop-on-last-consumer: once an in-memory artifact has been consumed by all DAG dependents AND its persistence has been queued, the runner drops its reference for GC.

## Design context (from `docs/specs/pipeline-task-model.md` §Memory-resident execution model > Deferred disk writes)

> Every stage's output is destined for persistence (Q3 -- every intermediate, always). The write does not block the DAG. The serialized artifact is submitted to a bounded executor with a bounded queue (Q8) and the DAG immediately advances to the next stage on the in-memory copy.
>
> Failures in deferred writes are surfaced as a stage failure (Q9 -- fail loudly). They mark the row's `status` as `failed` and propagate dirty to all downstream stages.
>
> Together, Q3 + Q9 mean disk hiccups would crash the DAG without back-pressure. Q8 (bounded executor, bounded queue) is therefore load-bearing -- when disk is slow, the DAG executor blocks on submission rather than letting the in-flight write set grow unboundedly. This is intentional: blocking the DAG on a slow disk is the correct behavior because the alternative is RAM growth that ends in OOM.

## Acceptance

- Stage runs submit writes to the executor and advance immediately on the in-memory artifact.
- A simulated slow-disk run causes the executor to back-pressure (DAG pauses on submit, does not OOM).
- Forcing a write failure marks the stage `status='failed'` and dirties descendants.
- Pool/queue size env knobs take effect at startup.
- Drop-on-last-consumer keeps peak RAM bounded for a multi-stage DAG run on a large page.

Supersedes existing #5.

Tracks: #47
Spec: docs/specs/2026-05-11-pipeline-task-model-design.md
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:25:15Z

~~~~~~~~text
Armed for ship-issue cycle by arm-issue.py. parent-spec: #47 (merged in PR #48). Override with `gh issue edit` if wrong.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-12T03:20:16Z

~~~~~~~~text
Claimed by ship-issue.

- Model: `sonnet` / effort: `medium`
- Spec: `docs/specs/2026-05-11-pipeline-task-model-design.md`
- Pre-claim SHA: `8adff7748c8cae29a4d019b71f9de74d418d776c`

Acceptance:
(none)
~~~~~~~~

## #61 Pipeline: ResolvedPageConfig plumbing into stage runner

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB8Mn_Q`
- Author: ConcaveTrillion
- Created: 2026-05-12T00:11:22Z
- Closed: 2026-05-13T01:18:56Z
- Labels: bot:ship-issue-ready, effort:M, kind:feature, model-effort:medium, model:sonnet, status:in-pr
- Milestone: spec: pipeline-task-model-granular-per-page (#47)

### Body

~~~~~~~~text
Plumb `ResolvedPageConfig` (per-page config overrides merged with project defaults) into the stage runner so each stage receives its current resolved config at run time.

## Scope

- Stage runner reads `pages.config_overrides` and merges with project-level `ResolvedPageConfig` defaults.
- Each `STAGE_IMPL[stage_id][device]` receives a fully-resolved config object, not a partial dict or raw override dict.
- Stage's `input_hash` includes the config-field subset that the stage actually reads (so a config change to a field a stage does NOT read does not cause an unnecessary re-run).
- Wired through the existing async run route + the per-page-stage GET route.

## Design context (from `docs/specs/pipeline-task-model.md` §Memory-resident execution model + §Workbench UX)

> Writes: selecting a stage -> populates Stage controls panel with the subset of `ResolvedPageConfig` fields relevant to that stage (a static map on the frontend). "Apply" PATCHes `page.config_overrides`, then fires `POST /api/pages/{page_id}/stages/{stage_id}/run`.

The stage runner must read those `config_overrides` and merge them into a `ResolvedPageConfig` instance that the stage implementation consumes. The merged result drives both the actual processing and the stage's `input_hash` so that dirty propagation correctly invalidates downstream stages whose inputs include `ResolvedPageConfig` fields.

## Acceptance

- A `STAGE_IMPL[stage_id][device]` callable receives a fully-typed `ResolvedPageConfig` instance.
- Changing `pages.config_overrides["threshold_level"]` re-dirties `threshold` and downstream stages but does NOT dirty stages that don't read `threshold_level`.
- The async run route reads the latest `config_overrides` at run time (not at request time).
- Existing M2 stage tests still pass.

Supersedes existing #6.

Tracks: #47
Spec: docs/specs/2026-05-11-pipeline-task-model-design.md
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:25:19Z

~~~~~~~~text
Armed for ship-issue cycle by arm-issue.py. parent-spec: #47 (merged in PR #48). Override with `gh issue edit` if wrong.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-12T03:50:19Z

~~~~~~~~text
Claimed by ship-issue.

- Model: `sonnet` / effort: `medium`
- Spec: `docs/specs/2026-05-11-pipeline-task-model-design.md`
- Pre-claim SHA: `ef61479b8e11717e2417ed1d624a683c2a9f362f`

Acceptance:
(none)
~~~~~~~~

## #62 M3: stage thumbnail endpoint + artifact-URL cache-busting

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB8NZuw`
- Author: ConcaveTrillion
- Created: 2026-05-12T00:14:23Z
- Closed: 2026-05-13T01:18:56Z
- Labels: bot:ship-issue-ready, effort:S, kind:feature, model-effort:low, model:sonnet, status:in-pr
- Milestone: spec: m3-workbench-artifact-viewer-stage (#44)

### Body

~~~~~~~~text
Backend endpoint that serves a small inline PNG per stage's clean output, and cache-busting on the existing stage-artifact URL.

## Scope

- `GET /api/data/projects/{id}/pages/{idx0}/stages/{stage_id}/thumbnail` returns a small (e.g. 400px) PNG of the stage's clean output. 404 when the stage row is `not-run` or `not-applicable`. 304 ETag/Last-Modified support so the chip rail can render efficiently.
- The existing stage-artifact endpoint (`GET .../stages/{stage_id}/artifact`, shipped in M2 commit `55dbc9d`) accepts a `?v=<last_run_at>` query parameter and uses it for cache-busting. A re-run mutates `last_run_at`, so the URL changes and the browser fetches fresh bytes.
- Thumbnails generated at stage write time (per the spec's recommendation), stored alongside the stage artifact under `pages/<page_id>/stages/<stage_id>.thumb.png`.

## Design context (from `docs/specs/2026-05-11-workbench-artifact-viewer-design.md` §Decision + §Consequences)

> **Cache-busting:** artifact URLs include `?v=<page_stages.last_run_at>` (RFC 3339 timestamp). A re-run mutates `last_run_at` -> URL changes -> browser fetches fresh bytes.
>
> **Thumbnails: on-demand vs pre-generated.** Pre-generating at stage-write time costs disk and write latency; on-demand at artifact-serve time costs CPU at view time but composes with the existing `thumbnail` stage's logic. Decided: pre-generated per stage.

## Acceptance

- `GET .../stages/threshold/thumbnail` on a clean page returns a small PNG.
- The same endpoint returns 404 on `not-run`/`not-applicable` stages.
- After re-running a stage, the artifact URL with `?v=...` differs from the prior URL; the browser fetches new bytes.
- Thumbnail bytes are persisted at write time (no on-demand CPU cost on the read path).

Supersedes existing #24.

Tracks: #44
Spec: docs/specs/2026-05-11-workbench-artifact-viewer-design.md
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:25:22Z

~~~~~~~~text
Armed for ship-issue cycle by arm-issue.py. parent-spec: #44 (merged in PR #49). Override with `gh issue edit` if wrong.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-12T04:20:22Z

~~~~~~~~text
Claimed by ship-issue.

- Model: `sonnet` / effort: `low`
- Spec: `docs/specs/2026-05-11-workbench-artifact-viewer-design.md`
- Pre-claim SHA: `58b68c4c6a8aeea1a00ac05dcdcc156b90d545f5`

Acceptance:
(none)
~~~~~~~~

## #63 M3: polished chip rail — inline thumbnails, click-to-select, status pills

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB8NanQ`
- Author: ConcaveTrillion
- Created: 2026-05-12T00:14:24Z
- Closed: 2026-05-13T01:18:56Z
- Labels: bot:ship-issue-ready, effort:M, kind:feature, model-effort:medium, model:sonnet, status:in-pr
- Milestone: spec: m3-workbench-artifact-viewer-stage (#44)

### Body

~~~~~~~~text
Replace the M2 debug-style chip rail with the polished M3 chip rail.

## Scope

- 22 chips in DAG order, one per stage.
- Each chip shows: status pill (one of `clean`/`dirty`/`running`/`failed`/`not-applicable`/`not-run`), inline thumbnail of the stage's output when present (lazy-loaded as chips enter viewport), and a click-to-select handle.
- Clicking a chip with `status in {clean, dirty}` updates the `Stage` selector (consumed by the artifact viewer + controls panel components in sibling chores).
- Clicking a `not-run`/`not-applicable` chip is a no-op (or shows a tooltip explaining why).
- M2 debug rail UI code is deleted as part of this chore.

## Design context (from `docs/specs/2026-05-11-workbench-artifact-viewer-design.md` §Decision #1)

> 1. **Polished stage-chain rail.** 22 chips, one per stage, in DAG order. Each chip shows: status pill, inline thumbnail of the stage's output when present, and a click-to-select handle. Replaces the M2 debug panel.

## Acceptance

- Opening a fresh page in the workbench shows 22 chips with correct initial status (`not-run` everywhere except `ingest_source`/`thumbnail` which the project pipeline already ran).
- Clicking a `clean`/`dirty` chip updates the workbench's active stage state; the artifact viewer pane reflects it.
- Thumbnails lazy-load only as chips enter the viewport (perf check on a 22-chip rail).
- The old M2 debug panel UI code is removed from the workbench composition.

Blocked-by: #62 (M3 stage thumbnail endpoint). Supersedes existing #25.

Tracks: #44
Spec: docs/specs/2026-05-11-workbench-artifact-viewer-design.md
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:27:24Z

~~~~~~~~text
Armed for ship-issue cycle by arm-issue.py. parent-spec: #44 (merged in PR #49). Override with `gh issue edit` if wrong.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-12T04:50:24Z

~~~~~~~~text
Claimed by ship-issue.

- Model: `sonnet` / effort: `medium`
- Spec: `docs/specs/2026-05-11-workbench-artifact-viewer-design.md`
- Pre-claim SHA: `f18369f63acbdee5514c6e799486de8ca437a3a1`

Acceptance:
(none)
~~~~~~~~

## #64 M3: side-by-side artifact viewer (Stage + Compare selectors)

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB8Na6g`
- Author: ConcaveTrillion
- Created: 2026-05-12T00:14:26Z
- Closed: 2026-05-13T01:18:56Z
- Labels: bot:ship-issue-ready, effort:M, kind:feature, model-effort:medium, model:sonnet, status:in-pr
- Milestone: spec: m3-workbench-artifact-viewer-stage (#44)

### Body

~~~~~~~~text
Add the artifact viewer pane that renders two stage artifacts side-by-side at the same scale.

## Scope

- Two selectors: `Stage: [▼]` and `Compare with: [▼]`. Both list stages with `status in {clean, dirty}` (artifact present).
- Default `Compare with` is the immediate upstream stage (highest-utility default for the "why did this regression happen?" workflow).
- Both panes stream from the artifact endpoint (`GET .../stages/{stage_id}/artifact?v=<last_run_at>`) and render at full image resolution side-by-side at the same scale.
- Non-image stages (e.g. `find_content_edges` returns a 4-tuple, `auto_detect_attrs` writes onto the page record) render as a small numeric/textual artifact rather than image preview.
- `extract_illustrations` is a stage in the chain but its artifact is the hi-res crop set; reuse the existing illustration panel from `specs/06-page-workbench.md` for that case.

## Design context (from `docs/specs/2026-05-11-workbench-artifact-viewer-design.md` §Decision #2 + §Trade-offs)

> 2. **Side-by-side artifact viewer.** Two `Stage: [▼]` selectors (`Stage`, `Compare with`). The two artifacts stream from the artifact endpoint and render at the same scale. Default `Compare with` is the immediate upstream stage.
>
> **Compare-with default: previous-stage vs same-stage on another page vs none.** Previous-stage is the highest-utility default for the "why did this regression happen?" workflow; users can pick something else from the selector.

## Acceptance

- Opening `threshold` auto-selects `grayscale` as Compare; both images render at full image resolution side-by-side.
- Selectors only offer stages with present artifacts.
- Non-image stages render appropriately (text/numeric for `find_content_edges`, illustration panel for `extract_illustrations`).
- Switching selectors triggers a fresh artifact fetch with the new `?v=` URL.

Blocked-by: #62 (M3 stage thumbnail endpoint + artifact-URL cache-busting). Supersedes existing #26.

Tracks: #44
Spec: docs/specs/2026-05-11-workbench-artifact-viewer-design.md
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:27:27Z

~~~~~~~~text
Armed for ship-issue cycle by arm-issue.py. parent-spec: #44 (merged in PR #49). Override with `gh issue edit` if wrong.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-12T05:20:26Z

~~~~~~~~text
Claimed by ship-issue.

- Model: `sonnet` / effort: `medium`
- Spec: `docs/specs/2026-05-11-workbench-artifact-viewer-design.md`
- Pre-claim SHA: `214df0b1d50b49be56c1fafe673945f5139f6b49`

Acceptance:
(none)
~~~~~~~~

## #65 M3: stage-controls panel (field-to-stage map + Apply + Run)

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB8NbNw`
- Author: ConcaveTrillion
- Created: 2026-05-12T00:14:27Z
- Closed: 2026-05-14T09:46:29Z
- Labels: bot:ship-issue-ready, effort:M, kind:feature, model-effort:high, model:sonnet, status:in-pr
- Milestone: spec: m3-workbench-artifact-viewer-stage (#44)

### Body

~~~~~~~~text
Stage-controls panel that filters `ResolvedPageConfig` to the fields the selected stage actually reads, plus Apply + Run buttons.

## Scope

- New backend endpoint: `GET /api/data/pipeline/stages/{stage_id}/fields` returns a deterministic list of `ResolvedPageConfig` field names that stage's `STAGE_IMPL[stage_id]` actually reads. Source-of-truth recommendation per spec: a `read_fields` declaration on each `STAGE_IMPL[stage_id]` registration (so adding a stage automatically updates the map). Resolve this decision at implementation time.
- Frontend stage-controls panel renders inputs for those fields only (not the full `ResolvedPageConfig`).
- `Apply` button: PATCHes `pages.config_overrides`. Per spec's flagged open question, recommended semantics: `Apply` writes config + cascades dirty to downstream stages that read those fields; `Run` is a separate action. Confirm at slice time.
- `Run` button: fires `POST /api/data/projects/{id}/pages/{idx0}/stages/{stage_id}/run`.
- Integration test asserts the field-to-stage map matches what each stage's `STAGE_IMPL[stage_id]` actually reads (mismatch = bug).

## Design context (from `docs/specs/2026-05-11-workbench-artifact-viewer-design.md` §Decision #3 + §Open questions)

> 3. **Stage-controls panel.** Backed by a backend-served field-to-stage map. Renders `Apply` + `Run this stage` buttons. `Apply` mutates `ResolvedPageConfig` on the page; `Run` calls the existing stage-run endpoint.
>
> **Field-to-stage map source of truth.** Should the map be derived from a `read_fields` declaration on each `STAGE_IMPL[stage_id]` registration, or from a separate `stage_metadata.py` file? Recommend `read_fields` declaration on registration.
>
> **Stage-controls panel write semantics.** When the user clicks `Apply` without `Run`, does the page's `ResolvedPageConfig` mutate immediately (and dirty all downstream stages that read those fields), or only on `Run`? Recommend `Apply` writes config + cascades dirty; `Run` is a separate action.

## Acceptance

- `GET /api/data/pipeline/stages/threshold/fields` returns a deterministic list including `threshold_level` etc.
- Frontend panel filters fields to that subset only.
- `Apply` on a changed `threshold_level` PATCHes `config_overrides` and (per recommendation) cascades dirty.
- `Run` fires the stage-run endpoint; chip flickers through `running` -> `clean`.
- Integration test catches a mismatch between declared `read_fields` and actual reads.

Blocked-by: #61 (Pipeline: ResolvedPageConfig plumbing into stage runner). Supersedes existing #27.

Tracks: #44
Spec: docs/specs/2026-05-11-workbench-artifact-viewer-design.md

Blocked-by: #79

Blocked-by: #106
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:27:30Z

~~~~~~~~text
Armed for ship-issue cycle by arm-issue.py. parent-spec: #44 (merged in PR #49). Override with `gh issue edit` if wrong.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-12T05:50:26Z

~~~~~~~~text
Claimed by ship-issue.

- Model: `sonnet` / effort: `high`
- Spec: `docs/specs/2026-05-11-workbench-artifact-viewer-design.md`
- Pre-claim SHA: `4d64a25ff38d701bdab8b4623cc5ee7a8120b020`

Acceptance:
(none)
~~~~~~~~

### Comment 3 by ConcaveTrillion at 2026-05-12T06:13:21Z

~~~~~~~~text
ship-issue: bounced.

**Reason:** make ci failed: > vitest run --passWithNoTests


 RUN  v2.1.9 /srv/bot-workspaces/ship-issue/pd-prep-for-pgdp/frontend

 ✓ src/api/types.gen.test.ts (2 tests) 4ms
 ✓ src/lib/jwtClaims.test.ts (16 tests) 10ms
 ✓ src/lib/marquee.test.ts (12 tests) 11ms
 ✓ src/lib/lineDiff.test.ts (7 tests) 12ms
 ✓ src/lib/wordOffsets.test.ts (12 tests) 15ms
 ✓ src/components/FormErrorBanner.test.tsx (6 tests) 37ms
 ✓ src/lib/lineDiff.view.test.tsx (3 tests) 50ms
 ✓ src/api/pages.test.ts (6 tests) 90ms
 ✓ src/api/client.test.ts (3 tests) 79ms
 ✓ src/api/workbench.test.ts (5 tests) 89ms
 ✓ src/components/WordBboxOverlay.test.tsx (6 tests) 132ms
 ✓ src/components/ServerInfoFooter.test.tsx (4 tests) 109ms
 ✓ src/components/ProfileDropdown.test.tsx (6 tests) 221ms
 ✓ src/components/SourcePreview.test.tsx (4 tests) 199ms
 ✓ src/components/ArtifactViewer.test.tsx (9 tests) 236ms
 ✓ src/components/StageChainRail.test.tsx (16 tests) 318ms
 ❯ src/api/types.gen.drift.test.ts (1 test | 1 failed) 578ms
   × types.gen.ts drift guard > committed types.gen.ts matches fresh openapi-typescript output 575ms
     → types.gen.ts is out of sync with openapi.json.
Run `make openapi-export` (or `cd frontend && npm run openapi:gen`) and commit the result.
 ✓ src/test/tsconfigPaths.smoke.test.ts (1 test) 3ms
 ✓ src/pages/TextReviewPage.test.tsx (6 tests) 505ms
 ✓ src/pages/ProjectListPage.test.tsx (7 tests) 515ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/api/types.gen.drift.test.ts > types.gen.ts drift guard > committed types.gen.ts matches fresh openapi-typescript output
Error: types.gen.ts is out of sync with openapi.json.
Run `make openapi-export` (or `cd frontend && npm run openapi:gen`) and commit the result.
 ❯ src/api/types.gen.drift.test.ts:38:15
     36|       // Helpful failure: tell the developer how to fix it.
     37|       if (fresh !== committed) {
     38|         throw new Error(
       |               ^
     39|           "types.gen.ts is out of sync with openapi.json.\n" +
     40|             "Run `make openapi-export` (or `cd frontend && npm run ope…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed | 19 passed (20)
      Tests  1 failed | 131 passed (132)
   Start at  06:13:17
   Duration  1.86s (transform 794ms, setup 2.87s, collect 3.09s, tests 3.21s, environment 9.42s, prepare 3.25s)

make: *** [Makefile:203: frontend-test] Error 1

**Pre-claim SHA:** `4d64a25ff38d701bdab8b4623cc5ee7a8120b020` (work is recoverable from reflog if you want it)

The issue has been moved to `status:bounced` and `bot:ship-issue-ready` removed. To retry: triage the bounce reason, then run `scripts/arm-issue.py` (or manually add `bot:ship-issue-ready` and swap `status:bounced` → `status:ready`).
~~~~~~~~

### Comment 4 by ConcaveTrillion at 2026-05-13T10:22:40Z

~~~~~~~~text
Cleaned up by ship-issue-cleanup-bounced.py.

No escalation history found; model/effort labels unchanged. Deleted 0 escalation comment(s) so the retry counter resets to 0. Issue is re-armed (`status:ready` + `bot:ship-issue-ready`) and will be picked up on the next cycle.
~~~~~~~~

### Comment 5 by ConcaveTrillion at 2026-05-13T13:32:47Z

~~~~~~~~text
Claimed by ship-issue-0.

- Model: `sonnet` / effort: `high`
- Spec: `docs/specs/2026-05-11-workbench-artifact-viewer-design.md`
- Pre-claim SHA: `8e8a5a48c19103449b15ae65a0abae75a4aea128`

Acceptance:
(none)
~~~~~~~~

## #66 M3: SSE endpoint + frontend live-rail stage status updates

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB8Nbjw`
- Author: ConcaveTrillion
- Created: 2026-05-12T00:14:29Z
- Closed: 2026-05-14T09:46:27Z
- Labels: bot:ship-issue-ready, effort:M, kind:feature, model-effort:medium, model:sonnet, status:in-pr
- Milestone: spec: m3-workbench-artifact-viewer-stage (#44)

### Body

~~~~~~~~text
Per-page SSE channel that streams stage-status transitions; frontend subscribes and updates the chip rail without page reload (incl. across browser tabs).

## Scope

- New endpoint: `GET /api/data/projects/{id}/pages/{idx0}/events` streams `stage-status` and `stage-progress` events as SSE. Backend emits events on stage transitions from the stage runner.
- Frontend hook: `useStageEvents(projectId, idx0)` subscribes via `EventSource`. Each event invalidates the relevant TanStack Query cache, so cross-tab consistency emerges from query refetch.
- Channel scope per spec recommendation: **per-page** for M3. Project-level subscription deferred to M5.
- Live-run visual treatment per spec recommendation: simultaneous (chip X turning `running` + Y/Z turning `dirty` appear together rather than sequenced).
- `EventSource` reconnect-on-error is automatic; no special handling needed.

## Design context (from `docs/specs/2026-05-11-workbench-artifact-viewer-design.md` §Decision #4 + §Open questions + §Trade-offs)

> 4. **SSE for stage transitions.** New endpoint `GET /api/data/projects/{id}/pages/{idx0}/events` streams `stage-status` and `stage-progress` events. Frontend subscribes via `EventSource`; TanStack Query cache is invalidated on transition events so cross-tab consistency emerges from query refetch.
>
> **SSE vs WebSocket vs polling.** WebSocket is bidirectional (overkill); polling is wasteful at the 2s budget. SSE is the right shape: one-way server-push, EventSource is built into the browser, reconnect-on-error is automatic.
>
> **SSE channel scope.** Per-page vs per-project. Recommend per-page for M3; project-level subscription can be added in M5.
>
> **Dirty visual treatment during a live run.** Simultaneous (chip X transitioning to `running` + downstream Y/Z transitioning to `dirty` appearing together).

## Acceptance

- Tab A runs a stage; tab B (open on the same page) observes the chip statuses transition live without manual refresh.
- A stage transition emits both `stage-status` (status change) and `stage-progress` events.
- Stage-controls Apply+Run results in chip going `running` -> `clean` + downstream chips flipping `dirty` within ~2s.
- EventSource automatically reconnects if the server restarts.

Supersedes existing #28.

Tracks: #44
Spec: docs/specs/2026-05-11-workbench-artifact-viewer-design.md

Blocked-by: #79

Blocked-by: #106
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:25:25Z

~~~~~~~~text
Armed for ship-issue cycle by arm-issue.py. parent-spec: #44 (merged in PR #49). Override with `gh issue edit` if wrong.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-12T06:20:28Z

~~~~~~~~text
Claimed by ship-issue.

- Model: `sonnet` / effort: `medium`
- Spec: `docs/specs/2026-05-11-workbench-artifact-viewer-design.md`
- Pre-claim SHA: `4d64a25ff38d701bdab8b4623cc5ee7a8120b020`

Acceptance:
(none)
~~~~~~~~

### Comment 3 by ConcaveTrillion at 2026-05-12T21:19:32Z

~~~~~~~~text
Claimed by ship-issue-1.

- Model: `sonnet` / effort: `medium`
- Spec: `docs/specs/2026-05-11-workbench-artifact-viewer-design.md`
- Pre-claim SHA: `dd2fec2eebe911b25395e7133df96dbbeb4e9cb2`

Acceptance:
(none)
~~~~~~~~

### Comment 4 by ConcaveTrillion at 2026-05-13T01:20:02Z

~~~~~~~~text
Claimed by ship-issue-0.

- Model: `sonnet` / effort: `medium`
- Spec: `docs/specs/2026-05-11-workbench-artifact-viewer-design.md`
- Pre-claim SHA: `9417755034424b17408257f57e8821c9656c16cf`

Acceptance:
(none)
~~~~~~~~

### Comment 5 by ConcaveTrillion at 2026-05-13T13:46:30Z

~~~~~~~~text
Claimed by ship-issue-1.

- Model: `sonnet` / effort: `medium`
- Spec: `docs/specs/2026-05-11-workbench-artifact-viewer-design.md`
- Pre-claim SHA: `a129a98148bc99b40189998c9b8eff02a7709620`

Acceptance:
(none)
~~~~~~~~

## #67 M5: project_run_dirty + project_run_stage_all_pages job types

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB8N4Iw`
- Author: ConcaveTrillion
- Created: 2026-05-12T00:16:22Z
- Closed: 2026-05-13T01:18:57Z
- Labels: bot:ship-issue-ready, effort:M, kind:feature, model-effort:medium, model:sonnet, status:in-pr
- Milestone: spec: m5-project-level-orchestration-fan-out (#45)

### Body

~~~~~~~~text
New project-level fan-out job types that dispatch per-page stage tasks under the hood.

## Scope

- New `JobType.project_run_stage_all_pages(stage_id)` — runs one stage on every page that needs it.
- New `JobType.project_run_dirty(stage_filter?)` — runs every dirty stage on every page until clean; optional filter narrows the sweep.
- Both dispatch per-page stage tasks via the existing per-page stage runner.
- Progress aggregated at **per-page** granularity (not per-stage — that's noise at the project level).
- One project-level job row + child rows per page; the user's mental model of "I clicked one thing" is preserved.

## Design context (from `docs/specs/2026-05-11-project-fanout-awaiting-review-design.md` §Decision #1 + §Trade-offs)

> 1. **Project-level fan-out jobs.**
>    - `JobType.project_run_stage_all_pages(stage_id)` — runs one stage on every page that needs it.
>    - `JobType.project_run_dirty(stage_filter?)` — runs every dirty stage on every page until clean. Optional filter narrows the sweep.
>    - Both dispatch per-page stage tasks under the hood. Progress aggregated at **per-page** granularity.
>
> **Progress granularity: per-stage vs per-page.** Per-stage is noise at the project level ("page 1 stage 3 of 22") and confusing when stages can be `not-applicable`. Per-page aggregates correctly; the chip rail per page gives stage-level visibility.
>
> **Project-level fan-out as one job row vs many sibling rows.** One project-level row + child rows preserves the user's mental model of "I clicked one thing"; many sibling rows clutter JobsPage. Decided: one project row + child rows.

## Acceptance

- Posting `project.run_dirty` for a project with N pages produces one parent job row + N child rows.
- JobsPage progress bar ticks from 0 to N (page count) as pages complete.
- Re-running an already-complete project (no dirty stages) produces a zero-pages-affected result without errors.
- Filtered `project_run_dirty("threshold")` only runs `threshold` dirties (not all stages).

Supersedes existing #30.

Tracks: #45
Spec: docs/specs/2026-05-11-project-fanout-awaiting-review-design.md
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:25:28Z

~~~~~~~~text
Armed for ship-issue cycle by arm-issue.py. parent-spec: #45 (merged in PR #50). Override with `gh issue edit` if wrong.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-12T18:08:01Z

~~~~~~~~text
Claimed by ship-issue-1.

- Model: `sonnet` / effort: `medium`
- Spec: `docs/specs/2026-05-11-project-fanout-awaiting-review-design.md`
- Pre-claim SHA: `3131fb1c5b7ea9fdb76a09562ba9b80bbea720e9`

Acceptance:
(none)
~~~~~~~~

### Comment 3 by ConcaveTrillion at 2026-05-12T21:48:06Z

~~~~~~~~text
Claimed by ship-issue-0.

- Model: `sonnet` / effort: `medium`
- Spec: `docs/specs/2026-05-11-project-fanout-awaiting-review-design.md`
- Pre-claim SHA: `31be7089688c3499eb01d95a7968aa63cbf59d29`

Acceptance:
(none)
~~~~~~~~

## #68 M5: legacy batch_* job-type compatibility shim

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB8N5Cw`
- Author: ConcaveTrillion
- Created: 2026-05-12T00:16:24Z
- Closed: 2026-05-13T01:18:58Z
- Labels: bot:ship-issue-ready, effort:S, kind:feature, model-effort:low, model:sonnet, status:in-pr
- Milestone: spec: m5-project-level-orchestration-fan-out (#45)

### Body

~~~~~~~~text
Translation shim that keeps existing `JobType.batch_*` job rows working while routing the underlying work through the new STAGE_IMPL registry.

## Scope

- New `core/jobs/legacy_shim.py`. When a `JobType.batch_*` job row is created (via existing endpoints or the `/api/gpu/jobs` POST), the runner translates the type to the equivalent `project_run_*` invocation and processes it through the STAGE_IMPL registry.
- The original job row keeps its `batch_*` type for log readability but the work executes through the new path.
- Covers: `batch_process_pages`, `batch_extract_illustrations`, `batch_ocr`, `batch_text_postprocess` (audit at slice time for any additional legacy types).
- Deletion in M6 (tracked separately under existing #15).

## Design context (from `docs/specs/2026-05-11-project-fanout-awaiting-review-design.md` §Decision #2 + §Trade-offs)

> 2. **Legacy job-type shim.**
>    - When a `JobType.batch_*` job row is created (via the existing endpoints or the `gpu/jobs` POST), the runner translates it to the equivalent `project_run_*` invocation and processes it through the registry. The original job row keeps its `batch_*` type for log readability but the work executes through the new path.
>    - Shim lives in `core/jobs/legacy_shim.py`; deletion in M6.
>
> **Legacy shim retention.** A shim that lives forever invites callers that never migrate. Decided: shim is in M5, deletion is in M6 (explicitly tracked in `docs/08-roadmap.md` §M6).

## Acceptance

- `POST /api/gpu/jobs {"job_type": "batch_process_pages", ...}` produces a job row that runs to completion via the new path. User-visible behaviour is identical to pre-M5.
- A `grep -r "JobType.batch_"` audit reports all callers; the shim covers all of them.
- M6 cleanup (existing #15) deletes the shim and the `batch_*` job types together.

Supersedes existing #36.

Tracks: #45
Spec: docs/specs/2026-05-11-project-fanout-awaiting-review-design.md
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:25:31Z

~~~~~~~~text
Armed for ship-issue cycle by arm-issue.py. parent-spec: #45 (merged in PR #50). Override with `gh issue edit` if wrong.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-12T22:18:05Z

~~~~~~~~text
Claimed by ship-issue-0.

- Model: `sonnet` / effort: `low`
- Spec: `docs/specs/2026-05-11-project-fanout-awaiting-review-design.md`
- Pre-claim SHA: `a1b8f3dca635e59166e6ddebe0a8c0977adc55b2`

Acceptance:
(none)
~~~~~~~~

## #69 M5: awaiting_review job state — park build_package + auto-resume

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB8N5SA`
- Author: ConcaveTrillion
- Created: 2026-05-12T00:16:25Z
- Closed: 2026-05-13T01:18:58Z
- Labels: bot:ship-issue-ready, effort:M, kind:feature, model-effort:high, model:sonnet, status:in-pr
- Milestone: spec: m5-project-level-orchestration-fan-out (#45)

### Body

~~~~~~~~text
New `awaiting_review` job state that parks `build_package` until every proof-range page is attested, then auto-resumes.

## Scope

- New job state `awaiting_review` between `running` and `complete`. Parked jobs persist across server restarts via their DB row (no in-memory queue).
- `POST /api/projects/{id}/build-package` runs as today, but the runner inspects every proof-range page's `text_review` row; if any is not `clean`, the job transitions to `awaiting_review` instead of running.
- On every `text_review.clean` write, the runner re-checks; on the final clean write, the parked job auto-transitions to `running` and the package builds.
- If a user un-reviews a page while the job is parked, the parked count goes back up; job stays parked (recommendation per spec — confirm at slice time).

## Design context (from `docs/specs/2026-05-11-project-fanout-awaiting-review-design.md` §Decision #3 + §Trade-offs)

> 3. **`awaiting_review` gate state.**
>    - `POST /api/projects/{id}/build-package` runs as today, but the runner inspects every proof-range page's `text_review` row; if any is not `clean`, the job transitions to `awaiting_review` instead of running.
>    - On every `text_review.clean` write the runner re-checks; on the final clean write it auto-transitions the parked job to `running` and the package builds.
>
> **Job-state persistence across restarts.** Decided: DB row IS the queue, server reads it at startup like any other job state.
>
> **Auto-resume trigger: explicit "Mark reviewed" vs implicit `text_review.clean`.** The Q7 lock defines `text_review.clean` as the human attestation primitive. Decided: trigger on `text_review.clean` writes.

## Acceptance

- Clicking "Build package" on a project with any unreviewed page parks the job in `awaiting_review`.
- After every page has its `text_review` row flipped to `clean`, the parked job auto-transitions to `running` within ~1s and the package becomes downloadable.
- A `awaiting_review` job survives a server restart; on the next clean attestation it resumes correctly.
- Re-unreviewing a page while parked keeps the job parked (count goes back up).

Blocked-by: #67

Supersedes existing #32.

Tracks: #45
Spec: docs/specs/2026-05-11-project-fanout-awaiting-review-design.md
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:27:34Z

~~~~~~~~text
Armed for ship-issue cycle by arm-issue.py. parent-spec: #45 (merged in PR #50). Override with `gh issue edit` if wrong.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-12T22:48:10Z

~~~~~~~~text
Claimed by ship-issue-0.

- Model: `sonnet` / effort: `high`
- Spec: `docs/specs/2026-05-11-project-fanout-awaiting-review-design.md`
- Pre-claim SHA: `7d423b33671915ab854a1a9b073d15069f82ad43`

Acceptance:
(none)
~~~~~~~~

## #70 M5: JobsPage project-level progress row (per-page granularity)

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB8N5jg`
- Author: ConcaveTrillion
- Created: 2026-05-12T00:16:26Z
- Closed: 2026-05-13T14:04:39Z
- Labels: bot:ship-issue-ready, effort:S, kind:feature, model-effort:low, model:sonnet, status:in-progress
- Milestone: spec: m5-project-level-orchestration-fan-out (#45)

### Body

~~~~~~~~text
JobsPage displays project-level jobs as one parent row + per-page child rows; progress aggregated per-page.

## Scope

- Project-level job row in JobsPage shows: status, child page count, progress bar (0..N where N = page count).
- Per-page child rows nested under the project row; each shows its own status (running/clean/failed) and chip rail link.
- Progress aggregation: completed pages / total pages. No per-stage detail at the project level; per-stage detail lives in each child row's chip rail.
- Avoid double-counting completed pages on a re-run.

## Design context (from `docs/specs/2026-05-11-project-fanout-awaiting-review-design.md` §Decision #1 + §Consequences)

> Both dispatch per-page stage tasks under the hood. Progress aggregated at **per-page** granularity (not per-stage — that's noise at the project level).
>
> **JobsPage progress display gains complexity.** Project row aggregates child progress; the implementation must avoid double-counting completed pages on a re-run.

## Acceptance

- A `project.run_dirty` job for a 10-page project shows progress 0/10 -> 5/10 -> 10/10 in JobsPage.
- Child rows are visually nested under the project row.
- Re-running on the same project does not double-count previously-completed pages.
- A child row's status correctly reflects the underlying page's stage state.

Blocked-by: #67

Supersedes existing #31.

Tracks: #45
Spec: docs/specs/2026-05-11-project-fanout-awaiting-review-design.md

Blocked-by: #79

Blocked-by: #106
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:27:37Z

~~~~~~~~text
Armed for ship-issue cycle by arm-issue.py. parent-spec: #45 (merged in PR #50). Override with `gh issue edit` if wrong.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-12T23:18:13Z

~~~~~~~~text
Claimed by ship-issue-0.

- Model: `sonnet` / effort: `low`
- Spec: `docs/specs/2026-05-11-project-fanout-awaiting-review-design.md`
- Pre-claim SHA: `c173059691e9259bb9d1ffb539a6f0b20e1d4f05`

Acceptance:
(none)
~~~~~~~~

### Comment 3 by ConcaveTrillion at 2026-05-12T23:36:17Z

~~~~~~~~text
ship-issue: bounced.

**Reason:** rebase conflict during push serialization onto wip/ship-issue

**Pre-claim SHA:** `c173059691e9259bb9d1ffb539a6f0b20e1d4f05` (work is recoverable from reflog if you want it)

The issue has been moved to `status:bounced` and `bot:ship-issue-ready` removed. To retry: triage the bounce reason, then run `scripts/arm-issue.py` (or manually add `bot:ship-issue-ready` and swap `status:bounced` → `status:ready`).
~~~~~~~~

### Comment 4 by ConcaveTrillion at 2026-05-13T10:22:37Z

~~~~~~~~text
Cleaned up by ship-issue-cleanup-bounced.py.

No escalation history found; model/effort labels unchanged. Deleted 0 escalation comment(s) so the retry counter resets to 0. Issue is re-armed (`status:ready` + `bot:ship-issue-ready`) and will be picked up on the next cycle.
~~~~~~~~

### Comment 5 by ConcaveTrillion at 2026-05-13T14:02:30Z

~~~~~~~~text
Claimed by ship-issue-0.

- Model: `sonnet` / effort: `low`
- Spec: `docs/specs/2026-05-11-project-fanout-awaiting-review-design.md`
- Pre-claim SHA: `847e7d522c985195e230b22fadd93cfec4bdf0a6`

Acceptance:
(none)
~~~~~~~~

### Comment 6 by ConcaveTrillion at 2026-05-13T14:04:38Z

~~~~~~~~text
Auto-closed by ship-issue: TDD slice produced zero new commits against `origin/main`. The work is already on `main` (a sibling issue's commit incidentally satisfied this issue's acceptance criteria, then merged in a prior cycle). No PR opened.
~~~~~~~~

## #71 M5: project banner unreviewed-page count + Open Tasks bell badge

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB8N55A`
- Author: ConcaveTrillion
- Created: 2026-05-12T00:16:28Z
- Closed: 2026-05-14T09:46:29Z
- Labels: bot:ship-issue-ready, effort:S, kind:feature, model-effort:medium, model:sonnet, status:in-pr
- Milestone: spec: m5-project-level-orchestration-fan-out (#45)

### Body

~~~~~~~~text
Project workbench shell shows a banner when a build_package job is parked in `awaiting_review`; Open Tasks bell badge shows unreviewed-page count for the active project.

## Scope

- Project banner: "N pages awaiting review before package can build" with a "Review next page" button. Banner only visible when an `awaiting_review` job exists for the project.
- Open Tasks bell badge: shows the unreviewed-page count for the **active** project. Per-project scope per spec recommendation; cross-project bell deferred.
- Real-time updates: reuse M3's per-page SSE channel if available, OR add a project-level sibling SSE channel scoped to project events. Per spec recommendation, the sibling channel is preferred.
- Banner count + bell badge update within ~1s of a `text_review.clean` write.

## Design context (from `docs/specs/2026-05-11-project-fanout-awaiting-review-design.md` §Decision #3 + §Consequences + §Open questions)

> Project banner shows "N pages awaiting review before package can build" with a "Review next page" button.
> Open Tasks bell badge shows the unreviewed-count for the active project.
>
> **Open Tasks bell becomes a real-time feature.** Currently it (if present) updates on TanStack Query refetch; M5 wires it to either SSE (from M3) or a short-poll endpoint. Reuse M3's SSE channel if scoped to project-level events.
>
> **SSE reuse from M3.** Recommend a sibling project-level channel scoped to `JobType.project_*` events.

## Acceptance

- Opening a project with an `awaiting_review` job shows the banner with the correct count and "Review next page" button.
- Marking a page reviewed drops the count by 1 within ~1s; the Open Tasks bell badge follows.
- The banner disappears when the parked job auto-resumes (last page reviewed).
- Switching to a different project shows that project's count, not the previous one's (per-project scope).

Blocked-by: #69, #66

Supersedes existing #33.

Tracks: #45
Spec: docs/specs/2026-05-11-project-fanout-awaiting-review-design.md

Blocked-by: #79

Blocked-by: #106
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:27:41Z

~~~~~~~~text
Armed for ship-issue cycle by arm-issue.py. parent-spec: #45 (merged in PR #50). Override with `gh issue edit` if wrong.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-13T14:16:36Z

~~~~~~~~text
Claimed by ship-issue-1.

- Model: `sonnet` / effort: `medium`
- Spec: `docs/specs/2026-05-11-project-fanout-awaiting-review-design.md`
- Pre-claim SHA: `044405d46f5ce67a175ae513b58dd90961b88d55`

Acceptance:
(none)
~~~~~~~~

## #72 M5: STAGE_IMPL registry cutover — every call site routes through the registry

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB8N6Kg`
- Author: ConcaveTrillion
- Created: 2026-05-12T00:16:29Z
- Closed: 2026-05-13T01:18:58Z
- Labels: bot:ship-issue-ready, effort:M, kind:feature, model-effort:medium, model:sonnet, status:in-pr
- Milestone: spec: m5-project-level-orchestration-fan-out (#45)

### Body

~~~~~~~~text
Make the `STAGE_IMPL[stage_id][device]` registry the **only** path through stage execution by the end of M5.

## Scope

- Audit every direct caller of `LocalBackend.process_page` / `LocalBackend.process_page_cpu` / `CpuBackend.*` / pre-registry stage entry points.
- Replace direct calls with `STAGE_IMPL[stage_id][device]` dispatch.
- `LocalBackend.process_page` becomes a 1-line shim onto registry calls (kept as a shim through M5; deleted in M6 per existing #15).
- `grep -r "LocalBackend.process_page\|CpuBackend.process_page" src/` returns only shim implementations (no direct callers other than the shim itself).
- Includes the legacy batch_* shim's call path (which itself routes through the registry — see sibling chore).

## Design context (from `docs/specs/2026-05-11-project-fanout-awaiting-review-design.md` §Constraints + §Decision)

> **`STAGE_IMPL` registry must be the only call path** by the end of M5. Every existing call site (routes, CLI, batch shims) must route through `STAGE_IMPL[stage_id][device]`.
>
> The full-power `STAGE_IMPL` cutover: every existing call site routes through the registry. Old `LocalBackend.process_page` etc. methods become 1-line shims onto registry calls.

## Acceptance

- `grep -r "LocalBackend.process_page\|CpuBackend.process_page" src/` returns only shim implementations.
- All routes/CLI commands/job runners that previously called direct backend methods now dispatch through `STAGE_IMPL[stage_id][device]`.
- M6 cleanup (existing #15) can delete `LocalBackend` / `CpuBackend` classes without breaking any call site.
- Existing M1/M2 stage tests still pass.

Blocked-by: #68

Unblocks: M6 cleanup (existing #15).

Tracks: #45
Spec: docs/specs/2026-05-11-project-fanout-awaiting-review-design.md
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:27:45Z

~~~~~~~~text
Armed for ship-issue cycle by arm-issue.py. parent-spec: #45 (merged in PR #50). Override with `gh issue edit` if wrong.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-12T23:48:17Z

~~~~~~~~text
Claimed by ship-issue-0.

- Model: `sonnet` / effort: `medium`
- Spec: `docs/specs/2026-05-11-project-fanout-awaiting-review-design.md`
- Pre-claim SHA: `c173059691e9259bb9d1ffb539a6f0b20e1d4f05`

Acceptance:
(none)
~~~~~~~~

## #73 Search: IDatabase.search() adapter contract

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB8OTlw`
- Author: ConcaveTrillion
- Created: 2026-05-12T00:18:02Z
- Closed: 2026-05-14T09:46:29Z
- Labels: bot:ship-issue-ready, effort:S, kind:feature, model-effort:low, model:haiku, status:in-pr
- Milestone: spec: full-text-search-across-ocr-pages (#46)

### Body

~~~~~~~~text
Define the `IDatabase.search()` method on the adapter Protocol so the local FTS5 implementation and a future Postgres `tsvector` implementation share one entry point.

## Scope

- Add `def search(self, project_id, query, *, limit=20, offset=0) -> SearchResultList:` (or async equivalent matching the existing adapter style) to the `IDatabase` Protocol in `src/pd_prep_for_pgdp/adapters/database.py`.
- Define `SearchResult` dataclass with: `page_id`, `idx0`, `snippet`, `score` (float in `[0.0, 1.0]` per spec recommendation — normalized so frontend ranking presentation is backend-agnostic).
- Define `SearchResultList` with `results: list[SearchResult]` + `total_count: int` for pagination.
- No implementation — this chore is the contract only.

## Design context (from `docs/specs/2026-05-11-search-across-pages-design.md` §Constraints + §Decision + §Open questions)

> Adapter contract: `IDatabase` adapter should expose a `search()` method so the future Postgres adapter implements `tsvector` behind the same interface.
>
> **Postgres TS contract surface.** What does `IDatabase.search()` return on a backend whose ranking semantics differ from FTS5 BM25? Recommend normalized score `[0.0, 1.0]` so frontend ranking presentation is backend-agnostic.

## Acceptance

- `IDatabase` Protocol has the `search()` method signature.
- `SearchResult` + `SearchResultList` dataclasses exist with the documented fields.
- The SQLite FTS5 adapter (sibling chore) and any future Postgres adapter both implement this contract.

Tracks: #46
Spec: docs/specs/2026-05-11-search-across-pages-design.md

Blocked-by: #79

Blocked-by: #106
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:25:35Z

~~~~~~~~text
Armed for ship-issue cycle by arm-issue.py. parent-spec: #46 (merged in PR #51). Override with `gh issue edit` if wrong.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-13T00:19:58Z

~~~~~~~~text
Claimed by ship-issue-0.

- Model: `haiku` / effort: `low`
- Spec: `docs/specs/2026-05-11-search-across-pages-design.md`
- Pre-claim SHA: `9417755034424b17408257f57e8821c9656c16cf`

Acceptance:
(none)
~~~~~~~~

### Comment 3 by ConcaveTrillion at 2026-05-13T00:25:14Z

~~~~~~~~text
ship-issue: bounced.

**Reason:** rebase conflict during push serialization onto wip/ship-issue

**Pre-claim SHA:** `9417755034424b17408257f57e8821c9656c16cf` (work is recoverable from reflog if you want it)

The issue has been moved to `status:bounced` and `bot:ship-issue-ready` removed. To retry: triage the bounce reason, then run `scripts/arm-issue.py` (or manually add `bot:ship-issue-ready` and swap `status:bounced` → `status:ready`).
~~~~~~~~

### Comment 4 by ConcaveTrillion at 2026-05-13T10:22:34Z

~~~~~~~~text
Cleaned up by ship-issue-cleanup-bounced.py.

No escalation history found; model/effort labels unchanged. Deleted 0 escalation comment(s) so the retry counter resets to 0. Issue is re-armed (`status:ready` + `bot:ship-issue-ready`) and will be picked up on the next cycle.
~~~~~~~~

### Comment 5 by ConcaveTrillion at 2026-05-13T14:32:18Z

~~~~~~~~text
Claimed by ship-issue-0.

- Model: `haiku` / effort: `low`
- Spec: `docs/specs/2026-05-11-search-across-pages-design.md`
- Pre-claim SHA: `ce4bcf69a4d7bfe5465f1c5c990359daa0b1caec`

Acceptance:
(none)
~~~~~~~~

## #74 Search: SQLite FTS5 table + text_postprocess clean-write upsert

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB8OURA`
- Author: ConcaveTrillion
- Created: 2026-05-12T00:18:04Z
- Closed: 2026-05-14T09:46:30Z
- Labels: bot:ship-issue-ready, effort:M, kind:feature, model-effort:medium, model:sonnet, status:in-pr
- Milestone: spec: full-text-search-across-ocr-pages (#46)

### Body

~~~~~~~~text
SQLite FTS5 virtual table + companion content table, populated on `text_postprocess` clean stage write.

## Scope

- New SQLite FTS5 virtual table `page_text_fts` with columns `(page_id, project_id, idx0, ocr_text)`.
- Companion content-rowid-linked table `page_text` with the same columns (FTS5's standard `content` pattern); companion is authoritative store, FTS5 is the index.
- Index update path: the `text_postprocess` stage runner's clean-write transaction additionally upserts the `page_text` row and the FTS5 index row, in the same DB transaction as the on-disk artifact + `page_stages` row commit.
- Local SQLite implementation of `IDatabase.search()` (interface from sibling chore): runs `SELECT ... FROM page_text_fts WHERE page_text_fts MATCH ? ORDER BY rank LIMIT ? OFFSET ?` with FTS5's `snippet()` for result snippets.
- Lightweight normalization before indexing (lowercase, strip diacritics, expand long-s `ſ`->`s`) per spec recommendation — confirm at slice time.
- Reindex CLI extension: `pgdp-prep reindex --heal` walks the FTS5 index for stale rows whose authoritative `text_postprocess` artifact has changed.
- Cross-page dirty propagation does NOT affect search staleness — the search index updates only on `text_postprocess` clean write.

## Design context (from `docs/specs/2026-05-11-search-across-pages-design.md` §Decision + §Trade-offs)

> **Storage:** new SQLite FTS5 virtual table `page_text_fts` ... content-rowid-linked to a small companion table `page_text` with the same columns (FTS5's standard `content` pattern); the companion is the authoritative store and FTS5 is the index.
>
> **Index update path:** the `text_postprocess` stage runner's clean-write transaction additionally upserts the `page_text` row and the FTS5 index row, in the same DB transaction (so reindex's reconciliation catches index drift the same way it catches stage-row drift).
>
> **FTS5 virtual table vs `pages.ocr_text` column with `LIKE`.** `LIKE` doesn't scale, lacks ranking, and lacks snippet. FTS5 ranking (BM25 by default) is fine for OCR text.

## Acceptance

- A successful `text_postprocess` clean write upserts the FTS5 row within the same transaction.
- Searching a term that appears only in a split child returns the child's page row, not the parent's.
- Re-running `text_postprocess` on a page with changed config produces updated text in the FTS5 row; old text is gone.
- `pgdp-prep reindex --heal` repairs index drift without data loss.
- Local FTS5 score is mapped to the normalized `[0.0, 1.0]` range defined by the adapter contract.

Blocked-by: #73

Supersedes existing #34.

Tracks: #46
Spec: docs/specs/2026-05-11-search-across-pages-design.md

Blocked-by: #79

Blocked-by: #106
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:27:48Z

~~~~~~~~text
Armed for ship-issue cycle by arm-issue.py. parent-spec: #46 (merged in PR #51). Override with `gh issue edit` if wrong.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-13T14:46:37Z

~~~~~~~~text
Claimed by ship-issue-1.

- Model: `sonnet` / effort: `medium`
- Spec: `docs/specs/2026-05-11-search-across-pages-design.md`
- Pre-claim SHA: `bcd25f4a5f4f47cb42b6715ec17f71b76809bc9b`

Acceptance:
(none)
~~~~~~~~

## #75 Search: GET /api/data/projects/{id}/search endpoint + result shape

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB8OVVQ`
- Author: ConcaveTrillion
- Created: 2026-05-12T00:18:05Z
- Closed: 2026-05-14T09:46:30Z
- Labels: bot:ship-issue-ready, effort:S, kind:feature, model-effort:low, model:sonnet, status:in-pr
- Milestone: spec: full-text-search-across-ocr-pages (#46)

### Body

~~~~~~~~text
Project-scoped search endpoint returning paginated matches with snippet and page-link metadata.

## Scope

- `GET /api/data/projects/{id}/search?q=<query>&limit=<n>&offset=<n>` returns `{results: [{page_id, idx0, snippet, score}, ...], total_count: <n>}`.
- Snippet uses FTS5's built-in `snippet()` function with ~200 char window + ellipses (per spec recommendation — confirm at slice time).
- Default limit 20; offset for pagination.
- Empty query returns 400.
- Endpoint reads via `IDatabase.search()`; SQLite FTS5 is the only implementation in M5 (Postgres is deferred).
- All routes filter by `user.user_id` per repo-wide auth convention (cf. `CLAUDE.md` decision lock).

## Design context (from `docs/specs/2026-05-11-search-across-pages-design.md` §Decision + §Open questions)

> **API:**
> - `GET /api/data/projects/{id}/search?q=<query>&limit=<n>&offset=<n>` — returns `{results: [{page_id, idx0, snippet, score}, ...], total_count: <n>}`. Snippet uses FTS5's built-in `snippet()` function. Default limit 20; offset for pagination.
> - Result shape includes `idx0` so the frontend can navigate via the existing page-navigation URL pattern.
>
> **Snippet length.** Recommend ~200 chars with ellipses.

## Acceptance

- `GET .../search?q=foo` on a project with indexed pages returns matches across pages with snippet + `page_id` + `idx0` + `score`.
- Pagination works: `limit=10&offset=10` returns the next 10 results; `total_count` is accurate.
- Empty `q` returns 400.
- Cross-user isolation: another user's `GET .../search` against this project returns 404 or empty (per existing auth pattern).

Blocked-by: #74

Supersedes existing #35.

Tracks: #46
Spec: docs/specs/2026-05-11-search-across-pages-design.md

Blocked-by: #79

Blocked-by: #106
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:27:51Z

~~~~~~~~text
Armed for ship-issue cycle by arm-issue.py. parent-spec: #46 (merged in PR #51). Override with `gh issue edit` if wrong.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-13T15:32:20Z

~~~~~~~~text
Claimed by ship-issue-0.

- Model: `sonnet` / effort: `low`
- Spec: `docs/specs/2026-05-11-search-across-pages-design.md`
- Pre-claim SHA: `ce4bcf69a4d7bfe5465f1c5c990359daa0b1caec`

Acceptance:
(none)
~~~~~~~~

## #76 Search: search bar UI + results panel (snippet, page link)

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB8OVpg`
- Author: ConcaveTrillion
- Created: 2026-05-12T00:18:06Z
- Closed: 2026-05-15T11:13:24Z
- Labels: effort:M, kind:feature, model-effort:medium, model:sonnet, status:bounced
- Milestone: spec: full-text-search-across-ocr-pages (#46)

### Body

~~~~~~~~text
Project-workbench-shell search affordance: search bar + results panel with snippet and page-link navigation.

## Scope

- Search bar component in the project workbench shell (not in the global nav — search is per-project per spec).
- Uses the existing shadcn/ui `Input` primitive.
- Result panel lists hits as `{page label e.g. "Page 47 (idx 46)"} -- {snippet with highlighted match} -> click navigates to the workbench at that page`.
- Result panel reuses the project page-list styling.
- Pagination UI: "Next 20" / "Previous 20" buttons backed by the endpoint's `limit` + `offset`.
- Frontend ranking presentation uses the normalized score from the adapter contract (`[0.0, 1.0]`).

## Design context (from `docs/specs/2026-05-11-search-across-pages-design.md` §Decision)

> **Frontend:**
> - A search bar component in the project workbench shell (not in the global nav) — search is scoped to one project at a time.
> - Result panel lists hits as `{page label e.g. "Page 47 (idx 46)"} — {snippet with highlighted match} → click navigates to the workbench at that page`.
> - Search bar uses the existing shadcn/ui `Input` primitive; result panel reuses the project page-list styling.

## Acceptance

- Typing a query into the search bar and submitting renders the result panel within ~500ms for a 600-page project on local SQLite.
- Clicking a result navigates to the workbench at the matched page.
- The snippet visibly highlights the matched terms.
- Pagination works (Next/Previous 20).

Blocked-by: #75

Supersedes existing #37.

Tracks: #46
Spec: docs/specs/2026-05-11-search-across-pages-design.md

Blocked-by: #79

Blocked-by: #106
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:27:55Z

~~~~~~~~text
Armed for ship-issue cycle by arm-issue.py. parent-spec: #46 (merged in PR #51). Override with `gh issue edit` if wrong.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-13T16:02:23Z

~~~~~~~~text
Claimed by ship-issue-0.

- Model: `sonnet` / effort: `medium`
- Spec: `docs/specs/2026-05-11-search-across-pages-design.md`
- Pre-claim SHA: `ce4bcf69a4d7bfe5465f1c5c990359daa0b1caec`

Acceptance:
(none)
~~~~~~~~

### Comment 3 by ConcaveTrillion at 2026-05-13T16:29:09Z

~~~~~~~~text
ship-issue: bounced.

**Reason:** stash pop conflict after rebase in push window

**Pre-claim SHA:** `ce4bcf69a4d7bfe5465f1c5c990359daa0b1caec` (work is recoverable from reflog if you want it)

The issue has been moved to `status:bounced` and `bot:ship-issue-ready` removed. To retry: triage the bounce reason, then run `scripts/arm-issue.py` (or manually add `bot:ship-issue-ready` and swap `status:bounced` → `status:ready`).
~~~~~~~~

### Comment 4 by ConcaveTrillion at 2026-05-15T11:13:23Z

~~~~~~~~text
Shipped: 1b6ae7f — SearchPanel component + ProjectConfigurePage integration. 8 vitest tests all pass; make ci AI=1 green.
~~~~~~~~

## #77 Search: pgdp-prep migrate-projects --search-rebuild CLI

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB8OV-A`
- Author: ConcaveTrillion
- Created: 2026-05-12T00:18:08Z
- Closed: 2026-05-13T15:53:26Z
- Labels: bot:ship-issue-ready, effort:S, kind:feature, model-effort:low, model:sonnet, status:in-progress
- Milestone: spec: full-text-search-across-ocr-pages (#46)

### Body

~~~~~~~~text
CLI command that retroactively populates the FTS5 index for pre-M1 projects (or post-M1 projects without `text_postprocess` shipped).

## Scope

- New CLI subcommand: `pgdp-prep migrate-projects --search-rebuild [project_id ...]`.
- Walks every applicable project's pages and reads the existing OCR text artifact (under `pages/<page_id>/stages/text_postprocess.*` or the legacy location), upserts the `page_text` + FTS5 rows.
- Idempotent: re-running on a project with an already-populated index is a no-op (or rebuilds idempotently). Pages without OCR text are skipped (no error).
- Without `[project_id ...]`, operates on every project the user owns. With explicit IDs, scopes to those projects.
- Search is not retroactively populated by lazy migrate alone — this CLI is the explicit user action.

## Design context (from `docs/specs/2026-05-11-search-across-pages-design.md` §Decision + §Consequences)

> **Migration:** for pre-M1 projects (or post-M1 projects without `text_postprocess` shipped), `pgdp-prep migrate-projects --search-rebuild` walks every page's existing OCR text and seeds the index. Idempotent.
>
> **Migration of pre-existing projects** requires explicit user action (`migrate-projects --search-rebuild`) — search is not retroactively populated by lazy migrate alone.

## Acceptance

- `pgdp-prep migrate-projects --search-rebuild` on a project with existing OCR text but no FTS5 index populates the index without re-running OCR.
- Re-running the same command on the same project is a no-op.
- A project with no OCR text at all (only ingested) completes without error and the index remains empty for that project.
- After this runs, `GET /search?q=...` returns results from the freshly-indexed text.

Blocked-by: #74

Tracks: #46
Spec: docs/specs/2026-05-11-search-across-pages-design.md

Blocked-by: #79

Blocked-by: #106
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T00:27:58Z

~~~~~~~~text
Armed for ship-issue cycle by arm-issue.py. parent-spec: #46 (merged in PR #51). Override with `gh issue edit` if wrong.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-13T15:46:34Z

~~~~~~~~text
Claimed by ship-issue-1.

- Model: `sonnet` / effort: `low`
- Spec: `docs/specs/2026-05-11-search-across-pages-design.md`
- Pre-claim SHA: `ce4bcf69a4d7bfe5465f1c5c990359daa0b1caec`

Acceptance:
(none)
~~~~~~~~

### Comment 3 by ConcaveTrillion at 2026-05-13T15:53:26Z

~~~~~~~~text
Auto-closed by ship-issue: TDD slice produced zero new commits against `origin/main`. The work is already on `main` (a sibling issue's commit incidentally satisfied this issue's acceptance criteria, then merged in a prior cycle). No PR opened.
~~~~~~~~

## #79 ci: add openapi-export to make ci so types.gen.ts is always fresh before drift guard runs

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABB_5Zbg`
- Author: ConcaveTrillion
- Created: 2026-05-12T12:25:11Z
- Closed: 2026-05-14T09:46:27Z
- Labels: bot:ship-issue-ready, effort:S, kind:chore, model-effort:medium, model:sonnet, priority:high, status:in-pr
- Milestone: none

### Body

~~~~~~~~text
## Problem

The `make ci` pipeline currently runs `test` (which includes `test_openapi_spec_committed.py`) against whatever `openapi.json` and `types.gen.ts` are already committed. When a ship-issue bot cycle adds new FastAPI routes without running `make openapi-export`, the drift guard fails when `success.sh` runs `make ci`.

Root cause of issue #65 bounce.

## Fix

Add `openapi-export` to the `make ci` target, placed **after `pre-commit-check` and before `frontend-build`** (so types.gen.ts is fresh before the TypeScript compile):

```
ci: setup pre-commit-check openapi-export frontend-build test frontend-lint frontend-format-check frontend-test
```

## Acceptance

- [ ] `make ci` includes `openapi-export` step before `frontend-build`
- [ ] Adding a new FastAPI route without manually running `make openapi-export` still results in a passing `make ci`
- [ ] `make ci` still fails if the FastAPI app itself is broken (pytest gate is after openapi-export)
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-12T12:25:19Z

~~~~~~~~text
Armed for ship-issue cycle by arm-issue.py. parent-spec: none. Override with `gh issue edit` if wrong.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-12T17:37:47Z

~~~~~~~~text
Claimed by ship-issue-1.

- Model: `sonnet` / effort: `medium`
- Spec: `(none)`
- Pre-claim SHA: `4d64a25ff38d701bdab8b4623cc5ee7a8120b020`

Acceptance:
- [ ] `make ci` includes `openapi-export` step before `frontend-test`
- [ ] Adding a new FastAPI route without manually running `make openapi-export` still results in a passing `make ci` (because ci regenerates it)
- [ ] `make ci` still fails if the FastAPI app itself is broken (pytest gate is before openapi-export)
~~~~~~~~

### Comment 3 by ConcaveTrillion at 2026-05-12T17:37:48Z

~~~~~~~~text
Claimed by ship-issue-0.

- Model: `sonnet` / effort: `medium`
- Spec: `(none)`
- Pre-claim SHA: `4d64a25ff38d701bdab8b4623cc5ee7a8120b020`

Acceptance:
- [ ] `make ci` includes `openapi-export` step before `frontend-test`
- [ ] Adding a new FastAPI route without manually running `make openapi-export` still results in a passing `make ci` (because ci regenerates it)
- [ ] `make ci` still fails if the FastAPI app itself is broken (pytest gate is before openapi-export)
~~~~~~~~

### Comment 4 by ConcaveTrillion at 2026-05-12T17:42:33Z

~~~~~~~~text
ship-issue: bounced.

**Reason:** rebase conflict during push serialization onto wip/ship-issue

**Pre-claim SHA:** `4d64a25ff38d701bdab8b4623cc5ee7a8120b020` (work is recoverable from reflog if you want it)

The issue has been moved to `status:bounced` and `bot:ship-issue-ready` removed. To retry: triage the bounce reason, then run `scripts/arm-issue.py` (or manually add `bot:ship-issue-ready` and swap `status:bounced` → `status:ready`).
~~~~~~~~

### Comment 5 by ConcaveTrillion at 2026-05-13T09:02:36Z

~~~~~~~~text
Claimed by ship-issue-1.

- Model: `sonnet` / effort: `medium`
- Spec: `(none)`
- Pre-claim SHA: `66d62b7789c9918dbc136119a4d58e821d36c1d1`

Acceptance:
- [ ] `make ci` includes `openapi-export` step before `frontend-build`
- [ ] Adding a new FastAPI route without manually running `make openapi-export` still results in a passing `make ci`
- [ ] `make ci` still fails if the FastAPI app itself is broken (pytest gate is after openapi-export)
~~~~~~~~

### Comment 6 by ConcaveTrillion at 2026-05-13T11:46:41Z

~~~~~~~~text
Claimed by ship-issue-1.

- Model: `sonnet` / effort: `medium`
- Spec: `(none)`
- Pre-claim SHA: `66d62b7789c9918dbc136119a4d58e821d36c1d1`

Acceptance:
- [ ] `make ci` includes `openapi-export` step before `frontend-build`
- [ ] Adding a new FastAPI route without manually running `make openapi-export` still results in a passing `make ci`
- [ ] `make ci` still fails if the FastAPI app itself is broken (pytest gate is after openapi-export)
~~~~~~~~

## #80 M2: bounded deferred-write executor for stage artifact writes

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCHk_BQ`
- Author: ConcaveTrillion
- Created: 2026-05-13T10:38:49Z
- Closed: 2026-05-15T01:44:31Z
- Labels: kind:feature-request, triage:approved, triage:tracking
- Milestone: none

### Body

~~~~~~~~text
## Context

The per-page stage DAG currently writes artifacts synchronously — every `run_stage` call blocks until the artifact file is fsynced and the DB row is upserted. This is fine for single-chip clicks but blocks a future "Run all dirty stages on this page" fan-out from parallelising work: concurrent runners would pile up write I/O without bound.

## Feature request

Implement the bounded deferred-write executor described in canonical spec Q8 (`docs/specs/pipeline-task-model.md`):

- A bounded queue (cap: `PGDP_STAGE_WRITE_QUEUE_CAP`, default TBD) that accepts write tasks from the runner
- A pool of writer threads/coroutines (size: `PGDP_STAGE_WRITE_POOL_SIZE`, default TBD) that drain the queue
- The runner enqueues the dual-write (file + DB upsert) and either awaits it or fires-and-forgets depending on the call site
- Backpressure: if the queue is full, the runner blocks until a slot opens (never silently drops a write)
- Fail-loudly semantics preserved: a write failure still marks the stage `failed` and cascades dirty to descendants

## Motivation

Required before "Run all dirty stages on this page" can be implemented without unbounded I/O pile-up. Also a prerequisite for the M5 project-level fan-out.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-13T10:40:08Z

~~~~~~~~text
Triage forked child #86 (`kind:feature, effort:M, model:sonnet, model-effort:medium, status:backlog`).
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-13T10:40:42Z

~~~~~~~~text
**Triage decision:** approved → tracking

Forked child tracking issue: #86

Design is fully locked in Q8 of `docs/specs/pipeline-task-model.md` — no new spec needed. Effort M; the bot can implement directly once armed.
~~~~~~~~

### Comment 3 by ConcaveTrillion at 2026-05-15T01:44:30Z

~~~~~~~~text
Shipped in earlier M2 slices.  in  implements the bounded queue (BoundedSemaphore) + thread pool with PGDP_STAGE_WRITE_POOL_SIZE / PGDP_STAGE_WRITE_QUEUE_CAP env overrides. Wired into run_stage via . Full test coverage in .
~~~~~~~~

## #81 M2: ResolvedPageConfig plumbing into the stage runner

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCHk_aQ`
- Author: ConcaveTrillion
- Created: 2026-05-13T10:38:50Z
- Closed: 2026-05-15T01:44:32Z
- Labels: kind:feature-request, triage:approved, triage:tracking
- Milestone: none

### Body

~~~~~~~~text
## Context

`core/pipeline/stage_runner.run_stage` dispatches to `STAGE_IMPL[stage_id][device]` but does not pass any page config to the impl. Config-aware stages (`initial_crop` → `crop_edges`, `manual_deskew_pre` → `rotate_image`, `threshold` → manual level override) currently take their no-op / Otsu-auto default branches unconditionally.

## Feature request

Plumb `ResolvedPageConfig` into `run_stage` so config-aware stages can read the page's resolved config:

- `run_stage` accepts an optional `resolved_config: ResolvedPageConfig | None` kwarg
- Each stage impl that reads config receives it; stages that don't need config ignore it
- The existing API route handler resolves the config from `ProjectConfigOverrides` + defaults and passes it in
- No behaviour change when `resolved_config=None` — existing tests stay green

## Motivation

The M3 stage-controls panel (`#65`) needs this: when the user changes `threshold_level` and clicks "Apply + Run", the runner must execute with the new config value, not the Otsu-auto default. Without this plumbing the stage-controls panel UI would be wired but non-functional.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-13T10:40:55Z

~~~~~~~~text
Triage forked child #87 (`kind:feature, effort:M, model:sonnet, model-effort:medium, status:backlog`).
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-13T10:40:59Z

~~~~~~~~text
Triage decision: approved + needs-tracking. Tracking child issue: #87. Run `/ship-issue` to implement once `bot:ship-issue-ready` is set.
~~~~~~~~

### Comment 3 by ConcaveTrillion at 2026-05-15T01:44:31Z

~~~~~~~~text
Shipped in M2 slices. `run_stage` accepts `resolved_config: ResolvedPageConfig | None` kwarg (already in place). The route handler in `api/data/pages.py` resolves config from DB and passes it in. The async job path re-resolves at execution time. Config hash per stage is computed via `_compute_config_hash`. Full test coverage via `tests/test_stage_config_fields.py` and related tests.
~~~~~~~~

## #82 M2: optional ?async=true flag on POST /stages/{stage_id}/run for slow stages

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCHlHUg`
- Author: ConcaveTrillion
- Created: 2026-05-13T10:39:07Z
- Closed: 2026-05-15T01:44:33Z
- Labels: kind:feature-request, triage:approved, triage:tracking
- Milestone: none

### Body

~~~~~~~~text
## Context

`POST /api/data/projects/{id}/pages/{idx0}/stages/{stage_id}/run` currently runs synchronously. For fast stages (grayscale, threshold, crop) this is fine — they finish well within the request window. But `ocr` and `extract_illustrations` now have real CPU impls and can take 5–30 seconds per page.

## Feature request

Add an optional `?async=true` query parameter to the run route:

- When absent or `false`: existing synchronous behaviour (200 with `PageStageState`, or error codes as today)
- When `?async=true`: the route enqueues a `JobType.run_stage` job and immediately returns `202 Accepted` with `{"job_id": "..."}` so the caller can poll `/api/gpu/jobs/{id}` for completion
- The chip rail's click handler passes `?async=true` for stages whose `Stage.output_type` is known to be slow (`ocr`, `extract_illustrations`) and polls the job; for all other stages it uses the synchronous path
- The `StageChainRail` already polls every 2 s while any chip is `running` — no additional frontend plumbing needed beyond switching those two chip clicks to the async path

## Motivation

Now that `ocr` has a real DocTR impl, clicking the `ocr` chip in the workbench would otherwise block the browser for the full OCR duration. The async path lets the rail's existing polling loop handle the transition naturally.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-13T10:41:10Z

~~~~~~~~text
Triage forked child #88 (`kind:feature, effort:M, model:sonnet, model-effort:medium, status:backlog`).
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-13T10:41:14Z

~~~~~~~~text
Triage decision: approved + needs-tracking. Tracking child issue: #88. Run `/ship-issue` to implement once `bot:ship-issue-ready` is set.
~~~~~~~~

### Comment 3 by ConcaveTrillion at 2026-05-15T01:44:33Z

~~~~~~~~text
Shipped. The run route (`POST /stages/{stage_id}/run`) accepts `?async=true` via the `async_` query param, creating a `JobType.run_page_stage` job and returning 202 Accepted. The InProcessJobRunner handles `run_page_stage` via `_handle_run_page_stage`. The chip rail now passes `onStageRun` from the workbench (commit e8e5254) which uses `?async=true` for slow stages. Full test coverage in `tests/test_async_run_stage_route.py`.
~~~~~~~~

## #83 M3: polished stage-chain rail with per-stage inline thumbnails

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCHlHwg`
- Author: ConcaveTrillion
- Created: 2026-05-13T10:39:08Z
- Closed: 2026-05-15T09:16:13Z
- Labels: kind:feature-request, triage:approved, triage:tracking
- Milestone: none

### Body

~~~~~~~~text
## Context

The M2 `StageChainRail` is functional — 22 chips, color-coded by status, click-to-run, error/success toasts. M3 scope calls for a visually polished version with per-stage thumbnails.

## Feature request

Upgrade the stage-chain rail for M3:

- Each chip that has a `clean` artifact (and whose `output_type` is an image type) shows a small inline thumbnail fetched from `GET /stages/{stage_id}/artifact`
- Chips whose output is JSON or text get an icon/label instead of a thumbnail
- Click-to-select a chip loads it in the artifact viewer pane (new in M3) rather than running it — a separate "Run" button within the selected-chip context triggers execution
- Status colour-coding and pulse animation preserved from M2
- `data-status` and `data-stage-id` attributes preserved for tests and the Playwright driver

## Motivation

The polished rail is the primary visual indicator of a page's processing state. Per-stage thumbnails give the proofer an at-a-glance sense of what each step produced without opening the full artifact viewer.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-13T10:41:30Z

~~~~~~~~text
Triage forked child #89 (`kind:feature, effort:M, model:sonnet, model-effort:medium, status:backlog`).
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-13T10:41:34Z

~~~~~~~~text
Triage decision: approved + needs-tracking. Tracking child issue: #89. Run `/ship-issue` to implement once `bot:ship-issue-ready` is set.
~~~~~~~~

### Comment 3 by ConcaveTrillion at 2026-05-15T09:16:12Z

~~~~~~~~text
Acceptance criteria met as of commit a05ef89. StageChainRail M3 ships: inline thumbnails (lazy-loaded via /stages/{id}/thumbnail), text icons for JSON/text stages, data-stage-id attributes, click-to-select (chip loads ArtifactViewer + StageControlsPanel instead of directly running), Run button in the selected-chip context, status colour-coding and pulse animation preserved.
~~~~~~~~

## #84 M3: side-by-side artifact viewer pane (input vs output comparison)

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCHlQCQ`
- Author: ConcaveTrillion
- Created: 2026-05-13T10:39:24Z
- Closed: 2026-05-15T09:16:19Z
- Labels: kind:feature-request, triage:approved, triage:tracking
- Milestone: none

### Body

~~~~~~~~text
## Context

The M2 chip rail has a "view" link per clean chip that opens the artifact in a new tab. M3 scope replaces this with an in-page side-by-side viewer.

## Feature request

Implement an artifact viewer pane that appears when a chip is selected in the stage-chain rail:

- Two image panels side-by-side: "Stage: [▼ dropdown]" (the selected stage) and "Compare with: [▼ dropdown]" (defaults to the selected stage's primary parent)
- Both panels fetch from `GET /stages/{stage_id}/artifact` with ETag-based cache busting so a re-run immediately shows the new output
- Full image resolution with scroll/zoom — not thumbnails
- For JSON/text output types, renders the raw content in a scrollable code block instead of an image panel
- The viewer pane is hidden when no chip is selected

## Motivation

Side-by-side comparison is the core proofer workflow: did `threshold` improve over `grayscale`? Did `auto_deskew` fix the skew? The viewer makes this judgment possible without opening separate browser tabs.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-13T10:41:45Z

~~~~~~~~text
Triage forked child #90 (`kind:feature, effort:M, model:sonnet, model-effort:medium, status:backlog`).
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-13T10:41:49Z

~~~~~~~~text
Triage decision: approved + needs-tracking. Tracking child issue: #90. Run `/ship-issue` to implement once `bot:ship-issue-ready` is set.
~~~~~~~~

### Comment 3 by ConcaveTrillion at 2026-05-15T09:16:18Z

~~~~~~~~text
Acceptance criteria met as of commit 3ef1b52. ArtifactViewer ships: side-by-side Stage + Compare dropdowns, ETag-based cache busting for re-run freshness (input_hash on row → ETag), full-res image with scroll, text/JSON stages render in scrollable code block, viewer hidden when no chip selected.
~~~~~~~~

## #85 M5: full STAGE_IMPL registry cutover — retire LocalBackend / CpuBackend direct call paths

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCHlROQ`
- Author: ConcaveTrillion
- Created: 2026-05-13T10:39:26Z
- Closed: 2026-05-15T09:16:32Z
- Labels: kind:feature-request, triage:approved, triage:tracking
- Milestone: none

### Body

~~~~~~~~text
## Context

The M2 stage registry (`STAGE_IMPL`) has CPU impls for all 22 stages. But existing call sites in `LocalBackend`, `CpuBackend`, and the legacy `batch_*` job types still call `process_page_cpu` / `run_ocr` / etc. directly, bypassing the registry.

## Feature request

Route every existing call site through the `STAGE_IMPL` registry:

- `LocalBackend.process_page` becomes a 1-line shim: iterate `PAGE_STAGE_IDS` in topological order, call `run_stage` for each
- `CpuBackend` collapses the same way (or is folded into `LocalBackend` if the class distinction no longer carries weight)
- The legacy `batch_process_pages` / `batch_ocr` / `batch_text_postprocess` shim (`core/jobs/legacy_shim.py`) translates to `project_run_dirty` job dispatch rather than calling the old monolithic functions
- No behaviour change for the user — the same stages run in the same order; only the code path changes

## Motivation

This cutover is the prerequisite for M6 cleanup (deleting `LocalBackend`, `CpuBackend`, `process_page_cpu`). It also enables CUDA registry entries (`STAGE_IMPL[stage_id]['cuda']`) to be picked up automatically by `pick_device()` once added, without touching any call sites again.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-13T10:42:01Z

~~~~~~~~text
Triage forked child #91 (`kind:feature, effort:M, model:sonnet, model-effort:medium, status:backlog`).
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-13T10:42:05Z

~~~~~~~~text
Triage decision: approved + needs-tracking. Tracking child issue: #91. Run `/ship-issue` to implement once `bot:ship-issue-ready` is set.
~~~~~~~~

### Comment 3 by ConcaveTrillion at 2026-05-15T09:16:32Z

~~~~~~~~text
Shipped as issue #91 (commit 7bbaf55). CpuBackend.process_page now loops through _PROCESS_PAGE_STAGES calling run_stage for each — no direct process_page_cpu call sites remain in src/. LocalBackend inherits data_root via kwargs. Verified: grep -r 'process_page_cpu(' src/ returns only the function definition. Tests in tests/test_issue91_registry_cutover.py confirm source-inspection and call-path.
~~~~~~~~

## #86 M2: implement bounded deferred-write executor (Q8)

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCHlkdA`
- Author: ConcaveTrillion
- Created: 2026-05-13T10:40:07Z
- Closed: 2026-05-14T20:02:11Z
- Labels: bot:ship-issue-ready, effort:M, kind:feature, model-effort:medium, model:sonnet, status:ready, triage:proposed-by-agent
- Milestone: none

### Body

~~~~~~~~text
Tracks: #80

Implement the bounded deferred-write executor from canonical spec Q8 (`docs/specs/pipeline-task-model.md`): a bounded queue + writer-thread pool that accepts dual-write tasks from `run_stage`, applies backpressure when full, and preserves fail-loudly semantics (write failure → stage `failed` + cascade dirty to descendants).

**Acceptance:**
- [ ] New `core/pipeline/deferred_writer.py` (or equivalent) with `PGDP_STAGE_WRITE_POOL_SIZE` + `PGDP_STAGE_WRITE_QUEUE_CAP` env-var knobs
- [ ] `run_stage` enqueues the dual-write (file fsync + DB upsert) instead of executing it inline
- [ ] Backpressure: runner blocks when queue is full (never drops a write)
- [ ] Write failure path: stage row marked `failed`, dirty cascade fires, exception surfaced to caller
- [ ] Integration test: concurrent `run_stage` calls on a page with a small queue cap complete without data loss
- [ ] Existing stage runner tests stay green

Blocked-by: #106
~~~~~~~~

## #87 M2: plumb ResolvedPageConfig into stage runner

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCHl59g`
- Author: ConcaveTrillion
- Created: 2026-05-13T10:40:54Z
- Closed: 2026-05-14T20:02:10Z
- Labels: bot:ship-issue-ready, effort:M, kind:feature, model-effort:medium, model:sonnet, status:ready, triage:proposed-by-agent
- Milestone: none

### Body

~~~~~~~~text
Tracks: #81

Plumb `ResolvedPageConfig` into `core/pipeline/stage_runner.run_stage` so config-aware stages read the page's resolved config instead of always taking their no-op defaults.

**Acceptance:**
- [ ] `run_stage` accepts an optional `resolved_config: ResolvedPageConfig | None` kwarg (defaults to `None`; no behaviour change when absent)
- [ ] `initial_crop` calls `crop_edges` with configured margins when `resolved_config` is present
- [ ] `manual_deskew_pre` calls `rotate_image` with configured angle when present
- [ ] `threshold` uses the configured threshold level when present (not Otsu-auto)
- [ ] The `POST /stages/{stage_id}/run` route handler resolves config from `ProjectConfigOverrides` + defaults and passes it in
- [ ] Unit tests cover each config-aware stage with and without a resolved config
- [ ] Existing stage runner tests stay green

Blocked-by: #106
~~~~~~~~

## #88 M2: async run flag for slow stages (ocr, extract_illustrations)

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCHmAZw`
- Author: ConcaveTrillion
- Created: 2026-05-13T10:41:09Z
- Closed: 2026-05-14T20:02:12Z
- Labels: bot:ship-issue-ready, effort:M, kind:feature, model-effort:medium, model:sonnet, status:ready, triage:proposed-by-agent
- Milestone: none

### Body

~~~~~~~~text
Tracks: #82

Add an optional `?async=true` query parameter to `POST /api/data/projects/{id}/pages/{idx0}/stages/{stage_id}/run`. When set, the route enqueues a `JobType.run_stage` job and returns `202 Accepted` with `{"job_id": "..."}`. The chip rail uses the async path for slow stages (`ocr`, `extract_illustrations`) and polls the existing job endpoint for completion; all other stages use the synchronous path.

**Acceptance:**
- [ ] `?async=true` returns `202` with `{"job_id": "..."}` for any stage; synchronous path unchanged when flag absent
- [ ] New `JobType.run_stage` job type added to the job runner
- [ ] `StageChainRail` switches `ocr` and `extract_illustrations` chip clicks to the async path
- [ ] Existing synchronous chip-click tests still pass
- [ ] Integration test: `?async=true` on `ocr` completes and the stage transitions to `clean`

Blocked-by: #106
~~~~~~~~

## #89 M3: polished StageChainRail with per-stage inline thumbnails

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCHmJWw`
- Author: ConcaveTrillion
- Created: 2026-05-13T10:41:29Z
- Closed: 2026-05-14T23:16:14Z
- Labels: bot:ship-issue-ready, effort:M, kind:feature, model-effort:medium, model:sonnet, status:in-pr, triage:proposed-by-agent
- Milestone: none

### Body

~~~~~~~~text
Tracks: #83

Upgrade `StageChainRail` to the M3 polished form: each chip with a `clean` image-type artifact shows a small inline thumbnail fetched from `GET /stages/{stage_id}/artifact`; non-image chips show an icon/label. Click-to-select a chip triggers the artifact viewer pane (not a run); a "Run" button in the selected-chip context replaces the click-to-run behaviour.

**Acceptance:**
- [ ] Clean image-type chips show a small thumbnail (≤ 48 px); JSON/text chips show a text icon
- [ ] Clicking a chip selects it (highlights it, loads artifact viewer) rather than running it
- [ ] "Run this stage" button appears in the chip's expanded context when selected
- [ ] `data-status` and `data-stage-id` attributes preserved for Playwright tests
- [ ] Existing chip-rail Vitest tests updated for the new click semantics
- [ ] Thumbnail fetches use ETag revalidation so re-run thumbnails reload without a hard refresh

**Parent:** Tracks #9 (M3: workbench artifact viewer + stage controls panel)

Blocked-by: #106

Blocked-by: #107
~~~~~~~~

## #90 M3: side-by-side artifact viewer pane in workbench

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCHmPMg`
- Author: ConcaveTrillion
- Created: 2026-05-13T10:41:44Z
- Closed: 2026-05-14T23:16:15Z
- Labels: bot:ship-issue-ready, effort:M, kind:feature, model-effort:medium, model:sonnet, status:in-pr, triage:proposed-by-agent
- Milestone: none

### Body

~~~~~~~~text
Tracks: #84

Implement the artifact viewer pane that appears when a chip is selected in the stage-chain rail. Two side-by-side panels: the selected stage's output and its primary parent's output (auto-selected; user can override via dropdown). Both panels fetch from `GET /stages/{stage_id}/artifact` with ETag-based cache busting. Image stages render at full resolution with scroll; JSON/text stages render in a scrollable code block.

Blocked-by: #89

**Acceptance:**
- [ ] Selecting a chip in the rail opens the viewer pane below (or alongside) the rail
- [ ] "Stage" dropdown defaults to the selected chip; "Compare with" defaults to its primary parent
- [ ] Both dropdowns allow selecting any stage
- [ ] Image artifacts render at native resolution with overflow scroll; JSON/text artifacts use a scrollable `<pre>` block
- [ ] ETag-based cache busting: re-running a stage immediately shows the new artifact without manual refresh
- [ ] Pane is hidden when no chip is selected
- [ ] Vitest test: pane renders the correct artifact URL for the selected chip

**Parent:** Tracks #9 (M3: workbench artifact viewer + stage controls panel)

Blocked-by: #106

Blocked-by: #107
~~~~~~~~

## #91 M5: full STAGE_IMPL registry cutover (retire direct LocalBackend/CpuBackend calls)

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCHmWkg`
- Author: ConcaveTrillion
- Created: 2026-05-13T10:42:00Z
- Closed: 2026-05-14T23:16:14Z
- Labels: bot:ship-issue-ready, effort:M, kind:feature, model-effort:medium, model:sonnet, status:in-pr, triage:proposed-by-agent
- Milestone: none

### Body

~~~~~~~~text
Tracks: #85

Route every existing call site that bypasses the `STAGE_IMPL` registry through the registry. `LocalBackend.process_page` becomes a loop over `PAGE_STAGE_IDS` calling `run_stage`. `CpuBackend` collapses similarly. The `legacy_shim.py` `batch_*` translation maps to `project_run_dirty` dispatch rather than calling monolithic functions.

Blocked-by: #86, #87

**Acceptance:**
- [ ] `LocalBackend.process_page` is a ≤ 10-line shim over `run_stage` — no direct calls to `process_page_cpu`
- [ ] `CpuBackend` is likewise a shim (or merged into `LocalBackend` if the class distinction is vacuous)
- [ ] `legacy_shim.py` translates `batch_process_pages` / `batch_ocr` / `batch_text_postprocess` to `project_run_dirty` job dispatch
- [ ] No user-visible behaviour change: the same stages run in the same order
- [ ] End-to-end test: upload test zip, run pipeline, build package succeeds
- [ ] `grep -r "process_page_cpu" src/` returns only the definition (no call sites outside the shim)

**Parent:** Tracks #11 (M5: project-level fan-out + awaiting_review gate)

Blocked-by: #106

Blocked-by: #107
~~~~~~~~

## #95 M4 — Lazy migration of pre-M1 projects + disk-cost UI: Legacy detection

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCHsPZQ`
- Author: ConcaveTrillion
- Created: 2026-05-13T10:56:51Z
- Closed: 2026-05-14T09:46:30Z
- Labels: bot:ship-issue-ready, effort:S, kind:feature, model-effort:low, model:haiku, status:in-pr
- Milestone: spec: m4-lazy-migration-of-pre-m1-projects (#10)

### Body

~~~~~~~~text
Source spec: /workspaces/ocr-container/pd-prep-for-pgdp/docs/specs/2026-05-13-m4-migration-disk-cost-design.md

Section: Legacy detection

(Edit this body before applying. /decompose-spec is a proposal stage.)

Tracks: #10
Spec: /workspaces/ocr-container/pd-prep-for-pgdp/docs/specs/2026-05-13-m4-migration-disk-cost-design.md
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-13T18:02:56Z

~~~~~~~~text
Claimed by ship-issue-0.

- Model: `haiku` / effort: `low`
- Spec: `/workspaces/ocr-container/pd-prep-for-pgdp/docs/specs/2026-05-13-m4-migration-disk-cost-design.md`
- Pre-claim SHA: `80ac2ac42582aaa1da6ede63693e2039fe296398`

Acceptance:
(none)
~~~~~~~~

## #96 M4 — Lazy migration of pre-M1 projects + disk-cost UI: `--force-rebuild` CLI

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCHsP9Q`
- Author: ConcaveTrillion
- Created: 2026-05-13T10:56:52Z
- Closed: 2026-05-14T09:46:31Z
- Labels: bot:ship-issue-ready, effort:M, kind:feature, model-effort:medium, model:sonnet, status:in-pr
- Milestone: spec: m4-lazy-migration-of-pre-m1-projects (#10)

### Body

~~~~~~~~text
Source spec: /workspaces/ocr-container/pd-prep-for-pgdp/docs/specs/2026-05-13-m4-migration-disk-cost-design.md

Section: `--force-rebuild` CLI

Blocked-by: #95

Tracks: #10
Spec: /workspaces/ocr-container/pd-prep-for-pgdp/docs/specs/2026-05-13-m4-migration-disk-cost-design.md

Blocked-by: #106
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-13T18:32:56Z

~~~~~~~~text
Claimed by ship-issue-0.

- Model: `sonnet` / effort: `medium`
- Spec: `/workspaces/ocr-container/pd-prep-for-pgdp/docs/specs/2026-05-13-m4-migration-disk-cost-design.md`
- Pre-claim SHA: `982f2e705f7de681a1d3420a0a5f706cef917427`

Acceptance:
(none)
~~~~~~~~

## #97 M4 — Lazy migration of pre-M1 projects + disk-cost UI: Disk-cost banner

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCHsRNQ`
- Author: ConcaveTrillion
- Created: 2026-05-13T10:56:54Z
- Closed: 2026-05-15T01:44:40Z
- Labels: bot:ship-issue-ready, effort:M, kind:feature, model-effort:medium, model:sonnet, status:done
- Milestone: spec: m4-lazy-migration-of-pre-m1-projects (#10)

### Body

~~~~~~~~text
Source spec: /workspaces/ocr-container/pd-prep-for-pgdp/docs/specs/2026-05-13-m4-migration-disk-cost-design.md

Section: Disk-cost banner

(Edit this body before applying. /decompose-spec is a proposal stage.)

Tracks: #10
Spec: /workspaces/ocr-container/pd-prep-for-pgdp/docs/specs/2026-05-13-m4-migration-disk-cost-design.md

Blocked-by: #96

Blocked-by: #106
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-13T20:23:33Z

~~~~~~~~text
Claimed by ship-issue-1.

- Model: `sonnet` / effort: `medium`
- Spec: `/workspaces/ocr-container/pd-prep-for-pgdp/docs/specs/2026-05-13-m4-migration-disk-cost-design.md`
- Pre-claim SHA: `4e204ea4e846cce286563b1657a50d5f4216efa5`

Acceptance:
(none)
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-15T01:44:39Z

~~~~~~~~text
Shipped as M4. Closed via status:done label; see 08-roadmap-shipped.md for the full delivery summary.
~~~~~~~~

## #98 Word-delete editor: undo strategy: Core undo window (debounce + undo action + expiry/confirm)

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCHsSvA`
- Author: ConcaveTrillion
- Created: 2026-05-13T10:56:58Z
- Closed: 2026-05-14T20:02:12Z
- Labels: bot:ship-issue-ready, effort:M, kind:feature, model-effort:medium, model:sonnet, status:ready
- Milestone: spec: word-delete-editor-undo-strategy (#12)

### Body

~~~~~~~~text
Source spec: /workspaces/ocr-container/pd-prep-for-pgdp/docs/specs/2026-05-13-word-delete-undo-design.md

Sections: Debounce window, Undo action, Commit on expiry or dismissal

Core state machine: optimistic remove from canvas, 5s countdown banner, AbortController cancel on Ctrl+Z/Undo button, fire DELETE on expiry or confirm click.

Tracks: #12
Spec: /workspaces/ocr-container/pd-prep-for-pgdp/docs/specs/2026-05-13-word-delete-undo-design.md

Blocked-by: #106
~~~~~~~~

## #99 Word-delete editor: undo strategy: Navigate-away commit + no cross-delete stacking

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCHsTUA`
- Author: ConcaveTrillion
- Created: 2026-05-13T10:57:00Z
- Closed: 2026-05-14T23:16:12Z
- Labels: bot:ship-issue-ready, effort:S, kind:feature, model-effort:low, model:haiku, status:in-pr
- Milestone: spec: word-delete-editor-undo-strategy (#12)

### Body

~~~~~~~~text
Source spec: /workspaces/ocr-container/pd-prep-for-pgdp/docs/specs/2026-05-13-word-delete-undo-design.md

Sections: Navigate-away behaviour, No cross-delete stacking

Fire DELETE immediately on route change (useBlocker / useEffect cleanup). Second delete while window is open commits first batch and opens a new window.

Blocked-by: #98

Tracks: #12
Spec: /workspaces/ocr-container/pd-prep-for-pgdp/docs/specs/2026-05-13-word-delete-undo-design.md

Blocked-by: #106

Blocked-by: #107
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-14T20:35:01Z

~~~~~~~~text
Claimed by ship-issue-0.

- Model: `haiku` / effort: `low`
- Spec: `/workspaces/ocr-container/pd-prep-for-pgdp/docs/specs/2026-05-13-word-delete-undo-design.md`
- Pre-claim SHA: `b352cc458b3731fbd9eadc8129606482f8ada7a8`

Acceptance:
(none)
~~~~~~~~

## #100 Konva canvas rotate handles for workbench: Rotate mode

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCHsU-w`
- Author: ConcaveTrillion
- Created: 2026-05-13T10:57:04Z
- Closed: 2026-05-14T20:02:10Z
- Labels: bot:ship-issue-ready, effort:M, kind:feature, model-effort:medium, model:sonnet, status:ready
- Milestone: spec: konva-canvas-rotate-handles-for (#13)

### Body

~~~~~~~~text
Source spec: /workspaces/ocr-container/pd-prep-for-pgdp/docs/specs/2026-05-13-konva-rotate-design.md

Section: Rotate mode

(Edit this body before applying. /decompose-spec is a proposal stage.)

Tracks: #13
Spec: /workspaces/ocr-container/pd-prep-for-pgdp/docs/specs/2026-05-13-konva-rotate-design.md

Blocked-by: #106
~~~~~~~~

## #101 Konva canvas rotate handles for workbench: Persistence and re-run

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCHsWGA`
- Author: ConcaveTrillion
- Created: 2026-05-13T10:57:06Z
- Closed: 2026-05-14T23:16:13Z
- Labels: bot:ship-issue-ready, effort:M, kind:feature, model-effort:medium, model:sonnet, status:in-pr
- Milestone: spec: konva-canvas-rotate-handles-for (#13)

### Body

~~~~~~~~text
Source spec: /workspaces/ocr-container/pd-prep-for-pgdp/docs/specs/2026-05-13-konva-rotate-design.md

Section: Persistence and re-run

Blocked-by: #87, #100

Tracks: #13
Spec: /workspaces/ocr-container/pd-prep-for-pgdp/docs/specs/2026-05-13-konva-rotate-design.md

Blocked-by: #106

Blocked-by: #107
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-14T20:45:33Z

~~~~~~~~text
Claimed by ship-issue-0.

- Model: `sonnet` / effort: `medium`
- Spec: `/workspaces/ocr-container/pd-prep-for-pgdp/docs/specs/2026-05-13-konva-rotate-design.md`
- Pre-claim SHA: `29d818d1d489daca5e547e2bd039087145b911c6`

Acceptance:
(none)
~~~~~~~~

## #102 Konva canvas rotate handles for workbench: Angle range and precision

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCHsW_g`
- Author: ConcaveTrillion
- Created: 2026-05-13T10:57:08Z
- Closed: 2026-05-14T23:16:13Z
- Labels: bot:ship-issue-ready, effort:S, kind:feature, model-effort:low, model:haiku, status:in-pr
- Milestone: spec: konva-canvas-rotate-handles-for (#13)

### Body

~~~~~~~~text
Source spec: /workspaces/ocr-container/pd-prep-for-pgdp/docs/specs/2026-05-13-konva-rotate-design.md

Section: Angle range and precision

Blocked-by: #100

Tracks: #13
Spec: /workspaces/ocr-container/pd-prep-for-pgdp/docs/specs/2026-05-13-konva-rotate-design.md

Blocked-by: #106

Blocked-by: #107
~~~~~~~~

## #103 Konva canvas rotate handles for workbench: Discrete orientation buttons (90° CW / CCW / 180°)

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCHsXmA`
- Author: ConcaveTrillion
- Created: 2026-05-13T10:57:09Z
- Closed: 2026-05-14T23:16:14Z
- Labels: bot:ship-issue-ready, effort:S, kind:feature, model-effort:low, model:haiku, status:in-pr
- Milestone: spec: konva-canvas-rotate-handles-for (#13)

### Body

~~~~~~~~text
Source spec: /workspaces/ocr-container/pd-prep-for-pgdp/docs/specs/2026-05-13-konva-rotate-design.md

Section: Discrete orientation buttons

For plates printed sideways or upside-down in a book. Buttons apply immediately (no separate Apply step). Additive scope added 2026-05-13.

Blocked-by: #101

Tracks: #13
Spec: /workspaces/ocr-container/pd-prep-for-pgdp/docs/specs/2026-05-13-konva-rotate-design.md

Blocked-by: #106

Blocked-by: #107
~~~~~~~~

## #106 fix(ci): diagnose and fix broken CI on wip/ship-issue

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCILRxg`
- Author: ConcaveTrillion
- Created: 2026-05-13T12:14:53Z
- Closed: 2026-05-14T09:46:28Z
- Labels: bot:fix-wip, bot:ship-issue-ready, kind:bug, model-effort:high, model:sonnet, priority:high, status:ready
- Milestone: none

### Body

~~~~~~~~text
fix(ci): diagnose and fix broken CI on wip/ship-issue

`make ci` is failing on the `wip/ship-issue` integration branch after rebasing onto main. This is a `bot:fix-wip` diagnostic issue — the bot must identify the root cause and implement the minimal fix so `make ci` passes again, then exit.

The fix will land through the normal rolling PR path. All issues blocked by this one will automatically become eligible once this issue is closed.

Spec: (inline — see acceptance below)

Acceptance:
- [ ] `make ci` passes with no regressions introduced

**CI failure captured at 2026-05-13T12:14:51Z:**

```
📦 Installing dependencies...
uv sync --group dev
Resolved 178 packages in 0.77ms
Checked 136 packages in 1ms
🪝 Setting up pre-commit hooks...
uv run pre-commit install || true
An unexpected error has occurred: PermissionError: [Errno 1] Operation not permitted: '/workspaces/ocr-container/pd-prep-for-pgdp/.git/hooks/pre-commit'
Check the log at /home/claude-bot/.cache/pre-commit/pre-commit.log
🔄 Reinstalling pd-prep-for-pgdp so hatch-vcs picks up the current HEAD / tags...
Resolved 123 packages in 1.75s
   Building pd-prep-for-pgdp @ file:///srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp
      Built pd-prep-for-pgdp @ file:///srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp
Prepared 1 package in 524ms
Uninstalled 2 packages in 7ms
Installed 2 packages in 63ms
 - pd-prep-for-pgdp==0.2.dev184+gb4f29605e (from file:///srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp)
 + pd-prep-for-pgdp==0.2.dev186+ga129a9814.d20260513 (from file:///srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp)
 - python-doctr==1.0.2a0 (from git+https://github.com/mindee/doctr.git@a8694b80b4e8ed067ec8299efd0f1374f0b08936)
 + python-doctr==1.0.2a0 (from git+https://github.com/mindee/doctr.git@bc0db21e030926b4b7641fe71f7b8367e3ab042a)
Uninstalled 1 package in 11ms
Installed 1 package in 37ms
0.2.dev186+ga129a9814.d20260513
✅ Setup complete!
📦 Installing frontend deps...
  (via /home/claude-bot/.local/bin/mise exec)

up to date, audited 473 packages in 2s

102 packages are looking for funding
  run `npm fund` for details

6 moderate severity vulnerabilities

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.
uv run pre-commit run --all-files
pre-commit-update........................................................Passed
trim trailing whitespace.................................................Passed
fix end of files.........................................................Failed
- hook id: end-of-file-fixer
- exit code: 1
- files were modified by this hook

Fixing openapi.json

check yaml...............................................................Passed
check json...............................................................Passed
ruff check...............................................................Passed
ruff check...............................................................Passed
ruff format..............................................................Passed
markdownlint-cli2........................................................Passed
frontend tsc -b --noEmit.................................................Passed
frontend eslint..........................................................Passed
frontend prettier --check................................................Passed
make: *** [Makefile:250: pre-commit-check] Error 1
```

---

**CI failure update captured at 2026-05-13T15:15:05Z:**

```
📦 Installing dependencies...
uv sync --group dev
Resolved 178 packages in 1ms
Checked 136 packages in 1ms
🪝 Setting up pre-commit hooks...
uv run pre-commit install || true
An unexpected error has occurred: PermissionError: [Errno 1] Operation not permitted: '/workspaces/ocr-container/pd-prep-for-pgdp/.git/hooks/pre-commit'
Check the log at /home/claude-bot/.cache/pre-commit/pre-commit.log
🔄 Reinstalling pd-prep-for-pgdp so hatch-vcs picks up the current HEAD / tags...
Resolved 123 packages in 1.00s
   Building pd-prep-for-pgdp @ file:///srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp
      Built pd-prep-for-pgdp @ file:///srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp
Prepared 1 package in 463ms
Uninstalled 2 packages in 5ms
Installed 2 packages in 24ms
 - pd-prep-for-pgdp==0.2.dev186+gdfca4b551 (from file:///srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp)
 + pd-prep-for-pgdp==0.2.dev199+gc94964bdc (from file:///srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp)
 - python-doctr==1.0.2a0 (from git+https://github.com/mindee/doctr.git@a8694b80b4e8ed067ec8299efd0f1374f0b08936)
 + python-doctr==1.0.2a0 (from git+https://github.com/mindee/doctr.git@bc0db21e030926b4b7641fe71f7b8367e3ab042a)
Uninstalled 1 package in 5ms
Installed 1 package in 6ms
0.2.dev199+gc94964bdc
✅ Setup complete!
📦 Installing frontend deps...
  (via /home/claude-bot/.local/bin/mise exec)

up to date, audited 473 packages in 1s

102 packages are looking for funding
  run `npm fund` for details

6 moderate severity vulnerabilities

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.
uv run pre-commit run --all-files
pre-commit-update........................................................Passed
trim trailing whitespace.................................................Passed
fix end of files.........................................................Passed
check yaml...............................................................Passed
check json...............................................................Passed
ruff check...............................................................Passed
ruff check...............................................................Passed
ruff format..............................................................Passed
markdownlint-cli2........................................................Passed
frontend tsc -b --noEmit.................................................Passed
frontend eslint..........................................................Passed
frontend prettier --check................................................Passed
📤 Exporting OpenAPI schema and regenerating TS types...
# Write to repo-root openapi.json — the committed source-of-truth that
# tests/test_openapi_spec_committed.py drift-guards against. The frontend
# `openapi:gen` script reads `../openapi.json` (see frontend/package.json).
#
# Codegen lands in `types.gen.ts`, *not* the hand-written `types.ts`.
# SPA consumers still import from `types.ts`; the generated file exists
# so we can audit the diff and migrate surfaces deliberately (P4 #20).
uv run python scripts/export_openapi.py openapi.json
Traceback (most recent call last):
  File "/srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp/scripts/export_openapi.py", line 18, in <module>
    from pd_prep_for_pgdp.bootstrap import build_app
  File "/srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp/src/pd_prep_for_pgdp/bootstrap.py", line 24, in <module>
    from .adapters.database.base import IDatabase
  File "/srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp/src/pd_prep_for_pgdp/adapters/database/__init__.py", line 3, in <module>
    from .base import IDatabase, SearchResult, SearchResultList
ImportError: cannot import name 'SearchResultList' from 'pd_prep_for_pgdp.adapters.database.base' (/srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp/src/pd_prep_for_pgdp/adapters/database/base.py)
make: *** [Makefile:229: openapi-export] Error 1
```

---

**CI failure update captured at 2026-05-13T18:15:13Z:**

```
📦 Installing dependencies...
uv sync --group dev
Resolved 178 packages in 0.76ms
   Building pd-prep-for-pgdp @ file:///srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp
      Built pd-prep-for-pgdp @ file:///srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp
Prepared 1 package in 392ms
Uninstalled 1 package in 0.81ms
Installed 1 package in 1ms
 - pd-prep-for-pgdp==0.2.dev185+gce4bcf69a (from file:///srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp)
 + pd-prep-for-pgdp==0.2.dev204+g982f2e705 (from file:///srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp)
🪝 Setting up pre-commit hooks...
uv run pre-commit install || true
An unexpected error has occurred: PermissionError: [Errno 1] Operation not permitted: '/workspaces/ocr-container/pd-prep-for-pgdp/.git/hooks/pre-commit'
Check the log at /home/claude-bot/.cache/pre-commit/pre-commit.log
🔄 Reinstalling pd-prep-for-pgdp so hatch-vcs picks up the current HEAD / tags...
Resolved 123 packages in 1.10s
   Building pd-prep-for-pgdp @ file:///srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp
      Built pd-prep-for-pgdp @ file:///srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp
Prepared 1 package in 581ms
Uninstalled 2 packages in 3ms
Installed 2 packages in 25ms
 ~ pd-prep-for-pgdp==0.2.dev204+g982f2e705 (from file:///srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp)
 - python-doctr==1.0.2a0 (from git+https://github.com/mindee/doctr.git@a8694b80b4e8ed067ec8299efd0f1374f0b08936)
 + python-doctr==1.0.2a0 (from git+https://github.com/mindee/doctr.git@bc0db21e030926b4b7641fe71f7b8367e3ab042a)
Uninstalled 1 package in 3ms
Installed 1 package in 15ms
0.2.dev204+g982f2e705
✅ Setup complete!
📦 Installing frontend deps...
  (via /home/claude-bot/.local/bin/mise exec)

up to date, audited 473 packages in 1s

102 packages are looking for funding
  run `npm fund` for details

6 moderate severity vulnerabilities

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.
uv run pre-commit run --all-files
pre-commit-update........................................................Passed
trim trailing whitespace.................................................Passed
fix end of files.........................................................Passed
check yaml...............................................................Passed
check json...............................................................Passed
ruff check...............................................................Passed
ruff check...............................................................Passed
ruff format..............................................................Passed
markdownlint-cli2........................................................Passed
frontend tsc -b --noEmit.................................................Passed
frontend eslint..........................................................Passed
frontend prettier --check................................................Failed
- hook id: frontend-prettier
- exit code: 1

Checking formatting...
[warn] src/components/ui/Select.tsx
[warn] Code style issues found in the above file. Run Prettier with --write to fix.

make: *** [Makefile:250: pre-commit-check] Error 1
```

---

**CI failure update captured at 2026-05-13T18:45:14Z:**

```
📦 Installing dependencies...
uv sync --group dev
Resolved 178 packages in 1ms
Checked 136 packages in 1ms
🪝 Setting up pre-commit hooks...
uv run pre-commit install || true
An unexpected error has occurred: PermissionError: [Errno 1] Operation not permitted: '/workspaces/ocr-container/pd-prep-for-pgdp/.git/hooks/pre-commit'
Check the log at /home/claude-bot/.cache/pre-commit/pre-commit.log
🔄 Reinstalling pd-prep-for-pgdp so hatch-vcs picks up the current HEAD / tags...
Resolved 123 packages in 1.56s
   Building pd-prep-for-pgdp @ file:///srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp
      Built pd-prep-for-pgdp @ file:///srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp
Prepared 1 package in 439ms
Uninstalled 2 packages in 3ms
Installed 2 packages in 17ms
 - pd-prep-for-pgdp==0.2.dev204+g982f2e705 (from file:///srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp)
 + pd-prep-for-pgdp==0.2.dev205+g0986dfbfc (from file:///srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp)
 - python-doctr==1.0.2a0 (from git+https://github.com/mindee/doctr.git@a8694b80b4e8ed067ec8299efd0f1374f0b08936)
 + python-doctr==1.0.2a0 (from git+https://github.com/mindee/doctr.git@bc0db21e030926b4b7641fe71f7b8367e3ab042a)
Uninstalled 1 package in 3ms
Installed 1 package in 7ms
0.2.dev205+g0986dfbfc
✅ Setup complete!
📦 Installing frontend deps...
  (via /home/claude-bot/.local/bin/mise exec)

up to date, audited 473 packages in 1s

102 packages are looking for funding
  run `npm fund` for details

6 moderate severity vulnerabilities

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.
uv run pre-commit run --all-files
pre-commit-update........................................................Passed
trim trailing whitespace.................................................Passed
fix end of files.........................................................Passed
check yaml...............................................................Passed
check json...............................................................Passed
ruff check...............................................................Passed
ruff check...............................................................Passed
ruff format..............................................................Passed
markdownlint-cli2........................................................Passed
frontend tsc -b --noEmit.................................................Passed
frontend eslint..........................................................Passed
frontend prettier --check................................................Failed
- hook id: frontend-prettier
- exit code: 1

Checking formatting...
[warn] src/components/ui/Select.tsx
[warn] Code style issues found in the above file. Run Prettier with --write to fix.

make: *** [Makefile:250: pre-commit-check] Error 1
```

---

**CI failure update captured at 2026-05-13T19:02:51Z:**

```
tests/test_three_page_book_fixture.py::test_fixture_dest_parent_is_created PASSED [ 96%]
tests/test_three_page_book_fixture.py::test_each_page_decodes_with_distinct_content[0] PASSED [ 97%]
tests/test_three_page_book_fixture.py::test_each_page_decodes_with_distinct_content[1] PASSED [ 97%]
tests/test_three_page_book_fixture.py::test_each_page_decodes_with_distinct_content[2] PASSED [ 97%]
tests/test_thumbnail_pool.py::test_resolve_workers_explicit_override_wins PASSED [ 97%]
tests/test_thumbnail_pool.py::test_resolve_workers_env_when_no_override PASSED [ 97%]
tests/test_thumbnail_pool.py::test_resolve_workers_defaults_to_cpu_count PASSED [ 97%]
tests/test_thumbnail_pool.py::test_resolve_workers_clamps_below_one_to_one PASSED [ 97%]
tests/test_thumbnail_pool.py::test_pool_used_when_workers_ge_two PASSED  [ 97%]
tests/test_thumbnail_pool.py::test_pool_not_used_when_workers_is_one PASSED [ 98%]
tests/test_thumbnail_pool.py::test_pool_preserves_thumbnail_ordering PASSED [ 98%]
tests/test_thumbnail_pool.py::test_pool_progress_cb_fires_per_page PASSED [ 98%]
tests/test_unsplit_page_route.py::test_unsplit_returns_parent_page PASSED [ 98%]
tests/test_unsplit_page_route.py::test_unsplit_deletes_both_siblings PASSED [ 98%]
tests/test_unsplit_page_route.py::test_unsplit_parent_still_visible PASSED [ 98%]
tests/test_unsplit_page_route.py::test_unsplit_deletes_page_stages_rows PASSED [ 98%]
tests/test_unsplit_page_route.py::test_unsplit_422_for_root_page PASSED  [ 98%]
tests/test_unsplit_page_route.py::test_unsplit_404_for_missing_page PASSED [ 99%]
tests/test_unsplit_page_route.py::test_unsplit_404_for_missing_project PASSED [ 99%]
tests/test_update_page_route.py::test_patch_page_type_updates_row PASSED [ 99%]
tests/test_update_page_route.py::test_patch_alignment_updates_row PASSED [ 99%]
tests/test_update_page_route.py::test_patch_splits_replaces_list PASSED  [ 99%]
tests/test_update_page_route.py::test_patch_config_overrides_parsed PASSED [ 99%]
tests/test_update_page_route.py::test_patch_unknown_project_404 PASSED   [ 99%]
tests/test_update_page_route.py::test_patch_unknown_page_404 PASSED      [ 99%]
tests/test_update_page_route.py::test_patch_other_users_project_404 PASSED [100%]

=================================== FAILURES ===================================
_____________________ test_force_rebuild_page_idx_narrows ______________________

tmp_path = PosixPath('/tmp/pytest-of-claude-bot/pytest-479/test_force_rebuild_page_idx_na0')

    @pytest.mark.asyncio
    async def test_force_rebuild_page_idx_narrows(tmp_path: Path) -> None:
        """--page-idx limits rebuild to one page; other pages untouched."""
        db, data_root = await _seed_db(tmp_path, page_count=2)
        await db.close()

        import pd_prep_for_pgdp.cli.migrate_projects as m

        settings = _make_settings(tmp_path, tmp_path / "state.db", data_root)
        saved = m.Settings
        m.Settings = lambda: settings  # type: ignore[assignment,misc]
        try:
            args = _parse_args(["proj1", "--force-rebuild", "--page-idx", "0"])
            args.data_root = data_root
            out = io.StringIO()
            rc = await _run(args, stdout=out)
        finally:
            m.Settings = saved

        assert rc == 0

        db2 = SqliteDatabase(f"sqlite:///{(tmp_path / 'state.db').as_posix()}")
        await db2.initialize()
        try:
            rows0 = await db2.list_page_stages_for_page("proj1", "0000")
            rows1 = await db2.list_page_stages_for_page("proj1", "0001")
            assert all(r.status == PageStageStatus.dirty for r in rows0), "page 0 must be dirty"
>           assert all(r.status == PageStageStatus.not_run for r in rows1), "page 1 must be untouched"
E           AssertionError: page 1 must be untouched
E           assert False
E            +  where False = all(<generator object test_force_rebuild_page_idx_narrows.<locals>.<genexpr> at 0x76fb5c18fe00>)

tests/test_migrate_projects_cli.py:251: AssertionError
=============================== warnings summary ===============================
tests/test_thumbnail_pool.py::test_pool_used_when_workers_ge_two
tests/test_thumbnail_pool.py::test_pool_used_when_workers_ge_two
tests/test_thumbnail_pool.py::test_pool_preserves_thumbnail_ordering
tests/test_thumbnail_pool.py::test_pool_preserves_thumbnail_ordering
tests/test_thumbnail_pool.py::test_pool_progress_cb_fires_per_page
tests/test_thumbnail_pool.py::test_pool_progress_cb_fires_per_page
  /usr/local/lib/python3.13/multiprocessing/popen_fork.py:67: DeprecationWarning: This process (pid=2626387) is multi-threaded, use of fork() may lead to deadlocks in the child.
    self.pid = os.fork()

-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
=========================== short test summary info ============================
FAILED tests/test_migrate_projects_cli.py::test_force_rebuild_page_idx_narrows
======= 1 failed, 803 passed, 7 skipped, 6 warnings in 87.30s (0:01:27) ========
make: *** [Makefile:253: test] Error 1
```

---

**CI failure update captured at 2026-05-13T19:15:22Z:**

```
📦 Installing dependencies...
uv sync --group dev
Resolved 178 packages in 1ms
Checked 136 packages in 1ms
🪝 Setting up pre-commit hooks...
uv run pre-commit install || true
An unexpected error has occurred: PermissionError: [Errno 1] Operation not permitted: '/workspaces/ocr-container/pd-prep-for-pgdp/.git/hooks/pre-commit'
Check the log at /home/claude-bot/.cache/pre-commit/pre-commit.log
🔄 Reinstalling pd-prep-for-pgdp so hatch-vcs picks up the current HEAD / tags...
Resolved 123 packages in 1.81s
   Building pd-prep-for-pgdp @ file:///srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp
      Built pd-prep-for-pgdp @ file:///srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp
Prepared 1 package in 484ms
Uninstalled 2 packages in 5ms
Installed 2 packages in 22ms
 ~ pd-prep-for-pgdp==0.2.dev205+g0986dfbfc (from file:///srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp)
 - python-doctr==1.0.2a0 (from git+https://github.com/mindee/doctr.git@a8694b80b4e8ed067ec8299efd0f1374f0b08936)
 + python-doctr==1.0.2a0 (from git+https://github.com/mindee/doctr.git@bc0db21e030926b4b7641fe71f7b8367e3ab042a)
Uninstalled 1 package in 5ms
Installed 1 package in 7ms
0.2.dev205+g0986dfbfc
✅ Setup complete!
📦 Installing frontend deps...
  (via /home/claude-bot/.local/bin/mise exec)

up to date, audited 473 packages in 2s

102 packages are looking for funding
  run `npm fund` for details

6 moderate severity vulnerabilities

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.
uv run pre-commit run --all-files
pre-commit-update........................................................Passed
trim trailing whitespace.................................................Passed
fix end of files.........................................................Passed
check yaml...............................................................Passed
check json...............................................................Passed
ruff check...............................................................Passed
ruff check...............................................................Passed
ruff format..............................................................Passed
markdownlint-cli2........................................................Passed
frontend tsc -b --noEmit.................................................Passed
frontend eslint..........................................................Passed
frontend prettier --check................................................Failed
- hook id: frontend-prettier
- exit code: 1

Checking formatting...
[warn] src/components/ui/Select.tsx
[warn] Code style issues found in the above file. Run Prettier with --write to fix.

make: *** [Makefile:250: pre-commit-check] Error 1
```

---

**CI failure update captured at 2026-05-13T19:32:50Z:**

```
tests/test_three_page_book_fixture.py::test_fixture_dest_parent_is_created PASSED [ 96%]
tests/test_three_page_book_fixture.py::test_each_page_decodes_with_distinct_content[0] PASSED [ 97%]
tests/test_three_page_book_fixture.py::test_each_page_decodes_with_distinct_content[1] PASSED [ 97%]
tests/test_three_page_book_fixture.py::test_each_page_decodes_with_distinct_content[2] PASSED [ 97%]
tests/test_thumbnail_pool.py::test_resolve_workers_explicit_override_wins PASSED [ 97%]
tests/test_thumbnail_pool.py::test_resolve_workers_env_when_no_override PASSED [ 97%]
tests/test_thumbnail_pool.py::test_resolve_workers_defaults_to_cpu_count PASSED [ 97%]
tests/test_thumbnail_pool.py::test_resolve_workers_clamps_below_one_to_one PASSED [ 97%]
tests/test_thumbnail_pool.py::test_pool_used_when_workers_ge_two PASSED  [ 97%]
tests/test_thumbnail_pool.py::test_pool_not_used_when_workers_is_one PASSED [ 98%]
tests/test_thumbnail_pool.py::test_pool_preserves_thumbnail_ordering PASSED [ 98%]
tests/test_thumbnail_pool.py::test_pool_progress_cb_fires_per_page PASSED [ 98%]
tests/test_unsplit_page_route.py::test_unsplit_returns_parent_page PASSED [ 98%]
tests/test_unsplit_page_route.py::test_unsplit_deletes_both_siblings PASSED [ 98%]
tests/test_unsplit_page_route.py::test_unsplit_parent_still_visible PASSED [ 98%]
tests/test_unsplit_page_route.py::test_unsplit_deletes_page_stages_rows PASSED [ 98%]
tests/test_unsplit_page_route.py::test_unsplit_422_for_root_page PASSED  [ 98%]
tests/test_unsplit_page_route.py::test_unsplit_404_for_missing_page PASSED [ 99%]
tests/test_unsplit_page_route.py::test_unsplit_404_for_missing_project PASSED [ 99%]
tests/test_update_page_route.py::test_patch_page_type_updates_row PASSED [ 99%]
tests/test_update_page_route.py::test_patch_alignment_updates_row PASSED [ 99%]
tests/test_update_page_route.py::test_patch_splits_replaces_list PASSED  [ 99%]
tests/test_update_page_route.py::test_patch_config_overrides_parsed PASSED [ 99%]
tests/test_update_page_route.py::test_patch_unknown_project_404 PASSED   [ 99%]
tests/test_update_page_route.py::test_patch_unknown_page_404 PASSED      [ 99%]
tests/test_update_page_route.py::test_patch_other_users_project_404 PASSED [100%]

=================================== FAILURES ===================================
_____________________ test_force_rebuild_page_idx_narrows ______________________

tmp_path = PosixPath('/tmp/pytest-of-claude-bot/pytest-491/test_force_rebuild_page_idx_na0')

    @pytest.mark.asyncio
    async def test_force_rebuild_page_idx_narrows(tmp_path: Path) -> None:
        """--page-idx limits rebuild to one page; other pages untouched."""
        db, data_root = await _seed_db(tmp_path, page_count=2)
        await db.close()

        import pd_prep_for_pgdp.cli.migrate_projects as m

        settings = _make_settings(tmp_path, tmp_path / "state.db", data_root)
        saved = m.Settings
        m.Settings = lambda: settings  # type: ignore[assignment,misc]
        try:
            args = _parse_args(["proj1", "--force-rebuild", "--page-idx", "0"])
            args.data_root = data_root
            out = io.StringIO()
            rc = await _run(args, stdout=out)
        finally:
            m.Settings = saved

        assert rc == 0

        db2 = SqliteDatabase(f"sqlite:///{(tmp_path / 'state.db').as_posix()}")
        await db2.initialize()
        try:
            rows0 = await db2.list_page_stages_for_page("proj1", "0000")
            rows1 = await db2.list_page_stages_for_page("proj1", "0001")
            assert all(r.status == PageStageStatus.dirty for r in rows0), "page 0 must be dirty"
>           assert all(r.status == PageStageStatus.not_run for r in rows1), "page 1 must be untouched"
E           AssertionError: page 1 must be untouched
E           assert False
E            +  where False = all(<generator object test_force_rebuild_page_idx_narrows.<locals>.<genexpr> at 0x71af4c5ae260>)

tests/test_migrate_projects_cli.py:251: AssertionError
=============================== warnings summary ===============================
tests/test_thumbnail_pool.py::test_pool_used_when_workers_ge_two
tests/test_thumbnail_pool.py::test_pool_used_when_workers_ge_two
tests/test_thumbnail_pool.py::test_pool_preserves_thumbnail_ordering
tests/test_thumbnail_pool.py::test_pool_preserves_thumbnail_ordering
tests/test_thumbnail_pool.py::test_pool_progress_cb_fires_per_page
tests/test_thumbnail_pool.py::test_pool_progress_cb_fires_per_page
  /usr/local/lib/python3.13/multiprocessing/popen_fork.py:67: DeprecationWarning: This process (pid=2647956) is multi-threaded, use of fork() may lead to deadlocks in the child.
    self.pid = os.fork()

-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
=========================== short test summary info ============================
FAILED tests/test_migrate_projects_cli.py::test_force_rebuild_page_idx_narrows
======= 1 failed, 803 passed, 7 skipped, 6 warnings in 87.42s (0:01:27) ========
make: *** [Makefile:253: test] Error 1
```

---

**CI failure update captured at 2026-05-13T19:45:24Z:**

```
📦 Installing dependencies...
uv sync --group dev
Resolved 178 packages in 0.76ms
Checked 136 packages in 0.95ms
🪝 Setting up pre-commit hooks...
uv run pre-commit install || true
An unexpected error has occurred: PermissionError: [Errno 1] Operation not permitted: '/workspaces/ocr-container/pd-prep-for-pgdp/.git/hooks/pre-commit'
Check the log at /home/claude-bot/.cache/pre-commit/pre-commit.log
🔄 Reinstalling pd-prep-for-pgdp so hatch-vcs picks up the current HEAD / tags...
Resolved 123 packages in 2.16s
   Building pd-prep-for-pgdp @ file:///srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp
      Built pd-prep-for-pgdp @ file:///srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp
Prepared 1 package in 461ms
Uninstalled 2 packages in 5ms
Installed 2 packages in 19ms
 ~ pd-prep-for-pgdp==0.2.dev205+g0986dfbfc (from file:///srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp)
 - python-doctr==1.0.2a0 (from git+https://github.com/mindee/doctr.git@a8694b80b4e8ed067ec8299efd0f1374f0b08936)
 + python-doctr==1.0.2a0 (from git+https://github.com/mindee/doctr.git@bc0db21e030926b4b7641fe71f7b8367e3ab042a)
Uninstalled 1 package in 5ms
Installed 1 package in 7ms
0.2.dev205+g0986dfbfc
✅ Setup complete!
📦 Installing frontend deps...
  (via /home/claude-bot/.local/bin/mise exec)

up to date, audited 473 packages in 1s

102 packages are looking for funding
  run `npm fund` for details

6 moderate severity vulnerabilities

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.
uv run pre-commit run --all-files
pre-commit-update........................................................Passed
trim trailing whitespace.................................................Passed
fix end of files.........................................................Passed
check yaml...............................................................Passed
check json...............................................................Passed
ruff check...............................................................Passed
ruff check...............................................................Passed
ruff format..............................................................Passed
markdownlint-cli2........................................................Passed
frontend tsc -b --noEmit.................................................Passed
frontend eslint..........................................................Passed
frontend prettier --check................................................Failed
- hook id: frontend-prettier
- exit code: 1

Checking formatting...
[warn] src/components/ui/Select.tsx
[warn] Code style issues found in the above file. Run Prettier with --write to fix.

make: *** [Makefile:250: pre-commit-check] Error 1
```

---

**CI failure update captured at 2026-05-13T20:23:24Z:**

```
📦 Installing dependencies...
uv sync --group dev
Resolved 178 packages in 0.77ms
Checked 136 packages in 1ms
🪝 Setting up pre-commit hooks...
uv run pre-commit install || true
An unexpected error has occurred: PermissionError: [Errno 1] Operation not permitted: '/workspaces/ocr-container/pd-prep-for-pgdp/.git/hooks/pre-commit'
Check the log at /home/claude-bot/.cache/pre-commit/pre-commit.log
🔄 Reinstalling pd-prep-for-pgdp so hatch-vcs picks up the current HEAD / tags...
Resolved 123 packages in 1.54s
   Building pd-prep-for-pgdp @ file:///srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp
      Built pd-prep-for-pgdp @ file:///srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp
Prepared 1 package in 372ms
Uninstalled 2 packages in 3ms
Installed 2 packages in 9ms
 - pd-prep-for-pgdp==0.2.dev205+g0986dfbfc (from file:///srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp)
 + pd-prep-for-pgdp==0.2.dev206+g4e204ea4e (from file:///srv/bot-workspaces/ship-issue-1/pd-prep-for-pgdp)
 - python-doctr==1.0.2a0 (from git+https://github.com/mindee/doctr.git@a8694b80b4e8ed067ec8299efd0f1374f0b08936)
 + python-doctr==1.0.2a0 (from git+https://github.com/mindee/doctr.git@bc0db21e030926b4b7641fe71f7b8367e3ab042a)
Uninstalled 1 package in 4ms
Installed 1 package in 3ms
0.2.dev206+g4e204ea4e
✅ Setup complete!
📦 Installing frontend deps...
  (via /home/claude-bot/.local/bin/mise exec)

up to date, audited 473 packages in 1s

102 packages are looking for funding
  run `npm fund` for details

6 moderate severity vulnerabilities

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.
uv run pre-commit run --all-files
pre-commit-update........................................................Passed
trim trailing whitespace.................................................Passed
fix end of files.........................................................Passed
check yaml...............................................................Passed
check json...............................................................Passed
ruff check...............................................................Passed
ruff check...............................................................Passed
ruff format..............................................................Passed
markdownlint-cli2........................................................Passed
frontend tsc -b --noEmit.................................................Passed
frontend eslint..........................................................Passed
frontend prettier --check................................................Failed
- hook id: frontend-prettier
- exit code: 1

Checking formatting...
[warn] src/components/ui/Select.tsx
[warn] Code style issues found in the above file. Run Prettier with --write to fix.

make: *** [Makefile:250: pre-commit-check] Error 1
```
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-13T12:32:24Z

~~~~~~~~text
Claimed by ship-issue-0.

- Model: `sonnet` / effort: `high`
- Spec: `(inline — see acceptance below)`
- Pre-claim SHA: `7e448f095a132139e04dd73597ffbbab07f9d996`

Acceptance:
- [ ] `make ci` passes with no regressions introduced
~~~~~~~~

## #107 fix(ci): diagnose and fix broken CI on wip/ship-issue

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCS6oZQ`
- Author: ConcaveTrillion
- Created: 2026-05-14T20:23:42Z
- Closed: 2026-05-14T20:32:44Z
- Labels: bot:fix-wip, bot:ship-issue-ready, kind:bug, model-effort:high, model:sonnet, priority:high, status:in-pr
- Milestone: none

### Body

~~~~~~~~text
fix(ci): diagnose and fix broken CI on wip/ship-issue

`make ci` is failing on the `wip/ship-issue` integration branch after rebasing onto main. This is a `bot:fix-wip` diagnostic issue — the bot must identify the root cause and implement the minimal fix so `make ci` passes again, then exit.

The fix will land through the normal rolling PR path. All issues blocked by this one will automatically become eligible once this issue is closed.

Spec: (inline — see acceptance below)

Acceptance:
- [ ] `make ci` passes with no regressions introduced

**CI failure captured at 2026-05-14T20:23:41Z:**

```
📦 Installing dependencies...
uv sync --group dev
Resolved 178 packages in 1ms
   Building pd-prep-for-pgdp @ file:///srv/bot-workspaces/ship-issue-0/pd-prep-for-pgdp
      Built pd-prep-for-pgdp @ file:///srv/bot-workspaces/ship-issue-0/pd-prep-for-pgdp
Prepared 1 package in 777ms
Uninstalled 1 package in 0.63ms
Installed 1 package in 0.77ms
 - pd-prep-for-pgdp==0.2.dev206+g4e204ea4e (from file:///srv/bot-workspaces/ship-issue-0/pd-prep-for-pgdp)
 + pd-prep-for-pgdp==0.2.dev220+gb5ee3576c (from file:///srv/bot-workspaces/ship-issue-0/pd-prep-for-pgdp)
🪝 Setting up pre-commit hooks...
uv run pre-commit install || true
An unexpected error has occurred: PermissionError: [Errno 1] Operation not permitted: '/workspaces/ocr-container/pd-prep-for-pgdp/.git/hooks/pre-commit'
Check the log at /home/claude-bot/.cache/pre-commit/pre-commit.log
🔄 Reinstalling pd-prep-for-pgdp so hatch-vcs picks up the current HEAD / tags...
Resolved 123 packages in 1.22s
   Building pd-prep-for-pgdp @ file:///srv/bot-workspaces/ship-issue-0/pd-prep-for-pgdp
      Built pd-prep-for-pgdp @ file:///srv/bot-workspaces/ship-issue-0/pd-prep-for-pgdp
Prepared 1 package in 285ms
Uninstalled 2 packages in 4ms
Installed 2 packages in 13ms
 ~ pd-prep-for-pgdp==0.2.dev220+gb5ee3576c (from file:///srv/bot-workspaces/ship-issue-0/pd-prep-for-pgdp)
 - python-doctr==1.0.2a0 (from git+https://github.com/mindee/doctr.git@a8694b80b4e8ed067ec8299efd0f1374f0b08936)
 + python-doctr==1.0.2a0 (from git+https://github.com/mindee/doctr.git@bc0db21e030926b4b7641fe71f7b8367e3ab042a)
Uninstalled 1 package in 3ms
Installed 1 package in 7ms
0.2.dev220+gb5ee3576c
✅ Setup complete!
📦 Installing frontend deps...
  (via /home/claude-bot/.local/bin/mise exec)

up to date, audited 473 packages in 1s

102 packages are looking for funding
  run `npm fund` for details

6 moderate severity vulnerabilities

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.
uv run pre-commit run --all-files
[INFO] Initializing environment for https://github.com/astral-sh/ruff-pre-commit.
[INFO] Installing environment for https://github.com/astral-sh/ruff-pre-commit.
[INFO] Once installed this environment will be reused.
[INFO] This may take a few minutes...
pre-commit-update........................................................Passed
trim trailing whitespace.................................................Passed
fix end of files.........................................................Passed
check yaml...............................................................Passed
check json...............................................................Passed
ruff check...............................................................Passed
ruff check...............................................................Failed
- hook id: ruff-check
- files were modified by this hook

Found 1 error (1 fixed, 0 remaining).

ruff format..............................................................Passed
markdownlint-cli2........................................................Passed
frontend tsc -b --noEmit.................................................Passed
frontend eslint..........................................................Passed
frontend prettier --check................................................Passed
make: *** [Makefile:264: pre-commit-check] Error 1
```
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-14T20:24:02Z

~~~~~~~~text
Claimed by ship-issue-0.

- Model: `sonnet` / effort: `high`
- Spec: `(inline — see acceptance below)`
- Pre-claim SHA: `b5ee3576c1292b072232190676941dc4296d53af`

Acceptance:
- [ ] `make ci` passes with no regressions introduced
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-14T20:32:43Z

~~~~~~~~text
Fix shipped: ruff auto-fix committed and pushed to wip/ship-issue (b352cc4). PR #108 contains Closes #107.
~~~~~~~~

## #110 P0.1: Remove stale 'Re-process selected' button in BulkActions (calls deleted POST /api/gpu/jobs)

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCapERg`
- Author: ConcaveTrillion
- Created: 2026-05-15T21:41:16Z
- Closed: 2026-05-15T21:49:18Z
- Labels: status:ready
- Milestone: none

### Body

~~~~~~~~text
## Problem

`BulkActions` in `ProjectConfigurePage.tsx` has a `reprocess` mutation (line ~559) that calls `POST /api/gpu/jobs` with `job_type: "batch_process_pages"`. Both the `JobType.batch_*` enum values and `POST /api/gpu/jobs` were deleted in M6. Pressing 'Re-process selected' now silently fails with 405.

## Fix

Remove the `reprocess` mutation and the 'Re-process selected' button from `BulkActions`. Per-page re-runs are handled by the PageWorkbench stage controls; project-level re-runs go through `RunAllDirtyPanel`.

## Pass criterion

No call to `/api/gpu/jobs` in the frontend. The 'Re-process selected' button is gone.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-15T21:49:17Z

~~~~~~~~text
Shipped in commit b4a6a6c. Removed the stale `reprocess` mutation and 'Re-process selected' button from BulkActions. The deleted `POST /api/gpu/jobs` endpoint no longer exists in the frontend. All 20 frontend tests pass.
~~~~~~~~

## #111 P0.2: Add 'Download package' button after build_package completes

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCapGkQ`
- Author: ConcaveTrillion
- Created: 2026-05-15T21:41:23Z
- Closed: 2026-05-15T21:49:19Z
- Labels: status:ready
- Milestone: none

### Body

~~~~~~~~text
## Problem

After `build_package` completes, there is no UI affordance to download the resulting zip. The `GET /api/data/projects/{id}/assets/download-url` endpoint exists and serves `/cdn/projects/{id}/for_zip/{book_name}.zip` in local mode, but nothing calls it.

## Fix

In `RunPipelinePanel`, after `build_package` completes, show a 'Download package' link/button. The frontend already knows `project.config.book_name` and `projectId`; construct the package key client-side and call the download-url endpoint.

## Pass criterion

In `make run`, after `build_package` completes successfully, the user sees a clickable 'Download package' link that triggers a zip download.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-15T21:49:18Z

~~~~~~~~text
Shipped in commit b4a6a6c. JobProgressInline now fires onComplete; RunPipelinePanel tracks completed build_package jobs and fetches a presigned download URL, showing a 'Download package' link after success. All 20 frontend tests pass.
~~~~~~~~

## #112 chore(ts): clean up knip baseline (~15 findings) + flip blocking

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCgW33A`
- Author: ConcaveTrillion
- Created: 2026-05-17T10:03:33Z
- Closed: 2026-05-19T10:42:52Z
- Labels: none
- Milestone: none

### Body

~~~~~~~~text
TS-5 (commit `74896d9`) added knip as a non-blocking advisory CI target with ~15 findings as baseline. Per decision doc §Dead-code detection — knip, plan is to flip blocking once cleaned.

Categorise + clean: 1 unused component (Collapsible.tsx), 2 unused npm deps, 5 unused exports, 7 unused types. Remove the `|| true` from `make frontend-knip` when clean.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-19T10:42:51Z

~~~~~~~~text
Knip cleanup complete; frontend-knip is now blocking in CI.
~~~~~~~~

## #113 Spec: Strict-linting rollout — pd-prep-for-pgdp

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCgbYPQ`
- Author: ConcaveTrillion
- Created: 2026-05-17T10:35:58Z
- Closed: 2026-05-19T04:41:36Z
- Labels: kind:spec, status:backlog
- Milestone: none

### Body

~~~~~~~~text
Spec: docs/specs/2026-05-17-superpowers-gh-workflow-integration-design.md
Plan: docs/plans/2026-05-17-pd-prep-for-pgdp-strict-linting.md

Apply Python + TS/React strict linting (first dual-stack repo) to pd-prep-for-pgdp.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-19T04:41:36Z

~~~~~~~~text
All sub-tasks closed: #114, #115, #116, #117, #118, #119, #120, #121 are complete. The canonical strict-linting stack (basedpyright recommended, ruff full select, gitlint, pre-commit, .editorconfig, pytest hardening) is fully implemented.
~~~~~~~~

## #114 Add canonical `.editorconfig` (TRIVIAL)

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCgcDtg`
- Author: ConcaveTrillion
- Created: 2026-05-17T10:41:18Z
- Closed: 2026-05-19T04:41:15Z
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-prep-for-pgdp-strict-linting (#113)

### Body

~~~~~~~~text
Approach: (see plan)

Plan: docs/plans/2026-05-17-pd-prep-for-pgdp-strict-linting.md#add-canonical-editorconfig-trivial
Tracks: #113
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-19T04:41:15Z

~~~~~~~~text
Already implemented in the codebase — .editorconfig, .gitlint, .pre-commit-config.yaml, filterwarnings=error, --cov-branch, and ruff I/PL rules (no standalone isort/pylint) are all present.
~~~~~~~~

## #115 Migrate pyright → basedpyright (standard mode) (MODERATE)

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCgcDxA`
- Author: ConcaveTrillion
- Created: 2026-05-17T10:41:18Z
- Closed: 2026-05-19T04:41:29Z
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-prep-for-pgdp-strict-linting (#113)

### Body

~~~~~~~~text
Approach: (see plan)

Plan: docs/plans/2026-05-17-pd-prep-for-pgdp-strict-linting.md#migrate-pyright-basedpyright-standard-mode-moderat
Tracks: #113
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-19T04:41:29Z

~~~~~~~~text
Already implemented: basedpyright recommended mode (typeCheckingMode = "recommended") and the full canonical ruff select set (ANN, S, C4, PERF, TC, TID, PT, RET, PL, D, BLE, TRY, LOG, G) are all present in pyproject.toml.
~~~~~~~~

## #116 NOOP (no isort/pylint)

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCgcD4Q`
- Author: ConcaveTrillion
- Created: 2026-05-17T10:41:19Z
- Closed: 2026-05-19T04:41:19Z
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-prep-for-pgdp-strict-linting (#113)

### Body

~~~~~~~~text
Approach: (see plan)

Plan: docs/plans/2026-05-17-pd-prep-for-pgdp-strict-linting.md#noop-no-isortpylint
Tracks: #113
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-19T04:41:19Z

~~~~~~~~text
Already implemented in the codebase — .editorconfig, .gitlint, .pre-commit-config.yaml, filterwarnings=error, --cov-branch, and ruff I/PL rules (no standalone isort/pylint) are all present.
~~~~~~~~

## #117 Expand pre-commit (TRIVIAL+)

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCgcD9w`
- Author: ConcaveTrillion
- Created: 2026-05-17T10:41:20Z
- Closed: 2026-05-19T04:41:18Z
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-prep-for-pgdp-strict-linting (#113)

### Body

~~~~~~~~text
Approach: (see plan)

Plan: docs/plans/2026-05-17-pd-prep-for-pgdp-strict-linting.md#expand-pre-commit-trivial
Tracks: #113
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-19T04:41:17Z

~~~~~~~~text
Already implemented in the codebase — .editorconfig, .gitlint, .pre-commit-config.yaml, filterwarnings=error, --cov-branch, and ruff I/PL rules (no standalone isort/pylint) are all present.
~~~~~~~~

## #118 Add gitlint (TRIVIAL)

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCgcEGw`
- Author: ConcaveTrillion
- Created: 2026-05-17T10:41:20Z
- Closed: 2026-05-19T04:41:17Z
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-prep-for-pgdp-strict-linting (#113)

### Body

~~~~~~~~text
Approach: (see plan)

Plan: docs/plans/2026-05-17-pd-prep-for-pgdp-strict-linting.md#add-gitlint-trivial
Tracks: #113
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-19T04:41:16Z

~~~~~~~~text
Already implemented in the codebase — .editorconfig, .gitlint, .pre-commit-config.yaml, filterwarnings=error, --cov-branch, and ruff I/PL rules (no standalone isort/pylint) are all present.
~~~~~~~~

## #119 Expand ruff select to canonical (MODERATE-HEAVY)

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCgcENQ`
- Author: ConcaveTrillion
- Created: 2026-05-17T10:41:21Z
- Closed: 2026-05-19T04:41:30Z
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-prep-for-pgdp-strict-linting (#113)

### Body

~~~~~~~~text
Approach: (see plan)

Plan: docs/plans/2026-05-17-pd-prep-for-pgdp-strict-linting.md#expand-ruff-select-to-canonical-moderate-heavy
Tracks: #113
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-19T04:41:30Z

~~~~~~~~text
Already implemented: basedpyright recommended mode (typeCheckingMode = "recommended") and the full canonical ruff select set (ANN, S, C4, PERF, TC, TID, PT, RET, PL, D, BLE, TRY, LOG, G) are all present in pyproject.toml.
~~~~~~~~

## #120 Pytest hardening (MODERATE)

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCgcEVA`
- Author: ConcaveTrillion
- Created: 2026-05-17T10:41:22Z
- Closed: 2026-05-19T04:41:20Z
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-prep-for-pgdp-strict-linting (#113)

### Body

~~~~~~~~text
Approach: (see plan)

Plan: docs/plans/2026-05-17-pd-prep-for-pgdp-strict-linting.md#pytest-hardening-moderate
Tracks: #113
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-19T04:41:20Z

~~~~~~~~text
Already implemented in the codebase — .editorconfig, .gitlint, .pre-commit-config.yaml, filterwarnings=error, --cov-branch, and ruff I/PL rules (no standalone isort/pylint) are all present.
~~~~~~~~

## #121 basedpyright recommended + Makefile/CI wiring (MODERATE-HEAVY)

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABCgcEdg`
- Author: ConcaveTrillion
- Created: 2026-05-17T10:41:23Z
- Closed: 2026-05-19T04:41:32Z
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-prep-for-pgdp-strict-linting (#113)

### Body

~~~~~~~~text
Approach: (see plan)

Plan: docs/plans/2026-05-17-pd-prep-for-pgdp-strict-linting.md#basedpyright-recommended-makefileci-wiring-moderat
Tracks: #113
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-19T04:41:31Z

~~~~~~~~text
Already implemented: basedpyright recommended mode (typeCheckingMode = "recommended") and the full canonical ruff select set (ANN, S, C4, PERF, TC, TID, PT, RET, PL, D, BLE, TRY, LOG, G) are all present in pyproject.toml.
~~~~~~~~

## #122 chore: document all lint-rule suppressions (lint-deviations.md)

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABC_chLg`
- Author: ConcaveTrillion
- Created: 2026-05-21T15:14:45Z
- Closed: 2026-05-22T10:58:24Z
- Labels: kind:chore
- Milestone: none

### Body

~~~~~~~~text
## Summary

Apply the workspace `CONVENTIONS.md` rule **"Document every lint-rule
suppression"** to `pd-prep-for-pgdp`. `pd-book-tools` is the reference implementation.

Part of the cross-cut rollout tracked in ConcaveTrillion/ocr-container-meta#291.

## Tasks

- [ ] Grep for all standing suppressions: `# pyright: ignore`, `# type: ignore`,
      `# noqa`, and ruff `[tool.ruff.lint]` `ignore` / `per-file-ignores`, and TS `eslint-disable` / `@ts-expect-error` / `@ts-ignore`.
- [ ] Add a concise inline rationale at each suppression point (or remove the
      suppression and fix the underlying issue if it isn't warranted).
- [ ] Create `docs/conventions/lint-deviations.md` cataloguing every remaining
      deviation (rule, tool, file locations, justification). Tag any genuinely
      unclear case "needs review" rather than inventing a rationale.
- [ ] Prefer tool-native codes correctly
      (`# pyright: ignore[reportRuleName]`, not `# type: ignore[mypy-code]`).

## Reference

- Rule: workspace `CONVENTIONS.md` → "Document every lint-rule suppression"
- Reference implementation: `pd-book-tools/docs/conventions/lint-deviations.md`
- Cross-cut tracking issue: ConcaveTrillion/ocr-container-meta#291
~~~~~~~~

## #123 Unauthenticated SPA fallback can serve absolute host files

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABDItmcA`
- Author: ConcaveTrillion
- Created: 2026-05-22T20:28:38Z
- Closed: 2026-05-24T14:04:59Z
- Labels: effort:S, kind:bug, model-effort:high, model:sonnet, priority:high, status:ready
- Milestone: none

### Body

~~~~~~~~text
Source report: `docs/research/2026-05-22-deep-code-review-security-scan.md`

### 1. Unauthenticated SPA fallback can serve absolute host files

Severity: High
Category: security

Evidence: `src/pd_prep_for_pgdp/bootstrap.py:343-348`

The SPA fallback joins the static bundle path with `full_path` and serves `candidate` when `os.path.isfile(candidate)` is true. If `full_path` is an absolute path after URL decoding, `os.path.join()` ignores the static root. A request such as `/%2Fetc%2Fpasswd` can therefore serve host files.

Recommended fix: reject absolute paths and traversal segments before joining, resolve the candidate, require it to stay under the static root, and add regression tests for encoded absolute and traversal paths.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T12:27:23Z

~~~~~~~~text
Spec: docs/specs/2026-05-24-issue-123-spa-fallback-path-traversal.md (branch design/security-specs-2026-05-24, not yet merged)
~~~~~~~~

## #124 Filesystem CDN bypasses auth for project data reads and writes

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABDItmqQ`
- Author: ConcaveTrillion
- Created: 2026-05-22T20:28:39Z
- Closed: 2026-05-24T14:05:00Z
- Labels: effort:L, kind:bug, model-effort:high, model:sonnet, priority:high, status:ready
- Milestone: none

### Body

~~~~~~~~text
Source report: `docs/research/2026-05-22-deep-code-review-security-scan.md`

### 2. Filesystem CDN bypasses auth for project data reads and writes

Severity: High
Category: security

Evidence: `src/pd_prep_for_pgdp/bootstrap.py:295-305`, `src/pd_prep_for_pgdp/api/cdn.py:22-39`, `src/pd_prep_for_pgdp/adapters/storage/filesystem.py:74-80`

In filesystem mode, "presigned" URLs are plain `/cdn/<key>` paths. The PUT route has no auth dependency and the StaticFiles mount serves the whole data root. In `apikey` or `jwt` mode, anyone with a known key can fetch or overwrite source zips, artifacts, and package zips without authentication.

Recommended fix: replace raw data-root StaticFiles serving with authenticated or cryptographically signed CDN routes, include expiry and method in signatures, scope keys to project ownership, and enforce upload size/content-type limits.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T12:27:25Z

~~~~~~~~text
Spec: docs/specs/2026-05-24-issue-124-cdn-auth-bypass.md (branch design/security-specs-2026-05-24, not yet merged)
~~~~~~~~

## #125 API-key mode leaks the bearer secret through `/env.js`

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABDItm9Q`
- Author: ConcaveTrillion
- Created: 2026-05-22T20:28:40Z
- Closed: 2026-05-23T20:17:41Z
- Labels: effort:M, kind:bug, model-effort:high, model:sonnet, priority:high
- Milestone: none

### Body

~~~~~~~~text
Source report: `docs/research/2026-05-22-deep-code-review-security-scan.md`

### 3. API-key mode leaks the bearer secret through `/env.js`

Severity: High
Category: security

Evidence: `src/pd_prep_for_pgdp/api/env_js.py:26-30`, `src/pd_prep_for_pgdp/api/env_js.py:38-46`, `frontend/src/api/client.ts:14-23`, `frontend/src/api/client.ts:62-63`, `src/pd_prep_for_pgdp/bootstrap.py:245-250`

When `auth_mode="apikey"`, `/env.js` emits `API_TOKEN` to unauthenticated browser clients. Any visitor, and cross-origin pages via script inclusion, can recover the bearer token and call protected APIs; wildcard CORS compounds the exposure.

Recommended fix: do not expose server API keys to browser JavaScript. Treat API-key mode as server-to-server only, or replace browser auth with a session/OIDC flow using httpOnly SameSite cookies. Restrict CORS to configured trusted origins.
~~~~~~~~

## #126 Job retry payload override can redirect work across projects and data roots

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABDItnOw`
- Author: ConcaveTrillion
- Created: 2026-05-22T20:28:41Z
- Closed: 2026-05-24T14:04:59Z
- Labels: effort:M, kind:bug, model-effort:high, model:sonnet, priority:high, status:ready
- Milestone: none

### Body

~~~~~~~~text
Source report: `docs/research/2026-05-22-deep-code-review-security-scan.md`

### 4. Job retry payload override can redirect work across projects and data roots

Severity: High
Category: security

Evidence: `src/pd_prep_for_pgdp/api/gpu/jobs.py:93-107`, `src/pd_prep_for_pgdp/core/job_runner.py:432-459`

Retry shallow-merges arbitrary `payload_override` keys into the copied job payload. `_handle_run_page_stage()` trusts payload fields including `project_id`, `page_id`, `stage_id`, and `data_root`, and does not verify that the target project belongs to `job.owner_id`. A user who owns a failed/cancelled job can redirect a retry to another project or a different data root.

Recommended fix: whitelist retry-overridable keys per job type, reject identity/path fields, and have handlers re-check project ownership and configured data root. Add regression tests for forbidden `project_id` and `data_root` overrides.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T12:27:26Z

~~~~~~~~text
Spec: docs/specs/2026-05-24-issue-126-job-retry-payload-override.md (branch design/security-specs-2026-05-24, not yet merged)
~~~~~~~~

## #127 Ingest accepts arbitrary storage keys for an owned project

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABDItnbQ`
- Author: ConcaveTrillion
- Created: 2026-05-22T20:28:42Z
- Closed: 2026-05-24T14:04:57Z
- Labels: effort:S, kind:bug, model-effort:high, model:sonnet, priority:high, status:ready
- Milestone: none

### Body

~~~~~~~~text
Source report: `docs/research/2026-05-22-deep-code-review-security-scan.md`

### 5. Ingest accepts arbitrary storage keys for an owned project

Severity: High
Category: security

Evidence: `src/pd_prep_for_pgdp/api/gpu/ingest.py:28-49`, `src/pd_prep_for_pgdp/core/job_runner.py:323-337`, `src/pd_prep_for_pgdp/core/ingest.py:84-87`, `src/pd_prep_for_pgdp/core/ingest.py:356-371`

The ingest route verifies ownership of `project_id` but stores attacker-controlled `source_key` in the queued job. The runner later reads that key from storage. A user can point their ingest at another known storage prefix and copy/list data into their own project.

Recommended fix: bind ingest source keys to `project.storage_prefix`; for zip uploads require the server-issued source zip key, and reject folder keys outside the project prefix. Add cross-owner source-key tests.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T12:27:27Z

~~~~~~~~text
Spec: docs/specs/2026-05-24-issue-127-ingest-arbitrary-source-key.md (branch design/security-specs-2026-05-24, not yet merged)
~~~~~~~~

## #128 Packaging filename can escape the project prefix

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABDItnow`
- Author: ConcaveTrillion
- Created: 2026-05-22T20:28:43Z
- Closed: 2026-05-24T14:04:54Z
- Labels: effort:M, kind:bug, model-effort:high, model:sonnet, priority:high, status:ready
- Milestone: none

### Body

~~~~~~~~text
Source report: `docs/research/2026-05-22-deep-code-review-security-scan.md`

### 6. Packaging filename can escape the project prefix

Severity: High
Category: security

Evidence: `src/pd_prep_for_pgdp/core/models.py:67-69`, `src/pd_prep_for_pgdp/api/data/projects.py:201-211`, `src/pd_prep_for_pgdp/core/packaging.py:150-152`

`book_name` is user-controlled and is interpolated directly into `projects/{id}/for_zip/{book_name}.zip`. In filesystem mode, traversal-like names can resolve outside `for_zip/` and overwrite other project files.

Recommended fix: treat `book_name` as display text only. Generate package filenames from a sanitized slug that rejects separators, `..`, and control characters; validate the composed key stays under `project.storage_prefix + "for_zip/"`. Add traversal regression tests.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T12:27:27Z

~~~~~~~~text
Spec: docs/specs/2026-05-24-issue-128-packaging-filename-escape.md (branch design/security-specs-2026-05-24, not yet merged)
~~~~~~~~

## #129 ZIP and image processing paths have no resource bounds

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABDItn7w`
- Author: ConcaveTrillion
- Created: 2026-05-22T20:28:44Z
- Closed: 2026-05-24T14:04:58Z
- Labels: effort:L, kind:bug, model-effort:high, model:sonnet, priority:high, status:ready
- Milestone: none

### Body

~~~~~~~~text
Source report: `docs/research/2026-05-22-deep-code-review-security-scan.md`

### 7. ZIP and image processing paths have no resource bounds

Severity: High
Category: security

Evidence: `src/pd_prep_for_pgdp/api/cdn.py:34`, `src/pd_prep_for_pgdp/core/ingest.py:194-218`, `src/pd_prep_for_pgdp/core/ingest.py:356-371`, `src/pd_prep_for_pgdp/core/ingest.py:427-452`, `src/pd_prep_for_pgdp/core/ingest.py:502-527`

Upload, preview, unzip, and thumbnail code paths read entire request bodies, entire source zips, ZIP entries, and page source bytes into memory. Large uploads, zip bombs, or huge decoded images can exhaust RAM/CPU, and preview thumbnailing can repeatedly decompress a selected entry.

Recommended fix: enforce max upload size, source zip size, entry count, uncompressed bytes, compression ratio, and decoded image dimensions/pixels. Stream uploads to storage and process thumbnails with bounded queues. Add malicious archive and oversized image tests.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T12:27:29Z

~~~~~~~~text
Spec: docs/specs/2026-05-24-issue-129-resource-bounds.md (branch design/security-specs-2026-05-24, not yet merged)
~~~~~~~~

## #130 Unsaved text-review edits can be silently overwritten

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABDItoJw`
- Author: ConcaveTrillion
- Created: 2026-05-22T20:28:44Z
- Closed: 2026-05-24T14:04:56Z
- Labels: area:tests, effort:M, kind:bug, model-effort:high, model:sonnet, priority:high, status:ready
- Milestone: none

### Body

~~~~~~~~text
Source report: `docs/research/2026-05-22-deep-code-review-security-scan.md`

### 8. Unsaved text-review edits can be silently overwritten

Severity: High
Category: code-quality

Evidence: `frontend/src/pages/TextReviewPage.tsx:113-119`, `frontend/src/pages/TextReviewPage.tsx:496-506`, `frontend/src/pages/TextReviewPage.tsx:609-615`

Fetched OCR text is copied directly into the editable draft whenever query data changes, and navigation links do not guard dirty state. A refetch, split/page change, or Prev/Next navigation can reset `dirty` and discard unsaved edits without confirmation.

Recommended fix: keep fetched text separate from the local draft, only apply fetched data when `dirty === false` or after confirmation, and add route plus `beforeunload` blockers for dirty drafts. Add tests for refetch and navigation overwrite cases.
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T12:27:29Z

~~~~~~~~text
Spec: docs/specs/2026-05-24-issue-130-text-review-lost-edits.md (branch design/security-specs-2026-05-24, not yet merged)
~~~~~~~~

## #131 Postgres adapter does not satisfy the database contract

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDItoUw`
- Author: ConcaveTrillion
- Created: 2026-05-22T20:28:45Z
- Closed: n/a
- Labels: area:tests, effort:L, kind:bug, model-effort:high, model:sonnet, priority:medium
- Milestone: none

### Body

~~~~~~~~text
Source report: `docs/research/2026-05-22-deep-code-review-security-scan.md`

### 9. Postgres adapter does not satisfy the database contract

Severity: Medium
Category: code-quality

Evidence: `src/pd_prep_for_pgdp/adapters/database/base.py:93-126`, `src/pd_prep_for_pgdp/adapters/database/postgres.py:260-278`, `src/pd_prep_for_pgdp/bootstrap.py:63-74`

`build_database()` can select `PostgresDatabase`, but the adapter lacks required page-stage/split/enumeration methods and raises `NotImplementedError` for search. Stage routes and job handlers will fail at runtime in Postgres-backed deployments.

Recommended fix: complete the Postgres implementation to match `IDatabase`, or fail fast at startup until it is supported. Add a shared adapter contract test for Postgres.
~~~~~~~~

## #132 Progress updates can undo cancellation and continue side effects

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDItoiA`
- Author: ConcaveTrillion
- Created: 2026-05-22T20:28:46Z
- Closed: n/a
- Labels: area:tests, effort:M, kind:bug, model-effort:high, model:sonnet, priority:medium
- Milestone: none

### Body

~~~~~~~~text
Source report: `docs/research/2026-05-22-deep-code-review-security-scan.md`

### 10. Progress updates can undo cancellation and continue side effects

Severity: Medium
Category: code-quality

Evidence: `src/pd_prep_for_pgdp/api/gpu/jobs.py:48-59`, `src/pd_prep_for_pgdp/core/job_runner.py:263-305`, `src/pd_prep_for_pgdp/core/job_runner.py:347-357`

Cancellation writes `status=cancelled`, but a running handler can later call `_update_progress()` with a stale running job object and overwrite the cancelled status. Unzip can then enqueue follow-up thumbnail jobs after cancellation.

Recommended fix: make job updates conditional/CAS-style, re-read and preserve terminal status in `_update_progress()`, and add cooperative cancellation checks before expensive work and follow-up job creation.
~~~~~~~~

## #133 S3 missing-object handling likely returns 500 instead of 404

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABDItoxg`
- Author: ConcaveTrillion
- Created: 2026-05-22T20:28:47Z
- Closed: 2026-05-26T04:39:50Z
- Labels: area:tests, effort:S, kind:bug, model-effort:medium, model:sonnet, priority:medium
- Milestone: none

### Body

~~~~~~~~text
Source report: `docs/research/2026-05-22-deep-code-review-security-scan.md`

### 11. S3 missing-object handling likely returns 500 instead of 404

Severity: Medium
Category: code-quality

Evidence: `src/pd_prep_for_pgdp/adapters/storage/s3.py:51-60`

`S3Storage.exists()` catches only `self._client.exceptions.NoSuchKey`, while real `head_object` commonly raises `botocore.exceptions.ClientError` with 404/NoSuchKey/NotFound. Routes expecting `exists() == False` can surface an internal error for missing objects.

Recommended fix: catch `ClientError`, inspect error code/status for 404/NoSuchKey/NotFound, return `False`, and re-raise other errors. Add a fake `ClientError` test.
~~~~~~~~

## #134 ZIP entries with duplicate basenames overwrite each other

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABDItpAg`
- Author: ConcaveTrillion
- Created: 2026-05-22T20:28:48Z
- Closed: 2026-05-26T05:50:31Z
- Labels: area:tests, effort:M, kind:bug, model-effort:medium, model:sonnet, priority:medium
- Milestone: none

### Body

~~~~~~~~text
Source report: `docs/research/2026-05-22-deep-code-review-security-scan.md`

### 12. ZIP entries with duplicate basenames overwrite each other

Severity: Medium
Category: code-quality

Evidence: `src/pd_prep_for_pgdp/core/ingest.py:367-371`, `src/pd_prep_for_pgdp/core/ingest.py:461-466`

`_stem_from_zipname()` drops directory paths, and `_enumerate_zip()` writes to `source/{stem}{ext}`. A zip containing `a/page.png` and `b/page.png` silently overwrites the first file and can create multiple page records pointing at the same storage key.

Recommended fix: preserve sanitized relative path components, or detect duplicate output keys and assign deterministic suffixes. Add tests for duplicate basenames across ZIP directories.
~~~~~~~~

## #135 Authenticated SSE streams bypass the bearer-token client

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDItpSQ`
- Author: ConcaveTrillion
- Created: 2026-05-22T20:28:49Z
- Closed: n/a
- Labels: area:tests, effort:M, kind:bug, model-effort:medium, model:sonnet, priority:medium
- Milestone: none

### Body

~~~~~~~~text
Source report: `docs/research/2026-05-22-deep-code-review-security-scan.md`

### 13. Authenticated SSE streams bypass the bearer-token client

Severity: Medium
Category: code-quality

Evidence: `frontend/src/hooks/useJobProgress.ts:53-66`, `frontend/src/hooks/useStageEvents.ts:40-41`, `src/pd_prep_for_pgdp/api/gpu/jobs.py:119-163`

Native `EventSource` cannot send the `Authorization` header required by `Depends(get_user)`. In `jwt` or `apikey` mode, progress and stage event streams can 401/reconnect or fall back to stale one-shot GET behavior.

Recommended fix: use authenticated fetch streaming/SSE parsing, cookie auth for SSE, or short-lived signed event URLs. Add auth-mode tests for both SSE hooks.
~~~~~~~~

## #136 S3 ZIP uploads can fail because XHR does not pin Content-Type

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABDItpiA`
- Author: ConcaveTrillion
- Created: 2026-05-22T20:28:50Z
- Closed: 2026-05-26T04:32:39Z
- Labels: area:tests, effort:S, kind:bug, model-effort:medium, model:sonnet, priority:medium
- Milestone: none

### Body

~~~~~~~~text
Source report: `docs/research/2026-05-22-deep-code-review-security-scan.md`

### 14. S3 ZIP uploads can fail because XHR does not pin Content-Type

Severity: Medium
Category: code-quality

Evidence: `frontend/src/pages/ProjectListPage.tsx:437-456`, `src/pd_prep_for_pgdp/api/data/projects.py:149`, `src/pd_prep_for_pgdp/adapters/storage/s3.py:85-95`

S3 presigns uploads with `ContentType: application/zip`, but the frontend XHR sends the `File` without setting `Content-Type`. Browser-selected `.zip` files can have an empty or different type, causing signature mismatch.

Recommended fix: pass the expected content type through `uploadFile()` and set `xhr.setRequestHeader("Content-Type", "application/zip")`, or presign using the exact type the frontend sends.
~~~~~~~~

## #137 Locked Python dependency has active Starlette advisory

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABDItpxg`
- Author: ConcaveTrillion
- Created: 2026-05-22T20:28:50Z
- Closed: 2026-05-26T04:26:39Z
- Labels: area:deps, effort:S, kind:bug, model-effort:medium, model:sonnet, priority:medium
- Milestone: none

### Body

~~~~~~~~text
Source report: `docs/research/2026-05-22-deep-code-review-security-scan.md`

### 15. Locked Python dependency has active Starlette advisory

Severity: Medium
Category: security

Evidence: `uv.lock:2631`, `uv.lock:2637-2639`

The lock pins `starlette==1.0.0`. Subagent `pip-audit` on locked public dependencies reported `PYSEC-2026-161`, fixed in `1.0.1`.

Recommended fix: update the lock to `starlette>=1.0.1` and rerun backend tests.
~~~~~~~~

## #138 Frontend dev dependency graph includes vulnerable Vite/esbuild

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABDItqAg`
- Author: ConcaveTrillion
- Created: 2026-05-22T20:28:51Z
- Closed: 2026-05-26T04:18:47Z
- Labels: area:deps, effort:S, kind:bug, model-effort:medium, model:sonnet, priority:medium
- Milestone: none

### Body

~~~~~~~~text
Source report: `docs/research/2026-05-22-deep-code-review-security-scan.md`

### 16. Frontend dev dependency graph includes vulnerable Vite/esbuild

Severity: Medium
Category: security

Evidence: `frontend/pnpm-lock.yaml:3372`, `frontend/pnpm-lock.yaml:5794`, `frontend/pnpm-lock.yaml:9651`; `pnpm audit --audit-level low --json`

Full `pnpm audit` reports moderate advisories for `esbuild@0.21.5` (`GHSA-67mh-4wv8-2f99`) and `vite@5.4.21` (`GHSA-4w7w-66w2-5vf9`), pulled through Vitest dev tooling.

Recommended fix: upgrade `vitest`/`@vitest/ui` so their transitive Vite/esbuild versions are patched, then rerun `pnpm audit`.
~~~~~~~~

## #139 Release workflow ignores the committed pnpm lockfile

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABDItqQA`
- Author: ConcaveTrillion
- Created: 2026-05-22T20:28:52Z
- Closed: 2026-05-26T04:09:42Z
- Labels: area:ci, area:deps, effort:S, kind:bug, model-effort:medium, model:sonnet, priority:medium
- Milestone: none

### Body

~~~~~~~~text
Source report: `docs/research/2026-05-22-deep-code-review-security-scan.md`

### 17. Release workflow ignores the committed pnpm lockfile

Severity: Medium
Category: security

Evidence: `.github/workflows/release.yml:30-39`

The release SPA build runs `npm install` even though the repo uses `frontend/pnpm-lock.yaml` and CI/Docker use pnpm. Release builds can use a different dependency graph than reviewed and audited CI.

Recommended fix: use corepack with a pinned pnpm version and `pnpm install --frozen-lockfile` in release.
~~~~~~~~

## #140 Docker Python install is not lockfile reproducible

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABDItqew`
- Author: ConcaveTrillion
- Created: 2026-05-22T20:28:53Z
- Closed: 2026-05-26T05:30:16Z
- Labels: area:deps, effort:M, kind:bug, model-effort:medium, model:sonnet, priority:medium
- Milestone: none

### Body

~~~~~~~~text
Source report: `docs/research/2026-05-22-deep-code-review-security-scan.md`

### 18. Docker Python install is not lockfile reproducible

Severity: Medium
Category: security

Evidence: `Dockerfile:45-60`

The runtime image copies `pyproject.toml` but not `uv.lock`, then runs `uv pip install --system ".[s3,postgres,modal,jwt]"` without locked resolution. Production images can drift from CI/local tested dependencies.

Recommended fix: copy `uv.lock` and install with locked resolution, or use `uv sync --locked --no-dev --all-extras` with explicit handling for local/private sources.
~~~~~~~~

## #141 Floating tool/image/action refs increase supply-chain risk

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABDItqrg`
- Author: ConcaveTrillion
- Created: 2026-05-22T20:28:54Z
- Closed: 2026-05-26T05:58:13Z
- Labels: area:ci, area:deps, effort:M, kind:chore, model-effort:medium, model:sonnet, priority:medium
- Milestone: none

### Body

~~~~~~~~text
Source report: `docs/research/2026-05-22-deep-code-review-security-scan.md`

### 19. Floating tool/image/action refs increase supply-chain risk

Severity: Medium
Category: security

Evidence: `Dockerfile:7`, `Dockerfile:10`, `Dockerfile:34`, `.github/workflows/ci.yml:35-37`

The Dockerfile and CI use moving refs such as `node:24-slim`, `pnpm@latest`, `ghcr.io/astral-sh/uv:latest`, and `setup-uv` `version: latest`. Upstream movement can silently change CI or production builds.

Recommended fix: pin exact pnpm/uv versions, base image digests, and preferably action SHAs; add a controlled update workflow.
~~~~~~~~

## #142 Release workflow grants write token to all jobs

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABDItq8A`
- Author: ConcaveTrillion
- Created: 2026-05-22T20:28:55Z
- Closed: 2026-05-26T03:56:31Z
- Labels: area:ci, effort:S, kind:bug, model-effort:medium, model:sonnet, priority:medium
- Milestone: none

### Body

~~~~~~~~text
Source report: `docs/research/2026-05-22-deep-code-review-security-scan.md`

### 20. Release workflow grants write token to all jobs

Severity: Medium
Category: security

Evidence: `.github/workflows/release.yml:16-17`, `.github/workflows/release.yml:20-39`, `.github/workflows/release.yml:46-67`

The release workflow sets workflow-wide `contents: write`. Build jobs run dependency installs before publishing, so a compromised package script during tag builds receives a write-capable token.

Recommended fix: set top-level `contents: read`; grant `contents: write` only to the final release upload job or step.
~~~~~~~~

## #143 Runtime container runs as root

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABDItrKg`
- Author: ConcaveTrillion
- Created: 2026-05-22T20:28:56Z
- Closed: 2026-05-26T04:01:14Z
- Labels: effort:S, kind:chore, model-effort:medium, model:sonnet, priority:medium
- Milestone: none

### Body

~~~~~~~~text
Source report: `docs/research/2026-05-22-deep-code-review-security-scan.md`

### 21. Runtime container runs as root

Severity: Medium
Category: security

Evidence: `Dockerfile:17`, `Dockerfile:70-71`

The runtime image never sets `USER`, so uvicorn runs as root. An app RCE or image-processing exploit would have root privileges inside the container and on mounted volumes.

Recommended fix: create an unprivileged user, chown writable directories, and run the service with `USER <uid>`.
~~~~~~~~

## #144 Install scripts execute/download unsigned remote artifacts

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABDItrZw`
- Author: ConcaveTrillion
- Created: 2026-05-22T20:28:57Z
- Closed: 2026-05-26T06:03:29Z
- Labels: area:deps, effort:M, kind:chore, model-effort:medium, model:sonnet, priority:medium
- Milestone: none

### Body

~~~~~~~~text
Source report: `docs/research/2026-05-22-deep-code-review-security-scan.md`

### 22. Install scripts execute/download unsigned remote artifacts

Severity: Medium
Category: security

Evidence: `install.sh:17-20`, `install.sh:96-105`, `install.ps1:21-24`, `install.ps1:85-93`

The installers pipe remote Astral installer scripts to a shell and download/install the first wheel asset without checksum, signature, or attestation verification. A compromised endpoint or release asset leads directly to local code execution.

Recommended fix: publish checksums/attestations for wheels, verify before install, and avoid pipe-to-shell installers where possible.
~~~~~~~~

## #145 Production build always emits source maps

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABDItroA`
- Author: ConcaveTrillion
- Created: 2026-05-22T20:28:57Z
- Closed: 2026-05-23T19:34:50Z
- Labels: effort:S, kind:chore, model-effort:medium, model:sonnet, priority:low
- Milestone: none

### Body

~~~~~~~~text
Source report: `docs/research/2026-05-22-deep-code-review-security-scan.md`

### 23. Production build always emits source maps

Severity: Low
Category: security

Evidence: `frontend/vite.config.ts:21-24`

Production builds publish source maps by default. Public deployments expose original TypeScript/React source, route names, storage keys, and auth/client implementation details, increasing reconnaissance value after any other bug.

Recommended fix: make source maps conditional on a non-production build flag, or publish them only to a private error-reporting store.
~~~~~~~~

## #146 CI does not gate dependency vulnerability audits

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDItr4g`
- Author: ConcaveTrillion
- Created: 2026-05-22T20:28:58Z
- Closed: n/a
- Labels: area:ci, area:deps, effort:M, kind:chore, model-effort:medium, model:sonnet, priority:low
- Milestone: none

### Body

~~~~~~~~text
Source report: `docs/research/2026-05-22-deep-code-review-security-scan.md`

### 24. CI does not gate dependency vulnerability audits

Severity: Low
Category: code-quality

Evidence: `Makefile:296`; no Dependabot/Renovate config found.

The canonical `make ci` pipeline has tests, lint, typecheck, frontend build/test/lint/knip, but no Python/npm vulnerability audit or container scan. Vulnerable dependencies can remain green until manually audited.

Recommended fix: add scheduled and PR audit jobs for Python and pnpm, plus Dependabot/Renovate. Handle private/local packages explicitly.
~~~~~~~~

## #152 Spec: pd-ui design handoff — implementation in pd-prep-for-pgdp

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPhoGQ`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:43:16Z
- Closed: n/a
- Labels: kind:spec, status:backlog
- Milestone: none

### Body

~~~~~~~~text
**Spec:** docs/specs/2026-05-24-pd-ui-design-handoff-implementation.md
**Plan:** docs/plans/pd-ui-design-handoff-implementation.md

Implements every feature in the `pd-ui` design handoff bundle
(`pd-ui/docs/templates/design_handoff_pd_ui/`) inside pd-prep-for-pgdp,
consuming pd-ui's typed React+TS exports as they land in parallel.

Scope: 46 implementation tasks spanning the foundation (tokens / atoms /
shell), four wired stages (Source · Grayscale · Crop · Hyphen Join),
Stage 11 page-order (NEW), Validation, Quality flags, Page Workbench
cross-cutting primitives, Projects landing, and Upload modal.

Sibling pd-book-tools specs gate Stage 11, Stage 13 (scannos), and the
Stage 15 ngrams SQLite migration. See spec §Decisions (resolved 2026-05-24).
~~~~~~~~

## #153 Token + Tailwind reconciliation against pd-ui

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABDPhsAA`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:43:41Z
- Closed: 2026-05-26T02:37:23Z
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Replace `frontend/src/styles/tokens.css` with imports from

Plan: [pd-ui-design-handoff-implementation.md#s0-a](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#s0-a)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:16:06Z

~~~~~~~~text
## Audit 2026-05-24: READY to start

pd-ui Phase 1 (milestone #333) shipped all foundation components this slice needs. No external blockers.

See audit details in spec §'Implementation status (audit 2026-05-24)'.
~~~~~~~~

## #154 Adopt pd-ui atom primitives

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABDPhsRw`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:43:42Z
- Closed: 2026-05-26T02:54:38Z
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Replace ad-hoc `Button`, `Badge`, `KeyCap`, `Divider`,
Blocked by: #153

Plan: [pd-ui-design-handoff-implementation.md#s0-b](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#s0-b)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:16:06Z

~~~~~~~~text
## Audit 2026-05-24: READY to start

pd-ui Phase 1 (milestone #333) shipped all foundation components this slice needs. No external blockers.

See audit details in spec §'Implementation status (audit 2026-05-24)'.
~~~~~~~~

## #155 App shell (header + breadcrumb + jobs drawer)

- State: CLOSED (COMPLETED)
- Node ID: `I_kwDOSUyCB88AAAABDPhsfA`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:43:44Z
- Closed: 2026-05-26T10:40:32Z
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Wire `AppTemplate` + `AppHeader` + `Breadcrumb` + `JobsPill`
Blocked by: #154

Plan: [pd-ui-design-handoff-implementation.md#s0-c](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#s0-c)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:16:07Z

~~~~~~~~text
## Audit 2026-05-24: READY to start

pd-ui Phase 1 (milestone #333) shipped all foundation components this slice needs. No external blockers.

See audit details in spec §'Implementation status (audit 2026-05-24)'.
~~~~~~~~

## #156 Files tab — ThumbCard grid + FileToolbar + SourceBanner

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPhstg`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:43:46Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Create a new `/projects/:id/source` route rendering `SourceBanner`
Blocked by: #155

Plan: [pd-ui-design-handoff-implementation.md#s01-a](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#s01-a)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:16:33Z

~~~~~~~~text
## Audit 2026-05-24: BLOCKED on pd-ui Phase 2

This slice consumes per-stage pd-ui components not shipped in Phase 1 (milestone #333). Required exports: SourceBanner, FileToolbar, ThumbCard, BulkBar, SourcePageWorkbench. Tracked in pd-ui Phase 2 spec (TBD — see pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md once filed).

Workaround: co-locate components in frontend/src/pages/<Stage>/ using pd-ui primitives + canvas slots while waiting; refactor into pd-ui exports later.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-25T01:49:29Z

~~~~~~~~text
pd-ui Phase 2 M3 Source complete (2026-05-25). All 7 Source-stage exports available at `@concavetrillion/pd-ui/stages/Source`:

- `SourceBanner` (3-state banner: idle / generating / selection)
- `FileToolbar` (filter chips + density Segmented + Insert CTA)
- `ThumbCard` (per-page card with role select)
- `BulkBar` (sticky bulk-action bar)
- `InsertDialog` (insert-page modal)
- `SourcePageWorkbench` (per-page detail composing ArtifactViewer)
- `SourceStepSettings` (generation settings panel)

**Status: READY to start.** The pd-ui M3 blocker for the S01 slice is resolved.
~~~~~~~~

## #157 Multi-select + BulkBar

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPhs9g`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:43:47Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Add shift+click range select, `esc` clears, and wire `BulkBar`
Blocked by: #156

Plan: [pd-ui-design-handoff-implementation.md#s01-b](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#s01-b)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:16:34Z

~~~~~~~~text
## Audit 2026-05-24: BLOCKED on pd-ui Phase 2

This slice consumes per-stage pd-ui components not shipped in Phase 1 (milestone #333). Required exports: BulkBar, SourcePageWorkbench. Tracked in pd-ui Phase 2 spec (TBD — see pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md once filed).

Workaround: co-locate components in frontend/src/pages/<Stage>/ using pd-ui primitives + canvas slots while waiting; refactor into pd-ui exports later.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-25T01:49:30Z

~~~~~~~~text
pd-ui Phase 2 M3 Source complete (2026-05-25) — all 7 Source-stage exports (SourceBanner, FileToolbar, ThumbCard, BulkBar, InsertDialog, SourcePageWorkbench, SourceStepSettings) available at `@concavetrillion/pd-ui/stages/Source`. This slice's pd-ui blocker is resolved.
~~~~~~~~

## #158 Insert dialog + role taxonomy backend

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPhtOA`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:43:49Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Build `InsertDialog` modal + new backend route
Blocked by: #156

Plan: [pd-ui-design-handoff-implementation.md#s01-c](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#s01-c)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:16:35Z

~~~~~~~~text
## Audit 2026-05-24: BLOCKED on pd-ui Phase 2

This slice consumes per-stage pd-ui components not shipped in Phase 1 (milestone #333). Required exports: InsertDialog (role taxonomy). Tracked in pd-ui Phase 2 spec (TBD — see pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md once filed).

Workaround: co-locate components in frontend/src/pages/<Stage>/ using pd-ui primitives + canvas slots while waiting; refactor into pd-ui exports later.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-25T01:49:31Z

~~~~~~~~text
pd-ui Phase 2 M3 Source complete (2026-05-25) — all 7 Source-stage exports (SourceBanner, FileToolbar, ThumbCard, BulkBar, InsertDialog, SourcePageWorkbench, SourceStepSettings) available at `@concavetrillion/pd-ui/stages/Source`. This slice's pd-ui blocker is resolved.
~~~~~~~~

## #159 Per-page workbench + step settings

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPhtdg`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:43:50Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Render `SourcePageWorkbench` under `/projects/:id/source/:prefix` and
Blocked by: #156

Plan: [pd-ui-design-handoff-implementation.md#s01-d](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#s01-d)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:16:36Z

~~~~~~~~text
## Audit 2026-05-24: BLOCKED on pd-ui Phase 2

This slice consumes per-stage pd-ui components not shipped in Phase 1 (milestone #333). Required exports: SourceStepSettings, SourcePageWorkbench. Tracked in pd-ui Phase 2 spec (TBD — see pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md once filed).

Workaround: co-locate components in frontend/src/pages/<Stage>/ using pd-ui primitives + canvas slots while waiting; refactor into pd-ui exports later.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-24T20:05:34Z

~~~~~~~~text
pd-ui Phase 2 M1 (`ArtifactViewer` + overlays) shipped at `9f81be7` (2026-05-24) on the new subpath `@concavetrillion/pd-ui/stages/PageWorkbench`. This slice's `ArtifactViewer` dependency is now resolved; remaining per-stage pd-ui exports for this slice will land in later Phase 2 milestones (see [Phase 2 spec §7](https://github.com/ConcaveTrillion/pd-ui/blob/main/docs/specs/2026-05-24-design-handoff-stages-phase-2.md#7-implementation-plan)).
~~~~~~~~

### Comment 3 by ConcaveTrillion at 2026-05-25T01:49:31Z

~~~~~~~~text
pd-ui Phase 2 M3 Source complete (2026-05-25) — all 7 Source-stage exports (SourceBanner, FileToolbar, ThumbCard, BulkBar, InsertDialog, SourcePageWorkbench, SourceStepSettings) available at `@concavetrillion/pd-ui/stages/Source`. This slice's pd-ui blocker is resolved.
~~~~~~~~

## #160 Overview + Pages tabs

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPhttw`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:43:52Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Create `/projects/:id/grayscale` route with Overview (stat tiles +
Blocked by: #155

Plan: [pd-ui-design-handoff-implementation.md#s02-a](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#s02-a)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:16:37Z

~~~~~~~~text
## Audit 2026-05-24: BLOCKED on pd-ui Phase 2

This slice consumes per-stage pd-ui components not shipped in Phase 1 (milestone #333). Required exports: BackendChip, AutoDetectBanner, ModeCard, AdvancedParams, GrayscaleOverview, GrayThumb, PageViewer, StageControlsLeft. Tracked in pd-ui Phase 2 spec (TBD — see pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md once filed).

Workaround: co-locate components in frontend/src/pages/<Stage>/ using pd-ui primitives + canvas slots while waiting; refactor into pd-ui exports later.
~~~~~~~~

## #161 Step Settings + WF11 variant F

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPhuCQ`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:43:54Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Build Step Settings tab using `StageControlsLeft` (Variant F:
Blocked by: #160

Plan: [pd-ui-design-handoff-implementation.md#s02-b](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#s02-b)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:16:38Z

~~~~~~~~text
## Audit 2026-05-24: BLOCKED on pd-ui Phase 2

This slice consumes per-stage pd-ui components not shipped in Phase 1 (milestone #333). Required exports: PageViewer, StageControlsLeft. Tracked in pd-ui Phase 2 spec (TBD — see pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md once filed).

Workaround: co-locate components in frontend/src/pages/<Stage>/ using pd-ui primitives + canvas slots while waiting; refactor into pd-ui exports later.
~~~~~~~~

## #162 Per-page PageViewer + split before/after

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPhumg`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:43:56Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Build split-pane viewer under `/projects/:id/grayscale/:prefix`
Blocked by: #161

Plan: [pd-ui-design-handoff-implementation.md#s02-c](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#s02-c)
Verification: `cd frontend && pnpm test:e2e grayscale.spec.ts`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:16:38Z

~~~~~~~~text
## Audit 2026-05-24: BLOCKED on pd-ui Phase 2

This slice consumes per-stage pd-ui components not shipped in Phase 1 (milestone #333). Required exports: GrayscaleOverview, GrayThumb, StageControlsLeft. Tracked in pd-ui Phase 2 spec (TBD — see pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md once filed).

Workaround: co-locate components in frontend/src/pages/<Stage>/ using pd-ui primitives + canvas slots while waiting; refactor into pd-ui exports later.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-24T20:05:32Z

~~~~~~~~text
pd-ui Phase 2 M1 (`ArtifactViewer` + overlays) shipped at `9f81be7` (2026-05-24) on the new subpath `@concavetrillion/pd-ui/stages/PageWorkbench`. This slice's `ArtifactViewer` dependency is now resolved; remaining per-stage pd-ui exports for this slice will land in later Phase 2 milestones (see [Phase 2 spec §7](https://github.com/ConcaveTrillion/pd-ui/blob/main/docs/specs/2026-05-24-design-handoff-stages-phase-2.md#7-implementation-plan)).
~~~~~~~~

### Comment 3 by ConcaveTrillion at 2026-05-25T02:43:53Z

~~~~~~~~text
pd-ui Phase 2 M4 Grayscale complete (2026-05-25). All 7 Grayscale exports available at `@concavetrillion/pd-ui/stages/Grayscale`:

- `AutoDetectBanner` (detected-mode rationale)
- `ModeCard` (Standard/Perceptual chooser)
- `AdvancedParams` (sampler/gamma/output range accordion)
- `GrayscaleOverview` (stat tiles + summary cards)
- `GrayThumb` (per-page thumbnail w/ time overlay)
- `PageViewer` (Before/Split/After viewer composing ArtifactViewer)
- `StageControlsLeft` (composes M2 StageControlsPanel + ModeCard + AdvancedParams)

**Status: READY to start.** The pd-ui M4 blocker for the S02 slice is resolved.
~~~~~~~~

## #163 CropsGridPage refit to CropCard + CropToolbar

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPhvDA`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:43:57Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Migrate existing `CropsGridPage` to pd-ui's `CropCard`,
Blocked by: #155

Plan: [pd-ui-design-handoff-implementation.md#s03-a](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#s03-a)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:16:39Z

~~~~~~~~text
## Audit 2026-05-24: BLOCKED on pd-ui Phase 2

This slice consumes per-stage pd-ui components not shipped in Phase 1 (milestone #333). Required exports: CropBanner, CropToolbar, CropCard, CropBulkBar, CropOverview, CropStepSettings. Tracked in pd-ui Phase 2 spec (TBD — see pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md once filed).

Workaround: co-locate components in frontend/src/pages/<Stage>/ using pd-ui primitives + canvas slots while waiting; refactor into pd-ui exports later.
~~~~~~~~

## #164 BulkBar + bulk re-run backend

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPhvPg`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:43:59Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Wire `CropBulkBar` to new
Blocked by: #163

Plan: [pd-ui-design-handoff-implementation.md#s03-b](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#s03-b)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:16:40Z

~~~~~~~~text
## Audit 2026-05-24: BLOCKED on pd-ui Phase 2

This slice consumes per-stage pd-ui components not shipped in Phase 1 (milestone #333). Required exports: BboxEditor. Tracked in pd-ui Phase 2 spec (TBD — see pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md once filed).

Workaround: co-locate components in frontend/src/pages/<Stage>/ using pd-ui primitives + canvas slots while waiting; refactor into pd-ui exports later.
~~~~~~~~

## #165 BboxEditor inline

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPhvbw`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:01Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Add inline crop bbox adjustment with current/proposed overlays
Blocked by: #163

Plan: [pd-ui-design-handoff-implementation.md#s03-c](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#s03-c)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:16:40Z

~~~~~~~~text
## Audit 2026-05-24: BLOCKED on pd-ui Phase 2

This slice consumes per-stage pd-ui components not shipped in Phase 1 (milestone #333). Required exports: CropBulkBar. Tracked in pd-ui Phase 2 spec (TBD — see pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md once filed).

Workaround: co-locate components in frontend/src/pages/<Stage>/ using pd-ui primitives + canvas slots while waiting; refactor into pd-ui exports later.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-24T20:05:32Z

~~~~~~~~text
pd-ui Phase 2 M1 (`ArtifactViewer` + overlays) shipped at `9f81be7` (2026-05-24) on the new subpath `@concavetrillion/pd-ui/stages/PageWorkbench`. This slice's `ArtifactViewer` dependency is now resolved; remaining per-stage pd-ui exports for this slice will land in later Phase 2 milestones (see [Phase 2 spec §7](https://github.com/ConcaveTrillion/pd-ui/blob/main/docs/specs/2026-05-24-design-handoff-stages-phase-2.md#7-implementation-plan)).
~~~~~~~~

## #166 CropOverview + CropStepSettings

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPhvqQ`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:02Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Build Overview tab (stat tiles + flag distribution + activity) +
Blocked by: #163

Plan: [pd-ui-design-handoff-implementation.md#s03-d](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#s03-d)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:16:41Z

~~~~~~~~text
## Audit 2026-05-24: BLOCKED on pd-ui Phase 2

This slice consumes per-stage pd-ui components not shipped in Phase 1 (milestone #333). Required exports: CropOverview, CropStepSettings. Tracked in pd-ui Phase 2 spec (TBD — see pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md once filed).

Workaround: co-locate components in frontend/src/pages/<Stage>/ using pd-ui primitives + canvas slots while waiting; refactor into pd-ui exports later.
~~~~~~~~

## #167 Pages tab manual drag-reorder

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPhv4g`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:04Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Add drag-and-drop reorder inside the Source/Pages tab with UndoStrip
Blocked by: #156

Plan: [pd-ui-design-handoff-implementation.md#s11-a](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#s11-a)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:16:42Z

~~~~~~~~text
## Audit 2026-05-24: BLOCKED on pd-ui Phase 2

This slice consumes per-stage pd-ui components not shipped in Phase 1 (milestone #333). Required exports: PagesToolbar, DropIndicator, DragGhost, UndoStrip, RowActionsMenu. Tracked in pd-ui Phase 2 spec (TBD — see pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md once filed).

Workaround: co-locate components in frontend/src/pages/<Stage>/ using pd-ui primitives + canvas slots while waiting; refactor into pd-ui exports later.
~~~~~~~~

## #168 Stage 11 page — ReorderScansStage

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPhwJQ`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:05Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Build `/projects/:id/page-order` route with auto-detect
Blocked by: #167

Plan: [pd-ui-design-handoff-implementation.md#s11-b](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#s11-b)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:16:43Z

~~~~~~~~text
## Audit 2026-05-24: BLOCKED on pd-ui Phase 2

This slice consumes per-stage pd-ui components not shipped in Phase 1 (milestone #333). Required exports: PagesToolbar, DropIndicator, DragGhost, UndoStrip, RowActionsMenu. Tracked in pd-ui Phase 2 spec (TBD — see pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md once filed).

Workaround: co-locate components in frontend/src/pages/<Stage>/ using pd-ui primitives + canvas slots while waiting; refactor into pd-ui exports later.

ALSO blocked on pd-book-tools spec #208 (page-order spec).
~~~~~~~~

## #169 Scannos pipeline stage (P)

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPhwWA`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:07Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Build page-level scanno stats + "Re-scan all pages" + per-page
Blocked by: #155

Plan: [pd-ui-design-handoff-implementation.md#s13-a](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#s13-a)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:16:43Z

~~~~~~~~text
## Audit 2026-05-24: BLOCKED on pd-ui Phase 2

This slice consumes per-stage pd-ui components not shipped in Phase 1 (milestone #333). Required exports: ScannoToken, InlineMarkPopover, CandidateDetail, RuleDetail, ToggleBadge, NavGroup. Tracked in pd-ui Phase 2 spec (TBD — see pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md once filed).

Workaround: co-locate components in frontend/src/pages/<Stage>/ using pd-ui primitives + canvas slots while waiting; refactor into pd-ui exports later.

ALSO blocked on pd-book-tools spec #209 (scannos spec).
~~~~~~~~

## #170 Capture C1 — inline suspicion popover in PageWorkbench

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPhwjQ`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:09Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Add underlined suspicion tokens + inline accept/dismiss/promote
Blocked by: #169

Plan: [pd-ui-design-handoff-implementation.md#s13-b](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#s13-b)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:16:44Z

~~~~~~~~text
## Audit 2026-05-24: BLOCKED on pd-ui Phase 2

This slice consumes per-stage pd-ui components not shipped in Phase 1 (milestone #333). Required exports: ScannoToken, InlineMarkPopover, CandidateDetail, RuleDetail, ToggleBadge, NavGroup. Tracked in pd-ui Phase 2 spec (TBD — see pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md once filed).

Workaround: co-locate components in frontend/src/pages/<Stage>/ using pd-ui primitives + canvas slots while waiting; refactor into pd-ui exports later.

ALSO blocked on pd-book-tools spec #209 (scannos spec).
~~~~~~~~

## #171 Promote C2 — per-book candidate triage

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPhwzA`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:10Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Build per-book candidate triage using `pdUi/Scannos/CandidateDetail`
Blocked by: #169

Plan: [pd-ui-design-handoff-implementation.md#s13-c](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#s13-c)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:16:44Z

~~~~~~~~text
## Audit 2026-05-24: BLOCKED on pd-ui Phase 2

This slice consumes per-stage pd-ui components not shipped in Phase 1 (milestone #333). Required exports: ScannoToken, InlineMarkPopover, CandidateDetail, RuleDetail, ToggleBadge, NavGroup. Tracked in pd-ui Phase 2 spec (TBD — see pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md once filed).

Workaround: co-locate components in frontend/src/pages/<Stage>/ using pd-ui primitives + canvas slots while waiting; refactor into pd-ui exports later.

ALSO blocked on pd-book-tools spec #209 (scannos spec).
~~~~~~~~

## #172 Configure C3 — global rule library

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPhxjw`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:12Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Build global rule library using `pdUi/Scannos/RuleDetail`,
Blocked by: #169

Plan: [pd-ui-design-handoff-implementation.md#s13-d](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#s13-d)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:16:45Z

~~~~~~~~text
## Audit 2026-05-24: BLOCKED on pd-ui Phase 2

This slice consumes per-stage pd-ui components not shipped in Phase 1 (milestone #333). Required exports: ScannoToken, InlineMarkPopover, CandidateDetail, RuleDetail, ToggleBadge, NavGroup. Tracked in pd-ui Phase 2 spec (TBD — see pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md once filed).

Workaround: co-locate components in frontend/src/pages/<Stage>/ using pd-ui primitives + canvas slots while waiting; refactor into pd-ui exports later.

ALSO blocked on pd-book-tools spec #209 (scannos spec).
~~~~~~~~

## #173 Overview tab

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPhx2g`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:14Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Build the overview tab using `pdUi/HyphenJoin/HyphenOverview`
Blocked by: #155

Plan: [pd-ui-design-handoff-implementation.md#s15-a](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#s15-a)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:17:02Z

~~~~~~~~text
## Audit 2026-05-24: BLOCKED on pd-ui Phase 2

This slice consumes per-stage pd-ui components not shipped in Phase 1 (milestone #333). Required exports: HyphenOverview, HyphenUndecided, HyphenAutoJoined, HyphenMismatch, HyphenStepSettings, HyphenPageWorkbench, HJStatusPill, HJDecisionCard. Tracked in pd-ui Phase 2 spec (TBD — see pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md once filed).

Workaround: co-locate components in frontend/src/pages/<Stage>/ using pd-ui primitives + canvas slots while waiting; refactor into pd-ui exports later.
~~~~~~~~

## #174 Undecided + Queue (V1+V2+V3)

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPhyDg`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:15Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Build undecided and queue views using `pdUi/HyphenJoin/QueueSidebar`,
Blocked by: #173

Plan: [pd-ui-design-handoff-implementation.md#s15-b](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#s15-b)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:17:03Z

~~~~~~~~text
## Audit 2026-05-24: BLOCKED on pd-ui Phase 2

This slice consumes per-stage pd-ui components not shipped in Phase 1 (milestone #333). Required exports: HJStatusPill, HJDecisionCard, HyphenUndecided. Tracked in pd-ui Phase 2 spec (TBD — see pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md once filed).

Workaround: co-locate components in frontend/src/pages/<Stage>/ using pd-ui primitives + canvas slots while waiting; refactor into pd-ui exports later.
~~~~~~~~

## #175 Auto-joined validation (V5)

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPhyYA`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:18Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Build auto-joined validation view using `pdUi/HyphenJoin/AutoJoinedList`,
Blocked by: #173

Plan: [pd-ui-design-handoff-implementation.md#s15-c](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#s15-c)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:17:03Z

~~~~~~~~text
## Audit 2026-05-24: BLOCKED on pd-ui Phase 2

This slice consumes per-stage pd-ui components not shipped in Phase 1 (milestone #333). Required exports: HyphenAutoJoined. Tracked in pd-ui Phase 2 spec (TBD — see pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md once filed).

Workaround: co-locate components in frontend/src/pages/<Stage>/ using pd-ui primitives + canvas slots while waiting; refactor into pd-ui exports later.
~~~~~~~~

## #176 Mismatch report (V4)

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPhylQ`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:19Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Build mismatch report using `pdUi/HyphenJoin/MismatchedReportV4`
Blocked by: #173

Plan: [pd-ui-design-handoff-implementation.md#s15-d](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#s15-d)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:17:04Z

~~~~~~~~text
## Audit 2026-05-24: BLOCKED on pd-ui Phase 2

This slice consumes per-stage pd-ui components not shipped in Phase 1 (milestone #333). Required exports: HyphenMismatch. Tracked in pd-ui Phase 2 spec (TBD — see pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md once filed).

Workaround: co-locate components in frontend/src/pages/<Stage>/ using pd-ui primitives + canvas slots while waiting; refactor into pd-ui exports later.
~~~~~~~~

## #177 Step Settings (rule library + n-gram cache + thresholds)

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPhyxg`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:21Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Build Step Settings using `pdUi/HyphenJoin/HyphenStepSettings`.
Blocked by: #173

Plan: [pd-ui-design-handoff-implementation.md#s15-e](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#s15-e)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:17:05Z

~~~~~~~~text
## Audit 2026-05-24: BLOCKED on pd-ui Phase 2

This slice consumes per-stage pd-ui components not shipped in Phase 1 (milestone #333). Required exports: HyphenStepSettings. Tracked in pd-ui Phase 2 spec (TBD — see pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md once filed).

Workaround: co-locate components in frontend/src/pages/<Stage>/ using pd-ui primitives + canvas slots while waiting; refactor into pd-ui exports later.
~~~~~~~~

## #178 Page workbench (HJDecisionCard + Before/After split)

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPhy_A`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:22Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Build per-page workbench using `pdUi/HyphenJoin/HyphenPageWorkbench`,
Blocked by: #173

Plan: [pd-ui-design-handoff-implementation.md#s15-f](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#s15-f)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:17:05Z

~~~~~~~~text
## Audit 2026-05-24: BLOCKED on pd-ui Phase 2

This slice consumes per-stage pd-ui components not shipped in Phase 1 (milestone #333). Required exports: HyphenPageWorkbench, HJDecisionCard. Tracked in pd-ui Phase 2 spec (TBD — see pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md once filed).

Workaround: co-locate components in frontend/src/pages/<Stage>/ using pd-ui primitives + canvas slots while waiting; refactor into pd-ui exports later.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-24T20:05:33Z

~~~~~~~~text
pd-ui Phase 2 M1 (`ArtifactViewer` + overlays) shipped at `9f81be7` (2026-05-24) on the new subpath `@concavetrillion/pd-ui/stages/PageWorkbench`. This slice's `ArtifactViewer` dependency is now resolved; remaining per-stage pd-ui exports for this slice will land in later Phase 2 milestones (see [Phase 2 spec §7](https://github.com/ConcaveTrillion/pd-ui/blob/main/docs/specs/2026-05-24-design-handoff-stages-phase-2.md#7-implementation-plan)).
~~~~~~~~

## #179 ValidationPanel in Pipeline tab

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPhzPA`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:24Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Render `SummaryHeader` + `PanelToolbar` + `CheckRow` rows
Blocked by: #155

Plan: [pd-ui-design-handoff-implementation.md#s19-a](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#s19-a)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:17:06Z

~~~~~~~~text
## Audit 2026-05-24: BLOCKED on pd-ui Phase 2

This slice consumes per-stage pd-ui components not shipped in Phase 1 (milestone #333). Required exports: SummaryHeader, PanelToolbar, CheckRow, CheckIcon, PageChip, DownloadFooter. Tracked in pd-ui Phase 2 spec (TBD — see pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md once filed).

Workaround: co-locate components in frontend/src/pages/<Stage>/ using pd-ui primitives + canvas slots while waiting; refactor into pd-ui exports later.
~~~~~~~~

## #180 Per-check auto-fix endpoints (safe-rename whitelist)

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPhzfQ`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:26Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Ship `POST /api/projects/{id}/validate/{check}/fix` for the
Blocked by: #179

Plan: [pd-ui-design-handoff-implementation.md#s19-b](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#s19-b)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:17:07Z

~~~~~~~~text
## Audit 2026-05-24: BLOCKED on pd-ui Phase 2

This slice consumes per-stage pd-ui components not shipped in Phase 1 (milestone #333). Required exports: SummaryHeader, PanelToolbar, CheckRow, CheckIcon, PageChip, DownloadFooter. Tracked in pd-ui Phase 2 spec (TBD — see pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md once filed).

Workaround: co-locate components in frontend/src/pages/<Stage>/ using pd-ui primitives + canvas slots while waiting; refactor into pd-ui exports later.
~~~~~~~~

## #181 QualityBanner + flag taxonomy

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPh0Sw`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:27Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Render `QualityBanner` at top of `ProjectConfigurePage` Pages tab
Blocked by: #155

Plan: [pd-ui-design-handoff-implementation.md#sqf-a](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#sqf-a)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:16:12Z

~~~~~~~~text
## Audit 2026-05-24: READY to start

pd-ui Phase 1 (milestone #333) shipped all foundation components this slice needs. No external blockers.

See audit details in spec §'Implementation status (audit 2026-05-24)'.
~~~~~~~~

## #182 PageThumb + PageRow with flag pills

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPh0fw`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:29Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Replace existing Pages tab thumbnails with `PageThumb` / `PageRow`
Blocked by: #181

Plan: [pd-ui-design-handoff-implementation.md#sqf-b](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#sqf-b)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:16:12Z

~~~~~~~~text
## Audit 2026-05-24: READY to start

pd-ui Phase 1 (milestone #333) shipped all foundation components this slice needs. No external blockers.

See audit details in spec §'Implementation status (audit 2026-05-24)'.
~~~~~~~~

## #183 StageJumpPopover (⌘P)

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPh0rg`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:30Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Wire searchable stage-jump dropdown using `pdUi/molecules/StageJumpPopover`
Blocked by: #155

Plan: [pd-ui-design-handoff-implementation.md#sqf-c](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#sqf-c)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:16:13Z

~~~~~~~~text
## Audit 2026-05-24: READY to start

pd-ui Phase 1 (milestone #333) shipped all foundation components this slice needs. No external blockers.

See audit details in spec §'Implementation status (audit 2026-05-24)'.
~~~~~~~~

## #184 PWHeader + EditModeSelector + PageAttributesBar

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPh01Q`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:32Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Refit existing `PageWorkbenchPage` chrome to pd-ui's header +
Blocked by: #155

Plan: [pd-ui-design-handoff-implementation.md#spw-a](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#spw-a)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:17:07Z

~~~~~~~~text
## Audit 2026-05-24: BLOCKED on pd-ui Phase 2

This slice consumes per-stage pd-ui components not shipped in Phase 1 (milestone #333). Required exports: PWHeader, EditModeSelector, PageAttributesBar. Tracked in pd-ui Phase 2 spec (TBD — see pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md once filed).

Workaround: co-locate components in frontend/src/pages/<Stage>/ using pd-ui primitives + canvas slots while waiting; refactor into pd-ui exports later.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-24T23:43:10Z

~~~~~~~~text
pd-ui Phase 2 M2 cross-cutting complete (2026-05-24). All 10 PageWorkbench composition components are available at `@concavetrillion/pd-ui/stages/PageWorkbench` — `PWHeader`, `EditModeSelector`, `PageAttributesBar`, `StageControlsPanel`, `HierarchyTreePanel`, `BlockTypePickerPanel`, `PageAttributesPanel`, `OcrTextPanel`, `TextReviewPane`, `LabelerCanvas`. The pd-ui blocker for this slice is now resolved.
~~~~~~~~

## #185 ArtifactViewer + overlays

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPh1Fg`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:34Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Replace existing `ArtifactViewer` component with pd-ui version; wire
Blocked by: #184

Plan: [pd-ui-design-handoff-implementation.md#spw-b](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#spw-b)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:17:08Z

~~~~~~~~text
## Audit 2026-05-24: BLOCKED on pd-ui Phase 2

This slice consumes per-stage pd-ui components not shipped in Phase 1 (milestone #333). Required exports: ArtifactViewer (with overlays). Tracked in pd-ui Phase 2 spec (TBD — see pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md once filed).

Workaround: co-locate components in frontend/src/pages/<Stage>/ using pd-ui primitives + canvas slots while waiting; refactor into pd-ui exports later.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-24T20:05:23Z

~~~~~~~~text
pd-ui Phase 2 M1 shipped at `9f81be7` (2026-05-24). All exports this slice depends on are now available from the new subpath `@concavetrillion/pd-ui/stages/PageWorkbench`:

- `ArtifactViewer` (composition molecule, `overlayMode`: view/split/illust/rotate/words)
- `SplitOverlay`, `IllustOverlay`, `WordBboxOverlay`, `RotateHandle` (individual overlays for custom shells)
- Types: `OverlayMode`, `SplitProposal`, `IllustBbox`, `WordBbox`, `ArtifactViewerProps`

API matches §6.3 of the pd-ui Phase 2 spec exactly. Cross-consumer integration test covers both pd-prep-for-pgdp (`split`) and pd-ocr-labeler-spa (`words`) shapes.

**Status: READY to start.**

Bump `@concavetrillion/pd-ui` once the next release tag lands (or pin to local for now).
~~~~~~~~

## #186 StageControlsPanel + per-stage sub-components

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPh1Ww`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:35Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Build left drawer rendering the correct `StageControls` for the
Blocked by: #184

Plan: [pd-ui-design-handoff-implementation.md#spw-c](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#spw-c)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:17:09Z

~~~~~~~~text
## Audit 2026-05-24: BLOCKED on pd-ui Phase 2

This slice consumes per-stage pd-ui components not shipped in Phase 1 (milestone #333). Required exports: StageControlsPanel. Tracked in pd-ui Phase 2 spec (TBD — see pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md once filed).

Workaround: co-locate components in frontend/src/pages/<Stage>/ using pd-ui primitives + canvas slots while waiting; refactor into pd-ui exports later.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-24T23:43:03Z

~~~~~~~~text
pd-ui Phase 2 M2 complete (2026-05-24). All 14 PageWorkbench exports needed for this slice are now available from `@concavetrillion/pd-ui/stages/PageWorkbench` (plus 4 M2 atom promotions in `/primitives`):

**PageWorkbench (M2 cross-cutting):** `PWHeader`, `EditModeSelector`, `PageAttributesBar`, `StageControlsPanel`, `HierarchyTreePanel`, `BlockTypePickerPanel`, `PageAttributesPanel`, `OcrTextPanel`, `TextReviewPane`, `LabelerCanvas`.

**Primitives (M2 atom promotions):** `BackendChip`, `CheckIcon`, `PageChip`, `ToggleBadge`.

**Status: READY to start** — StageControlsPanel composes BackendChip; ThresholdControls/GrayscaleControls/etc. plug in via the `controlsSlot` prop.

LabelerCanvas ships rendering + selection-click for M2; drag-to-create + handle-drag are deliberately out-of-scope (file as follow-on if your slice needs them).
~~~~~~~~

## #187 Right drawer tabs — four panels

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPh1kw`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:37Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Build tabbed right drawer hosting `PageAttributesPanel`,
Blocked by: #184

Plan: [pd-ui-design-handoff-implementation.md#spw-d](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#spw-d)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:17:09Z

~~~~~~~~text
## Audit 2026-05-24: BLOCKED on pd-ui Phase 2

This slice consumes per-stage pd-ui components not shipped in Phase 1 (milestone #333). Required exports: HierarchyTreePanel, BlockTypePickerPanel, PageAttributesPanel, OcrTextPanel. Tracked in pd-ui Phase 2 spec (TBD — see pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md once filed).

Workaround: co-locate components in frontend/src/pages/<Stage>/ using pd-ui primitives + canvas slots while waiting; refactor into pd-ui exports later.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-24T23:43:11Z

~~~~~~~~text
pd-ui Phase 2 M2 cross-cutting complete (2026-05-24). All 10 PageWorkbench composition components are available at `@concavetrillion/pd-ui/stages/PageWorkbench` — `PWHeader`, `EditModeSelector`, `PageAttributesBar`, `StageControlsPanel`, `HierarchyTreePanel`, `BlockTypePickerPanel`, `PageAttributesPanel`, `OcrTextPanel`, `TextReviewPane`, `LabelerCanvas`. The pd-ui blocker for this slice is now resolved.
~~~~~~~~

## #188 TextReviewPane (collapsible bottom)

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPh1xQ`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:38Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Build 280px-open / 44px-collapsed bottom pane with OCR text +
Blocked by: #184

Plan: [pd-ui-design-handoff-implementation.md#spw-e](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#spw-e)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:17:10Z

~~~~~~~~text
## Audit 2026-05-24: BLOCKED on pd-ui Phase 2

This slice consumes per-stage pd-ui components not shipped in Phase 1 (milestone #333). Required exports: TextReviewPane. Tracked in pd-ui Phase 2 spec (TBD — see pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md once filed).

Workaround: co-locate components in frontend/src/pages/<Stage>/ using pd-ui primitives + canvas slots while waiting; refactor into pd-ui exports later.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-24T23:43:11Z

~~~~~~~~text
pd-ui Phase 2 M2 cross-cutting complete (2026-05-24). All 10 PageWorkbench composition components are available at `@concavetrillion/pd-ui/stages/PageWorkbench` — `PWHeader`, `EditModeSelector`, `PageAttributesBar`, `StageControlsPanel`, `HierarchyTreePanel`, `BlockTypePickerPanel`, `PageAttributesPanel`, `OcrTextPanel`, `TextReviewPane`, `LabelerCanvas`. The pd-ui blocker for this slice is now resolved.
~~~~~~~~

## #189 LabelerCanvas (text_zones stage)

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPh1_A`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:40Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Build SVG block-overlay canvas + layer toggles for `text_zones`
Blocked by: #184

Plan: [pd-ui-design-handoff-implementation.md#spw-f](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#spw-f)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:17:11Z

~~~~~~~~text
## Audit 2026-05-24: BLOCKED on pd-ui Phase 2

This slice consumes per-stage pd-ui components not shipped in Phase 1 (milestone #333). Required exports: LabelerCanvas, LayerToggle. Tracked in pd-ui Phase 2 spec (TBD — see pd-ui/docs/specs/2026-05-24-design-handoff-stages-phase-2.md once filed).

Workaround: co-locate components in frontend/src/pages/<Stage>/ using pd-ui primitives + canvas slots while waiting; refactor into pd-ui exports later.
~~~~~~~~

### Comment 2 by ConcaveTrillion at 2026-05-24T20:05:33Z

~~~~~~~~text
pd-ui Phase 2 M1 (`ArtifactViewer` + overlays) shipped at `9f81be7` (2026-05-24) on the new subpath `@concavetrillion/pd-ui/stages/PageWorkbench`. This slice's `ArtifactViewer` dependency is now resolved; remaining per-stage pd-ui exports for this slice will land in later Phase 2 milestones (see [Phase 2 spec §7](https://github.com/ConcaveTrillion/pd-ui/blob/main/docs/specs/2026-05-24-design-handoff-stages-phase-2.md#7-implementation-plan)).
~~~~~~~~

### Comment 3 by ConcaveTrillion at 2026-05-24T23:43:12Z

~~~~~~~~text
pd-ui Phase 2 M2 cross-cutting complete (2026-05-24). All 10 PageWorkbench composition components are available at `@concavetrillion/pd-ui/stages/PageWorkbench` — `PWHeader`, `EditModeSelector`, `PageAttributesBar`, `StageControlsPanel`, `HierarchyTreePanel`, `BlockTypePickerPanel`, `PageAttributesPanel`, `OcrTextPanel`, `TextReviewPane`, `LabelerCanvas`. The pd-ui blocker for this slice is now resolved.
~~~~~~~~

## #190 ProjectsPage shell refit

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPh2PA`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:42Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Refit existing `ProjectListPage` to pd-ui's split-pane
Blocked by: #155

Plan: [pd-ui-design-handoff-implementation.md#spr-a](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#spr-a)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:16:07Z

~~~~~~~~text
## Audit 2026-05-24: READY to start

pd-ui Phase 1 (milestone #333) shipped all foundation components this slice needs. No external blockers.

See audit details in spec §'Implementation status (audit 2026-05-24)'.
~~~~~~~~

## #191 Attributes panel (collapsible sections)

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPh3Aw`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:43Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Render `AttributesPanel` with Bibliographic / PGDP project /
Blocked by: #190

Plan: [pd-ui-design-handoff-implementation.md#spr-b](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#spr-b)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:16:08Z

~~~~~~~~text
## Audit 2026-05-24: READY to start

pd-ui Phase 1 (milestone #333) shipped all foundation components this slice needs. No external blockers.

See audit details in spec §'Implementation status (audit 2026-05-24)'.
~~~~~~~~

## #192 ProjectsEmpty (first-time hero)

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPh3SQ`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:45Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Wire `pdUi/Projects/ProjectsEmpty` as the empty state in the
Blocked by: #190

Plan: [pd-ui-design-handoff-implementation.md#spr-c](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#spr-c)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:16:09Z

~~~~~~~~text
## Audit 2026-05-24: READY to start

pd-ui Phase 1 (milestone #333) shipped all foundation components this slice needs. No external blockers.

See audit details in spec §'Implementation status (audit 2026-05-24)'.
~~~~~~~~

## #193 Manage tab (archive / clean / save copy / delete)

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPh3fA`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:46Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Wire manage actions with 2-step confirmation for delete; archive
Blocked by: #190

Plan: [pd-ui-design-handoff-implementation.md#spr-d](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#spr-d)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:16:10Z

~~~~~~~~text
## Audit 2026-05-24: READY to start

pd-ui Phase 1 (milestone #333) shipped all foundation components this slice needs. No external blockers.

See audit details in spec §'Implementation status (audit 2026-05-24)'.
~~~~~~~~

## #194 ModalC desktop variant

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPh3tw`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:48Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Replace existing create-project modal with `ModalC`
Blocked by: #155

Plan: [pd-ui-design-handoff-implementation.md#sup-a](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#sup-a)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:16:10Z

~~~~~~~~text
## Audit 2026-05-24: READY to start

pd-ui Phase 1 (milestone #333) shipped all foundation components this slice needs. No external blockers.

See audit details in spec §'Implementation status (audit 2026-05-24)'.
~~~~~~~~

## #195 ModalB mobile fallback (<768px)

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPh3-Q`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:50Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Wire `pdUi/Upload/ModalB` as the mobile fallback at viewports below 768px.
Blocked by: #194

Plan: [pd-ui-design-handoff-implementation.md#sup-b](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#sup-b)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:16:11Z

~~~~~~~~text
## Audit 2026-05-24: READY to start

pd-ui Phase 1 (milestone #333) shipped all foundation components this slice needs. No external blockers.

See audit details in spec §'Implementation status (audit 2026-05-24)'.
~~~~~~~~

## #196 Routing — pipeline sub-tabs in ProjectConfigurePage

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPh4Og`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:51Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Extend `ProjectConfigurePage` with `?stage=<name>` querystring routing
Blocked by: #155

Plan: [pd-ui-design-handoff-implementation.md#scr-a](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#scr-a)
Verification: `cd frontend && pnpm test:e2e routing.spec.ts`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:16:14Z

~~~~~~~~text
## Audit 2026-05-24: READY to start

pd-ui Phase 1 (milestone #333) shipped all foundation components this slice needs. No external blockers.

See audit details in spec §'Implementation status (audit 2026-05-24)'.
~~~~~~~~

## #197 Storybook consumer demo

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPh4dg`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:53Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Pick `final/source/source.jsx` and produce a side-by-side parity
Blocked by: #156

Plan: [pd-ui-design-handoff-implementation.md#scr-b](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#scr-b)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:16:14Z

~~~~~~~~text
## Audit 2026-05-24: READY to start

pd-ui Phase 1 (milestone #333) shipped all foundation components this slice needs. No external blockers.

See audit details in spec §'Implementation status (audit 2026-05-24)'.
~~~~~~~~

## #198 MIGRATION_NOTES.md in pd-ui

- State: OPEN
- Node ID: `I_kwDOSUyCB88AAAABDPh4ug`
- Author: ConcaveTrillion
- Created: 2026-05-24T18:44:54Z
- Closed: n/a
- Labels: kind:feature, status:backlog
- Milestone: spec: pd-ui-design-handoff-implementation (#152)

### Body

~~~~~~~~text
Approach: Consume the `MIGRATION_NOTES.md` written by the pd-ui session,

Plan: [pd-ui-design-handoff-implementation.md#scr-c](https://github.com/ConcaveTrillion/pd-prep-for-pgdp/blob/main/docs/plans/pd-ui-design-handoff-implementation.md#scr-c)
Verification: `make ci AI=1`
Tracks: #152
~~~~~~~~

### Comment 1 by ConcaveTrillion at 2026-05-24T19:16:15Z

~~~~~~~~text
## Audit 2026-05-24: READY to start

pd-ui Phase 1 (milestone #333) shipped all foundation components this slice needs. No external blockers.

See audit details in spec §'Implementation status (audit 2026-05-24)'.
~~~~~~~~
