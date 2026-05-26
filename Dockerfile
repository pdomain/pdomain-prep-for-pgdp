# pd-prep-for-pgdp — managed-mode container (CPU-only Fargate task).
#
# GPU work dispatches out to Modal (or a shared GPU container) so this image
# stays small and CPU-only. See spec 09.

# ──────────────────────────── Stage 1: build frontend ───────────────────────
FROM node:24.15.0-bookworm-slim AS frontend-build
WORKDIR /app
# Enable corepack so pnpm is available without a separate install step.
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml frontend/.npmrc ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm run build

# ──────────────────────────── Stage 2: install Python ───────────────────────
FROM python:3.13.13-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    UV_NO_PROGRESS=1 \
    UV_LINK_MODE=copy

# git is needed by uv for any git-sourced deps that may be added in future.
# ca-certificates so HTTPS fetches (registry wheels, git clones) work.
RUN apt-get update \
    && apt-get install --no-install-recommends -y git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# uv (fast resolver/installer). Pull the binary from astral's official
# image — `python:3.13-slim` has no curl/wget, so the install.sh path
# (used in the local installer) doesn't work here.
COPY --from=ghcr.io/astral-sh/uv:0.11.16 /uv /usr/local/bin/uv

# Non-root user for runtime security. UID/GID 1000 matches the default
# user on most Linux distros; override at build time if the host bind-mount
# UID differs (e.g. --build-arg APP_UID=1001).
#
# Note: bind-mount users must ensure the host directory is owned by the same
# UID (default 1000) or Docker-mounted with matching permissions. In managed
# mode (S3 storage) no local bind-mounts are needed.
ARG APP_UID=1000
ARG APP_GID=1000
RUN groupadd -g ${APP_GID} app \
    && useradd -m -u ${APP_UID} -g app -s /bin/bash app

WORKDIR /app

# hatch-vcs derives the version from git tags. The build context doesn't
# ship `.git/`, so we statically pin the version into pyproject.toml at
# build time. CI passes the real tag via --build-arg VERSION=…;
# ad-hoc builds default to 0.0.0+docker.
ARG VERSION=0.0.0+docker

# Project metadata first so dependency-only layer caches well.
# uv.lock pins every transitive dep to exact hashes for reproducibility.
COPY pyproject.toml uv.lock ./
COPY src/ ./src/
COPY README.md ./

# Bring in the built frontend before installing — pyproject.toml's
# force-include needs the directory to exist at install time.
COPY --from=frontend-build /app/dist/ ./src/pd_prep_for_pgdp/static/

# Replace `dynamic = ["version"]` with a literal version line. The
# [tool.hatch.version] block in pyproject.toml becomes inert when version
# is static, so we don't need to touch it.
RUN sed -i 's|^dynamic = \["version"\]|version = "'"${VERSION}"'"|' pyproject.toml \
    && grep -E '^(version|dynamic)' pyproject.toml

# Install from uv.lock for exact reproducibility. UV_SYSTEM_PYTHON=1 installs
# into the system Python instead of a venv. --frozen refuses to update the
# lockfile. --no-dev skips dev-only deps. --no-editable installs the project
# package itself as a regular (non-editable) wheel.
RUN UV_SYSTEM_PYTHON=1 uv sync --frozen --no-dev \
    --extra s3 --extra postgres --extra modal --extra jwt \
    --no-editable

# Transfer ownership of /app to the non-root user so the app can write
# any local temp files it needs (e.g. SQLite in local mode).
RUN chown -R app:app /app

# Drop privileges — all subsequent RUN/CMD/ENTRYPOINT run as app (UID 1000).
USER app

EXPOSE 8765
ENV PGDP_PORT=8765 \
    PGDP_HOST=0.0.0.0 \
    PGDP_STORAGE_BACKEND=s3 \
    PGDP_AUTH_MODE=jwt \
    PGDP_GPU_BACKEND=modal \
    PGDP_DISPATCH_INTERVAL_SECONDS=300

CMD ["uvicorn", "pd_prep_for_pgdp.bootstrap:build_app", "--factory", \
     "--host", "0.0.0.0", "--port", "8765"]
