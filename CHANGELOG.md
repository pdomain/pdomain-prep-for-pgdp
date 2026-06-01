# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Changed

- Page persistence migrated to ops event store (pdomain-ops 0.7.0 PageAggregate +
  PagesApplication + BlobStore). The SQLite `pages` table is retained for legacy
  projects; all new page lifecycle events are stored in
  `<data_root>/projects/<id>/.pd-pages/events.db`. No data migration — greenfield
  projects only.
- All prep-domain page state (`idx0`, `prefix`, splits, blob hashes, processing
  status, outputs, split-child linkage) moves into `PrepPageExtension`, serialised
  into `PageRecord.extensions["prep"]` in the event store.
- Split turns one parent page into N first-class child pages in the event store;
  unsplit uses `ProjectAggregate.remove_page` (ops PageRemoved event, ops 0.7.0).
- `page_stages` per-page DAG table and FTS `page_text` / `page_text_fts` remain
  prep-owned on `IDatabase` (SQLite / Postgres).
- Wire API shape for page responses unchanged — `_ext_to_page_record` assembles
  the same `PageRecord` schema for the React frontend.
- `PageRecord` in `core/models.py` is now a pure wire/API-response model. The
  all-or-none split validator has moved to `PrepPageExtension`.
- Bumped `pdomain-ops>=0.7.0`, `pdomain-book-tools>=0.17.0`, added `eventsourcing>=9.0`.
