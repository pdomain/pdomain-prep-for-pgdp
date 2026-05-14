"""IDatabase Protocol.

Persists structured records: projects, pages, jobs, system defaults. The image
files themselves live on `IStorage`. In filesystem-storage / SQLite mode the
database is a small companion to the JSON files on disk; in Postgres mode the
JSON files are not written and the DB is authoritative.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from ...core.models import (
    Job,
    PageRecord,
    PageStageState,
    PageStageStatus,
    Project,
    SystemDefaults,
)

# ── Search results (M5) ──────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class SearchResult:
    """One hit from a full-text search query.

    `score` is normalized to [0.0, 1.0] (1.0 = best match).
    `snippet` is a short excerpt with match context from FTS5 snippet().
    """

    page_id: str
    idx0: int
    snippet: str
    score: float


@dataclass
class SearchResultList:
    results: list[SearchResult]
    total_count: int


class IDatabase(Protocol):
    # ── Lifecycle ───────────────────────────────────────────────────────────
    async def initialize(self) -> None: ...

    async def close(self) -> None: ...

    # ── System defaults ─────────────────────────────────────────────────────
    async def get_system_defaults(self, owner_id: str) -> SystemDefaults: ...

    async def put_system_defaults(self, owner_id: str, defaults: SystemDefaults) -> None: ...

    # ── Projects ────────────────────────────────────────────────────────────
    async def list_projects(
        self,
        owner_id: str,
        *,
        include_archived: bool = False,
    ) -> list[Project]: ...

    async def get_project(self, project_id: str) -> Project | None: ...

    async def put_project(self, project: Project) -> None: ...

    async def delete_project(self, project_id: str) -> None: ...

    # ── Pages ───────────────────────────────────────────────────────────────
    async def list_pages(
        self,
        project_id: str,
        cursor: str | None = None,
        limit: int = 50,
    ) -> tuple[list[PageRecord], str | None, int]: ...

    async def get_page(self, project_id: str, idx0: int) -> PageRecord | None: ...

    async def put_page(self, page: PageRecord) -> None: ...

    async def put_pages(self, pages: list[PageRecord]) -> None: ...

    # ── Jobs ────────────────────────────────────────────────────────────────
    async def get_job(self, job_id: str) -> Job | None: ...

    async def put_job(self, job: Job) -> None: ...

    async def list_recent_jobs(self, owner_id: str, limit: int = 50) -> list[Job]: ...

    # ── Page stages (per-page DAG state, M1) ────────────────────────────────
    async def get_page_stage(self, project_id: str, page_id: str, stage_id: str) -> PageStageState | None: ...

    async def put_page_stage(self, state: PageStageState) -> None: ...

    async def list_page_stages_for_page(self, project_id: str, page_id: str) -> list[PageStageState]: ...

    async def list_page_stages_by_status(
        self, project_id: str, status: PageStageStatus
    ) -> list[PageStageState]: ...

    async def delete_page_stages_for_page(self, project_id: str, page_id: str) -> None: ...

    async def init_page_stages_for_page(self, project_id: str, page_id: str) -> int: ...

    # ── Split helpers ────────────────────────────────────────────────────────
    async def delete_page(self, project_id: str, idx0: int) -> None: ...

    async def list_pages_by_parent_id(self, project_id: str, parent_page_id: str) -> list[PageRecord]: ...

    # ── Full-text search (FTS5 / tsvector) ───────────────────────────────────
    async def upsert_page_text(self, project_id: str, page_id: str, idx0: int, ocr_text: str) -> None: ...

    async def search(
        self,
        project_id: str,
        query: str,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[SearchResult], int]: ...
