#!/usr/bin/env bash
# scripts/local-dev.sh — switch to local-editable sibling pd-* deps.
#
# Calls local-setup first to ensure siblings are cloned.
# Then installs editable siblings (Python + npm), writes marker.
set -euo pipefail

# Repo-specific: Python siblings + npm siblings.
PY_SIBLINGS=(pdomain-book-tools pdomain-ops)
NPM_SIBLINGS=(pdomain-ui)         # paths relative to ../

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GIT_COMMON_DIR="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir)"
CANONICAL_REPO_ROOT="$(dirname "$GIT_COMMON_DIR")"
WORKSPACE_ROOT="$(dirname "$CANONICAL_REPO_ROOT")"
# Marker lives in the canonical repo's .venv (not the worktree's fake .venv).
MARKER="$CANONICAL_REPO_ROOT/.venv/.pd-local-mode"

say() { echo "[local-dev] $*"; }

# Pre-flight: siblings must exist
make -C "$REPO_ROOT" local-setup

# Python: install editable (run from canonical repo root so project .venv is discovered).
for s in "${PY_SIBLINGS[@]}"; do
  say "→ installing editable: $s"
  (cd "$CANONICAL_REPO_ROOT" && uv pip install --no-deps -e "$WORKSPACE_ROOT/$s")
done

# npm: link (SPAs only)
if [[ -d "$REPO_ROOT/frontend" ]]; then
  for s in "${NPM_SIBLINGS[@]}"; do
    # pdomain-ui needs `make build` for its dist/ to be importable
    if [[ "$s" == "pdomain-ui" ]]; then
      say "→ pre-building pdomain-ui dist/"
      (cd "$WORKSPACE_ROOT/pdomain-ui" && make build)
    fi
    say "→ linking @pdomain/$s from $WORKSPACE_ROOT/$s"
    (cd "$REPO_ROOT/frontend" && pnpm link "$WORKSPACE_ROOT/$s")
  done
fi

# Write marker
mkdir -p "$(dirname "$MARKER")"
touch "$MARKER"
say "✓ marker written: $MARKER"

say "✓ local-dev mode active. Run 'make local-check' to verify."
