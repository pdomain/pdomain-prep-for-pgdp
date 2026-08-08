---
Status: active
Owner: CT
Created: 2026-08-08
Last verified: 2026-08-08
Kind: issue
Level: I1
---

# dep-refresh cannot auto-land: dated branches, no delete-on-merge

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-08-08
- **Resolution:** Open
- **Severity:** Medium — currently latent (Actions is disabled for this repo,
  so nothing has run yet), but the workflow's own design still guarantees
  branch/PR accumulation once it runs
- **Affected version:** pdomain-prep-for-pgdp @ d1dc763
- **Read when:** touching `.github/workflows/dep-refresh.yml`, investigating
  stray `dep-refresh/*` branches, or re-enabling GitHub Actions for this repo
- **Search terms:** dep-refresh, dated branch, delete_branch_on_merge, auto-merge,
  stray branches, actions disabled, gh api actions/permissions
- **Relates to:** [issues index](README.md)

## Summary

`.github/workflows/dep-refresh.yml` names a fresh branch every run
(`dep-refresh/$(date +%Y-%m-%d)-$GITHUB_RUN_ID`) and the repo has
`delete_branch_on_merge: false`, so every run — green or red — leaves a branch
behind and a red run leaves an open, unmerged PR behind too. This repo shows 0
stray `dep-refresh/*` branches and 0 open dep-refresh PRs today, but that is
not evidence the design is safe: `gh run list --workflow dep-refresh.yml`
returns zero runs ever, and `gh api repos/.../actions/permissions` reports
`"enabled": false` for this repo, contrasted with `"enabled": true` on
`pdomain-book-tools`, which runs `dep-refresh` on schedule regularly (e.g.
2026-08-02, 2026-07-26). The workflow has not been exercised because GitHub
Actions cannot run here yet, not because anyone cleaned anything up. The
zero-accumulation state is preventive, not evidence of a working design.

Separately, `pdomain-ops` — a sibling repo whose dep-refresh runs are not
blocked — already carries 7 stray `dep-refresh/*` branches, which is the
accumulation this workflow's structure produces once it actually executes.

## Impact

- No accumulation yet, but none is possible to observe either: the workflow
  has literally never run in this repo, so the current 0/0 count says nothing
  about whether the design is fixed.
- If/when GitHub Actions is re-enabled for this repo, the schedule (`cron: '0
  2 * * 0'`) will start firing weekly, and the dated-branch + no-delete design
  will start accumulating branches and PRs exactly as it has in `pdomain-ops`
  (7 stray branches) and as it did in `pdomain-ui` before a human batch-closed
  four accumulated PRs (`#57`–`#60`).
- Landing the fix now, while the repo is inert, is strictly cheaper than
  landing it later against a pile of accumulated branches.

## Environment / versions

```text
pdomain-prep-for-pgdp @ d1dc763
.github/workflows/dep-refresh.yml   BRANCH="dep-refresh/$(date +%Y-%m-%d)-$GITHUB_RUN_ID"
repo setting                        delete_branch_on_merge: false
branch protection (master)          required_status_checks.contexts: ["ci"]
.github/workflows/ci.yml            single job named "ci" (no sharding)
repo Actions permissions            enabled: false  (gh api repos/.../actions/permissions)
comparison repo                     pdomain-book-tools: actions/permissions enabled: true,
                                     dep-refresh ran on schedule 2026-08-02 and 2026-07-26
```

## Evidence

### 1. The workflow has never run

```text
$ gh run list --repo pdomain/pdomain-prep-for-pgdp --workflow dep-refresh.yml --limit 10 --json databaseId,status,conclusion,createdAt
[]
```

Zero runs since the workflow was added (`73f76fb`, 2026-05-31). The full run
history for the repo (all workflows, last 15 runs) has no `dep-refresh` entry
either, and shows nothing at all after 2026-07-12 despite a push as recent as
today (`pushed_at: 2026-08-08T13:59:35Z`).

### 2. GitHub Actions is disabled for this repo

```text
$ gh api repos/pdomain/pdomain-prep-for-pgdp/actions/permissions
{"enabled":false,"sha_pinning_required":false}

$ gh api repos/pdomain/pdomain-book-tools/actions/permissions
{"allowed_actions":"all","enabled":true,"sha_pinning_required":false}

$ gh run list --repo pdomain/pdomain-book-tools --limit 5 --json databaseId,name,createdAt,event
[{"createdAt":"2026-08-02T05:11:59Z", "event":"schedule", "name":"dep-refresh"},
 {"createdAt":"2026-07-26T05:16:13Z", "event":"schedule", "name":"dep-refresh"}, ...]
```

`pdomain-book-tools` has Actions enabled and its `dep-refresh` fires weekly on
schedule as designed. This repo's `enabled: false` is the actual reason the
schedule has never fired here — it is a repo-level (or org-inherited) gate
that sits in front of the workflow entirely, independent of the dated-branch
defect this issue is about.

### 3. Zero stray branches, zero open PRs — corroborated as "never ran," not "cleaned up"

```text
$ gh pr list --repo pdomain/pdomain-prep-for-pgdp --state all --search "dep refresh" --limit 20
[]
$ gh api repos/pdomain/pdomain-prep-for-pgdp/branches --jq '.[].name'
feat/hifi-redesign
feat/phase-2-7-b-329
fix/env-js-segfault
fix/sourcemaps-145
master
spec/resolve-m3-workbench-open-questions
spec/2026-05-13-konva-rotate-design
spec/2026-05-13-m4-migration-disk-cost-design
spec/2026-05-13-word-delete-undo-design
```

No `dep-refresh/*` branch exists, and no PR mentioning "dep refresh" exists,
open or closed. Combined with evidence 1 and 2, there is nothing to have
cleaned up — the run that would create either has never happened.

### 4. The sibling repo whose dep-refresh does run already shows the predicted accumulation

```text
$ gh api repos/pdomain/pdomain-ops/branches --paginate --jq '.[].name' | grep -c '^dep-refresh/'
7
```

`pdomain-ops` is not blocked by a disabled-Actions gate and carries the same
dated-branch, no-delete-on-merge workflow structure. It has accumulated 7
stray `dep-refresh/*` branches, which is the outcome this repo is currently
exempt from only because it has never run.

### 5. The merge gate itself is sound in this repo (unlike two other peers)

```text
$ gh api repos/pdomain/pdomain-prep-for-pgdp/branches/master/protection --jq '.required_status_checks.contexts'
["ci"]
$ grep -n 'name:' .github/workflows/ci.yml
1:name: ci
16:    name: ci
```

The single required context, `ci`, is produced by the single job in
`ci.yml`, also named `ci`. This repo does not have the problem seen in
`pdomain-ops` and `pdomain-ocr-training`, whose branch protection requires
per-Python-version matrix contexts (e.g. `"pd-ocr-ops CI (3.11)"`) that no job
in their workflows reports by that exact name — a gate that silently blocks
every pull request. Fixing the dated-branch defect here will not run into a
second, hidden blocker of that kind.

## Root-cause hypotheses

1. **(Most likely) GitHub Actions is disabled for this repo, so the workflow
   has never had the chance to demonstrate its own design flaw.** The
   `actions/permissions` endpoint reports `enabled: false` here versus `true`
   on `pdomain-book-tools`, and the run history shows nothing at all — for
   any workflow — since 2026-07-12, despite ongoing pushes. This fully
   explains the 0/0 branch and PR count without invoking any cleanup.
2. **The dated-branch, no-delete design is unchanged from the pattern that
   already produced accumulation elsewhere.** `pdomain-ops` (Actions enabled,
   same workflow shape) already has 7 stray branches, and `pdomain-ui` had
   four PRs (`#57`–`#60`) batch-closed by a human before its dep-refresh
   redesign spec was written. Nothing in this repo's workflow file differs
   from that pattern — `BRANCH="dep-refresh/$(date +%Y-%m-%d)-$GITHUB_RUN_ID"`
   and `delete_branch_on_merge: false` are both present verbatim.

What would disambiguate further: confirmation from whoever administers the
GitHub org of why `actions/permissions.enabled` is `false` here (repo-level
choice vs. org policy) and when it changed relative to the 2026-05-31 workflow
addition. That is outside this issue's evidence — it affects whether Actions
needs to be re-enabled before this fix has any observable effect, but it does
not change what the fix itself should be.

## Defects to fix

1. **Every run creates a new branch instead of reusing one.** `BRANCH="dep-refresh/$(date +%Y-%m-%d)-$GITHUB_RUN_ID"`
   guarantees a distinct branch name on every trigger, so red runs (and even
   green ones, until merge) can never collapse onto a single reviewable unit.
   (Primary)
2. **`delete_branch_on_merge` is `false`.** Even a successful auto-merge
   leaves its branch behind, so the branch list grows on every green week too.
3. **No PR is closed or reused when the branch changes.** The workflow does
   not check for an existing open dep-refresh PR before creating a new one,
   so nothing stops parallel dated branches/PRs from coexisting once the
   workflow starts running.

## Next steps

1. Apply the design in the `pdomain-ui` repo's
   `docs/specs/2026-07-16-dep-refresh-auto-land-design.md` (§3B–3C) to
   `.github/workflows/dep-refresh.yml` and this repo's settings:
   replace the dated branch name with a single reusable `dep-refresh` branch,
   force-pushed from a fresh `master` checkout each run; open a PR only when
   `gh pr list --head dep-refresh --state open` finds none; re-arm `gh pr
   merge --auto --rebase`; and set `delete_branch_on_merge: true` on the repo.
   This repo does not need spec §3A (the `unit-test` matrix-aggregation fix)
   — its merge gate already matches its CI job one-to-one (evidence 5).
2. Separately from the workflow fix, resolve why `actions/permissions.enabled`
   is `false` for this repo — the dated-branch fix cannot be observed to work
   (or fail) until the schedule can actually fire.
3. After both land, watch the first few scheduled runs to confirm at most one
   `dep-refresh` branch and one open PR ever exist, matching the spec's
   acceptance criteria.

## What is NOT broken

- The branch-protection merge gate: the required context (`ci`) is produced
  by the matching job name, unlike `pdomain-ops` and `pdomain-ocr-training`.
- `delete_branch_on_merge` and the dated-branch pattern have not yet caused
  any accumulation in *this* repo — there is nothing to clean up today.
- `dep-refresh.yml`'s dependency-upgrade steps themselves (actions pin
  refresh, `make upgrade-deps`, frontend `pnpm update`) are unrelated to this
  defect and not evaluated here.

## Resolution

*Open.* When fixed: set frontmatter + Agent Index `Status: retired`, add the
resolving commit/spec link here, move the README pointer to "Resolved", and
route the retirement through `doc-retirer`.
