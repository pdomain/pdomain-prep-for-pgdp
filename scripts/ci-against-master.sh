#!/usr/bin/env bash
# Validate this repo against its pd-* siblings' latest GitHub `master`.
#
# Transient: backs up pyproject.toml + uv.lock, flips pd-* uv sources to
# git+master (locking each sibling's current master SHA for a reproducible run),
# runs the release preflight, then ALWAYS restores the two files and re-syncs.
# Leaves zero committed churn. Refuses to run in local-dev mode.
#
# Per-repo config: OWNER + PY_SIBLINGS below.
# Override the preflight with PREFLIGHT="make test" for a faster smoke.
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

OWNER="pdomain"
PY_SIBLINGS=(pdomain-book-tools pdomain-ops)  # repo-specific; keep in sync with [tool.uv.sources]
PREFLIGHT="${PREFLIGHT:-make ci-slow}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

PROJECT_VENV="$(venv_under "$REPO_ROOT")"
for marker in \
    "$PROJECT_VENV/.pdomain-local-mode" \
    "$PROJECT_VENV/.pdomain-dev-local"; do
    if [ -f "$marker" ]; then
        echo "ERROR: leave local-dev mode before ci-against-master ($marker)" >&2
        exit 1
    fi
done

if ! git diff HEAD --quiet -- pyproject.toml uv.lock; then
    echo "ERROR: pyproject.toml/uv.lock have uncommitted changes." >&2
    echo "       Commit or stash them before running ci-against-master." >&2
    exit 1
fi

BACKUP_DIR="$(mktemp -d)"
cp pyproject.toml "$BACKUP_DIR/pyproject.toml"
cp uv.lock "$BACKUP_DIR/uv.lock"

restore() {
    rc=$?
    echo ""
    echo "Restoring pyproject.toml + uv.lock and re-syncing registry deps..."
    cp "$BACKUP_DIR/pyproject.toml" pyproject.toml || echo "FATAL: failed to restore pyproject.toml" >&2
    cp "$BACKUP_DIR/uv.lock" uv.lock || echo "FATAL: failed to restore uv.lock" >&2
    rm -rf "$BACKUP_DIR"
    uv sync --quiet || true
    exit $rc
}
trap restore EXIT

echo "Flipping pd-* sources to git master: ${PY_SIBLINGS[*]}"
uv run --no-sync python scripts/git_master_sources.py pyproject.toml "$OWNER" "${PY_SIBLINGS[@]}"

echo "Locking against sibling master (captures current SHAs)..."
uv lock
uv sync

echo "Running preflight against sibling master: $PREFLIGHT"
sh -c "$PREFLIGHT"

echo ""
echo "✅ ci-against-master passed — validated against sibling master."
