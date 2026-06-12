"""M1 §D — `pgdp-prep reindex` + `--heal` CLI.

Spec: `docs/specs/pipeline-task-model.md` §"Dual-write reconciliation"
(Q1-followup). M1 §D scope.

Read-only mode exits 0 when clean, exit 2 on drift. ``--heal`` mutates
(quarantine orphans, mark missing rows failed, mark hash-mismatch rows
dirty) and exits 0.

Tests stub out the on-disk + DB state via the M1 §C writer
``commit_stage_artifact`` so each test starts from a known-good clean
baseline.
"""

from __future__ import annotations

import io
import json
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import pytest

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.cli.reindex import _parse_args, _run
from pdomain_prep_for_pgdp.core.models import (
    PageRecord,
    PageStageStatus,
    Project,
    ProjectConfig,
    ProjectStatus,
)
from pdomain_prep_for_pgdp.core.pipeline.page_stage_writer import (
    commit_stage_artifact,
    stage_artifact_path,
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
        storage_prefix=f"projects/{project_id}/",
    )


async def _prep_clean_state(tmp_path: Path) -> tuple[SqliteDatabase, Path]:
    """Seed one project + one page with one clean stage artifact."""
    data_root = tmp_path / "data"
    data_root.mkdir(parents=True, exist_ok=True)
    db = SqliteDatabase(f"sqlite:///{(tmp_path / 'state.db').as_posix()}")
    await db.initialize()
    await db.put_project(_project())
    seed_pages_in_store(
        tmp_path / "data", "proj1", [PageRecord(project_id="proj1", idx0=0, prefix="p001", source_stem="src")]
    )
    # Lazy-init: insert all 22 not-run rows, then commit one stage.
    await db.init_page_stages_for_page("proj1", "0000")
    await commit_stage_artifact(
        data_root=data_root,
        database=db,
        project_id="proj1",
        page_id="0000",
        stage_id="threshold",
        artifact_bytes=b"hello",
    )
    return db, data_root


# ─── _parse_args ────────────────────────────────────────────────────────────


def test_parse_args_defaults() -> None:
    args = _parse_args([])
    assert args.project_id is None
    assert args.heal is False
    assert args.json is False
    assert args.owner_id == "default"
    assert args.all_users is False


def test_parse_args_explicit() -> None:
    args = _parse_args(["proj1", "--heal", "--json"])
    assert args.project_id == "proj1"
    assert args.heal is True
    assert args.json is True


# ─── Read-only — clean ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_reindex_clean_exits_zero(tmp_path: Path) -> None:
    db, data_root = await _prep_clean_state(tmp_path)
    await db.close()

    args = _parse_args([])
    args.data_root = data_root
    # Override the settings-derived db url so we point at the seed DB.
    import pdomain_prep_for_pgdp.cli.reindex as r
    from pdomain_prep_for_pgdp.settings import Settings

    monkey_settings = Settings(
        data_root=data_root,
        config_dir=tmp_path / "config",
        database_url=f"sqlite:///{(tmp_path / 'state.db').as_posix()}",
        gpu_backend="cpu",
        auth_mode="none",
        dispatch_interval_seconds=0,
    )
    saved = r.Settings
    r.Settings = lambda: monkey_settings  # type: ignore[assignment,misc]
    try:
        buf = io.StringIO()
        rc = await _run(args, stdout=buf)
        assert rc == 0
        assert "0 orphan files" in buf.getvalue()
    finally:
        r.Settings = saved


# ─── Read-only — drift detected ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_reindex_drift_exits_two(tmp_path: Path) -> None:
    db, data_root = await _prep_clean_state(tmp_path)
    # Drop the stage dir to simulate partial loss.
    page_dir = data_root / "projects" / "proj1" / "pages" / "0000"
    import shutil

    shutil.rmtree(page_dir / "stages")
    await db.close()

    args = _parse_args([])
    args.data_root = data_root
    import pdomain_prep_for_pgdp.cli.reindex as r
    from pdomain_prep_for_pgdp.settings import Settings

    monkey_settings = Settings(
        data_root=data_root,
        config_dir=tmp_path / "config",
        database_url=f"sqlite:///{(tmp_path / 'state.db').as_posix()}",
        gpu_backend="cpu",
        auth_mode="none",
        dispatch_interval_seconds=0,
    )
    saved = r.Settings
    r.Settings = lambda: monkey_settings  # type: ignore[assignment,misc]
    try:
        buf = io.StringIO()
        rc = await _run(args, stdout=buf)
        assert rc == 2, f"expected exit 2 on drift, got {rc}"
        assert "missing" in buf.getvalue().lower()
    finally:
        r.Settings = saved


# ─── Heal — missing files ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_reindex_heal_marks_missing_failed_and_cascades_dirty(tmp_path: Path) -> None:
    """rm -rf stages/ + --heal: target row -> failed; descendants of clean upstream stay clean.

    The threshold stage was the only `clean` row; after deletion + heal,
    its row becomes `failed`. Descendants of `threshold` that were also
    clean would cascade dirty — but since none were clean (only
    `threshold` was committed), no descendants change status.
    """
    db, data_root = await _prep_clean_state(tmp_path)
    page_dir = data_root / "projects" / "proj1" / "pages" / "0000"
    import shutil

    shutil.rmtree(page_dir / "stages")
    # Re-open db; close above for symmetry not required but matches the
    # CLI flow which opens its own connection. Skipped here for speed.

    args = _parse_args(["--heal"])
    args.data_root = data_root
    import pdomain_prep_for_pgdp.cli.reindex as r
    from pdomain_prep_for_pgdp.settings import Settings

    monkey_settings = Settings(
        data_root=data_root,
        config_dir=tmp_path / "config",
        database_url=f"sqlite:///{(tmp_path / 'state.db').as_posix()}",
        gpu_backend="cpu",
        auth_mode="none",
        dispatch_interval_seconds=0,
    )
    saved = r.Settings
    r.Settings = lambda: monkey_settings  # type: ignore[assignment,misc]
    try:
        buf = io.StringIO()
        rc = await _run(args, stdout=buf)
        assert rc == 0
        assert "marked failed" in buf.getvalue()
    finally:
        r.Settings = saved
    await db.close()

    # Re-open a fresh connection to verify the row state.
    db2 = SqliteDatabase(f"sqlite:///{(tmp_path / 'state.db').as_posix()}")
    await db2.initialize()
    threshold = await db2.get_page_stage("proj1", "0000", "threshold")
    assert threshold is not None
    assert threshold.status == PageStageStatus.failed
    assert threshold.error_message == "reconcile: file missing at expected path"
    await db2.close()


@pytest.mark.asyncio
async def test_reindex_heal_cascades_descendants_dirty(tmp_path: Path) -> None:
    """Cascade: when a clean upstream row is healed, clean descendants become dirty."""
    db, data_root = await _prep_clean_state(tmp_path)
    # Add a downstream `clean` row by committing a fake artifact for `deskew`,
    # the v2 direct child of `threshold` (v1 used `invert`, folded into
    # `threshold` in v2; the next page-scoped descendant is `deskew`).
    await commit_stage_artifact(
        data_root=data_root,
        database=db,
        project_id="proj1",
        page_id="0000",
        stage_id="deskew",
        artifact_bytes=b"dsk",
    )
    # Now nuke threshold's file → it'll go failed; deskew (descendant)
    # is clean, should cascade to dirty.
    threshold_path = stage_artifact_path(data_root, "proj1", "0000", "threshold")
    threshold_path.unlink()
    await db.close()

    args = _parse_args(["--heal"])
    args.data_root = data_root
    import pdomain_prep_for_pgdp.cli.reindex as r
    from pdomain_prep_for_pgdp.settings import Settings

    monkey_settings = Settings(
        data_root=data_root,
        config_dir=tmp_path / "config",
        database_url=f"sqlite:///{(tmp_path / 'state.db').as_posix()}",
        gpu_backend="cpu",
        auth_mode="none",
        dispatch_interval_seconds=0,
    )
    saved = r.Settings
    r.Settings = lambda: monkey_settings  # type: ignore[assignment,misc]
    try:
        buf = io.StringIO()
        rc = await _run(args, stdout=buf)
        assert rc == 0
    finally:
        r.Settings = saved

    db2 = SqliteDatabase(f"sqlite:///{(tmp_path / 'state.db').as_posix()}")
    await db2.initialize()
    threshold = await db2.get_page_stage("proj1", "0000", "threshold")
    deskew = await db2.get_page_stage("proj1", "0000", "deskew")
    assert threshold is not None
    assert threshold.status == PageStageStatus.failed
    assert deskew is not None and deskew.status == PageStageStatus.dirty, (
        f"expected deskew to cascade to dirty, got {deskew.status}"
    )
    await db2.close()


@pytest.mark.asyncio
async def test_reindex_after_heal_is_clean(tmp_path: Path) -> None:
    """Re-running `reindex` after `--heal` exits 0."""
    db, data_root = await _prep_clean_state(tmp_path)
    import shutil

    shutil.rmtree(data_root / "projects" / "proj1" / "pages" / "0000" / "stages")
    await db.close()

    args = _parse_args(["--heal"])
    args.data_root = data_root
    import pdomain_prep_for_pgdp.cli.reindex as r
    from pdomain_prep_for_pgdp.settings import Settings

    monkey_settings = Settings(
        data_root=data_root,
        config_dir=tmp_path / "config",
        database_url=f"sqlite:///{(tmp_path / 'state.db').as_posix()}",
        gpu_backend="cpu",
        auth_mode="none",
        dispatch_interval_seconds=0,
    )
    saved = r.Settings
    r.Settings = lambda: monkey_settings  # type: ignore[assignment,misc]
    try:
        rc1 = await _run(_parse_args(["--heal"]), stdout=io.StringIO())
        # Force same data_root for the read-only re-check.
        args2 = _parse_args([])
        args2.data_root = data_root
        rc2 = await _run(args2, stdout=io.StringIO())
        assert rc1 == 0
        assert rc2 == 0
    finally:
        r.Settings = saved


# ─── Heal — orphan files ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_reindex_heal_quarantines_orphans(tmp_path: Path) -> None:
    """Drop a bogus file under pages/0000/stages/<known>/, --heal moves it."""
    db, data_root = await _prep_clean_state(tmp_path)
    bogus_path = data_root / "projects" / "proj1" / "pages" / "0000" / "stages" / "deskew" / "output.png"
    bogus_path.parent.mkdir(parents=True, exist_ok=True)
    bogus_path.write_bytes(b"junk")
    await db.close()

    args = _parse_args(["--heal"])
    args.data_root = data_root
    import pdomain_prep_for_pgdp.cli.reindex as r
    from pdomain_prep_for_pgdp.settings import Settings

    monkey_settings = Settings(
        data_root=data_root,
        config_dir=tmp_path / "config",
        database_url=f"sqlite:///{(tmp_path / 'state.db').as_posix()}",
        gpu_backend="cpu",
        auth_mode="none",
        dispatch_interval_seconds=0,
    )
    saved = r.Settings
    r.Settings = lambda: monkey_settings  # type: ignore[assignment,misc]
    try:
        rc = await _run(args, stdout=io.StringIO())
        assert rc == 0
    finally:
        r.Settings = saved

    # Original gone; quarantine populated.
    assert not bogus_path.exists()
    quar_root = data_root / "projects" / "proj1" / ".orphan-stage-artifacts"
    quarantined = quar_root / "pages" / "0000" / "stages" / "deskew" / "output.png"
    assert quarantined.exists(), f"orphan should be at {quarantined}"
    assert quarantined.read_bytes() == b"junk"
    # Manifest entry exists.
    manifest = quar_root / "manifest.jsonl"
    assert manifest.exists()
    lines = manifest.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1
    entry = json.loads(lines[0])
    assert entry["stage_id"] == "deskew"
    # Either reason is acceptable: "no-row" if init_page_stages_for_page
    # never ran for this page, "non-clean-row" if the row exists but is
    # at status not-run/dirty/failed (still an orphan since only `clean`
    # rows promise files).
    assert entry["reason"] in {"no-row", "non-clean-row"}


# ─── Heal — hash mismatch (file untouched) ──────────────────────────────────


@pytest.mark.asyncio
async def test_reindex_heal_marks_hash_mismatch_dirty_keeps_file(tmp_path: Path) -> None:
    db, data_root = await _prep_clean_state(tmp_path)
    expected = stage_artifact_path(data_root, "proj1", "0000", "threshold")
    expected.write_bytes(b"tampered")  # divergence
    await db.close()

    args = _parse_args(["--heal"])
    args.data_root = data_root
    import pdomain_prep_for_pgdp.cli.reindex as r
    from pdomain_prep_for_pgdp.settings import Settings

    monkey_settings = Settings(
        data_root=data_root,
        config_dir=tmp_path / "config",
        database_url=f"sqlite:///{(tmp_path / 'state.db').as_posix()}",
        gpu_backend="cpu",
        auth_mode="none",
        dispatch_interval_seconds=0,
    )
    saved = r.Settings
    r.Settings = lambda: monkey_settings  # type: ignore[assignment,misc]
    try:
        rc = await _run(args, stdout=io.StringIO())
        assert rc == 0
    finally:
        r.Settings = saved

    # File untouched.
    assert expected.read_bytes() == b"tampered"
    db2 = SqliteDatabase(f"sqlite:///{(tmp_path / 'state.db').as_posix()}")
    await db2.initialize()
    threshold = await db2.get_page_stage("proj1", "0000", "threshold")
    assert threshold is not None
    assert threshold.status == PageStageStatus.dirty
    await db2.close()


# ─── Project-scoped variant ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_reindex_project_id_argument_scopes_scan(tmp_path: Path) -> None:
    """reindex <project_id> only scans that project."""
    db, data_root = await _prep_clean_state(tmp_path)
    # Add a second project with drift.
    await db.put_project(_project("proj2"))
    seed_pages_in_store(
        tmp_path / "data", "proj2", [PageRecord(project_id="proj2", idx0=0, prefix="p001", source_stem="src")]
    )
    bogus = data_root / "projects" / "proj2" / "pages" / "0000" / "stages" / "auto_deskew" / "output.png"
    bogus.parent.mkdir(parents=True, exist_ok=True)
    bogus.write_bytes(b"junk")
    await db.close()

    args = _parse_args(["proj1"])
    args.data_root = data_root
    import pdomain_prep_for_pgdp.cli.reindex as r
    from pdomain_prep_for_pgdp.settings import Settings

    monkey_settings = Settings(
        data_root=data_root,
        config_dir=tmp_path / "config",
        database_url=f"sqlite:///{(tmp_path / 'state.db').as_posix()}",
        gpu_backend="cpu",
        auth_mode="none",
        dispatch_interval_seconds=0,
    )
    saved = r.Settings
    r.Settings = lambda: monkey_settings  # type: ignore[assignment,misc]
    try:
        rc = await _run(args, stdout=io.StringIO())
        assert rc == 0, "proj1 alone is clean"
    finally:
        r.Settings = saved

    # File still in proj2 (untouched because we only scanned proj1).
    assert bogus.exists()


# ─── Subcommand dispatch via __main__ ───────────────────────────────────────


def test_main_dispatches_reindex_subcommand(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """`pgdp-prep reindex` from the top-level entry must reach reindex.main."""
    from pdomain_prep_for_pgdp import __main__ as m

    called: dict[str, list[str]] = {}

    def _fake_main(argv: list[str]) -> int:
        called["argv"] = argv
        return 7

    monkeypatch.setattr("pdomain_prep_for_pgdp.cli.reindex.main", _fake_main)
    rc = m.main(["reindex", "--heal", "proj1"])
    assert rc == 7
    assert called["argv"] == ["--heal", "proj1"]


def test_main_dispatches_unknown_subcommand_falls_through(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`pgdp-prep --version` (no subcommand) still works after dispatcher addition."""
    from pdomain_prep_for_pgdp import __main__ as m

    rc = m.main(["--version"])
    assert rc == 0


# ─── Stage versioning: --heal marks stale-version rows dirty ────────────────


@pytest.mark.asyncio
async def test_reindex_heal_marks_stale_version_rows_dirty(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """reindex --heal marks clean rows with stale stage_version as dirty.

    Spec: docs/specs/pipeline-task-model.md §"Stage versioning (Q4 lock)".
    """
    import pdomain_prep_for_pgdp.cli.reindex as r
    import pdomain_prep_for_pgdp.core.pipeline.stage_dag as _stage_dag_mod
    from pdomain_prep_for_pgdp.settings import Settings

    db, data_root = await _prep_clean_state(tmp_path)
    # _prep_clean_state seeds "threshold" as clean at stage_version=1.
    row = await db.get_page_stage("proj1", "0000", "threshold")
    assert row is not None
    assert row.status == PageStageStatus.clean
    assert row.stage_version == 1
    await db.close()

    # Bump V2_STAGE_VERSIONS["threshold"] to 2 so the row is stale.
    original = dict(_stage_dag_mod.V2_STAGE_VERSIONS)
    monkeypatch.setattr(_stage_dag_mod, "V2_STAGE_VERSIONS", dict(original, threshold=2))

    args = _parse_args(["--heal"])
    args.data_root = data_root
    monkey_settings = Settings(
        data_root=data_root,
        config_dir=tmp_path / "config",
        database_url=f"sqlite:///{(tmp_path / 'state.db').as_posix()}",
        gpu_backend="cpu",
        auth_mode="none",
        dispatch_interval_seconds=0,
    )
    saved = r.Settings
    r.Settings = lambda: monkey_settings  # type: ignore[assignment,misc]
    try:
        buf = io.StringIO()
        rc = await _run(args, stdout=buf)
        assert rc == 0
    finally:
        r.Settings = saved

    db2 = SqliteDatabase(f"sqlite:///{(tmp_path / 'state.db').as_posix()}")
    await db2.initialize()
    threshold = await db2.get_page_stage("proj1", "0000", "threshold")
    assert threshold is not None
    assert threshold.status == PageStageStatus.dirty, (
        f"reindex --heal should mark stale-version clean row as dirty, got {threshold.status}"
    )
    await db2.close()
