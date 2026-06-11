"""Runtime configuration. Reads `PGDP_*` env vars (and a few others)."""

from __future__ import annotations

import os
import secrets
import warnings
from pathlib import Path
from typing import ClassVar, Literal

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

StorageBackend = Literal["filesystem", "s3"]
DatabaseKind = Literal["sqlite", "postgres"]
AuthMode = Literal["none", "apikey", "jwt"]
GpuBackend = Literal["local", "cpu", "mps", "modal", "shared_container"]
LogFormat = Literal["plain", "json"]


class Settings(BaseSettings):
    """One process-wide settings instance. Chosen at startup; never mutated."""

    model_config: ClassVar[SettingsConfigDict] = SettingsConfigDict(
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
    doctr_cache_dir: Path = Field(default_factory=lambda: Path.home() / ".cache" / "pdomain-ml-models")
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
    session_secret: str = Field(
        default_factory=lambda: secrets.token_hex(32),
    )
    """HMAC-SHA256 signing secret for apikey-mode session cookies.

    In production, set ``PGDP_SESSION_SECRET`` to a stable value so sessions
    survive server restarts.  In development, a fresh random secret is
    generated at startup (sessions are lost on restart, which is fine locally).
    """

    # ── GPU backend ──────────────────────────────────────────────────────────
    gpu_backend: GpuBackend | None = Field(
        default=None,
        validation_alias=AliasChoices("PDOMAIN_GPU_BACKEND", "PGDP_GPU_BACKEND"),
    )
    """When None, auto-detect at startup (CUDA → local, mac arm64 → mps, else cpu).

    Env var: ``PDOMAIN_GPU_BACKEND``. The legacy ``PGDP_GPU_BACKEND`` is still
    honored for one release cycle and emits a DeprecationWarning; if both are
    set, ``PDOMAIN_GPU_BACKEND`` wins.
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

    stage_cache_mb: int = 512
    """In-memory artifact cache budget in MiB.

    When the ndarray cache (deferred-write executor) exceeds this limit, oldest
    entries are encoded and evicted to keep peak RAM bounded.  Default 512 MiB
    (~4-8 full-resolution pages as uint8 ndarrays).
    Override: ``PGDP_STAGE_CACHE_MB``.
    """

    # ── Phase 3: batch OCR ───────────────────────────────────────────────────
    ocr_batch_size: int | None = None
    """Maximum pages per DocTR batch OCR call (Phase 3).

    None = auto-size via ``pick_doctr_batch_sizes`` (recommended).
    1 = sequential fallback: one page per predictor call, identical to the
        pre-Phase-3 sequential path — preserves exact old behaviour.
    Override: ``PGDP_OCR_BATCH_SIZE``.
    """

    ocr_pipeline_slots: int = 3
    """Number of pipeline slots for the page-pipelining fan-out (Phase 3).

    Controls how many pages can be in-flight concurrently (decode/prep, OCR
    batch accumulation, write-executor drain).  Default 3.
    Override: ``PGDP_OCR_PIPELINE_SLOTS``.
    """

    # ── Resource limits ──────────────────────────────────────────────────────
    max_cdn_upload_bytes: int = 300 * 1024 * 1024
    """Max bytes for a single PUT /cdn/{key} upload body (default 300 MB)."""

    max_source_zip_bytes: int = 2 * 1024 * 1024 * 1024
    """Max bytes for a source zip fetched from storage before extraction (default 2 GB)."""

    max_zip_entries: int = 2000
    """Max number of entries in a source zip (default 2000; no book has > ~1500 scans)."""

    max_entry_uncompressed_bytes: int = 100 * 1024 * 1024
    """Max uncompressed bytes for a single zip entry (default 100 MB; single TIFF page)."""

    max_total_uncompressed_bytes: int = 5 * 1024 * 1024 * 1024
    """Max total uncompressed bytes across all zip entries (default 5 GB; one full book)."""

    max_image_pixels: int = 200_000_000
    """Max pixel count (width * height) for decoded images (default 200 MP; ~14142 * 14142)."""

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
        if "PGDP_GPU_BACKEND" in os.environ and "PDOMAIN_GPU_BACKEND" not in os.environ:
            warnings.warn(
                (
                    "PGDP_GPU_BACKEND is deprecated; rename to PDOMAIN_GPU_BACKEND "
                    "(this alias will be removed in a future pdomain-prep-for-pgdp release)."
                ),
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
