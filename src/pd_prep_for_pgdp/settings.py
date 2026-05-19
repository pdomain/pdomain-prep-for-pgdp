"""Runtime configuration. Reads `PGDP_*` env vars (and a few others)."""

from __future__ import annotations

import os
import warnings
from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

StorageBackend = Literal["filesystem", "s3"]
DatabaseKind = Literal["sqlite", "postgres"]
AuthMode = Literal["none", "apikey", "jwt"]
GpuBackend = Literal["local", "cpu", "mps", "modal", "shared_container"]
LogFormat = Literal["plain", "json"]


class Settings(BaseSettings):
    """One process-wide settings instance. Chosen at startup; never mutated."""

    model_config = SettingsConfigDict(
        env_prefix="PGDP_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    # ── Server ───────────────────────────────────────────────────────────────
    host: str = "127.0.0.1"
    port: int = 8765
    frontend_dev_url: str | None = None
    """When set, the SPA mount falls through to this Vite dev server."""

    # ── Data root ────────────────────────────────────────────────────────────
    data_root: Path = Field(default_factory=lambda: Path.home() / "pgdp-projects")
    doctr_cache_dir: Path = Field(default_factory=lambda: Path.home() / ".cache" / "pd-ml-models")
    config_dir: Path = Field(default_factory=lambda: Path.home() / ".config" / "pgdp-prep")

    # ── Storage adapter ──────────────────────────────────────────────────────
    storage_backend: StorageBackend = "filesystem"
    s3_data_bucket: str | None = None
    s3_cdn_base_url: str | None = None

    # ── Database adapter ─────────────────────────────────────────────────────
    database_url: str = ""
    """sqlite:///path or postgres://... — empty = derive sqlite path from data_root."""

    # ── Auth adapter ─────────────────────────────────────────────────────────
    auth_mode: AuthMode = "none"
    api_key: str | None = None
    jwt_issuer: str | None = None
    jwt_audience: str | None = None

    # ── GPU backend ──────────────────────────────────────────────────────────
    gpu_backend: GpuBackend | None = Field(
        default=None,
        validation_alias=AliasChoices("PD_GPU_BACKEND", "PGDP_GPU_BACKEND"),
    )
    """When None, auto-detect at startup (CUDA → local, mac arm64 → mps, else cpu).

    Env var: ``PD_GPU_BACKEND``. The legacy ``PGDP_GPU_BACKEND`` is still
    honored for one release cycle and emits a DeprecationWarning; if both are
    set, ``PD_GPU_BACKEND`` wins.
    """

    modal_token_id: str | None = None
    modal_token_secret: str | None = None
    shared_gpu_url: str | None = None
    shared_gpu_api_key: str | None = None

    # ── Dispatch cadence ─────────────────────────────────────────────────────
    dispatch_interval_seconds: int = 0
    """0 = immediate (local/self-hosted). 300 = managed-mode batch flush."""

    # ── Thumbnail generation (Step 2) ────────────────────────────────────────
    thumbnail_workers: int | None = None
    """Worker-process count for Step-2 thumbnail generation.

    JPEG decode/resize/encode is CPU-bound and trivially parallel, so the
    default (None) lets `core.ingest._resolve_thumbnail_workers` fall back
    to `os.cpu_count()`. Set `PGDP_THUMBNAIL_WORKERS=1` to disable the
    `ProcessPoolExecutor` and run thumbnails on a single worker thread —
    matches the test-suite default and avoids the fork overhead on tiny
    inputs."""

    # ── Deferred stage-write executor (Q8/Q9) ────────────────────────────────
    stage_write_pool_size: int | None = None
    """Thread-pool size for the deferred stage-write executor.

    None = ``min(os.cpu_count(), 4)``. Override: ``PGDP_STAGE_WRITE_POOL_SIZE``."""

    stage_write_queue_cap: int | None = None
    """Queue capacity for the deferred stage-write executor (outstanding tasks).

    None = ``4 x resolved pool_size``. Override: ``PGDP_STAGE_WRITE_QUEUE_CAP``."""

    # ── Debug ────────────────────────────────────────────────────────────────
    debug: bool = False
    """When True, 500 responses include last 3 lines of traceback. Never enable in production."""

    # ── Mode flag (for shared GPU worker container) ──────────────────────────
    mode: Literal["full", "gpu_worker_only"] = "full"

    # ── Logging (roadmap §18) ────────────────────────────────────────────────
    log_format: LogFormat = "plain"
    """`plain` keeps the human-readable default. `json` switches the root
    logger to one-JSON-object-per-line with request-id correlation —
    intended for managed/multi-tenant deployments shipping logs to a
    structured backend (CloudWatch, Loki, Datadog, etc.)."""

    request_id_header: str = "X-Request-ID"
    """HTTP header used by RequestIdMiddleware to read/echo the
    correlation id. Standard names in the wild are `X-Request-ID`
    (most ALBs/Sentry) and `X-Correlation-ID`; allow override for sites
    that already standardised."""

    @model_validator(mode="after")
    def _warn_on_legacy_gpu_backend_env(self) -> Settings:
        if "PGDP_GPU_BACKEND" in os.environ and "PD_GPU_BACKEND" not in os.environ:
            warnings.warn(
                "PGDP_GPU_BACKEND is deprecated; rename to PD_GPU_BACKEND "
                "(this alias will be removed in a future pd-prep-for-pgdp release).",
                DeprecationWarning,
                stacklevel=2,
            )
        return self

    @property
    def derived_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        return f"sqlite:///{(self.data_root / 'state.db').as_posix()}"

    @property
    def cdn_enabled(self) -> bool:
        return self.storage_backend == "filesystem"
