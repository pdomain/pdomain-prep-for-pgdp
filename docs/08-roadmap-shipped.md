# 08 — Roadmap (shipped items)

Items moved out of `08-roadmap.md` once delivered. Keeps the active roadmap
focused on open work; preserves a terse trail of what landed and where for
future archaeology.

Format per entry: heading (mirrors the active-roadmap §-numbering),
one-paragraph summary, the commit SHAs that delivered it, and brief
"what got built" notes. Full design rationale lives in git history; do
not re-paste roadmap prose here.

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

Remaining §13a items (sonner toast layer, react-hotkeys-hook,
vite-tsconfig-paths, AlertDialog/Tabs/Select/Popover/Tooltip primitives)
are still open in the active roadmap.

- `0b6d30e` feat(frontend): swap ProjectListPage modal to Radix Dialog (§13a step 1)

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

Spec: `docs/dev-local-upgrade-flow.md`. Tests: 13 in
`tests/test_detect_dev_local.py` exercising the script with a faked
`uv` on PATH (subprocess shells to `python scripts/detect_dev_local.py`
in a tmp dir with a stub `uv` shell script + isolated `.venv/`).
