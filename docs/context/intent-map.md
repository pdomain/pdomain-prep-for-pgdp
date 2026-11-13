---
Status: active
Owner: CT
Created: 2026-07-14
Last verified: 2026-11-13
Kind: plan
Level: I1
---

# Intent map

## Agent Index

- **Kind:** plan
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-11-13
- **Read when:** choosing work, checking deferred ideas, or identifying owner decisions.
- **Search terms:** active intent, deferred work, rejected direction, owner decision, pipeline issues.

## Goal

Keep product direction separate from retired implementation scaffolding. Current work follows the local-first,
24-stage pipeline and the architecture linked from [current state](current-state.md).

## Architecture

Intent is grouped by lifecycle state and cites the implementation or historical evidence that established it.

## Tech Stack

FastAPI, Python 3.13, React 19, XState v5, TanStack Query, Konva, SQLite/filesystem locally, and configurable
adapters for other deployment shapes.

## Global Constraints

Do not reintroduce the removed backend `project_run_dirty` fan-out or the phantom `scannocheck` stage. Current
constraints include dual-write guarantees, sibling-page splits, owner filtering, bounded resource handling, and
generated OpenAPI.

## Active

- Keep configured lint deviations and suppression rationale classes current. Inline suppressions remain
  source-local and are found by repository search rather than duplicated as a brittle line-by-line inventory.
- Keep the roadmap aligned with shipped GPU grayscale support and registry version 3.
- Maintain the current `wordcheck` stage; scanno research may improve its flagging but does not create a separate stage.
- **Forward queue:** the [roadmap](../plans/roadmap.md). Waves 0 and 1 shipped. Book-path behavior is in
  [Book path contracts](../architecture/03-pipeline.md#book-path-contracts). Follow the remaining open rows; Wave 2
  and the completed Wave 3 rows shipped.
  The [July review](../plans/2026-07-21-pipeline-completion-review.md) is the record of that sequencing, not a second queue.
  Which ideas belong in another repository is in [Repository boundary](../architecture/10-repository-boundary.md).
- **GitHub issue migration (done 2026-11-09):** all 48 open issues on `pdomain/pdomain-prep-for-pgdp` were
  checked against `14f0ba8`, moved into repo docs, and deleted from GitHub. #131, #132, #135 and #146 are
  governed reports in [`docs/issues/`](../issues/README.md). #152 and #156–#198 are in the
  [roadmap](../plans/roadmap.md) section "Former pd-ui design handoff". All 179 issues, open and closed, are
  archived verbatim in commit `17d3dcb`. The ledger and deletion journal are in the
  [cutover decision](../decisions/2026-11-09-github-issues-cutover.md). The 131 closed issues were deleted
  too, so GitHub holds no issues for this repository.

## Deferred

Parked work for this app is [Parked in this app](../plans/roadmap.md#parked-in-this-app).
The remaining folio, JWT-stream, and audit-gate gaps are [Now](../plans/roadmap.md#now).
Work that should be another repository is [Separate repositories](../plans/roadmap.md#separate-repositories),
with the rationale in [Repository boundary](../architecture/10-repository-boundary.md).

The 2026-11-12 consolidation moved the item text to the roadmap so this file no longer keeps a second copy.
The [queue decision](../decisions/2026-11-12-roadmap-is-the-queue.md) records that choice.

## Rejected or superseded

- Backend `project_run_dirty` fan-out was superseded by frontend-driven per-stage execution.
- A standalone `scannocheck` stage was removed; `wordcheck` is the real registry stage.
- Timer-based undo for word deletion was rejected in favor of immediate soft delete with persistent restore.
- Legacy PageWorkbench, CropsGrid, ReviewQueue, and project-configure surfaces were replaced by the pipeline shell
  and registered tool surfaces.

## Owner decisions

No decision blocks the documentation consolidation. Whether to start a hosted service, a GPU worker image,
or a shared language-data library is an owner choice. Until then those items stay parked. See
[Repository boundary](../architecture/10-repository-boundary.md).

## Legacy-unverified sweep

The 2026-07-14 migration classified checker-derived legacy documents using code, tests, graph neighbors, and git
history. Current architecture and process documents remain active. Completed plans and shipped specs can retire,
while pre-convergence UI and handoff bundles are superseded. The unresolved research ideas above remain deferred.

[Decisions](decisions.md) records the corresponding lifecycle evidence and tombstones.
