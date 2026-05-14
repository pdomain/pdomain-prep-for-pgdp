.PHONY: help setup refresh-version install uninstall reset remove-venv lint format \
        pre-commit-check test e2e build clean ci local-setup dev-local install-local \
        uninstall-local check-local-editable run run-cpu run-local frontend-install \
        frontend-build frontend-dev frontend-test openapi-export upgrade-pd-book-tools \
        release-patch release-minor release-major _do-release docker-build docker-run \
        mise-download mise-setup mise-doctor upgrade-deps

# ---------------------------------------------------------------------------
# Peer-repo discovery for *-local targets
# ---------------------------------------------------------------------------
PEER_BOOK_TOOLS_PATH := ../pd-book-tools
PEER_BOOK_TOOLS_REPO := https://github.com/ConcaveTrillion/pd-book-tools.git
PEER_BOOK_TOOLS := $(realpath $(PEER_BOOK_TOOLS_PATH))

define _require_peer_book_tools
	@if [ -z "$(PEER_BOOK_TOOLS)" ]; then \
		echo "❌ Peer repo not found at $(PEER_BOOK_TOOLS_PATH)."; \
		echo "   Run: make local-setup (or clone manually)."; \
		exit 1; \
	fi
endef

help: ## Show this help message
	@echo "Available commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-22s\033[0m %s\n", $$1, $$2}'

setup: ## Sync deps + install pre-commit hooks + refresh version
	@echo "📦 Installing dependencies..."
	uv sync --group dev
	@echo "🪝 Setting up pre-commit hooks..."
	uv run pre-commit install || true
	@$(MAKE) --no-print-directory refresh-version
	@echo "✅ Setup complete!"

refresh-version: ## Force hatch-vcs to re-derive `pgdp-prep --version` from current git state
	@echo "🔄 Reinstalling pd-prep-for-pgdp so hatch-vcs picks up the current HEAD / tags..."
	@# Hatchling's `force-include` of src/pd_prep_for_pgdp/static refuses to
	@# resolve when the directory is missing (FileNotFoundError during the
	@# editable build), so make sure it exists before the editable install.
	@# The wheel-side SPA check (build_hooks/spa_check.py) still gates real
	@# wheel builds on the bundled index.html being present.
	@mkdir -p src/pd_prep_for_pgdp/static
	@UV_LINK_MODE=copy uv pip install -e . --reinstall-package pd-prep-for-pgdp
	@uv run pgdp-prep --version || true

install: ## Install pgdp-prep as a uv tool from local source (auto-detects CUDA)
	@EXTRA_INDEX=""; EXTRAS=""; \
	if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then \
		CUDA_VER=$$(nvidia-smi 2>/dev/null | sed -n 's/.*CUDA Version: \([0-9]*\.[0-9]*\).*/\1/p' | head -1); \
		if [ -n "$$CUDA_VER" ]; then \
			CUDA_TAG="cu$$(echo "$$CUDA_VER" | tr -d '.')"; \
			EXTRA_INDEX="https://download.pytorch.org/whl/$$CUDA_TAG"; \
			EXTRAS="[cuda]"; \
			echo "🟢 Detected CUDA $$CUDA_VER — installing with $$CUDA_TAG + CuPy."; \
		fi; \
	elif [ "$$(uname)" = "Darwin" ] && [ "$$(uname -m)" = "arm64" ]; then \
		echo "🍎 Detected Apple Silicon — DocTR will use MPS automatically."; \
	else \
		echo "💻 No GPU detected — installing CPU-only build."; \
	fi; \
	if [ -n "$$EXTRA_INDEX" ]; then \
		uv tool install --reinstall ".$$EXTRAS" --extra-index-url "$$EXTRA_INDEX"; \
	else \
		uv tool install --reinstall ".$$EXTRAS"; \
	fi; \
	echo "✅ pgdp-prep installed. Run: pgdp-prep --version"

uninstall: ## Remove the installed pgdp-prep uv tool
	@uv tool uninstall pd-prep-for-pgdp || true
	@echo "✅ pgdp-prep uninstalled."

remove-venv: ## Remove the virtual environment
	rm -rf .venv

reset: clean remove-venv setup ## Rebuild the virtual environment
	@echo "✅ Environment Reset!"

upgrade-deps: ## Upgrade dependencies and sync local environment
	@if uv run --no-sync python scripts/detect_dev_local.py >/dev/null 2>&1; then \
		echo "❌ dev-local install detected (editable pd-book-tools)."; \
		echo "   'make upgrade-deps' would silently revert it to the pinned tag."; \
		echo "   Use 'make upgrade-deps-local' to upgrade and re-install editable."; \
		echo "   Or set PD_DEV_LOCAL=0 and run 'make reset' to switch to canonical."; \
		exit 1; \
	fi
	@echo "⬆️ Upgrading dependency lockfile..."
	uv lock --upgrade
	@echo "📦 Syncing upgraded dependencies..."
	uv sync --group dev
	@echo "✅ Dependencies upgraded and environment synced!"

upgrade-deps-local: ## [local-dev] Upgrade deps then restore editable pd-book-tools
	@echo "⬆️ Upgrading dependency lockfile..."
	uv lock --upgrade
	@echo "📦 Syncing upgraded dependencies..."
	uv sync --group dev
	@echo "🔁 Restoring editable pd-book-tools sibling install..."
	@$(MAKE) --no-print-directory dev-local
	@echo "✅ Dependencies upgraded; editable pd-book-tools restored."

upgrade-pd-book-tools: ## Pin pd-book-tools to its latest GitHub tag
	@echo "🔍 Fetching latest pd-book-tools tag..."
	$(eval LATEST_TAG := $(shell curl -sSf "https://api.github.com/repos/ConcaveTrillion/pd-book-tools/tags" | grep '"name"' | head -1 | sed 's/.*"name": "\(.*\)".*/\1/'))
	@if [ -z "$(LATEST_TAG)" ]; then echo "❌ Could not fetch latest tag." && exit 1; fi
	@echo "📌 Pinning to $(LATEST_TAG)..."
	@sed -i 's|pd-book-tools = { git = "https://github.com/ConcaveTrillion/pd-book-tools.git", tag = ".*" }|pd-book-tools = { git = "https://github.com/ConcaveTrillion/pd-book-tools.git", tag = "$(LATEST_TAG)" }|' pyproject.toml
	uv sync --group dev

# ---------------------------------------------------------------------------
# Optional: mise-managed tool versions
# ---------------------------------------------------------------------------
# `mise.toml` pins node/python/uv. The `make mise-setup` target downloads
# the mise binary (locally — no .bashrc edit) and pulls the toolchain.
# Other targets dispatch through `$(MISE) exec --` so make is the only
# place that sees the pinned versions; your interactive shell is unchanged.
#
# If mise isn't installed AND not in `~/.local/bin/`, `frontend-*` targets
# fall back to whatever's on PATH (so contributors with system Node still
# work).

# Resolve mise: PATH first, then the standard local-install location.
MISE := $(shell command -v mise 2>/dev/null || echo $$HOME/.local/bin/mise)
HAVE_MISE = [ -x "$(MISE)" ]
# Run a command through mise if available, fall through to bare PATH otherwise.
MISE_RUN = if $(HAVE_MISE); then $(MISE) exec --; fi

mise-download: ## [optional] Download the mise binary only (no shell init, no tools yet)
	@if $(HAVE_MISE); then \
		echo "✅ mise already installed at $(MISE)"; \
	else \
		echo "📥 Downloading mise to $$HOME/.local/bin/mise..."; \
		curl -fsSL https://mise.run | sh; \
		echo ""; \
		echo "✅ mise downloaded. Run 'make mise-setup' next to install pinned tools."; \
	fi

mise-setup: mise-download ## [optional] Download mise + install pinned tools from mise.toml
	@echo "🔧 Installing tools from mise.toml..."
	@$(MISE) install
	@echo ""
	@echo "✅ mise tools installed."
	@echo "   Make targets dispatch through mise automatically — no shell hook needed."
	@echo "   To use mise interactively too, add this to your shell init:"
	@echo "     eval \"\$$($(MISE) activate bash)\"   # or zsh / fish"

mise-doctor: ## [optional] Show resolved tool versions (mise binary + PATH fallback)
	@echo "── mise binary ──"
	@if $(HAVE_MISE); then \
		echo "  found: $(MISE)"; \
		$(MISE) current 2>/dev/null | sed 's/^/  /' || echo "  (no mise.toml resolved)"; \
	else \
		echo "  not installed (run 'make mise-setup')"; \
	fi
	@echo "── PATH (your interactive shell) ──"
	@command -v node   >/dev/null 2>&1 && echo "  node:   $$(node --version)"   || echo "  node:   not on PATH"
	@command -v npm    >/dev/null 2>&1 && echo "  npm:    $$(npm --version)"    || echo "  npm:    not on PATH"
	@command -v uv     >/dev/null 2>&1 && echo "  uv:     $$(uv --version)"     || echo "  uv:     not on PATH"
	@command -v python >/dev/null 2>&1 && echo "  python: $$(python --version)" || echo "  python: not on PATH"

# ---------------------------------------------------------------------------
# Frontend
# ---------------------------------------------------------------------------
# Each target prefers `mise exec` (so node version matches mise.toml). Falls
# back to PATH `npm` for contributors who manage Node themselves.

# Run npm through mise if available, else use PATH npm directly.
define _npm
	if $(HAVE_MISE); then \
		echo "  (via $(MISE) exec)"; \
		cd frontend && $(MISE) exec -- npm $(1); \
	elif command -v npm >/dev/null 2>&1; then \
		cd frontend && npm $(1); \
	else \
		echo "❌ no npm available."; \
		echo "   Options:"; \
		echo "     • run 'make mise-setup' (downloads mise locally, no shell edit)"; \
		echo "     • install Node 24 yourself"; \
		echo "     • add the devcontainer node feature in .devcontainer/devcontainer.json"; \
		exit 1; \
	fi
endef

frontend-install: ## Install frontend dependencies
	@echo "📦 Installing frontend deps..."
	@$(call _npm,install)

frontend-build: ## Build the SPA into src/pd_prep_for_pgdp/static/ (so the wheel includes it)
	@echo "🛠️  Building frontend..."
	@$(call _npm,install)
	@$(call _npm,run build)
	@mkdir -p src/pd_prep_for_pgdp/static
	@rm -rf src/pd_prep_for_pgdp/static/*
	cp -r frontend/dist/. src/pd_prep_for_pgdp/static/
	@echo "✅ Frontend bundled into src/pd_prep_for_pgdp/static/"

frontend-dev: ## Run Vite dev server (frontend only)
	@$(call _npm,install)
	@$(call _npm,run dev)

frontend-test: ## Run the SPA's vitest suite (jsdom + msw)
	@echo "🧪 Running frontend (vitest) tests..."
	@$(call _npm,install)
	@$(call _npm,test)

frontend-lint: ## Run ESLint on the SPA
	@echo "🧹 Running frontend ESLint..."
	@$(call _npm,install)
	@$(call _npm,run lint)

frontend-format-check: ## Check SPA formatting with Prettier
	@echo "🎨 Checking frontend formatting (Prettier)..."
	@$(call _npm,install)
	@$(call _npm,run format:check)

frontend-format: ## Apply Prettier formatting to the SPA
	@echo "🎨 Applying Prettier to the frontend..."
	@$(call _npm,install)
	@$(call _npm,run format)

openapi-export: ## Regenerate openapi.json + frontend/src/api/types.gen.ts
	@echo "📤 Exporting OpenAPI schema and regenerating TS types..."
	# Write to repo-root openapi.json — the committed source-of-truth that
	# tests/test_openapi_spec_committed.py drift-guards against. The frontend
	# `openapi:gen` script reads `../openapi.json` (see frontend/package.json).
	#
	# Codegen lands in `types.gen.ts`, *not* the hand-written `types.ts`.
	# SPA consumers still import from `types.ts`; the generated file exists
	# so we can audit the diff and migrate surfaces deliberately (P4 #20).
	uv run python scripts/export_openapi.py openapi.json
	@if $(HAVE_MISE); then \
		cd frontend && $(MISE) exec -- npx --yes openapi-typescript ../openapi.json -o src/api/types.gen.ts; \
	else \
		cd frontend && npx --yes openapi-typescript ../openapi.json -o src/api/types.gen.ts; \
	fi
	@echo "✅ frontend/src/api/types.gen.ts regenerated."

# ---------------------------------------------------------------------------
# Lint / format / test / build
# ---------------------------------------------------------------------------

lint: ## Run ruff checks
	uv run ruff check --select I --fix
	uv run ruff check --fix

format: ## Format code with ruff
	uv run ruff format
	@$(MAKE) --no-print-directory lint

pre-commit-check: ## Run pre-commit on all files
	uv run pre-commit run --all-files

test: ## Run pytest (excludes e2e/)
	uv run pytest tests/ -v --ignore=tests/e2e

e2e: frontend-build ## Run Playwright E2E tests (requires `playwright install chromium`)
	uv run --group e2e pytest tests/e2e -v

build: frontend-build ## Build the wheel (with frontend bundled)
	# `--wheel` skips the sdist step. The build hook in
	# build_hooks/spa_check.py refuses to build a wheel without
	# src/pd_prep_for_pgdp/static/index.html, and that directory is
	# .gitignore'd — so the default `uv build` (sdist → wheel-from-sdist)
	# fails because the unpacked sdist has no SPA. Wheel-only is the
	# supported path; CI mirrors this in .github/workflows/release.yml.
	uv build --wheel

clean: ## Clean cache + build artifacts
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name ".pytest_cache" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name "*.egg-info" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name ".ruff_cache" -exec rm -rf {} + 2>/dev/null || true
	rm -rf dist/ src/pd_prep_for_pgdp/static/ frontend/dist/ 2>/dev/null || true

ci: setup frontend-install pre-commit-check openapi-export frontend-build test frontend-format-check frontend-lint frontend-test ## Full CI pipeline

# ---------------------------------------------------------------------------
# Local editable workflow (requires ../pd-book-tools sibling checkout)
# ---------------------------------------------------------------------------

local-setup: ## [local-dev] Clone ../pd-book-tools if missing and set up the editable workspace
	@if [ ! -d "$(PEER_BOOK_TOOLS_PATH)" ]; then \
		echo "📥 Cloning pd-book-tools..."; \
		git clone "$(PEER_BOOK_TOOLS_REPO)" "$(PEER_BOOK_TOOLS_PATH)"; \
	fi
	@$(MAKE) --no-print-directory dev-local

dev-local: ## [local-dev] Install pd-book-tools editable from ../pd-book-tools
	$(call _require_peer_book_tools)
	UV_LINK_MODE=copy uv sync --group dev
	UV_LINK_MODE=copy uv pip install -e "$(PEER_BOOK_TOOLS)"
	@mkdir -p .venv && touch .venv/.dev-local
	@$(MAKE) --no-print-directory check-local-editable

install-local: ## [local-dev] Install pgdp-prep with both . and ../pd-book-tools editable
	$(call _require_peer_book_tools)
	UV_LINK_MODE=copy uv tool install --force --reinstall --no-sources --editable . --with-editable "$(PEER_BOOK_TOOLS)"
	@mkdir -p .venv && touch .venv/.dev-local
	@echo "✅ 'pgdp-prep' is on PATH and tracks ./ + $(PEER_BOOK_TOOLS) live."

uninstall-local: ## [local-dev] Uninstall the local-editable pgdp-prep tool
	uv tool uninstall pd-prep-for-pgdp || true

check-local-editable: ## [local-dev] Verify pd-book-tools resolves to the sibling checkout
	$(call _require_peer_book_tools)
	@env -u VIRTUAL_ENV UV_NO_SYNC=1 uv run python -c "import inspect, os, sys, pd_book_tools; \
module_file = os.path.realpath(inspect.getfile(pd_book_tools)); \
peer = os.path.realpath('$(PEER_BOOK_TOOLS)'); \
print('module_file=', module_file); \
print('expected_peer=', peer); \
sys.exit(0 if module_file.startswith(peer + os.sep) or module_file == peer else 1)" \
	|| (echo "❌ pd-book-tools is not local/editable. Run: make dev-local" >&2; exit 1)

# ---------------------------------------------------------------------------
# `make run` — canonical local-mode entry point.
#
# Builds the SPA bundle into src/pd_prep_for_pgdp/static/ first (so the
# single FastAPI process serves the React app at `/`), then launches
# `pgdp-prep`. App comes up at http://127.0.0.1:8765 (or the next free
# port if 8765 is taken — see L1 fallback in `__main__.py`).
#
# GPU is auto-detected: with a working CUDA runtime the autodetect picks
# `LocalBackend` (which subclasses CpuBackend), and DocTR/PyTorch use
# `cuda:0` automatically. Watch the startup log for "local backend on
# cuda:0" vs "local backend on cpu" to confirm.
#
# Pass extra args via ARGS, e.g. `make run ARGS="--port 9000"`.
# ---------------------------------------------------------------------------
run: frontend-build ## Build the SPA + launch pgdp-prep on :8765 (auto GPU)
	@echo "🚀 Launching pgdp-prep at http://127.0.0.1:8765 (auto-detect GPU)..."
	uv run pgdp-prep $(ARGS)

# ---------------------------------------------------------------------------
# `make run-cpu` — same as `make run` but force the CPU backend.
#
# Use when a GPU is present but you want to skip CUDA paths: debugging,
# weak GPU, or working around CUDA OOM on a smaller card.
# ---------------------------------------------------------------------------
run-cpu: frontend-build ## Build SPA + launch pgdp-prep with PGDP_GPU_BACKEND=cpu
	@echo "🚀 Launching pgdp-prep at http://127.0.0.1:8765 (CPU backend forced)..."
	PGDP_GPU_BACKEND=cpu uv run pgdp-prep $(ARGS)

run-local: check-local-editable ## [local-dev] Run pgdp-prep against the local editable workspace
	env -u VIRTUAL_ENV UV_NO_SYNC=1 uv run pgdp-prep $(ARGS)

# ---------------------------------------------------------------------------
# Docker (managed mode)
# ---------------------------------------------------------------------------

docker-build: frontend-build ## Build the managed-mode container image
	docker build -t pgdp-prep:dev .

docker-run: ## Run the container locally on :8765
	docker run --rm -p 8765:8765 \
		-v $$HOME/pgdp-projects:/data \
		-e PGDP_DATA_ROOT=/data \
		pgdp-prep:dev

# ---------------------------------------------------------------------------
# Releases
# ---------------------------------------------------------------------------

release-patch: ## Release: bump patch, run ci, tag, push, trigger GitHub release workflow (e.g. v0.4.2 → v0.4.3)
	@$(MAKE) --no-print-directory _do-release BUMP=patch

release-minor: ## Release: bump minor, run ci, tag, push, trigger GitHub release workflow (e.g. v0.4.2 → v0.5.0)
	@$(MAKE) --no-print-directory _do-release BUMP=minor

release-major: ## Release: bump major, run ci, tag, push, trigger GitHub release workflow (e.g. v0.4.2 → v1.0.0)
	@$(MAKE) --no-print-directory _do-release BUMP=major

# scripts/do-release.sh handles repo-state guards, runs the ci pre-flight,
# creates a three-component tag, pushes main + tag, and triggers the
# GitHub release workflow via `gh workflow run`.
# Pass FORCE=1 to skip the repo-state guards (pre-flight still runs).
# Pass SKIP_PUSH=1 to create the tag locally without pushing (dry-run).
_do-release:
	@BUMP=$(or $(BUMP),minor) ./scripts/do-release.sh
