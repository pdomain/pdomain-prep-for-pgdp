#!/usr/bin/env bash
# scripts/local-run.sh — run pgdp-prep against the local-dev workspace.
#
# Deliberately does NOT delegate to `make run` — that path runs
# `frontend-build` → pnpm install (registry path), which discards the
# `pnpm link` overlay for @pdomain/pdomain-ui and serves a stale registry
# build of the shared UI library.
#
# Instead:
#   1. Re-apply editable Python siblings (idempotent — safe to repeat).
#   2. Build the SPA through the local-link-preserving path.
#   3. Launch pgdp-prep with --no-sync so uv does not revert the siblings.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GIT_COMMON_DIR="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir)"
CANONICAL_REPO_ROOT="$(dirname "$GIT_COMMON_DIR")"
MARKER="$CANONICAL_REPO_ROOT/.venv/.pd-local-mode"

if [[ ! -f "$MARKER" ]]; then
  echo "ERROR: not in local-dev mode. Run 'make local-dev' first." >&2
  exit 1
fi

make -C "$REPO_ROOT" local-setup-py
make -C "$REPO_ROOT" local-frontend-build

# --no-sync REQUIRED: plain `uv run` re-syncs and reverts the editable pd-*
# siblings to pinned registry versions, breaking unreleased editable APIs.
exec uv run --no-sync --project "$CANONICAL_REPO_ROOT" pgdp-prep ${ARGS:-}
