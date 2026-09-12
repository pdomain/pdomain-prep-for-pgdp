#!/usr/bin/env bash
# scripts/local-upgrade-deps.sh — upgrade deps then restore local-editable.
#
# Refuses if not in local-dev mode (use `make upgrade-deps` for registry mode).
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

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GIT_COMMON_DIR="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir)"
CANONICAL_REPO_ROOT="$(dirname "$GIT_COMMON_DIR")"
PROJECT_VENV="$(venv_under "$CANONICAL_REPO_ROOT")"
MARKER="$PROJECT_VENV/.pdomain-local-mode"

say() { echo "[local-upgrade-deps] $*"; }

if [[ ! -f "$MARKER" ]]; then
  echo "ERROR: not in local-dev mode (no marker at $MARKER)." >&2
  echo "       Run 'make upgrade-deps' instead." >&2
  exit 1
fi

# Run uv commands from the canonical repo root so the project .venv is found.
say "→ uv lock --upgrade"
(cd "$CANONICAL_REPO_ROOT" && uv lock --upgrade)
say "→ uv sync"
(cd "$CANONICAL_REPO_ROOT" && uv sync)
say "→ uv sync wiped editables; re-running 'make local-dev' to restore"
make -C "$REPO_ROOT" local-dev
say "✓ local mode restored after upgrade."
