# Intent map

## Agent Index

- **Kind:** plan
- **Status:** active
- **Read when:** choosing work, checking deferred ideas, or identifying owner decisions.
- **Search terms:** active intent, deferred work, rejected direction, owner decision.

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

- Reconcile the lint-deviation catalogue with every current inline and configured Ruff, ESLint, and basedpyright
  suppression.
- Keep the roadmap aligned with shipped GPU grayscale support and registry version 3.
- Maintain the current `wordcheck` stage; scanno research may improve its flagging but does not create a separate stage.

## Deferred

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

## Legacy-unverified sweep

The 2026-07-14 migration classified checker-derived legacy documents using code, tests, graph neighbors, and git
history. Current architecture and process documents remain active. Completed plans and shipped specs can retire,
while pre-convergence UI and handoff bundles are superseded. The unresolved research ideas above remain deferred.

[Decisions](decisions.md) records the corresponding lifecycle evidence and tombstones.
