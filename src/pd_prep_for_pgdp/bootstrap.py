"""build_app() — one-shot adapter wiring + FastAPI assembly.

Picks the storage / database / auth / GPU adapter at startup based on
`Settings`. Everything else is shared. See spec 09 for the full contract.
"""

from __future__ import annotations

import asyncio
import logging
import platform
from contextlib import asynccontextmanager, suppress
from importlib import resources
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .adapters.auth.apikey import ApiKeyAuth
from .adapters.auth.base import IAuth
from .adapters.auth.jwt_ import JwtAuth
from .adapters.auth.none_ import NoneAuth
from .adapters.database.base import IDatabase
from .adapters.database.sqlite import SqliteDatabase
from .adapters.gpu.base import GPUBackend
from .adapters.gpu.cpu import CpuBackend
from .adapters.gpu.local import LocalBackend
from .adapters.gpu.modal_backend import ModalBackend
from .adapters.gpu.shared_container import SharedContainerBackend
from .adapters.storage.base import IStorage
from .adapters.storage.filesystem import FilesystemStorage
from .api.auth import install_auth_routes
from .api.data import install_data_routes
from .api.gpu import install_gpu_routes
from .api.middleware.error_handler import install_error_handlers
from .api.middleware.request_id import RequestIdMiddleware
from .core.logging_config import configure_logging
from .dispatcher.base import IDispatcher
from .dispatcher.batched import BatchDispatcher
from .dispatcher.immediate import ImmediateDispatcher
from .settings import Settings

log = logging.getLogger(__name__)


# ─── Adapter builders ────────────────────────────────────────────────────────


def build_storage(settings: Settings) -> IStorage:
    if settings.storage_backend == "s3":
        if not settings.s3_data_bucket:
            raise RuntimeError("PGDP_S3_DATA_BUCKET is required when storage_backend=s3")
        from .adapters.storage.s3 import S3Storage

        return S3Storage(
            bucket=settings.s3_data_bucket,
            cdn_url_base=settings.s3_cdn_base_url,
        )
    return FilesystemStorage(root=settings.data_root)


def build_database(settings: Settings) -> IDatabase:
    url = settings.derived_database_url
    if url.startswith("sqlite"):
        return SqliteDatabase(url)
    if url.startswith("postgres"):
        try:
            from .adapters.database.postgres import PostgresDatabase
        except ImportError as e:
            raise RuntimeError("Postgres requires the [postgres] extra") from e
        return PostgresDatabase(url)
    raise RuntimeError(f"unrecognised PGDP_DATABASE_URL: {url!r}")


def build_auth(settings: Settings) -> IAuth:
    if settings.auth_mode == "none":
        return NoneAuth()
    if settings.auth_mode == "apikey":
        if not settings.api_key:
            raise RuntimeError("PGDP_API_KEY is required when auth_mode=apikey")
        return ApiKeyAuth(settings.api_key)
    if settings.auth_mode == "jwt":
        if not settings.jwt_issuer:
            raise RuntimeError("PGDP_JWT_ISSUER is required when auth_mode=jwt")
        return JwtAuth(settings.jwt_issuer, settings.jwt_audience)
    raise RuntimeError(f"unknown auth_mode: {settings.auth_mode}")


def _autodetect_gpu_backend() -> str:
    """CUDA -> local; mac arm64 -> mps; else cpu."""
    try:
        # CUDA check via cupy (which is the [cuda] extra). If unavailable, fall through.
        import cupy  # type: ignore[import-not-found]  # noqa: F401

        return "local"
    except Exception:
        pass
    if platform.system() == "Darwin" and platform.machine() == "arm64":
        return "mps"
    return "cpu"


def build_gpu_backend(
    settings: Settings,
    *,
    storage: IStorage | None = None,
    database: IDatabase | None = None,
    executor: Any | None = None,
) -> GPUBackend:
    chosen = settings.gpu_backend or _autodetect_gpu_backend()
    log.info("Selected GPU backend: %s", chosen)

    if chosen == "local":
        # LocalBackend subclasses CpuBackend (DocTR/PyTorch auto-uses CUDA);
        # adapters wire identically.
        return LocalBackend(storage=storage, database=database, executor=executor)
    if chosen in {"cpu", "mps"}:
        # MPS is wired into DocTR automatically when torch sees Apple Silicon;
        # the rest of the pipeline runs on CPU. We treat them as the same
        # backend for adapter-selection purposes.
        return CpuBackend(storage=storage, database=database, executor=executor)
    if chosen == "modal":
        if not (settings.modal_token_id and settings.modal_token_secret):
            raise RuntimeError("MODAL_TOKEN_ID + MODAL_TOKEN_SECRET required when gpu_backend=modal")
        return ModalBackend(settings.modal_token_id, settings.modal_token_secret)
    if chosen == "shared_container":
        if not settings.shared_gpu_url:
            raise RuntimeError("SHARED_GPU_URL required when gpu_backend=shared_container")
        return SharedContainerBackend(
            settings.shared_gpu_url,
            settings.shared_gpu_api_key or "",
        )
    raise RuntimeError(f"unknown gpu_backend: {chosen!r}")


def build_dispatcher(settings: Settings, gpu: GPUBackend) -> IDispatcher:
    if settings.dispatch_interval_seconds > 0:
        return BatchDispatcher(gpu, settings.dispatch_interval_seconds)
    return ImmediateDispatcher(gpu)


# ─── FastAPI assembly ────────────────────────────────────────────────────────


def build_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()

    # Install root logging handler once per process. Idempotent: a second
    # build_app() (uvicorn --reload) replaces our handler rather than
    # stacking, so callers don't double-log.
    configure_logging(settings.log_format)

    storage = build_storage(settings)
    database = build_database(settings)
    auth = build_auth(settings)

    # Single-thread executor for CPU/local GPU work — preempt batch with
    # interactive (workbench) submissions. Created here so its drain loop can
    # be started by the lifespan handler on the right asyncio loop.
    from .core.queue.single_executor import SingleExecutor

    executor = SingleExecutor()
    gpu = build_gpu_backend(settings, storage=storage, database=database, executor=executor)
    dispatcher = build_dispatcher(settings, gpu)

    from .core.job_events import JobEventBroker
    from .core.job_runner import InProcessJobRunner
    from .core.stage_events import StageEventBroker

    job_events = JobEventBroker()
    stage_events = StageEventBroker()
    job_runner = InProcessJobRunner(
        database=database,
        storage=storage,
        gpu=gpu,
        dispatcher=dispatcher,
        events=job_events,
        data_root=settings.data_root,
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await database.initialize()
        app.state.dispatcher_task = asyncio.create_task(dispatcher.run_forever())
        app.state.job_runner_task = asyncio.create_task(job_runner.run_forever())
        app.state.executor_task = asyncio.create_task(executor.run_drain_loop())
        try:
            yield
        finally:
            # Graceful stop FIRST: signal the job runner to exit between
            # poll iterations. Cancelling mid-poll leaves a worker thread
            # mid-SQLite-call, which segfaults at the C boundary when we
            # close the connection below.
            with suppress(Exception):  # pragma: no cover - defensive
                job_runner.stop()

            tasks = []
            for attr in ("dispatcher_task", "job_runner_task", "executor_task"):
                task = getattr(app.state, attr, None)
                if task is not None:
                    task.cancel()
                    tasks.append(task)
            for task in tasks:
                with suppress(asyncio.CancelledError, Exception):
                    await task
            await database.close()

    app = FastAPI(
        title="pd-prep-for-pgdp",
        description=("Convert a folder/zip of scanned book images into a PGDP-ready submission package."),
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Request-id middleware is added last so it ends up outermost in the
    # ASGI stack — it must run before CORS on incoming requests so the
    # correlation id is set on the contextvar before any handler logs,
    # and after CORS on the response so the header survives. Starlette
    # applies `add_middleware` calls in reverse order, hence "last = outermost".
    app.add_middleware(RequestIdMiddleware, header_name=settings.request_id_header)

    app.state.settings = settings
    app.state.job_events = job_events
    app.state.stage_events = stage_events
    app.state.storage = storage
    app.state.database = database
    app.state.auth = auth
    app.state.gpu_backend = gpu
    app.state.dispatcher = dispatcher
    app.state.job_runner = job_runner

    install_error_handlers(app)
    install_auth_routes(app)
    install_data_routes(app)
    install_gpu_routes(app)

    # /healthz is mode-agnostic — gpu_worker_only nodes still need a liveness
    # probe — and unauthenticated by design (orchestrators don't carry tokens).
    # Mount before the SPA fallback so the route wins over the catch-all.
    from .api.healthz import install_healthz

    install_healthz(app)

    # /api/server-info is local-mode UX (§L1 step 3) but harmless on
    # self-hosted / managed shapes — leave it on for parity. Mount before
    # the SPA fallback so the route wins over the catch-all.
    from .api.server_info import install_server_info

    install_server_info(app)

    if settings.mode != "gpu_worker_only":
        from .api.env_js import install_env_js

        # /env.js must be registered BEFORE the static SPA mount so the
        # dynamic route wins over a stale env.js in the bundle.
        install_env_js(app)

        if settings.cdn_enabled:
            from .api.cdn import install_cdn_upload

            # PUT handler must be registered BEFORE the StaticFiles mount so
            # `PUT /cdn/<key>` isn't shadowed by the read-only mount.
            install_cdn_upload(app)
            app.mount(
                "/cdn",
                StaticFiles(directory=str(settings.data_root), check_dir=False),
                name="cdn",
            )
        _mount_static_frontend(app, settings)

    return app


def _mount_static_frontend(app: FastAPI, settings: Settings) -> None:
    """Mount the React SPA. In dev mode (`--frontend-dev URL`) we don't mount;
    the user is expected to run Vite separately and point their browser there.
    """
    if settings.frontend_dev_url:
        log.info(
            "Frontend dev mode — visit %s for the SPA; FastAPI only serves /api/*",
            settings.frontend_dev_url,
        )
        return
    try:
        static_dir = resources.files("pd_prep_for_pgdp").joinpath("static")
        # `resources.files` returns a Traversable; need a real path for StaticFiles.
        path = str(static_dir)
    except (FileNotFoundError, ModuleNotFoundError):
        log.warning("Static frontend bundle not found — / will 404 until built")
        return

    import os

    if not os.path.isdir(path):
        log.warning("Static dir %s missing — frontend not bundled. Run `make build-frontend`.", path)
        return

    # SPA fallback: any non-API GET that isn't a real file in the bundle
    # serves index.html, so client-side routes like /projects/X and /jobs
    # work on a fresh page load. The static mount (registered after) still
    # serves /assets/<hash>.<ext>, /favicon.ico, etc.
    from fastapi.responses import FileResponse

    index_file = os.path.join(path, "index.html")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        candidate = os.path.join(path, full_path)
        if full_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(index_file)

    app.mount("/", StaticFiles(directory=path, html=True), name="ui")
