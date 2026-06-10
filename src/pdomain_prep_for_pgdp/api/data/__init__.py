"""/api/data/* routes — project + page CRUD, system defaults, assets, jobs."""

from fastapi import APIRouter

from .assets import router as assets_router
from .jobs import router as jobs_router
from .pages import router as pages_router
from .pipeline import router as pipeline_router
from .project_stages import router as project_stages_router
from .projects import router as projects_router
from .search import router as search_router
from .system_defaults import router as system_defaults_router


def install_data_routes(app) -> None:  # type: ignore[no-untyped-def]
    root = APIRouter(prefix="/api/data")
    root.include_router(projects_router)
    root.include_router(project_stages_router)
    root.include_router(pages_router)
    root.include_router(system_defaults_router)
    root.include_router(assets_router)
    root.include_router(jobs_router)
    root.include_router(pipeline_router)
    root.include_router(search_router)
    app.include_router(root)
