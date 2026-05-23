# M5 — Project-level orchestration fan-out + `awaiting_review` gate

> **Status**: Draft
> **Last updated**: 2026-05-11
> **Spec-Issue**: ConcaveTrillion/pd-prep-for-pgdp#45

## TL;DR

M5 takes per-page stage execution and lifts it to a project-level fan-out: one click runs every
dirty stage on every page, with per-page progress visible in the JobsPage. A new `awaiting_review`
job state parks `build_package` until every proof-range page has been attested, then auto-resumes.
Legacy `JobType.batch_*` rows continue to function via a translation shim through M5; M6 deletes the
shim.

## Context

The per-page stage DAG (M1/M2) is page-scoped. Today users still expect "process the whole project"
as one action; M5 keeps that affordance but layers it over the new model. Separately, the Q7 lock in
`docs/specs/pipeline-task-model.md` made `text_review` a gate stage with an `awaiting_review`
parked-job state when `build_package` runs against unreviewed pages — M5 is where that gate ships.

Parent (retro-demoted on 2026-05-11): #11. Roadmap section: `docs/plans/roadmap.md` §M5 (lines
~431–493).

## Constraints

- **M3 must be shipped first** (per-page review UX) — `awaiting_review` is meaningless without a way
  to actually review a page.
- **`STAGE_IMPL` registry must be the only call path** by the end of M5. Every existing call site
  (routes, CLI, batch shims) must route through `STAGE_IMPL[stage_id][device]`.
- **No new `JobType.batch_*` values.** New fan-out jobs use `JobType.project_run_*` only.
- **Backwards compatibility through M5:** existing `JobType.batch_process_pages` /
  `batch_extract_illustrations` / `batch_ocr` / `batch_text_postprocess` rows must continue to run.
  M6 removes them.
- **Job state machine:** new state `awaiting_review` between `running` and `complete`. Parked jobs
  must persist across server restarts.
- **Frontend:** JobsPage exists; banner + Open Tasks bell exist as components. Reusing rather than
  building from scratch.

## Decision

**Three coordinated pieces:**

1. **Project-level fan-out jobs.**
   - `JobType.project_run_stage_all_pages(stage_id)` — runs one stage on every page that needs it.
   - `JobType.project_run_dirty(stage_filter?)` — runs every dirty stage on every page until clean.
     Optional filter narrows the sweep.
   - Both dispatch per-page stage tasks under the hood. Progress aggregated at **per-page**
     granularity (not per-stage — that's noise at the project level).

2. **Legacy job-type shim.**
   - When a `JobType.batch_*` job row is created (via the existing endpoints or the `gpu/jobs`
     POST), the runner translates it to the equivalent `project_run_*` invocation and processes it
     through the registry. The original job row keeps its `batch_*` type for log readability but the
     work executes through the new path.
   - Shim lives in `core/jobs/legacy_shim.py`; deletion in M6.

3. **`awaiting_review` gate state.**
   - `POST /api/projects/{id}/build-package` runs as today, but the runner inspects every
     proof-range page's `text_review` row; if any is not `clean`, the job transitions to
     `awaiting_review` instead of running.
   - Project banner shows "N pages awaiting review before package can build" with a "Review next
     page" button.
   - Open Tasks bell badge shows the unreviewed-count for the active project.
   - On every `text_review.clean` write the runner re-checks; on the final clean write it
     auto-transitions the parked job to `running` and the package builds.

## Contract / Acceptance

- **`project.run_dirty` job:** posting one job row dispatches per-page stage tasks; the JobsPage
  progress bar ticks from 0 to N (page count). Each per-page row appears as a child entry under the
  project-level row.
- **`build_package` parks correctly:** after a project run completes but no review has happened,
  clicking "Build package" creates a job that immediately transitions to `awaiting_review`. The
  banner shows the unreviewed count.
- **Auto-resume:** after the final page is marked `text_review.clean`, the parked job transitions to
  `running` within ≤1s; the package is downloadable on completion.
- **Open Tasks bell:** badge count == unreviewed-page count for the active project; updates within
  ≤1s of a `text_review.clean` write.
- **Legacy shim:** `POST /api/gpu/jobs {"job_type": "batch_process_pages", ...}` produces a job row
  that runs to completion via the new path. Behaviour observable from the user side is identical to
  pre-M5.
- **Persistence across restarts:** a parked `awaiting_review` job survives a server restart; on the
  next clean attestation it resumes correctly.
- **`STAGE_IMPL` cutover:** `grep -r "LocalBackend.process_page\|CpuBackend.process_page" src/`
  returns only shim implementations (no direct callers other than the shim itself).

## Trade-offs considered

- **Progress granularity: per-stage vs per-page.** Per-stage is noise at the project level ("page 1
  stage 3 of 22") and confusing when stages can be `not-applicable`. Per-page aggregates correctly;
  the chip rail per page gives stage-level visibility.
- **Auto-resume trigger: explicit "Mark reviewed" vs implicit `text_review.clean`.** The Q7 lock
  defines `text_review.clean` as the human attestation primitive — there is no separate "Mark
  reviewed" action distinct from `text_review.clean`. Decided: trigger on `text_review.clean`
  writes.
- **Legacy shim retention.** A shim that lives forever invites callers that never migrate. Decided:
  shim is in M5, deletion is in M6 (explicitly tracked in `docs/plans/roadmap.md` §M6).
- **Job-state persistence across restarts.** Could use an in-memory parked-jobs queue + on-restart
  scan of `jobs` table; or rely purely on the DB row's `status='awaiting_review'`. Decided: latter —
  DB row IS the queue, server reads it at startup like any other job state.
- **Project-level fan-out as one job row vs many sibling rows.** One project-level row + child rows
  preserves the user's mental model of "I clicked one thing"; many sibling rows clutter JobsPage.
  Decided: one project row + child rows.

## Consequences

- **Removes the need for the `batch_*` job types** (deprecated in M5, deleted in M6). Existing users
  of those endpoints continue to work transparently.
- **Build-package becomes blocking on human review.** This is intentional UX — but it changes the
  timing model for users who previously expected "one shot end-to-end pipeline."
- **JobsPage progress display gains complexity.** Project row aggregates child progress; the
  implementation must avoid double-counting completed pages on a re-run.
- **Open Tasks bell becomes a real-time feature.** Currently it (if present) updates on TanStack
  Query refetch; M5 wires it to either SSE (from M3) or a short-poll endpoint. Reuse M3's SSE
  channel if scoped to project-level events.
- **Server restart-resilience** is now load-bearing for parked jobs; the test suite needs a "kill
  the server mid-park, restart, verify resume" scenario.
- **Migration story:** M4 lazily synthesises `page_stages` rows on first access; once M5 ships,
  `project.run_dirty` is the recommended way to bring a migrated project up to date.

## Open questions

- **JobType naming.** `project_run_stage_all_pages(stage_id)` vs `project.run_stage(stage_id)` vs
  `project_stage_sweep`. The first matches the spec but is verbose. **Flagged for CT review** —
  recommend `JobType.project_run_stage_all_pages` (matches the canonical spec) with a UI label `"Run
  [stage] on all pages"`.
- **`build_package` re-park behaviour.** If the user reviews 9 of 10 pages, kicks off
  `build_package` (parks), then *un*-reviews a page (does this even happen?), should the parked job
  stay parked or fail? **Flagged for CT review** — recommend stay-parked; un-review pushes the count
  back up.
- **Open Tasks bell scope.** Per-project vs cross-project. Workspace context implies the user is
  usually focused on one project at a time. **Flagged for CT review** — recommend per-project (the
  active project), with multi-project deferred.
- **Legacy shim coverage.** Are there pre-M1 `JobType.batch_*` callers besides the four enumerated
  (`batch_process_pages`, `batch_extract_illustrations`, `batch_ocr`, `batch_text_postprocess`)?
  **Flagged for CT review** — recommend a `grep -r "JobType.batch_"` audit as a milestone task.
- **SSE reuse from M3.** If M3 ships a per-page SSE channel, M5 needs project-level events too. Add
  a sibling project-level channel, or hoist M3's channel to project-level? **Flagged for CT review**
  — recommend a sibling project-level channel scoped to `JobType.project_*` events.

## References

- Roadmap: `pd-prep-for-pgdp/docs/plans/roadmap.md` §M5 (lines 431–493)
- Long-form pipeline spec: `pd-prep-for-pgdp/docs/specs/pipeline-task-model.md` §`text_review` as
  gate stage, §Two scopes of task
- Pipeline-task-model design (this spec set): `2026-05-11-pipeline-task-model-design.md`
- Q7 lock (text_review gate): pipeline-task-model.md §Open questions — Locked
- Parent spec issue (retro-demoted): #11
- This spec's issue: #45
