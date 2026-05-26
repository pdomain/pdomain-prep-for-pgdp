"""/api/gpu/* routes — ingest, illustrations, job management."""

from fastapi import APIRouter

from .illustrations import router as illustrations_router
from .ingest import router as ingest_router
from .jobs import router as gpu_jobs_router


def install_gpu_routes(app) -> None:  # type: ignore[no-untyped-def]
    root = APIRouter(prefix="/api/gpu")
    root.include_router(ingest_router)
    root.include_router(illustrations_router)
    root.include_router(gpu_jobs_router)
    app.include_router(root)
