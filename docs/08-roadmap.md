# 08 — Roadmap

The build has moved through 22 iterations. Each iteration was small, TDD-led
where possible, and ended with a green test suite. (A `project_state.md`
under `~/.claude/projects/.../memory/` was previously the per-iteration
log; that file is no longer maintained — this document is now the single
source of truth for forward planning.)

This roadmap is the **forward** view, organised by priority.

---

## P0 — needed for a real first deploy

### 1. Modal app S3 wiring

**File:** `src/pd_prep_for_pgdp/adapters/gpu/modal_app.py`

`process_page` / `run_ocr` / `run_batch` currently raise NotImplementedError.
They need to:

1. Receive an S3-storage config (bucket + region) — either through
   environment in the Modal container or a wrapped storage adapter.
2. Read the source bytes from S3 inside the function.
3. Call `core.pipeline.process_page_cpu` (or a CUDA variant once
   `cupy_processing` is wired) for the actual processing.
4. Write outputs back to S3.
5. Return the spec-04 `ProcessPageResponse` shape.

`ModalBackend` (the dispatcher side) is fully tested via the fake module
trick. The blocker is the **Modal-side** function bodies + access to a real
account for an end-to-end test.

**Acceptance:** `modal deploy adapters/gpu/modal_app.py` then a real
`process-page` request through `ModalBackend` writes a PNG to S3.

### 2. Postgres adapter

**File:** `src/pd_prep_for_pgdp/adapters/database/postgres.py` (doesn't
exist yet).

Mirror the SQLite shape: every Pydantic model lives in a JSON column;
`pages` is keyed on `(project_id, idx0)`; `jobs` indexed on
`(owner_id, created_at DESC)`. Use SQLAlchemy + psycopg.

**TDD plan:** add a `db` fixture factory that yields either `SqliteDatabase`
or `PostgresDatabase` (skipping postgres when unavailable), then parametrise
the existing `test_assign_prefixes.py`, `test_job_runner.py`, etc. over both.

### 3. install.sh end-to-end exercise

We've authored `install.sh`/`install.ps1`/`Makefile.install` but never run the
curl-pipe-sh path in a clean shell with internet access. Worth a 10-minute
session to confirm `uv tool install git+...@<tag>[cuda] --extra-index-url ...`
actually resolves and the resulting `pgdp-prep` command works.

### 4. CI container push

`.github/workflows/release.yml` builds the managed-mode container on tag
push but doesn't push to a registry. User to wire ECR (or GHCR) credentials.

---

## P1 — UX completeness

### 5. Per-page batch_process_pages progress — done

Backend SSE streams `current_page=idx0` per item (tested in
`tests/test_batch_pages_progress.py`). Frontend surfaces it across four
places: `JobProgressInline` ("· page N"), `PageGrid` active-tile sky ring +
pulse, `PageWorkbenchPage` "Processing…" badge via `useJobProgress`, and
`ProjectReviewQueuePage` via `useActiveBatchJob`. Shared status constants
in `frontend/src/lib/jobStatus.ts` also wire `RunPipelinePanel`, the ingest
banner, and the `JobsPage` "live: N" pill.

### 6. OcrWord bbox highlight on TextReviewPage — done

`wordOffsets.ts` (pure-function offset↔word index, iter 8), backend
`<root>.words.json` sibling persistence with `words[]` returned on the
text GET (iter 10), and a `WordBboxOverlay` Konva component on
`TextReviewPage` (iter 11) wire bidirectional selection: clicking a
word in the textarea highlights its bbox; clicking a bbox calls
`setSelectionRange` on the textarea. Iter 12 polish: exact computed
`line-height` for scroll-into-view (with `font-size × 1.2` fallback for
`"normal"`) and a 75ms debounce on the textarea→bbox path so
drag-selection doesn't thrash Konva re-renders.

**Vitest coverage landed in tick 16.**
`frontend/src/components/WordBboxOverlay.test.tsx` mounts the
component with `react-konva` mocked to plain `<div>` placeholders
(`Stage` / `Layer` / `Rect`) so the canvas substrate is sidestepped
without pulling in the native `canvas` dep. Four tests, all green:
(a) renders nothing when `words` is empty; (b) renders nothing when
`naturalWidth`/`naturalHeight` are zero; (c) scaling math —
natural 1000×1500 rendered into a 500×750 track element produces
sx=sy=0.5, asserted via `data-x` / `data-y` / `data-width` /
`data-height` on the mocked rects, plus the active-word stroke
colour (`#2563eb` vs `#94a3b8`) to prove `activeWordIndex` reaches
the correct rect; (d) clicking a rect dispatches `onWordClick(i)`
with the right index. The track element is a `document.createElement`
with a stubbed `getBoundingClientRect`, so the component's initial
sync `update()` (which runs before `ResizeObserver` attaches) is
sufficient to drive `size` non-zero; no observer-callback pumping
needed. `ResizeObserver` itself is now globally stubbed in
`frontend/src/test/setup.ts` (jsdom doesn't ship one) — `observe` /
`unobserve` / `disconnect` are no-ops. Both `WordBboxOverlay` and
`PageWorkbenchPage` need it, so the stub is a free win for any
future component-mount test that touches a resize-tracking surface.
`make frontend-test` runs **38 tests in ~1.2s**, all green
(lineDiff 7, wordOffsets 12, client 3, pages 6, workbench 5,
WordBboxOverlay 4, ProjectListPage 1).

### 7. Per-page text diff after re-OCR — done

Hand-rolled LCS line diff (`frontend/src/lib/lineDiff.ts`, six inline
cases passing) plus a paired-row split-view renderer
(`frontend/src/lib/lineDiff.tsx`) that pairs adjacent delete+insert
into a single row for corrected-line readability. Wired into
`TextReviewPage`: the `reocr` mutation's `onMutate` snapshots the
current textarea text into `priorText`; the diff view appears
inline below the textarea with Hide/Show and Accept controls. The
snapshot is cleared on save success, on `reocr` error, and when
the page identity (project / idx0 / split) changes so the diff
never leaks across Prev/Next navigation. An identical re-OCR result
is reported as "no changes — re-OCR returned identical text"
instead of an empty diff.

**Renderer Vitest coverage landed in tick 18.**
`frontend/src/lib/lineDiff.view.test.tsx` mounts `LineDiffView`
with hand-crafted `DiffLine[]` inputs (independent of the LCS pass,
which is already covered in `lineDiff.test.ts`) and asserts the
visible facts a regressor would actually break: (a) the "Prior" /
"New" column headers render; (b) equal lines appear once per
column, delete lines carry the `bg-red-50` tint, insert lines
carry `bg-emerald-50`, and the literal text content lands in the
DOM; (c) the pairing pass collapses adjacent delete+insert into a
single row — a five-line mixed diff (equal, paired delete+insert,
lone insert, lone delete) yields exactly two placeholder
(`bg-slate-50/50`) cells, one for each unpaired side. Tailwind
*layout* classes are intentionally out of scope so a styling
refactor doesn't churn the test; only the colour classes that
carry the equal/delete/insert semantics are pinned.
`make frontend-test` runs **41 tests in ~1.4s**, all green
(lineDiff 7, lineDiff.view 3, wordOffsets 12, client 3, pages 6,
workbench 5, WordBboxOverlay 4, ProjectListPage 1).

**Save-lifecycle mount test landed in tick 19.**
`frontend/src/pages/TextReviewPage.test.tsx` mounts the page under
`MemoryRouter` + `QueryClientProvider`, stubs `GET
/api/data/projects/:id/pages/:idx0`, `GET .../text/_`, and `PATCH
.../text` via msw, and asserts the load-edit-save chain end to
end: textarea populates from the second query, the Save button is
disabled in the "Saved" state, typing flips it to "Save" + enabled,
clicking it sends `PATCH` with the right `{split_suffix, text}`
body, and `onSuccess` flips the label back to "Saved". `react-konva`
is mocked at module scope so the page's transitive
`konva/index-node.js` → `require("canvas")` import doesn't fault in
jsdom; the page never feeds `WordBboxOverlay` non-zero size (jsdom
doesn't fire `<img>.onLoad`) so the overlay early-returns and the
stubs never render. **TS5097 is closed:** `lineDiff.tsx` (which
collided with `lineDiff.ts` at the bare module path) was renamed to
`LineDiffView.tsx` and the two import sites
(`TextReviewPage.tsx:8`, `lineDiff.view.test.tsx:19`) updated to
the no-extension form. `npx tsc -b` no longer reports TS5097; only
the pre-existing TS2352 errors in `workbench.test.ts` remain (a
separate cleanup item, unrelated to this lifecycle).
`make frontend-test` runs **42 tests in ~1.7s**, all green
(lineDiff 7, lineDiff.view 3, wordOffsets 12, client 3, pages 6,
workbench 5, WordBboxOverlay 4, ProjectListPage 1, TextReviewPage 1).

**Re-OCR + diff lifecycle test landed in tick 20.** A second
`it("re-OCRs and shows diff", ...)` block in
`frontend/src/pages/TextReviewPage.test.tsx` reuses the existing
msw + react-konva stub scaffold to drive the full re-OCR path:
mounts the page, waits for the textarea to populate from
`GET .../text/_`, clicks "Re-OCR this page", and asserts (a)
`POST /api/gpu/run-ocr-page` fires with `{project_id, idx0,
split_suffix}` (the empty `splitSuffix` serialises to `null`,
matching `TextReviewPage.tsx:121`); (b) the textarea value is
replaced with the response body's `text`; (c) the rendered
`LineDiffView` shows the "Prior" / "New" column headers and both
the deleted prior line and the inserted new line in the DOM. The
fixture deliberately edits one of three lines (`alpha\nbeta\ngamma`
→ `alpha\nBETA\ngamma`) so the LCS guarantees one paired
delete+insert row plus two equal rows — no flaky reliance on
incidental output. **§7 fully landed.** `make frontend-test` runs
**43 tests in ~1.4s**, all green (lineDiff 7, lineDiff.view 3,
wordOffsets 12, client 3, pages 6, workbench 5, WordBboxOverlay 4,
ProjectListPage 1, TextReviewPage 2). **TS2352 cleanup also
landed in tick 20:** the five `seenBody as object` /
`seenBody as { ... }` casts in `frontend/src/api/workbench.test.ts`
were collapsed to a single typed alias per test using
`as unknown as { ... }` — runtime null-guard is invisible to tsc,
so narrowing through `unknown` is the right move. `npx tsc -b` now
exits clean (zero errors) for the first time since the test suite
landed.

### 8. Source preview before ingest

In the create-project flow, after the zip is uploaded but before ingest
runs, show a thumbnail strip of the first ~10 page images. Helps the user
catch wrong-zip mistakes early.

### 9. Vitest + msw for the SPA — acceptance met, optional follow-ups remain

**Status (2026-05-06):** previously blocked on npm in this devcontainer;
`node --version` reports v18.20.8 and `npm --version` reports 10.8.2,
so this is unblocked and is the highest-leverage P1 item left. It also
unblocks the deferred coverage notes in §6 (`WordBboxOverlay`) and §7
(`lineDiff` / `TextReviewPage` snapshot lifecycle).

**Step 1 landed (toolchain bring-up):** devDependencies (`vitest@^2.1.9`,
`@vitest/ui`, `jsdom`, `msw@^2.7.0`, `@testing-library/react`,
`@testing-library/user-event`, `@testing-library/jest-dom`) added to
`frontend/package.json` along with `test`/`test:watch`/`test:ui`
scripts. Vitest config lives in `frontend/vitest.config.ts` (separate
file so vitest 2's bundled-Vite types don't collide with the project's
Vite 6 in `vite.config.ts`); jsdom + globals + setup file wired.
`frontend/src/test/setup.ts` registers jest-dom matchers and the msw
lifecycle hooks; `server.ts` and `handlers.ts` stand up an empty
`setupServer()` ready for per-test `server.use(...)` overrides.
`make frontend-test` exists.

**Step 2 landed (first pure-function tests, tick 6):**
`frontend/src/lib/lineDiff.test.ts` ports all six `__inline_tests`
cases from `lineDiff.ts` (bothEmpty / identical / pureInserts /
pureDeletes / ocrishSingleWordCorrection / trailingNewlineParity —
the last split into two `it` blocks since it covers two distinct
invariants). `frontend/src/lib/wordOffsets.test.ts` ports the five
inline cases plus extra coverage for empty/whitespace-only word
text, half-open boundary semantics on `offsetToWord`, and
out-of-range `wordToRange`. 19 tests, all green via
`make frontend-test` (~800ms total). The inline `__inline_tests`
blocks in both source files are now redundant but kept until
tick 7 to avoid an unrelated diff; remove after the integration
tests land.

**Step 3 landed (CI wiring, tick 7):** `make ci` now chains
`frontend-test` between `test` and `build`, so a regression in the
vitest suite fails the local CI pipeline. In GitHub Actions
(`.github/workflows/release.yml`) the vitest run is wired into the
existing `build-frontend` job (which already provisions Node 24 +
runs `npm install`) as a step between `npm install` and `npm run
build`. We deliberately did **not** add Node to the `pytest + ruff`
job: it's intentionally a python-only job, and piggybacking the
vitest run on the node-equipped `build-frontend` job avoids a
duplicate Node setup.

**Step 4 landed (first msw integration test, tick 8):**
`frontend/src/api/client.test.ts` exercises `api.post` against an
msw handler for `POST /api/data/projects` — the create-project
flow's first wire-level call. Three tests: (1) happy-path
asserting the `CreateProjectRequest` body is JSON-encoded with
the right `Content-Type` and the typed `CreateProjectResponse`
parses back through `request()` (project id, status, upload_url,
upload_key); (2) `setAuthToken` + bearer-header attachment
verified by reading `Authorization` off the intercepted Request;
(3) error path — a 409 with `{detail: ...}` becomes a thrown
`Error` carrying `status` + `detail`. Handlers are registered
per-test via `server.use(...)` so `handlers.ts` stays empty until
the page-tagger / workbench flows need shared fixtures.
`make frontend-test` runs 22 tests in ~1.5s, all green. We
deliberately stopped short of mounting `CreateProjectModal`
itself: the modal pulls in React Query + Router providers and
an `XMLHttpRequest` upload step, which would have ballooned the
test scaffolding well past the tick-8 budget. The wire-level
contract (the value of an integration test) is now locked; a
later tick can layer a Testing-Library mount on top once we want
to assert the modal's UI states (form / uploading / error).

**Concrete next steps:**

1. Add devDependencies to `frontend/package.json`: `vitest`,
   `@vitest/ui`, `jsdom` (or `happy-dom`), `@testing-library/react`,
   `@testing-library/user-event`, `@testing-library/jest-dom`, `msw`.
2. Add a `test` script (`vitest run`) and `test:watch` (`vitest`) to
   `frontend/package.json`. Wire `make frontend-test` into the
   Makefile and into `make ci` so SPA tests run alongside pytest.
3. Create `frontend/vitest.config.ts` (or extend `vite.config.ts`
   with a `test` block) — `environment: "jsdom"`, `setupFiles` for
   `@testing-library/jest-dom` matchers and msw lifecycle hooks.
4. Stand up `frontend/src/test/server.ts` with `setupServer()` from
   msw and a small `handlers.ts` that mirrors the FastAPI routes the
   first three target tests need:
   - `POST /projects` + `POST /projects/{id}/ingest` (create-project flow)
   - `GET /projects/{id}/pages` + `POST /projects/{id}/pages/bulk-tag`
     (page-tagger grid bulk actions)
   - workbench drag-create endpoints (TBD — confirm route names from
     `frontend/src/api/`).
5. ~~First test (smallest useful unit): pure-function coverage for
   `frontend/src/lib/lineDiff.ts` and `wordOffsets.ts`~~ — done in
   tick 6. 19 tests across both files, green.
6. ~~Wire `make frontend-test` into `make ci` now that test discovery
   has real targets to fail on if it regresses.~~ — done in tick 7.
   `make ci` now runs `setup pre-commit-check test frontend-test
   build`; GHA runs `npm test` inside the `build-frontend` job.
7. ~~First msw-backed integration test: pick the smallest of the three
   target flows (probably `POST /projects` create-project, since the
   request shape is already stable). This validates handlers.ts +
   per-test `server.use(...)` overrides end-to-end before tackling
   the page-tagger and workbench flows.~~ — done in tick 8.
   `frontend/src/api/client.test.ts`, three tests against
   `POST /api/data/projects`. See "Step 4 landed" above.
8. ~~Delete the now-redundant `__inline_tests` exports from
   `lineDiff.ts` / `wordOffsets.ts` — keep the docstrings, drop the
   helper + assertEq.~~ — done in tick 9. Removed both
   `__inline_tests` blocks plus the `assertEq` (and `mkWord` in
   `wordOffsets.ts`) helpers; module docstrings and per-function
   JSDoc preserved. `make frontend-test` still 22/22 green
   (`lineDiff.test.ts` 7, `wordOffsets.test.ts` 12, `client.test.ts`
   3). Test-file headers refreshed since they no longer "port" any
   inline cases. Pre-existing `tsc -b` error in
   `TextReviewPage.tsx` (unrelated `.tsx` import) is the only
   typecheck output and predates this tick.
9. ~~Second msw flow: page-tagger grid bulk-tag (`POST
   /projects/{id}/pages/bulk-tag`).~~ **Pivoted in tick 10.** No
   `bulk-tag` endpoint exists in `api/data/pages.py` — page tagging
   is per-page via `PATCH /api/data/projects/{id}/pages/{idx0}`
   with `{page_type: ...}` (used by `ProjectConfigurePage`'s grid
   at line 411), and `ProjectReviewQueuePage` reads the list with
   `GET /api/data/projects/{id}/pages?review_needed=true`.
   `frontend/src/api/pages.test.ts` adds **6 wire-level tests**
   covering the actual page-tagger surface: (a) `GET /pages` with
   `review_needed=true&limit=500` query — asserts query encoding +
   `ListPagesResponse` parsing across mixed `page_type`s; (b) `GET`
   omits `undefined` / `null` query params from the URL; (c)
   `PATCH /pages/{idx0}` with `{page_type: "blank"}` — JSON body
   shape + `Content-Type` + parsed `PageRecord` return; (d)
   bearer-token attachment via `setAuthToken`; (e) 404 missing
   page surfaces as a thrown `Error` with `status` + `detail`; (f)
   422 with FastAPI's array-shaped `detail` parses through. Uses a
   local `makePage()` builder to keep per-test intent visible —
   `handlers.ts` stays empty since per-test `server.use(...)` is
   sufficient. `make frontend-test` runs 28 tests in ~1s, all
   green (`lineDiff.test.ts` 7, `wordOffsets.test.ts` 12,
   `client.test.ts` 3, `pages.test.ts` 6). **Roadmap implication:**
   a real bulk-tag endpoint, if added, deserves its own iteration
   (backend route + grid multi-select UX + tests); tick 10's
   wire-level coverage already locks the only mutation that exists
   today.
10. ~~Third msw flow: workbench drag-create endpoints (route names
    TBD — confirm from `frontend/src/pages/PageWorkbenchPage.tsx`).~~
    — done in tick 11. The workbench has two distinct wire surfaces:
    (a) `POST /api/gpu/process-page` for the synchronous "Preview"
    button (`ProcessPageRequest`/`ProcessPageResponse` from
    `adapters/gpu/base.py`); (b) reuse of
    `PATCH /api/data/projects/{id}/pages/{idx0}` for drag-create —
    `handleAddSplit` / `handleAddRegion` send array-shaped
    `{ splits: [...] }` or `{ illustration_regions: [...] }` bodies
    through the same per-page PATCH that pages.test.ts already
    proves for `page_type`. **No dedicated split/region create
    endpoint exists** — the array-rewrite-on-PATCH pattern is the
    actual contract. New `frontend/src/api/workbench.test.ts` (5
    tests, ~122ms): preview body shape + parsed response, 503 from
    process-page, splits[] PATCH body, illustration_regions[] PATCH
    body, 422 with FastAPI array detail. `ProcessPageRequest`/
    `Response` aren't yet in `types.ts` (still hand-written subset);
    locally mirrored in the test to keep the wire test scope-pure.
    `make frontend-test` runs 33 tests (lineDiff 7, wordOffsets 12,
    client 3, pages 6, workbench 5) in ~2.5s, all green.
    `handlers.ts` still empty — per-test `server.use(...)` is still
    sufficient at three test files.
11. ~~(Stretch) Mount `CreateProjectModal` with Testing-Library +
    QueryClientProvider + MemoryRouter and assert the form →
    uploading → error UI states.~~ — first happy-path mount landed
    in tick 14. `frontend/src/pages/ProjectListPage.test.tsx` renders
    `<ProjectListPage>` under a fresh `QueryClient` (retry off so error
    paths surface immediately) wrapped in `MemoryRouter`, opens the
    modal via the "New project" button, types the book name, uploads a
    `File` blob via `userEvent.upload`, and clicks "Create + Upload".
    msw intercepts (a) the mount-time `GET /api/data/projects` (empty
    list), (b) `POST /api/data/projects` (returns a stub project with
    an `upload_url` + `upload_key`), (c) the XHR `PUT /cdn/...` upload
    via msw's XMLHttpRequestInterceptor in jsdom, and (d) the follow-up
    `POST /api/gpu/ingest`. Asserts: the create-project body equals
    `{name: "Belloc — The Four Men", source_type: "zip"}` and the
    ingest POST was reached. A small `renderWithProviders` helper +
    `makeProject` builder live inline in the test file — kept local
    rather than extracted to `test/` since this is the only mount-test
    consumer right now (extract on the second consumer, not the
    first). `make frontend-test` runs 34 tests in ~1.3s, all green
    (lineDiff 7, wordOffsets 12, client 3, pages 6, workbench 5,
    ProjectListPage 1). The error-state and uploading-state
    assertions from the original stretch goal are deliberately
    deferred — the happy path proves the wiring; UI-state assertions
    can layer on once we have a reason to refactor the modal (e.g.
    extracting it as `CreateProjectModal.tsx`, which would also let a
    test render just the modal instead of the full page).

**Acceptance:** `make frontend-test` is green, runs in CI, and at
least one test from each of the three target flows above is
passing.

### 9a. Basic word editor on TextReviewPage — backend + frontend v1 landed

**Goal:** let a proofer cull obvious OCR noise words (stray marks,
page-edge fragments, dust speckles, scanner artefacts) from a page's
OCR output before the text reaches the PGDP package, without
leaving `TextReviewPage`.

**Inspiration:** `pd-ocr-labeler`'s word editor
(`pd_ocr_labeler/views/projects/pages/word_match*.py`,
`word_match_actions.py::_handle_delete_single_word` /
`_handle_delete_selected_words`) shows every OCR word in its own
crop with per-word and bulk delete, plus merge/split/refine/rebox.
This item is deliberately a **strict subset** — delete only.

**Minimum viable scope:**

1. **Per-word click-to-delete** on the existing `WordBboxOverlay`
   (component already in place from §6). Add a "delete" affordance
   when a word is the active selection (small "x" button anchored
   to the highlighted bbox, or a Delete-key shortcut while a word
   is selected via the existing bbox↔textarea wiring).
2. **Bulk-select via marquee on the bbox layer** — shift-click or
   drag-rectangle on the Konva layer to mark multiple words, then
   a single "Delete N selected words" toolbar button.
3. **Single-level undo** for the most recent delete batch (revert
   button visible until the page is saved or the user navigates).
4. **Persistence:** the delete mutates the stored `words[]` and
   re-derives the page text. The new endpoint
   `DELETE /api/data/projects/{id}/pages/{idx0}/words` (or a
   `PATCH …/text` body field `delete_word_ids: list[str]`) takes a
   list of `OcrWord.id` values, drops them from the
   `<root>.words.json` blob via the storage adapter, and rewrites
   `<root>.txt` from the surviving words (joined with spaces /
   line-break heuristic from `OcrWord.bounding_box`). Backend lives
   in `src/pd_prep_for_pgdp/api/data/pages.py`; the storage I/O
   reuses `cpu.words_key_for` and `cpu.load_words_from_storage`.

**Out of scope vs. the full labeler** (these belong in
`pd-ocr-labeler`, not here):

- Editing word *text* (typo correction). Users should fix typos in
  the textarea, not the word grid.
- Word merge / split / rebox / refine / nudge / expand-then-refine.
- Line- and paragraph-level operations.
- Per-word image crops in a grid view — we stay on the existing
  page-image + bbox-overlay layout. No grid view.
- Word confidence badges, reorder, drag-and-drop reassignment.
- Multi-step undo / redo history.

**UI/data-flow plug-in points:**

- **Page:** `frontend/src/pages/TextReviewPage.tsx` (already
  manages `words` state, `activeWordIndex`, and the textarea↔bbox
  selection round-trip).
- **Component:** extend `frontend/src/components/WordBboxOverlay.tsx`
  with a delete affordance + marquee-select state; OR introduce a
  sibling `WordDeleteToolbar.tsx` that consumes the same `words`
  array.
- **API client:** new method in `frontend/src/api/`; types
  regenerated via `make openapi-export` (per CLAUDE.md).
- **Backend:** new route in `api/data/pages.py`; `OcrWord.id`
  (already on `core/models.py::OcrWord`) is the deletion key.
- **Storage shape:** the on-disk `<root>.words.json` produced by
  `cpu.run_ocr` (see `cpu.py:146`) is the canonical store —
  rewrite it in place; no new schema needed.

**Prerequisites / dependencies:**

- §6 (OcrWord bbox highlight — *done*) provides the `words[]` API
  payload and the bidirectional textarea↔bbox selection plumbing
  this feature builds on.
- §9 (Vitest + msw — *ready*) should land first so the
  click-to-delete and undo behaviours can have unit + integration
  coverage from day one.
- No backend prerequisite; works with any storage adapter because
  it only round-trips `<root>.words.json` and `<root>.txt`.

**Acceptance:**

1. On a page with OCR output, the proofer can click a bbox, press
   Delete, and the word disappears from both the bbox overlay and
   the rebuilt text in the textarea.
2. A marquee-drag selects N words; a single "Delete N words"
   toolbar action removes them all in one round-trip.
3. Undo restores the most recent delete batch as long as the page
   has not been saved or navigated away from.
4. After save, reloading the page shows the surviving words in
   `words[]` and the regenerated text matches.
5. `make frontend-test` covers the per-word delete and the undo
   path; pytest covers the new backend endpoint with both empty
   and non-empty `delete_word_ids`.

**Open questions** (worth deciding before implementation):

- Does deleting words rewrite `<root>.txt` server-side, or does
  the client send the regenerated text alongside the id list?
  (Server-side is simpler and keeps text in sync with `words[]`,
  but loses any uncommitted textarea edits unless they're sent
  too.)
- Do we want a "soft-delete" flag on `OcrWord` (e.g. `deleted:
  bool`) so the operation is reversible across sessions, or is a
  hard rewrite of `words.json` acceptable for v1? Soft-delete
  costs little and unblocks future "show deleted words" review.

**Status (tick 21):** backend slice landed.
`DELETE /api/data/projects/{id}/pages/{idx0}/words` now accepts
`{word_ids, split_suffix?}`, hard-rewrites `<root>.words.json` minus
the deleted ids, and rewrites `<root>.txt` from the survivors via a
y-midpoint line-clustering helper (`_rebuild_text_from_words` in
`api/data/pages.py`). Unknown ids are silently skipped (idempotent),
empty list is a no-op that still returns the canonical state. Covered
by `tests/test_delete_page_words.py` (9 tests: happy path, line
clustering, unknown id, empty list, delete-all-empty-text, plus four
404 paths). Server contract is additive — `update_page_text` /
`get_page_text` unchanged.

Open questions still open and deferred:

- v1 chose **hard rewrite** for simplicity. A future soft-delete
  pass (e.g. `OcrWord.deleted: bool`) is non-breaking — the response
  still returns `remaining_words` so the client doesn't need to know
  which strategy the server uses.
- The simple line-clustering text rebuild ignores paragraph
  boundaries (the per-word model doesn't carry them). For the §9a
  "delete obvious noise" use case this is acceptable; the proofer's
  textarea remains the source of truth on save via the existing
  PATCH `/text` endpoint.

Tick 22 should pick up the **frontend slice** — extend
`WordBboxOverlay` with a delete affordance, add `selectedWordIds`
state on `TextReviewPage`, wire `useMutation` against the new
endpoint (regenerate types via `make openapi-export` first),
single-level undo on the most recent batch.

**Status (tick 22):** frontend v1 landed.
`WordBboxOverlay` gained two optional props — `selectedWordIds:
ReadonlySet<string>` and `onWordToggleSelect(id)` — drawn with a
distinct red stroke / fill so selection is unambiguous against the
existing blue active-word highlight. `TextReviewPage` owns the
`selectedWordIds` state, toggles on bbox click, and wires a
window-level `keydown` handler that fires the mutation on Delete /
Backspace; the handler is scope-aware so the keys retain normal
character-deletion semantics inside the textarea / inputs / any
contentEditable. A red "Delete N words" toolbar button mirrors the
keyboard path and stays disabled with no selection or while the
mutation is in flight.

The wire types (`DeleteWordsRequest` / `DeleteWordsResponse`) are
hand-mirrored at the top of `TextReviewPage.tsx` next to
`OcrPageResponse` rather than in `api/types.ts` — same convention
`PageWorkbenchPage` uses for `ProcessPageRequest`/`Response` (tick
11). Replace once `make openapi-export` catches up (out-of-band:
that target needs the backend running, so it's a follow-up tick
rather than overnight work).

Two Vitest scenarios in `pages/TextReviewPage.test.tsx`: (a) load a
page with three words → click two rects → press Delete → assert
DELETE body matches `{word_ids: [w_alpha, w_beta], split_suffix:
null}` and the textarea reflects the rebuilt text; (b) Delete with
empty selection is a no-op and the toolbar button is disabled.
Existing 4 TextReviewPage tests + 4 WordBboxOverlay tests stayed
green; total frontend tests now 45 (was 43).

Open question still open and deferred:

- **Undo: skipped for v1.** The server endpoint is destructive
  (hard rewrite of `<root>.words.json` + `<root>.txt`) and there's
  no restore route, so honest single-level undo would require
  either (a) a new server-side soft-restore endpoint or
  (b) a client-side debounced commit (e.g. 5-second window where
  the mutation fires only after Undo has been dismissed). Both are
  larger than a single tick; the pragmatic recovery path today is
  re-OCR — the existing `Re-OCR this page` button re-derives words
  from the source image. A future tick can layer either undo
  strategy on top of the v1 endpoint without changing the wire
  contract — `remaining_words` already lets the client be agnostic
  about server-side soft- vs hard-delete.

**Status (tick 23):** marquee bulk-select landed.
`frontend/src/lib/marquee.ts` is the new pure-function home for the
hit-test math: `normaliseMarquee(ax, ay, bx, by)` collapses a
two-corner drag into a positive-extent `MarqueeRect` regardless of
direction, and `computeMarqueeSelection(words, rect)` returns the
ids of every word whose bbox overlaps the marquee. Partial overlap
selects (matches typical drag-rect editor UX); edge-only contact
(zero-area overlap) does not. Words without an `id` are skipped
since the §9a delete pipeline is keyed on id. Coordinate space is
the image's natural pixel space — the overlay scales DOM-pixel
pointer coords back into natural space before calling the helper,
so the math stays independent of any rendered-size state.

`WordBboxOverlay` gained Konva `onMouseDown`/`onMouseMove`/
`onMouseUp` handlers on the Stage plus an `onMarqueeSelect(ids,
additive)` optional prop. Mousedown on empty canvas captures an
anchor in natural space (and the shift-key flag for additive
semantics); mousemove updates a translucent indigo preview rect;
mouseup runs `computeMarqueeSelection` and emits the result.
Zero-extent marquees (a stray click) are suppressed so a careful
per-word selection isn't wiped by accidentally clicking outside any
bbox in "replace" mode. `TextReviewPage` consumes the callback:
shift-drag unions with the existing `selectedWordIds`; plain drag
replaces. Existing single-click toggle path is unchanged.

Coverage: `frontend/src/lib/marquee.test.ts` adds **12 unit tests**
(normalise direction-invariance, normalise zero-drag, full overlap,
partial overlap, marquee-inside-bbox, disjoint, edge-only contact,
identical bbox, multi-word order preservation, id-less skip,
zero-area marquee). `frontend/src/components/WordBboxOverlay.test.tsx`
adds **2 integration tests** that drive the Stage end-to-end via
`fireEvent.mouseDown/Move/Up` — the Konva mock was extended
minimally to forward the three `onMouseX` props through to the
`<div>` that stands in for the Stage, synthesising a fake
`{evt, target.getStage().container()}` payload from React's
synthetic mouse event. The runtime path (Konva on a real canvas)
shares the handler bodies, so this exercises the production logic
minus the canvas substrate. Existing 4 WordBboxOverlay tests stayed
green; total frontend tests now **59** (was 45, +14).
`make frontend-test` runs in ~1.6s; `npx tsc -b` exits clean.

Open question still open and deferred:

- **Undo / soft-delete:** still pending the user's schema decision
  (`OcrWord.deleted: bool` vs hard rewrite). Tick 22 and tick 23 both
  flagged this; not appropriate to make unilaterally overnight.

**Status (tick 24):** marquee polish + a11y announcer landed.
`TextReviewPage`'s window-level keydown handler now also handles
`Escape` — when focus is outside textarea/input/contentEditable and
the selection is non-empty, Esc clears `selectedWordIds` (same scope
rules as the Delete/Backspace path so it doesn't fight any modal
that owns Esc). A neutral-styled "Clear selection" button mounts
next to the red "Delete N words" button only while the selection is
non-empty; clicking it does the same thing as Esc. Bonus a11y:
a visually-hidden (`sr-only`) `role="status" aria-live="polite"`
region under the toolbar narrates "N words selected" /
"Cleared selection" / "Deleted N words" to screen readers — the
state is updated from every selection mutator (toggle, marquee,
Esc, Clear button, deleteWords.onSuccess). Two new Vitest scenarios
in `pages/TextReviewPage.test.tsx`: (a) select two rects → press Esc
→ Delete reverts to empty-label disabled state and Clear button
unmounts; (b) select two rects → click "Clear selection" → same
post-condition. Existing 4 + 2 §9a TextReviewPage tests stayed
green. Total frontend tests now **61** (was 59, +2).
`make frontend-test` runs in ~1.7s; `npx tsc -b` exits clean. No
backend changes; no wire-contract changes.

Tick 25 candidates (pick the smallest with the highest leverage):

- **Soft-delete server flag** so undo becomes feasible: add
  `deleted: bool` to `OcrWord`, change the DELETE endpoint to flip
  the flag instead of dropping rows, return `remaining_words`
  filtered to non-deleted. Frontend gains an "undo last batch"
  button that POSTs the un-flag. **Schema decision — needs user
  input before any code changes.**
- **`make openapi-export` round-trip**: when a tick has the
  backend up, regenerate `types.ts` and replace the hand-mirrored
  `DeleteWordsRequest` / `DeleteWordsResponse` interfaces with the
  generated names. Mechanical; one commit.
- ~~**Marquee polish**: "Clear selection" button + Esc-key handler.~~
  *Landed in tick 24, plus a bonus aria-live announcer.*
- **Marquee runtime smoke-test in `make frontend-dev`**: the
  Vitest path covers the math + the handler bodies, but the
  preview rect rendering and Konva pointer-capture haven't been
  exercised in a real browser yet. Worth a 5-minute manual pass on
  a real page once a tick has a dev server running.

---

## P2 — Frontend polish

### 10. Konva Transformer rotate + flip

Currently `rotateEnabled=false`, `flipEnabled=false`. Spec 06 doesn't ask
for them, but proofers occasionally need to fix scanner-frame skew that
falls outside the auto-deskew range; expose rotate handles for the rare case.

### 11. JWT login state in nav with profile dropdown

`AuthBadge` shows the JWT `sub` claim + Sign-out today. Add a tiny dropdown
with email (from the JWT `email` claim if present), API token expiry, and
a "Refresh token" item.

### 12. Project archive (soft-delete)

`DELETE /projects/{id}` is hard-delete today. Add `archived: bool` to
`Project`; archived projects hidden from the default list, surfaced via a
filter toggle.

### 13. Search across pages

For very large books (>500 pages), let the user search the OCR text. Needs
a `pages.ocr_text` index column or full-text search. SQLite FTS5 is fine
for local; Postgres has built-in TS.

### 13a. Adopt shadcn/ui + Radix and close the spec/code divergence

`specs/00-overview.md:57,126` and `specs/03-ui-layout.md:5,404` name
shadcn/ui (Radix-backed) as the intended component library, but the SPA
ships hand-rolled Tailwind on raw HTML — there's no `frontend/src/components/ui/`,
no `@radix-ui/*` deps in `frontend/package.json`, and the lone component is
`WordBboxOverlay`. The "modal" in `ProjectListPage.tsx:106-168` is a raw
`<div>` overlay with no focus trap, no Escape binding, no scroll lock,
and Cancel/Create buttons that aren't a real `<dialog>`. There is no
toast layer at all — `TextReviewPage.tsx:494-507` inlines three separate
`<span class="text-xs text-red-600">` paragraphs for save / re-OCR /
delete failures, which is the only feedback path the user gets.

Future improvement, no prescribed milestone:

1. **shadcn/ui + Radix primitives** for `Dialog`, `AlertDialog`, `Toast`,
   `Tabs`, `Select`, `Popover`, `Tooltip`. Closes the
   spec/code divergence and gets focus management, Escape, scroll lock,
   and ARIA roles for free.
2. **`sonner`** as the toast surface (one provider at the app root,
   replace inline error spans in `TextReviewPage.tsx:494-507` and the
   ad-hoc `step.kind === "error"` block in `ProjectListPage.tsx:161-165`
   with `toast.error(...)`).
3. **`react-hotkeys-hook`** for keyboard shortcuts. Today the
   Delete/Backspace/Escape handler in `TextReviewPage.tsx` is a raw
   `window.addEventListener("keydown", ...)` with hand-written
   scope checks against `tagName` and `contentEditable` (tick 22 / 24);
   a hook layer would fold that into a reusable scope and leave room
   for Prev/Next-page bindings on `PageWorkbenchPage`.
4. **`vite-tsconfig-paths`** + `tsconfig` `paths` aliases so imports
   become `@/components/...`, `@/api/client`, `@/lib/marquee` instead
   of `../../api/client` chains. Cosmetic, but pays off as the
   component tree deepens.

Cost is mostly mechanical (install + replace), spread across many
files. Worth pairing with whichever P2 item next touches the modal
or the toolbar.

---

## P3 — Pipeline depth

### 14. CUDA path (LocalBackend)

Spec 04 GPU path. Mirror `process_page_cpu` using
`pd_book_tools.image_processing.cupy_processing` primitives + nvImageCodec
for source decode. The orchestration shape is identical; the primitives
differ. Behind a `[cuda]` extra so the wheel install stays slim.

### 15. Shared GPU container backend

`SharedContainerBackend` is a placeholder. Implementation: an HTTP client
pointing at a long-running `pgdp-prep --mode gpu_worker_only` ECS task with
per-tenant authentication. Spec 09 §"Backend 2".

### 16. Job retry with payload override — done

`POST /api/gpu/jobs/{id}/retry` now accepts an optional
`{payload_override: {...}}` body. When non-null, the override is
shallow-merged over a copy of the original job's payload — keys present
in the override replace the corresponding original keys; keys not present
are preserved. The original job's row is never mutated, so the audit
trail stays intact. Empty `{}` and explicit `null` are both treated as
"retry verbatim" so the no-body path remains compatible.

Implementation: new `RetryJobRequest` Pydantic model in
`src/pd_prep_for_pgdp/api/gpu/schemas.py`; the `retry_job` handler in
`api/gpu/jobs.py` accepts `body: RetryJobRequest | None = None` and
applies `dict.update()` after copying `job.payload`. Coverage in
`tests/test_job_retry.py` (7 tests; +4 new): override replaces an
existing key, override adds a new key while preserving others, empty
override is a no-op, explicit `None` falls back to the original.
`make test` 381 passed / 4 pre-existing skips.

### 17. Spec-01 off-by-one in `compute_prefix`

Logged in iteration 1. The spec's loop `range(start, min(idx0, end+1))` is
empty when `idx0 == start`, so the first frontmatter page is `f000` instead
of `f001` despite `frontmatter_page_nbr_start=1`. Implementation matches
spec verbatim; needs a user decision on whether the spec or the field name
is wrong, then a one-line fix + a test update.

---

## P4 — Operations / observability

### 18. Structured logging — done

Tick 13 wired stdlib-only structured logging with request-id
correlation, opt-in for managed mode (default behaviour unchanged for
solo proofers).

- `core/logging_config.py` — `configure_logging(format)` installs one
  managed `StreamHandler` on the root logger (idempotent — uvicorn
  `--reload` won't stack handlers); `JsonFormatter` emits one JSON
  object per record with keys `ts`, `level`, `logger`, `msg`,
  `request_id`, plus folded `extra=` fields and `exc` on
  `log.exception`. Plain format gets `[rid=...]` rendered inline.
- `api/middleware/request_id.py` — pure ASGI middleware (`BaseHTTPMiddleware`)
  reads/echoes `X-Request-ID`, mints a `uuid4().hex` if absent, and
  publishes the id on a `ContextVar` so every `logging.getLogger().info(...)`
  below it picks the value up via `RequestIdFilter`. Registered in
  `bootstrap.build_app()` after CORS so it's outermost in the ASGI
  stack — every log line, including from exception handlers and the
  SPA fallback, carries the correlation id.
- `Settings.log_format: Literal["plain", "json"] = "plain"` and
  `Settings.request_id_header: str = "X-Request-ID"` — both defaults
  preserve current behaviour; managed deployments flip
  `PGDP_LOG_FORMAT=json`.
- Coverage in `tests/test_logging_structured.py`: 9 tests covering
  plain rendering with rid, JSON schema + folded extras, JSON traceback
  via `log.exception`, middleware generates+echoes id, middleware
  preserves incoming id, filter attaches attribute by default,
  idempotency, formatter handles records without filter, import
  cleanliness.
- Full pytest suite: 368 passed / 4 skipped (was 359 passed; +9 new
  tests).
- No new prod dependencies — pure stdlib (`json`, `logging`,
  `contextvars`, `uuid`, `starlette.middleware.base`).

### 19. Health check endpoint — done

`GET /healthz` (tick 12) returns
`{status, gpu_backend, dispatcher, db_reachable, mode}` —
unauthenticated, excluded from `/openapi.json`, mounted before the SPA
fallback so the catch-all route doesn't shadow it. The DB reachability
probe is a single bounded `list_recent_jobs("__healthz__", limit=1)`
call (synthetic owner, guaranteed empty result, read-only); any
exception flips `db_reachable=False` and `status="degraded"` while
still returning HTTP 200 — orchestrators want a live "I'm alive but
degraded" signal, not a 500. `dispatcher` is reported as
`"batched"` (when `dispatch_interval_seconds > 0`) or `"immediate"`;
`gpu_backend` echoes `GPUBackend.name`. Lives at
`src/pd_prep_for_pgdp/api/healthz.py`, wired in `bootstrap.py` for both
`full` and `gpu_worker_only` modes (worker-only nodes still need
liveness). Coverage in `tests/test_healthz.py`: 5 tests covering happy
path, batched dispatcher, unauthenticated access in apikey mode,
db-unreachable degraded path (via patched `list_recent_jobs`), and
schema-exclusion. `make test` 359 passed / 4 pre-existing skips.

### 20. OpenAPI codegen

**Status:** spec-drift guard landed (iter 5). Generated-types swap still
pending npm.

Spec-drift guard (done): `openapi.json` is committed at the repo root,
and `tests/test_openapi_spec_committed.py` asserts it matches what
`build_app().openapi()` emits now. Drift fails CI; fix-it is
`make openapi-export` + commit the updated `openapi.json`.

Still TODO once npm is available: run `make openapi-export` (it also
runs `openapi-typescript` against `frontend/openapi.json`) to replace
the hand-written `frontend/src/api/types.ts` with a generated file, and
add a parallel guard that the committed `types.ts` matches the
generator output.

### 21. Memory pruning revisit

`memory/project_state.md` was pruned at iteration 11 (collapsed iterations
1-7 into a table). It's grown again. Fold older "Done" sections into the
table once they're stable.

### 22. CI guard that the wheel actually contains the SPA bundle — done

**Status (tick 15 + tick 17):** fully landed.

CI side (tick 15) — `.github/workflows/release.yml`:

1. The `test` job `needs: [build-frontend]` and downloads the
   `frontend-dist` artifact into `src/pd_prep_for_pgdp/static/`
   before pytest, so `tests/test_spa_fallback.py` runs for real
   instead of skipping (acceptance #1).
2. The `build-wheel` job runs a `python -m zipfile -l dist/*.whl`
   assertion that fails the job if `pd_prep_for_pgdp/static/index.html`
   isn't inside the produced wheel (acceptance #2 at the CI level).

Local side (tick 17) — Hatchling build hook:

1. `build_hooks/spa_check.py` is wired via
   `[tool.hatch.build.targets.wheel.hooks.custom]` in `pyproject.toml`.
   The hook runs at the start of any wheel build (`uv build`,
   `hatch build`, `pip wheel .`, etc.) and raises a `RuntimeError`
   pointing at `make frontend-build` if
   `src/pd_prep_for_pgdp/static/index.html` is missing or empty.
   Validated both directions: positive case (SPA present) builds
   the wheel as before; negative case (SPA removed) fails before
   any wheel is produced with the intended error message. An
   undocumented `PD_PREP_SKIP_SPA_CHECK=1` escape hatch exists for
   the rare case of intentionally headless wheels.

Remaining nicety (not blocking close):

- DEVELOPMENT.md note that `make build` is the canonical path. The
  hook now makes `uv build` *also* safe, so this is informational
  rather than load-bearing.

**Gap:** the "wheel must include the SPA build" gotcha (CLAUDE.md, README)
has no automated guard.

Two failure modes silently slip past CI today:

1. `tests/test_spa_fallback.py` skips itself when
   `src/pd_prep_for_pgdp/static/index.html` is missing (see the
   module-level `pytestmark = pytest.mark.skipif(not _spa_built(), ...)`).
   The `test` job in `.github/workflows/release.yml` does not run
   `make frontend-build` before pytest, so on every PR/main push these
   tests skip and report green.
2. `make ci` chains `frontend-build` via `make build`, but anyone
   building the wheel directly (`uv build`, `pip wheel`,
   ad-hoc release scripts) bypasses that. There's no
   `MANIFEST.in` / `pyproject` check that asserts the built wheel
   contains `pd_prep_for_pgdp/static/index.html`.

**Concrete next steps:**

1. Add `make frontend-build` (or download the `build-frontend` artifact
   already produced in the release workflow) to the `test` job in
   `release.yml` so the SPA fallback tests actually execute in CI.
   Alternatively, fail-loud: convert the `skipif` in
   `test_spa_fallback.py` to a hard `pytest.fail(...)` when the
   `CI` env var is set, so CI is forced to build the SPA.
2. Add a `tests/test_wheel_contents.py` (or a `make verify-wheel`
   target invoked by `make build`) that runs `uv build`, then
   `python -m zipfile -l dist/*.whl | grep static/index.html`
   and fails the build if the bundled SPA is missing. This catches
   the "wheel built outside `make`" case.
3. Document in `DEVELOPMENT.md` that `uv build` directly is not the
   supported path — `make build` is canonical because of step 2.

**Acceptance:**

1. Removing `src/pd_prep_for_pgdp/static/` and pushing a PR makes CI
   red on the test job, not silently green.
2. Building a wheel without the SPA bundle (e.g.
   `rm -rf src/pd_prep_for_pgdp/static && uv build`) fails locally
   before the wheel is produced, with a message pointing the user
   at `make frontend-build`.

**Why P4:** this is an operations / CI safety net, not a user-facing
feature. The cost of the bug today is "first user of the broken wheel
sees a blank page and reports it"; the fix cost is small.

### 26. Frontend ESLint + Prettier pre-commit hooks

`.pre-commit-config.yaml` runs `markdownlint-cli2` and `frontend-tsc` but
no JS/TS lint or format check. `frontend/package.json` already has
`"lint": "eslint . --ext .ts,.tsx"` but no `eslint.config.*` flat config
in `frontend/`, and Prettier isn't wired at all (no `.prettierrc`, no
`format` / `format:check` scripts, no devDep).

**Plan:**

1. Land an `eslint.config.ts` (flat) under `frontend/`, add Prettier as a
   devDep with `.prettierrc` + `format` / `format:check` scripts, confirm
   `npm run lint` and `npm run format:check` are green from a clean tree.
2. Add two `repo: local` hooks (parallel to `frontend-tsc`) that shell
   into `frontend/` for `npm run lint` and `npm run format:check`,
   scoped to `^frontend/.*\.(ts|tsx|js|jsx|css|json)$`.

**Rationale:** workspace alignment with pd-ocr-labeler-spa, which
deferred the same hooks pending its M0 frontend-lint scaffold (D-037).

### 27. (markdownlint-cli2 hook — already in place)

`v0.22.1` of `DavidAnson/markdownlint-cli2` is wired in
`.pre-commit-config.yaml` (lines 25–32) against `.markdownlint-cli2.jsonc`.
No action needed; pd-ocr-labeler-spa mirrored from here.

### 28. Guard `upgrade-deps` against silent dev-local revert

`make upgrade-deps` ends with `uv sync --group dev`, which silently
overwrites an editable `pd-book-tools` install (from
`make dev-local` / `make install-local`) with the canonical git-tag
pin in `pyproject.toml`. Contributors lose their sibling-repo edits
without warning.

Spec: `docs/dev-local-upgrade-flow.md`. Workspace-wide contract;
detection anchors on `uv pip show pd-book-tools` reporting an
`Editable project location:` line, with a `.venv/.dev-local` marker
file fallback and `PD_DEV_LOCAL=1` env-var override. Default
`upgrade-deps` refuses with a message in dev-local mode and points
at a new `make upgrade-deps-local` recipe that re-installs the
editable sibling after the lock+sync. Canonical-mode behavior
unchanged. Cross-platform.

**Why P4:** operations / dev-experience safety net. The bug today is
"contributor's pd-book-tools edits stop taking effect after a routine
dep refresh"; the fix is a small detection step plus a sibling
recipe.

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

## How to pick up

1. Read `docs/01-overview.md` (this directory) for the high-level shape.
2. Read the relevant spec for whatever layer you're touching.
3. Pick the lowest-numbered open item in this file (P0 first); items
   marked "— done" are already shipped and kept here for context.
4. TDD-first when possible; the test recipe is in `docs/07-testing.md`.
5. When you finish an item, edit it in place — append "— done" to the
   heading and a one-paragraph note describing what landed and where.
