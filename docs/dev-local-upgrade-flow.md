# `dev-local`-aware `upgrade-deps`

## Applicability

**Applicable.** This repo has a `dev-local` workflow: `make dev-local`,
`make install-local`, and `make local-setup` install `pd-book-tools`
editably from `../pd-book-tools/` (see Makefile lines 239–271). A naive
`uv sync --group dev` will silently overwrite the editable install with
the published / git-tag-pinned version from `pyproject.toml`, reverting
the contributor's local work without warning.

(Unlike `pd-ocr-cli` or the trainer, this repo has no torch/doctr GPU
extras to revert — the surface area is just the editable
`pd-book-tools` install. The hazard is still real because OCR behavior
in this app is anchored in `pd-book-tools` and a silent demotion of
that dep masks regressions during dev.)

## The hazard

`make upgrade-deps` today ends with:

```make
uv lock --upgrade
uv sync --group dev
```

If the contributor previously ran `make install-local` or
`make dev-local`, `uv sync` will see the canonical
`pd-book-tools = { git = ..., tag = "vX.Y.Z" }` entry in
`pyproject.toml` and replace the editable sibling install with the
pinned tag, with no message.

Result: the contributor's edits in `../pd-book-tools/` are no longer
reflected in the running app, and the next `pgdp-prep` run silently
regresses to the pinned tag's behavior. Especially nasty here because
OCR-correctness work often spans both repos.

## Required behavior (workspace-wide contract)

1. **Detect dev-local vs canonical** before any `uv sync` invoked by
   `upgrade-deps`.
2. **Detection precedence** (cross-repo contract anchored in
   `pd-book-tools`):
   1. `uv pip show pd-book-tools` reports an `Editable project
      location:` line — primary signal.
   2. Fallback: a marker file in `.venv/` (e.g. `.venv/.dev-local`)
      written by `make dev-local` / `make install-local`.
   3. Last-resort override: env var `PD_DEV_LOCAL=1`.
3. **UX:** default `make upgrade-deps` **refuses with a message** when
   dev-local is detected, pointing at the sibling recipe. A new
   `make upgrade-deps-local` target performs `uv lock --upgrade`,
   `uv sync --group dev`, then re-installs `pd-book-tools` editable
   from `../pd-book-tools/` (and writes the `.venv/.dev-local`
   marker).
4. **Canonical-mode behavior unchanged.** When detection finds no
   editable install, `make upgrade-deps` runs exactly as it does today.
5. **Cross-platform.** Detection must work on Linux, macOS, and
   Windows (PowerShell). `uv pip show` output is uniform across
   platforms; the marker-file fallback is plain-file presence; the
   env var is OS-agnostic.

## Implementation sketch

A small script (e.g. `scripts/detect_dev_local.py` or a Make
function) that exits 0 if dev-local is detected and 1 otherwise.
`upgrade-deps` becomes:

```make
upgrade-deps: ## Upgrade dependencies and sync local environment
    @if uv run python scripts/detect_dev_local.py >/dev/null 2>&1; then \
      echo "❌ dev-local install detected (editable pd-book-tools)."; \
      echo "   Run 'make upgrade-deps-local' to upgrade and restore the editable install."; \
      echo "   Or set PD_DEV_LOCAL=0 and 'make reset' to switch to canonical."; \
      exit 1; \
    fi
    uv lock --upgrade
    uv sync --group dev

upgrade-deps-local: ## Upgrade deps then restore editable pd-book-tools
    uv lock --upgrade
    uv sync --group dev
    $(MAKE) dev-local
```

The marker file should be written at the end of `dev-local` /
`install-local` and removed by `reset` / `clean`.

## Why anchor detection on `pd-book-tools`

Every pd-* downstream that has a dev-local concept routes editability
through `pd-book-tools`. Probing that one package keeps the contract
uniform across pd-ocr-cli, pd-ocr-labeler-spa, pd-ocr-trainer, and
pd-prep-for-pgdp — a single shared detection script could eventually
live in `pd-book-tools` itself or in a workspace-level helper.

## Related

- Workspace decision recorded in agent-memory under
  `.claude/agent-memory/<agent>/` for each pd-* repo.
- This document is **spec only.** Implementation is tracked as a
  P4 roadmap item (`docs/08-roadmap.md` § "Guard `upgrade-deps`
  against silent dev-local revert").
