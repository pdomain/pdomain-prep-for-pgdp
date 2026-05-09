# 08 — Roadmap

> Shipped items live in `08-roadmap-shipped.md` — kept out of this file
> so the active roadmap stays focused on open work.

This roadmap is the **forward** view, organised by priority. Shipped
work is in `08-roadmap-shipped.md`; per-iteration history lives in
`git log`.

**Local-first priority (2026-05-07):** the user-facing punch list below
focuses on the local solo / self-hosted-team experience using the
SQLite + filesystem + CPU shape. Everything that requires cloud
infrastructure (Postgres, Modal/S3, registry pushes, install-pipe
verification on a clean network) is parked under "Deferred — remote /
cloud mode" at the bottom of this file. Revisit those once the local
flow is fully shipped.

---

## P0 — local-mode user flow gaps

_All P0 local-mode UX items shipped — see `08-roadmap-shipped.md`._
_§L1 (port auto-select + persistence + in-UI URL display) and §L2_
_(`make run`/`make run-cpu`) are complete. Next user-visible-progress_
_candidates live under P1 / P2 below. Cloud/remote-mode items are_
_parked under "Deferred — remote / cloud mode" at the bottom._

---

## P0.5 — Pipeline task-model refactor (canonical local-mode work)

**Spec:** [`docs/specs/pipeline-task-model.md`](specs/pipeline-task-model.md)
(locked 2026-05-07).

User directive (2026-05-07): the current row-based pipeline (ingest /
thumbnails / batch_process_pages / batch_extract_illustrations /
batch_ocr / batch_text_postprocess / build_package) is too coarse-
grained. `batch_process_pages` is a 14-sub-step monolith
(`core/pipeline/process_page.py`); each sub-step needs to be an
individually runnable, individually inspectable stage with dirty
propagation across a DAG. The spec defines a `page_stages` table,
every-intermediate per-stage artifact storage, splits-as-sibling-pages,
and a workbench artifact viewer.

**Decisions Q1–Q10 — all locked (2026-05-07).** See spec
§"Open questions — Locked (2026-05-07)" for the full table; key shifts
from earlier drafts: Q3 is "every intermediate, always" (no
checkpoint-only mode); Q6 is splits-as-sibling-pages (not config on
`ocr_crop`); Q7 introduces an `awaiting_review` job state for
`build_package`; Q1-followup, Q8, Q9, Q10 lock the dual-write
reconciliation contract, the bounded deferred-write executor, the
fail-loudly persistence semantics, and the device-aware in-memory
artifact model respectively.

**Memory-resident execution model.** The per-page stage DAG operates
on in-memory image objects during a run; disk I/O is reserved for
persistence (off the critical path via a bounded deferred-write
executor) and partial-rerun lazy loads. M2 runner must include a
refcount-driven in-memory cache + bounded deferred-write executor.
M3 workbench is purely a disk read — does not require a live
in-memory DAG run.

### Per-milestone delivery + UI smoke-test verification

Each milestone below ships with a "How to verify by running the app"
section so the user can `make run`, click X, observe Y, and conclude
that the milestone is or isn't real. The UI artifacts called out in
each subsection are the load-bearing signal — if they aren't present
or don't behave as described, the milestone is **not** done.

The smoke tests use a known-good test zip — name it here once the user
has identified one (e.g. `tests/fixtures/three-page-book.zip`). For
all milestones below, "the test zip" refers to that fixture.

---

#### M1 — Schema + DAG enumeration + reindex CLI (shipped)

Shipped 2026-05-07. Full delivery summary (per-sub-slice commits +
verified smoke-test) lives in `docs/08-roadmap-shipped.md`. Brief: 22
canonical stage IDs in `core.models.PAGE_STAGE_IDS`, normalised
`page_stages` table with composite PK + CHECK constraints, full
dual-write `commit_stage_artifact` + `reconcile_page` detector, the
`GET /api/data/projects/{id}/pages/{idx0}/stages` route with
concurrency-safe lazy-init, and `pgdp-prep reindex [--heal]`.

---

#### M2 — Per-page stage runner + dirty propagation + chip rail (in progress)

**Scope landed 2026-05-07 (Slices 1–5):**

- §E split columns on `PageRecord` (`parent_page_id`,
  `source_crop_bbox`, `split_index`, `split_at_stage`, `split_suffix`,
  `reading_order`) with all-or-none model validator (Slice 1).
- `STAGE_IMPL[stage_id][device]` registry in
  `core/pipeline/stage_registry.py` — every canonical stage_id has a
  `"cpu"` entry; three real implementations
  (`grayscale`/`threshold`/`invert`) extracted as wrappers over
  `pd_book_tools.image_processing.cv2_processing`. The other 19 stages
  are closure-bound placeholders raising `StageNotImplemented` (a
  typed RuntimeError sentinel deliberately distinct from
  `NotImplementedError`) so the runner can record a clear
  "not yet implemented in registry" message rather than claiming an
  engine bug. (Slices 6–8 grew the real-impl set to 7 — see below.)
  (Slice 2.)
- `core/pipeline/stage_runner.run_stage` — the engine that ties
  STAGE_IMPL + STAGE_DAG + commit_stage_artifact together. Validates
  dependencies, marks running, loads parents off disk, dispatches to
  the registry, dual-writes, then eager-cascades dirty to descendants
  currently `clean`/`failed`. Failures translate to `status=failed` +
  `error_message`; descendants are NOT cascaded (the previous output
  is still consistent). Compound-output stages raise the typed
  `StageOutputUnsupported` sentinel — clear breadcrumb for the
  multi-artifact-writer slice (Slice 3).
- `POST /api/data/projects/{id}/pages/{idx0}/stages/{stage_id}/run`
  route — synchronous execution path. Status code mapping: 200 clean
  PageStageState row; 404 unknown project/page/cross-user; 422
  unknown stage_id; 409 dependencies not met (body names the missing
  parents); 501 compound output (multi-artifact writer queued); 500
  on impl failure (row already marked `failed` so chip rail's next
  refetch shows it inline). No Job wrapping yet — the simple stages
  finish well within the request window (Slice 4).
- `<StageChainRail>` in the workbench between the processing-error
  banner and the ModeToolbar. 22 chips per page, color-coded by
  status (`not-run` slate, `running` sky-blue+pulse, `clean`
  emerald, `dirty` amber, `failed` rose, `not-applicable` slate-50
  italic). Click → POST /run; success toast + cache invalidate;
  error toast names the HTTP code. Polls every 2 s while any row is
  `running`. Tooltip surfaces last_run_at (ISO), stage_version,
  truncated input_hash, and error_message when present (Slice 5).

**Scope landed 2026-05-07 (Slices 6–8):**

- Real implementations for the chain root through `manual_deskew_pre`:
  `ingest_source`, `decode_source`, `initial_crop`, `manual_deskew_pre`.
  `ingest_source` reads per-page upload bytes via IStorage at
  `PageRecord.source_key` (runner gained optional `storage` /
  `page_source_key` kwargs; non-root stages ignore both). The other
  three are pass-throughs that match `process_page_cpu`'s no-config
  default branches — this carves them out of the monolith without
  needing ResolvedPageConfig plumbing yet (Slice 6).
- `GET /api/data/projects/{id}/pages/{idx0}/stages/{stage_id}/artifact`
  route — streams the bytes of a clean stage's on-disk artifact.
  Content-Type per `Stage.output_type` (image/png for image-typed
  stages; text/plain for text; application/json for json types).
  ETag echoes the row's `input_hash`; `If-None-Match` revalidation
  returns 304. Compound outputs stay 404 here until the multi-artifact
  writer ships. The workbench rail now renders a small "view" link
  beside each clean chip that opens the artifact in a new tab — the
  full artifact-viewer pane is M3 territory; this is the minimal
  "make it reachable" affordance (Slice 7).

**Scope landed 2026-05-09 (Slices 9–11):**

- Real implementations for the post-`invert` proofing chain through
  `canvas_map`: `find_content_edges` (wraps `find_edges`, returns a
  4-int bbox tuple serialised as JSON `output.json`),
  `crop_to_content` (two-parent: binary image + bbox JSON, runner
  dispatches mixed parent types), `auto_deskew` (wraps `auto_deskew
  (pct=0.30)`, handles both bare-ndarray and (ndarray, angle) return
  shapes), `morph_fill` (wraps `morph_fill`), `rescale` (re-invert +
  `rescale_image(target_short_side=1000)`), `canvas_map` (wraps
  `map_content_onto_scaled_canvas` with DEFAULT alignment and 1.294
  h/w ratio). The runner was extended with `_JSON_OUTPUT_TYPES` /
  `_IMAGE_OUTPUT_TYPES` constants and a parent-loader that branches on
  `Stage.output_type` so image parents decode via cv2 and bbox/JSON
  parents parse via `json.loads`. End-to-end chain test covers all 13
  stages from `ingest_source` → `canvas_map` with no manual SQLite
  seeding (Slices 9–11).

**Queued for M2 follow-up slices (or rolled into M3):**

- Multi-artifact writer: `ocr` (words.json + raw.txt),
  `extract_illustrations` (N crops),
  `text_review` (output.txt + attestation.json). Today
  `commit_stage_artifact` raises `StageArtifactWriteError` for these
  output_types and the runner translates that to
  `StageOutputUnsupported` → 501 in the route. Chip rail shows them as
  not-run; clicking yields a 501 toast.
- Real implementations for the remaining 6 placeholder stages
  (`thumbnail`, `blank_proof_synth`, `ocr_crop`, `auto_detect_attrs`,
  `auto_detect_illustrations`, `text_postprocess`). Each is a
  carve-out from sibling modules (`ingest.py`, `auto_detect.py`,
  `illustrations.py`, `crop_for_ocr.py`, `text_postprocess.py`) —
  landing them gradually while the monolithic path stays in service.
- Bounded deferred-write executor with `PGDP_STAGE_WRITE_POOL_SIZE` +
  `PGDP_STAGE_WRITE_QUEUE_CAP` knobs (canonical spec Q8). Dual-write
  reconciler is in place but writes go through synchronously today —
  the bounded queue lets a "Run all dirty stages" fan-out limit how
  many writes pile up at once.
- ResolvedPageConfig plumbing into the runner so config-aware stages
  (`initial_crop`'s actual `crop_edges` call, `manual_deskew_pre`'s
  `rotate_image`, `threshold`'s manual override) can read the page's
  resolved config. Today these stages all take their default
  (no-op / Otsu-auto) branches. M3 stage-controls panel needs this.
- LocalBackend / CpuBackend collapse to `pick_device()` shims onto
  the registry; old `/api/gpu/*` endpoints become route shims onto
  the new endpoint. Deferred to M5/M6 cleanup so today's pages keep
  working through the existing GPU backend until the registry is
  exhaustive.
- Optional ?async=true flag on the run route returning a Job id for
  slow stages (`ocr`, `extract_illustrations`). Not needed until those
  stages have real impls.

**Required test fixtures:** the test zip from M1.

**How to verify by running the app (UI smoke-test for what's
shipped today):**

1. `make run`. Open <http://127.0.0.1:8765>.
2. Create a project named "M2-smoke", upload the test zip.
3. Wait for ingest+thumbnails to finish.
4. Open any page in the workbench. The page now renders a "Stage
   chain (22)" rail above the canvas — 22 chips, one per
   `PAGE_STAGE_IDS`. On a fresh page every chip shows `not-run` (slate).
5. Click chips along the chain in order:
   `ingest_source` → `decode_source` → `initial_crop` →
   `manual_deskew_pre` → `grayscale` → `threshold` → `invert` →
   `find_content_edges` → `crop_to_content` → `auto_deskew` →
   `morph_fill` → `rescale` → `canvas_map`.
   Each click should transition `not-run → running → clean` with a
   green toast "stage `<id>` → clean". The on-disk artifacts appear at
   `~/pgdp-projects/projects/<project_id>/pages/0000/stages/<stage_id>/output.<ext>`
   (`.png` for image stages; `.json` for `find_content_edges`).
   No manual SQLite seeding required — the chain root reads source
   bytes from IStorage at the page's `source_key`.
6. After each chip turns green, a small "view" link appears next to
   it. Click it; the artifact opens in a new tab. For image stages
   the browser renders the PNG; for `find_content_edges` (JSON) the
   browser shows a raw JSON array `[minX, maxX, minY, maxY]`.
   The `canvas_map` artifact is the canonical proofing PNG — it should
   look like a binarised, deskewed, canvas-mapped version of the source.
7. Click `grayscale` again. The chip flickers running → clean; every
   descendant currently `clean` flips to `dirty` (amber). You should
   see `threshold` through `canvas_map` all go amber.
8. Click an out-of-order chip (e.g. `crop_to_content` when its parents
   aren't clean) — fails with a 409 toast naming the missing parents.
   Chip stays `not-run`.
9. Click any of the remaining 6 placeholder chips (e.g.
   `thumbnail`, `text_postprocess`). Two outcomes:
   - If the stage's parents aren't clean: 409 with "dependencies not
     clean" toast.
   - If parents are clean and the stage is single-output: 500 toast
     "no implementation registered for cpu yet"; chip turns rose
     (`failed`) with the placeholder text in its tooltip.
   - If the stage emits compound output (`ocr`,
     `extract_illustrations`, `text_review`): 501 toast with
     "compound output_type" message; chip stays `not-run`.

**Pass criterion (Slices 1–11):** starting from a fresh page, the user
clicks chips along the chain `ingest_source → canvas_map` in order
(13 chips), every chip transitions to clean visibly, and the
`canvas_map` "view" link opens the final proofing PNG in a new tab.
No SQLite manipulation; the entire flow is point-and-click in the
browser.

**UI artifacts that prove these slices shipped:** the chip rail
itself (visible immediately when opening any page); per-status color
coding (slate/sky/emerald/amber/rose/slate-50); the per-clean-chip
"view" link affordance; the success/error toast surface;
`data-status` attr on each chip for tests + future deep-linking;
`canvas_map` chip turns green and its "view" link opens the final
proofing PNG.

**Likely failure modes:**

- A chip transitions to `clean` but the on-disk file under
  `<project>/pages/<page_id>/stages/<stage_id>/output.<ext>` doesn't
  appear → dual-write reconciliation isn't actually happening (the
  DB row was committed without the file write). Catch by step 5.
- Clicking `ingest_source` 500s "requires `storage` + `page_source_key`"
  → the route handler isn't passing storage / page.source_key into
  `run_stage`. Catch by step 5 (very first chip).
- Running `grayscale` does not mark `threshold` dirty → the eager
  cascade is querying the wrong descendants set.
- "view" link shows a stale image after a re-run → ETag is being
  cached too aggressively; `If-None-Match` should match the row's
  current `input_hash`, not a previous one.

**Carry-forwards into M3 / next M2 slice:**

- The artifact viewer pane (side-by-side input/output for a selected
  chip) lands in M3.
- Real implementations for the remaining 6 placeholder stages
  (`thumbnail`, `blank_proof_synth`, `ocr_crop`, `auto_detect_attrs`,
  `auto_detect_illustrations`, `text_postprocess`) land incrementally
  as carve-outs from sibling modules.
- Bounded deferred-write executor (Q8) is the next infrastructure
  prerequisite for "Run all dirty stages on this page".

---

#### M3 — Workbench artifact viewer + stage controls panel

**Scope:**

- Pretty stage-chain rail (replaces M2's Database state debug
  panel). Status pills, per-stage thumbnails, click-to-select.
- Side-by-side artifact compare: `Stage: [▼]` and
  `Compare with: [▼]` selectors; the framework streams the two
  artifacts and lays them out at full image res.
- Stage-controls panel: when a stage is selected, the panel filters
  `ResolvedPageConfig` to only the fields that stage reads, plus
  Apply + Run buttons.
- SSE per-stage transitions update the rail live without a page
  reload.

**Required test fixtures:** the test zip from M1/M2.

**How to verify by running the app (UI smoke-test):**

1. `make run`. Open the M2-smoke project (or create a new "M3-smoke"
   project from the test zip).
2. Open page f001 in the workbench. The stage rail should now look
   visually polished — 22 chips with consistent status colours, each
   showing a small inline thumbnail of its output (when one exists).
3. Click on the `threshold` chip. The artifact viewer pane should
   load the threshold output image. The "Compare with" selector
   should auto-select `grayscale`. The two images should appear
   side-by-side at the same scale.
4. The stage-controls panel should now show only the threshold-
   relevant fields (e.g. `threshold_level: [Otsu auto / 140]` toggle
   plus a numeric input). Other fields like `fuzzy_pct` should not appear.
5. Change `threshold_level` from "Otsu auto" to `160`. Click "Apply +
   Run this stage". The chip should flicker through running → clean,
   the artifact viewer should swap to the new output, and downstream
   chips should turn `dirty` — all without a page reload.
6. Open a second browser tab on the same page. In tab 1, click "Run
   from `auto_deskew`". Tab 2 should observe the chip statuses
   updating live via SSE (no manual refresh).

**Pass criterion:** the workbench shows a real per-stage artifact
strip on a real page in a real browser, and changing one stage's
config produces a visible new artifact within ≤2 s.

**UI artifacts that prove M3 shipped:** polished stage-chain rail
with thumbnails; functional side-by-side artifact viewer; stage-
filtered controls panel; live SSE updates across tabs.

**Likely failure modes:**

- The artifact viewer shows a stale image after a stage rerun → the
  artifact endpoint is caching too aggressively or the URL didn't
  change (it should include the row's `last_run_at` as a cache
  buster).
- The stage-controls panel shows every config field regardless of
  selected stage → the field-to-stage map on the frontend is empty
  / wrong.

---

#### M4 — Migration of existing projects + disk-cost UI

**Scope:**

- Lazy-migrate on first access: synthesise `page_stages` rows from
  legacy `processing_status` (canonical spec §Migration story).
  Mark every applicable stage `dirty` (the legacy artifacts aren't
  in the new tree).
- `pgdp-prep migrate-projects --force-rebuild` CLI for users who
  want the opt-in force-rebuild path.
- Disk-cost callout in the project header banner: "Stage artifacts
  for this project: 12.4 GB / ~16 GB estimated full-DAG. Reclaim
  space?" with a click-through to a future `--prune-stage-artifacts`
  flow (UI placeholder; actual prune lands later).

**Required test fixtures:** a pre-existing project from before
M1–M3. If none exists, the user should run M0 (the current main)
end-to-end on a real book first, then switch branches to M4 and
verify migration.

**How to verify by running the app (UI smoke-test):**

1. Before switching branches: `make run` on the pre-M1 codebase.
   Create a project "M4-pre-migrate", upload the test zip, run the
   batch pipeline through to "complete" status. Quit.
2. Switch to the M4 branch: `make run`. Open the same project.
3. The page list should still load; pages should still be navigable.
4. Open a page in the workbench. The stage chain rail should show
   every applicable stage as `dirty` (yellow) — not `clean`, not
   `not-run`. The page's `processing_status` rolled-up view should
   read "needs reprocessing" or similar.
5. The project header banner should show the disk-cost estimate and
   a "Reclaim space" button (placeholder; it should at minimum link
   to a help page or open a "coming soon" dialog).
6. Click "Run all dirty stages on this page". All chips should
   transition to `clean` and the per-stage artifacts should appear
   under `pages/<page_id>/stages/`.
7. From a fresh terminal:
   `pgdp-prep migrate-projects --force-rebuild <project_id>`. The CLI
   should clear all `page_stages` rows for that project and all
   on-disk stage artifacts under `pages/<page_id>/stages/`,
   leaving source images and thumbnails untouched.

**Pass criterion:** opening a pre-M1 project produces a sensible
"every stage is dirty" view, and the user can recover full state by
running dirty.

**UI artifacts that prove M4 shipped:** project banner with
disk-cost estimate; the page list still works for old projects; the
stage rail correctly shows old projects as `dirty`.

**Likely failure modes:**

- The page list crashes because the migration didn't synthesise rows
  for some pages (e.g. ones with `processing_status='error'`).
- The disk-cost banner shows 0 GB or NaN — the estimator is reading
  the wrong directory.

---

#### M5 — Project-level orchestration fan-out + `awaiting_review` gate

**Scope:**

- `JobType.project_run_stage_all_pages` and `project_run_dirty`
  (canonical spec §API surface > Project-level stage routes) that
  dispatch per-page stage tasks under the hood.
- Existing `batch_process_pages` etc. job rows continue to run via
  a compatibility shim that translates them to the new model.
- `awaiting_review` job state implementation (canonical spec Q7):
  `POST /api/projects/{id}/build-package` parks the job when any
  proof-range page is unreviewed; project banner + Open Tasks bell
  update; auto-resume on last attestation.
- The full-power `STAGE_IMPL` cutover: every existing call site
  routes through the registry. Old `LocalBackend.process_page` etc.
  methods become 1-line shims onto registry calls.

**Required test fixtures:** the test zip with at least 3 pages.

**How to verify by running the app (UI smoke-test):**

1. `make run`. Create "M5-smoke", upload the test zip.
2. Run ingest + thumbnails. Open the JobsPage.
3. Click "Run all dirty stages across project". Observe a new
   project-level job row of type `project.run_dirty` with a progress
   bar, plus per-page child stage jobs flowing underneath. The
   progress bar should tick from 0 to N as pages complete.
4. After the project run completes, click "Build package" in the
   PackagePage.
5. Because no pages have been reviewed yet, the job should land in
   the `awaiting_review` state. The project banner should appear:
   "3 pages awaiting review before package can build" with a
   "Review next page" button. The Open Tasks bell should show "3"
   in the top-right.
6. Click "Review next page". The workbench should open on page
   f001. Click "Mark page reviewed". The banner count should drop
   to "2" and the bell badge to "2".
7. Continue marking pages reviewed. After the last attestation, the
   `awaiting_review` job should auto-resume to `running`, then
   `complete`. The package should be downloadable.
8. To verify the deprecation shim: from a terminal,
   `curl -X POST http://127.0.0.1:8765/api/gpu/jobs -d
   '{"job_type": "batch_process_pages", "project_id": "..."}'`.
   Observe a job row that completes successfully (the shim
   translates it).

**Pass criterion:** the user can kick off a project-level fan-out
and watch its progress; `build_package` correctly parks on the
text-review gate and auto-resumes; the legacy job-type shims still
work.

**UI artifacts that prove M5 shipped:** project banner with
unreviewed-count countdown; Open Tasks bell with live badge; project-
level progress bar in JobsPage that ticks per-page; auto-resume of
parked `build_package` job.

**Likely failure modes:**

- Marking the last page reviewed doesn't auto-resume the job → the
  runner isn't re-checking the gate on `text_review.clean` writes.
- The progress bar shows raw stage counts (e.g. "page 1 stage 3 of
  16") instead of pages-complete; that's noise — should aggregate to
  per-page granularity.

---

#### M6 — Cleanup

**Scope:**

- Remove the deprecated `JobType.batch_*` values.
- Remove the legacy endpoints (`/api/gpu/process-page`,
  `/api/gpu/run-ocr-page`, the `batch_*` paths on `/api/gpu/jobs`).
- Delete `LocalBackend` and `CpuBackend` classes; the registry +
  `pick_device()` helper become the only path.
- Delete `process_page_cpu`'s monolithic body (now an imperative
  composition of registry calls in a project-level "run everything
  CPU" helper).
- Remove the M2-era debug panel from the workbench (M3 replaced it,
  but M3 may have left the legacy code path; M6 removes any dead UI).

**Required test fixtures:** the M5 verified end-to-end project.

**How to verify by running the app (UI smoke-test):**

1. `grep -r "JobType.batch_" src/` — should return **empty**.
2. `grep -r "class LocalBackend" src/` — should return **empty**.
3. `grep -r "process_page_cpu" src/` — should return **empty**.
4. `make run`. Open the existing M5 project. Every workbench
   affordance, project banner, JobsPage interaction should still
   work end-to-end exactly as in M5.
5. Verify a fresh project: create "M6-fresh", upload the test zip,
   run all dirty stages, mark every page reviewed, build package.
   The full flow should complete with the package downloadable.
6. Verify the legacy endpoints are gone:
   `curl -X POST http://127.0.0.1:8765/api/gpu/process-page` should
   return 404 (the route no longer exists).

**Pass criterion:** the codebase has no references to the deprecated
names; the user-visible workflow still works; legacy endpoints
correctly 404.

**UI artifacts that prove M6 shipped:** none new — M6 is a deletion
milestone. The signal is "everything from M5 still works _and_ the
codebase is smaller."

**Likely failure modes:**

- Removing `LocalBackend` breaks a route handler that imports it
  directly without going through the registry → caught by the
  workbench failing on step 4.
- Removing `process_page_cpu` breaks the legacy `batch_process_pages`
  shim (the shim should be gone too in M6, but some callers may have
  been missed).

---

**Acceptance for the whole sequence:** opening any page in the
workbench shows a stage chain with intermediate artifact images for
every stage. Re-running `threshold` on a page marks `invert` through
`text_review` dirty; `build_package` parks in `awaiting_review`
until `page.run_dirty(idx0)` brings the page back to clean and the
user attests `text_review`. Project-level fan-out works end-to-end
with the new job types; legacy `batch_*` job types are gone.

---

## P1 — UX completeness

### 9a-followup. Word-delete editor — undo/soft-delete schema decision

§9 (Vitest + msw) and §9a (word-delete editor: backend, frontend v1,
marquee bulk-select, a11y polish, generated-types swap) all shipped —
see `08-roadmap-shipped.md`. One follow-up remains and is **blocked on
a user schema decision**:

- **Undo / soft-delete strategy.** The v1 endpoint hard-rewrites
  `<root>.words.json` + `<root>.txt`, so honest single-level undo
  needs either (a) a server-side `OcrWord.deleted: bool` flag with a
  flip-restore endpoint and `remaining_words` filtered to non-deleted
  rows, or (b) a client-side debounced commit window (e.g. five-second
  Undo banner that only fires the DELETE after dismissal). Either
  layers cleanly onto the existing wire contract — `remaining_words`
  already lets the client be agnostic about server strategy.

A second follow-up — a five-minute manual marquee runtime smoke-test
in `make frontend-dev` to exercise the Konva pointer-capture preview
rect — is tracked in agent memory and shipped in any tick that already
has a dev server running; not appropriate for an overnight loop.

---

## P2 — Frontend polish

### 10. Konva Transformer rotate + flip

Currently `rotateEnabled=false`, `flipEnabled=false`. Spec 06 doesn't ask
for them, but proofers occasionally need to fix scanner-frame skew that
falls outside the auto-deskew range; expose rotate handles for the rare case.

### 13. Search across pages

For very large books (>500 pages), let the user search the OCR text. Needs
a `pages.ocr_text` index column or full-text search. SQLite FTS5 is fine
for local; Postgres has built-in TS.

### 13a. Adopt shadcn/ui + Radix and close the spec/code divergence

`specs/00-overview.md:57,126` and `specs/03-ui-layout.md:5,404` name
shadcn/ui (Radix-backed) as the intended component library.
**All major library swaps shipped** (see `08-roadmap-shipped.md` §13a
steps 1, 1b, 2, 3): Radix Dialog + AlertDialog wrappers retired the
hand-rolled ProjectListPage modal + delete confirm; `sonner` +
`<Toaster>` retired the inline red error bodies; `vite-tsconfig-paths`
gave us `@/*` aliases for the deepening tree; `react-hotkeys-hook`
folded the raw `window.addEventListener("keydown", ...)` in
TextReviewPage into a hook with built-in form-tag scoping.

Remaining open work (opportunistic, pick whichever pairs with the
next slice that touches its surface):

1. **More Radix primitives** for `Tabs`, `Select`, `Popover`,
   `Tooltip`. The `Dialog` and `AlertDialog` primitives in
   `components/ui/` are the template — install the relevant
   `@radix-ui/react-*`, write a thin wrapper, swap in callers. No
   active surface forces the swap yet; pick when one comes up.

---

## P3 — Pipeline depth

### 14. CUDA path (image-processing fast path) — superseded by §P0.5

**Status (2026-05-07):** **superseded by §P0.5 M5+.** The class-level
"`LocalBackend` adds CUDA primitives" framing is gone — under the new
task model, CUDA primitives land as `STAGE_IMPL[stage_id]['cuda']`
entries in the registry, registered alongside the CPU entries. M2
ships `"cpu"` entries for every stage; M5+ adds `"cuda"` entries for
the proofing-chain stages (`grayscale`, `threshold`,
`find_content_edges`, `auto_deskew`, `morph_fill`, `rescale`,
`canvas_map`) backed by `pd_book_tools.image_processing.cupy_processing`
plus nvImageCodec for source decode. Behind a `[cuda]` extra so the
wheel install stays slim.

This is **not** a separate roadmap item; track it as a slice
inside M5 once the registry is the only call path. End users with a
GPU already get GPU-accelerated OCR today (DocTR/PyTorch auto-pick
`cuda:0`); only the Step-4 image processing is still CPU-bound on a
CUDA host.

### 15. Shared GPU container backend

`SharedContainerBackend` is a placeholder. Implementation: an HTTP client
pointing at a long-running `pgdp-prep --mode gpu_worker_only` ECS task with
per-tenant authentication. Spec 09 §"Backend 2".

### 16. Thumbnail nvjpeg / DALI GPU path (future)

**Status (2026-05-07):** **deferred.** Step 2 thumbnail generation is
CPU-bound JPEG decode + resize + encode. The current shipped approach
parallelises across cores via `concurrent.futures.ProcessPoolExecutor`
(default `max_workers=os.cpu_count()`, override `PGDP_THUMBNAIL_WORKERS`,
1 disables); see `_make_thumbnail_bytes` and the pool wiring in
`core/ingest.generate_thumbnails`. That is the right default — the
work is trivially data-parallel and each worker stays in its own cv2
process, so there is no shared-state contention.

A GPU fast path (NVIDIA **nvjpeg** for decode/encode, optionally
**DALI** for the resize pipeline) is _not_ a free win on the
thumbnail workload. nvjpeg shines when many images stay resident on
the GPU for downstream work; here each thumbnail is a one-shot
decode → resize → encode → return-to-host. The per-image PCIe
round-trip (host→device for source bytes, device→host for the
encoded JPEG) typically washes the kernel speedup unless the batch
is large enough to amortise it via streams, and even then the
encode is the bottleneck and `nvjpegEncoder` is finicky about
chroma subsampling and quality knobs matching cv2 output.

Revisit only if profiling on a real book (≥500 pages, GPU host)
shows the CPU pool path becoming the dominant Step-2 cost _after_
storage I/O. Implementation sketch when picked up: a
`thumbnails_backend = "cpu" | "nvjpeg"` adapter selector that lives
alongside `GpuBackend`; nvjpeg path gated behind a `[cuda]` extra
the same way Step 4's CUDA primitives are (#14).

### 17. Spec question: `compute_prefix` first-frontmatter-page numbering

Logged in iteration 1. The spec's loop `range(start, min(idx0, end+1))` is
empty when `idx0 == start`, so the first frontmatter page resolves to
`f000` instead of `f001` despite `frontmatter_page_nbr_start=1`.
Implementation matches the spec verbatim — `test_compute_prefix_basic_numbering`
asserts the current `f000` behavior, so this is **not a latent bug**: any
change to `f001` would be an _intentional_ rewrite of the spec, and the
asserting test would need to be updated in the same change.

This entry tracks an open spec question, not a fix-on-sight bug. The
decision is whether (a) the field name `frontmatter_page_nbr_start=1`
should imply `f001` and the spec loop is wrong, or (b) the `f000`-from-1
behavior is intentional zero-based numbering and the field name / docs
should be clarified. A user decision unblocks the change; either path is
a one-line code (or spec) edit plus a deliberate test update.

---

## P5 — Stretch

### 23. PDF export

PGDP packages don't need PDFs, but some users want them as a sanity-check
artefact alongside the zip.

### 24. Multi-user permissions

Spec 00 §"stretch goal" says the architecture doesn't block multi-user.
Today every route filters by `user.user_id`. Needs an "owner_id" filter on
the page tagger that respects the JWT identity, plus per-project sharing.

### 25. Internationalisation

The UI is English-only. The OCR pipeline is language-agnostic via DocTR;
the SPA strings would need an i18n layer (react-intl or similar).

---

## Deferred — remote / cloud mode (revisit after local is fully shipped)

The following items were originally tracked as P0 but are all
prerequisites for the cloud / multi-tenant deployment shape, not the
local solo / self-hosted-team flow. They are parked here intentionally
until the local-mode user experience is end-to-end coherent — picking
them up early forces design tradeoffs around adapters that the local
shape doesn't actually exercise.

### D1. Modal app S3 wiring (was P0 #1)

**File:** `src/pd_prep_for_pgdp/adapters/gpu/modal_app.py`

`process_page` / `run_ocr` / `run_batch` raise NotImplementedError.
Needs S3 storage config wiring, source-bytes read inside the Modal
function, a call into `core.pipeline.process_page_cpu` (or the future
CUDA variant), output write-back, and a spec-04 `ProcessPageResponse`
return shape. `ModalBackend` (dispatcher side) is fully tested via the
fake-module trick; the blocker is **Modal-side** function bodies + a
real account for end-to-end tests.

**Acceptance:** `modal deploy adapters/gpu/modal_app.py`, then a real
`process-page` request through `ModalBackend` writes a PNG to S3.

### D2. Postgres adapter — live-DB integration tests (was P0 #2)

**File:** `src/pd_prep_for_pgdp/adapters/database/postgres.py` —
scaffold shipped (commit `77072c6`, mirrors `SqliteDatabase` exactly:
JSON/JSONB-per-record, `pages` keyed on `(project_id, idx0)`, `jobs`
indexed on `(owner_id, created_at DESC)`; raw async psycopg, no ORM).
`tests/test_postgres_adapter.py` covers URL validation, the
`put_pages([])` no-op contract, and the bootstrap-friendly error when
the `[postgres]` extra is absent — all class-direct tests
`importorskip` psycopg cleanly.

**Still open (when revived):**

1. Wire a Postgres service into the dev container (or a CI service) so
   the existing direct-class tests stop skipping.
2. Add a parametrised `db` fixture factory yielding `SqliteDatabase`
   **or** `PostgresDatabase` (skip-postgres when the service is
   unavailable), then run existing `test_assign_prefixes.py`,
   `test_job_runner.py`, `test_project_archive.py`, etc. over both.
3. Decide bootstrap default: empty `database_url` currently falls back
   to SQLite. Managed-mode container should require an explicit
   `postgres://` URL — surface a clearer error when neither is set.

The scaffold is preserved on `main`; nothing to revert when this is
revived.

### D3. install.sh end-to-end exercise (was P0 #3)

`install.sh` / `install.ps1` / `Makefile.install` are authored but the
curl-pipe-sh path has never been exercised in a clean shell with
internet. Needs ~10 min to confirm
`uv tool install git+...@<tag>[cuda] --extra-index-url ...` resolves
and the resulting `pgdp-prep` command works. Note: the long-term
release strategy is a self-hosted PEP 503 index
(`ConcaveTrillion/pd-index`); install.sh has the same latent
wheel-METADATA bug pre-fixed in pd-ocr-cli — see agent memory
`release_strategy_self_hosted_index.md` before touching this.

### D4. CI container push (was P0 #4)

`.github/workflows/release.yml` builds the managed-mode container on
tag push but doesn't push to a registry. User must wire ECR (or GHCR)
credentials.

---

## How to pick up

1. Read `docs/01-overview.md` (this directory) for the high-level shape.
2. Read the relevant spec for whatever layer you're touching.
3. Pick the lowest-numbered open item in this file (P0 first); shipped
   items live in `08-roadmap-shipped.md` for context. **Skip the
   "Deferred — remote / cloud mode" section** unless the user
   explicitly revives it — local mode is the priority.
4. TDD-first when possible; the test recipe is in `docs/07-testing.md`.
5. When you finish an item, **move it out** of this file into
   `08-roadmap-shipped.md` with a condensed summary + commit SHAs.
   Don't leave shipped items in this file with a "done" flag.
