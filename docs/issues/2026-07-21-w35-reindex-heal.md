---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-07-21
Kind: issue
Level: I1
---

# `reindex --heal` is dual-write exit path but ops/runbook surface is thin (W3.5)

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-07-21
- **Resolution:** Open
- **Severity:** Medium — recovery CLI exists; operators and exit criteria under-documented
- **Affected version:** pdomain-prep-for-pgdp (main @ 2026-07-21)
- **Read when:** dual-write drift, orphan stage artifacts, crash recovery, or Wave 3 ops.
- **Search terms:** pgdp-prep reindex, --heal, dual-write, orphan, hash mismatch, reconcile, W3.5
- **Relates to:** [pipeline completion review](../plans/2026-07-21-pipeline-completion-review.md)

## Summary

`pgdp-prep reindex [--heal]` is the designed arbiter when on-disk stage
artifacts and `page_stages` / project stage rows disagree. The CLI and unit
tests cover orphan quarantine, missing-file → failed, hash mismatch → dirty,
and stale stage_version. Gaps remain: no operator runbook under
`docs/runbooks/`, incomplete product framing as the dual-write *exit* path
alongside job reclaim (W3.4), and plan-level exit criteria that still need a
single documented “heal restores known cases” checklist for self-hosters.

## Impact

- After crashes or partial dual-writes, users may not know to run
  `pgdp-prep reindex --heal`.
- Support/debug loops re-discover CLI flags from source instead of a runbook.
- Wave 0 dual-write work depends on heal remaining trustworthy; gaps in
  docs risk underuse.

## Environment / versions

```
CLI: pgdp-prep reindex [--heal] [--json] [project_id]
code: src/pdomain_prep_for_pgdp/cli/reindex.py
tests: tests/test_reindex_cli.py, tests/test_fts_search.py (FTS heal)
runbooks/: only docs/runbooks/dev-local-upgrade-flow.md (no reindex runbook)
```

## Evidence

### 1. CLI documents heal mutations

```
# cli/reindex.py header
Read-only by default; ``--heal`` mutates:
- orphan files → .orphan-stage-artifacts/ …
- missing files → row failed + cascade dirty
- hash mismatches → row dirty (file kept)
```

### 2. Unit coverage exists for core heal cases

`tests/test_reindex_cli.py` includes (among others):

- `test_reindex_heal_marks_missing_failed_and_cascades_dirty`
- `test_reindex_heal_cascades_descendants_dirty`
- `test_reindex_after_heal_is_clean`
- `test_reindex_heal_quarantines_orphans`
- `test_reindex_heal_marks_hash_mismatch_dirty_keeps_file`
- `test_reindex_heal_marks_stale_version_rows_dirty`

So “no tests” is false; the gap is ops packaging and completeness of
exit-path narrative, not a total absence of automated coverage.

### 3. No runbook

`docs/runbooks/` has no reindex/heal document. Parent plan W3.5:
“exercised in test **or** runbook; document as dual-write exit path.”

### 4. Architecture points at heal as mutator

`page_stage_writer.py` / dual-write comments treat `reindex --heal` as the
reconcile mutator; CLAUDE.md dual-write contract names reindex as
source-of-truth arbiter.

## Root-cause hypotheses

1. **(Most likely) Implementation shipped; ops docs lagged** — M1 §D tests
   landed, product runbook never written.
2. **Scope creep into W3.4** — stuck `running` jobs are not healed by reindex
   today; operators confuse job reclaim with stage dual-write heal.

## Defects to fix

1. **Runbook: when and how to run `pgdp-prep reindex --heal`** — orphan /
   missing / hash / stale-version outcomes, exit codes, safety. (Primary)
2. **Cross-link dual-write exit paths** — reindex heal (artifacts) vs startup
   job reclaim (W3.4) vs cancel (W3.6).
3. **Fill any heal case gaps** the runbook claims but tests miss (document
   or add tests); keep FTS heal story consistent (`test_fts_search.py`).

## Next steps

1. Draft `docs/runbooks/reindex-heal.md` with copy-paste commands and expected
   summaries.
2. Spot-check heal against a hand-broken dual-write fixture; extend tests if
   a claimed case fails.
3. Point architecture / CLAUDE dual-write notes at the runbook.

## What is NOT broken

- CLI entrypoint and `--heal` mutations are implemented.
- Substantial unit coverage for page-stage reconcile already exists.
- Read-only reindex drift exit code 2 works for detection without mutation.

## Resolution

*Open.* When fixed: set frontmatter + Agent Index `Status: retired`, link
runbook + any new tests, route retirement through `doc-retirer`.
