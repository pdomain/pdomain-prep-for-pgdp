# 07 — Testing

## Agent Index

- **Kind:** architecture
- **Status:** built
- **Last verified:** 2026-11-07
- **Read when:** running tests or choosing a regression gate.
- **Search terms:** pytest, Vitest, Playwright, CI, lint toolchain.

The default gate is local `make ci AI=1`. It combines backend and frontend checks.
`make ci` runs a Playwright smoke subset through `make e2e-smoke`: app load, all 24 tool slots, and zip upload.
Tests join that subset with `@pytest.mark.e2e_smoke`. It needs Chromium, which
`uv run --group e2e playwright install chromium` installs once per machine.
The full Playwright suite (`make e2e`) and slow packaging tests remain separate targets.
No GitHub Actions CI workflow exists in this checkout.

`make audit` checks the locked Python and frontend dependencies against public advisory databases. It skips the
private `pdomain-*` packages, needs network access, and exits 1 when either audit reports a problem. It is separate
from `make ci`.

## How to run

```sh
make test AI=1
make frontend-test
make ci AI=1
make ci-slow AI=1
make e2e AI=1
```

Backend tests use `uv run pytest tests/ -v --ignore=tests/e2e -n auto`.
Pytest configuration excludes slow tests from that default run.
Full CI also runs pre-commit, basedpyright, TypeScript checks, OpenAPI export, frontend build,
formatting/lint, Vitest, and knip. Slow CI adds distribution builds and slow tests.

`AI=1` captures verbose output in `.ci-ai.log` and prints a short result.
For a targeted test use `uv run pytest <file> -k <pattern>`; use uv rather than a bare interpreter.

## Representative coverage

| Area | Tests |
|---|---|
| Pipeline artifacts and book path | `test_text_chain_contract.py`, `test_w06_golden_path.py` |
| Numbering and migration | `test_numbering_compute_labels.py`, `test_numbering_migration.py`, `test_page_order_manifest_runs.py` |
| Stage execution and confirmation | `test_w0_project_stage_execution.py`, `test_b5_project_stages.py`, `test_w4_confirm_routes.py` |
| Settings and device dispatch | `test_3tier_stage_settings.py`, `test_grayscale_3tier_resolution.py`, `test_stage_dispatch_device_key.py` |
| Job bounds and import | `test_job_runner_timeout.py`, `test_concurrent_jobs.py`, `test_ingest_progress.py` |
| Lint version agreement | `test_lint_toolchain_pinned.py` |
| Frontend behavior | Service, machine, and component tests alongside `frontend/src/` |
| Browser behavior | Playwright under `tests/e2e/` |

Paths in the table are under `tests/` unless stated otherwise.
Browser presence tests and passing documentation stubs do not establish full interactive coverage.
See [W3.2](../issues/2026-07-21-w32-playwright-smoke-ci.md) and
[W3.3](../issues/2026-07-21-w33-seeded-ocr-browser-fixtures.md).

## Conventions

Pure functions use concrete expected values and regression cases.
Pipeline tests use synthetic images where possible. OCR model loading is mocked or replaced by fixtures;
ordinary cv2 image operations are exercised. Stub-shaped work may follow the repo's documented exemption.

Frontmatter numbering starts at one. Current filename prefixes also include a scan sequence before their
section and folio components; they are not bare `f001` names. Runs-based naming and its deliberate
interior-skip correction have dedicated tests.

## Fixtures

`tests/conftest.py` supplies filesystem/SQLite, none-auth, CPU defaults, and lifespan-managed TestClient fixtures.
Thumbnail workers are pinned to one to keep tests inexpensive.
Some tests seed async database state before opening a client; they avoid reusing the client's loop.

Real external services, heavy OCR model downloads, managed GPU dispatch, and live Postgres are not established
by the hermetic suite. A passing local gate does not prove a clean-machine installation or remote deployment.

## Lint toolchain

The hook pin, lockfile version, and project Ruff minimum are compared by
`tests/test_lint_toolchain_pinned.py`. At this review all three specify 0.16.7.
Those guards replace the earlier version-skew issue; they do not justify changing lint rules to hide failures.

## Evidence

Verified from Makefile, pyproject.toml, pre-commit configuration, conftest.py, and the named tests on 2026-11-07.
The immediately preceding documentation consolidation ran full CI successfully with 2,021 backend tests passed,
28 skipped, and 2,077 frontend tests passed. Those are dated observations, not required fixed suite sizes.
The current documentation revision runs its own gate before commit.
