"""Tests-first for `core.assign_prefixes`.

After Step 0 ingest, `PageRecord.prefix` is empty. After Step 3 (configure)
the user sets ranges + page types; calling `assign_prefixes` writes prefixes
onto every page in the proof range and persists them.

Locks in:
  - prefix shape matches `compute_prefix` (so spec-01 off-by-one is preserved),
  - pages outside the proof range get prefix="" and ignore=True,
  - plate pages get the correct b/p/r suffix and don't consume a number,
  - patch is idempotent (running it twice produces the same result).
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.core.models import (
    PageRecord,
    PageType,
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)


def _project(project_id: str = "p1", **config_kwargs) -> Project:
    now = datetime.now(UTC)
    return Project(
        id=project_id,
        owner_id="default",
        name="t",
        created_at=now,
        updated_at=now,
        status=ProjectStatus.configuring,
        page_count=0,
        proof_page_count=0,
        config=ProjectConfig(book_name="t", source_uri="", **config_kwargs),
        pipeline_state=PipelineState(),
        storage_prefix=f"projects/{project_id}/",
    )


def _page(project_id: str, idx0: int, page_type: PageType = PageType.normal) -> PageRecord:
    return PageRecord(
        project_id=project_id,
        idx0=idx0,
        prefix="",
        source_stem=f"src_{idx0:03d}",
        page_type=page_type,
    )


@pytest.fixture
async def db(tmp_path) -> SqliteDatabase:
    d = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await d.initialize()
    return d


@pytest.mark.asyncio
async def test_assign_prefixes_writes_frontmatter_and_bodymatter(db: SqliteDatabase) -> None:
    from pdomain_prep_for_pgdp.core.assign_prefixes import assign_prefixes

    project = _project(
        proof_start_idx0=0,
        proof_end_idx0=4,
        frontmatter_start_idx0=0,
        frontmatter_end_idx0=1,
        bodymatter_start_idx0=2,
        bodymatter_end_idx0=4,
    )
    await db.put_project(project)
    pages = [_page(project.id, i) for i in range(5)]
    await db.put_pages(pages)

    n = await assign_prefixes(project=project, database=db)
    assert n == 5

    pages, _, _ = await db.list_pages(project.id, None, 100)
    by_idx = {p.idx0: p for p in pages}
    # Fixed: first frontmatter page is f001.
    assert by_idx[0].prefix == "f001"
    assert by_idx[1].prefix == "f002"
    assert by_idx[2].prefix == "p000"
    assert by_idx[3].prefix == "p001"
    assert by_idx[4].prefix == "p002"
    for p in pages:
        assert p.ignore is False


@pytest.mark.asyncio
async def test_assign_prefixes_marks_pages_outside_range_ignored(
    db: SqliteDatabase,
) -> None:
    from pdomain_prep_for_pgdp.core.assign_prefixes import assign_prefixes

    project = _project(
        proof_start_idx0=2,
        proof_end_idx0=3,
        frontmatter_start_idx0=2,
        frontmatter_end_idx0=2,
        bodymatter_start_idx0=3,
        bodymatter_end_idx0=3,
    )
    await db.put_project(project)
    await db.put_pages([_page(project.id, i) for i in range(5)])

    await assign_prefixes(project=project, database=db)
    pages, _, _ = await db.list_pages(project.id, None, 100)
    by_idx = {p.idx0: p for p in pages}
    assert by_idx[0].ignore is True
    assert by_idx[0].prefix == ""
    assert by_idx[1].ignore is True
    assert by_idx[2].ignore is False
    assert by_idx[2].prefix.startswith("f")
    assert by_idx[3].ignore is False
    assert by_idx[3].prefix.startswith("p")
    assert by_idx[4].ignore is True


@pytest.mark.asyncio
async def test_assign_prefixes_handles_plate_suffix(db: SqliteDatabase) -> None:
    from pdomain_prep_for_pgdp.core.assign_prefixes import assign_prefixes

    project = _project(
        proof_start_idx0=0,
        proof_end_idx0=3,
        frontmatter_start_idx0=0,
        frontmatter_end_idx0=0,
        bodymatter_start_idx0=1,
        bodymatter_end_idx0=3,
    )
    await db.put_project(project)
    await db.put_pages(
        [
            _page(project.id, 0),
            _page(project.id, 1),
            _page(project.id, 2, page_type=PageType.plate_p),
            _page(project.id, 3),
        ]
    )

    await assign_prefixes(project=project, database=db)
    pages, _, _ = await db.list_pages(project.id, None, 100)
    by_idx = {p.idx0: p for p in pages}
    # plate_p gets a "p" suffix and doesn't consume a body number.
    assert by_idx[2].prefix.endswith("p")
    # Numbering continues past the plate.
    assert by_idx[1].prefix.startswith("p")
    assert not by_idx[1].prefix.endswith("p")
    assert by_idx[3].prefix.startswith("p")
    assert not by_idx[3].prefix.endswith("p")


@pytest.mark.asyncio
async def test_assign_prefixes_is_idempotent(db: SqliteDatabase) -> None:
    from pdomain_prep_for_pgdp.core.assign_prefixes import assign_prefixes

    project = _project(
        proof_start_idx0=0,
        proof_end_idx0=2,
        frontmatter_start_idx0=0,
        frontmatter_end_idx0=0,
        bodymatter_start_idx0=1,
        bodymatter_end_idx0=2,
    )
    await db.put_project(project)
    await db.put_pages([_page(project.id, i) for i in range(3)])

    await assign_prefixes(project=project, database=db)
    first = {p.idx0: p.prefix for p in (await db.list_pages(project.id, None, 100))[0]}
    await assign_prefixes(project=project, database=db)
    second = {p.idx0: p.prefix for p in (await db.list_pages(project.id, None, 100))[0]}
    assert first == second
