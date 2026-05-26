# Pipeline task model — granular per-page stages with dirty propagation

> **Status**: Draft
> **Last updated**: 2026-05-11
> **Spec-Issue**: ConcaveTrillion/pdomain-prep-for-pgdp#47

## TL;DR

Replace the monolithic `process_page_cpu` Step-4 body with a DAG of named stages, each carrying
typed input/output artifacts, persisted state, and an eager dirty-propagation rule. The workbench
surfaces every stage's artifact and gives the user "run this stage / run from here / rerun all
dirty" controls. M1 shipped (schema + DAG enumeration + reindex CLI); M2 is in flight (per-page
runner + dirty propagation + chip rail); M3–M6 queued.

## Context

Today the user sees seven row-types in the workbench (`ingest`, `thumbnails`, `batch_process_pages`,
`batch_extract_illustrations`, `batch_ocr`, `batch_text_postprocess`, `build_package`).
`batch_process_pages` is a monolithic Step-4 (`core/pipeline/process_page.py`) that runs 4c→4o in
one shot, so when a single sub-step is wrong (over-rotated deskew, threshold ate a thin glyph row)
the user cannot see the intermediate image, re-run only the affected sub-step, or make downstream
sub-steps inherit the corrected upstream without rerunning the whole page.

A long-form design document at `docs/specs/pipeline-task-model.md` enumerates every stage,
persistence column, API route, and Q1–Q10 lock with full code-level grounding. **This spec is the
9-section pipeline-authored record for issue #47** and treats `docs/specs/pipeline-task-model.md` as
its long-form reference; the canonical decisions are summarised below.

Parent (now `kind:feature-request`, retro-demoted on 2026-05-11 from `kind:spec`): #17. Original
freeform doc carries `> Spec-Issue: ConcaveTrillion/pdomain-prep-for-pgdp#17` (now broken); after this
spec lands, that header should be migrated to point at the demoted issue's current state or this
design doc (out of scope for this draft — flag for reviewer).

## Constraints

- **Stack:** FastAPI + Python 3.13 backend; React + Vite + TS + TanStack Query + Konva frontend;
  SQLite + filesystem storage in local mode (active); CPU-first execution; `pdomain-book-tools` pinned to
  `v0.9.0`.
- **Dual-write contract is non-negotiable:** every stage write commits the on-disk artifact AND the
  `page_stages` DB row transactionally. `pgdp-prep reindex` is the source-of-truth arbiter.
- **Splits = sibling pages**, not config on `ocr_crop` (so children get full DAG state and their own
  workbench affordances).
- **Backwards compatibility:** old `JobType.batch_*` values continue to function via shims through
  M5; cleanup in M6.
- **No new sub-steps inside the monolith.** All new pipeline work happens via the stage DAG.

## Decision

**Per-page stage DAG with eager dirty propagation. Ten locked decisions:**

| # | Decision | Long-form anchor |
|---|---|---|
| Q1 | Stage-state persistence: normalised `page_stages` SQLite table (one row per `(page_id, stage_id)`). | `pipeline-task-model.md` §Persistence model > SQLite schema |
| Q1-followup | Local-mode source of truth: **dual-write with reconciliation.** | §Persistence model > Dual-write reconciliation |
| Q2 | Dirty propagation: **eager** UPDATE cascade at stage write time. | §Dirty propagation |
| Q3 | Artifact persistence: **every intermediate, always.** No checkpoint-only mode; no `PGDP_FULL_STAGE_ARTIFACTS` switch. | §Persistence model |
| Q4 | Stage versioning: manual `STAGE_VERSIONS` integer registry per stage in M2; dirty-on-version-bump enforced. | §Stage versioning |
| Q5 | Backend collapse: unify into `STAGE_IMPL[stage_id][device]` registry; legacy `LocalBackend` / `CpuBackend` deleted by end of M5. | §Stage implementation registry |
| Q6 | Splits: **first-class sibling pages**, not config on `ocr_crop`. | §Splits as sibling pages |
| Q7 | `text_review`: gate stage; default ON; `awaiting_review` job state when `build_package` runs against unreviewed pages. | §`text_review` as gate stage |
| Q8 | Deferred-write executor: bounded executor + bounded queue. Default pool size `min(cpu_count(), 4)`; queue cap `4×pool`. Knobs: `PGDP_STAGE_WRITE_POOL_SIZE`, `PGDP_STAGE_WRITE_QUEUE_CAP`. | §Memory-resident execution model |
| Q9 | Deferred-write failure status: **always fail loudly.** Any write failure → stage `status='failed'`. | §Memory-resident execution model |
| Q10 | Canonical in-memory artifact: **device-aware.** CPU = `numpy.ndarray + ImageMeta`; CUDA = `cupy.ndarray + ImageMeta`. Auto-bridging on stage-boundary type mismatch with debug logging. | §In-memory artifact type model |

Stage IDs are stable strings (used as DB keys, storage path components, API query strings) and
versioned via `stage_version` (Q4). Two scopes of task — **project-level** (`project.ingest`,
`project.run_stage_all_pages`, `project.run_dirty`, `project.build_package`) and **page-level**
(`page.run_stage`, `page.run_from`, `page.run_dirty`, `page.split`, `page.unsplit`,
`page.text_review.clean`). Project-level tasks are fan-outs over page-level tasks.

## Contract / Acceptance

- **API:** `GET /api/data/projects/{id}/pages/{idx0}/stages` returns the page's stage rows; `POST
  /api/data/projects/{id}/pages/{idx0}/stages/{stage_id}/run` runs a single stage and cascades
  dirty.
- **Persistence:** every stage write produces (a) an on-disk artifact under
  `pages/<page_id>/stages/<stage_id>.*`, and (b) a `page_stages` row update with `status`,
  `last_run_at`, `input_hash`, `stage_version`; both within a single transaction.
- **Dirty cascade:** writing stage S clean → all of S's transitive descendants flip to `dirty` in
  the same transaction; `pgdp-prep reindex --heal` corrects any drift.
- **Splits:** `POST .../pages/{idx0}/split` creates N sibling `Page` rows with `parent_page_id`,
  `source_crop_bbox`, `split_index`, `split_at_stage`, `split_suffix`; child `decode_source` reads
  parent's `source_image` and crops to bbox.
- **`text_review`:** `build_package` parks when any proof-range page has `text_review` status ≠
  `clean`; auto-resumes on the final clean write.
- **Milestone gates:** M1 shipped (page_stages schema, DAG enumeration, reindex CLI). M2 in flight
  (per-page runner, eager dirty, chip rail, async run route, multi-artifact writer — see commits
  `25d92cd`, `2341fa1`, `50105af`, `e7f391d`, `8af4f15`, `66f32af`, `5abc7c9`, `a55d93e`). M3–M6
  acceptance lives in `docs/plans/roadmap.md` per-milestone smoke tests.

## Trade-offs considered

- **Monolith vs DAG.** Keeping `process_page_cpu` as a monolithic body is simpler but blocks
  fine-grained re-run, which is the headline UX win. Decided: DAG.
- **Eager vs lazy dirty propagation.** Lazy (compute dirty on read) avoids cascade-write
  amplification; eager (write-time cascade) keeps reads cheap and the DB self-consistent. Decided:
  eager (Q2).
- **Checkpoint-only vs every-intermediate artifacts.** Checkpoint-only saves disk but blocks
  side-by-side compare in the workbench. Decided: every intermediate (Q3) — disk is cheap,
  transparency is the point.
- **Direct call vs registry dispatch.** Hard-coding stage implementations is simpler but blocks the
  device-aware (`STAGE_IMPL[stage][device]`) shape. Decided: registry (Q5).
- **Splits as config vs first-class.** Splits-as-config on `ocr_crop` is the "minimal" path but
  breaks the "every stage has its own state" invariant for child crops. Decided: first-class sibling
  pages (Q6).
- **`text_review` as gate vs hidden inside `build_package`.** Hiding the review check inside
  `build_package` is less surface area but obscures the parked-job state. Decided: explicit gate
  stage with `awaiting_review` job state (Q7).
- **Synchronous vs deferred writes.** Synchronous in-thread writes block stage runners on disk I/O.
  Decided: bounded deferred-write executor (Q8) with loud failure (Q9).

## Consequences

- **Disk footprint grows** roughly N× where N is stage count per page (~22); offset by the
  per-milestone disk-cost UI in M4.
- **DB row count grows** by `stage_count × page_count`; SQLite handles this fine but indexing on
  `(page_id, stage_id)` is required.
- **Old `JobType.batch_*` and `LocalBackend` / `CpuBackend` are deprecated**; M5 makes them shims,
  M6 deletes them. Any caller that imports `LocalBackend` directly breaks at M6.
- **Frontend chip rail becomes the primary navigation** for per-stage work; M2's debug-style rail is
  replaced by M3's polished rail.
- **Search (P2 #13) gains a reliable index trigger:** the `text_postprocess` clean write is the
  moment an FTS index can be upserted (see search spec for #46).
- **Splits cascade dirty across the parent boundary** — a parent re-run dirties its children's
  `decode_source` (cross-page propagation case spelled out in the long-form spec §"Cross-page dirty
  propagation: split children").
- **Workspace memory:** subagents (`pdomain-prep-for-pgdp`, `pdomain-prep-for-pgdp-docs`) should treat this
  spec as the authoritative summary; the long-form `pipeline-task-model.md` is the long-form design
  notes.

## Open questions

All ten of Q1–Q10 are **locked** as of 2026-05-07 — see the Decision section. If a locked decision
turns out to be materially worse than its alternative during implementation, surface it for
re-evaluation rather than silently flipping.

**Reconciliation items flagged for reviewer:**

- The long-form `docs/specs/pipeline-task-model.md` carries `Spec-Issue:
  ConcaveTrillion/pdomain-prep-for-pgdp#17`. After the retro-demotion of #17 to `kind:feature-request`,
  that header is stale. Reviewer to decide: re-point at this new spec's issue (#47), mark the
  freeform doc `Status: Superseded by 2026-05-11-pipeline-task-model-design.md`, or migrate the
  freeform doc into a non-spec design-notes location.
- M2's in-flight slice work is keyed to ad-hoc "Slice N" identifiers in commits rather than
  `kind:chore` decompose products. `/decompose-spec` on this new spec will produce a fresh
  `kind:chore` child set; the existing `kind:feature` children #18–#22 (and #19's grandchildren
  #39–#42) should be `close-superseded` after the new chores land.

## References

- Long-form design: `pdomain-prep-for-pgdp/docs/specs/pipeline-task-model.md`
- Roadmap: `pdomain-prep-for-pgdp/docs/plans/roadmap.md` §P0.5, §M1–§M6
- Shipped log: `pdomain-prep-for-pgdp/docs/archive/plans/roadmap-shipped.md`
- Repo orientation: `pdomain-prep-for-pgdp/CLAUDE.md`
- M1/M2 commits anchoring the design in code: `128ead9`, `2341fa1`, `c46eaea`, `6d335e6`, `e126c20`,
  `d836619`, `8af4f15`, `c42bc85`, `55dbc9d`, `02f7ad7`, `2a62346`, `39d2288`, `7246199`, `66f32af`,
  `5abc7c9`, `a55d93e`
- Parent spec issue (retro-demoted): #17
- This spec's issue: #47
