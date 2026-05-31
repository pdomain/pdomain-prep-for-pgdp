#!/usr/bin/env bash
# scripts/local-setup-py.sh — re-apply editable Python siblings (idempotent).
#
# Called by local-run.sh before launch so editable pdomain-* siblings survive
# any uv sync that may have reverted them.
set -euo pipefail

# Keep PY_SIBLINGS in sync with scripts/local-dev.sh.
PY_SIBLINGS=(pdomain-book-tools pdomain-ops)

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GIT_COMMON_DIR="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir)"
CANONICAL_REPO_ROOT="$(dirname "$GIT_COMMON_DIR")"
WORKSPACE_ROOT="$(dirname "$CANONICAL_REPO_ROOT")"
MARKER="$CANONICAL_REPO_ROOT/.venv/.pdomain-local-mode"

say() { echo "[local-setup-py] $*"; }

if [[ ! -f "$MARKER" ]]; then
  echo "ERROR: not in local-dev mode. Run 'make local-dev' first." >&2
  exit 1
fi

for s in "${PY_SIBLINGS[@]}"; do
  if [[ ! -d "$WORKSPACE_ROOT/$s" ]]; then
    say "✗ sibling missing: $WORKSPACE_ROOT/$s (run 'make local-setup'); skipping"
    continue
  fi
  say "→ installing editable: $s"
  (cd "$CANONICAL_REPO_ROOT" && uv pip install --no-deps -e "$WORKSPACE_ROOT/$s")
done

say "✓ editable Python siblings re-applied"
