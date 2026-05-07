# 08 — Roadmap

> Shipped items live in `08-roadmap-shipped.md` — kept out of this file
> so the active roadmap stays focused on open work.

This roadmap is the **forward** view, organised by priority. Shipped
work is in `08-roadmap-shipped.md`; per-iteration history lives in
`git log`.

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

### 17. Spec question: `compute_prefix` first-frontmatter-page numbering

Logged in iteration 1. The spec's loop `range(start, min(idx0, end+1))` is
empty when `idx0 == start`, so the first frontmatter page resolves to
`f000` instead of `f001` despite `frontmatter_page_nbr_start=1`.
Implementation matches the spec verbatim — `test_compute_prefix_basic_numbering`
asserts the current `f000` behavior, so this is **not a latent bug**: any
change to `f001` would be an *intentional* rewrite of the spec, and the
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

## How to pick up

1. Read `docs/01-overview.md` (this directory) for the high-level shape.
2. Read the relevant spec for whatever layer you're touching.
3. Pick the lowest-numbered open item in this file (P0 first); shipped
   items live in `08-roadmap-shipped.md` for context.
4. TDD-first when possible; the test recipe is in `docs/07-testing.md`.
5. When you finish an item, **move it out** of this file into
   `08-roadmap-shipped.md` with a condensed summary + commit SHAs.
   Don't leave shipped items in this file with a "done" flag.
