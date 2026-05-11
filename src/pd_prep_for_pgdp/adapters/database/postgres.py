"""Postgres-backed IDatabase implementation.

Mirrors `SqliteDatabase` exactly: every Pydantic record shape is stored as
JSON in a single text/jsonb column. This keeps schema migrations trivial
(domain models evolve in Python, the DB stays a document store) and lets
the same wire-level tests cover both backends.

URL forms accepted: ``postgres://...`` or ``postgresql://...`` — psycopg
treats them as equivalent.

Optional dep — install via ``pip install pd-prep-for-pgdp[postgres]``.
The bootstrap layer raises a friendly ``RuntimeError`` if the import
fails, so this module is safe to import lazily.
"""

from __future__ import annotations

# Eager imports — the [postgres] extra is required to construct this class.
# Bootstrap wraps the resulting ImportError into a friendly RuntimeError
# pointing the user at the extra; no module-level fallback shim here.
from psycopg import AsyncConnection

from ...core.models import Job, PageRecord, Project, SystemDefaults

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

CREATE TABLE IF NOT EXISTS pages (
    project_id TEXT NOT NULL,
    idx0       INTEGER NOT NULL,
    body       JSONB NOT NULL,
    PRIMARY KEY (project_id, idx0)
);

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
        self._url = url
        self._conn: AsyncConnection | None = None

    # ── Lifecycle ───────────────────────────────────────────────────────────

    async def initialize(self) -> None:
        self._conn = await AsyncConnection.connect(self._url, autocommit=True)
        async with self._conn.cursor() as cur:
            await cur.execute(_SCHEMA)

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    def _require_conn(self) -> AsyncConnection:
        if self._conn is None:
            raise RuntimeError("PostgresDatabase not initialised")
        return self._conn

    # ── System defaults ─────────────────────────────────────────────────────

    async def get_system_defaults(self, owner_id: str) -> SystemDefaults:
        conn = self._require_conn()
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT body::text FROM system_defaults WHERE owner_id = %s",
                (owner_id,),
            )
            row = await cur.fetchone()
        if row is None:
            return SystemDefaults()
        return SystemDefaults.model_validate_json(row[0])

    async def put_system_defaults(self, owner_id: str, defaults: SystemDefaults) -> None:
        conn = self._require_conn()
        body = defaults.model_dump_json()
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO system_defaults (owner_id, body) VALUES (%s, %s::jsonb) "
                "ON CONFLICT (owner_id) DO UPDATE SET body = EXCLUDED.body",
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
            await cur.execute(
                "SELECT body::text FROM projects WHERE owner_id = %s ORDER BY updated_at DESC",
                (owner_id,),
            )
            rows = await cur.fetchall()
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
            await cur.execute("SELECT body::text FROM projects WHERE id = %s", (project_id,))
            row = await cur.fetchone()
        return Project.model_validate_json(row[0]) if row else None

    async def put_project(self, project: Project) -> None:
        conn = self._require_conn()
        body = project.model_dump_json()
        ts = project.updated_at.timestamp()
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO projects (id, owner_id, body, updated_at) "
                "VALUES (%s, %s, %s::jsonb, %s) "
                "ON CONFLICT (id) DO UPDATE SET "
                "owner_id = EXCLUDED.owner_id, body = EXCLUDED.body, updated_at = EXCLUDED.updated_at",
                (project.id, project.owner_id, body, ts),
            )

    async def delete_project(self, project_id: str) -> None:
        conn = self._require_conn()
        async with conn.cursor() as cur:
            await cur.execute("DELETE FROM pages WHERE project_id = %s", (project_id,))
            await cur.execute("DELETE FROM projects WHERE id = %s", (project_id,))

    # ── Pages ───────────────────────────────────────────────────────────────

    async def list_pages(
        self,
        project_id: str,
        cursor: str | None = None,
        limit: int = 50,
    ) -> tuple[list[PageRecord], str | None, int]:
        conn = self._require_conn()
        offset = int(cursor) if cursor else 0
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT COUNT(*) FROM pages WHERE project_id = %s",
                (project_id,),
            )
            total_row = await cur.fetchone()
            total = total_row[0] if total_row else 0
            await cur.execute(
                "SELECT body::text FROM pages WHERE project_id = %s ORDER BY idx0 LIMIT %s OFFSET %s",
                (project_id, limit, offset),
            )
            rows = await cur.fetchall()
        pages = [PageRecord.model_validate_json(r[0]) for r in rows]
        next_cursor = str(offset + limit) if offset + limit < total else None
        return pages, next_cursor, total

    async def get_page(self, project_id: str, idx0: int) -> PageRecord | None:
        conn = self._require_conn()
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT body::text FROM pages WHERE project_id = %s AND idx0 = %s",
                (project_id, idx0),
            )
            row = await cur.fetchone()
        return PageRecord.model_validate_json(row[0]) if row else None

    async def put_page(self, page: PageRecord) -> None:
        conn = self._require_conn()
        body = page.model_dump_json()
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO pages (project_id, idx0, body) VALUES (%s, %s, %s::jsonb) "
                "ON CONFLICT (project_id, idx0) DO UPDATE SET body = EXCLUDED.body",
                (page.project_id, page.idx0, body),
            )

    async def put_pages(self, pages: list[PageRecord]) -> None:
        if not pages:
            return
        conn = self._require_conn()
        rows = [(p.project_id, p.idx0, p.model_dump_json()) for p in pages]
        async with conn.cursor() as cur:
            await cur.executemany(
                "INSERT INTO pages (project_id, idx0, body) VALUES (%s, %s, %s::jsonb) "
                "ON CONFLICT (project_id, idx0) DO UPDATE SET body = EXCLUDED.body",
                rows,
            )

    # ── Jobs ────────────────────────────────────────────────────────────────

    async def get_job(self, job_id: str) -> Job | None:
        conn = self._require_conn()
        async with conn.cursor() as cur:
            await cur.execute("SELECT body::text FROM jobs WHERE id = %s", (job_id,))
            row = await cur.fetchone()
        return Job.model_validate_json(row[0]) if row else None

    async def put_job(self, job: Job) -> None:
        conn = self._require_conn()
        body = job.model_dump_json()
        ts = job.created_at.timestamp()
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO jobs (id, owner_id, body, created_at) "
                "VALUES (%s, %s, %s::jsonb, %s) "
                "ON CONFLICT (id) DO UPDATE SET "
                "owner_id = EXCLUDED.owner_id, body = EXCLUDED.body, created_at = EXCLUDED.created_at",
                (job.id, job.owner_id, body, ts),
            )

    async def list_recent_jobs(self, owner_id: str, limit: int = 50) -> list[Job]:
        conn = self._require_conn()
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT body::text FROM jobs WHERE owner_id = %s ORDER BY created_at DESC LIMIT %s",
                (owner_id, limit),
            )
            rows = await cur.fetchall()
        return [Job.model_validate_json(r[0]) for r in rows]
