# 08 — Roadmap (shipped items)

Items moved out of `08-roadmap.md` once delivered. Keeps the active roadmap
focused on open work; preserves a terse trail of what landed and where for
future archaeology.

Format per entry: heading (mirrors the active-roadmap §-numbering),
one-paragraph summary, the commit SHAs that delivered it, and brief
"what got built" notes. Full design rationale lives in git history; do
not re-paste roadmap prose here.

---

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
