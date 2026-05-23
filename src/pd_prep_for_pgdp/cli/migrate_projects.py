"""``pgdp-prep migrate-projects`` — legacy-project detection and --force-rebuild.

Spec: docs/specs/2026-05-13-m4-migration-disk-cost-design.md §Force-rebuild CLI

Read-only mode (no flags): reports how many projects contain legacy pages
(``processing_status`` ∈ ``{complete, error, processing}``).

``--force-rebuild``: for each targeted page —
  1. Delete all ``page_stages`` DB rows.
  2. Delete on-disk ``pages/<page_id>/stages/`` directory (source/thumbnail left untouched).
  3. Re-insert 22 fresh ``dirty`` rows so the workbench shows the correct state immediately.

Prints a summary line:
    ``migrate-projects --force-rebuild: <N> project(s), <M> page(s), <X> MB freed``
"""

from __future__ import annotations

import argparse
import asyncio
import shutil
import sys
from pathlib import Path
from typing import Protocol, TextIO, cast

from pd_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pd_prep_for_pgdp.core.models import (
    PAGE_STAGE_IDS,
    PageProcessingStatus,
    PageRecord,
    PageStageState,
    PageStageStatus,
    Project,
)
from pd_prep_for_pgdp.core.pipeline.stage_dag import STAGE_VERSIONS
from pd_prep_for_pgdp.settings import Settings

LEGACY_STATUSES: frozenset[PageProcessingStatus] = frozenset(
    {PageProcessingStatus.complete, PageProcessingStatus.error, PageProcessingStatus.processing}
)


class _MigrateArgs(Protocol):
    project_id: str | None
    force_rebuild: bool
    page_idx: int | None
    data_root: Path | None
    owner_id: str
    all_users: bool


def _parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="pgdp-prep migrate-projects",
        description=(
            "Report legacy projects or force-rebuild their page_stages rows. "
            "Read-only by default; pass --force-rebuild to mutate."
        ),
    )
    _ = p.add_argument(
        "project_id",
        nargs="?",
        default=None,
        help="Limit to this project_id. Default: all projects.",
    )
    _ = p.add_argument(
        "--force-rebuild",
        action="store_true",
        help=(
            "Delete page_stages rows + on-disk stages dirs and re-synthesise "
            "dirty rows for each affected page."
        ),
    )
    _ = p.add_argument(
        "--page-idx",
        type=int,
        default=None,
        metavar="IDX0",
        help="Narrow --force-rebuild to a single page (0-based index).",
    )
    _ = p.add_argument(
        "--data-root",
        type=Path,
        default=None,
        help="Override data_root (default: from PGDP_DATA_ROOT or ~/pgdp-projects).",
    )
    _ = p.add_argument(
        "--owner-id",
        default="default",
        help="Restrict to projects owned by this user_id. Default: 'default'.",
    )
    _ = p.add_argument(
        "--all-users",
        action="store_true",
        help="Scan every owner's projects (overrides --owner-id).",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(sys.argv[2:] if argv is None else argv)
    return asyncio.run(_run(args, stdout=sys.stdout))


async def _run(args: argparse.Namespace, *, stdout: TextIO) -> int:
    typed_args = cast(_MigrateArgs, cast(object, args))
    settings = Settings()
    data_root = (typed_args.data_root or settings.data_root).expanduser().resolve()
    db = SqliteDatabase(settings.derived_database_url)
    await db.initialize()
    try:
        projects = await _resolve_projects(db, typed_args)
        if typed_args.project_id is not None and not projects:
            print(f"migrate-projects: project not found: {typed_args.project_id}", file=stdout)
            return 1

        if typed_args.force_rebuild:
            return await _force_rebuild(db, data_root, projects, typed_args, stdout=stdout)
        return await _report_legacy(db, projects, stdout=stdout)
    finally:
        await db.close()


# ─── Project / page resolution ───────────────────────────────────────────────


async def _resolve_projects(db: SqliteDatabase, args: _MigrateArgs) -> list[Project]:
    if args.project_id is not None:
        proj = await db.get_project(args.project_id)
        if proj is None:
            return []
        if not args.all_users and proj.owner_id != args.owner_id:
            return []
        return [proj]

    if args.all_users:
        owners = await _all_owner_ids(db)
        out: list[Project] = []
        for owner in owners:
            out.extend(await db.list_projects(owner, include_archived=True))
        return out

    return await db.list_projects(args.owner_id, include_archived=True)


async def _all_owner_ids(db: SqliteDatabase) -> set[str]:
    def _go() -> set[str]:
        with db._cursor() as cur:
            rows = cur.execute("SELECT DISTINCT owner_id FROM projects").fetchall()
        return {r[0] for r in rows}

    return await db._run(_go)


async def _all_pages_for_project(db: SqliteDatabase, project_id: str) -> list[PageRecord]:
    pages, _, _total = await db.list_pages(project_id, limit=99999)
    return pages


# ─── Force-rebuild ───────────────────────────────────────────────────────────


def _stages_dir(data_root: Path, project_id: str, page_id: str) -> Path:
    return data_root / "projects" / project_id / "pages" / page_id / "stages"


def _dir_size_bytes(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())


async def _init_dirty_stages_for_page(
    db: SqliteDatabase,
    project_id: str,
    page_id: str,
) -> None:
    for stage_id in PAGE_STAGE_IDS:
        state = PageStageState(
            project_id=project_id,
            page_id=page_id,
            stage_id=stage_id,
            status=PageStageStatus.dirty,
            stage_version=STAGE_VERSIONS.get(stage_id, 1),
        )
        await db.put_page_stage(state)


async def _force_rebuild(
    db: SqliteDatabase,
    data_root: Path,
    projects: list[Project],
    args: _MigrateArgs,
    *,
    stdout: TextIO,
) -> int:
    total_pages = 0
    total_bytes_freed = 0

    for project in projects:
        if args.page_idx is not None:
            page = await db.get_page(project.id, args.page_idx)
            pages = [page] if page is not None else []
        else:
            pages = await _all_pages_for_project(db, project.id)

        for page in pages:
            page_id = f"{page.idx0:04d}"
            stages = _stages_dir(data_root, project.id, page_id)

            total_bytes_freed += _dir_size_bytes(stages)
            await db.delete_page_stages_for_page(project.id, page_id)
            if stages.exists():
                shutil.rmtree(stages)
            await _init_dirty_stages_for_page(db, project.id, page_id)
            total_pages += 1

    mb_freed = total_bytes_freed / (1024 * 1024)
    print(
        f"migrate-projects --force-rebuild: {len(projects)} project(s), "
        f"{total_pages} page(s), {mb_freed:.1f} MB freed",
        file=stdout,
    )
    return 0


# ─── Read-only diagnostic ────────────────────────────────────────────────────


async def _report_legacy(
    db: SqliteDatabase,
    projects: list[Project],
    *,
    stdout: TextIO,
) -> int:
    legacy_count = 0
    for project in projects:
        pages = await _all_pages_for_project(db, project.id)
        if any(p.processing_status in LEGACY_STATUSES for p in pages):
            legacy_count += 1

    print(
        f"migrate-projects: {len(projects)} project(s) scanned, {legacy_count} legacy project(s) detected",
        file=stdout,
    )
    return 0
