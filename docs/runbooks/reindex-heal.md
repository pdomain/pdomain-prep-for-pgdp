---
Kind: runbook
Status: active
Owner: CT
Created: 2026-11-11
Last verified: 2026-11-11
---

# Repair stage files and database rows that disagree with reindex --heal

## Agent Index

- **Kind:** runbook
- **Status:** active
- **Last verified:** 2026-11-11
- **Read when:** page-stage files and `page_stages` rows disagree after a crash, a partial write or manual file edits.
- **Search terms:** pgdp-prep reindex, --heal, dual-write, orphan, hash mismatch, stale version, reconcile, quarantine.

## Trigger

Run `pgdp-prep reindex` when a page shows a stage as done but its output is missing, when an output looks wrong
for its status, or after a crash or disk restore. Every stage write updates a file and a database row together.
The command finds the pages where those two records no longer agree, and `--heal` repairs them.

Reindex is one of three recovery paths, and each handles a different problem:

| Problem | Recovery path |
| --- | --- |
| Stage files and rows disagree | `pgdp-prep reindex --heal`, this runbook |
| A queued job was `running` when the app stopped | Restart the app. Startup marks those jobs as failed |
| A job is still queued or running and should stop | `POST /api/data/projects/{id}/stages/{stage_id}/cancel` |

Heal does not reclaim jobs, and it skips rows in `running`. Startup clears `running` stage rows only in projects that had
a `running` job.

A page-stage row left `running` by an interrupted synchronous request has no job, so neither path clears it. Re-run that
page and stage as shown in step 4 to replace the row.

Reindex scans only page directories that exist. If a whole `pages/<page_id>/` directory is gone, its rows are neither
reported nor healed. Restore that directory from a backup or re-import the project.

## Preconditions

Stop `pgdp-prep` before every step here, including the first scan. The command takes no lock. A heal can move a file
that a running job is about to read, and the first scan rewrites `project_stages.db`.

Find the data root. The command uses `--data-root` when given, then `PGDP_DATA_ROOT`, then `~/pgdp-projects`.
The database is `state.db` in that data root unless `PGDP_DATABASE_URL` is set.
A set value wins over `--data-root`, so use
the same value the app runs with.

The commands below assume the default owner `default`. Add `--owner-id <id>` for one other owner, or `--all-users`
for every owner.

## Steps

1. Report drift without repairing it. Name a project ID to limit the scan to that project.

   ```sh
   pgdp-prep reindex <project_id>
   ```

   Exit status 0 means no page has drift. Exit status 2 means at least one page has drift. Exit status 1 means the
   project was not found or belongs to another owner, so retry with `--owner-id` or `--all-users`. Add `--json` for a
   structured report.

   This scan does not change page-stage rows or files. It does rewrite project-stage rows in `project_stages.db` from
   the project-stage files on disk, and it keeps any row already marked `dirty` or `failed`.

2. Read the report and check that each listed file is one you expect to change. The table under Verification
   shows what heal does to each kind of drift.

3. Repair the drift.

   ```sh
   pgdp-prep reindex <project_id> --heal
   ```

   The summary line looks like this:

   ```text
   reindex --heal: scanned 4 page(s); 1 orphan(s) quarantined, 1 row(s) marked failed, 1 row(s) marked dirty, 1 stale-version row(s) marked dirty, 0 descendant(s) cascaded to dirty, 0 FTS entry/entries rebuilt
   ```

   The first "marked dirty" count covers hash mismatches only.

4. Start the app and re-run the stages that are now `failed` or `dirty`, earliest stage first, because a stage reads the
   output of the stage before it. Name the zero-padded page IDs in each request.

   ```sh
   curl -X POST "http://127.0.0.1:8765/api/data/projects/<project_id>/project-stages/<stage_id>/rerun" \
     -H 'Content-Type: application/json' -d '{"page_ids": ["0000"]}'
   ```

   That route covers page stages. Run a project stage, such as `build_package`, with
   `POST /api/data/projects/<project_id>/project-stages/<stage_id>/run`. Both examples assume `auth_mode` is `none`.
   With authentication on, send the same credentials the app uses.

## Verification

Run the read-only scan again. It should exit 0.

```sh
pgdp-prep reindex <project_id>
echo $?
```

Each kind of drift should end in the state shown here.

| Drift | How it is detected | Result of `--heal` |
| --- | --- | --- |
| Orphan file | A file under an unknown stage, with no row, with a row in `not_run` or `not_applicable`, or an extra `output.*` file | Moved under `<data_root>/projects/<id>/.orphan-stage-artifacts/`, with a manifest entry |
| Missing file | A `clean` row whose output file is gone | Row becomes `failed`. Later `clean` stages on that page become `dirty` |
| Hash mismatch | A `clean` row whose file has a different hash | Row becomes `dirty` and the file stays for inspection. Later `clean` stages on that page become `dirty` |
| Old stage version | A `clean` row with a `stage_version` below the current one | Row becomes `dirty` and the file stays. Only `--heal` checks this, so the read-only scan does not report it |
| Missing search text | A `clean` `text_review` page with no full-text search entry | Entry rebuilt from `output.txt`. Only `--heal` checks this |

Files for rows in `dirty`, `failed` or `running` are not orphans. Those rows keep their last output until the next
run replaces it, so a second heal leaves those files alone.

## Rollback

Heal deletes nothing. To restore a quarantined file, find its line in `.orphan-stage-artifacts/manifest.jsonl`. The `from`
and `to` fields are paths relative to the data root, so move the file at `to` back to `from`. A repeat quarantine of the
same name adds a `.N` suffix to the quarantined file. A row that heal changed returns to `clean` when you re-run its stage.

## Evidence

`tests/test_reindex_cli.py::test_heal_repairs_every_drift_kind_in_one_pass` breaks one project in four of these ways,
heals it
and confirms that the next scan exits 0. `tests/test_fts_search.py` covers the search rebuild. The command is
implemented in `src/pdomain_prep_for_pgdp/cli/reindex.py`.
