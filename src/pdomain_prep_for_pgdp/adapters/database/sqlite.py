"""SQLite-backed IDatabase implementation.

Uses stdlib `sqlite3` (no external deps). One JSON-text column per record
shape — schema migrations stay trivial since we treat the rows as document
storage. This matches the local-mode goal of zero-extra-dependency install.
"""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Callable, Generator
from contextlib import contextmanager
from functools import partial
from pathlib import Path
from typing import ParamSpec, TypeVar, cast

import anyio.to_thread

from pdomain_prep_for_pgdp.core.models import (
    PAGE_STAGE_IDS,
    V2_PAGE_STAGE_IDS,
    Job,
    PageStageState,
    PageStageStatus,
    Project,
    SystemDefaults,
)

from .base import SearchResult

_LONG_S = chr(0x17F)  # U+017F LATIN SMALL LETTER LONG S


def _normalize_for_fts(text: str) -> str:
    """Expand long-s (U+017F) before indexing or querying."""
    return text.replace(_LONG_S, "s")


def _normalize_fts_score(rank: float) -> float:
    """Map FTS5 BM25 rank (≤0, more negative = better) to [0.0, 1.0]."""
    return 1.0 / (1.0 + abs(rank))


# Inline string-list literal of all canonical stage IDs for the page_stages
# CHECK constraint. Includes both v1 (PAGE_STAGE_IDS) and v2 (V2_PAGE_STAGE_IDS)
# to allow coexistence during the B5 migration window. The v1 set is retained
# for existing rows written by pre-B5 code; the v2 set allows new v2 stage rows.
# Deduplication ensures no duplicate entries in the constraint.
_ALL_STAGE_IDS = tuple(dict.fromkeys(list(PAGE_STAGE_IDS) + list(V2_PAGE_STAGE_IDS)))
_STAGE_ID_CHECK_CLAUSE = "(" + ", ".join(f"'{s}'" for s in _ALL_STAGE_IDS) + ")"

# CHECK clause for page_stages.status — mirrors the PageStageStatus enum
# values verbatim. Spec §SQLite schema lists the same set.
_STATUS_CHECK_CLAUSE = "('not-run', 'running', 'clean', 'dirty', 'failed', 'not-applicable')"

_SCHEMA = f"""
CREATE TABLE IF NOT EXISTS system_defaults (
    owner_id TEXT PRIMARY KEY,
    body     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
    id        TEXT PRIMARY KEY,
    owner_id  TEXT NOT NULL,
    body      TEXT NOT NULL,
    updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_owner ON projects(owner_id);

CREATE TABLE IF NOT EXISTS jobs (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    body       TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_owner_created ON jobs(owner_id, created_at DESC);

-- Per-page stage DAG state — canonical spec docs/specs/pipeline-task-model.md
-- §"SQLite schema" (Q1 locked 2026-05-07).
-- Composite PK + CHECK constraints on status / stage_id keep the table
-- self-validating; the runner's typed wrappers in core/models.py are the
-- source of truth that the CHECK clauses mirror.
CREATE TABLE IF NOT EXISTS page_stages (
    project_id    TEXT    NOT NULL,
    page_id       TEXT    NOT NULL,
    stage_id      TEXT    NOT NULL,
    status        TEXT    NOT NULL,
    stage_version INTEGER NOT NULL,
    config_hash   TEXT,
    input_hash    TEXT,
    artifact_key  TEXT,
    last_run_at   REAL,
    duration_ms   INTEGER,
    error_message TEXT,
    job_id        TEXT,
    PRIMARY KEY (project_id, page_id, stage_id),
    CHECK (status IN {_STATUS_CHECK_CLAUSE}),
    CHECK (stage_id IN {_STAGE_ID_CHECK_CLAUSE})
);
CREATE INDEX IF NOT EXISTS page_stages_proj_status
    ON page_stages(project_id, status);
CREATE INDEX IF NOT EXISTS page_stages_proj_page
    ON page_stages(project_id, page_id);

-- Full-text search tables. Spec: docs/specs/2026-05-11-search-across-pages-design.md §Decision.
-- `page_text` is authoritative; `page_text_fts` is the FTS5 index (self-contained copy).
-- Upsert: DELETE old FTS row + INSERT new FTS row + INSERT OR REPLACE page_text.
CREATE TABLE IF NOT EXISTS page_text (
    project_id TEXT NOT NULL,
    page_id    TEXT NOT NULL,
    idx0       INTEGER NOT NULL,
    ocr_text   TEXT NOT NULL,
    PRIMARY KEY (project_id, page_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS page_text_fts USING fts5(
    page_id    UNINDEXED,
    project_id UNINDEXED,
    idx0       UNINDEXED,
    ocr_text
);
"""

type _JsonTextRow = tuple[str]
type _CountRow = tuple[int]
type _OwnerIdRow = tuple[str]
type _SearchRow = tuple[str, int, str | None, float]
type _PageStageRow = tuple[
    str,
    str,
    str,
    str,
    int,
    str | None,
    str | None,
    str | None,
    float | None,
    int | None,
    str | None,
    str | None,
]

_P = ParamSpec("_P")
_T = TypeVar("_T")


def _fetch_optional_json_text_row(cur: sqlite3.Cursor) -> _JsonTextRow | None:
    return cast(_JsonTextRow | None, cur.fetchone())


def _fetch_json_text_rows(cur: sqlite3.Cursor) -> list[_JsonTextRow]:
    return cast(list[_JsonTextRow], cur.fetchall())


def _fetch_count(cur: sqlite3.Cursor) -> int:
    row = cast(_CountRow | None, cur.fetchone())
    return 0 if row is None else row[0]


def _fetch_optional_page_stage_row(cur: sqlite3.Cursor) -> _PageStageRow | None:
    return cast(_PageStageRow | None, cur.fetchone())


def _fetch_page_stage_rows(cur: sqlite3.Cursor) -> list[_PageStageRow]:
    return cast(list[_PageStageRow], cur.fetchall())


def _fetch_search_rows(cur: sqlite3.Cursor) -> list[_SearchRow]:
    return cast(list[_SearchRow], cur.fetchall())


def _fetch_owner_id_rows(cur: sqlite3.Cursor) -> list[_OwnerIdRow]:
    return cast(list[_OwnerIdRow], cur.fetchall())


# ─── Legacy migration helpers ───────────────────────────────────────────────────


class SqliteDatabase:
    def __init__(self, url: str) -> None:
        # Accept "sqlite:///abs/path" or "sqlite:///:memory:".
        prefix = "sqlite:///"
        if not url.startswith(prefix):
            raise ValueError(f"unrecognised SQLite URL: {url!r}")
        path = url[len(prefix) :]
        self._memory: bool = path == ":memory:"
        self._path: str = path if self._memory else str(Path(path).expanduser())
        self._conn: sqlite3.Connection | None = None
        # SQLite connection isn't safe to share across threads without a lock.
        # The runner now fans out concurrent jobs (max_concurrency > 1) so
        # two threads can race on commit() without this guard.
        self._write_lock: threading.Lock = threading.Lock()

    # ── Lifecycle ───────────────────────────────────────────────────────────

    async def initialize(self) -> None:
        await anyio.to_thread.run_sync(self._initialize_sync)

    def _initialize_sync(self) -> None:
        if not self._memory:
            Path(self._path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self._path, check_same_thread=False)
        _ = self._conn.execute("PRAGMA journal_mode = WAL;")
        _ = self._conn.executescript(_SCHEMA)
        self._conn.commit()

    async def close(self) -> None:
        if self._conn is None:
            return
        # Hold _write_lock during close — racing an in-flight query segfaults on Py 3.13.
        await anyio.to_thread.run_sync(self._close_sync)

    def _close_sync(self) -> None:
        with self._write_lock:
            if self._conn is not None:
                self._conn.close()
                self._conn = None

    @contextmanager
    def _cursor(self) -> Generator[sqlite3.Cursor]:
        assert self._conn is not None, "Database not initialised"
        with self._write_lock:
            cur = self._conn.cursor()
            try:
                yield cur
                self._conn.commit()
            finally:
                cur.close()

    async def _run(self, fn: Callable[_P, _T], *args: _P.args, **kwargs: _P.kwargs) -> _T:
        return await anyio.to_thread.run_sync(partial(fn, *args, **kwargs))

    # ── System defaults ─────────────────────────────────────────────────────

    async def get_system_defaults(self, owner_id: str) -> SystemDefaults:
        def _go() -> SystemDefaults:
            with self._cursor() as cur:
                _ = cur.execute("SELECT body FROM system_defaults WHERE owner_id = ?", (owner_id,))
                row = _fetch_optional_json_text_row(cur)
                if row is None:
                    return SystemDefaults()
                return SystemDefaults.model_validate_json(row[0])

        return await self._run(_go)

    async def put_system_defaults(self, owner_id: str, defaults: SystemDefaults) -> None:
        body = defaults.model_dump_json()

        def _go() -> None:
            with self._cursor() as cur:
                _ = cur.execute(
                    "INSERT OR REPLACE INTO system_defaults (owner_id, body) VALUES (?, ?)",
                    (owner_id, body),
                )

        await self._run(_go)

    # ── Projects ────────────────────────────────────────────────────────────

    async def list_projects(
        self,
        owner_id: str,
        *,
        include_archived: bool = False,
    ) -> list[Project]:
        def _go() -> list[Project]:
            with self._cursor() as cur:
                _ = cur.execute(
                    "SELECT body FROM projects WHERE owner_id = ? ORDER BY updated_at DESC",
                    (owner_id,),
                )
                rows = _fetch_json_text_rows(cur)
                projects = [Project.model_validate_json(r[0]) for r in rows]
            if include_archived:
                return projects
            # Filter post-load: `archived` lives in the JSON body, not its own
            # column, so a SQL filter would need a JSON-extract expression.
            # Project counts per owner are small (~dozens) — in-memory is fine.
            return [p for p in projects if not p.archived]

        return await self._run(_go)

    async def get_project(self, project_id: str) -> Project | None:
        def _go() -> Project | None:
            with self._cursor() as cur:
                _ = cur.execute("SELECT body FROM projects WHERE id = ?", (project_id,))
                row = _fetch_optional_json_text_row(cur)
                return Project.model_validate_json(row[0]) if row else None

        return await self._run(_go)

    async def put_project(self, project: Project) -> None:
        body = project.model_dump_json()
        ts = project.updated_at.timestamp()

        def _go() -> None:
            with self._cursor() as cur:
                _ = cur.execute(
                    "INSERT OR REPLACE INTO projects (id, owner_id, body, updated_at) VALUES (?, ?, ?, ?)",
                    (project.id, project.owner_id, body, ts),
                )

        await self._run(_go)

    async def delete_project(self, project_id: str) -> None:
        def _go() -> None:
            with self._cursor() as cur:
                _ = cur.execute("DELETE FROM page_stages WHERE project_id = ?", (project_id,))
                _ = cur.execute("DELETE FROM projects WHERE id = ?", (project_id,))

        await self._run(_go)

    # ── Full-text search ─────────────────────────────────────────────────────

    async def upsert_page_text(
        self,
        project_id: str,
        page_id: str,
        idx0: int,
        ocr_text: str,
    ) -> None:
        """Upsert page OCR text into page_text + page_text_fts atomically."""
        normalized = _normalize_for_fts(ocr_text)

        def _go() -> None:
            with self._cursor() as cur:
                # Remove stale FTS entry (no-op if missing).
                _ = cur.execute(
                    "DELETE FROM page_text_fts WHERE page_id=? AND project_id=?",
                    (page_id, project_id),
                )
                # Authoritative companion row (upsert).
                _ = cur.execute(
                    """
                    INSERT OR REPLACE INTO page_text
                        (project_id, page_id, idx0, ocr_text)
                    VALUES (?, ?, ?, ?)
                    """,
                    (project_id, page_id, idx0, normalized),
                )
                # New FTS entry.
                _ = cur.execute(
                    "INSERT INTO page_text_fts (page_id, project_id, idx0, ocr_text) VALUES (?, ?, ?, ?)",
                    (page_id, project_id, idx0, normalized),
                )

        await self._run(_go)

    async def search_index_page(
        self,
        project_id: str,
        page_id: str,
        idx0: int,
        ocr_text: str,
    ) -> None:
        await self.upsert_page_text(project_id, page_id, idx0, ocr_text)

    async def search(
        self,
        project_id: str,
        query: str,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[SearchResult], int]:
        """FTS5 search; returns (results, total_count) sorted by BM25 rank."""
        normalized_query = _normalize_for_fts(query)

        def _go() -> tuple[list[SearchResult], int]:
            with self._cursor() as cur:
                _ = cur.execute(
                    "SELECT COUNT(*) FROM page_text_fts WHERE page_text_fts MATCH ? AND project_id=?",
                    (normalized_query, project_id),
                )
                total = _fetch_count(cur)

                _ = cur.execute(
                    """
                    SELECT page_id, idx0,
                           snippet(page_text_fts, 3, '', '', '...', 15), rank
                    FROM page_text_fts
                    WHERE page_text_fts MATCH ? AND project_id=?
                    ORDER BY rank
                    LIMIT ? OFFSET ?
                    """,
                    (normalized_query, project_id, limit, offset),
                )
                rows = _fetch_search_rows(cur)

            return (
                [
                    SearchResult(
                        page_id=r[0],
                        idx0=int(r[1]),
                        snippet=r[2] or "",
                        score=_normalize_fts_score(r[3]),
                    )
                    for r in rows
                ],
                total,
            )

        return await self._run(_go)

    # ── Jobs ────────────────────────────────────────────────────────────────

    async def get_job(self, job_id: str) -> Job | None:
        def _go() -> Job | None:
            with self._cursor() as cur:
                _ = cur.execute("SELECT body FROM jobs WHERE id = ?", (job_id,))
                row = _fetch_optional_json_text_row(cur)
                return Job.model_validate_json(row[0]) if row else None

        return await self._run(_go)

    async def put_job(self, job: Job) -> None:
        body = job.model_dump_json()
        ts = job.created_at.timestamp()

        def _go() -> None:
            with self._cursor() as cur:
                _ = cur.execute(
                    "INSERT OR REPLACE INTO jobs (id, owner_id, body, created_at) VALUES (?, ?, ?, ?)",
                    (job.id, job.owner_id, body, ts),
                )

        await self._run(_go)

    async def list_recent_jobs(self, owner_id: str, limit: int = 50) -> list[Job]:
        def _go() -> list[Job]:
            with self._cursor() as cur:
                _ = cur.execute(
                    "SELECT body FROM jobs WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?",
                    (owner_id, limit),
                )
                rows = _fetch_json_text_rows(cur)
            return [Job.model_validate_json(r[0]) for r in rows]

        return await self._run(_go)

    # ── Page stages (per-page DAG state, M1 §A) ─────────────────────────────

    async def get_page_stage(
        self,
        project_id: str,
        page_id: str,
        stage_id: str,
    ) -> PageStageState | None:
        """Fetch one page-stage row by its composite PK, or None if missing."""

        def _go() -> PageStageState | None:
            with self._cursor() as cur:
                _ = cur.execute(
                    """
                    SELECT project_id, page_id, stage_id, status, stage_version,
                           config_hash, input_hash, artifact_key, last_run_at,
                           duration_ms, error_message, job_id
                    FROM page_stages
                    WHERE project_id=? AND page_id=? AND stage_id=?
                    """,
                    (project_id, page_id, stage_id),
                )
                row = _fetch_optional_page_stage_row(cur)
            return _row_to_page_stage(row) if row else None

        return await self._run(_go)

    async def put_page_stage(self, state: PageStageState) -> None:
        """Idempotent upsert (INSERT OR REPLACE on the composite PK).

        The transactional write contract for the DAG runner (Q1-followup
        dual-write reconciliation) is implemented one layer up — this method
        is only the DB-side half.
        """

        def _go() -> None:
            with self._cursor() as cur:
                _ = cur.execute(
                    """
                    INSERT OR REPLACE INTO page_stages
                        (project_id, page_id, stage_id, status, stage_version,
                         config_hash, input_hash, artifact_key, last_run_at,
                         duration_ms, error_message, job_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        state.project_id,
                        state.page_id,
                        state.stage_id,
                        state.status.value,
                        state.stage_version,
                        state.config_hash,
                        state.input_hash,
                        state.artifact_key,
                        state.last_run_at,
                        state.duration_ms,
                        state.error_message,
                        state.job_id,
                    ),
                )

        await self._run(_go)

    async def list_page_stages_for_page(
        self,
        project_id: str,
        page_id: str,
    ) -> list[PageStageState]:
        """All rows for one page; uses the page_stages_proj_page index."""

        def _go() -> list[PageStageState]:
            with self._cursor() as cur:
                _ = cur.execute(
                    """
                    SELECT project_id, page_id, stage_id, status, stage_version,
                           config_hash, input_hash, artifact_key, last_run_at,
                           duration_ms, error_message, job_id
                    FROM page_stages
                    WHERE project_id=? AND page_id=?
                    """,
                    (project_id, page_id),
                )
                rows = _fetch_page_stage_rows(cur)
            return [_row_to_page_stage(r) for r in rows]

        return await self._run(_go)

    async def list_page_stages_by_status(
        self,
        project_id: str,
        status: PageStageStatus,
    ) -> list[PageStageState]:
        """All rows for one project at a given status; uses the proj_status index."""

        def _go() -> list[PageStageState]:
            with self._cursor() as cur:
                _ = cur.execute(
                    """
                    SELECT project_id, page_id, stage_id, status, stage_version,
                           config_hash, input_hash, artifact_key, last_run_at,
                           duration_ms, error_message, job_id
                    FROM page_stages
                    WHERE project_id=? AND status=?
                    """,
                    (project_id, status.value),
                )
                rows = _fetch_page_stage_rows(cur)
            return [_row_to_page_stage(r) for r in rows]

        return await self._run(_go)

    async def list_page_stages_by_project(
        self,
        project_id: str,
    ) -> list[PageStageState]:
        """All page_stage rows for one project (all pages, all stages).

        Used by B5 pipeline-snapshot to aggregate per-stage status across pages.
        """

        def _go() -> list[PageStageState]:
            with self._cursor() as cur:
                _ = cur.execute(
                    """
                    SELECT project_id, page_id, stage_id, status, stage_version,
                           config_hash, input_hash, artifact_key, last_run_at,
                           duration_ms, error_message, job_id
                    FROM page_stages
                    WHERE project_id=?
                    """,
                    (project_id,),
                )
                rows = _fetch_page_stage_rows(cur)
            return [_row_to_page_stage(r) for r in rows]

        return await self._run(_go)

    async def delete_page_stages_for_page(
        self,
        project_id: str,
        page_id: str,
    ) -> None:
        """Drop all stages for one page — used by reindex --heal and unsplit."""

        def _go() -> None:
            with self._cursor() as cur:
                _ = cur.execute(
                    "DELETE FROM page_stages WHERE project_id=? AND page_id=?",
                    (project_id, page_id),
                )

        await self._run(_go)

    async def init_page_stages_for_page(
        self,
        project_id: str,
        page_id: str,
    ) -> int:
        """Idempotently insert one row per canonical stage_id.

        Lazy side of the dual-write reconciliation contract (Q1-followup):
        the first time anyone reads a page's stage state, all 22 rows
        materialise so subsequent reads are simple lookups. Concurrent
        callers race safely — `INSERT OR IGNORE` skips the second
        inserter's row at the composite PK.

        Status is `not-run` for all new pages (pages now live in the event
        store, not in IDatabase; legacy detection is no longer applicable).

        Returns the number of rows actually inserted (0 if all 22 already
        exist).
        """
        initial_status = PageStageStatus.not_run.value

        def _go() -> int:
            with self._cursor() as cur:
                _ = cur.execute(
                    "SELECT COUNT(*) FROM page_stages WHERE project_id=? AND page_id=?",
                    (project_id, page_id),
                )
                rows_before = _fetch_count(cur)
                _ = cur.executemany(
                    f"""
                    INSERT OR IGNORE INTO page_stages
                        (project_id, page_id, stage_id, status, stage_version)
                    VALUES (?, ?, ?, '{initial_status}', 1)
                    """,
                    [(project_id, page_id, sid) for sid in PAGE_STAGE_IDS],
                )
                _ = cur.execute(
                    "SELECT COUNT(*) FROM page_stages WHERE project_id=? AND page_id=?",
                    (project_id, page_id),
                )
                rows_after = _fetch_count(cur)
                return rows_after - rows_before

        return await self._run(_go)

    # ── Multi-tenant enumeration ─────────────────────────────────────────────

    async def list_distinct_owner_ids(self) -> list[str]:
        """Return all distinct owner_id values that have at least one job row.

        SQLite is used exclusively for local single-user deployments, so this
        always queries the real jobs table and falls back to ``["default"]``
        when the table is empty.  Multi-tenant adapters (e.g. Postgres) should
        override with a more efficient indexed query.
        """

        def _go() -> list[str]:
            with self._cursor() as cur:
                _ = cur.execute("SELECT DISTINCT owner_id FROM jobs")
                rows = _fetch_owner_id_rows(cur)
            return [row[0] for row in rows] or ["default"]

        return await self._run(_go)


def _row_to_page_stage(row: _PageStageRow) -> PageStageState:
    """Hydrate a fetched DB row into a PageStageState model.

    Column order matches the SELECT clauses above; keep them aligned.
    """
    return PageStageState(
        project_id=row[0],
        page_id=row[1],
        stage_id=row[2],
        status=PageStageStatus(row[3]),
        stage_version=row[4],
        config_hash=row[5],
        input_hash=row[6],
        artifact_key=row[7],
        last_run_at=row[8],
        duration_ms=row[9],
        error_message=row[10],
        job_id=row[11],
    )
