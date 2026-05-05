# pd-prep-for-pgdp — managed-mode container (CPU-only Fargate task).
#
# GPU work dispatches out to Modal (or a shared GPU container) so this image
# stays small and CPU-only. See spec 09.

# ──────────────────────────── Stage 1: build frontend ───────────────────────
FROM node:24-slim AS frontend-build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm install --include=dev
COPY frontend/ ./
RUN npm run build

# ──────────────────────────── Stage 2: install Python ───────────────────────
FROM python:3.13-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    UV_NO_PROGRESS=1 \
    UV_LINK_MODE=copy

# uv (fast resolver/installer). Pull the binary from astral's official
# image — `python:3.13-slim` has no curl/wget, so the install.sh path
# (used in the local installer) doesn't work here.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# Project metadata first so dependency-only layer caches well.
COPY pyproject.toml ./
COPY src/ ./src/
COPY README.md ./

# Bring in the built frontend before installing — pyproject.toml's
# force-include needs the directory to exist at install time.
COPY --from=frontend-build /app/dist/ ./src/pd_prep_for_pgdp/static/

# Install with the [s3,postgres,modal,jwt] extras for managed mode.
RUN uv pip install --system ".[s3,postgres,modal,jwt]"

EXPOSE 8765
ENV PGDP_PORT=8765 \
    PGDP_HOST=0.0.0.0 \
    PGDP_STORAGE_BACKEND=s3 \
    PGDP_AUTH_MODE=jwt \
    PGDP_GPU_BACKEND=modal \
    PGDP_DISPATCH_INTERVAL_SECONDS=300

CMD ["uvicorn", "pd_prep_for_pgdp.bootstrap:build_app", "--factory", \
     "--host", "0.0.0.0", "--port", "8765"]
