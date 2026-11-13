---
Status: active
Owner: CT
Created: 2026-07-21
Last verified: 2026-11-07
Kind: issue
Level: I1
---

# make ci excludes Playwright e2e; smoke subset not in default gate (W3.2)

## Agent Index

- **Kind:** issue
- **Status:** active
- **Level:** I1
- **Last verified:** 2026-11-07
- **Resolution:** Open
- **Severity:** Medium — UI registry/route regressions never break default CI
- **Affected version:** pdomain-prep-for-pgdp (main @ 2026-07-21)
- **Read when:** promoting Playwright into CI, tooling TOOL_REGISTRY regressions, or Wave 3 ops quality work.
- **Search terms:** make ci, make e2e, Playwright, tests/e2e, smoke subset, TOOL_REGISTRY, W3.2
- **Relates to:** [pipeline completion review](../plans/2026-07-21-pipeline-completion-review.md)

## Current operation — 2026-11-13

`just ci` now runs `just e2e-smoke`: app load, all 24 tool slots, and zip upload.
The default Python test recipe still excludes `tests/e2e`; the smoke recipe runs that browser subset separately.
The full browser suite remains opt-in through `AI=1 just e2e`.
See [current testing commands](../architecture/07-testing.md#how-to-run).

The finding and dated evidence below describe the earlier Make gate. This note records current operation;
it does not close the issue or change its resolution.

## Summary

Default `make ci` never runs the Playwright suite under `tests/e2e/`. The
Makefile `test` target passes `--ignore=tests/e2e`, and `ci` depends on
`test` (plus frontend vitest) but not `e2e`. Existing browser tests already
cover app load, 24 tool-slot registry presence, and upload/import flows — a
fast smoke subset can break CI when a stage tool falls out of
`TOOL_REGISTRY` or the SPA fails to boot. Without promotion, those failures
are not checked at browser level by `make ci`; unit/component tests may still catch some of them.

This is the local Make gate. GitHub workflows were removed in `e22bdd2`; no current GitHub Actions CI job
is implied. Several W6.2 deferrals are passing documentation stubs, not pytest-marked skips.

## Impact

- TOOL_REGISTRY / tool-slot regressions ship green on `make ci`.
- SPA boot and upload-path breakage is invisible to the default gate.
- Wave 0–2 backend fixes can land while the browser shell is broken.

## Environment / versions

```
repo: pdomain-prep-for-pgdp
make target: ci (Makefile ~315), test (~289–290), e2e (~295–296)
pytest: uv run pytest tests/ -v --ignore=tests/e2e
e2e group: uv run --group e2e pytest tests/e2e -v (requires playwright install chromium)
```

## Evidence

### Current source verification — 2026-11-07

Local make ci excludes Playwright; make e2e remains separate. No GitHub workflow files remain. Checked Makefile,
tests/e2e/test_w62_gap_tests.py, and removal commit e22bdd2.

This is source inspection, not a fresh browser/GPU run. Older source excerpts and July review dates below
are historical snapshots; the current findings above take precedence where implementation changed.

### 1. `make ci` / `make test` exclude e2e

```
# Makefile
test: ## Run pytest (excludes e2e/ and slow tests)
  uv run pytest tests/ -v --ignore=tests/e2e -n auto

e2e: frontend-build ## Run Playwright E2E tests
  uv run --group e2e pytest tests/e2e -v

ci: setup frontend-install pre-commit-check typecheck openapi-export \
    frontend-build test frontend-format-check frontend-lint frontend-test frontend-knip
```

`ci` includes `test` and `frontend-test` but not `e2e`.

### 2. Smoke-worthy tests already exist

- `tests/e2e/test_convergence_app_loads.py` — app load, no console errors, SPA routes.
- `tests/e2e/test_w62_gap_tests.py` — `test_all_stage_tool_slots_render_non_placeholder` walks all 24 stages and asserts
  non-placeholder tool slots.
- `tests/e2e/test_upload_flow.py` — upload path.

Parent plan W3.2 exit: “Failing UI registry breaks CI.”

### 3. Full e2e remains optional / heavier

W6.2 gap file documents unimplemented browser flows for text_review approval, validation waiver UI,
and page_order naming preview — those need fixtures (see W3.3), not the
smoke subset.

## Root-cause hypotheses

1. **(Most likely) Intentional cost split** — Playwright + live server is slower
   and needs the `e2e` uv group / chromium; default CI stayed hermetic unit+vitest.
2. **No curated smoke marker** — suite is all-or-nothing (`make e2e`), so
   operators never wire a subset into `ci`.

## Defects to fix

1. **Promote a Playwright smoke subset into default CI** — app load, 24 tool
   slots, upload/create project. (Primary)
2. **Mark smoke vs heavy** — pytest marker or dedicated path so full e2e stays
   opt-in (`make e2e` / `ci-slow`).
3. **Document chromium install** for CI runners and local preflight.

## Next steps

1. Tag or collect smoke tests (`test_app_loads_*`, tool-slot registry, upload).
2. Add `make e2e-smoke` (or `pytest -m e2e_smoke`) that depends on
   `frontend-build` and the e2e group.
3. Wire smoke into the local `make ci` gate; discuss any new hosted CI workflow separately.
4. Keep heavy/seeded flows out of smoke (W3.3).

## What is NOT broken

- Unit/API tests in `make test` still run.
- Full Playwright suite is runnable via `make e2e` when the SPA is built.
- Frontend vitest (`make frontend-test`) remains in `ci`.

## Resolution

*Open.* When fixed: set frontmatter + Agent Index `Status: retired`, link the
commit that wires smoke into CI, route retirement through `doc-retirer`.
