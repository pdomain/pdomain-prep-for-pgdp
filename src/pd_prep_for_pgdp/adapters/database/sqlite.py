"""SQLite-backed IDatabase implementation.

Uses stdlib `sqlite3` (no external deps). One JSON-text column per record
shape — schema migrations stay trivial since we treat the rows as document
storage. This matches the local-mode goal of zero-extra-dependency install.
"""

from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path

import anyio.to_thread

from ...core.models import (
    PAGE_STAGE_IDS,
    Job,
    PageRecord,
    PageStageState,
    PageStageStatus,
    Project,
    SystemDefaults,
)

# Inline string-list literal of the 22 canonical stage IDs (built once at
# import time from `PAGE_STAGE_IDS`) so the CHECK constraint stays
# synchronised with the model's source of truth without runtime indirection.
_STAGE_ID_CHECK_CLAUSE = "(" + ", ".join(f"'{s}'" for s in PAGE_STAGE_IDS) + ")"

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

CREATE TABLE IF NOT EXISTS pages (
    project_id TEXT NOT NULL,
    idx0       INTEGER NOT NULL,
    body       TEXT NOT NULL,
    PRIMARY KEY (project_id, idx0)
);

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
"""


class SqliteDatabase:
    def __init__(self, url: str) -> None:
        # Accept "sqlite:///abs/path" or "sqlite:///:memory:".
        prefix = "sqlite:///"
        if not url.startswith(prefix):
            raise ValueError(f"unrecognised SQLite URL: {url!r}")
        path = url[len(prefix) :]
        self._memory = path == ":memory:"
        self._path = path if self._memory else str(Path(path).expanduser())
        self._conn: sqlite3.Connection | None = None
        # SQLite connection isn't safe to share across threads without a lock.
        # The runner now fans out concurrent jobs (max_concurrency > 1) so
        # two threads can race on commit() without this guard.
        self._write_lock = threading.Lock()

    # ── Lifecycle ───────────────────────────────────────────────────────────

    async def initialize(self) -> None:
        await anyio.to_thread.run_sync(self._initialize_sync)

    def _initialize_sync(self) -> None:
        if not self._memory:
            Path(self._path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self._path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode = WAL;")
        self._conn.executescript(_SCHEMA)
        self._conn.commit()

    async def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    @contextmanager
    def _cursor(self):
        assert self._conn is not None, "Database not initialised"
        with self._write_lock:
            cur = self._conn.cursor()
            try:
                yield cur
                self._conn.commit()
            finally:
                cur.close()

    async def _run(self, fn, *args):  # type: ignore[no-untyped-def]
        return await anyio.to_thread.run_sync(lambda: fn(*args))

    # ── System defaults ─────────────────────────────────────────────────────

    async def get_system_defaults(self, owner_id: str) -> SystemDefaults:
        def _go() -> SystemDefaults:
            with self._cursor() as cur:
                row = cur.execute(
                    "SELECT body FROM system_defaults WHERE owner_id = ?", (owner_id,)
                ).fetchone()
                if row is None:
                    return SystemDefaults()
                return SystemDefaults.model_validate_json(row[0])

        return await self._run(_go)

    async def put_system_defaults(self, owner_id: str, defaults: SystemDefaults) -> None:
        body = defaults.model_dump_json()

        def _go() -> None:
            with self._cursor() as cur:
                cur.execute(
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
                rows = cur.execute(
                    "SELECT body FROM projects WHERE owner_id = ? ORDER BY updated_at DESC",
                    (owner_id,),
                ).fetchall()
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
                row = cur.execute("SELECT body FROM projects WHERE id = ?", (project_id,)).fetchone()
                return Project.model_validate_json(row[0]) if row else None

        return await self._run(_go)

    async def put_project(self, project: Project) -> None:
        body = project.model_dump_json()
        ts = project.updated_at.timestamp()

        def _go() -> None:
            with self._cursor() as cur:
                cur.execute(
                    "INSERT OR REPLACE INTO projects (id, owner_id, body, updated_at) VALUES (?, ?, ?, ?)",
                    (project.id, project.owner_id, body, ts),
                )

        await self._run(_go)

    async def delete_project(self, project_id: str) -> None:
        def _go() -> None:
            with self._cursor() as cur:
                cur.execute("DELETE FROM page_stages WHERE project_id = ?", (project_id,))
                cur.execute("DELETE FROM pages WHERE project_id = ?", (project_id,))
                cur.execute("DELETE FROM projects WHERE id = ?", (project_id,))

        await self._run(_go)

    # ── Pages ───────────────────────────────────────────────────────────────

    async def list_pages(
        self,
        project_id: str,
        cursor: str | None = None,
        limit: int = 50,
    ) -> tuple[list[PageRecord], str | None, int]:
        def _go() -> tuple[list[PageRecord], str | None, int]:
            offset = int(cursor) if cursor else 0
            with self._cursor() as cur:
                total = cur.execute(
                    "SELECT COUNT(*) FROM pages WHERE project_id = ?", (project_id,)
                ).fetchone()[0]
                rows = cur.execute(
                    "SELECT body FROM pages WHERE project_id = ? ORDER BY idx0 LIMIT ? OFFSET ?",
                    (project_id, limit, offset),
                ).fetchall()
            pages = [PageRecord.model_validate_json(r[0]) for r in rows]
            next_cursor = str(offset + limit) if offset + limit < total else None
            return pages, next_cursor, total

        return await self._run(_go)

    async def get_page(self, project_id: str, idx0: int) -> PageRecord | None:
        def _go() -> PageRecord | None:
            with self._cursor() as cur:
                row = cur.execute(
                    "SELECT body FROM pages WHERE project_id = ? AND idx0 = ?",
                    (project_id, idx0),
                ).fetchone()
                return PageRecord.model_validate_json(row[0]) if row else None

        return await self._run(_go)

    async def put_page(self, page: PageRecord) -> None:
        body = page.model_dump_json()

        def _go() -> None:
            with self._cursor() as cur:
                cur.execute(
                    "INSERT OR REPLACE INTO pages (project_id, idx0, body) VALUES (?, ?, ?)",
                    (page.project_id, page.idx0, body),
                )

        await self._run(_go)

    async def put_pages(self, pages: list[PageRecord]) -> None:
        if not pages:
            return
        rows = [(p.project_id, p.idx0, p.model_dump_json()) for p in pages]

        def _go() -> None:
            with self._cursor() as cur:
                cur.executemany(
                    "INSERT OR REPLACE INTO pages (project_id, idx0, body) VALUES (?, ?, ?)",
                    rows,
                )

        await self._run(_go)

    # ── Jobs ────────────────────────────────────────────────────────────────

    async def get_job(self, job_id: str) -> Job | None:
        def _go() -> Job | None:
            with self._cursor() as cur:
                row = cur.execute("SELECT body FROM jobs WHERE id = ?", (job_id,)).fetchone()
                return Job.model_validate_json(row[0]) if row else None

        return await self._run(_go)

    async def put_job(self, job: Job) -> None:
        body = job.model_dump_json()
        ts = job.created_at.timestamp()

        def _go() -> None:
            with self._cursor() as cur:
                cur.execute(
                    "INSERT OR REPLACE INTO jobs (id, owner_id, body, created_at) VALUES (?, ?, ?, ?)",
                    (job.id, job.owner_id, body, ts),
                )

        await self._run(_go)

    async def list_recent_jobs(self, owner_id: str, limit: int = 50) -> list[Job]:
        def _go() -> list[Job]:
            with self._cursor() as cur:
                rows = cur.execute(
                    "SELECT body FROM jobs WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?",
                    (owner_id, limit),
                ).fetchall()
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
                row = cur.execute(
                    "SELECT project_id, page_id, stage_id, status, stage_version, "
                    "       config_hash, input_hash, artifact_key, last_run_at, "
                    "       duration_ms, error_message, job_id "
                    "FROM page_stages "
                    "WHERE project_id=? AND page_id=? AND stage_id=?",
                    (project_id, page_id, stage_id),
                ).fetchone()
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
                cur.execute(
                    "INSERT OR REPLACE INTO page_stages "
                    "(project_id, page_id, stage_id, status, stage_version, "
                    " config_hash, input_hash, artifact_key, last_run_at, "
                    " duration_ms, error_message, job_id) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
                rows = cur.execute(
                    "SELECT project_id, page_id, stage_id, status, stage_version, "
                    "       config_hash, input_hash, artifact_key, last_run_at, "
                    "       duration_ms, error_message, job_id "
                    "FROM page_stages "
                    "WHERE project_id=? AND page_id=?",
                    (project_id, page_id),
                ).fetchall()
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
                rows = cur.execute(
                    "SELECT project_id, page_id, stage_id, status, stage_version, "
                    "       config_hash, input_hash, artifact_key, last_run_at, "
                    "       duration_ms, error_message, job_id "
                    "FROM page_stages "
                    "WHERE project_id=? AND status=?",
                    (project_id, status.value),
                ).fetchall()
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
                cur.execute(
                    "DELETE FROM page_stages WHERE project_id=? AND page_id=?",
                    (project_id, page_id),
                )

        await self._run(_go)

    async def init_page_stages_for_page(
        self,
        project_id: str,
        page_id: str,
    ) -> int:
        """Idempotently insert one ``not-run`` row per canonical stage_id.

        Lazy side of the dual-write reconciliation contract (Q1-followup):
        the first time anyone reads a page's stage state, all 22 rows
        materialise so subsequent reads are simple lookups. Concurrent
        callers race safely — `INSERT OR IGNORE` skips the second
        inserter's row at the composite PK.

        Returns the number of rows actually inserted (0 if all 22 already
        exist).
        """

        def _go() -> int:
            with self._cursor() as cur:
                rows_before = cur.execute(
                    "SELECT COUNT(*) FROM page_stages WHERE project_id=? AND page_id=?",
                    (project_id, page_id),
                ).fetchone()[0]
                cur.executemany(
                    "INSERT OR IGNORE INTO page_stages "
                    "(project_id, page_id, stage_id, status, stage_version) "
                    "VALUES (?, ?, ?, 'not-run', 1)",
                    [(project_id, page_id, sid) for sid in PAGE_STAGE_IDS],
                )
                rows_after = cur.execute(
                    "SELECT COUNT(*) FROM page_stages WHERE project_id=? AND page_id=?",
                    (project_id, page_id),
                ).fetchone()[0]
                return rows_after - rows_before

        return await self._run(_go)


def _row_to_page_stage(row: tuple) -> PageStageState:
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
