---
kind: handoff
status: "active"
created: "2026-11-11"
created_at: "2026-11-11T07:20:44Z"
owner: "CT"
branch: "feat/night-wave3"
scope: "wave2-interface"
worktree: "/mnt/work/projects/pdomain/pdomain-prep-for-pgdp/.worktrees/night-wave3"
base_commit: "a45325c42cc7666c751b936a135f7c09e47b58d8"
supersedes: "2026-11-11-063139-wave-2-interface-items-committed-and-awaiting-review.md"
handoff_reason: "stopping"
host: "claude-code"
---

# The Wave 2 screens pass in a real browser, and four of five issues are done

## Goal

Run the Wave 2 screens in real Chromium and fix what fails. Then do W3.2, W3.3, W3.5, W3.9 and the dependency audit
gate, one commit each and test-first, skipping anything that needs an owner decision.

`feat/night-wave3` starts from `feat/wave2-interface`, which starts from `fix/job-reliability`. None of the three is
merged. Nothing was pushed, merged, tagged, released or deployed.

## Done

- `b2e78d1` Wave 2 browser fixes. Queued page runs now publish stage events, so an open review refreshes after Re-run.
  The review also refetches when the Re-run response returns, because the job can finish first. Saving settings clears
  the edited state and shows the tier badge. Clicking another page with an editor open now switches to it. The shell's
  tab strip now drives the Source tool's pane.
- `59470c4` W3.2. `make ci` runs `make e2e-smoke`: app load, 24 tool slots and zip upload.
- `532777a` W3.3. Seeded flags drive a real text review approval test, and wordcheck coverage goes beyond rendering.
- `1c9393b` W3.5. New runbook `docs/runbooks/reindex-heal.md`. The spot-check found that a scan after heal still reported
  drift, and that a second heal would quarantine files heal had kept. Files of dirty, failed and running rows are no
  longer orphans. The heal summary now reports the stale-version count.
- `88d4e14` W3.9, only the part that needs no detector. Persisted folios are reconciled on load, so a disagreement flags
  the page and blocks confirm.
- `a45325c` `make audit` audits Python and pnpm dependencies and skips private `pdomain-*` packages.

`make ci AI=1` exited 0 for each commit, from its own recorded status. The files are `ci-w2fix.status`, `ci-w32.status`,
`ci-w33.status`, `ci-w35.status`, `ci-w39.status` and `ci-audit.status` in `/mnt/work/pdt/prep3`. Two commits changed
slightly after their gate, and their commit hooks passed: `b2e78d1` for a type-parameter lint fix, and `1c9393b` for two
line wraps in the runbook. The full Playwright suite on the final tree gave 66 passed and 1 skipped.

The runbook had one independent review with a focused recheck, and all findings were fixed. The final readability pass
ran.

## Not done

- W3.9's detector was skipped. See the first owner decision.
- Nothing ran on a real book. Browser tests use synthetic pages on CPU, with the GPU hidden. The `make run` spot-checks
  in the W2.1, W2.2 and W2.3 reports are still open.
- `make audit` is not part of `make ci`. See the second owner decision.
- The code review pass covered only the runbook. The code commits had tests and gates but no independent reviewer.
- Issue reports are not retired. Retire W3.2, W3.3, W3.5 and the audit gate report through `doc-retirer` after merge.
  W3.9 must stay open.

Defects seen and left alone:

- Wordcheck Fix and Keep drop the row, but `persistDecision` in `frontend/src/machines/tools/wordcheckTool.ts` has no
  effect, so the decision is lost on reload.
- `approve-low-risk` always returns an empty list.
- Text review shows "complete, all items signed off" on a project with nothing to review.
- From reading the code, not from a real run: the text_review stage writes a clean row, and the queue treats clean rows
  as attested. A real stage run may therefore empty the queue.

## Failed approaches

- `--timeout` is not a pytest option in this repo.
- `make ci` skips untracked files in its pre-commit step. Stage new files before the gate, or the commit hook finds the
  lint errors later.
- `EnterWorktree` cannot branch from a named local branch. Use `git worktree add`, then enter by path.

## Decisions

- Three existing browser tests were stale, and I changed them to match the shipped screens: the settled text tool
  surfaces and the Stage settings button role.
- A `dirty`, `failed` or `running` row keeps its last output, so its file is not drift.
- `make ci` now needs Chromium. `DEVELOPMENT.md` has the install command.

## Decisions the owner still needs to make

1. **W3.9 detector.** `pdomain-book-tools` 0.28.0 has no folio detector, and this run could only change this repo. The
   report leaves open whether it is a dedicated stage or an OCR side product. Now that folios are reconciled on load, any
   wrong read blocks page-order confirm, so also decide whether a disagreement should block or only warn.
2. **Audit gate.** The lockfile has 58 Python advisories: pillow 39, filelock 13, transformers 3, certifi 2 and setuptools
   1. pnpm reports none. Wiring `make audit` into `make ci` would fail every run until those are upgraded. Decide between
   upgrading first and a scheduled run, and whether to use Dependabot or Renovate.
3. **Opening a clean page in the review.** A clean page opens its editor only while another page's editor is open.
   After Re-run the editor closes and the page is clean, so comparing Before and After takes an extra step. Decide
   whether clean pages get a direct way in.

Carried over and still open: archive keep and drop, Bulk Re-run and Re-run stage, export scope, the local CORS default,
and the Stage Cancel button. Interrupted synchronous page runs now have a workaround, re-running the page, described in
the runbook.

## State

The working tree is clean after this handoff commit. Temporary files are in `/mnt/work/pdt/prep3`.

## Pointers

- `docs/runbooks/reindex-heal.md`
- `tests/e2e/test_wave2_screens_browser.py`
- `tests/e2e/test_seeded_text_chain_browser.py`
- `tests/e2e/test_page_order_ocr_folios_browser.py`
- `tests/fixtures/seed_stages.py`
- `scripts/dep_audit.py`
- `docs/issues/2026-07-21-w39-page-order-ocr-folios.md`
- `docs/issues/2026-11-09-dependency-audit-gate.md`

## Resume steps

1. Review `git log feat/wave2-interface..feat/night-wave3`. Merge `fix/job-reliability` first, then
   `feat/wave2-interface`, then this branch.
2. Under `make run` on a real book, try the checks still open from the W2.1, W2.2 and W2.3 reports.
3. Answer the owner decisions above.
4. After merge, retire the finished issue reports through `doc-retirer`.
