---
kind: handoff
status: "active"
created: "2026-11-11"
created_at: "2026-11-11T08:49:11Z"
owner: "CT"
branch: "fix/zip-entry-timestamps"
scope: "wave2-interface"
worktree: "/mnt/work/projects/pdomain/pdomain-prep-for-pgdp/.worktrees/zip-entry-timestamps"
base_commit: "ce1f5577abc3a44883d48b36539789fca661e145"
supersedes: "2026-11-11-080600-text-zones-konva-and-postgres-adapter-committed.md"
handoff_reason: "stopping"
host: "claude-code"
---

# Submission zip entries now take their time from built_at, so identical builds match byte for byte

## Goal

Fix the timestamp bug in `build_submission_zip`: it called `writestr` with bare filenames, so each entry took the
current time and two builds of the same input could differ. Work test-first in a new worktree branched from
`feat/night-prep4`.

`fix/zip-entry-timestamps` starts from `feat/night-prep4`, which starts from `feat/night-wave3`, then
`feat/wave2-interface`, then `fix/job-reliability`. None of the five is merged. Nothing was pushed, merged, tagged,
released or deployed.

## Done

- Checked the three named branches first. Commit `6bc1a07` on all of them records the bug in
  `docs/issues/2026-11-11-submission-zip-entry-timestamps.md`. None of them fixed it.
- Commit `ce1f557` fixes it. All five entry kinds go through `_zip_entry`, which builds a `ZipInfo` whose time comes
  from `built_at`. `_zip_date_time` converts the time to UTC, reads a value with no zone as UTC, and clamps it to
  1980-01-01. Each entry keeps `ZIP_DEFLATED` and mode 0600, as `writestr` set before.
- The `build_submission_zip` docstring now says `built_at` sets every entry time, and that omitting it gives a
  non-reproducible archive.
- The issue report now says "Fixed on `fix/zip-entry-timestamps`, awaiting merge", following the Postgres report.

## Verification

- The new tests in `tests/test_submission_zip_reproducible.py` failed first. Four of the five original tests failed;
  the deflate test passed and guards against losing compression. Two builds with the zip clock moved first differed at
  byte 10, the time field of the first local header.
- After the fix, the six new tests and the 81 existing tests in the related packaging test files passed.
- `make ci AI=1` exited 0, captured as the exit status of `make` itself, not of a pipe. It ran with
  `CUDA_VISIBLE_DEVICES` empty and `TMPDIR=/mnt/work/pdt/prep5`.
- The commit hooks passed, including ruff, basedpyright, markdownlint and gitlint.

## Failed approaches and mistakes

None.

## Decisions

- The clock is moved in the test by replacing `zipfile.time` through `monkeypatch`, so the global `time` module is
  untouched.
- A bad `built_at` string now raises `ValueError`. The only producer, `project_stage_kwargs.py`, passes the run's ISO
  start time.

## Not done

- No independent code review ran for `ce1f557`.
- The issue report stays active. Retire it through `doc-retirer` after merge, which deletes it and writes a tombstone.
- Everything listed under "Not done" in the superseded handoff is still not done.

## Decisions the owner still needs to make

This fix needs no owner decision. All open decisions from the superseded handoff still stand: split suggestions, the
split parent in the grid, Postgres in CI, the W3.9 folio detector, the audit gate, and opening a clean page in the
review. The archived copy is `docs/_archive/handoff/2026-11-11-080600-text-zones-konva-and-postgres-adapter-committed.md`.

## State

The working tree is clean after this handoff commit. Temporary files are in `/mnt/work/pdt/prep5`.

## Pointers

- `src/pdomain_prep_for_pgdp/core/pipeline/steps/build_package.py`
- `tests/test_submission_zip_reproducible.py`
- `docs/issues/2026-11-11-submission-zip-entry-timestamps.md`
- `docs/_archive/handoff/2026-11-11-080600-text-zones-konva-and-postgres-adapter-committed.md`

## Resume steps

1. Review `git log feat/night-prep4..fix/zip-entry-timestamps`. Merge in order: `fix/job-reliability`,
   `feat/wave2-interface`, `feat/night-wave3`, `feat/night-prep4`, then this branch.
2. Follow the remaining resume steps in the archived predecessor handoff.
3. After merge, retire the zip timestamp issue report through `doc-retirer`.
