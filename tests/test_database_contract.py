"""The shared ``IDatabase`` contract, run against SQLite and a live Postgres.

SQLite always runs. Postgres runs when ``PGDP_TEST_POSTGRES_URL`` names a
reachable database and the ``[postgres]`` extra is installed; otherwise those
cases skip. The tests drop the adapter's tables first, so point the variable
at a throwaway database only.

Example, with a disposable container::

    docker run --rm -d --name pgdp-pg -e POSTGRES_PASSWORD=pgdp -p 127.0.0.1:55432:5432 postgres:17-alpine
    PGDP_TEST_POSTGRES_URL=postgresql://postgres:pgdp@127.0.0.1:55432/postgres \\
        uv run --extra postgres pytest tests/test_database_contract.py
"""

from __future__ import annotations

import ast
import importlib.util
import inspect
import os
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from pdomain_prep_for_pgdp.adapters.database.base import IDatabase
from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.core.models import (
    V2_PAGE_STAGE_IDS,
    Job,
    JobStatus,
    JobType,
    PageStageState,
    PageStageStatus,
    Project,
    ProjectConfig,
    ProjectStatus,
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

_PG_URL = os.environ.get("PGDP_TEST_POSTGRES_URL", "")
_HAS_PSYCOPG = importlib.util.find_spec("psycopg") is not None
_PG_TABLES = ("system_defaults", "projects", "jobs", "page_stages", "page_text")


def _integrity_errors() -> tuple[type[Exception], ...]:
    if not _HAS_PSYCOPG:
        return (sqlite3.IntegrityError,)
    import psycopg

    return (sqlite3.IntegrityError, psycopg.IntegrityError)


_INTEGRITY_ERRORS = _integrity_errors()


@pytest.fixture(params=["sqlite", "postgres"])
async def db(request: pytest.FixtureRequest, tmp_path: Path) -> AsyncIterator[IDatabase]:
    if request.param == "sqlite":
        sqlite_db = SqliteDatabase(f"sqlite:///{(tmp_path / 'contract.db').as_posix()}")
        await sqlite_db.initialize()
        yield sqlite_db
        await sqlite_db.close()
        return
    if not _PG_URL:
        pytest.skip("PGDP_TEST_POSTGRES_URL is not set")
    if not _HAS_PSYCOPG:
        pytest.skip("the [postgres] extra is not installed")
    import psycopg

    from pdomain_prep_for_pgdp.adapters.database.postgres import PostgresDatabase

    # Start each case from an empty schema; initialize() recreates it.
    async with await psycopg.AsyncConnection.connect(_PG_URL, autocommit=True) as conn:
        _ = await conn.execute(f"DROP TABLE IF EXISTS {', '.join(_PG_TABLES)}")
    pg_db = PostgresDatabase(_PG_URL)
    await pg_db.initialize()
    yield pg_db
    await pg_db.close()


def _stage(
    page_id: str = "0000",
    stage_id: str = "threshold",
    status: PageStageStatus = PageStageStatus.not_run,
    project_id: str = "p1",
    **extra: object,
) -> PageStageState:
    return PageStageState.model_validate(
        {
            "project_id": project_id,
            "page_id": page_id,
            "stage_id": stage_id,
            "status": status,
            **extra,
        }
    )


def _project(project_id: str = "p1", owner_id: str = "default") -> Project:
    now = datetime.now(UTC)
    return Project(
        id=project_id,
        owner_id=owner_id,
        name=project_id,
        created_at=now,
        updated_at=now,
        status=ProjectStatus.processing,
        page_count=1,
        proof_page_count=1,
        config=ProjectConfig(book_name=project_id, source_uri=""),
        storage_prefix=f"projects/{project_id}/",
    )


def _job(job_id: str, owner_id: str) -> Job:
    return Job(
        id=job_id,
        owner_id=owner_id,
        project_id="p1",
        type=JobType.unzip,
        status=JobStatus.queued,
        created_at=datetime.now(UTC),
    )


# ── Protocol conformance (no database needed) ────────────────────────────────


def test_postgres_adapter_defines_every_idatabase_method() -> None:
    """Checked from source, so it runs without the [postgres] extra installed."""
    source = Path(postgres_module_spec_origin()).read_text(encoding="utf-8")
    adapter = next(
        node
        for node in ast.parse(source).body
        if isinstance(node, ast.ClassDef) and node.name == "PostgresDatabase"
    )
    defined = {node.name for node in adapter.body if isinstance(node, ast.AsyncFunctionDef)}
    protocol_methods = {
        name for name, member in inspect.getmembers(IDatabase) if inspect.iscoroutinefunction(member)
    }
    assert sorted(protocol_methods - defined) == []


def postgres_module_spec_origin() -> str:
    spec = importlib.util.find_spec("pdomain_prep_for_pgdp.adapters.database.postgres")
    assert spec is not None
    assert spec.origin is not None
    return spec.origin


# ── Page stages ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_page_stage_round_trip_keeps_every_field(db: IDatabase) -> None:
    state = _stage(
        status=PageStageStatus.clean,
        stage_version=3,
        config_hash="cfg",
        input_hash="in",
        artifact_key="projects/p1/pages/0000/stages/threshold/output.png",
        last_run_at=1_700_000_000.5,
        duration_ms=42,
        error_message=None,
        job_id="job-1",
    )
    await db.put_page_stage(state)
    assert await db.get_page_stage("p1", "0000", "threshold") == state
    assert await db.get_page_stage("p1", "0000", "ocr") is None


@pytest.mark.asyncio
async def test_put_page_stage_replaces_the_row(db: IDatabase) -> None:
    await db.put_page_stage(_stage(status=PageStageStatus.running, job_id="j1"))
    await db.put_page_stage(_stage(status=PageStageStatus.failed, error_message="boom"))
    row = await db.get_page_stage("p1", "0000", "threshold")
    assert row is not None
    assert (row.status, row.error_message, row.job_id) == (PageStageStatus.failed, "boom", None)
    assert len(await db.list_page_stages_for_page("p1", "0000")) == 1


@pytest.mark.asyncio
async def test_page_stage_listings_filter_by_page_status_and_project(db: IDatabase) -> None:
    await db.put_page_stage(_stage("0000", "threshold", PageStageStatus.clean))
    await db.put_page_stage(_stage("0000", "ocr", PageStageStatus.dirty))
    await db.put_page_stage(_stage("0001", "threshold", PageStageStatus.dirty))
    await db.put_page_stage(_stage("0000", "threshold", PageStageStatus.dirty, project_id="p2"))

    def keys(rows: list[PageStageState]) -> set[tuple[str, str]]:
        return {(r.page_id, r.stage_id) for r in rows}

    assert keys(await db.list_page_stages_for_page("p1", "0000")) == {("0000", "threshold"), ("0000", "ocr")}
    assert keys(await db.list_page_stages_by_status("p1", PageStageStatus.dirty)) == {
        ("0000", "ocr"),
        ("0001", "threshold"),
    }
    assert keys(await db.list_page_stages_by_project("p1")) == {
        ("0000", "threshold"),
        ("0000", "ocr"),
        ("0001", "threshold"),
    }


@pytest.mark.asyncio
async def test_delete_page_stages_for_page_only_drops_that_page(db: IDatabase) -> None:
    await db.put_page_stage(_stage("0000"))
    await db.put_page_stage(_stage("0001"))
    await db.delete_page_stages_for_page("p1", "0000")
    assert await db.list_page_stages_for_page("p1", "0000") == []
    assert len(await db.list_page_stages_for_page("p1", "0001")) == 1


@pytest.mark.asyncio
async def test_init_page_stages_inserts_each_stage_once(db: IDatabase) -> None:
    await db.put_page_stage(_stage("0000", "threshold", PageStageStatus.clean))
    inserted = await db.init_page_stages_for_page("p1", "0000")
    assert inserted == len(V2_PAGE_STAGE_IDS) - 1
    assert await db.init_page_stages_for_page("p1", "0000") == 0
    rows = await db.list_page_stages_for_page("p1", "0000")
    assert {r.stage_id for r in rows} == set(V2_PAGE_STAGE_IDS)
    kept = await db.get_page_stage("p1", "0000", "threshold")
    assert kept is not None
    assert kept.status == PageStageStatus.clean
    new_row = await db.get_page_stage("p1", "0000", "ocr")
    assert new_row is not None
    assert (new_row.status, new_row.stage_version) == (PageStageStatus.not_run, 1)


@pytest.mark.asyncio
async def test_unknown_stage_id_is_rejected(db: IDatabase) -> None:
    with pytest.raises(_INTEGRITY_ERRORS):
        await db.put_page_stage(
            PageStageState.model_construct(
                project_id="p1",
                page_id="0000",
                stage_id="not_a_stage",
                status=PageStageStatus.not_run,
                stage_version=1,
            )
        )


@pytest.mark.asyncio
async def test_delete_project_drops_its_page_stages(db: IDatabase) -> None:
    await db.put_project(_project("p1"))
    await db.put_page_stage(_stage("0000"))
    await db.put_page_stage(_stage("0000", project_id="p2"))
    await db.delete_project("p1")
    assert await db.get_project("p1") is None
    assert await db.list_page_stages_by_project("p1") == []
    assert len(await db.list_page_stages_by_project("p2")) == 1


# ── Full-text search ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_search_finds_pages_in_one_project_with_counts_and_paging(db: IDatabase) -> None:
    await db.upsert_page_text("p1", "0000", 0, "The quick brown fox jumps.")
    await db.upsert_page_text("p1", "0001", 1, "A fox, a fox, and another fox in the den.")
    await db.upsert_page_text("p1", "0002", 2, "Nothing to see here.")
    await db.upsert_page_text("p2", "0000", 0, "A fox in another book.")

    results, total = await db.search("p1", "fox")
    assert total == 2
    assert {r.page_id for r in results} == {"0000", "0001"}
    assert results[0].page_id == "0001"  # more matches rank first
    assert all(0.0 < r.score <= 1.0 for r in results)
    assert all("fox" in r.snippet.lower() for r in results)
    assert {r.idx0 for r in results} == {0, 1}

    page_two, total_two = await db.search("p1", "fox", limit=1, offset=1)
    assert total_two == 2
    assert [r.page_id for r in page_two] == [results[1].page_id]


@pytest.mark.asyncio
async def test_upsert_page_text_replaces_earlier_text(db: IDatabase) -> None:
    await db.upsert_page_text("p1", "0000", 0, "uniquetoken here")
    await db.upsert_page_text("p1", "0000", 0, "replacement words")
    assert (await db.search("p1", "uniquetoken"))[1] == 0
    results, total = await db.search("p1", "replacement")
    assert total == 1
    assert results[0].page_id == "0000"


@pytest.mark.asyncio
async def test_search_matches_long_s_as_s(db: IDatabase) -> None:
    await db.upsert_page_text("p1", "0000", 0, "the \u017fea was calm")
    results, total = await db.search("p1", "sea")
    assert total == 1
    assert results[0].page_id == "0000"


# ── Owners ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_distinct_owner_ids(db: IDatabase) -> None:
    assert await db.list_distinct_owner_ids() == ["default"]
    await db.put_job(_job("j1", "alice"))
    await db.put_job(_job("j2", "bob"))
    await db.put_job(_job("j3", "alice"))
    assert sorted(await db.list_distinct_owner_ids()) == ["alice", "bob"]
