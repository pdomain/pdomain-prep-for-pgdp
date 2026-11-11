---
kind: handoff
status: "active"
created: "2026-11-11"
created_at: "2026-11-11T03:22:38Z"
owner: "CT"
branch: "fix/job-reliability"
scope: "job-reliability"
worktree: "/mnt/work/projects/pdomain/pdomain-prep-for-pgdp/.worktrees/fix-job-reliability"
base_commit: "15d5f3c28c55739565de607ceedc2bf7fa28e29e"
supersedes: ""
handoff_reason: "user_requested"
host: "claude-code"
---

# Job reliability work stopped before the first commit

## Goal

Make job handling reliable, in order: progress overwriting a cancel, the stage cancel route (W3.6), reclaiming stuck
running jobs (W3.4), SSE auth under JWT, and cookie and CORS hardening (W3.7).

## Done

- The fix for `2026-11-09-progress-overwrites-cancel` is written but uncommitted. It changes `core/job_runner.py` and
  the three database adapters.
- `tests/test_cancel_survives_job_writes.py` is written and untracked. Six tests failed for the expected reasons
  before the fix, including a cancelled unzip finishing as complete.

## Not done

- Nothing is committed on this branch. The first fix is held because full CI keeps failing.
- W3.6 is not built. A draft route test exists outside the tree.
- W3.4 and W3.7 are not started.
- The Wave 2 interface items were out of scope for this session.
- The session found that `build_submission_zip` calls `writestr` with bare filenames, so entries get the current time
  and a byte comparison test can fail across a timestamp boundary. It meant to record this. The diff contains no
  record yet.

## Failed approaches

- Full CI failed repeatedly, mostly on `test_delete_page_words`, with the known intermittent `SQL statements in
  progress` commit error inside the event library's `create_table` on a fresh event-store connection.
- An alternating comparison showed the failure only when the new test file is present. Unmodified code passed twice
  and the source change alone passed twice, so the source fix is not the suspect.
- The failure did not reproduce serially, nor by replaying the failing worker's test order. Turning coverage off did
  not remove it. Machine load reached 86 from other sessions during these runs, so load may contribute.
- `PGDP_GPU_BACKEND` raises a deprecation warning that the tests treat as an error. Use `PDOMAIN_GPU_BACKEND=cpu`.

## Decisions

- Owner chose a real cancel for W3.6: add `POST /stages/{stageId}/cancel`, mark that project's queued and running jobs
  for the stage as cancelled, and show an error in the UI if the cancel fails. A page already in a worker thread
  finishes and may still write its artifact.
- Owner chose to leave the JWT SSE report open until managed mode is scheduled. Do not build it now.

## State

Four modified source files and one untracked test file, no commits ahead of master. The owner paused this work on
2026-11-10 and the session's herdr tab is closed. Nothing was pushed, merged, tagged, released or deployed. All work
ran on CPU with the GPU hidden. The session's last terminal output is saved in
`/mnt/work/projects/pdomain/.artifacts/handoff-20261110/session-output/`. `/tmp` is a shared tmpfs that ran out of
quota several times on 2026-11-10 while ten sessions ran gates. If a gate fails with a quota error, point `TMPDIR` at
the work drive and rerun before suspecting the code.

## Pointers

- `/mnt/work/projects/pdomain/.artifacts/handoff-20261110/prep-job-reliability.patch`
- `/mnt/work/projects/pdomain/.artifacts/handoff-20261110/test_cancel_survives_job_writes.py`
- `/mnt/work/projects/pdomain/.artifacts/handoff-20261110/test_stage_cancel_route.py`
- `/mnt/work/projects/pdomain/.artifacts/handoff-20261110/ci2.txt`
- `/mnt/work/projects/pdomain/.artifacts/handoff-20261110/ci3.txt`
- `docs/issues/2026-11-09-progress-overwrites-cancel.md`
- `docs/issues/2026-07-21-w36-job-stage-cancel.md`
- `docs/issues/2026-07-21-w34-reclaim-stuck-running.md`
- `docs/issues/2026-07-21-w37-cookie-cors-hardening.md`

## Resume steps

1. The session's next step was to move the new tests into the existing cancel test file, fix that file's outdated
   docstring, and run the real gate. Do that first, on a quiet machine.
2. Commit the cancel fix once `make ci AI=1` passes.
3. Build W3.6 from the owner's choice above, using the draft route test.
4. Do W3.4, then W3.7.
5. Record the `build_submission_zip` timestamp bug as an issue.
