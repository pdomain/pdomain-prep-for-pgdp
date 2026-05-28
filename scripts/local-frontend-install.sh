#!/usr/bin/env bash
# scripts/local-frontend-install.sh — pnpm install + restore local sibling links.
#
# A plain `pnpm install` (triggered by `make frontend-build`) rewrites
# node_modules and discards any `pnpm link` overlay for @pdomain/pdomain-ui.
# This script re-applies those links after install.
set -euo pipefail

# Keep NPM_SIBLINGS in sync with scripts/local-dev.sh.
NPM_SIBLINGS=(pdomain-ui)

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GIT_COMMON_DIR="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir)"
CANONICAL_REPO_ROOT="$(dirname "$GIT_COMMON_DIR")"
WORKSPACE_ROOT="$(dirname "$CANONICAL_REPO_ROOT")"
MARKER="$CANONICAL_REPO_ROOT/.venv/.pd-local-mode"

say() { echo "[local-frontend-install] $*"; }

if [[ ! -f "$MARKER" ]]; then
  echo "ERROR: not in local-dev mode. Run 'make local-dev' first." >&2
  exit 1
fi

if [[ ! -d "$REPO_ROOT/frontend" ]]; then
  say "no frontend/ directory; nothing to do"
  exit 0
fi

MISE="$(command -v mise 2>/dev/null || echo "$HOME/.local/bin/mise")"
run_pnpm() {
  if [[ -x "$MISE" ]]; then
    (cd "$REPO_ROOT/frontend" && "$MISE" exec -- pnpm "$@")
  elif command -v pnpm >/dev/null 2>&1; then
    (cd "$REPO_ROOT/frontend" && pnpm "$@")
  else
    echo "ERROR: no pnpm/mise available. Run 'make mise-setup' or install Node." >&2
    exit 1
  fi
}

# Snapshot pnpm-workspace.yaml — pnpm install must not mutate it.
WS_YAML="$REPO_ROOT/frontend/pnpm-workspace.yaml"
WS_SNAP="$WS_YAML.preinstall"
if [[ -f "$WS_YAML" ]]; then
  cp "$WS_YAML" "$WS_SNAP"
fi

set +e
run_pnpm install
install_rc=$?
set -e

if [[ -f "$WS_SNAP" ]]; then
  if ! diff -q "$WS_SNAP" "$WS_YAML" >/dev/null 2>&1; then
    echo "ERROR: pnpm install mutated frontend/pnpm-workspace.yaml:" >&2
    diff "$WS_SNAP" "$WS_YAML" || true
    mv "$WS_SNAP" "$WS_YAML"
    exit 1
  fi
  rm -f "$WS_SNAP"
fi

if [[ $install_rc -ne 0 ]]; then
  exit $install_rc
fi

for s in "${NPM_SIBLINGS[@]}"; do
  if [[ ! -d "$WORKSPACE_ROOT/$s" ]]; then
    say "✗ sibling missing: $WORKSPACE_ROOT/$s (run 'make local-setup'); skipping"
    continue
  fi
  if [[ "$s" == "pdomain-ui" ]]; then
    say "→ pre-building $s dist/"
    (cd "$WORKSPACE_ROOT/$s" && make build)
  fi
  say "→ linking @pdomain/$s from $WORKSPACE_ROOT/$s"
  run_pnpm link "$WORKSPACE_ROOT/$s"
done

say "✓ frontend deps installed + local sibling links restored"
