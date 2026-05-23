# Full-text search across OCR pages

> **Status**: Draft
> **Last updated**: 2026-05-11
> **Spec-Issue**: ConcaveTrillion/pd-prep-for-pgdp#46

## TL;DR

For books with hundreds or thousands of pages, the proofer needs to search OCR text to jump to a
specific page. M5+ feature: index OCR text into SQLite FTS5 on `text_postprocess` clean writes,
expose a `GET /search` endpoint, render a search bar with snippet results that navigate to the
workbench at the matched page. Designed so a future Postgres backend can replace the FTS5 layer
behind the same contract.

## Context

Today there is no way to search OCR text across a project. The workbench page navigator is
positional (`f001`, `f002`, …); for a 600-page book, finding "the page where Chapter 7 begins" or
"the page where the citation typo lives" means scrolling.

OCR text becomes available after the `text_postprocess` stage writes its clean artifact. That write
is the natural index trigger. SQLite FTS5 ships with the Python `sqlite3` standard library; in a
future managed/Postgres backend the equivalent is Postgres `tsvector`.

Parent (retro-demoted on 2026-05-11): #14. Roadmap section: `docs/plans/roadmap.md` §P2 #13 (lines
~591–595).

## Constraints

- **Local-first.** Active backend is SQLite + filesystem; Postgres is deferred.
- **Index update at stage boundary.** Search text comes from `text_postprocess` clean writes; the
  index update is part of that write transaction (so a re-run of `text_postprocess` updates the
  index and an `auto_detect_attrs` cascade-dirty correctly invalidates downstream search staleness
  only after `text_postprocess` re-runs).
- **No new heavy dependencies.** SQLite FTS5 is in-tree.
- **Split-children:** the FTS5 row keys on `page_id` (not `idx0`), so split children index
  independently.
- **Adapter contract:** `IDatabase` adapter should expose a `search()` method so the future Postgres
  adapter implements `tsvector` behind the same interface.
- **No retroactive indexing of pre-M1 projects** until a migration is run (M4-style lazy migrate).

## Decision

**Storage:** new SQLite FTS5 virtual table `page_text_fts` with columns `(page_id, project_id, idx0,
ocr_text)`. `page_text_fts` is content-rowid-linked to a small companion table `page_text` with the
same columns (FTS5's standard `content` pattern); the companion is the authoritative store and FTS5
is the index.

**Index update path:** the `text_postprocess` stage runner's clean-write transaction additionally
upserts the `page_text` row and the FTS5 index row, in the same DB transaction (so reindex's
reconciliation catches index drift the same way it catches stage-row drift).

**API:**

- `GET /api/data/projects/{id}/search?q=<query>&limit=<n>&offset=<n>` — returns `{results:
  [{page_id, idx0, snippet, score}, ...], total_count: <n>}`. Snippet uses FTS5's built-in
  `snippet()` function. Default limit 20; offset for pagination.
- Result shape includes `idx0` so the frontend can navigate via the existing page-navigation URL
  pattern.

**Frontend:**

- A search bar component in the project workbench shell (not in the global nav) — search is scoped
  to one project at a time.
- Result panel lists hits as `{page label e.g. "Page 47 (idx 46)"} — {snippet with highlighted
  match} → click navigates to the workbench at that page`.
- Search bar uses the existing shadcn/ui `Input` primitive; result panel reuses the project
  page-list styling.

**Migration:** for pre-M1 projects (or post-M1 projects without `text_postprocess` shipped),
`pgdp-prep migrate-projects --search-rebuild` walks every page's existing OCR text and seeds the
index. Idempotent.

## Contract / Acceptance

- **Index update:** a successful `text_postprocess` clean write upserts the FTS5 row within the same
  transaction. The new text appears in search results within ≤1s of the stage write.
- **Search endpoint:** `GET /api/data/projects/{id}/search?q=foo` returns matches across the
  project's pages with snippet + page link. Empty query returns 400.
- **Pagination:** `limit` + `offset` parameters work; `total_count` is accurate.
- **Split-children indexed independently:** searching a term that appears only in a split child
  returns the child's page row, not the parent's.
- **Re-indexing on stage re-run:** rerunning `text_postprocess` on a page with changed config
  produces updated text in the FTS5 row; old text is gone.
- **`pgdp-prep migrate-projects --search-rebuild`:** invoked on a project missing the index,
  populates the index from existing OCR artifacts. Re-invoking is a no-op (or rebuilds
  idempotently).
- **Search bar UX:** typing a query → submitting → result panel renders within ≤500ms for a 600-page
  project on local SQLite.
- **Adapter contract:** `IDatabase.search(project_id, query, limit, offset)` is the only Postgres
  swap point; the FTS5 implementation is local-only.

## Trade-offs considered

- **FTS5 virtual table vs `pages.ocr_text` column with `LIKE`.** `LIKE` doesn't scale, lacks
  ranking, and lacks snippet. FTS5 ranking (BM25 by default) is fine for OCR text.
- **Index update at stage write vs lazy / on-demand / nightly.** Stage-write keeps the index fresh
  without a background job; lazy/nightly adds complexity and a separate failure mode. Decided:
  at-write, in-transaction.
- **Per-project vs cross-project search.** Cross-project is rarely needed (a proofer works on one
  book at a time) and complicates the URL / result shape. Decided: per-project.
- **Search bar location.** Global nav vs project workbench shell. Global nav requires knowing which
  project to search; project shell is unambiguous. Decided: project shell.
- **`content=` external content vs `content_rowid`-style direct.** FTS5 with an external content
  table is the idiomatic pattern when the indexed text might churn; chose external content for
  cleaner reindex semantics.
- **Ranking strategy.** BM25 default is good enough for first release; ranking tuning is a deferred
  concern.

## Consequences

- **Index storage cost** roughly equals project OCR-text size; for typical books this is < 5 MB /
  project.
- **Stage-write transaction grows** by one upsert; negligible relative to the disk write for the
  artifact itself.
- **`IDatabase` adapter gains a method.** Local SQLite implements it via FTS5; future Postgres
  implements it via `tsvector` + `to_tsquery`.
- **Reindex CLI gains a sweep.** `pgdp-prep reindex --heal` now walks the FTS5 index for stale rows
  whose authoritative `text_postprocess` artifact has changed.
- **Migration of pre-existing projects** requires explicit user action (`migrate-projects
  --search-rebuild`) — search is not retroactively populated by lazy migrate alone.
- **Cross-page dirty propagation** does NOT affect search staleness — the search index updates only
  on `text_postprocess` clean write, not on upstream cascade-dirty (the text doesn't change until
  `text_postprocess` re-runs).

## Open questions

- **Ranking algorithm tuning.** BM25 default works but OCR text has artifacts (broken words,
  ligatures, dropped characters) that hurt match quality. Should the search apply lightweight
  normalization (lowercase, strip diacritics, expand long-s) before indexing? **Flagged for CT
  review** — recommend yes for the first cut; trade-off is search displays the *original* OCR
  snippet, not the normalized one.
- **Snippet length.** FTS5's `snippet()` defaults to a small window; for context-rich navigation a
  2-3 line snippet is preferable. **Flagged for CT review** — recommend ~200 chars with ellipses.
- **Search bar location confirmation.** Project workbench shell vs project list page (search across
  pages of the *currently-selected* project from the list view). **Flagged for CT review** —
  recommend workbench shell only.
- **Postgres TS contract surface.** What does `IDatabase.search()` return on a backend whose ranking
  semantics differ from FTS5 BM25? Should the contract pin a normalized score range, or expose
  backend-specific scores? **Flagged for CT review** — recommend normalized score `[0.0, 1.0]` so
  frontend ranking presentation is backend-agnostic.
- **OCR-text scope for indexing.** Does the index include footnote/header/footer/abandoned
  role-labeled words, or just main-text words? Workspace memory ("never silently drop OCR words")
  implies all words must be retrievable; CT may want role-aware result filtering. **Flagged for CT
  review** — recommend all words indexed with role exposed in the result, frontend can filter.
- **Cross-project search as a future feature.** Should the `IDatabase.search()` contract leave room
  for a `project_ids` list parameter, or stay strictly per-project? **Flagged for CT review** —
  recommend per-project signature; cross-project is a separate endpoint when needed.

## References

- Roadmap: `pd-prep-for-pgdp/docs/plans/roadmap.md` §P2 #13 (lines 591–595)
- Long-form pipeline spec: `pd-prep-for-pgdp/docs/specs/pipeline-task-model.md` §`text_postprocess`
- Pipeline-task-model design (this spec set): `2026-05-11-pipeline-task-model-design.md`
- Adapter pattern reference: `pd-prep-for-pgdp/src/pd_prep_for_pgdp/adapters/`
- Parent spec issue (retro-demoted): #14
- This spec's issue: #46
