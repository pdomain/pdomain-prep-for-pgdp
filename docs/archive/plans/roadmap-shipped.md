# 08 — Roadmap (shipped items)

Items moved out of `08-roadmap.md` once delivered. Keeps the active roadmap
focused on open work; preserves a terse trail of what landed and where for
future archaeology.

Format per entry: heading (mirrors the active-roadmap §-numbering),
one-paragraph summary, the commit SHAs that delivered it, and brief
"what got built" notes. Full design rationale lives in git history; do
not re-paste roadmap prose here.

---

## §P0.5 M1 — Schema + DAG enumeration + reindex CLI (2026-05-07)

Foundation milestone for the per-page stage DAG refactor (canonical
spec `docs/specs/pipeline-task-model.md`). Lands the schema, the DAG
table, the dual-write writer, the read-only API surface, and the
reindex CLI — but no runner and no UI changes. M2 picks up the actual
per-stage execution.

**Sub-slices and commits:**

- §A SQLite `page_stages` table + indexes + CRUD — commit `128ead9`.
  Composite PK `(project_id, page_id, stage_id)`, indexes on
  `(project_id, status)` and `(project_id, page_id)`, CHECK clauses
  pinning status to the `PageStageStatus` enum and `stage_id` to the
  22 canonical entries from `core.models.PAGE_STAGE_IDS`.
  `delete_project` cascades. Five CRUD methods on `SqliteDatabase`.
- §B 22-stage DAG enumeration + dirty-descendants helper —
  commit `2341fa1`. `core/pipeline/stage_dag.py` with frozen `Stage`
  rows, `STAGE_DAG` tuple, `topological_order()`, `get_stage()`, and
  `compute_dirty_descendants()`. Two stages have multi-parent edges:
  `crop_to_content` (parents: `invert`, `find_content_edges`) and
  `ocr_crop` (parents: `canvas_map`, `blank_proof_synth`).
- §C `GET /api/data/projects/{id}/pages/{idx0}/stages` route +
  `commit_stage_artifact` + `reconcile_page` — commit `50105af`.
  Lazy-init via `INSERT OR IGNORE` is concurrency-safe (parallel
  first-touch converges to exactly 22 rows). Writer follows the
  spec's dual-write contract (write tmp → fsync → atomic rename → DB
  upsert) with full rollback on any failure (Q9 fail-loudly).
  Single-file output extension mapping covers 14 simple stage outputs;
  compound-output stages (`ocr`, `extract_illustrations`, `text_review`)
  raise an explicit "use a sibling writer" error so M2 catches the
  not-yet-implemented path early.
- §D `pgdp-prep reindex [--heal]` CLI — commit `e7f391d`. Read-only
  scan exits 0 clean, 2 on drift. `--heal` quarantines orphan files
  to `<project>/.orphan-stage-artifacts/<relpath>` with a manifest,
  marks DB rows for missing files `failed` (cascading downstream
  `clean` rows to `dirty` via `compute_dirty_descendants`), and marks
  hash-mismatch rows `dirty` while leaving the on-disk file untouched.
  Subcommand dispatch lives in `__main__.py` without breaking bare
  flag invocations.
- §F doc realign — commit `86fb693` (16→22 stage-count drift fix
  across roadmap + specs) and the doc-realign commit closing M1.

**Note on route path:** the spec's `GET /api/pages/{page_id}/stages`
shorthand was implemented as `GET /api/data/projects/{id}/pages/{idx0}/stages`
because `page_id` alone is not unique across projects (only the
`(project_id, idx0)` pair is). This matches the existing
`/api/data/projects/{id}/pages/{idx0}` convention used by every other
page-scoped route and keeps auth filtering uniform.

**Carried forward to a later slice:**

- §E split-related columns on `pages` (`parent_page_id`,
  `source_crop_bbox`, `split_index`, `split_at_stage`, `split_suffix`,
  `reading_order`) — not load-bearing for §C/§D since no splits exist
  yet. Should land before M2 starts running stages that emit splits.

**Verified smoke-test (2026-05-07).** Replicable end-to-end:

1. `make run` → app comes up at `http://127.0.0.1:8765`.
2. Seed a project named `M1-smoke` (the three-page fixture lives at
   `tests/fixtures/three_page_book.py`:
   `uv run python -c "from tests.fixtures.three_page_book import
   build_three_page_book_zip; from pathlib import Path;
   build_three_page_book_zip(Path('/tmp/m1.zip'))"`).
3. `curl -s http://127.0.0.1:8765/api/data/projects/M1-smoke/pages/0/stages | jq 'length'`
   returns `22`. The 22 stage IDs returned are, in topological order:
   `ingest_source, thumbnail, auto_detect_attrs,
   auto_detect_illustrations, decode_source, blank_proof_synth,
   extract_illustrations, initial_crop, manual_deskew_pre, grayscale,
   threshold, invert, find_content_edges, crop_to_content,
   auto_deskew, morph_fill, rescale, canvas_map, ocr_crop, ocr,
   text_postprocess, text_review`. Every row has
   `status="not-run"`, `stage_version=1`, `artifact_key=null`.
4. `sqlite3 ~/pgdp-projects/state.db ".schema page_stages"` shows the
   composite-PK schema with indexes `page_stages_proj_status` and
   `page_stages_proj_page` and CHECK constraints on status + stage_id.
5. `pgdp-prep reindex` with no drift prints
   `reindex: scanned N page(s); 0 orphan files, 0 missing artifacts,
   0 hash mismatches` and exits 0.
6. `rm -rf ~/pgdp-projects/projects/M1-smoke/pages/0000/stages/` →
   `pgdp-prep reindex` exits 2 with one missing-artifacts entry; then
   `pgdp-prep reindex --heal` exits 0 and prints
   `reindex --heal: scanned 1 page(s); 0 orphan(s) quarantined,
   N row(s) marked failed, ...`. Re-running `pgdp-prep reindex`
   prints "0 orphan files, 0 missing artifacts, 0 hash mismatches"
   and exits 0.

**Caveat surfaced.** The M1 smoke-test exercises only the API + CLI
surface — there is no UI yet. Creating a project from the test zip
via the SPA requires the existing ingest/thumbnails jobs to finish
first; for the API-level verification (steps 3–6) seeding the DB
directly with a `Project` and a `PageRecord` is sufficient because
the M1 surface doesn't depend on ingest having actually run.

---

## §P0.5 M2 — Per-page stage runner + dirty propagation + chip rail (2026-05-07 – 2026-05-09)

Per-page stage execution engine + dirty propagation + workbench chip
rail UI shipped across Slices 1–14. M2 follow-ups (#80, #81, #82,
chip-rail run wiring) closed 2026-05-15 — see the dedicated
"M2 follow-ups" entry below.

**Sub-slices delivered:**

- Slice 1 — §E split columns on `PageRecord`
  (`parent_page_id`, `source_crop_bbox`, `split_index`,
  `split_at_stage`, `split_suffix`, `reading_order`) with
  all-or-none model validator.
- Slice 2 — `STAGE_IMPL[stage_id][device]` registry in
  `core/pipeline/stage_registry.py`. 3 real implementations
  (`grayscale`/`threshold`/`invert`) wrapping
  `pd_book_tools.image_processing.cv2_processing`; remaining 19
  stages closure-bound placeholders raising `StageNotImplemented`.
- Slice 3 — `core/pipeline/stage_runner.run_stage` engine. Validates
  dependencies, marks running, loads parents off disk, dispatches to
  the registry, dual-writes, eager-cascades dirty to descendants.
  `StageOutputUnsupported` typed sentinel for compound-output stages.
- Slice 4 — `POST /api/data/projects/{id}/pages/{idx0}/stages/{stage_id}/run`
  synchronous execution route. Status mapping: 200 / 404 / 422 / 409
  / 501 / 500. No Job wrapping (simple stages finish within request
  window).
- Slice 5 — `<StageChainRail>` in the workbench. 22 chips per page,
  colour-coded by status, click → POST /run, polls every 2 s while
  any row is `running`, tooltip surfaces `last_run_at`,
  `stage_version`, truncated `input_hash`, `error_message`.
- Slices 6–8 — Real CPU impls for `ingest_source`, `decode_source`,
  `initial_crop`, `manual_deskew_pre`. `ingest_source` reads per-page
  upload bytes via IStorage at `PageRecord.source_key`.
  `GET .../stages/{stage_id}/artifact` route streams bytes with
  ETag/`If-None-Match` 304 revalidation. Workbench renders a "view"
  link beside each clean chip.
- Slices 9–11 — Real CPU impls for `find_content_edges`,
  `crop_to_content`, `auto_deskew`, `morph_fill`, `rescale`,
  `canvas_map`. Runner extended with `_JSON_OUTPUT_TYPES` /
  `_IMAGE_OUTPUT_TYPES` constants + parent-loader that branches on
  `Stage.output_type`. End-to-end chain test covers
  `ingest_source` → `canvas_map` (13 stages) with no manual SQLite
  seeding.
- Slice 13 — Real CPU impls for `thumbnail`,
  `auto_detect_illustrations`, `ocr_crop`, `text_postprocess`.
  Runner extended with compound-output parent handling and
  `any_parent_ok` dispatch.
- Slice 14 — `commit_stage_artifacts_multi` multi-file atomic
  writer; `_ocr_cpu` (writes `words.json` + `raw.txt`) and
  `_text_review_cpu` (identity pass) CPU impls. 21 of 22 stages
  have real CPU impls (`extract_illustrations` deferred to M3).

**Verified end-to-end:** starting from a fresh page, the user can
click chips along the chain `ingest_source → canvas_map` in order,
every chip transitions clean visibly, and `canvas_map`'s "view"
link opens the final proofing PNG in a new tab.

**Git audit trail:** `git log -- src/pd_prep_for_pgdp/core/pipeline/
src/pd_prep_for_pgdp/api/data/pages.py
frontend/src/components/StageChainRail.tsx` 2026-05-07 → 2026-05-09.

---

## §P0.5 M6 — Cleanup / deletion milestone (2026-05-15)

M6 was a pure deletion milestone — no new UI, no new behavior. The
signal is "everything from M5 still works _and_ the codebase is
smaller."

**What got deleted:**

- `JobType.batch_process_pages` / `batch_ocr` /
  `batch_text_postprocess` / `batch_extract_illustrations` /
  `batch_extract_illustrations_for_page` enum values.
- `LocalBackend` class. `CpuBackend` class.
- `process_page_cpu` monolith.
- Legacy `/api/gpu/process-page`, `/api/gpu/run-ocr-page`, and the
  `batch_*` `JobType` paths on `/api/gpu/jobs`. `POST /api/gpu/jobs`
  now returns 405 for the deleted job types.
- `legacy_shim` module.

**What replaced it:**

- `STAGE_IMPL` registry + `pick_device()` is the only execution
  path (AD-7).
- Bootstrap uses a `_NoOpGPUBackend` stub.
- `words_key_for` / `load_words_from_storage` moved to
  `core/pipeline/base.py`.

**Carry-forward:** the `RunPipelinePanel` in
`frontend/src/pages/ProjectConfigurePage.tsx` was NOT updated to
match — its 5-row UI still submits to the deleted `POST /api/gpu/jobs`
with the deleted `JobType.batch_*` values. Tracked as **P0.1** in
the active roadmap.

---

## §13a step 1 — Radix Dialog adoption (ProjectListPage modal)

First shadcn/ui adoption slice. Adds `@radix-ui/react-dialog` and a thin
`frontend/src/components/ui/Dialog.tsx` wrapper exporting
`Dialog` / `DialogContent` / `DialogTitle`. The `ProjectListPage`
create-project modal — previously a hand-rolled `<div>` overlay with
manual `useEffect` for scroll-lock, a manual `keydown` listener for
Escape, a manual focusable-query-selector for initial focus, and an
`onClick` stopPropagation pattern for click-outside — collapses to
`<Dialog open onOpenChange><DialogContent><DialogTitle>…</DialogTitle>…`.
Radix owns focus-trap, Escape-to-close, body scroll-lock (via
`react-remove-scroll-bar`'s `data-scroll-locked` attribute + injected
stylesheet), and overlay-click dismissal.

The cba526e a11y test contract is preserved in spirit: the dialog is
discoverable by `role="dialog"` with the DialogTitle wired as
accessible name (Radix auto-`aria-labelledby` from internal context),
modality enforced by focus-trap (Radix v1.1+ deliberately omits
`aria-modal="true"` because the focus trap satisfies the WAI-ARIA
modal pattern), Escape closes, initial focus lands on the first
focusable, scroll is locked while open. Test assertions updated for
the new mechanism (`data-scroll-locked` attribute instead of inline
`body.style.overflow`).

Wrapper API note: `DialogContent` does NOT forward `aria-labelledby` /
`aria-describedby` from caller props — Radix's internal `...contentProps`
spread would override the auto-wired values with `undefined` if the
caller didn't pass one, breaking accessible-name lookup. The wrapper
sets `aria-describedby={undefined}` once internally to silence Radix's
dev-mode "missing description" warning; future callers that want a
description add a `<DialogDescription>` child and Radix wires it
automatically through the same context.

Remaining §13a items (react-hotkeys-hook, vite-tsconfig-paths,
AlertDialog/Tabs/Select/Popover/Tooltip primitives) are still open in
the active roadmap.

- `0b6d30e` feat(frontend): swap ProjectListPage modal to Radix Dialog (§13a step 1)

---

## §13a step 2 — sonner toast surface

Adds `sonner` and mounts one `<Toaster position="top-right" richColors closeButton />`
at the app root in `main.tsx` — sibling of `<BrowserRouter>` inside the
`QueryClientProvider`. Replaces the inline `<span role="alert">` body
of `FormErrorBanner` with a side-effect-only component: when `error`
becomes a real Error, fires `toast.error("${prefix}: ${error.message}")`
once per distinct Error reference (a `useRef<Error | null>` guards
against React strict-mode double-render and benign re-renders from
sibling state). Component returns `null` — toast is the only UX
surface now.

Three TextReviewPage call sites (save / re-OCR / delete-words) needed
no caller-side change because the §13a step 1.5 stepping stone
(`66e6f73`) had already routed them through `<FormErrorBanner>`.

The ProjectListPage create-modal `step.kind === "error"` branch is
gone. The `Step` union shrank to `form | uploading`; on mutation
error, `onError` resets to `{ kind: "form" }` so the user can correct
and retry, and a `<FormErrorBanner prefix="create project failed">`
mounted in the modal fires the toast.

Test contract update: `FormErrorBanner.test.tsx` no longer asserts an
inline `role="alert"` span — sonner renders into a portal that's
brittle in jsdom. Tests `vi.mock("sonner")`, render the component,
and assert `toast.error` was called with the expected text. Six
tests cover null/undefined → no toast, Error → toast, dedupe on
same-ref re-render, fresh toast on new Error instance, and the
"renders nothing" invariant.

---

## §26 — Frontend ESLint + Prettier pre-commit hooks

ESLint flat config (`frontend/eslint.config.js`) + Prettier
(`.prettierrc.json`, `.prettierignore`) live in `frontend/`. Pinned to
`eslint@^9` + `eslint-plugin-react-hooks@^5` (the v10 / hooks-7 stack
flagged valid React Query initial-data sync as
`set-state-in-effect`; out of scope for the toolchain commit). Plugin
set: `@eslint/js` recommended, `typescript-eslint` recommended,
`react-hooks`, `react-refresh`, `eslint-config-prettier` last. Generated
`src/api/types.gen.ts` excluded from both lint and format. `npm run
lint` 0-errors / 13 `no-explicit-any` warnings (intentional, at Konva /
msw / fetch-JSON adapter seams). Prettier defaults match in-tree style;
24 files normalised in a separate format-only commit.

Pre-commit hooks `frontend-eslint` + `frontend-prettier` parallel the
existing `frontend-tsc` hook, share its mise-shim activation prelude,
and use the same `language: system` style. Make targets:
`frontend-lint`, `frontend-format`, `frontend-format-check`. `make ci`
chains `frontend-lint frontend-format-check` between `test` and
`frontend-test`. GHA `build-frontend` job runs `npm run lint` +
`npm run format:check` between `npm install` and `npm test`.

- `7f804ac` feat(frontend): ESLint flat config + Prettier toolchain (P4 #26 step 1)
- `e1be5b5` style(frontend): apply Prettier --write across the SPA (P4 #26 step 1)
- (this commit) chore(hooks/ci): wire frontend-eslint + frontend-prettier into pre-commit, Make, GHA

## §5 — Per-page batch_process_pages progress

Backend SSE streams `current_page=idx0` per item; SPA surfaces it in four
places (`JobProgressInline`, `PageGrid` active-tile ring, `PageWorkbenchPage`
"Processing…" badge via `useJobProgress`, `ProjectReviewQueuePage` via
`useActiveBatchJob`) plus shared `frontend/src/lib/jobStatus.ts` constants
across `RunPipelinePanel`, the ingest banner, and the `JobsPage` "live: N"
pill.

- `490c1cb` feat(jobs): per-item progress streaming for batch_process_pages
- Roadmap close-out: `689beb0`

## §6 — OcrWord bbox highlight on TextReviewPage

`wordOffsets.ts` (offset↔word index), `<root>.words.json` sibling
persistence with `words[]` on the text GET, and `WordBboxOverlay` Konva
component for bidirectional textarea↔bbox selection. Polish: exact
computed line-height for scroll-into-view (font-size × 1.2 fallback for
"normal"), 75 ms debounce on textarea→bbox to avoid drag-thrash.
Vitest coverage (4 tests) with `react-konva` mocked to plain `<div>` so
the `canvas` native dep stays out; `ResizeObserver` globally stubbed in
`frontend/src/test/setup.ts`.

- `a374db1` feat(spa): bbox overlay + textarea↔word selection on TextReviewPage
- Roadmap close-out: `689beb0`

## §7 — Per-page text diff after re-OCR

Hand-rolled LCS line diff (`frontend/src/lib/lineDiff.ts`) plus a
paired-row split-view renderer (`LineDiffView.tsx`) that pairs adjacent
delete+insert into a single row. Wired into `TextReviewPage` via
`reocr.onMutate` snapshotting `priorText`; cleared on save success,
reocr error, or page-identity change. Identical re-OCR result is
explicitly reported as "no changes". Vitest coverage: renderer tests
(headers, tint classes, paired-row collapse), full save lifecycle mount
test (load→edit→PATCH→Saved), and re-OCR path that asserts the diff
lines render. TS5097 closed by renaming `lineDiff.tsx` → `LineDiffView.tsx`.

- `024fa2d` feat(spa): per-page text diff after re-OCR on TextReviewPage
- Roadmap close-out: `689beb0`

## §8 — Source preview before ingest

Four-slice delivery. Slice 1: `peek_zip_image_names(raw, limit)` reads
only the zip central directory (no payload decompression) and returns
`(names, total_image_count)`. Slice 2: `GET
/api/data/projects/{id}/source-preview` exposes the helper, auth/ownership
collapses 403→404. Slice 3: `GET .../source-preview/{filename}/thumbnail`
returns a JPEG blob via `extract_zip_image_thumbnail`; non-image and
unknown filenames 404. Slice 4: `SourcePreview` React component mounts
inside the ingest-in-flight banner on `ProjectConfigurePage`. Lightbox /
further UX deferred until user feedback.

- `df31f14` feat(ingest): peek_zip_image_names helper for source preview (P2 #8 prep)
- `ea94bb5` feat(projects): GET /source-preview route over peek_zip_image_names (slice 2)
- `42c2133` feat(projects): GET /source-preview/{filename}/thumbnail route (slice 3)
- `ed9b867` feat(frontend): SourcePreview component renders zip thumbnail strip (slice 4)

## §11 — JWT login state in nav with profile dropdown

`frontend/src/components/ProfileDropdown.tsx` replaces the inline JWT
branch of `AuthBadge`. Button label prefers `email` claim, falls back to
`sub`; menu surfaces identity, token expiry as `YYYY-MM-DD HH:MM UTC`
(or "no expiry"), and a Sign out item that clears `localStorage` +
react-query cache and navigates to `/login`. Vitest covered. "Refresh
token" deferred — `/api/auth/refresh` doesn't exist yet.

- `5140aae` refactor(frontend): extract JWT claims helpers under vitest coverage (P2 #11 prep)
- `ecc13d4` feat(frontend): JWT profile dropdown with email + expiry (P2 #11)

## §12 — Project archive (soft-delete)

`archived: bool` on `Project`; archived projects hidden from the default
list and surfaced via a filter toggle. Replaces the previous
hard-delete `DELETE /projects/{id}` semantics with a soft-delete path.

- `9e6cfb9` feat(projects): archive (soft-delete) endpoints (P2 #12)
- `45ad2dc` fix(frontend): add archived:false to Project test fixtures (P2 #12 follow-up)

## §16 — Job retry with payload override

`POST /api/gpu/jobs/{id}/retry` accepts an optional `{payload_override:
{...}}` body. When non-null, the override is shallow-merged over a copy
of the original job's payload — present keys replace, absent keys are
preserved. The original job row is never mutated (audit trail intact).
Empty `{}` and explicit `null` retry verbatim, so the no-body path
remains compatible. New `RetryJobRequest` Pydantic model in
`api/gpu/schemas.py`; `retry_job` handler in `api/gpu/jobs.py` accepts
`body: RetryJobRequest | None = None`.

- `3d98c5b` feat(jobs): retry endpoint accepts payload_override (P3 #16)

## §18 — Structured logging

Stdlib-only structured logging with request-id correlation, opt-in for
managed mode (default behaviour unchanged for solo proofers).
`core/logging_config.py` installs one managed `StreamHandler`
(idempotent against uvicorn `--reload`); `JsonFormatter` emits one JSON
object per record (`ts`, `level`, `logger`, `msg`, `request_id`, folded
`extra=`, `exc` on `log.exception`). Plain format renders `[rid=...]`
inline. `api/middleware/request_id.py` reads/echoes `X-Request-ID`, mints
a `uuid4().hex` if absent, publishes the id on a `ContextVar` so every
logger below picks it up via `RequestIdFilter`. Settings:
`log_format: Literal["plain", "json"] = "plain"`,
`request_id_header: str = "X-Request-ID"`. Managed deployments flip
`PGDP_LOG_FORMAT=json`. No new prod deps — pure stdlib.

- `fde8f7d` feat(logging): JSON logs + request-id correlation (opt-in)
- Roadmap close-out: `689beb0`

## §19 — Health check endpoint

`GET /healthz` returns `{status, gpu_backend, dispatcher, db_reachable,
mode}` — unauthenticated, excluded from `/openapi.json`, mounted before
the SPA fallback. DB probe is a single bounded
`list_recent_jobs("__healthz__", limit=1)`; any exception flips
`db_reachable=False` + `status="degraded"` while still returning HTTP
200 (orchestrators want a live-but-degraded signal, not a 500).
`dispatcher` is `"batched"` (when `dispatch_interval_seconds > 0`) or
`"immediate"`. Wired in both `full` and `gpu_worker_only` modes.

- `1e87643` feat(api): GET /healthz liveness probe for orchestrators
- Roadmap close-out: `689beb0`

## §20 — OpenAPI codegen

Fully shipped end-to-end across iters 1, 5, 12–14, 16, 17. Spec-drift
guard: `openapi.json` committed at the repo root,
`tests/test_openapi_spec_committed.py` asserts byte-equality with
`build_app().openapi()`; fix-it is `make openapi-export` + commit.
Codegen pipeline: `make openapi-export` writes
`frontend/src/api/types.gen.ts` (the only shape file). Drift guard in
`frontend/src/api/types.gen.drift.test.ts` re-runs `openapi-typescript`
and asserts byte-equality. `ApiModel` (Pydantic base) marks
`default_factory` fields as required in the serialization schema so
`-Output` variants are strict on the wire; `-Input` stays all-optional.
Iter 17 swept all six SPA consumers + tests onto generated shapes,
filling fixture gaps the hand-written types had silently allowed
(`Project.pipeline_state`, `PageRecord.{last_processed_at, outputs}`,
all 14 explicit-null fields on `PageConfigOverrides-Output`). Hand-written
`frontend/src/api/types.ts` deleted.

- `38ddecf` test(openapi): commit spec + drift guard against build_app() (drift guard)
- `8f0626e` docs(roadmap): mark P4 #20 spec-drift guard shipped
- `c08f7be` feat(frontend): types.gen.ts codegen scaffold alongside hand-written types.ts
- `62ee60e` test(frontend): types.gen.ts drift guard via openapi-typescript shell-out
- `2688da7` chore(api): assert explicit operation_id on every route + audit pytest
- `e34bbcb` feat(models): ApiModel base marks default_factory fields required in serialization schema
- `fadc91f` chore(openapi): regenerate spec + types.gen.ts after ApiModel fix
- `8852f9d` fix(make): openapi-export writes to repo-root openapi.json, not frontend/
- `6d7d9d1`, `3289563`, `71b1199`, `e72e6cd`, `ad575bb`, `3bafd09`, `11a08c2`, `f6e6fa2` — per-consumer types.gen.ts swaps
- `c8ff674` refactor(frontend): delete hand-written api/types.ts (close-out)
- `89108c2` docs(roadmap): mark §20 OpenAPI codegen fully shipped

## §22 — CI guard that the wheel actually contains the SPA bundle

Two-sided guard. CI side: the `test` job in
`.github/workflows/release.yml` declares `needs: [build-frontend]` and
downloads the `frontend-dist` artifact into `src/pd_prep_for_pgdp/static/`
before pytest, so `tests/test_spa_fallback.py` runs for real instead of
skipping. The `build-wheel` job runs a `python -m zipfile -l dist/*.whl`
assertion that fails if `pd_prep_for_pgdp/static/index.html` is missing.
Local side: `build_hooks/spa_check.py` is wired via
`[tool.hatch.build.targets.wheel.hooks.custom]` so any wheel build
(`uv build`, `hatch build`, `pip wheel .`) raises a `RuntimeError`
pointing at `make frontend-build` if `static/index.html` is absent or
empty. Undocumented `PD_PREP_SKIP_SPA_CHECK=1` escape hatch for headless
wheels.

- Roadmap close-out: `689beb0`
- Build hook + CI wiring landed across multiple commits in the
  iter-15 / iter-17 run; `git log -- build_hooks/
  .github/workflows/release.yml` is the audit trail.

## §27 — markdownlint-cli2 pre-commit hook

Already wired before the roadmap was split: `.pre-commit-config.yaml`
runs `DavidAnson/markdownlint-cli2` `v0.22.1` against
`.markdownlint-cli2.jsonc`, with a `--fix` variant gated to the
`manual` stage. pd-ocr-labeler-spa mirrored this configuration. No
code work was outstanding — the entry was a doc-only note kept in
the active roadmap by oversight; moved here for accuracy.

- Hook lives at `.pre-commit-config.yaml:25-32`; predates the
  `08-roadmap.md` / `08-roadmap-shipped.md` split (commit `92fa185`).

## §9 — Vitest + msw for the SPA

Acceptance met across ticks 6–14: Vitest + jsdom + msw scaffolding,
pure-function coverage for `lineDiff` / `wordOffsets`, three msw-backed
wire flows (create-project `POST /api/data/projects`; per-page
`GET /pages?review_needed` + `PATCH /pages/{idx0}` for tagging;
`POST /api/gpu/process-page` plus the array-rewrite-on-PATCH contract
the workbench uses for `splits[]` / `illustration_regions[]`), CI
wiring (`make ci` chains `frontend-test` between `test` and `build`;
GHA `build-frontend` runs vitest between `npm install` and
`npm run build`), and a happy-path mount of `ProjectListPage`'s
create-project flow under `QueryClientProvider` + `MemoryRouter`. The
inline `__inline_tests` blocks in `lineDiff.ts` / `wordOffsets.ts`
were removed in tick 9 once the standalone test files locked the
contract.

Open follow-ups (cosmetic, not roadmap-tracked): error / uploading
UI-state assertions on the create-project modal — deferred until the
modal is extracted from `ProjectListPage` for its own reasons; the
happy-path mount already proves the wiring.

- Tick 1 toolchain bring-up; tick 6 pure-function coverage; tick 7
  CI wiring; tick 8 first msw integration test; tick 9
  `__inline_tests` removal; tick 10 page-tagger flow; tick 11
  workbench drag-create flow; tick 14 `ProjectListPage` mount-test.
- See `git log -- frontend/vitest.config.ts frontend/src/test/
  frontend/src/api/*.test.ts frontend/src/lib/*.test.ts
  frontend/src/pages/ProjectListPage.test.tsx` for the audit trail.

## §9a — Word-delete editor on TextReviewPage

Backend + frontend v1 + marquee bulk-select + a11y polish all landed.

- **Backend (tick 21):** `DELETE /api/data/projects/{id}/pages/{idx0}/words`
  accepts `{word_ids, split_suffix?}`, hard-rewrites
  `<root>.words.json` minus the deleted ids, and rewrites `<root>.txt`
  from the survivors via `_rebuild_text_from_words` (y-midpoint line
  clustering) in `api/data/pages.py`. Unknown ids skipped silently
  (idempotent); empty list is a no-op. Covered by
  `tests/test_delete_page_words.py` (9 tests).
- **Frontend v1 (tick 22):** `WordBboxOverlay` gained `selectedWordIds`
  and `onWordToggleSelect` props (red stroke/fill for selection vs. the
  blue active-word highlight). `TextReviewPage` owns the selection
  state, fires the mutation on Delete/Backspace via a scope-aware
  window keydown handler (preserves character-deletion in
  textareas/inputs/contentEditable), and exposes a red
  "Delete N words" toolbar button mirroring the keyboard path.
- **Marquee bulk-select (tick 23):** `frontend/src/lib/marquee.ts` is
  the pure-function home: `normaliseMarquee` (direction-invariant
  rect) and `computeMarqueeSelection` (partial overlap selects;
  edge-only contact does not; words without `id` are skipped).
  `WordBboxOverlay` runs the Konva pointer capture in image-natural
  pixel space, draws a translucent indigo preview rect, and emits
  `onMarqueeSelect(ids, additive)` on mouseup. Shift-drag unions with
  the existing selection; plain drag replaces. Zero-extent marquees
  are suppressed so a stray click doesn't wipe a careful per-word
  selection.
- **Polish + a11y (tick 24):** `Escape` clears the selection (same
  scope rules as Delete/Backspace), a neutral "Clear selection"
  button mounts next to the red Delete button while the selection is
  non-empty, and an `sr-only` `role="status" aria-live="polite"`
  region narrates "N words selected" / "Cleared selection" /
  "Deleted N words" to screen readers.
- **Generated-types swap (tick 25):** `DeleteWordsRequest` /
  `DeleteWordsResponse` in `TextReviewPage.tsx` are now
  `components["schemas"]["..."]` aliases from `api/types.gen.ts`;
  the hand-mirrored interfaces are gone.

Coverage: 9 backend tests + ~14 frontend tests across `marquee.test.ts`,
`WordBboxOverlay.test.tsx`, and `TextReviewPage.test.tsx`.

Open follow-ups (still tracked elsewhere; not on the active roadmap):

- **Undo / soft-delete:** waiting on a user schema decision —
  `OcrWord.deleted: bool` server-side flag (with a flip endpoint and
  `remaining_words` filtering) vs. a client-side debounced commit
  window. Either layers cleanly onto the v1 wire contract;
  `remaining_words` already lets the client be agnostic. See
  `MEMORY.md` /
  `project_pd_prep_for_pgdp_blocked_slices.md` for the active block
  notes.
- **Marquee runtime smoke-test in `make frontend-dev`:** the Konva
  pointer-capture preview rect hasn't been exercised in a real
  browser. Vitest covers the math + handler bodies. Worth a
  five-minute manual pass next time a tick already has a dev server
  running; not appropriate for an overnight loop.

- See `git log -- src/pd_prep_for_pgdp/api/data/pages.py
  tests/test_delete_page_words.py
  frontend/src/lib/marquee.ts frontend/src/lib/marquee.test.ts
  frontend/src/components/WordBboxOverlay.tsx
  frontend/src/components/WordBboxOverlay.test.tsx
  frontend/src/pages/TextReviewPage.tsx
  frontend/src/pages/TextReviewPage.test.tsx` for the audit trail.

## §9a-followup — Word-delete Undo UI: server-side restore banner (2026-05-22)

CT picked **strategy (a)** — wire the already-shipped server-side
`OcrWord.deleted` soft-delete flag and its restore endpoint into the
`TextReviewPage` UI with a persistent **"Restore last delete"** banner.
This supersedes the draft spec's Option B (5-second debounced commit
window): the soft-delete backend already existed, so the timed window
was redundant complexity.

- **Behaviour:** a word delete is persisted immediately via
  `DELETE .../words` (soft-delete — `deleted=True`). On server success a
  banner mounts at the top of `TextReviewPage` reading "Deleted N
  word(s). Restore last delete". The banner has **no countdown** and
  **no expiry timer** — it stays open until the proofer restores
  (button or Ctrl+Z → `POST .../words/restore`), dismisses it (✕), or
  supersedes it with another delete. Navigating away dismisses the
  banner (the delete is already persisted, so nothing is lost).
- **`useUndoWindow` rewrite:** the hook lost its `UNDO_WINDOW_MS` /
  `TICK_MS` timers, `remainingMs` countdown, `AbortController`, and
  `onCommit` callback. It now just tracks the most-recent delete batch
  (`{wordIds, words}`) so the banner can offer a restore. A second
  delete silently replaces the batch.
- **Coverage:** `useUndoWindow.test.ts` (9 tests, incl. a 60-second
  fake-timer advance proving no auto-expiry) +
  `TextReviewPage.test.tsx` (a dedicated banner-persistence test plus
  the existing delete/restore flow tests retargeted to the new copy).
- Branch: `feat/word-delete-restore-banner`. `make ci AI=1` passes.

## §28 — Guard `upgrade-deps` against silent dev-local revert

`scripts/detect_dev_local.py` exits 0 when an editable `pd-book-tools`
install is present (precedence: `uv pip show` "Editable project
location:" line → `.venv/.dev-local` marker → `PD_DEV_LOCAL=1` env
override). `make upgrade-deps` now refuses with a clear message in
dev-local mode and points at the new `make upgrade-deps-local`
recipe, which performs `uv lock --upgrade` + `uv sync --group dev`
and then re-runs `make dev-local` to restore the editable sibling.
`make dev-local` and `make install-local` write the `.venv/.dev-local`
marker; `make remove-venv` (and therefore `reset`) drops it with the
venv. Canonical-mode behavior unchanged.

Spec: `docs/architecture/dev-local-upgrade-flow.md`. Tests: 13 in
`tests/test_detect_dev_local.py` exercising the script with a faked
`uv` on PATH (subprocess shells to `python scripts/detect_dev_local.py`
in a tmp dir with a stub `uv` shell script + isolated `.venv/`).

---

## §13a step 1b — Radix AlertDialog adoption (ProjectListPage delete confirm)

Second wave of the §13a Radix swap. Adds `@radix-ui/react-alert-dialog`
and a thin `frontend/src/components/ui/AlertDialog.tsx` wrapper
exporting `AlertDialog` / `AlertDialogContent` / `AlertDialogTitle` /
`AlertDialogDescription` / `AlertDialogCancel` / `AlertDialogAction`.
The `ProjectListPage` per-row delete-confirm — previously an inline
`{confirming ? <Yes/Cancel buttons> : <⋯ trigger>}` toggle inside the
row — collapses to a real WAI-ARIA `alertdialog` with focus-trap,
scroll-lock, Escape-to-close, and a project-name confirmation body so
the user can verify what they're about to delete.

`AlertDialog` is the sibling of `Dialog` for _destructive_
confirmations: `role="alertdialog"` (Radix sets it automatically),
overlay-click does NOT dismiss (only Cancel or Action), and Radix
focuses Cancel on open per the WAI-ARIA pattern so an accidental
Enter doesn't blow away a project. Same wrapper hygiene as `Dialog`:
no `aria-labelledby` forwarding from caller props (Radix's
`...contentProps` spread would override the auto-wired value), and
`react-refresh/only-export-components` silenced per re-export line
because the rule can't see through `const X = RadixAlertDialog.Y`.

Three new tests in `ProjectListPage.test.tsx` — alertdialog opens with
project name + scroll-lock, Delete fires `DELETE
/api/data/projects/:id`, Cancel does not.

- `<TBD>` feat(frontend): adopt Radix AlertDialog for delete confirm (§13a step 1b)

---

## §13a step 3 — `vite-tsconfig-paths` + `@/*` aliases

Adds `vite-tsconfig-paths@^6` as a dev-dep and registers it as a Vite
plugin in both `vite.config.ts` and `vitest.config.ts`. Declares
`baseUrl: "."` + `paths: { "@/*": ["src/*"] }` in `tsconfig.app.json`
so editor tooling, the production build, and the test runner all
resolve `@/components/...` / `@/lib/...` / `@/api/client` to the same
`src/...` files.

Wiring caveat: `vitest.config.ts` deliberately does NOT import
`vite.config.ts` to dodge the documented Vite 6 ↔ Vitest 2 type
collision (the comment block in both configs is the long-form
explanation). `vite-tsconfig-paths` is registered standalone in each
config — it has no React-typing dependency so it dodges the collision.

A smoke test at `src/test/tsconfigPaths.smoke.test.ts` imports through
the alias and asserts the export resolves; it's the canary for any
future refactor that drops the `paths` block or unwires the plugin.
The current frontend tree is shallow enough that there are no
existing `../../` chains to convert — the alias is preparatory
infrastructure for the deeper component tree to come.

- `<TBD>` chore(frontend): add vite-tsconfig-paths + `@/*` aliases (§13a step 3)

---

## §13a step 2 — `react-hotkeys-hook` for TextReviewPage shortcuts

Adds `react-hotkeys-hook@^5` and replaces the raw
`window.addEventListener("keydown", ...)` block in `TextReviewPage` with
two `useHotkeys` calls — one for `delete, backspace` (bulk-delete) and
one for `escape` (clear selection). The hand-written scope check
against `tagName === "TEXTAREA" || target.isContentEditable` is gone:
the hook ignores INPUT / TEXTAREA / SELECT focus by default
(`enableOnFormTags` opt-in for the rare exception), and exposes a
`scopes` mechanism for future Prev/Next-page bindings on
`PageWorkbenchPage` without re-deriving target sniffing.

**Test-fixture quirk** (preserve in agent memory): `react-hotkeys-hook`
v5 keys off `event.code`, NOT `event.key`. Tests that previously did
`fireEvent.keyDown(window, { key: "Delete" })` now must dispatch on
`document.body` (not window — the hook attaches to `document` and
fireEvent doesn't bubble window→document) and pass both `key` and
`code`: `fireEvent.keyDown(document.body, { key: "Delete", code:
"Delete" })`. `key` alone is silently dropped by the hook's
normalisation path. Three test sites in `TextReviewPage.test.tsx`
updated to the new fixture shape.

- `<TBD>` feat(frontend): adopt react-hotkeys-hook for TextReviewPage shortcuts (§13a step 2)

---

## §L1 steps 1 + 2 — port auto-select fallback + persistence

Solves the "stale-process blocks startup" UX gap surfaced 2026-05-07
(a 21-hour-old `python3 -m http.server 8765` blocked `pgdp-prep`).
`__main__.py` now picks a bindable port before handing off to uvicorn:

1. **Step 1 — EADDRINUSE fallback.** `_pick_port(host, preferred,
   *, explicit, config_dir)` probe-binds with a real TCP socket. If
   `preferred` is busy and the user accepted the default, fall back
   to `bind(0)` and log the substitution. `--port N` collision still
   raises (explicit intent preserved). Skipped under `--reload`
   because uvicorn re-spawns the process — a hard error is more
   informative in dev-loop mode. Commit: `ce965a2`.

2. **Step 2 — `last-port` persistence.** Every successful bind is
   written to `<config_dir>/last-port` (default
   `~/.config/pgdp-prep/last-port`). On the next default-mode start
   the picker reads that file first and re-prefers the persisted
   port before falling through to default 8765 → port=0. Explicit
   `--port N` ignores the file on read but rewrites on success
   (so subsequent default-mode starts pick up the explicit choice).
   Persistence write is best-effort — losing it just means the next
   start falls back to default behavior. Commit: `d958f4b`.

3. **Step 3 — in-UI URL display + `GET /api/server-info`.**
   `__main__._export_bound_env(host, port)` writes `PGDP_HOST` /
   `PGDP_PORT` to the process environment after `_pick_port` resolves
   them, so `Settings()` in the FastAPI app sees the actual bound
   values rather than the configured defaults. The new
   `GET /api/server-info` (read-only, unauthenticated, excluded from
   the OpenAPI schema — same rationale as `/healthz`) returns
   `{host, port, url}`. The `ServerInfoFooter` SPA component fetches
   it once on mount (React Query, `staleTime: Infinity`, no refetch),
   renders the URL as a `select-all` monospaced text node, and exposes
   a small copy-to-clipboard button. Renders nothing while pending or
   on error — better empty than misleading. Mounted in `App.tsx` after
   `<main>` so it sits at the bottom of every page.

Tests: `tests/test_port_autoselect.py` (4) + `tests/test_port_persistence.py`
(11) + `tests/test_main_env_passthrough.py` (2) +
`tests/test_server_info.py` (4) +
`frontend/src/components/ServerInfoFooter.test.tsx` (4). All probes
use real loopback sockets — no mocks, no fixtures beyond `tmp_path`,
sub-millisecond per test on Linux.

- `ce965a2` feat(cli): port auto-select fallback for pgdp-prep (§L1 step 1)
- `d958f4b` feat(cli): persist last-port across restarts (§L1 step 2)
- `3234768` feat(api): add GET /api/server-info + bound host/port env passthrough (§L1 step 3 backend)
- `dd09985` feat(frontend): ServerInfoFooter surfaces bound URL via /api/server-info (§L1 step 3 frontend)

---

## §P0.5 M4 — Migration of existing projects + disk-cost UI (2026-05-14)

Lazy migration of pre-M1 projects: on first workbench open, `_initial_stage_status`
in `adapters/database/sqlite.py` marks legacy pages (processing_status ∈
{complete, processing, error}) as `dirty` instead of `not-run` so users see
the realistic "needs reprocessing" view rather than misleading `not-run`.
`pgdp-prep migrate-projects --force-rebuild` CLI deletes page_stages rows +
on-disk stage artifacts and re-synthesises dirty rows. Disk-cost banner in
ProjectConfigurePage shows `stage_artifacts_bytes` and estimated full-DAG
bytes (source_zip_bytes × 12) with a "Reclaim space" placeholder dialog.

**Sub-slices and commits:**

- Lazy migration + `_initial_stage_status` — commit `982f2e7` (issue #95).
- `--force-rebuild` CLI with `--page-idx` narrow + summary line — commit `0986dfb`,
  fix `4e204ea` (issue #96).
- `stage_artifacts_bytes` / `source_zip_bytes` fields on `Project` model;
  `FULL_DAG_RATIO=12` constant; `_compute_stage_artifacts_bytes` / `_compute_source_zip_bytes`
  helpers in `api/data/projects.py` — commit `1239dbb` (issue #97).
- `DiskCostBanner` component (9 Vitest tests) wired into ProjectConfigurePage — commit `26b9dfc`.

---

## §P0.5 M2 follow-ups — bounded write pool + ResolvedPageConfig + async run + chip-rail wiring (2026-05-15)

Three M2 follow-up issues shipped as part of earlier slices (Slice 14/15); formally
closed 2026-05-15 after the chip-rail run wiring landed.

**#80 — Bounded deferred-write executor (Q8):** `StageWriteExecutor` in
`core/pipeline/stage_write_executor.py` provides a `ThreadPoolExecutor` (pool_size
workers) + `BoundedSemaphore` (queue_cap) with back-pressure. Env-var overrides
`PGDP_STAGE_WRITE_POOL_SIZE` / `PGDP_STAGE_WRITE_QUEUE_CAP` via `Settings`. Wired
into `run_stage` via `_commit_single_artifact` (deferred path: optimistic DB update,
background file write; `on_failure` marks stage `failed` and cascades dirty, Q9).
Full test coverage in `tests/test_stage_write_executor.py`. Shipped in Slice 14
alongside the multi-artifact writer.

**#81 — ResolvedPageConfig plumbing:** `run_stage` accepts `resolved_config:
ResolvedPageConfig | None` kwarg. Route handler resolves config from DB and passes
it in. Async job path re-resolves at execution time. Config hash per stage computed
via `_compute_config_hash` using `STAGE_CONFIG_FIELDS` map. Shipped in Slice 14/15.

**#82 — Optional `?async=true` on run route:** `POST /stages/{stage_id}/run`
accepts `async_: bool = Query(False, alias="async")`. When true: creates a
`JobType.run_page_stage` job (status=queued) and returns 202 Accepted. The
`InProcessJobRunner` handles `run_page_stage` via `_handle_run_page_stage`. Full
test coverage in `tests/test_async_run_stage_route.py`. Shipped in Slice 15.

**Chip-rail run wiring (2026-05-15):** `PageWorkbenchPage` now passes `onStageRun`
to `StageChainRail` via a `runStage` mutation (sync for fast stages, `?async=true`
for `ocr`/`extract_illustrations`). `StageChainRail` `SELECTABLE` set extended to
include `not-run` and `failed` chips so users can select and run any stage from the
workbench (previously only `clean`/`dirty` chips were selectable). Thumbnail/icon
rendering guarded by `HAS_ARTIFACT` (`clean`/`dirty` only). `StageControlsPanel`
and `PageWorkbenchPage.onApplied` now invalidate the correct `["page-stages", ...]`
query key. Commit `e8e5254`.

---

## §P0.5 M3 — Workbench artifact viewer + stage controls panel (2026-05-15)

Tracking issues #83, #84, #9 closed 2026-05-15. All M3 scope shipped across earlier
slices (commits `a05ef89`, `3ef1b52`, `e8e5254`).

**StageChainRail M3 (#83):** polished chip rail with inline thumbnails (lazy-loaded
via `/api/data/projects/{id}/pages/{idx}/stages/{stage}/thumbnail`), text icons for
JSON/text output-type stages, `data-stage-id` attributes, click-to-select (selects
chip + loads ArtifactViewer + StageControlsPanel), Run button in selected-chip
context, pulse animation and status colour-coding preserved from M2.

**ArtifactViewer M3 (#84):** side-by-side Stage and Compare dropdowns; ETag-based
cache busting (artifact URL carries `input_hash` for revalidation); full-res image
with scroll; JSON/text stages render content in a scrollable code block; viewer
hidden when no chip selected.

**StageControlsPanel + wiring (#9):** stage-filtered config fields via
`GET /api/data/pipeline/stages/{stage_id}/fields`; Apply + Run buttons; wired into
`PageWorkbenchPage` with `selectedStageId` propagated from chip rail to both viewer
and controls panel. SSE per-stage transitions in `StageChainRail` (EventSource on
`/api/data/projects/{id}/pages/{idx}/stages/events`).

---

## §P0.5 M5 — Project-level orchestration fan-out + awaiting_review gate (partial, 2026-05-15)

Tracking issue #11 / spec issue #45 (closed). Backend handlers and data-route
completion shipped 2026-05-15. Remaining: M5 is functionally complete pending
a full end-to-end smoke-test confirming the `awaiting_review` gate + auto-resume
flow works in a live `make run` session.

**STAGE_IMPL registry cutover (#85/#91):** `CpuBackend.process_page` routes through
`STAGE_IMPL` registry via `_handle_project_run_dirty`-style loop over
`_PROCESS_PAGE_STAGES`. No call sites of `process_page_cpu` remain in `src/`
(only the function definition). Tests in `tests/test_issue91_registry_cutover.py`.
Commits `7bbaf55`.

**Project-level fan-out handlers:** `_handle_project_run_dirty` and
`_handle_project_run_stage_all_pages` in `core/job_runner.py`. Fan-out: 1 parent
row + N child rows (one per page with dirty stages); parent progress bar ticks
0 → N pages. Tests in `tests/test_project_fanout.py`. Commit predates 2026-05-15.

**awaiting_review gate:** `_handle_build_package` parks in `awaiting_review` when
any proof-range page lacks a clean `text_review` row. `_check_awaiting_review`
loop re-queues on the next poll after all pages are reviewed. Persists across
restarts (DB row IS the queue). Tests in `tests/test_awaiting_review.py`.
`GET /api/data/projects/{id}/review-status` returns `unreviewed_count` +
`awaiting_review_job_id`. Tests in `tests/test_project_review_status.py`.

**M5 hi-fi UI components:** `Badge`, `Collapsible`, `Popover` shadcn wrappers;
`AwaitingReviewBanner` redesign; `OpenTasksBell` in `App.tsx` (1 s polling,
per-project scope); `JobsPage` Badge upgrade. Commits `cb29f44`, `e0cad9f`,
`49e8983`, `409a69d`.

**Project-level API routes (2026-05-15):** `POST /api/data/projects/{id}/run-dirty`
and `POST /api/data/projects/{id}/build-package` added to the data router. Both
return 202 `{job_id, status}`. `run-dirty` accepts optional `?stage_filter=`
query param. Tests in `tests/test_project_action_routes.py`. Commit `322b789`.

**RunAllDirtyPanel (2026-05-15):** "Run all dirty stages" button added to
`ProjectConfigurePage` above `RunPipelinePanel`. POSTs to
`/api/data/projects/{id}/run-dirty`; shows inline SSE progress; button disabled
while pending. Tests in `frontend/src/pages/ProjectConfigurePage.test.tsx`.
Commit `6c112b7`.

---

## §P0.1 — Remove stale "Re-process selected" button (2026-05-15)

`BulkActions` in `ProjectConfigurePage.tsx` had a `reprocess` mutation
calling `POST /api/gpu/jobs` with `job_type: "batch_process_pages"`. The
`JobType.batch_*` enum values and `POST /api/gpu/jobs` route were deleted in
M6; the button silently failed (405). Removed the mutation and the button
entirely. Per-page re-runs go through the PageWorkbench stage controls.

Tests in `frontend/src/pages/ProjectConfigurePage.test.tsx`.
GH issue #110. Commit `b4a6a6c`.

## §P0.2 — Download Package UI (2026-05-15)

After `build_package` completes, `RunPipelinePanel` now shows a "Download
package" link. `JobProgressInline` gained an `onComplete` callback;
`RunPipelinePanel` tracks the completed job id and fetches a presigned URL
from `GET /api/data/projects/{id}/assets/download-url?key=<key>` where key
is `projects/{id}/for_zip/{book_name}.zip`. In local mode the URL resolves
to `/cdn/<key>` served by FastAPI's StaticFiles mount.

Tests in `frontend/src/pages/ProjectConfigurePage.test.tsx`.
GH issue #111. Commit `b4a6a6c`.
