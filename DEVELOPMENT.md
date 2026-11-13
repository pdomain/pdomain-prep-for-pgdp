---
Kind: process
Status: active
Owner: CT
Created: 2026-05-05
Last verified: 2026-11-07
---

# Developing pdomain-prep-for-pgdp

Use the just recipes for contributor work. The current implementation is local-first; see
[architecture](docs/architecture/01-overview.md) and the [active queue](docs/issues/README.md).

## Prerequisites

Install `just` for the contributor commands below.

Use uv for Python dependencies and Node 24 with pnpm 11 for frontend work. The repo's mise configuration
pins Python, Node, and pnpm; it does not manage uv. Just recipes use mise when available and PATH tools otherwise.
Backend tests do not require a frontend build. Pre-commit includes Node-based hooks, so setup/checks may
provision or need a Node environment. Installed wheels include the built SPA and do not require end-user Node.

## Registry-based development

```sh
just setup
uv run pgdp-prep
```

Setup synchronizes the development environment and installs hooks. The environment is `.venv` by default,
or `UV_PROJECT_ENVIRONMENT` when set. Sibling dependencies normally resolve from explicit registry constraints
in `pyproject.toml`, not pinned Git tags.

## Editing sibling libraries

```sh
just setup
just local-setup
just local-dev
just local-check
just local-run
```

`local-setup` only clones missing pdomain-book-tools, pdomain-ops, and pdomain-ui siblings beside the canonical
checkout. It does not activate local mode. `local-dev` installs the two Python siblings editably, builds/links
the UI package, and writes `.pdomain-local-mode` in the active environment. Run setup first.

Use `local-run` to restore editables/UI links and launch without synchronization undoing those overlays.
`local-install` installs a uv tool with editable Python siblings. `local-uninstall` removes that tool;
it does not remove the project marker or overlays. Legacy local command names remain deprecation aliases.

For dependency upgrades, follow the [local upgrade runbook](docs/runbooks/dev-local-upgrade-flow.md).
To return deliberately to registry mode, remove the current environment's `.pdomain-local-mode` marker
and run `just reset`. Uninstall a separately installed tool with `just local-uninstall` when needed.

## Frontend dev

```sh
just frontend-dev
```

Run the backend in a second terminal:

```sh
uv run pgdp-prep --reload --frontend-dev http://localhost:5173
```

FastAPI owns API, asset, and runtime-config routes while forwarding SPA requests to Vite.
For bundled-SPA testing, run `just build`, then `uv run pgdp-prep`.

Optional `just mise-setup` installs pinned tools and writes trust roots. It does not edit shell startup files.
Use `just mise-doctor` to inspect resolution; interactive shell activation is optional.

## Checks

```sh
AI=1 just test
just frontend-test
AI=1 just ci
AI=1 just e2e
```

The backend target runs `uv run pytest tests/ -v --ignore=tests/e2e -n auto`; slow tests are excluded by configuration.
Full local CI includes lint, type checks, OpenAPI generation, SPA build, backend tests, frontend
formatting/lint/tests, knip, and the Playwright smoke subset. See [testing](docs/architecture/07-testing.md).
The smoke subset needs a browser, so run `uv run --group e2e playwright install chromium` once per machine.
`AI=1 just e2e` runs the whole browser suite and stays opt-in.
`AI=1` captures verbose output in `.ci-ai.log`.

`just lint`, `just format`, and `just pre-commit-check` provide focused tooling.
Hooks run on commits after setup. Always run full CI before committing.

## Builds and releases

`just build` builds the SPA before the wheel. Hatch derives versions from Git tags and requires the SPA bundle.
`AI=1 just ci-slow` adds distribution builds and slow tests.

Release patch/minor/major targets invoke `scripts/do-release.sh` and `scripts/release-common.sh`.
They perform local preflight and tag/push operations according to script options. Invoking a release target
is a publication action, not an ordinary validation command.

This checkout has no GitHub Actions workflow directory. Do not assume push-triggered CI, release dispatch,
or wheel publication is provided by absent workflow files. The installer still expects a release wheel asset.

## Source map

Backend code lives under `src/pdomain_prep_for_pgdp/`; current stage execution is under `core/pipeline/`.
Numbering uses `core/numbering*.py`. Shared remote GPU classes come from pdomain-ops.
Frontend pipeline tools live in `frontend/src/pages/pipeline/`; project management lives under
`frontend/src/pages/projects/`. There is no standalone PageWorkbenchPage.
Tests live in `tests/` and alongside frontend source.

Verified from source on 2026-11-07 against Makefile, mise.toml, pyproject.toml, local-mode scripts,
release scripts, and the current source tree. The [roadmap](docs/plans/roadmap.md) is the forward queue.
[Repository boundary](docs/architecture/10-repository-boundary.md) says which ideas belong in another repo.
[Current state](docs/context/current-state.md) is the operational digest.
