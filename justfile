set shell := ["bash", "-eu", "-o", "pipefail", "-c"]
set positional-arguments

# Copy this wrapper and install-hooks with the shell setting to sibling justfiles.
[private]
_ai +args:
    #!/usr/bin/env bash
    set -euo pipefail
    if env AI= just --quiet "$@" > .ci-ai.log 2>&1; then
        printf 'PASS: %s\n' "$*"
    else
        result=$?
        printf 'FAIL: %s (exit %s)\n' "$*" "$result"
        if [[ -f scripts/ai_filter_log.py ]]; then
            uv run python scripts/ai_filter_log.py .ci-ai.log
        else
            tail -50 .ci-ai.log
        fi
        exit "$result"
    fi

install-hooks:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai install-hooks; fi
    if [[ -f .git ]]; then
        echo "hooks: worktree checkout - the canonical repo owns them, skipping"
    elif [[ -n "$(git config --get core.hooksPath || true)" ]]; then
        echo "hooks: core.hooksPath is set - leaving it alone, skipping"
    else
        uv run pre-commit install --hook-type pre-commit --hook-type commit-msg
    fi

[private]
_pnpm +args:
    #!/usr/bin/env bash
    set -euo pipefail
    mise=$(command -v mise || printf '%s/.local/bin/mise' "$HOME")
    cd frontend
    if [[ -x "$mise" ]]; then
        exec "$mise" exec -- pnpm "$@"
    fi
    exec pnpm "$@"

help:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai help; fi
    just --list

setup:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai setup; fi
    uv sync --locked --group dev
    just --quiet install-hooks refresh-version

refresh-version:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai refresh-version; fi
    mkdir -p src/pdomain_prep_for_pgdp/static
    uv sync --locked --reinstall-package pdomain-prep-for-pgdp
    uv run pgdp-prep --version || true

install:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai install; fi
    EXTRA_INDEX=""; EXTRAS=""; \
    if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then \
        CUDA_VER=$(nvidia-smi 2>/dev/null | sed -n 's/.*CUDA Version: \([0-9]*\.[0-9]*\).*/\1/p' | head -1); \
        if [ -n "$CUDA_VER" ]; then \
            CUDA_TAG="cu$(echo "$CUDA_VER" | tr -d '.')"; \
            EXTRA_INDEX="https://download.pytorch.org/whl/$CUDA_TAG"; \
            EXTRAS="[cuda]"; \
            echo "🟢 Detected CUDA $CUDA_VER — installing with $CUDA_TAG + CuPy."; \
        fi; \
    elif [ "$(uname)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ]; then \
        echo "🍎 Detected Apple Silicon — DocTR will use MPS automatically."; \
    else \
        echo "💻 No GPU detected — installing CPU-only build."; \
    fi; \
    if [ -n "$EXTRA_INDEX" ]; then \
        uv tool install --reinstall ".$EXTRAS" --extra-index-url "$EXTRA_INDEX"; \
    else \
        uv tool install --reinstall ".$EXTRAS"; \
    fi; \
    echo "✅ pgdp-prep installed. Run: pgdp-prep --version"

uninstall:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai uninstall; fi
    uv tool uninstall pdomain-prep-for-pgdp || true
    echo "✅ pgdp-prep uninstalled."

remove-venv:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai remove-venv; fi
    rm -rf "${UV_PROJECT_ENVIRONMENT:-.venv}"

reset:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai reset; fi
    just --quiet clean remove-venv setup
    echo "✅ Environment Reset!"

upgrade-deps:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai upgrade-deps; fi
    if uv run --no-sync python scripts/detect_dev_local.py >/dev/null 2>&1; then \
        echo "❌ local-dev install detected (editable siblings present)."; \
        echo "   'just upgrade-deps' would silently revert them to pinned registry versions."; \
        echo "   Use 'just local-upgrade-deps' to upgrade and restore editable siblings."; \
        echo "   Or remove "${UV_PROJECT_ENVIRONMENT:-.venv}"/.pdomain-local-mode and run 'just reset' to switch to canonical."; \
        exit 1; \
    fi
    echo "⬆️ Upgrading dependency lockfile..."
    uv lock --upgrade
    echo "📦 Syncing upgraded dependencies..."
    uv sync --group dev
    just --quiet update-hooks
    echo "✅ Dependencies upgraded and environment synced!"

update-pdomain-deps:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai update-pdomain-deps; fi
    ./scripts/update-pdomain-deps.sh

upgrade-pdomain-book-tools:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai upgrade-pdomain-book-tools; fi
    echo "warning: 'upgrade-pdomain-book-tools' is deprecated; use 'just update-pdomain-deps'"
    just --quiet update-pdomain-deps

mise-download:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai mise-download; fi
    mise=$(command -v mise || printf '%s/.local/bin/mise' "$HOME")
    if [ -x "$mise" ]; then \
        echo "mise already installed at $mise"; \
    else \
        echo "Downloading mise v2026.5.15 to $HOME/.local/bin/mise..."; \
        MISE_TMP=$(mktemp) && \
        curl -fsSL -o "$MISE_TMP" "https://github.com/jdx/mise/releases/download/v2026.5.15/install.sh" && \
        sh "$MISE_TMP" && \
        rm -f "$MISE_TMP"; \
        echo "mise downloaded. Run 'just mise-setup' next to install pinned tools."; \
    fi

mise-trust-worktrees:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai mise-trust-worktrees; fi
    just --quiet mise-download
    echo "🔐 Trusting mise config roots for this repo and generated worktrees..."
    mkdir -p "$HOME/.config/mise/conf.d"
    printf '%s\n' \
        '[settings]' \
        'trusted_config_paths = [' \
        '    "{{ justfile_directory() }}/..",' \
        '    "/srv/bot-workspaces",' \
        ']' \
        > "$HOME/.config/mise/conf.d/ocr-container-worktrees.toml"
    echo "✅ mise trust roots configured."

mise-setup:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai mise-setup; fi
    mise=$(command -v mise || printf '%s/.local/bin/mise' "$HOME")
    just --quiet mise-download mise-trust-worktrees
    echo "🔧 Installing tools from mise.toml..."
    $mise install
    echo ""
    echo "✅ mise tools installed."
    echo "   Just recipes dispatch through mise automatically — no shell hook needed."
    echo "   To use mise interactively too, add this to your shell init:"
    echo "     eval \"\$($mise activate bash)\"   # or zsh / fish"

mise-doctor:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai mise-doctor; fi
    mise=$(command -v mise || printf '%s/.local/bin/mise' "$HOME")
    echo "── mise binary ──"
    if [ -x "$mise" ]; then \
        echo "  found: $mise"; \
        $mise current 2>/dev/null | sed 's/^/  /' || echo "  (no mise.toml resolved)"; \
    else \
        echo "  not installed (run 'just mise-setup')"; \
    fi
    echo "── PATH (your interactive shell) ──"
    command -v node   >/dev/null 2>&1 && echo "  node:   $(node --version)"   || echo "  node:   not on PATH"
    command -v pnpm   >/dev/null 2>&1 && echo "  pnpm:   $(pnpm --version)"   || echo "  pnpm:   not on PATH"
    command -v uv     >/dev/null 2>&1 && echo "  uv:     $(uv --version)"     || echo "  uv:     not on PATH"
    command -v python >/dev/null 2>&1 && echo "  python: $(python --version)" || echo "  python: not on PATH"

frontend-install:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai frontend-install; fi
    if [[ "${PREP_FRONTEND_INSTALLED:-}" == 1 ]]; then exit 0; fi
    just --quiet _pnpm install --frozen-lockfile

frontend-build:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai frontend-build; fi
    just --quiet frontend-install
    just --quiet _pnpm run build
    mkdir -p src/pdomain_prep_for_pgdp/static
    rm -rf src/pdomain_prep_for_pgdp/static/*
    cp -r frontend/dist/. src/pdomain_prep_for_pgdp/static/

frontend-dev:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai frontend-dev; fi
    just --quiet frontend-install
    just --quiet _pnpm run dev

frontend-test:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai frontend-test; fi
    just --quiet frontend-install
    just --quiet _pnpm run test

frontend-lint:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai frontend-lint; fi
    just --quiet frontend-install
    just --quiet _pnpm run lint

frontend-knip:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai frontend-knip; fi
    just --quiet frontend-install
    just --quiet _pnpm run knip

frontend-format-check:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai frontend-format-check; fi
    just --quiet frontend-install
    just --quiet _pnpm run format:check

frontend-format:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai frontend-format; fi
    just --quiet frontend-install
    just --quiet _pnpm run format

openapi-export:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai openapi-export; fi
    just --quiet frontend-install
    uv run python scripts/export_openapi.py openapi.json
    just --quiet _pnpm exec openapi-typescript ../openapi.json -o src/api/types.gen.ts

typecheck:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai typecheck; fi
    uv run basedpyright src/pdomain_prep_for_pgdp --level error

lint:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai lint; fi
    uv run ruff check --select I --fix
    uv run ruff check --fix

format:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai format; fi
    uv run ruff format .

pre-commit-check:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai pre-commit-check; fi
    uv run pre-commit run --all-files

update-hooks:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai update-hooks; fi
    echo "⬆️  Updating pinned pre-commit hook revisions..."
    uv run pre-commit autoupdate --freeze
    echo "✅ Hook revisions updated — review the .pre-commit-config.yaml diff."

test:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai test; fi
    uv run pytest tests/ -v --ignore=tests/e2e -n auto

test-slow:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai test-slow; fi
    just --quiet frontend-build
    uv run pytest tests/ -v --ignore=tests/e2e -n auto -m slow

e2e:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai e2e; fi
    just --quiet frontend-build
    uv run --group e2e pytest tests/e2e -v

audit:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai audit; fi
    uv run scripts/dep_audit.py

e2e-smoke:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai e2e-smoke; fi
    just --quiet frontend-build
    uv run --group e2e pytest tests/e2e -m e2e_smoke --no-cov -v

build:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai build; fi
    just --quiet frontend-install
    export PREP_FRONTEND_INSTALLED=1
    just --quiet openapi-export frontend-build
    uv build --sdist
    uv build --wheel

clean:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai clean; fi
    find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
    find . -type d -name ".pytest_cache" -exec rm -rf {} + 2>/dev/null || true
    find . -type d -name "*.egg-info" -exec rm -rf {} + 2>/dev/null || true
    find . -type d -name ".ruff_cache" -exec rm -rf {} + 2>/dev/null || true
    rm -rf dist/ src/pdomain_prep_for_pgdp/static/ frontend/dist/ 2>/dev/null || true

[default]
ci:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai ci; fi
    just --quiet setup frontend-install
    export PREP_FRONTEND_INSTALLED=1
    just --quiet pre-commit-check lint-check typecheck openapi-export frontend-typecheck frontend-build test frontend-format-check frontend-lint-check frontend-test frontend-knip e2e-smoke
    docgraph check --strict

ci-slow:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai ci-slow; fi
    just --quiet frontend-install
    export PREP_FRONTEND_INSTALLED=1
    just --quiet ci build test-slow

ci-against-master:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai ci-against-master; fi
    ./scripts/ci-against-master.sh

local-setup:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai local-setup; fi
    ./scripts/local-setup.sh

local-dev:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai local-dev; fi
    ./scripts/local-dev.sh

local-check:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai local-check; fi
    ./scripts/local-check.sh

local-upgrade-deps:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai local-upgrade-deps; fi
    ./scripts/local-upgrade-deps.sh

local-install:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai local-install; fi
    ./scripts/local-install.sh

local-uninstall:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai local-uninstall; fi
    ./scripts/local-uninstall.sh

local-run:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai local-run; fi
    ./scripts/local-run.sh

local-setup-py:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai local-setup-py; fi
    ./scripts/local-setup-py.sh

local-frontend-install:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai local-frontend-install; fi
    ./scripts/local-frontend-install.sh

local-frontend-build:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai local-frontend-build; fi
    just --quiet local-frontend-install
    just --quiet _pnpm run build
    mkdir -p src/pdomain_prep_for_pgdp/static
    rm -rf src/pdomain_prep_for_pgdp/static/*
    cp -r frontend/dist/. src/pdomain_prep_for_pgdp/static/
    echo "✅ Frontend bundled into src/pdomain_prep_for_pgdp/static/"

dev-local:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai dev-local; fi
    echo "warning: 'dev-local' is deprecated; use 'local-dev'"
    just --quiet local-dev

install-local:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai install-local; fi
    echo "warning: 'install-local' is deprecated; use 'local-install'"
    just --quiet local-install

uninstall-local:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai uninstall-local; fi
    echo "warning: 'uninstall-local' is deprecated; use 'local-uninstall'"
    just --quiet local-uninstall

check-local-editable:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai check-local-editable; fi
    echo "warning: 'check-local-editable' is deprecated; use 'local-check'"
    just --quiet local-check

upgrade-deps-local:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai upgrade-deps-local; fi
    echo "warning: 'upgrade-deps-local' is deprecated; use 'local-upgrade-deps'"
    just --quiet local-upgrade-deps

run:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai run; fi
    if [ ! -f src/pdomain_prep_for_pgdp/static/index.html ] || [ -n "$(find frontend/src frontend/index.html frontend/package.json frontend/vite.config.ts frontend/tailwind.config.ts frontend/postcss.config.js frontend/tsconfig.json -newer src/pdomain_prep_for_pgdp/static/index.html 2>/dev/null)" ]; then \
        echo "SPA bundle stale or missing; running frontend-build first..."; \
        just --quiet frontend-build; \
    else \
        echo "SPA bundle up to date."; \
    fi
    uv run pgdp-prep ${ARGS:-}

run-cpu:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai run-cpu; fi
    if [ ! -f src/pdomain_prep_for_pgdp/static/index.html ] || [ -n "$(find frontend/src frontend/index.html frontend/package.json frontend/vite.config.ts frontend/tailwind.config.ts frontend/postcss.config.js frontend/tsconfig.json -newer src/pdomain_prep_for_pgdp/static/index.html 2>/dev/null)" ]; then \
        echo "SPA bundle stale or missing; running frontend-build first..."; \
        just --quiet frontend-build; \
    else \
        echo "SPA bundle up to date."; \
    fi
    PGDP_GPU_BACKEND=cpu uv run pgdp-prep ${ARGS:-}

run-local:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai run-local; fi
    echo "warning: 'run-local' is deprecated; use 'local-run'"
    just --quiet local-run

docker-build:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai docker-build; fi
    just --quiet frontend-build
    docker build --build-arg VERSION=$(git describe --tags --always --dirty) -t pgdp-prep:dev .

docker-run:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai docker-run; fi
    docker run --rm -p 8765:8765 \
        -v $HOME/pgdp-projects:/data \
        -e PGDP_DATA_ROOT=/data \
        pgdp-prep:dev

release-patch:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai release-patch; fi
    BUMP=patch ./scripts/do-release.sh

release-minor:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai release-minor; fi
    BUMP=minor ./scripts/do-release.sh

release-major:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai release-major; fi
    BUMP=major ./scripts/do-release.sh

[private]
_do-release:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai _do-release; fi
    BUMP="${BUMP:-minor}" ./scripts/do-release.sh

format-check:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai format-check; fi
    uv run ruff format --check .

lint-check:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai lint-check; fi
    uv run ruff format --check .
    uv run ruff check .

frontend-lint-check:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai frontend-lint-check; fi
    just --quiet frontend-install
    just --quiet _pnpm run lint:check

frontend-typecheck:
    #!/usr/bin/env bash
    set -euo pipefail
    if [[ -n "${AI:-}" ]]; then exec just --quiet _ai frontend-typecheck; fi
    just --quiet frontend-install
    just --quiet _pnpm run typecheck
