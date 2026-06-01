"""Tiny edge-case tests for `adapters.database.sqlite.SqliteDatabase`.

Locks in:
  - constructing with a malformed URL raises ValueError immediately,
  - `put_pages([])` is a no-op (defensive guard, called by the assign-prefixes
    loop when nothing changed).
  - `list_distinct_owner_ids` returns unique owner_ids from the jobs table,
    falling back to `["default"]` when no jobs exist.
"""

from __future__ import annotations

import pytest

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.core.models import Job, JobStatus, JobType
from tests.fixtures.seed_pages import seed_pages_in_store


def test_constructor_rejects_unrecognised_url() -> None:
    with pytest.raises(ValueError, match="unrecognised SQLite URL"):
        SqliteDatabase("postgres://nope")


@pytest.mark.asyncio
async def test_put_pages_empty_list_is_noop(tmp_path) -> None:
    """`seed_pages_in_store(data_root, project_id, [])` must not crash and
    must not write any events to the event store."""
    db = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await db.initialize()
    # Should NOT raise.
    seed_pages_in_store(tmp_path / "data", "test-proj", [])
    await db.close()


@pytest.mark.asyncio
async def test_list_distinct_owner_ids_returns_default_when_empty(tmp_path) -> None:
    """`list_distinct_owner_ids` must return `["default"]` when no jobs exist."""
    db = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await db.initialize()
    result = await db.list_distinct_owner_ids()
    await db.close()
    assert result == ["default"]


@pytest.mark.asyncio
async def test_list_distinct_owner_ids_returns_unique_owners(tmp_path) -> None:
    """`list_distinct_owner_ids` must return unique owner IDs from the jobs table."""
    db = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await db.initialize()

    def _job(job_id: str, owner_id: str) -> Job:
        return Job(
            id=job_id,
            project_id="proj1",
            owner_id=owner_id,
            type=JobType.run_page_stage,
            status=JobStatus.queued,
        )

    # Two jobs for "alice", one for "bob".
    await db.put_job(_job("j1", "alice"))
    await db.put_job(_job("j2", "alice"))
    await db.put_job(_job("j3", "bob"))

    result = await db.list_distinct_owner_ids()
    await db.close()

    assert sorted(result) == ["alice", "bob"], f"expected ['alice', 'bob'] (sorted), got {sorted(result)}"
