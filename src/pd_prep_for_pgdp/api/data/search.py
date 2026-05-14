"""GET /api/data/projects/{project_id}/search — FTS5-backed page search."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from ...adapters.auth import UserContext
from ...adapters.database import IDatabase
from ..dependencies import get_database, get_user

router = APIRouter(tags=["search"])


class SearchHitResponse(BaseModel):
    page_id: str
    idx0: int
    snippet: str
    score: float


class SearchResponse(BaseModel):
    results: list[SearchHitResponse]
    total_count: int


@router.get(
    "/projects/{project_id}/search",
    response_model=SearchResponse,
    operation_id="search_project_pages",
)
async def search_project_pages(
    project_id: str,
    q: str = Query(default=""),
    limit: int = Query(default=20, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: UserContext = Depends(get_user),
    db: IDatabase = Depends(get_database),
) -> SearchResponse:
    if not q.strip():
        raise HTTPException(400, "q must be a non-empty search query")

    project = await db.get_project(project_id)
    if project is None or project.owner_id != user.user_id:
        raise HTTPException(404, "project not found")

    hits, total_count = await db.search(project_id, q, limit=limit, offset=offset)
    return SearchResponse(
        results=[
            SearchHitResponse(
                page_id=h.page_id,
                idx0=h.idx0,
                snippet=h.snippet,
                score=h.score,
            )
            for h in hits
        ],
        total_count=total_count,
    )
