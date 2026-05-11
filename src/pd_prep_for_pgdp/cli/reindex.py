"""``pgdp-prep reindex`` — dual-write reconciliation between page_stages and disk.

Spec: `docs/specs/pipeline-task-model.md` §"Dual-write reconciliation"
(Q1-followup). M1 §D scope.

Read-only by default; ``--heal`` mutates:

- **orphan files** (on-disk under ``pages/<id>/stages/`` with no matching
  clean DB row, or with mismatched hash relative to the row): moved to
  ``<project_root>/.orphan-stage-artifacts/<original_relpath>`` with a
  manifest entry recording why and when.
- **missing files** (DB row says ``clean`` but no file at the expected
  path): row's status set to ``failed`` with
  ``error_message="reconcile: file missing at expected path"``.
  Downstream stages cascade to ``dirty`` per the standard dirty
  propagation (`compute_dirty_descendants`).
- **hash mismatches** (file exists + row exists clean + hashes differ):
  row's status set to ``dirty`` so the next run rewrites. The on-disk
  file is left untouched — the user might want to inspect it.

Exit codes:
- ``0`` — clean (read-only) OR heal completed successfully.
- ``2`` — drift detected (read-only mode only).
- non-zero on unhandled errors.

The CLI builds its own ``Settings`` + adapters (no FastAPI app), which
matches the local-mode contract: SQLite + filesystem, no auth, no GPU.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import shutil
import sys
import time
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import TextIO

from ..adapters.database.base import IDatabase
from ..adapters.database.sqlite import SqliteDatabase
from ..core.models import PageStageState, PageStageStatus, Project
from ..core.pipeline.page_stage_writer import (
    HashMismatch,
    MissingFile,
    OrphanFile,
    ReconcileReport,
    reconcile_page,
)
from ..core.pipeline.stage_dag import compute_dirty_descendants
from ..settings import Settings


@dataclass(frozen=True, slots=True)
class HealCounts:
    """Aggregate counts after a heal pass — printed in the heal summary."""

    orphans_moved: int = 0
    missing_marked_failed: int = 0
    hash_mismatches_marked_dirty: int = 0
    descendants_marked_dirty: int = 0


def _parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="pgdp-prep reindex",
        description=(
            "Reconcile the page_stages DB rows with on-disk artifacts. "
            "Read-only by default; pass --heal to apply corrective mutations."
        ),
    )
    p.add_argument(
        "project_id",
        nargs="?",
        default=None,
        help="Limit the scan to this project_id. Default: scan every project.",
    )
    p.add_argument(
        "--heal",
        action="store_true",
        help="Apply corrective mutations to drifted rows / files.",
    )
    p.add_argument(
        "--data-root",
        type=Path,
        default=None,
        help="Override the data_root (default: from PGDP_DATA_ROOT or ~/pgdp-projects).",
    )
    p.add_argument(
        "--owner-id",
        default="default",
        help="Restrict to projects owned by this user_id. Default: 'default' (matches local solo mode).",
    )
    p.add_argument(
        "--all-users",
        action="store_true",
        help="Scan every owner's projects (overrides --owner-id).",
    )
    p.add_argument(
        "--json",
        action="store_true",
        help="Emit a structured JSON report instead of the human table.",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(sys.argv[2:] if argv is None else argv)
    return asyncio.run(_run(args, stdout=sys.stdout))


async def _run(args: argparse.Namespace, *, stdout: TextIO) -> int:
    settings = Settings()
    data_root = (args.data_root or settings.data_root).expanduser().resolve()
    db = SqliteDatabase(settings.derived_database_url)
    await db.initialize()
    try:
        projects = await _resolve_projects(db, args)
        if args.project_id is not None and not projects:
            print(f"reindex: project not found: {args.project_id}", file=stdout)
            return 1

        all_reports: list[tuple[Project, str, ReconcileReport]] = []
        for project in projects:
            page_ids = _enumerate_page_ids_on_disk(data_root, project.id)
            for page_id in page_ids:
                report = await reconcile_page(
                    data_root=data_root,
                    database=db,
                    project_id=project.id,
                    page_id=page_id,
                )
                all_reports.append((project, page_id, report))

        any_drift = any(not r.is_clean for _, _, r in all_reports)

        if args.heal:
            counts = await _heal_all(db, data_root, all_reports)
            _print_heal_summary(all_reports, counts, json_mode=args.json, stdout=stdout)
            return 0

        _print_drift_report(all_reports, json_mode=args.json, stdout=stdout)
        return 2 if any_drift else 0
    finally:
        await db.close()


# ─── Helpers ────────────────────────────────────────────────────────────────


async def _resolve_projects(db: IDatabase, args: argparse.Namespace) -> list[Project]:
    """Resolve the set of projects the CLI should scan."""
    if args.project_id is not None:
        proj = await db.get_project(args.project_id)
        if proj is None:
            return []
        if not args.all_users and proj.owner_id != args.owner_id:
            return []
        return [proj]

    if args.all_users:
        # IDatabase has no list-all-projects helper today; fall back to
        # a known set of owner_ids from page_stages rows. For local-mode
        # the only owner is "default", but be explicit.
        owners = await _all_owner_ids(db)
        out: list[Project] = []
        for owner in owners:
            out.extend(await db.list_projects(owner, include_archived=True))
        return out

    return await db.list_projects(args.owner_id, include_archived=True)


async def _all_owner_ids(db: IDatabase) -> set[str]:
    """Best-effort enumeration of distinct owner_ids in the projects table."""
    # Cheap; the local single-user case has 1 owner.
    if isinstance(db, SqliteDatabase):

        def _go() -> set[str]:
            with db._cursor() as cur:
                rows = cur.execute("SELECT DISTINCT owner_id FROM projects").fetchall()
            return {r[0] for r in rows}

        return await db._run(_go)
    return {"default"}


def _enumerate_page_ids_on_disk(data_root: Path, project_id: str) -> list[str]:
    """Walk ``<data_root>/projects/<project_id>/pages/`` and return every page_id.

    Page IDs are directory names directly under ``pages/``. Split children
    encode their parents in ``<idx0>/splits/<suffix>``; for now (M1, no
    splits) we only walk one level deep and treat each directory there as
    a page_id. Future M2/M3 work will extend this to recursive splits.
    """
    pages_root = data_root / "projects" / project_id / "pages"
    if not pages_root.exists():
        return []
    out: list[str] = []
    for entry in sorted(pages_root.iterdir()):
        if not entry.is_dir():
            continue
        # Skip the .orphan-stage-artifacts quarantine.
        if entry.name.startswith("."):
            continue
        out.append(entry.name)
    return out


# ─── Reporting ──────────────────────────────────────────────────────────────


def _drift_summary(reports: Iterable[tuple[Project, str, ReconcileReport]]) -> dict[str, int]:
    o = m = h = 0
    pages = 0
    for _, _, r in reports:
        pages += 1
        o += len(r.orphan_files)
        m += len(r.missing_files)
        h += len(r.hash_mismatches)
    return {"pages": pages, "orphan_files": o, "missing_files": m, "hash_mismatches": h}


def _print_drift_report(
    reports: list[tuple[Project, str, ReconcileReport]],
    *,
    json_mode: bool,
    stdout: TextIO,
) -> None:
    if json_mode:
        out = {
            "summary": _drift_summary(reports),
            "details": [
                {
                    "project_id": p.id,
                    "page_id": page_id,
                    "orphans": [_orphan_to_dict(o) for o in r.orphan_files],
                    "missing": [_missing_to_dict(m) for m in r.missing_files],
                    "hash_mismatches": [_mismatch_to_dict(m) for m in r.hash_mismatches],
                }
                for p, page_id, r in reports
                if not r.is_clean
            ],
        }
        print(json.dumps(out, indent=2), file=stdout)
        return

    summary = _drift_summary(reports)
    print(
        f"reindex: scanned {summary['pages']} page(s); "
        f"{summary['orphan_files']} orphan files, "
        f"{summary['missing_files']} missing artifacts, "
        f"{summary['hash_mismatches']} hash mismatches",
        file=stdout,
    )
    for project, page_id, r in reports:
        if r.is_clean:
            continue
        print(f"  drift @ project={project.id} page={page_id}:", file=stdout)
        for o in r.orphan_files:
            print(f"    orphan ({o.reason}) {o.relative_key}", file=stdout)
        for m in r.missing_files:
            print(f"    missing {m.expected_path}", file=stdout)
        for m in r.hash_mismatches:
            print(
                f"    hash-mismatch {m.absolute_path} db={m.db_hash} disk={m.file_hash}",
                file=stdout,
            )


def _orphan_to_dict(o: OrphanFile) -> dict[str, object]:
    return {
        "stage_id": o.stage_id,
        "relative_key": o.relative_key,
        "reason": o.reason,
    }


def _missing_to_dict(m: MissingFile) -> dict[str, object]:
    return {
        "stage_id": m.stage_id,
        "expected_path": str(m.expected_path),
    }


def _mismatch_to_dict(m: HashMismatch) -> dict[str, object]:
    return {
        "stage_id": m.stage_id,
        "absolute_path": str(m.absolute_path),
        "db_hash": m.db_hash,
        "file_hash": m.file_hash,
    }


# ─── Heal ───────────────────────────────────────────────────────────────────


async def _heal_all(
    db: IDatabase,
    data_root: Path,
    reports: list[tuple[Project, str, ReconcileReport]],
) -> HealCounts:
    orphans_moved = 0
    missing_marked = 0
    mismatches_marked = 0
    descendants_marked = 0

    for project, page_id, report in reports:
        if report.is_clean:
            continue

        # Orphans → quarantine.
        for orphan in report.orphan_files:
            quarantined = _quarantine_orphan(data_root, project.id, orphan)
            _write_quarantine_manifest_entry(data_root, project.id, orphan, quarantined)
            orphans_moved += 1

        # Missing files → mark row failed + cascade dirty.
        for missing in report.missing_files:
            current = await db.get_page_stage(project.id, page_id, missing.stage_id)
            if current is None:
                continue
            updated = current.model_copy(
                update={
                    "status": PageStageStatus.failed,
                    "error_message": "reconcile: file missing at expected path",
                    "last_run_at": time.time(),
                }
            )
            await db.put_page_stage(updated)
            missing_marked += 1
            descendants_marked += await _mark_descendants_dirty(db, project.id, page_id, missing.stage_id)

        # Hash mismatches → mark row dirty (file untouched).
        for mismatch in report.hash_mismatches:
            current = await db.get_page_stage(project.id, page_id, mismatch.stage_id)
            if current is None:
                continue
            updated = current.model_copy(
                update={
                    "status": PageStageStatus.dirty,
                    "error_message": "reconcile: on-disk hash diverged from DB",
                    "last_run_at": time.time(),
                }
            )
            await db.put_page_stage(updated)
            mismatches_marked += 1
            descendants_marked += await _mark_descendants_dirty(db, project.id, page_id, mismatch.stage_id)

    return HealCounts(
        orphans_moved=orphans_moved,
        missing_marked_failed=missing_marked,
        hash_mismatches_marked_dirty=mismatches_marked,
        descendants_marked_dirty=descendants_marked,
    )


def _quarantine_root(data_root: Path, project_id: str) -> Path:
    return data_root / "projects" / project_id / ".orphan-stage-artifacts"


def _quarantine_orphan(data_root: Path, project_id: str, orphan: OrphanFile) -> Path:
    """Move an orphan file under ``.orphan-stage-artifacts/`` preserving the relpath.

    The quarantine root sits inside the project tree (peer to ``pages/``)
    so it travels with project archives and a future "trash empty" UI
    can find it without extra config.
    """
    qroot = _quarantine_root(data_root, project_id)
    # Strip the leading "projects/<id>/" so the relpath is page-tree-relative.
    rel_inside_project = orphan.relative_key
    expected_prefix = f"projects/{project_id}/"
    if rel_inside_project.startswith(expected_prefix):
        rel_inside_project = rel_inside_project[len(expected_prefix) :]
    target = qroot / rel_inside_project
    target.parent.mkdir(parents=True, exist_ok=True)
    if orphan.absolute_path.exists():
        # If the target name already exists from a prior heal, suffix with a counter.
        if target.exists():
            for n in range(1, 1000):
                alt = target.with_name(f"{target.name}.{n}")
                if not alt.exists():
                    target = alt
                    break
        shutil.move(str(orphan.absolute_path), str(target))
    return target


def _write_quarantine_manifest_entry(
    data_root: Path,
    project_id: str,
    orphan: OrphanFile,
    target: Path,
) -> None:
    """Append a JSON-line entry describing the quarantine action."""
    qroot = _quarantine_root(data_root, project_id)
    qroot.mkdir(parents=True, exist_ok=True)
    manifest = qroot / "manifest.jsonl"
    entry = {
        "ts": time.time(),
        "project_id": project_id,
        "page_id": orphan.page_id,
        "stage_id": orphan.stage_id,
        "reason": orphan.reason,
        "from": orphan.relative_key,
        "to": str(target.relative_to(data_root)),
    }
    with manifest.open("a", encoding="utf-8") as fp:
        fp.write(json.dumps(entry) + "\n")


async def _mark_descendants_dirty(
    db: IDatabase,
    project_id: str,
    page_id: str,
    stage_id: str,
) -> int:
    """Mark every downstream stage of ``stage_id`` on this page as dirty.

    Only rows that are currently `clean` get touched — `failed`, `running`,
    and `not-applicable` rows keep their status. `not-run` stays `not-run`.
    Returns the number of rows actually transitioned.
    """
    descendants = compute_dirty_descendants(stage_id)
    transitioned = 0
    for desc_id in descendants:
        current = await db.get_page_stage(project_id, page_id, desc_id)
        if current is None or current.status != PageStageStatus.clean:
            continue
        updated = current.model_copy(
            update={
                "status": PageStageStatus.dirty,
                "error_message": "reconcile: upstream changed",
                "last_run_at": time.time(),
            }
        )
        await db.put_page_stage(updated)
        transitioned += 1
    return transitioned


def _print_heal_summary(
    reports: list[tuple[Project, str, ReconcileReport]],
    counts: HealCounts,
    *,
    json_mode: bool,
    stdout: TextIO,
) -> None:
    if json_mode:
        out = {
            "healed": True,
            "scanned_pages": sum(1 for _ in reports),
            "orphans_moved": counts.orphans_moved,
            "missing_marked_failed": counts.missing_marked_failed,
            "hash_mismatches_marked_dirty": counts.hash_mismatches_marked_dirty,
            "descendants_marked_dirty": counts.descendants_marked_dirty,
        }
        print(json.dumps(out, indent=2), file=stdout)
        return

    print(
        f"reindex --heal: scanned {len(reports)} page(s); "
        f"{counts.orphans_moved} orphan(s) quarantined, "
        f"{counts.missing_marked_failed} row(s) marked failed, "
        f"{counts.hash_mismatches_marked_dirty} row(s) marked dirty, "
        f"{counts.descendants_marked_dirty} descendant(s) cascaded to dirty",
        file=stdout,
    )


# Re-export for tests that import these directly.
__all__ = [
    "HealCounts",
    "_enumerate_page_ids_on_disk",
    "_mark_descendants_dirty",
    "_parse_args",
    "_quarantine_orphan",
    "_run",
    "main",
]


# Used by tests to construct a fake DB row update without going through
# Pydantic's frozen-clone (PageStageState lacks `model_copy(update=)` at the
# Pydantic v2 default — but our subclass `ApiModel` inherits that method).
def _state_update(state: PageStageState, **changes: object) -> PageStageState:
    return state.model_copy(update=changes)
