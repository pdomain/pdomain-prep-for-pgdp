#!/usr/bin/env bash
# scripts/local-install.sh — install uv tool with editable sibling overrides.
#
# Requires local-dev mode (marker must be present).
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

TOOL_NAME="pgdp-prep"               # repo-specific
PY_SIBLINGS=(pdomain-book-tools pdomain-ops)
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GIT_COMMON_DIR="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir)"
CANONICAL_REPO_ROOT="$(dirname "$GIT_COMMON_DIR")"
WORKSPACE_ROOT="$(dirname "$CANONICAL_REPO_ROOT")"
PROJECT_VENV="$(venv_under "$CANONICAL_REPO_ROOT")"
MARKER="$PROJECT_VENV/.pdomain-local-mode"

say() { echo "[local-install] $*"; }

if [[ ! -f "$MARKER" ]]; then
  echo "ERROR: not in local-dev mode. Run 'make local-dev' first." >&2
  exit 1
fi

# Build --with-editable args
WITH_ARGS=()
for s in "${PY_SIBLINGS[@]}"; do
  WITH_ARGS+=(--with-editable "$WORKSPACE_ROOT/$s")
done

say "→ uv tool install --editable . ${WITH_ARGS[*]}"
uv tool install --editable . "${WITH_ARGS[@]}" --force

say "✓ $TOOL_NAME installed with editable siblings."
