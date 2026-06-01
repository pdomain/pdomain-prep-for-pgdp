"""Postgres-backed IDatabase implementation.

Mirrors `SqliteDatabase` exactly: every Pydantic record shape is stored as
JSON in a single text/jsonb column. This keeps schema migrations trivial
(domain models evolve in Python, the DB stays a document store) and lets
the same wire-level tests cover both backends.

URL forms accepted: ``postgres://...`` or ``postgresql://...`` — psycopg
treats them as equivalent.

Optional dep — install via ``pip install pdomain-prep-for-pgdp[postgres]``.
The bootstrap layer raises a friendly ``RuntimeError`` if the import
fails, so this module is safe to import lazily.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import TYPE_CHECKING, Protocol, Self, cast

from pdomain_prep_for_pgdp.core.models import Job, Project, SystemDefaults

if TYPE_CHECKING:
    from .base import SearchResult

    class _AsyncCursor(Protocol):
        async def execute(self, query: str, params: Sequence[object] | None = None) -> object: ...

        async def executemany(
            self,
            query: str,
            params_seq: Sequence[Sequence[object]],
        ) -> object: ...

        async def fetchone(self) -> tuple[object, ...] | None: ...

        async def fetchall(self) -> list[tuple[object, ...]]: ...

        async def __aenter__(self) -> Self: ...

        async def __aexit__(
            self,
            exc_type: type[BaseException] | None,
            exc: BaseException | None,
            traceback: object | None,
        ) -> object: ...

    class _AsyncConnection(Protocol):
        def cursor(self) -> _AsyncCursor: ...

        async def close(self) -> object: ...

    class _AsyncConnectionFactory(Protocol):
        @staticmethod
        async def connect(conninfo: str, *, autocommit: bool) -> _AsyncConnection: ...

    AsyncConnection: _AsyncConnectionFactory
else:
    # Eager imports — the [postgres] extra is required to construct this class.
    # Bootstrap wraps the resulting ImportError into a friendly RuntimeError
    # pointing the user at the extra; no module-level fallback shim here.
    from psycopg import AsyncConnection


type _JsonTextRow = tuple[str]
type _CountRow = tuple[int]

_SCHEMA = """
CREATE TABLE IF NOT EXISTS system_defaults (
    owner_id TEXT PRIMARY KEY,
    body     JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    body       JSONB NOT NULL,
    updated_at DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_owner ON projects(owner_id);

CREATE TABLE IF NOT EXISTS jobs (
    id         TEXT PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    body       JSONB NOT NULL,
    created_at DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_owner_created ON jobs(owner_id, created_at DESC);
"""


class PostgresDatabase:
    """IDatabase backed by Postgres via async psycopg.

    Connection lifecycle: a single ``AsyncConnection`` is opened in
    :meth:`initialize` and reused for the process. psycopg async
    connections serialise their own access; no separate write lock is
    needed (compare ``SqliteDatabase`` which guards a sync connection
    with ``threading.Lock``).
    """

    def __init__(self, url: str) -> None:
        # Accept postgres:// and postgresql:// — psycopg treats them as
        # equivalent. Reject anything else loudly so bootstrap mis-routes
        # surface immediately rather than failing inside libpq.
        if not (url.startswith("postgres://") or url.startswith("postgresql://")):
            raise ValueError(f"unrecognised Postgres URL: {url!r}")
        self._url: str = url
        self._conn: _AsyncConnection | None = None

    # ── Lifecycle ───────────────────────────────────────────────────────────

    async def initialize(self) -> None:
        conn = await AsyncConnection.connect(self._url, autocommit=True)
        self._conn = conn
        async with conn.cursor() as cur:
            _ = await cur.execute(_SCHEMA)

    async def close(self) -> None:
        if self._conn is not None:
            _ = await self._conn.close()
            self._conn = None

    def _require_conn(self) -> _AsyncConnection:
        if self._conn is None:
            raise RuntimeError("PostgresDatabase not initialised")
        return self._conn

    # ── System defaults ─────────────────────────────────────────────────────

    async def get_system_defaults(self, owner_id: str) -> SystemDefaults:
        conn = self._require_conn()
        async with conn.cursor() as cur:
            _ = await cur.execute(
                "SELECT body::text FROM system_defaults WHERE owner_id = %s",
                (owner_id,),
            )
            row = cast(_JsonTextRow | None, await cur.fetchone())
        if row is None:
            return SystemDefaults()
        return SystemDefaults.model_validate_json(row[0])

    async def put_system_defaults(self, owner_id: str, defaults: SystemDefaults) -> None:
        conn = self._require_conn()
        body = defaults.model_dump_json()
        async with conn.cursor() as cur:
            _ = await cur.execute(
                """
                INSERT INTO system_defaults (owner_id, body) VALUES (%s, %s::jsonb)
                ON CONFLICT (owner_id) DO UPDATE SET body = EXCLUDED.body
                """,
                (owner_id, body),
            )

    # ── Projects ────────────────────────────────────────────────────────────

    async def list_projects(
        self,
        owner_id: str,
        *,
        include_archived: bool = False,
    ) -> list[Project]:
        conn = self._require_conn()
        async with conn.cursor() as cur:
            _ = await cur.execute(
                "SELECT body::text FROM projects WHERE owner_id = %s ORDER BY updated_at DESC",
                (owner_id,),
            )
            rows = cast(list[_JsonTextRow], await cur.fetchall())
        projects = [Project.model_validate_json(r[0]) for r in rows]
        if include_archived:
            return projects
        # Mirrors SqliteDatabase: filter post-load. `archived` is buried in
        # the JSON body; per-owner project counts are small (~dozens), so
        # an in-memory filter is fine and avoids a JSONB-extract clause.
        return [p for p in projects if not p.archived]

    async def get_project(self, project_id: str) -> Project | None:
        conn = self._require_conn()
        async with conn.cursor() as cur:
            _ = await cur.execute("SELECT body::text FROM projects WHERE id = %s", (project_id,))
            row = cast(_JsonTextRow | None, await cur.fetchone())
        return Project.model_validate_json(row[0]) if row else None

    async def put_project(self, project: Project) -> None:
        conn = self._require_conn()
        body = project.model_dump_json()
        ts = project.updated_at.timestamp()
        async with conn.cursor() as cur:
            _ = await cur.execute(
                """
                INSERT INTO projects (id, owner_id, body, updated_at)
                VALUES (%s, %s, %s::jsonb, %s)
                ON CONFLICT (id) DO UPDATE SET
                    owner_id = EXCLUDED.owner_id,
                    body = EXCLUDED.body,
                    updated_at = EXCLUDED.updated_at
                """,
                (project.id, project.owner_id, body, ts),
            )

    async def delete_project(self, project_id: str) -> None:
        conn = self._require_conn()
        async with conn.cursor() as cur:
            _ = await cur.execute("DELETE FROM projects WHERE id = %s", (project_id,))

    # ── Jobs ────────────────────────────────────────────────────────────────

    async def get_job(self, job_id: str) -> Job | None:
        conn = self._require_conn()
        async with conn.cursor() as cur:
            _ = await cur.execute("SELECT body::text FROM jobs WHERE id = %s", (job_id,))
            row = cast(_JsonTextRow | None, await cur.fetchone())
        return Job.model_validate_json(row[0]) if row else None

    async def put_job(self, job: Job) -> None:
        conn = self._require_conn()
        body = job.model_dump_json()
        ts = job.created_at.timestamp()
        async with conn.cursor() as cur:
            _ = await cur.execute(
                """
                INSERT INTO jobs (id, owner_id, body, created_at)
                VALUES (%s, %s, %s::jsonb, %s)
                ON CONFLICT (id) DO UPDATE SET
                    owner_id = EXCLUDED.owner_id,
                    body = EXCLUDED.body,
                    created_at = EXCLUDED.created_at
                """,
                (job.id, job.owner_id, body, ts),
            )

    async def list_recent_jobs(self, owner_id: str, limit: int = 50) -> list[Job]:
        conn = self._require_conn()
        async with conn.cursor() as cur:
            _ = await cur.execute(
                "SELECT body::text FROM jobs WHERE owner_id = %s ORDER BY created_at DESC LIMIT %s",
                (owner_id, limit),
            )
            rows = cast(list[_JsonTextRow], await cur.fetchall())
        return [Job.model_validate_json(r[0]) for r in rows]

    # ── Full-text search (stub — Postgres tsvector implementation deferred) ──

    async def upsert_page_text(
        self,
        _project_id: str,
        _page_id: str,
        _idx0: int,
        _ocr_text: str,
    ) -> None:
        raise NotImplementedError("Postgres FTS (tsvector) not yet implemented")

    async def search(
        self,
        _project_id: str,
        _query: str,
        _limit: int = 20,
        _offset: int = 0,
    ) -> tuple[list[SearchResult], int]:
        raise NotImplementedError("Postgres FTS (tsvector) not yet implemented")
