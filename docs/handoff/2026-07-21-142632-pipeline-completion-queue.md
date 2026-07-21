---
kind: handoff
status: "active"
created: "2026-07-21"
created_at: "2026-07-21T14:26:32Z"
owner: CT
branch: master
scope: pipeline-completion-queue
worktree: /workspaces/pdomain/pdomain-prep-for-pgdp
base_commit: 6d8c4ace628844573bc9553f199a72e2ba5c76b4
supersedes: ""
---

# Pipeline completion queue — session handoff

## Agent Index

- **Kind:** handoff
- **Status:** active
- **Read when:** resuming pipeline completion work after the deep review and
  issue decomposition session.
- **Search terms:** pipeline completion, Wave 0, text-chain contract, docs/issues,
  golden-path CI, B0 wordcheck flags, handoff.

## Goal

Make a real book finishable on `make run`: fix live pipeline blockers, then
deepen text/pack/UI. This session produced the forward queue as governed docs;
implementation has not started.

## Done this session

- Multi-agent deep review of the 24-stage pipeline (backend, FE, API, OCR→pack,
  tests, adapters, design handoff, image-prep).
- Adversarial review of the plan; applied gaps (B0 text-chain contract, weak
  Wave 0 exit, attestation writer, cover/oxipng, golden-path in Wave 0, etc.).
- Wrote plan: `docs/plans/2026-07-21-pipeline-completion-review.md`.
- Scaffolded `docs/issues/` (README + TEMPLATE) and **28 governed issues** for
  Wave 0–3 + parallel residual.
- Linked queue from `docs/plans/roadmap.md` and `docs/context/intent-map.md`.
- Second adversarial pass before commit: **2026-07-14 review-fixes tasks 1–7 and
  9 are already shipped** on main; parallel issue rewritten as residual only.
- Committed: `6d8c4ac` (`docs: pipeline completion review and decomposed issue
  queue`). Not pushed.

## Not done

- **No implementation** of Wave 0 blockers (W0.0–W0.6).
- Confirm W0.0 design with CT: compound wordcheck vs DAG rewire vs runner
  fan-in.
- Failing golden-path test skeleton (W0.6) not landed.
- Update draft status of `docs/plans/2026-07-14-review-fixes.md` (still says
  open work; code already fixed most tasks).
- Separate open handoff still active: issue-tracker GH migration
  (`docs/handoff/2026-07-17-issue-tracker-migration.md`) — note that
  `docs/issues/` now exists for *pipeline* issues; GH tracker migration of the
  48 open GitHub issues is still that other scope.

## Failed approaches / traps

- Treating “keep flag-only wordcheck” as the runner contract → silent wrong
  package `.txt` after partial B1 load fix. Plan now requires B0 first.
- Preferring `raw.txt` blindly into wordcheck breaks JSON words input.
- Claiming 2026-07-14 review fixes still open → re-do shipped suite auth /
  device / timeout / zip offload / rerun enqueue. **Do not reimplement.**
- Shell multi-page (W0.4) is still broken (page `0000` only); batched
  `rerun_project_stage_pages` **does** enqueue already — wire FE to it.

## Decisions

- Forward queue is the completion plan + `docs/issues/`, not roadmap P0–P3
  historical “all shipped.”
- W0.0 text-chain contract is the highest risk; golden-path CI is Wave 0 exit
  (W0.6), not Wave 3.
- `build_package` is PARTIAL for product packaging (no cover.png / oxipng vs
  legacy `core/packaging.py`).
- Local-first remains ahead of Modal/Postgres/S3 dual-write.

## Current state

- Branch: `master` @ `6d8c4ac` (ahead of origin by prior commits + this docs
  commit; check `git status` / `git log origin/master..HEAD` before push).
- Working tree clean after handoff commit (except this handoff file until
  committed).
- Implementation entry: Wave 0 issues under `docs/issues/README.md`.

## Pointers

- `docs/plans/2026-07-21-pipeline-completion-review.md` — authoritative plan
- `docs/issues/README.md` — open issue index
- `docs/issues/2026-07-21-w00-text-chain-contract.md` — start here (B0+B1)
- `docs/issues/2026-07-21-w02-project-stage-job-adapter.md`
- `docs/issues/2026-07-21-w03-text-review-attestation.md`
- `docs/issues/2026-07-21-w04-multi-page-stage-run.md`
- `docs/issues/2026-07-21-w05-text-zones-split-contract.md`
- `docs/issues/2026-07-21-w06-golden-path-ci.md`
- `docs/issues/2026-07-21-parallel-2026-07-14-review-fixes.md` — residual only
- `docs/plans/2026-07-14-review-fixes.md` — draft plan text still stale
- `src/pdomain_prep_for_pgdp/core/pipeline/stage_runner.py` — compound load
- `src/pdomain_prep_for_pgdp/core/pipeline/steps/wordcheck.py` — flags-only
- `src/pdomain_prep_for_pgdp/core/job_runner.py` — project stage kwargs bag
- `frontend/src/services/pipeline.ts` — page 0000-only runStage
- `docs/handoff/2026-07-17-issue-tracker-migration.md` — **other** scope (GH
  tracker cutover); do not mix with this queue unless CT says so

## Resume steps

1. Read `docs/plans/2026-07-21-pipeline-completion-review.md` Wave 0 table and
   `docs/issues/2026-07-21-w00-text-chain-contract.md`.
2. Confirm text-chain design with CT (three options in the plan Architecture
   section).
3. TDD first: failing golden-path / runner chain test (W0.6 skeleton) that
   asserts UTF-8 prose not flags JSON in text_review `output.txt`.
4. Implement W0.0+W0.1 parent load-by-consumer-need together.
5. Then W0.2 job adapter, W0.3 per-page attestation writer, W0.4 multi-page
   shell, W0.5 split body, land W0.6 green in `make ci`.
6. Use worktrees for implementation; `make ci AI=1` before each commit; do not
   push without say-so.
7. Optionally mark `docs/plans/2026-07-14-review-fixes.md` residual/shipped so
   agents stop re-opening fixed suite/device tasks.
