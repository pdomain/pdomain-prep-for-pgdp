# M4 — Lazy migration of pre-M1 projects + disk-cost UI

> **Status**: Draft
> **Last updated**: 2026-05-13
> **Spec-Issue**: ConcaveTrillion/pdomain-prep-for-pgdp#10

## TL;DR

On first workbench open of a pre-M1 project, synthesise `page_stages` rows
(all stages `dirty`) from `pages.processing_status`. A `pgdp-prep
migrate-projects --force-rebuild [<project_id>] [--page-idx <idx0>]` CLI
clears and re-synthesises those rows. The project header banner shows current
stage-artifact disk usage and a rough full-DAG estimate.

## Context

M1 introduced the `page_stages` table. Projects created before M1 have `pages`
rows (and on-disk source images + thumbnails) but zero `page_stages` rows. The
M2 `StageChainRail` calls `GET /api/data/projects/{id}/pages/{idx0}/stages`,
which lazy-inits 22 rows via `INSERT OR IGNORE` — so in principle the first
workbench open already works. However, the legacy `processing_status` field on
`PageRecord` carries information (e.g. `complete`) that implies the old
monolithic pipeline ran; the user sees 22 `not-run` chips even though a
full processed page exists on disk. M4 makes the transition legible: mark all
stages `dirty` (not `not-run`) so the user knows "this page has legacy output
that needs re-running through the new DAG."

## Constraints

- No blocking migration at app startup — lazy on first page open.
- Source images (`source_key`) and thumbnails must survive any migration or
  force-rebuild operation.
- The `reindex` CLI (`pgdp-prep reindex --heal`) remains the source-of-truth
  arbiter for artifact/DB drift; M4 migration must not create state that
  `reindex` flags as inconsistent.
- The disk-cost banner is informational only; the "Reclaim space" button is a
  placeholder in M4 (actual prune lands later).
- `--force-rebuild` scoped per-project; optional `--page-idx` narrows to a
  single page for surgical repair.

## Decision

### Legacy detection

A project is "legacy" if it has at least one `PageRecord` whose `page_stages`
rows are all `not-run` **and** whose `processing_status` is not `None` /
`pending`. Detection happens inside the existing lazy-init path:
`GET .../stages` calls `commit_stage_artifact`-adjacent logic that checks
`processing_status`; if it's a legacy value (`complete`, `error`,
`processing`) the rows are initialised to `dirty` instead of `not-run`.

Concretely:

```python
LEGACY_STATUSES = {"complete", "error", "processing"}

def _initial_stage_status(page: PageRecord) -> PageStageStatus:
    if page.processing_status in LEGACY_STATUSES:
        return PageStageStatus.dirty
    return PageStageStatus.not_run
```

This runs once per page per project; subsequent calls hit the `INSERT OR
IGNORE` fast path.

### `--force-rebuild` CLI

`pgdp-prep migrate-projects --force-rebuild [<project_id>] [--page-idx <idx0>]`

Behaviour:

1. For each targeted project (all projects when `project_id` omitted):
   a. Delete all `page_stages` rows for the project (or the single page when
      `--page-idx` is set).
   b. Delete the corresponding on-disk stage artifact directories
      (`pages/<page_id>/stages/`), leaving `pages/<page_id>/source.*` and
      `pages/<page_id>/thumbnail.*` untouched.
   c. Re-call the lazy-init path for each affected page so fresh `dirty` rows
      are inserted immediately (avoids a "no rows" gap if the user opens the
      workbench before the next lazy-init).
2. Prints a summary: `migrate-projects --force-rebuild: <N> project(s),
   <M> page(s), <X> MB freed`.

The existing `pgdp-prep migrate-projects` (no flag) continues to report
legacy-project counts without modifying anything (read-only diagnostic).

### Disk-cost banner

Mounted in the project header (alongside the existing project name/status
row). Computed on `GET /api/data/projects/{id}` response extension:

- `stage_artifacts_bytes`: filesystem `os.path.getsize` walk of
  `pages/*/stages/` — cached in the DB as a project-scoped aggregate,
  refreshed on every job completion that writes new artifacts.
- `estimated_full_dag_bytes`: `source_zip_bytes × FULL_DAG_RATIO` where
  `FULL_DAG_RATIO = 12` (empirically: 22 stages, most are image-typed at
  ≈ 0.5× source per stage, plus JSON/text stages at negligible size).
  This is a rough order-of-magnitude guidance, not a precise forecast.

Banner text: `"Stage artifacts: {X} GB  /  ~{Y} GB estimated full DAG"`
with a `"Reclaim space →"` button that opens a `"Coming soon"` dialog in M4.

The banner renders nothing (no layout shift) when `stage_artifacts_bytes == 0`
(fresh project or no stages run yet).

## Contract / Acceptance

### Lazy migration

- [ ] Opening a pre-M1 page in the workbench shows all 22 chips as `dirty`
  (amber), not `not-run` (slate), when `processing_status` ∈
  `{complete, error, processing}`.
- [ ] A page with `processing_status = None` or `pending` keeps `not-run`.
- [ ] `pgdp-prep reindex` after lazy-migration exits 0 with no drift (no
  orphan files, no missing artifacts, no hash mismatches — `dirty` rows have
  `artifact_key = null` which is valid for dirty/not-run).
- [ ] The lazy-init is idempotent: calling `GET .../stages` twice does not
  double-insert or flip status back to `not-run`.

### Force-rebuild CLI

- [ ] `pgdp-prep migrate-projects --force-rebuild <project_id>` deletes
  `page_stages` rows + on-disk `pages/*/stages/` dirs for that project and
  re-synthesises `dirty` rows.
- [ ] Source images (`source_key` path) and thumbnails survive.
- [ ] `--page-idx <idx0>` narrows to a single page.
- [ ] Omitting `<project_id>` rebuilds all projects.
- [ ] Summary line is printed on stdout.
- [ ] Unit test: mock filesystem + SQLite, assert correct rows deleted and
  re-inserted as `dirty`.

### Disk-cost banner acceptance

- [ ] Project header shows `"Stage artifacts: X GB  /  ~Y GB estimated full
  DAG"` when any stage artifacts exist.
- [ ] Banner is absent (no layout shift) when `stage_artifacts_bytes == 0`.
- [ ] `"Reclaim space →"` button opens a `"Coming soon"` dialog.
- [ ] `estimated_full_dag_bytes` uses `source_zip_bytes × 12`.
- [ ] Vitest test: banner renders correct text given mocked API response with
  `stage_artifacts_bytes` and `source_zip_bytes`.

## Trade-offs considered

**Eager migration at startup vs lazy on first access.** Eager would ensure
consistency before any API call, but on a large library (hundreds of projects)
it blocks startup. Lazy is safe because the `GET .../stages` lazy-init is
already idempotent; the only risk is a tiny window where a concurrent request
could see `not-run` instead of `dirty` on a brand-new project — acceptable
since the user must navigate to the workbench (a human action) before the
status matters.

**Marking legacy pages `failed` vs `dirty`.** `failed` implies the pipeline
tried and broke; `dirty` correctly implies "needs to be (re-)run". `dirty` is
the right status here.

**Full disk scan vs cached aggregate for disk-cost.** A full scan on every
project-open is cheap for small projects but slow for large ones (hundreds of
pages × 22 stages). Caching the aggregate in the DB (updated on job
completion) keeps the banner fast. The cached value may be slightly stale
(e.g. after a manual `rm`), but this is informational UI — stale by a few MB
is acceptable.

## Consequences

- Pre-M1 users get a coherent "all stages dirty" view on first access — better
  than an unexplained all-green (from old `processing_status=complete`) or
  all-not-run chip rail.
- `pgdp-prep reindex` remains the authoritative drift-checker; M4 migration
  produces only `dirty` rows with null `artifact_key`, which reindex treats as
  valid.
- The `FULL_DAG_RATIO = 12` constant is a rough heuristic. Books with many
  large pages will see estimates off by 2×; a future M4.1 could refine it
  using per-stage size samples from completed projects.
- The "Reclaim space" button is a placeholder. Actual prune (`--prune-stage-
  artifacts`) lands in a follow-up; the dialog prevents user confusion about
  the missing action.

## Open questions

_(none — all three open questions from the issue resolved above. See Decision §
for the `processing_status` mapping, disk-cost estimation approach, and
`--force-rebuild` scope decisions.)_

## References

- `docs/plans/roadmap.md` §M4 — smoke test, pass criterion, likely failure modes
- `docs/specs/2026-05-11-pipeline-task-model-design.md` — canonical stage DAG,
  dual-write contract, `page_stages` schema
- `src/pd_prep_for_pgdp/adapters/database/sqlite.py` — `SqliteDatabase` CRUD
  for `page_stages`
- `src/pd_prep_for_pgdp/core/pipeline/stage_dag.py` — `PAGE_STAGE_IDS`,
  `PageStageStatus`
- `src/pd_prep_for_pgdp/__main__.py` — existing `migrate-projects` subcommand
  entry point
