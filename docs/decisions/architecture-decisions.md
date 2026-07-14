# Architecture decisions (locked)

## Agent Index

- **Kind:** decision
- **Status:** active
- **Last verified:** 2026-07-14
- **Read when:** evaluating a change to a locked architecture choice.
- **Search terms:** architecture decisions, locked decisions, topology, data model.

This file collects pipeline / topology / data-model decisions that are
**already locked** and are not actionable implementation items. Moved out
of `docs/plans/roadmap.md` so the roadmap can stay focused on open work.

Each entry names the decision, when it was locked, and where the
authoritative spec lives. Treat these as binding — if you think one
should change, raise it as a deliberate proposal, do not silently
diverge in code.

---

## AD-1. Pipeline task model — per-page stage DAG (locked 2026-05-07)

Current authority: [pipeline architecture](../architecture/03-pipeline.md).

The pipeline is a 22-stage per-page DAG. Each stage is independently
runnable, individually inspectable, and tracked in the `page_stages`
table (composite PK `(project_id, page_id, stage_id)`, CHECK clauses
pin `status` and `stage_id` to canonical enums). Dirty propagation is
eager: re-running a stage marks every `clean`/`failed` descendant
`dirty`.

This **replaces** the older row-based pipeline (`ingest` /
`thumbnails` / `batch_process_pages` / `batch_extract_illustrations` /
`batch_ocr` / `batch_text_postprocess` / `build_package`). Those
`JobType.batch_*` values have been deleted (M6, 2026-05-15). Project-
level fan-out is now `JobType.project_run_dirty` /
`project_run_stage_all_pages`.

Open questions Q1–Q10 are all closed — see spec §"Open questions —
Locked (2026-05-07)" for the table. Key shifts vs. earlier drafts:

- **Q3:** every intermediate artifact is always persisted (no
  checkpoint-only mode).
- **Q6:** splits = sibling pages (new `Page` rows with
  `parent_page_id` / `source_crop_bbox` / `split_index` /
  `split_at_stage`). Splits are **not** config on `ocr_crop`.
- **Q7:** `build_package` parks in `awaiting_review` when any
  proof-range page has not been attested; auto-resumes when the gate
  clears.
- **Q1-followup, Q8, Q9, Q10:** lock the dual-write reconciliation
  contract, bounded deferred-write executor, fail-loudly persistence,
  and device-aware in-memory artifact model.

## AD-2. Dual-write contract (locked 2026-05-07)

Every stage write is a transaction across the on-disk artifact and
the `page_stages` DB row. The writer follows
write-tmp → fsync → atomic-rename → DB-upsert with full rollback on
any failure (Q9 fail-loudly).

`pgdp-prep reindex [--heal]` is the source-of-truth arbiter for
drift. Never bypass the writer; never edit the DB without writing
the file (or vice-versa).

Single-file writer: `commit_stage_artifact` in
`core/pipeline/page_stage_writer.py`. Compound-output stages (`ocr`,
`extract_illustrations`, `text_review`) use the sibling
`commit_stage_artifacts_multi` with the same fsync + atomic-rename
contract plus rollback; `COMPOUND_PRIMARY_FILENAME` maps each
compound output_type to its primary file.

## AD-3. Splits = sibling pages, not config on `ocr_crop` (locked 2026-05-07)

When a page is split, the result is **N new sibling `Page` rows**,
each with `parent_page_id` / `source_crop_bbox` / `split_index` /
`split_at_stage` / `split_suffix` / `reading_order`. The original
page row is preserved (so the user can re-split differently later).

This is the only valid representation. Do not add a `splits[]` field
to `ocr_crop` config. Do not embed split metadata in `PageRecord`
outside the listed columns. Schema migrations apply the all-or-none
model validator on `PageRecord`.

## AD-4. Local-first priority (locked 2026-05-07)

The active target is the **SQLite + filesystem + CPU** deployment
shape. Cloud / remote (Modal/S3, Postgres live tests, install.sh net
exercise, registry push) is parked under "Deferred — remote / cloud
mode" in `docs/plans/roadmap.md`.

Implications for new code:

- Don't add features that only work in managed mode.
- Adapter pattern stays — but the **default path** is the local one,
  and tests target it.
- Postgres adapter scaffold is preserved on `main` (commit `77072c6`)
  with class-direct tests behind `importorskip("psycopg")`; revive
  by wiring a Postgres service into the dev container.

## AD-5. `compute_prefix` first-frontmatter-page returns `f001` (shipped 2026-05-16)

P3 open question resolved: the first frontmatter page now returns `f001`
(not `f000`). Shipped as `feat(p3): fix compute_prefix frontmatter numbering
to start at f001` (commits `02478ee`, `6922ce9`). `test_compute_prefix_basic_numbering`
asserts `f001`. This is locked — do not revert to `f000`.

## AD-6. Memory-resident execution model + bounded deferred-write executor

The per-page stage DAG operates on in-memory image objects during a
run; disk I/O is reserved for persistence. The bounded
`StageWriteExecutor` (`ThreadPoolExecutor` + `BoundedSemaphore`)
provides back-pressure for the deferred-write path. Env-var overrides:
`PGDP_STAGE_WRITE_POOL_SIZE`, `PGDP_STAGE_WRITE_QUEUE_CAP`. On write
failure, the stage is marked `failed` and descendants are cascaded
dirty (Q9).

M3 workbench is purely a **disk read** path — does not require a
live in-memory DAG run.

## AD-7. STAGE_IMPL registry is the only execution path (post-M6)

`STAGE_IMPL[stage_id][device]` in `core/pipeline/stage_registry.py`
is the only path to execute a stage. `LocalBackend` / `CpuBackend` /
`process_page_cpu` have been deleted (M6, 2026-05-15). Bootstrap uses
a `_NoOpGPUBackend` stub; runtime selection is via `pick_device()`.

When adding a new stage: register an entry in `STAGE_IMPL`. Do not
add a sibling backend class. Do not add a new `JobType.batch_*` value.

## AD-8. `ApiModel` base for serialization schema strictness

Wire-shape Pydantic models inherit `ApiModel(BaseModel)` so
`default_factory` fields are marked **required** in the
`/openapi.json` serialization schema (`-Output` variants). The
`-Input` variant stays all-optional. This is what lets the frontend
codegen treat server responses as fully populated.

## AD-9. Thumbnail parallelism = CPU pool (nvjpeg/DALI deferred)

`core/ingest.generate_thumbnails` uses `ProcessPoolExecutor` with
`max_workers=os.cpu_count()` (override `PGDP_THUMBNAIL_WORKERS`; `1`
disables). Tests pin `PGDP_THUMBNAIL_WORKERS=1`.

A GPU fast path (nvjpeg / DALI) is **not** a free win here — the
per-image PCIe round-trip washes the kernel speedup unless the batch
is large enough. Revisit only if profiling on a real book (≥500
pages, GPU host) shows the CPU pool path dominates Step-2 cost
after storage I/O.

## AD-10. Release strategy — self-hosted PEP 503 index

Published wheels go to a self-hosted PEP 503 index at
`pdomain/pdomain-index-pip` (GitHub Pages). Never use PEP 508
direct-URL deps in `pyproject.toml` (would burn the PyPI bridge).
`install.sh` has the same latent wheel-METADATA bug pre-fixed in
`pdomain-ocr-cli`; fix before exercising the curl-pipe-sh path.

Agent-memory reference: `release_strategy_self_hosted_index.md`.

## AD-11. Shared page state; app-local workflow history

Page identity, provenance, extensions, and other generic lifecycle state use
pdomain-ops `PageRecord`, aggregates, `PagesApplication`, `LocalPageStore`, and
BlobStore. Each project stores this state in `.pd-pages/events.db` and
`.pd-pages/blobs/`.

Prep display order remains app-specific. Shared Page aggregates persist the
namespaced `PrepPageExtension.idx0`, and prep sorts pages by that value.
`ProjectAggregate.page_ids` remains membership in insertion order, while
generic `PageRecord.page_index` is not rewritten by reorder.

Prep-domain workflow history remains app-local. `PrepProjectAggregate` uses the
separate project `events.db` for events such as `PageReorder`, stage runs,
review decisions, gate confirmations, and settings changes. A reorder updates
the prep extension values on shared Page aggregates and records the workflow
event locally.

Project configuration, pipeline stage rows, jobs, search, and remaining
compatibility boundaries stay in prep's `IDatabase`. This split avoids
duplicating the shared lifecycle model without forcing prep's application DAG
or job schema into pdomain-ops. It also describes what actually shipped: the
legacy database was not deleted wholesale.

Evidence: `src/pdomain_prep_for_pgdp/core/page_store_factory.py`,
`src/pdomain_prep_for_pgdp/core/pipeline/prep_aggregate.py`,
`src/pdomain_prep_for_pgdp/api/data/pages.py`,
`src/pdomain_prep_for_pgdp/core/ingest.py`,
`src/pdomain_prep_for_pgdp/core/page_service_helpers.py`,
`tests/test_page_store_factory.py`, `tests/test_reorder_pages_route.py`, and
`_tbd/ocr-container-docs/plans/2026-06-01-page-split-prep-for-pgdp.md`.

---

## How decisions get added here

When a debate in a spec / PR / issue concludes with **"this is the
shape we're going with, full stop,"** write it here in the same
voice as the entries above (1–2 paragraphs, link to the spec,
state any consequent constraints). Do not duplicate the spec — link
to it. Do not put implementation status here — that belongs in
[the roadmap](../plans/roadmap.md) or [migration decisions](../context/decisions.md).
## Context

The entries above consolidate architecture choices that had been mixed into implementation roadmaps.

## Decision

Treat each numbered architecture decision above as binding until a later,
explicit decision supersedes it.

## Consequences

Implementation plans may execute these choices but must not silently redefine
them. Proposed changes require a new decision with evidence.

## Supersedes / Superseded-by

This collection supersedes the decision portions of retired planning
documents. Individual entries identify later changes where one exists.
