---
Status: active
Owner: CT
Created: 2026-11-09
Last verified: 2026-11-09
Kind: issue
Level: I2
---

# CI does not audit dependencies for known vulnerabilities

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I2
- **Last verified:** 2026-11-09
- **Resolution:** Open
- **Severity:** Low — a vulnerable dependency stays green until someone audits by hand
- **Affected version:** pdomain-prep-for-pgdp master @ `14f0ba8`
- **Read when:** changing `make ci`, adding dependency automation, or auditing Python or pnpm dependencies.
- **Search terms:** pip-audit, pnpm audit, osv-scanner, Dependabot, Renovate, vulnerability audit, make ci, former GH #146
- **Relates to:** [testing architecture](../architecture/07-testing.md)

## Current operation — 2026-11-13

`just audit` is available as a separate networked check. `just ci` does not run it.
See [current testing commands](../architecture/07-testing.md#how-to-run).
The dated evidence below records the earlier Make gate; this note does not close the issue.

## Summary

`just ci` runs setup, pre-commit, type checking, OpenAPI export, the frontend build, tests, frontend format,
lint, test, and knip. None of these checks dependencies against vulnerability databases, and the repo has no
Dependabot or Renovate config. Migrated from GitHub issue #146, which came from the 2026-05-22 deep code
review.

## Impact

- A dependency with a published advisory passes CI until someone runs an audit by hand.
- Covers both Python dependencies managed by uv and frontend dependencies managed by pnpm.

## Environment / versions

```
Makefile  ci: setup frontend-install pre-commit-check typecheck openapi-export frontend-build test
              frontend-format-check frontend-lint frontend-test frontend-knip
.github/  ISSUE_TEMPLATE only; no workflows/, no dependabot.yml
```

## Evidence

### 1. No audit step — checked 2026-11-09

```
grep -n -i "audit|pip-audit|osv|safety" Makefile .pre-commit-config.yaml
# no audit target or hook
ls .github/workflows .github/dependabot.yml renovate.json
# none exist
```

### 2. CI runs locally

The repo has no GitHub Actions workflows, so "CI" means `just ci` run before each commit. A scheduled audit
would need a new runner, such as a GitHub Actions workflow or a local timer.

## Root-cause hypotheses

1. **(Most likely) Never added.** The local CI grew around tests and lint, and audits were left for later.

## Defects to fix

1. **Validate the existing Python and pnpm audit recipe** (`just audit`), then decide whether
   `just ci` or a scheduled job should run it. (Primary)
2. **Handle the private `pdomain-*` packages explicitly.** They come from pdomain-index-pip and are not in
   public advisory databases, so the audit must skip them without failing.
3. **Decide on automated update PRs** through Dependabot or Renovate.

## Next steps

1. Try `uvx pip-audit` and `pnpm audit` on the current lockfiles to see the baseline and the private-package
   behavior.
2. Use the `just audit` recipe, then decide whether it runs in `just ci` or on a schedule.

## What is NOT broken

- Pre-commit hook pinning: commit `8ce874a` froze hook revisions to commit SHAs.

## Resolution

_Open._ When fixed: set frontmatter and Agent Index `Status: retired`, add the resolving commit here, and
route the retirement through `doc-retirer`.
