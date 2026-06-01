"""M4 -- `pgdp-prep migrate-projects --force-rebuild` CLI.

Spec: docs/specs/2026-05-13-m4-migration-disk-cost-design.md §Force-rebuild CLI

Tests assert:
- --force-rebuild deletes page_stages rows + on-disk stages dir, re-inserts dirty rows.
- Source/thumbnail files in the page dir survive.
- --page-idx narrows the rebuild to a single page.
- Omitting project_id rebuilds all projects.
- Summary line is printed on stdout.
"""

from __future__ import annotations

import io
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import pytest

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.cli.migrate_projects import _parse_args, _run
from pdomain_prep_for_pgdp.core.models import (
    PAGE_STAGE_IDS,
    PageProcessingStatus,
    PageRecord,
    PageStageStatus,
    PipelineState,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from tests.fixtures.seed_pages import seed_pages_in_store

if TYPE_CHECKING:
    from pathlib import Path


def _project(project_id: str = "proj1") -> Project:
    now = datetime.now(UTC)
    return Project(
        id=project_id,
        owner_id="default",
        name=project_id,
        created_at=now,
        updated_at=now,
        status=ProjectStatus.processing,
        page_count=1,
        proof_page_count=1,
        config=ProjectConfig(book_name=project_id, source_uri=""),
        pipeline_state=PipelineState(),
        storage_prefix=f"projects/{project_id}/",
    )


def _page(
    project_id: str = "proj1",
    idx0: int = 0,
    *,
    processing_status: PageProcessingStatus = PageProcessingStatus.complete,
) -> PageRecord:
    return PageRecord(
        project_id=project_id,
        idx0=idx0,
        prefix=f"p{idx0 + 1:03d}",
        source_stem="src",
        processing_status=processing_status,
    )


async def _seed_db(
    tmp_path: Path,
    *,
    project_id: str = "proj1",
    page_count: int = 1,
    processing_status: PageProcessingStatus = PageProcessingStatus.complete,
) -> tuple[SqliteDatabase, Path]:
    """Seed project + pages with not-run stage rows and on-disk stage artifacts."""
    data_root = tmp_path / "data"
    data_root.mkdir(parents=True, exist_ok=True)
    db = SqliteDatabase(f"sqlite:///{(tmp_path / 'state.db').as_posix()}")
    await db.initialize()
    await db.put_project(_project(project_id))
    pages = [_page(project_id, i, processing_status=processing_status) for i in range(page_count)]
    seed_pages_in_store(tmp_path / "data", project_id, pages)

    for page in pages:
        page_id = f"{page.idx0:04d}"
        await db.init_page_stages_for_page(project_id, page_id)
        # Create a stages/ dir with a dummy artifact file.
        stages_dir = data_root / "projects" / project_id / "pages" / page_id / "stages"
        stages_dir.mkdir(parents=True, exist_ok=True)
        (stages_dir / "threshold.png").write_bytes(b"fake artifact")
        # Create source + thumbnail files that must survive.
        page_dir = data_root / "projects" / project_id / "pages" / page_id
        (page_dir / "source.png").write_bytes(b"source image")
        (page_dir / "thumbnail.jpg").write_bytes(b"thumbnail")

    return db, data_root


def _make_settings(tmp_path: Path, db_path: Path, data_root: Path):
    from pdomain_prep_for_pgdp.settings import Settings

    return Settings(
        data_root=data_root,
        config_dir=tmp_path / "config",
        database_url=f"sqlite:///{db_path.as_posix()}",
        gpu_backend="cpu",
        auth_mode="none",
        dispatch_interval_seconds=0,
    )


def test_parse_args_defaults() -> None:
    args = _parse_args([])
    assert args.project_id is None
    assert args.force_rebuild is False
    assert args.page_idx is None
    assert args.owner_id == "default"
    assert args.all_users is False


def test_parse_args_force_rebuild() -> None:
    args = _parse_args(["proj1", "--force-rebuild", "--page-idx", "3"])
    assert args.project_id == "proj1"
    assert args.force_rebuild is True
    assert args.page_idx == 3


def test_parse_args_omit_project_force_rebuild() -> None:
    args = _parse_args(["--force-rebuild"])
    assert args.project_id is None
    assert args.force_rebuild is True


@pytest.mark.asyncio
async def test_force_rebuild_deletes_rows_and_reinits_dirty(tmp_path: Path) -> None:
    """Core bullet: deletes page_stages rows + stages dir, re-inserts as dirty."""
    db, data_root = await _seed_db(tmp_path)
    await db.close()

    import pdomain_prep_for_pgdp.cli.migrate_projects as m

    settings = _make_settings(tmp_path, tmp_path / "state.db", data_root)
    saved = m.Settings
    m.Settings = lambda: settings  # type: ignore[assignment,misc]
    try:
        args = _parse_args(["proj1", "--force-rebuild"])
        args.data_root = data_root
        out = io.StringIO()
        rc = await _run(args, stdout=out)
    finally:
        m.Settings = saved

    assert rc == 0

    # Verify DB state: all rows should now be dirty.
    db2 = SqliteDatabase(f"sqlite:///{(tmp_path / 'state.db').as_posix()}")
    await db2.initialize()
    try:
        rows = await db2.list_page_stages_for_page("proj1", "0000")
        assert len(rows) == len(PAGE_STAGE_IDS)
        assert all(r.status == PageStageStatus.dirty for r in rows)
    finally:
        await db2.close()


@pytest.mark.asyncio
async def test_force_rebuild_stages_dir_deleted(tmp_path: Path) -> None:
    """stages/ directory is removed; source + thumbnail survive."""
    db, data_root = await _seed_db(tmp_path)
    await db.close()

    import pdomain_prep_for_pgdp.cli.migrate_projects as m

    settings = _make_settings(tmp_path, tmp_path / "state.db", data_root)
    saved = m.Settings
    m.Settings = lambda: settings  # type: ignore[assignment,misc]
    try:
        args = _parse_args(["proj1", "--force-rebuild"])
        args.data_root = data_root
        await _run(args, stdout=io.StringIO())
    finally:
        m.Settings = saved

    page_dir = data_root / "projects" / "proj1" / "pages" / "0000"
    assert not (page_dir / "stages").exists(), "stages/ dir must be removed"
    assert (page_dir / "source.png").exists(), "source file must survive"
    assert (page_dir / "thumbnail.jpg").exists(), "thumbnail must survive"


@pytest.mark.asyncio
async def test_force_rebuild_summary_line(tmp_path: Path) -> None:
    """Summary line is printed to stdout."""
    db, data_root = await _seed_db(tmp_path, page_count=2)
    await db.close()

    import pdomain_prep_for_pgdp.cli.migrate_projects as m

    settings = _make_settings(tmp_path, tmp_path / "state.db", data_root)
    saved = m.Settings
    m.Settings = lambda: settings  # type: ignore[assignment,misc]
    try:
        args = _parse_args(["proj1", "--force-rebuild"])
        args.data_root = data_root
        out = io.StringIO()
        await _run(args, stdout=out)
    finally:
        m.Settings = saved

    summary = out.getvalue()
    assert "migrate-projects --force-rebuild:" in summary
    assert "1 project(s)" in summary
    assert "2 page(s)" in summary
    assert "MB freed" in summary


@pytest.mark.asyncio
async def test_force_rebuild_page_idx_narrows(tmp_path: Path) -> None:
    """--page-idx limits rebuild to one page; other pages untouched."""
    # Use pending (non-legacy) status so stage rows start as not_run.
    # --force-rebuild --page-idx 0 must flip page 0 -> dirty while leaving
    # page 1 at not_run, proving the page-idx filter is respected.
    db, data_root = await _seed_db(tmp_path, page_count=2, processing_status=PageProcessingStatus.pending)
    await db.close()

    import pdomain_prep_for_pgdp.cli.migrate_projects as m

    settings = _make_settings(tmp_path, tmp_path / "state.db", data_root)
    saved = m.Settings
    m.Settings = lambda: settings  # type: ignore[assignment,misc]
    try:
        args = _parse_args(["proj1", "--force-rebuild", "--page-idx", "0"])
        args.data_root = data_root
        out = io.StringIO()
        rc = await _run(args, stdout=out)
    finally:
        m.Settings = saved

    assert rc == 0

    db2 = SqliteDatabase(f"sqlite:///{(tmp_path / 'state.db').as_posix()}")
    await db2.initialize()
    try:
        rows0 = await db2.list_page_stages_for_page("proj1", "0000")
        rows1 = await db2.list_page_stages_for_page("proj1", "0001")
        assert all(r.status == PageStageStatus.dirty for r in rows0), "page 0 must be dirty"
        assert all(r.status == PageStageStatus.not_run for r in rows1), "page 1 must be untouched"
    finally:
        await db2.close()

    # stages dir of page 0 removed; page 1 untouched.
    assert not (data_root / "projects" / "proj1" / "pages" / "0000" / "stages").exists()
    assert (data_root / "projects" / "proj1" / "pages" / "0001" / "stages").exists()

    summary = out.getvalue()
    assert "1 page(s)" in summary


@pytest.mark.asyncio
async def test_force_rebuild_all_projects(tmp_path: Path) -> None:
    """Omitting project_id rebuilds all projects."""
    db_path = tmp_path / "state.db"
    data_root = tmp_path / "data"
    data_root.mkdir(parents=True, exist_ok=True)

    db = SqliteDatabase(f"sqlite:///{db_path.as_posix()}")
    await db.initialize()

    for pid in ("alpha", "beta"):
        await db.put_project(_project(pid))
        seed_pages_in_store(tmp_path / "data", pid, [_page(pid, 0)])
        await db.init_page_stages_for_page(pid, "0000")
        stages_dir = data_root / "projects" / pid / "pages" / "0000" / "stages"
        stages_dir.mkdir(parents=True, exist_ok=True)
        (stages_dir / "threshold.png").write_bytes(b"fake")

    await db.close()

    import pdomain_prep_for_pgdp.cli.migrate_projects as m

    settings = _make_settings(tmp_path, db_path, data_root)
    saved = m.Settings
    m.Settings = lambda: settings  # type: ignore[assignment,misc]
    try:
        args = _parse_args(["--force-rebuild"])
        args.data_root = data_root
        out = io.StringIO()
        rc = await _run(args, stdout=out)
    finally:
        m.Settings = saved

    assert rc == 0

    db2 = SqliteDatabase(f"sqlite:///{db_path.as_posix()}")
    await db2.initialize()
    try:
        for pid in ("alpha", "beta"):
            rows = await db2.list_page_stages_for_page(pid, "0000")
            assert all(r.status == PageStageStatus.dirty for r in rows), f"{pid} rows must be dirty"
    finally:
        await db2.close()

    summary = out.getvalue()
    assert "2 project(s)" in summary
    assert "2 page(s)" in summary
