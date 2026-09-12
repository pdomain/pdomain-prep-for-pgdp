#!/usr/bin/env bash
# scripts/local-dev.sh — switch to local-editable sibling pdomain-* deps.
#
# Calls local-setup first to ensure siblings are cloned.
# Then installs editable siblings (Python + npm), writes marker.
set -euo pipefail

# uv installs into UV_PROJECT_ENVIRONMENT when that is set and into .venv
# otherwise, so mirror the same rule instead of hardcoding either name. The
# pd-suite devcontainer sets ".venv-container" because the workspace is a bind
# mount shared with the host; a plain checkout outside a container gets .venv.
venv_under() {
  case "${UV_PROJECT_ENVIRONMENT:-}" in
    "") printf '%s/.venv' "$1" ;;
    /*) printf '%s' "$UV_PROJECT_ENVIRONMENT" ;;
    *) printf '%s/%s' "$1" "$UV_PROJECT_ENVIRONMENT" ;;
  esac
}

# Repo-specific: Python siblings + npm siblings.
PY_SIBLINGS=(pdomain-book-tools pdomain-ops)
NPM_SIBLINGS=(pdomain-ui)         # paths relative to ../

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GIT_COMMON_DIR="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir)"
CANONICAL_REPO_ROOT="$(dirname "$GIT_COMMON_DIR")"
WORKSPACE_ROOT="$(dirname "$CANONICAL_REPO_ROOT")"
PROJECT_VENV="$(venv_under "$CANONICAL_REPO_ROOT")"
MARKER="$PROJECT_VENV/.pdomain-local-mode"

say() { echo "[local-dev] $*"; }

# Pre-flight: siblings must exist
make -C "$REPO_ROOT" local-setup

# Python: install editable (run from canonical repo root so project .venv is discovered).
for s in "${PY_SIBLINGS[@]}"; do
  say "→ installing editable: $s"
  (cd "$CANONICAL_REPO_ROOT" && uv pip install --python "$PROJECT_VENV/bin/python" --no-deps -e "$WORKSPACE_ROOT/$s")
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
