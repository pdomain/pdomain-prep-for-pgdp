---
Status: active
Owner: CT
Created: 2026-11-09
Last verified: 2026-11-11
Kind: issue
Level: I1
---

# Postgres adapter is selectable but lacks eight IDatabase methods

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-11-11
- **Resolution:** On master in `06d9a5c`
- **Severity:** Medium — Postgres deployments start, then fail at runtime on stage routes and job handlers
- **Affected version:** pdomain-prep-for-pgdp master @ `14f0ba8`
- **Read when:** working on the Postgres adapter, `build_database()`, managed persistence, or adapter contract tests.
- **Search terms:** PostgresDatabase, IDatabase, `build_database`, `page_stages`, NotImplementedError, tsvector,
  FTS, former GH #131
- **Relates to:** [backend architecture](../architecture/02-backend.md)

## Summary

`build_database()` returns `PostgresDatabase` for any `postgres://` URL, but the adapter does not implement
the full `IDatabase` protocol. Eight methods are missing and two more raise `NotImplementedError`. Startup
succeeds, so the failure only shows when a stage route or job handler calls a missing method. Migrated from
GitHub issue #131, which came from the 2026-05-22 deep code review.

## Impact

- Any Postgres-backed deployment fails on page-stage reads and writes, stage fan-out, and search.
- The failure is late: `build_database()` accepts the URL and the app starts normally.
- Local-first work is not affected. SQLite is the supported database, and managed persistence is deferred
  in the [roadmap](../plans/roadmap.md).

## Environment / versions

```
src/pdomain_prep_for_pgdp/adapters/database/base.py      IDatabase protocol
src/pdomain_prep_for_pgdp/adapters/database/postgres.py  PostgresDatabase (no base class)
src/pdomain_prep_for_pgdp/bootstrap.py                   build_database()
tests/test_postgres_adapter.py                           constructor and import tests only
```

## Evidence

### 1. Protocol methods missing from PostgresDatabase — checked 2026-11-09

Comparing `async def` names in `base.py` against `postgres.py` at `14f0ba8`:

```
missing: delete_page_stages_for_page, get_page_stage, init_page_stages_for_page,
         list_distinct_owner_ids, list_page_stages_by_project,
         list_page_stages_by_status, list_page_stages_for_page, put_page_stage
```

`PostgresDatabase` does not subclass `IDatabase`, so it does not inherit the protocol's default
`list_distinct_owner_ids()` either.

### 2. Search raises

`upsert_page_text()` and `search()` both raise
`NotImplementedError("Postgres FTS (tsvector) not yet implemented")`.

### 3. The builder suppresses the type error instead of failing fast

```python
# bootstrap.py build_database()
return PostgresDatabase(url)  # pyright: ignore[reportReturnType]  -- PostgresDatabase partial impl; page_stage methods pending
```

### 4. No contract test

`tests/test_postgres_adapter.py` covers import errors, URL schemes, and one no-op write. No shared test
runs the `IDatabase` contract against both adapters.

## Root-cause hypotheses

1. **(Most likely) The adapter predates the page-stage model.** The page-stage methods arrived with the
   pipeline task-model refactor and were added only to SQLite, since Postgres work is deferred.

## Defects to fix

1. **Complete `PostgresDatabase` against `IDatabase`, or make `build_database()` refuse Postgres URLs with a
   clear error until it is supported.** (Primary)
2. **Remove the `pyright: ignore` in `build_database()`** once the adapter satisfies the protocol.
3. **Add a shared adapter contract test** that runs against SQLite and, when available, Postgres.

## Next steps

1. Decide between failing fast now and finishing the adapter. Failing fast is small and honest while
   managed mode stays deferred.
2. If finishing it, implement the page-stage methods and Postgres full-text search, then add the contract test.

## What is NOT broken

- SQLite, the supported local database.
- The Postgres constructor's URL validation and the missing-extra error message.

## Resolution

On master in `06d9a5c`. Retire this report through `doc-retirer` when the issue file itself is closed.

The adapter was finished rather than made to fail fast, because a real local Postgres could be tested.

- `PostgresDatabase` implements all eight missing methods. Page stages live in a `page_stages` table with the same
  key, indexes and CHECK constraints as SQLite, limited to the v2 stage ids.
- Search uses a generated `tsvector` column with the `simple` configuration, `plainto_tsquery`, `ts_rank` with
  normalisation 32 for scores in (0, 1), and `ts_headline` snippets. Long s is folded to s, as in SQLite.
- `delete_project` also drops the project's page-stage rows, as SQLite does.
- The `pyright: ignore` in `build_database()` is gone; basedpyright accepts the adapter as an `IDatabase`.
- `tests/test_database_contract.py` runs one contract against SQLite and, when `PGDP_TEST_POSTGRES_URL` is set,
  against Postgres. It also checks without a database that the adapter defines every protocol method.

Verified against `postgres:17-alpine` in a throwaway Docker container on 127.0.0.1: 23 contract cases and the
existing adapter tests passed. `just ci` does not start Postgres, so CI runs only the SQLite half.

Not done: no migration path for an existing Postgres database created by the old schema, which lacked the new
tables. `CREATE TABLE IF NOT EXISTS` adds them on the next start. Ranking differs from SQLite's BM25 in detail;
the contract fixes only the order of clearly different matches.
