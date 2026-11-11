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
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Protocol, Self, cast

from pdomain_prep_for_pgdp.core.models import (
    V2_PAGE_STAGE_IDS,
    Job,
    PageStageState,
    PageStageStatus,
    Project,
    SystemDefaults,
)

from .base import SearchResult

if TYPE_CHECKING:

    class _AsyncCursor(Protocol):
        @property
        def rowcount(self) -> int: ...

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
type _OwnerRow = tuple[str]
type _SearchRow = tuple[str, int, str, float]
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

_LONG_S = chr(0x17F)  # U+017F LATIN SMALL LETTER LONG S

# Postgres holds no pre-v2 data, so only the v2 stage ids are valid here.
_STAGE_ID_CHECK = ", ".join(f"'{s}'" for s in V2_PAGE_STAGE_IDS)
_STATUS_CHECK = ", ".join(f"'{s.value}'" for s in PageStageStatus)


def _normalize_for_fts(text: str) -> str:
    """Expand long-s (U+017F) before indexing or querying, as SQLite does."""
    return text.replace(_LONG_S, "s")


def _row_to_page_stage(row: _PageStageRow) -> PageStageState:
    """Hydrate a page_stages row; columns in table order, as every SELECT lists them."""
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


_SCHEMA = f"""
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

CREATE TABLE IF NOT EXISTS page_stages (
    project_id    TEXT    NOT NULL,
    page_id       TEXT    NOT NULL,
    stage_id      TEXT    NOT NULL,
    status        TEXT    NOT NULL,
    stage_version INTEGER NOT NULL,
    config_hash   TEXT,
    input_hash    TEXT,
    artifact_key  TEXT,
    last_run_at   DOUBLE PRECISION,
    duration_ms   INTEGER,
    error_message TEXT,
    job_id        TEXT,
    PRIMARY KEY (project_id, page_id, stage_id),
    CHECK (status IN ({_STATUS_CHECK})),
    CHECK (stage_id IN ({_STAGE_ID_CHECK}))
);
CREATE INDEX IF NOT EXISTS page_stages_proj_status ON page_stages(project_id, status);
CREATE INDEX IF NOT EXISTS page_stages_proj_page ON page_stages(project_id, page_id);

-- Full-text search. The 'simple' configuration matches SQLite FTS5's default
-- tokenizer: lower-cased words, no stemming, no stop words.
CREATE TABLE IF NOT EXISTS page_text (
    project_id TEXT    NOT NULL,
    page_id    TEXT    NOT NULL,
    idx0       INTEGER NOT NULL,
    ocr_text   TEXT    NOT NULL,
    tsv        TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', ocr_text)) STORED,
    PRIMARY KEY (project_id, page_id)
);
CREATE INDEX IF NOT EXISTS page_text_tsv ON page_text USING GIN (tsv);
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

    async def get_project_raw_config(self, project_id: str) -> dict[str, object] | None:
        import json as _json

        conn = self._require_conn()
        async with conn.cursor() as cur:
            _ = await cur.execute("SELECT body::text FROM projects WHERE id = %s", (project_id,))
            row = cast("_JsonTextRow | None", await cur.fetchone())
        if not row:
            return None
        body = _json.loads(row[0])
        cfg = body.get("config")
        return cfg if isinstance(cfg, dict) else None

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
            _ = await cur.execute("DELETE FROM page_stages WHERE project_id = %s", (project_id,))
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

    async def update_job_unless_cancelled(self, job: Job) -> bool:
        conn = self._require_conn()
        async with conn.cursor() as cur:
            _ = await cur.execute(
                "UPDATE jobs SET body = %s::jsonb WHERE id = %s AND body->>'status' <> 'cancelled'",
                (job.model_dump_json(), job.id),
            )
            return cur.rowcount == 1

    async def cancel_active_stage_jobs(self, owner_id: str, project_id: str, stage_id: str) -> int:
        conn = self._require_conn()
        async with conn.cursor() as cur:
            _ = await cur.execute(
                """
                UPDATE jobs SET body = jsonb_set(body, '{status}', '"cancelled"')
                WHERE owner_id = %s
                  AND body->>'project_id' = %s
                  AND body->>'status' NOT IN ('complete', 'error', 'cancelled')
                  AND (body->'payload'->>'stage_id' = %s
                       OR (%s::text = 'ocr' AND body->>'type' = 'run_project_ocr_batch'))
                """,
                (owner_id, project_id, stage_id, stage_id),
            )
            return cur.rowcount

    async def fail_running_jobs(self, message: str) -> list[Job]:
        conn = self._require_conn()
        async with conn.cursor() as cur:
            _ = await cur.execute(
                """
                UPDATE jobs
                SET body = body || jsonb_build_object(
                    'status', 'error', 'error_message', %s::text, 'completed_at', %s::text
                )
                WHERE body->>'status' = 'running'
                RETURNING body::text
                """,
                (message, datetime.now(UTC).isoformat()),
            )
            rows = cast(list[_JsonTextRow], await cur.fetchall())
        return [Job.model_validate_json(r[0]) for r in rows]

    async def list_recent_jobs(self, owner_id: str, limit: int = 50) -> list[Job]:
        conn = self._require_conn()
        async with conn.cursor() as cur:
            _ = await cur.execute(
                "SELECT body::text FROM jobs WHERE owner_id = %s ORDER BY created_at DESC LIMIT %s",
                (owner_id, limit),
            )
            rows = cast(list[_JsonTextRow], await cur.fetchall())
        return [Job.model_validate_json(r[0]) for r in rows]

    # ── Page stages (per-page DAG state) ────────────────────────────────────

    async def _fetch_page_stages(self, query: str, params: Sequence[object]) -> list[PageStageState]:
        conn = self._require_conn()
        async with conn.cursor() as cur:
            _ = await cur.execute(query, params)
            rows = cast(list[_PageStageRow], await cur.fetchall())
        return [_row_to_page_stage(r) for r in rows]

    async def get_page_stage(self, project_id: str, page_id: str, stage_id: str) -> PageStageState | None:
        rows = await self._fetch_page_stages(
            """
                SELECT project_id, page_id, stage_id, status, stage_version,
                       config_hash, input_hash, artifact_key, last_run_at,
                       duration_ms, error_message, job_id
                FROM page_stages
                WHERE project_id = %s AND page_id = %s AND stage_id = %s
                """,
            (project_id, page_id, stage_id),
        )
        return rows[0] if rows else None

    async def put_page_stage(self, state: PageStageState) -> None:
        """Idempotent upsert on the composite primary key."""
        conn = self._require_conn()
        async with conn.cursor() as cur:
            _ = await cur.execute(
                """
                INSERT INTO page_stages
                    (project_id, page_id, stage_id, status, stage_version,
                     config_hash, input_hash, artifact_key, last_run_at,
                     duration_ms, error_message, job_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (project_id, page_id, stage_id) DO UPDATE SET
                    status = EXCLUDED.status,
                    stage_version = EXCLUDED.stage_version,
                    config_hash = EXCLUDED.config_hash,
                    input_hash = EXCLUDED.input_hash,
                    artifact_key = EXCLUDED.artifact_key,
                    last_run_at = EXCLUDED.last_run_at,
                    duration_ms = EXCLUDED.duration_ms,
                    error_message = EXCLUDED.error_message,
                    job_id = EXCLUDED.job_id
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

    async def list_page_stages_for_page(self, project_id: str, page_id: str) -> list[PageStageState]:
        return await self._fetch_page_stages(
            """
                SELECT project_id, page_id, stage_id, status, stage_version,
                       config_hash, input_hash, artifact_key, last_run_at,
                       duration_ms, error_message, job_id
                FROM page_stages
                WHERE project_id = %s AND page_id = %s
                """,
            (project_id, page_id),
        )

    async def list_page_stages_by_status(
        self, project_id: str, status: PageStageStatus
    ) -> list[PageStageState]:
        return await self._fetch_page_stages(
            """
                SELECT project_id, page_id, stage_id, status, stage_version,
                       config_hash, input_hash, artifact_key, last_run_at,
                       duration_ms, error_message, job_id
                FROM page_stages
                WHERE project_id = %s AND status = %s
                """,
            (project_id, status.value),
        )

    async def list_page_stages_by_project(self, project_id: str) -> list[PageStageState]:
        return await self._fetch_page_stages(
            """
                SELECT project_id, page_id, stage_id, status, stage_version,
                       config_hash, input_hash, artifact_key, last_run_at,
                       duration_ms, error_message, job_id
                FROM page_stages
                WHERE project_id = %s
                """,
            (project_id,),
        )

    async def delete_page_stages_for_page(self, project_id: str, page_id: str) -> None:
        conn = self._require_conn()
        async with conn.cursor() as cur:
            _ = await cur.execute(
                "DELETE FROM page_stages WHERE project_id = %s AND page_id = %s",
                (project_id, page_id),
            )

    async def init_page_stages_for_page(self, project_id: str, page_id: str) -> int:
        """Insert a ``not-run`` row for each v2 stage the page lacks; return how many were added."""
        conn = self._require_conn()
        async with conn.cursor() as cur:
            _ = await cur.execute(
                """
                INSERT INTO page_stages (project_id, page_id, stage_id, status, stage_version)
                SELECT %s, %s, stage_id, %s, 1 FROM unnest(%s::text[]) AS stage_id
                ON CONFLICT (project_id, page_id, stage_id) DO NOTHING
                """,
                (project_id, page_id, PageStageStatus.not_run.value, list(V2_PAGE_STAGE_IDS)),
            )
            return cur.rowcount

    # ── Full-text search (tsvector) ─────────────────────────────────────────

    async def upsert_page_text(self, project_id: str, page_id: str, idx0: int, ocr_text: str) -> None:
        conn = self._require_conn()
        async with conn.cursor() as cur:
            _ = await cur.execute(
                """
                INSERT INTO page_text (project_id, page_id, idx0, ocr_text)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (project_id, page_id) DO UPDATE SET
                    idx0 = EXCLUDED.idx0,
                    ocr_text = EXCLUDED.ocr_text
                """,
                (project_id, page_id, idx0, _normalize_for_fts(ocr_text)),
            )

    async def search(
        self,
        project_id: str,
        query: str,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[SearchResult], int]:
        """Rank pages by ``ts_rank``; scores fall in (0, 1) via normalisation flag 32."""
        normalized = _normalize_for_fts(query)
        conn = self._require_conn()
        async with conn.cursor() as cur:
            _ = await cur.execute(
                """
                SELECT COUNT(*) FROM page_text
                WHERE project_id = %s AND tsv @@ plainto_tsquery('simple', %s)
                """,
                (project_id, normalized),
            )
            count_row = cast(_CountRow | None, await cur.fetchone())
            _ = await cur.execute(
                """
                SELECT page_id, idx0,
                       ts_headline('simple', ocr_text, q,
                                   'StartSel="", StopSel="", MaxWords=15, MinWords=5'),
                       ts_rank(tsv, q, 32)::double precision AS score
                FROM page_text, plainto_tsquery('simple', %s) AS q
                WHERE project_id = %s AND tsv @@ q
                ORDER BY score DESC, idx0
                LIMIT %s OFFSET %s
                """,
                (normalized, project_id, limit, offset),
            )
            rows = cast(list[_SearchRow], await cur.fetchall())
        results = [
            SearchResult(page_id=r[0], idx0=int(r[1]), snippet=r[2] or "", score=float(r[3])) for r in rows
        ]
        return results, count_row[0] if count_row else 0

    # ── Multi-tenant enumeration ────────────────────────────────────────────

    async def list_distinct_owner_ids(self) -> list[str]:
        """Owners with at least one job, or ``["default"]`` when there are none."""
        conn = self._require_conn()
        async with conn.cursor() as cur:
            _ = await cur.execute("SELECT DISTINCT owner_id FROM jobs ORDER BY owner_id")
            rows = cast(list[_OwnerRow], await cur.fetchall())
        return [r[0] for r in rows] or ["default"]
