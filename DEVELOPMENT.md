# Developing pdomain-prep-for-pgdp

This document covers contributor workflows. End-user install + usage lives
in [`README.md`](README.md). Architecture writeup is in [`docs/`](docs/).

## Prerequisites

| Tool | Required for | Notes |
|---|---|---|
| [`uv`](https://docs.astral.sh/uv/) | Always | Python package + tool manager. Provisions Python itself. |
| `git` | Always | |
| Node 24 + `npm` | Frontend changes, `make build`, `make openapi-export` | Active LTS. **Not** required for backend-only iterations or running `pytest`. |
| [`mise`](https://mise.jdx.dev/) | **Optional** | Pin Node / Python / uv per the repo's `mise.toml`. Make targets dispatch through it when present. See "Optional: pinned tool versions". |
| NVIDIA GPU + CUDA Toolkit | Optional | For GPU-accelerated processing. CPU mode is first-class. |

A sibling [`../pdomain-book-tools`](https://github.com/pdomain/pdomain-book-tools)
checkout is required for local-dev workflows that edit both repos at once.
`make local-setup` clones it for you.

## What needs Node, what doesn't

**Doesn't need Node:**

- `make setup` (uv sync + pre-commit hooks)
- `make test` (pytest only — 128 tests, ~12 s)
- `make install-local` (editable wheel install)
- `make lint` / `make format`
- Iterating on FastAPI routes / pipeline / models / adapters

**Needs Node:**

- `make frontend-build` — Vite build, copies SPA into `src/.../static/`.
- `make frontend-dev` — Vite dev server on `:5173`.
- `make build` — depends on `frontend-build` so the wheel ships with the SPA.
- `make openapi-export` — uses `npx openapi-typescript`.
- `make docker-build` — Dockerfile's first stage builds the SPA.

End users running `pgdp-prep` (uv-tool wheel install) **never need Node** —
the published wheel ships with the prebuilt SPA bundle.

## Quick start

Two paths depending on what you're doing.

### A. Just developing pdomain-prep-for-pgdp (no pdomain-book-tools edits)

```sh
git clone https://github.com/pdomain/pdomain-prep-for-pgdp.git
cd pdomain-prep-for-pgdp
make setup
```

Syncs dev deps from `pyproject.toml` (including `pdomain-book-tools` at the pinned
git tag), installs pre-commit hooks. You can now run `uv run pgdp-prep`
without a system install.

### B. Editing pdomain-prep-for-pgdp **and** pdomain-book-tools side-by-side

```sh
git clone https://github.com/pdomain/pdomain-prep-for-pgdp.git
cd pdomain-prep-for-pgdp
make local-setup
```

`local-setup` clones `pdomain-book-tools` to `../pdomain-book-tools` (or skips if
present) and runs `make dev-local`, which:

1. `uv sync --group dev` — installs deps from `pyproject.toml`.
2. `uv pip install -e ../pdomain-book-tools` — replaces the pinned tag with the
   sibling editable checkout.
3. `make check-local-editable` — verifies imports resolve to the sibling,
   not the cached tag.

After that, `uv run pgdp-prep` picks up changes in either repo without a
reinstall. Use `make install-local` to put the editable build on PATH as a
uv tool.

To revert to the pinned tag:

```sh
make uninstall-local
curl -sSL https://raw.githubusercontent.com/pdomain/pdomain-prep-for-pgdp/main/install.sh | sh
```

## Frontend dev

```sh
make frontend-dev      # Vite dev server on :5173 (auto-installs deps first)
```

In a separate terminal, run the backend with the Vite-dev passthrough:

```sh
uv run pgdp-prep --reload --frontend-dev http://localhost:5173
```

`--frontend-dev` makes FastAPI redirect `/` and unknown asset paths to the
Vite dev server, while still owning `/api/*`, `/cdn/*`, and `/env.js`. No
proxy config needed.

For production-shape testing in dev:

```sh
make build         # builds SPA + wheel
uv run pgdp-prep   # serves the bundled SPA from package resources
```

## Optional: pinned tool versions via mise

The repo's [`mise.toml`](mise.toml) declares Node 24, Python 3.13, and the
latest `uv`. Use mise if you want every contributor's machine to match:

```sh
make mise-download     # one-time: fetch mise binary into ~/.local/bin/
make mise-setup        # one-time: install Node + Python + uv per mise.toml
make mise-doctor       # show which versions are resolved
```

`make mise-setup` does **not** edit your `~/.bashrc`. The `frontend-*` and
`openapi-export` targets dispatch through `mise exec` automatically when the
mise binary is present; your interactive shell stays unchanged.

If you also want `node` / `npm` directly in your shell, add this to your
shell init yourself:

```sh
eval "$(~/.local/bin/mise activate bash)"   # or zsh / fish
```

Don't want mise? Install Node 24 yourself, or add the devcontainer Node
feature (`ghcr.io/devcontainers/features/node:1`). All make targets fall
back to whatever's on PATH.

## Running tests

```sh
make test
# or, equivalent:
uv run pytest tests/ -v
```

Expected: ~800 tests passing. Tests run with `gpu_backend="cpu"` and
`storage_backend="filesystem"` by default — no Node, no Modal, no GPU
hardware required.

The full suite is documented in [`docs/architecture/07-testing.md`](docs/architecture/07-testing.md).

## Lint / format

```sh
make lint        # ruff check (with import sort + autofix)
make format      # ruff format, then lint
make pre-commit-check
```

`pre-commit` hooks run on every commit if you ran `make setup`.

## Building releases

```sh
make build         # builds SPA + wheel
make release-patch # runs release preflight, tags, pushes, and dispatches release
make release-minor # ditto, minor
make release-major # ditto, major
```

Releases are workflow-dispatch based and must be started by `make release-patch`,
`make release-minor`, or `make release-major`. Tag pushes alone are not the supported
publish path. This repo does not publish a container image from GitHub Actions.

`hatch-vcs` derives the wheel version from the git tag at build time. The
`release.yml` workflow builds the wheel (with the prebuilt SPA bundled) and
attaches it to the GitHub Release for the tag. `install.sh` resolves the
latest tag from the `tags` API, downloads the `.whl` asset from that
release, and runs `uv tool install <wheel-path>[extras]`. There's no PyPI
publish, and end users don't need Node/npm because the SPA is already in
the wheel.

## Repo layout

```
pdomain-prep-for-pgdp/
├── src/pdomain_prep_for_pgdp/   # Python backend (FastAPI + pipeline)
│   ├── api/                # routes (data/, gpu/, auth/, cdn, env_js)
│   ├── core/               # mode-agnostic pipeline + models + OCR
│   ├── adapters/           # storage / database / auth / gpu (swappable)
│   └── dispatcher/         # immediate / batched (managed mode)
├── frontend/               # React 19 + Vite + TS + Konva + TanStack Query
├── tests/                  # pytest (128 tests)
├── docs/                   # architecture writeup
├── specs/                  # design specs (source of truth)
├── pyproject.toml          # backend deps + extras + console script
├── mise.toml               # optional pinned tool versions
├── Makefile                # dev workflows
├── Dockerfile              # managed-mode container
├── install.sh / .ps1       # one-line end-user installer
└── .github/workflows/      # CI and dispatch-based release workflows
```

## Spec ↔ implementation map

| Spec | Code |
|---|---|
| 01 — Configuration | `core/{models,config_resolver,prefix,assign_prefixes}.py` |
| 02 — Pipeline | `core/{ingest,pipeline/,ocr,illustrations,text_postprocess,packaging}.py` |
| 03 — UI layout | `frontend/src/pages/*.tsx` |
| 04 — GPU | `adapters/gpu/*.py` |
| 05 — Illustrations | `core/illustrations.py` |
| 06 — Workbench | `frontend/src/pages/PageWorkbenchPage.tsx` |
| 07 — API | `api/{auth,data,gpu}/*.py`, `api/cdn.py`, `api/env_js.py` |
| 08 — Data models | `core/models.py` |
| 09 — Deployment | `Dockerfile`, `install.sh`, `Makefile`, `.github/workflows/` |

See [`docs/architecture/01-overview.md`](docs/architecture/01-overview.md) for the full module tour.

## CI

`.github/workflows/ci.yml` runs on push and pull request. `.github/workflows/release.yml`
runs only by workflow dispatch from the local release script.

| Job | Trigger | What |
|---|---|---|
| CI jobs | push / pull request | uv sync, ruff, pytest, frontend build, and wheel checks |
| `release-ci` | workflow dispatch | release-grade validation from the exact tag |
| `publish` | workflow dispatch after `release-ci` | builds the wheel and attaches it to the GitHub Release |

CI does not depend on mise; it pins versions in the workflow file directly.

## Roadmap

[`docs/08-roadmap.md`](docs/08-roadmap.md) tracks what's coming, in priority
order. Highlights:

- **P0:** Modal app S3 wiring, Postgres adapter, install.sh exercise.
- **P1:** Per-page batch progress, OcrWord bbox highlight, text diff, Vitest setup.
- **P2:** Konva rotate/flip, JWT profile dropdown, soft-delete, page text search.
- **P3:** CUDA `LocalBackend`, shared GPU container, retry-with-payload-override.

The live work queue (kept in sync) is at
`~/.claude/projects/-workspaces-ocr-container-pdomain-prep-for-pgdp/memory/project_state.md`.
