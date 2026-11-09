---
Status: active
Owner: CT
Created: 2026-07-14
Last verified: 2026-11-09
Kind: plan
Level: I1
---

# Intent map

## Agent Index

- **Kind:** plan
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-11-09
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
- **Pipeline completion queue:** [completion plan](../plans/2026-07-21-pipeline-completion-review.md).
  Wave 0 shipped on 2026-11-06. Current book-path behavior is in
  [Book path contracts](../architecture/03-pipeline.md#book-path-contracts).
  Start the remaining queue at Wave 2 under [docs/issues](../issues/README.md).
- **GitHub issue migration (not started):** 48 issues are still open on `pdomain/pdomain-prep-for-pgdp`
  (checked 2026-11-09). 43 are `kind:feature` issues #156–#198 for the pd-ui design handoff, and #152
  is the spec issue that tracks them. The other four are three bugs and one chore: #131 the Postgres
  adapter lacks `IDatabase` methods, #132 progress updates can undo a cancellation, #135 authenticated
  SSE bypasses the bearer-token client, and #146 CI lacks dependency vulnerability audits. Move their content into repo
  docs first, and delete an issue from GitHub only after the owner says go. Archiving the 131 closed
  issues is optional. Pattern:
  `../pdomain-ocr-cli/docs/decisions/2026-07-19-github-issues-cutover.md`.

## Deferred

- Add a visible Compute panel before enabling device warmup. Preserve the factory/hook, device-state display,
  conditional CUDA guidance, and panel/warmup tests in the [backlog](../plans/2026-06-08-compute-settings-panel-backlog.md).
- Add faithful upper-case Roman and alphabetic numbering controls and round trips. Current frontend mappings
  lose those distinctions; see [numbering limits](../architecture/08-page-numbering.md#limits-and-remaining-work).
- Revisit the broader first-class Source back/duplicate/inserted-kind model separately from the existing durable
  back/duplicate role labels. Detector integration with the existing folio loader and confirmation guard remains
  [W3.9](../issues/2026-07-21-w39-page-order-ocr-folios.md).
- Generalize grayscale settings controls beyond grayscale under [W2.5](../issues/2026-07-21-w25-settings-tiers-generalize.md).
  Real archive-copy export remains [W3.10](../issues/2026-07-21-w310-save-copy-archive.md).

- Validate GPU memory and throughput on a representative multi-page book. The historical 20-page benchmark was
  planned but not recorded as run.
- Improve search normalization, ranking, and optional cross-project scope beyond the shipped project-scoped text index.
- Add automated source-quality scoring, richer metadata collection, project comments, structured settings
  import/export, and deeper illustration format controls if product priority supports them.
- Revisit flip operations, bulk crop-quality actions, global hyphen/scanno library management, and
  managed-adapter deployment only with current API and UX evidence.
- Strengthen API-key session CSRF, expiry/revocation, CORS, and failed-login observability.

## Rejected or superseded

- Backend `project_run_dirty` fan-out was superseded by frontend-driven per-stage execution.
- A standalone `scannocheck` stage was removed; `wordcheck` is the real registry stage.
- Timer-based undo for word deletion was rejected in favor of immediate soft delete with persistent restore.
- Legacy PageWorkbench, CropsGrid, ReviewQueue, and project-configure surfaces were replaced by the pipeline shell
  and registered tool surfaces.

## Owner decisions

No decision blocks this migration. Managed-mode priority, some remote execution choices, and optional UX
expansions remain deferred product choices.

- Where migrated GitHub issues go: all 48 into `docs/issues/`, or the 43 features and their spec into
  `docs/plans/roadmap.md` with only #131, #132, #135 and #146 in `docs/issues/`. The issues README already
  keeps feature work on the roadmap.

## Legacy-unverified sweep

The 2026-07-14 migration classified checker-derived legacy documents using code, tests, graph neighbors, and git
history. Current architecture and process documents remain active. Completed plans and shipped specs can retire,
while pre-convergence UI and handoff bundles are superseded. The unresolved research ideas above remain deferred.

[Decisions](decisions.md) records the corresponding lifecycle evidence and tombstones.
