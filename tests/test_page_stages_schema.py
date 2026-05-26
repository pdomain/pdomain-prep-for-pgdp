"""M1 §A — `page_stages` SQLite schema + idempotent upsert.

Spec: `docs/specs/pipeline-task-model.md` §"SQLite schema" (Q1 locked
2026-05-07).

Schema is normalised: composite PK `(project_id, page_id, stage_id)` with
indexes on `(project_id, status)` and `(project_id, page_id)`. Status is
constrained via CHECK to the spec's enum. Stage IDs are constrained via
CHECK to the canonical stage list from `core.models.PAGE_STAGE_IDS`
(22 stages per `STAGE_VERSIONS` in the spec — note: `docs/08-roadmap.md`
M1 still says "16-stage registry"; that's a roadmap-vs-spec drift to be
cleaned up in M1 §F doc realign).

Upserts go through `put_page_stage` (idempotent INSERT OR REPLACE). Reads
via `get_page_stage` (single row), `list_page_stages_for_page`, and
`list_page_stages_by_status` (uses the proj_status index).
"""

from __future__ import annotations

import sqlite3
import time

import pytest

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.core.models import (
    PageStageState,
    PageStageStatus,
    Project,
)


@pytest.fixture
async def db(tmp_path) -> SqliteDatabase:
    d = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await d.initialize()
    return d


def _state(
    project_id: str = "p1",
    page_id: str = "0000",
    stage_id: str = "threshold",
    status: PageStageStatus = PageStageStatus.not_run,
    stage_version: int = 1,
    artifact_key: str | None = None,
    config_hash: str | None = None,
    input_hash: str | None = None,
    error_message: str | None = None,
    last_run_at: float | None = None,
    duration_ms: int | None = None,
    job_id: str | None = None,
) -> PageStageState:
    return PageStageState(
        project_id=project_id,
        page_id=page_id,
        stage_id=stage_id,
        status=status,
        stage_version=stage_version,
        artifact_key=artifact_key,
        config_hash=config_hash,
        input_hash=input_hash,
        error_message=error_message,
        last_run_at=last_run_at,
        duration_ms=duration_ms,
        job_id=job_id,
    )


# ─── Schema tests ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_page_stages_table_created_on_initialize(db: SqliteDatabase) -> None:
    """Table + spec-mandated indexes must exist after initialize()."""

    def _go() -> tuple[bool, list[str]]:
        with db._cursor() as cur:
            row = cur.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='page_stages'"
            ).fetchone()
            idx_rows = cur.execute(
                "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='page_stages'"
            ).fetchall()
            return row is not None, [r[0] for r in idx_rows]

    exists, indexes = await db._run(_go)
    assert exists, "page_stages table missing"
    assert "page_stages_proj_status" in indexes
    assert "page_stages_proj_page" in indexes


@pytest.mark.asyncio
async def test_page_stages_columns_match_spec(db: SqliteDatabase) -> None:
    """All columns from the canonical spec §SQLite schema must be present."""

    def _go() -> dict[str, str]:
        with db._cursor() as cur:
            rows = cur.execute("PRAGMA table_info(page_stages)").fetchall()
        return {r[1]: r[2] for r in rows}

    cols = await db._run(_go)
    expected = {
        "project_id": "TEXT",
        "page_id": "TEXT",
        "stage_id": "TEXT",
        "status": "TEXT",
        "stage_version": "INTEGER",
        "config_hash": "TEXT",
        "input_hash": "TEXT",
        "artifact_key": "TEXT",
        "last_run_at": "REAL",
        "duration_ms": "INTEGER",
        "error_message": "TEXT",
        "job_id": "TEXT",
    }
    for name, ty in expected.items():
        assert name in cols, f"missing column {name}"
        assert cols[name].upper().startswith(ty), f"column {name} type {cols[name]!r} doesn't start with {ty}"


@pytest.mark.asyncio
async def test_composite_primary_key_is_proj_page_stage(db: SqliteDatabase) -> None:
    """The PK must be (project_id, page_id, stage_id) per the spec."""

    def _go() -> list[str]:
        with db._cursor() as cur:
            rows = cur.execute("PRAGMA table_info(page_stages)").fetchall()
        # PK column ordinal lives in column 5 (1-based for PK members, 0 = not pk)
        pk_cols = sorted([(r[5], r[1]) for r in rows if r[5]])
        return [c for _, c in pk_cols]

    assert await db._run(_go) == ["project_id", "page_id", "stage_id"]


# ─── Constraint tests ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_status_check_constraint_rejects_bogus_value(db: SqliteDatabase) -> None:
    """The status CHECK constraint must reject arbitrary strings."""

    def _go() -> None:
        with db._cursor() as cur:
            cur.execute(
                "INSERT INTO page_stages "
                "(project_id, page_id, stage_id, status, stage_version) "
                "VALUES (?, ?, ?, ?, ?)",
                ("p1", "0000", "threshold", "GARBAGE_STATUS", 1),
            )

    with pytest.raises(sqlite3.IntegrityError):
        await db._run(_go)


@pytest.mark.asyncio
async def test_stage_id_check_constraint_rejects_unknown_stage(db: SqliteDatabase) -> None:
    """The stage_id CHECK constraint must reject IDs not in the canonical set."""

    def _go() -> None:
        with db._cursor() as cur:
            cur.execute(
                "INSERT INTO page_stages "
                "(project_id, page_id, stage_id, status, stage_version) "
                "VALUES (?, ?, ?, ?, ?)",
                ("p1", "0000", "bogus_stage", "not-run", 1),
            )

    with pytest.raises(sqlite3.IntegrityError):
        await db._run(_go)


@pytest.mark.asyncio
async def test_unique_constraint_on_proj_page_stage(db: SqliteDatabase) -> None:
    """Two raw INSERTs with the same (project, page, stage) violate the PK."""

    def _go() -> None:
        with db._cursor() as cur:
            cur.execute(
                "INSERT INTO page_stages "
                "(project_id, page_id, stage_id, status, stage_version) "
                "VALUES (?, ?, ?, ?, ?)",
                ("p1", "0000", "threshold", "not-run", 1),
            )
            cur.execute(
                "INSERT INTO page_stages "
                "(project_id, page_id, stage_id, status, stage_version) "
                "VALUES (?, ?, ?, ?, ?)",
                ("p1", "0000", "threshold", "clean", 1),
            )

    with pytest.raises(sqlite3.IntegrityError):
        await db._run(_go)


# ─── CRUD / upsert tests ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_put_then_get_page_stage_roundtrip(db: SqliteDatabase) -> None:
    s = _state(
        status=PageStageStatus.clean,
        artifact_key="projects/p1/pages/0000/stages/threshold/output.png",
        config_hash="cfg-abc",
        input_hash="in-xyz",
        last_run_at=time.time(),
        duration_ms=42,
        job_id="job-1",
    )
    await db.put_page_stage(s)
    got = await db.get_page_stage("p1", "0000", "threshold")
    assert got is not None
    assert got.status == PageStageStatus.clean
    assert got.artifact_key == s.artifact_key
    assert got.config_hash == "cfg-abc"
    assert got.duration_ms == 42


@pytest.mark.asyncio
async def test_put_page_stage_is_idempotent_upsert(db: SqliteDatabase) -> None:
    """Back-to-back upserts to the same key replace, not duplicate."""
    a = _state(status=PageStageStatus.dirty, stage_version=1)
    await db.put_page_stage(a)
    b = _state(status=PageStageStatus.clean, stage_version=2, artifact_key="k")
    await db.put_page_stage(b)
    got = await db.get_page_stage("p1", "0000", "threshold")
    assert got is not None
    assert got.status == PageStageStatus.clean
    assert got.stage_version == 2
    assert got.artifact_key == "k"

    def _count() -> int:
        with db._cursor() as cur:
            return cur.execute(
                "SELECT COUNT(*) FROM page_stages WHERE project_id=? AND page_id=? AND stage_id=?",
                ("p1", "0000", "threshold"),
            ).fetchone()[0]

    assert await db._run(_count) == 1


@pytest.mark.asyncio
async def test_list_page_stages_for_page(db: SqliteDatabase) -> None:
    rows = [
        _state(stage_id="decode_source", status=PageStageStatus.clean),
        _state(stage_id="threshold", status=PageStageStatus.dirty),
        _state(stage_id="ocr", status=PageStageStatus.not_run),
        # Different page — must not show up.
        _state(page_id="0001", stage_id="decode_source", status=PageStageStatus.clean),
    ]
    for r in rows:
        await db.put_page_stage(r)
    got = await db.list_page_stages_for_page("p1", "0000")
    assert {s.stage_id for s in got} == {"decode_source", "threshold", "ocr"}


@pytest.mark.asyncio
async def test_list_page_stages_by_status(db: SqliteDatabase) -> None:
    rows = [
        _state(page_id="0000", stage_id="threshold", status=PageStageStatus.dirty),
        _state(page_id="0001", stage_id="ocr", status=PageStageStatus.dirty),
        _state(page_id="0002", stage_id="threshold", status=PageStageStatus.clean),
    ]
    for r in rows:
        await db.put_page_stage(r)
    dirty = await db.list_page_stages_by_status("p1", PageStageStatus.dirty)
    assert len(dirty) == 2
    assert {(s.page_id, s.stage_id) for s in dirty} == {("0000", "threshold"), ("0001", "ocr")}


# ─── Cascade tests ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_delete_project_cascades_page_stages(db: SqliteDatabase) -> None:
    """delete_project must drop page_stages rows for that project."""
    from datetime import UTC, datetime

    from pdomain_prep_for_pgdp.core.models import (
        PipelineState,
        ProjectConfig,
        ProjectStatus,
    )

    now = datetime.now(UTC)
    proj = Project(
        id="p1",
        owner_id="u1",
        name="P1",
        created_at=now,
        updated_at=now,
        status=ProjectStatus.processing,
        page_count=1,
        proof_page_count=1,
        config=ProjectConfig(book_name="P1", source_uri=""),
        pipeline_state=PipelineState(),
        storage_prefix="projects/p1",
    )
    await db.put_project(proj)
    await db.put_page_stage(_state())
    await db.delete_project("p1")
    assert await db.get_page_stage("p1", "0000", "threshold") is None


@pytest.mark.asyncio
async def test_delete_page_stages_for_page_only_drops_target_page(db: SqliteDatabase) -> None:
    """A per-page delete helper drops all stages for one page, leaving siblings."""
    await db.put_page_stage(_state(page_id="0000", stage_id="threshold"))
    await db.put_page_stage(_state(page_id="0000", stage_id="ocr"))
    await db.put_page_stage(_state(page_id="0001", stage_id="threshold"))
    await db.delete_page_stages_for_page("p1", "0000")
    assert await db.get_page_stage("p1", "0000", "threshold") is None
    assert await db.get_page_stage("p1", "0000", "ocr") is None
    # Sibling page untouched.
    assert await db.get_page_stage("p1", "0001", "threshold") is not None


# ─── Concurrent upsert behavior ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_concurrent_upserts_resolve_to_one_row(db: SqliteDatabase) -> None:
    """Back-to-back-to-back upserts with different statuses settle to last-writer."""
    import asyncio

    states = [
        _state(status=PageStageStatus.running, stage_version=1, job_id="j1"),
        _state(status=PageStageStatus.clean, stage_version=1, job_id="j1", artifact_key="k1"),
        _state(status=PageStageStatus.dirty, stage_version=1),
    ]
    # Sequentially-awaited (not parallel — the SqliteDatabase serialises with a
    # write_lock anyway); the contract is "last write wins, exactly one row".
    for s in states:
        await db.put_page_stage(s)

    got = await db.get_page_stage("p1", "0000", "threshold")
    assert got is not None
    assert got.status == PageStageStatus.dirty
    assert got.artifact_key is None  # last upsert had no artifact_key
    # Avoid the "test does nothing async" lint trip:
    await asyncio.sleep(0)


# ─── Index usage smoke ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_proj_status_index_used_by_status_query(db: SqliteDatabase) -> None:
    """list_page_stages_by_status should use the page_stages_proj_status index."""

    def _go() -> str:
        with db._cursor() as cur:
            row = cur.execute(
                "EXPLAIN QUERY PLAN SELECT * FROM page_stages WHERE project_id=? AND status=?",
                ("p1", "dirty"),
            ).fetchone()
        return row[3] if row else ""

    plan = await db._run(_go)
    assert "page_stages_proj_status" in plan, f"index not used; plan={plan}"
