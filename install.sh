#!/bin/sh
set -e

# Install pgdp-prep as a standalone tool using uv.
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/ConcaveTrillion/pd-prep-for-pgdp/main/install.sh | sh
#
# This script downloads the prebuilt wheel attached to the latest GitHub
# Release and runs `uv tool install` against it. The wheel ships with the
# React SPA already bundled, so end users do NOT need Node, npm, or a
# JavaScript toolchain — only `uv` (which this script will install for you).

REPO="ConcaveTrillion/pd-prep-for-pgdp"

# Shared temp directory; cleaned up on exit, interrupt, or termination.
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT INT TERM

# 1. Install uv if not already present.
#
# Security (F-017 Option B): download from a pinned, immutable GitHub
# Release asset URL rather than piping https://astral.sh/uv/install.sh
# directly to a shell. GitHub Release assets at tagged URLs are immutable
# once published; TLS to github.com provides transport integrity. Upstream
# (astral-sh/uv) does not publish a checksum for the installer script
# itself (sha256.sum covers binary tarballs only), so the pinned-tag
# approach is the pragmatic baseline. To upgrade: update UV_VER below.
UV_VER="0.11.16"
if ! command -v uv >/dev/null 2>&1; then
    echo "uv not found — installing uv ${UV_VER} from GitHub Releases..."
    UV_INST="${TMPDIR}/uv-installer.sh"
    curl -LsSf -o "$UV_INST" \
        "https://github.com/astral-sh/uv/releases/download/${UV_VER}/uv-installer.sh"
    sh "$UV_INST"
    export PATH="$HOME/.local/bin:$PATH"
fi

EXTRA_INDEX=""
EXTRAS=""

# 2. Detect platform → pick PyTorch index
if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
    CUDA_VER=$(nvidia-smi 2>/dev/null | sed -n 's/.*CUDA Version: \([0-9]*\.[0-9]*\).*/\1/p' | head -1)
    if [ -n "$CUDA_VER" ]; then
        CUDA_TAG="cu$(echo "$CUDA_VER" | tr -d '.')"
        EXTRA_INDEX="https://download.pytorch.org/whl/${CUDA_TAG}"
        EXTRAS="[cuda]"
        echo "Detected CUDA ${CUDA_VER} — installing with ${CUDA_TAG} + CuPy."
    else
        echo "nvidia-smi found but could not detect CUDA version — falling back to CPU."
    fi
elif [ "$(uname)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ]; then
    echo "Detected Apple Silicon — DocTR will use MPS automatically."
else
    echo "No GPU detected — installing CPU-only build."
fi

# 3. Resolve latest published release from the GitHub API.
#    `/releases/latest` returns the most recent *published* release
#    (ignoring drafts/prereleases) and embeds asset URLs directly.
RELEASE_JSON=$(curl -sSf \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null) || true

if [ -z "$RELEASE_JSON" ]; then
    echo "Error: could not resolve the latest release from GitHub." >&2
    echo "       https://api.github.com/repos/${REPO}/releases/latest returned nothing usable." >&2
    exit 1
fi

LATEST_TAG=$(printf '%s\n' "$RELEASE_JSON" \
    | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')

echo "Installing pgdp-prep ${LATEST_TAG}..."

# 4. Find the wheel asset attached to the GitHub Release for this tag.
#    We don't know the exact wheel filename ahead of time (hatch-vcs derives
#    it from the tag, e.g. pd_prep_for_pgdp-0.2.0-py3-none-any.whl), so we
#    glob for any `*.whl` asset on the release.
WHEEL_URL=$(printf '%s\n' "$RELEASE_JSON" \
    | grep '"browser_download_url"' \
    | grep -E '\.whl"' \
    | head -1 \
    | sed 's/.*"browser_download_url": *"\([^"]*\)".*/\1/')

if [ -z "$WHEEL_URL" ]; then
    # Hard-fail rather than fall back to `git+...`. The git+ path requires
    # Node + npm on the user's machine to build the React SPA at install
    # time, which is exactly the requirement this script is designed to
    # avoid. Falling back silently would surface a confusing "vite: command
    # not found" failure from inside `uv build`. Better to tell the user
    # plainly what went wrong.
    echo "Error: no .whl asset attached to release ${LATEST_TAG}." >&2
    echo "       Expected a wheel uploaded by .github/workflows/release.yml." >&2
    echo "       Check https://github.com/${REPO}/releases/tag/${LATEST_TAG}" >&2
    echo "       — the release workflow may have failed, or this is an" >&2
    echo "       older tag from before wheel publishing was wired up." >&2
    exit 1
fi

# 5. Download the wheel to the shared temp dir and install it as a uv tool.
#    Using a local path lets us attach extras via `<path>[cuda]`, which uv
#    accepts cleanly. (PEP 508 direct references like
#    `pd_prep_for_pgdp[cuda] @ <url>` also work, but the local-path form
#    is simpler to reason about and gives us a real file to reference in
#    error messages.)
WHEEL_FILE="${TMPDIR}/$(basename "$WHEEL_URL")"
echo "Downloading ${WHEEL_URL}..."
curl -fsSL -o "$WHEEL_FILE" "$WHEEL_URL"

INSTALL_TARGET="${WHEEL_FILE}${EXTRAS}"

if [ -n "$EXTRA_INDEX" ]; then
    uv tool install --reinstall "$INSTALL_TARGET" --extra-index-url "$EXTRA_INDEX"
else
    uv tool install --reinstall "$INSTALL_TARGET"
fi

echo ""
echo "Done! Run: pgdp-prep"
echo "If 'pgdp-prep' is not found, add uv's tool bin to your PATH:"
echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
