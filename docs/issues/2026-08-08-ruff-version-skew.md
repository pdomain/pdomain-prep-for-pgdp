---
Status: active
Owner: CT
Created: 2026-08-08
Last verified: 2026-08-08
Kind: issue
Level: I1
---

# The lint gate runs a different ruff than the project does, and fails

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-08-08
- **Resolution:** Open
- **Severity:** Medium — `make pre-commit-check` fails on a clean tree while the project's own ruff reports no problems
- **Affected version:** pdomain-prep-for-pgdp @ f03f6ce
- **Read when:** the lint gate fails but `uv run ruff check` passes, or before upgrading ruff in this repo
- **Search terms:** ruff version skew, PLR0917, LOG004, pre-commit ruff, too many positional arguments, lint gate red
- **Relates to:** [issues index](README.md)

## Summary

Two different ruff versions run against this repository. The pre-commit hook is
pinned to v0.16.2, while the project's own environment resolves ruff 0.15.21.
The newer one finds 70 errors that the older one does not implement, so
`uv run ruff check` reports a clean tree and `make pre-commit-check` fails on
that same tree.

The gate has been red since the hook pin moved. It stays quiet during ordinary
commits because commit-time pre-commit only inspects changed files, so the
failure surfaces only when someone touches Python or runs the full gate.

## Impact

- `make pre-commit-check` and any CI path that calls it fail on a clean tree.
- The 70 findings are real for ruff 0.16.2 but invisible to anyone running the
  project's own `uv run ruff check`, so a developer sees a green local check and
  a red gate with no obvious cause.
- Contributors cannot tell whether a lint failure is theirs or pre-existing.

## Environment / versions

```text
pdomain-prep-for-pgdp @ f03f6ce
.pre-commit-config.yaml  ruff-pre-commit  rev: v0.16.2
pyproject.toml           dev group        "ruff>=0.15.13"
uv.lock                  ruff             version = "0.15.21"
```

## Evidence

### 1. The two versions disagree completely

```text
$ uv run ruff --version
ruff 0.15.21
$ uv run ruff check
All checks passed!

$ uvx ruff@0.16.2 check --no-fix
Found 70 errors.
```

### 2. The findings are rules 0.15.21 does not enforce

```text
$ uvx ruff@0.16.2 check --no-fix --output-format=concise | ...
     69 PLR0917
      1 LOG004
```

`PLR0917` (too-many-positional-arguments) was promoted from preview to stable in
ruff 0.16, which is why it appears all at once rather than gradually.

### 3. The dependency floor permits the drift

`pyproject.toml` asks for `ruff>=0.15.13`, and `uv.lock` resolved 0.15.21. The
pre-commit hook does not read either one. It builds its own isolated environment
at whatever `rev:` the config names, so the two can move independently and
nothing reconciles them.

## Root-cause hypotheses

1. **(Most likely) The hook pin was bumped without a matching lockfile bump.**
   The `rev:` moved to v0.16.2 while `uv.lock` stayed at 0.15.21. Nothing in the
   repo checks that the two agree, so the skew was silent until the new version
   started reporting findings. The same `pre-commit-update` hook that
   auto-rewrites pins would produce exactly this state.
2. **The floor constraint was never raised.** Even with a fresh `uv lock`,
   `ruff>=0.15.13` allows any newer release, so re-resolving is not guaranteed to
   land on the hook's version. This does not explain the current gap on its own,
   but it means fixing the lockfile once will not prevent a recurrence.

## Defects to fix

1. **The gate and the project run different linters.** One of the two versions
   has to become authoritative. (Primary)
2. **Nothing detects the skew.** No check compares the pre-commit `rev:` against
   the resolved ruff version, so the next drift is also silent.
3. **70 findings are unaddressed.** They are real under the version the gate
   enforces.

## Next steps

1. Raise the project's ruff to 0.16.2 so both sides match, rather than
   downgrading the hook. That aligns this repo with `pdomain-book-tools`,
   `pdomain-ocr-cli`, and `pdomain-ops`, which already run 0.16.2.
2. Fix the 69 `PLR0917` findings by making excess parameters keyword-only, not by
   suppressing the rule. `pdomain-book-tools` did this in commit 790ea84 and the
   approach transfers directly: keep the identifying arguments positional and
   move the rest behind `*`. Check every call site before choosing cut points.
3. Fix the single `LOG004` finding on its own merits.
4. Consider raising the `ruff>=` floor to the adopted version so a future
   re-resolve cannot silently fall behind the hook.

## What is NOT broken

- `uv run ruff check`, `uv run ruff format --check`, and `basedpyright` all pass.
- The test suite passes; this is a lint-configuration problem, not a code defect.
- The frozen SHA pins in `.pre-commit-config.yaml` are intact and unrelated.

## Resolution

*Partially resolved — still open for defect 2.*

Defects 1 and 3 are fixed. The project now resolves the same ruff the gate
runs, and the findings are gone:

- `pyproject.toml` dev group raised `ruff>=0.15.13` to `ruff>=0.16.2`, and
  `uv.lock` re-resolved 0.15.21 to 0.16.2. Both sides now run 0.16.2.
- All 69 `PLR0917` findings fixed by making the excess parameters keyword-only,
  per next-step 2. Nothing suppresses `PLR0917`. 54 are FastAPI route handlers,
  where the cut keeps the URL path parameters positional and moves the injected
  dependencies, body, and query parameters behind `*`. `uv run ruff check`
  reports `All checks passed!`.
- The single `LOG004` finding fixed on its own merits: the unhandled-exception
  handler in `api/middleware/error_handler.py` now passes `exc_info=exc`
  explicitly instead of relying on `log.exception`'s implicit
  `sys.exc_info()` lookup, which is not guaranteed inside a FastAPI exception
  handler because that is not an `except` block.

Ruff 0.16 also began formatting Python inside Markdown code fences, which
rewrote two governed docs. Markdown is now excluded from ruff; recorded in
[lint deviations](../process/lint-deviations.md).

**Defect 2 is still open.** Nothing compares the pre-commit `rev:` against the
resolved ruff version, so a future hook bump above the floor drifts silently
again. Raising the `>=` floor to the adopted version (next-step 4) means a
re-resolve cannot fall *behind* the hook, which narrows the failure mode but is
not a check. Keep this report open until that check exists.
