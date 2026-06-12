"""Tests-first for `core.assign_prefixes`.

After Step 0 ingest, `PageRecord.prefix` is empty. After Step 3 (configure)
the user sets ranges + page types; calling `assign_prefixes` writes prefixes
onto every page in the proof range and persists them.

Locks in:
  - prefix shape matches `compute_prefix_v2` (v2 format: <seq:3-4><type><folio?>),
  - pages outside the proof range get prefix="" and ignore=True,
  - plate pages get the correct b/p/r suffix and don't consume a number,
  - patch is idempotent (running it twice produces the same result).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

import pytest

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.core.models import (
    PageRecord,
    PageType,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.core.page_service_helpers import list_page_records
from pdomain_prep_for_pgdp.core.page_store_factory import build_page_service
from pdomain_prep_for_pgdp.settings import Settings
from tests.fixtures.seed_pages import seed_pages_in_store

if TYPE_CHECKING:
    from pathlib import Path


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        host="127.0.0.1",
        port=8765,
        data_root=tmp_path / "data",
        config_dir=tmp_path / "config",
        storage_backend="filesystem",
        database_url=f"sqlite:///{(tmp_path / 's.db').as_posix()}",
        auth_mode="none",
        gpu_backend="cpu",
        dispatch_interval_seconds=0,
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
async def test_assign_prefixes_writes_frontmatter_and_bodymatter(db: SqliteDatabase, tmp_path: Path) -> None:
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
    settings = _settings(tmp_path)
    seed_pages_in_store(settings, project.id, pages)
    svc = build_page_service(settings.data_root, project.id)

    n = await assign_prefixes(project=project, page_service=svc)
    assert n == 5

    result = list_page_records(svc, project.id)
    by_idx = {p.idx0: p for p in result}
    # v2 format: <seq:3><type><folio>
    # proof_start=0, fm=0-1, bm=2-4, fm_nbr_start=1, bm_nbr_start=1
    # idx0=0: seq=0, type=f, folio=1 → "000f001"
    # idx0=1: seq=1, type=f, folio=2 → "001f002"
    # idx0=2: seq=2, type=p, folio=1 → "002p001"
    # idx0=3: seq=3, type=p, folio=2 → "003p002"
    # idx0=4: seq=4, type=p, folio=3 → "004p003"
    assert by_idx[0].prefix == "000f001"
    assert by_idx[1].prefix == "001f002"
    assert by_idx[2].prefix == "002p001"
    assert by_idx[3].prefix == "003p002"
    assert by_idx[4].prefix == "004p003"
    for p in result:
        assert p.ignore is False


@pytest.mark.asyncio
async def test_assign_prefixes_marks_pages_outside_range_ignored(db: SqliteDatabase, tmp_path: Path) -> None:
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
    settings = _settings(tmp_path)
    seed_pages_in_store(settings, project.id, [_page(project.id, i) for i in range(5)])
    svc = build_page_service(settings.data_root, project.id)

    await assign_prefixes(project=project, page_service=svc)
    result = list_page_records(svc, project.id)
    by_idx = {p.idx0: p for p in result}
    assert by_idx[0].ignore is True
    assert by_idx[0].prefix == ""
    assert by_idx[1].ignore is True
    assert by_idx[2].ignore is False
    assert "f" in by_idx[2].prefix  # v2: seq+f+folio (e.g. "000f001")
    assert by_idx[3].ignore is False
    assert "p" in by_idx[3].prefix  # v2: seq+p+folio (e.g. "001p001")
    assert by_idx[4].ignore is True


@pytest.mark.asyncio
async def test_assign_prefixes_handles_plate_suffix(db: SqliteDatabase, tmp_path: Path) -> None:
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
    settings = _settings(tmp_path)
    seed_pages_in_store(
        settings,
        project.id,
        [
            _page(project.id, 0),
            _page(project.id, 1),
            _page(project.id, 2, page_type=PageType.plate_p),
            _page(project.id, 3),
        ],
    )
    svc = build_page_service(settings.data_root, project.id)

    await assign_prefixes(project=project, page_service=svc)
    result = list_page_records(svc, project.id)
    by_idx = {p.idx0: p for p in result}
    # plate_p gets a "p" suffix (v2: seq+pp e.g. "002pp") and doesn't consume a body number.
    assert by_idx[2].prefix.endswith("p")
    # Numbering continues past the plate.
    # v2 bodymatter normal: seq+p+folio (e.g. "001p001") — contains "p" but doesn't end with "p"
    assert "p" in by_idx[1].prefix  # type letter present
    assert not by_idx[1].prefix.endswith("p")  # not a plate suffix
    assert "p" in by_idx[3].prefix
    assert not by_idx[3].prefix.endswith("p")


@pytest.mark.asyncio
async def test_assign_prefixes_is_idempotent(db: SqliteDatabase, tmp_path: Path) -> None:
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
    settings = _settings(tmp_path)
    seed_pages_in_store(settings, project.id, [_page(project.id, i) for i in range(3)])
    svc = build_page_service(settings.data_root, project.id)

    await assign_prefixes(project=project, page_service=svc)
    first = {p.idx0: p.prefix for p in list_page_records(svc, project.id)}
    await assign_prefixes(project=project, page_service=svc)
    second = {p.idx0: p.prefix for p in list_page_records(svc, project.id)}
    assert first == second
