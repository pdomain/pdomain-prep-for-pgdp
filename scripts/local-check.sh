#!/usr/bin/env bash
# scripts/local-check.sh — print local-dev mode status.
#
# Exit 0 always (informational).
set -euo pipefail

PY_SIBLINGS=(pd-book-tools pd-ocr-ops)
NPM_SIBLINGS=(pd-ui)

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GIT_COMMON_DIR="$(git -C "$REPO_ROOT" rev-parse --git-common-dir)"
CANONICAL_REPO_ROOT="$(dirname "$GIT_COMMON_DIR")"
WORKSPACE_ROOT="$(dirname "$CANONICAL_REPO_ROOT")"
# Marker lives in the canonical repo's .venv (shared across worktrees).
MARKER="$CANONICAL_REPO_ROOT/.venv/.pd-local-mode"

say() { echo "$*"; }

if [[ -f "$MARKER" ]]; then
  say "MODE: local-dev (marker present at $MARKER)"
else
  say "MODE: registry (no marker)"
fi
say ""

# Python siblings — query via `uv pip show` from the canonical repo root so the
# project's .venv is discovered correctly even when running from a worktree.
say "Python siblings:"
for s in "${PY_SIBLINGS[@]}"; do
  pip_info=$(cd "$CANONICAL_REPO_ROOT" && uv pip show "$s" 2>/dev/null || true)
  if [[ -z "$pip_info" ]]; then
    say "  ✗ $s — NOT installed"
  else
    ver=$(echo "$pip_info" | awk '/^Version:/ {print $2}')
    editable_loc=$(echo "$pip_info" | awk '/^Editable project location:/ {print $4}')
    if [[ -n "$editable_loc" ]]; then
      say "  ✓ $s editable from $editable_loc ($ver)"
    else
      loc=$(echo "$pip_info" | awk '/^Location:/ {print $2}')
      say "  → $s registry version $ver (at $loc)"
    fi
  fi
done
say ""

# npm siblings (SPA repos)
if [[ -d "$REPO_ROOT/frontend" ]]; then
  say "npm siblings:"
  for s in "${NPM_SIBLINGS[@]}"; do
    pkg_dir="$REPO_ROOT/frontend/node_modules/@concavetrillion/$s"
    if [[ -L "$pkg_dir" ]]; then
      target=$(readlink -f "$pkg_dir")
      say "  ✓ @concavetrillion/$s linked → $target"
    elif [[ -d "$pkg_dir" ]]; then
      ver=$(jq -r .version "$pkg_dir/package.json" 2>/dev/null || echo "unknown")
      say "  → @concavetrillion/$s registry version $ver"
    else
      say "  ✗ @concavetrillion/$s — NOT installed"
    fi
  done
fi
