"""M1 §C — `commit_stage_artifact` dual-write writer + `reconcile_page` detector.

Spec: `docs/specs/pipeline-task-model.md` §"Dual-write reconciliation"
(Q1-followup) and §"Persistence model" (Q3 + Q9). Q9 is "always fail
loudly": every failure path must raise ``StageArtifactWriteError`` and
leave the system in a fully-rolled-back state.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from pdomain_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pdomain_prep_for_pgdp.core.models import PageStageState, PageStageStatus
from pdomain_prep_for_pgdp.core.pipeline.page_stage_writer import (
    HashMismatch,
    MissingFile,
    OrphanFile,
    StageArtifactWriteError,
    commit_stage_artifact,
    compute_content_hash,
    reconcile_page,
    stage_artifact_path,
)


@pytest.fixture
async def db(tmp_path: Path) -> SqliteDatabase:
    d = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await d.initialize()
    return d


# ─── stage_artifact_path / extension mapping ────────────────────────────────


def test_stage_artifact_path_uses_canonical_layout(tmp_path: Path) -> None:
    """Path is `<data_root>/projects/<id>/pages/<page>/stages/<stage>/output.<ext>`."""
    p = stage_artifact_path(tmp_path, "p1", "0042", "threshold")
    assert p == tmp_path / "projects" / "p1" / "pages" / "0042" / "stages" / "threshold" / "output.png"


def test_stage_artifact_path_text_postprocess_is_txt(tmp_path: Path) -> None:
    p = stage_artifact_path(tmp_path, "p1", "0042", "text_postprocess")
    assert p.suffix == ".txt"


def test_stage_artifact_path_thumbnail_is_jpg(tmp_path: Path) -> None:
    p = stage_artifact_path(tmp_path, "p1", "0042", "thumbnail")
    assert p.suffix == ".jpg"


def test_stage_artifact_path_auto_detect_attrs_is_json(tmp_path: Path) -> None:
    p = stage_artifact_path(tmp_path, "p1", "0042", "auto_detect_attrs")
    assert p.suffix == ".json"


def test_stage_artifact_path_compound_stage_raises(tmp_path: Path) -> None:
    """`ocr` emits `words.json + raw.txt` — single-file writer can't handle it."""
    with pytest.raises(StageArtifactWriteError):
        stage_artifact_path(tmp_path, "p1", "0042", "ocr")


# ─── commit_stage_artifact happy path ──────────────────────────────────────


@pytest.mark.asyncio
async def test_commit_stage_artifact_happy_path(tmp_path: Path, db: SqliteDatabase) -> None:
    payload = b"\x89PNG\r\n\x1a\n hello world"
    state = await commit_stage_artifact(
        data_root=tmp_path,
        database=db,
        project_id="p1",
        page_id="0000",
        stage_id="threshold",
        artifact_bytes=payload,
        stage_version=3,
    )

    # File lands at expected path with correct contents.
    expected_path = stage_artifact_path(tmp_path, "p1", "0000", "threshold")
    assert expected_path.exists()
    assert expected_path.read_bytes() == payload

    # Returned state matches DB row.
    assert state.status is PageStageStatus.clean
    assert state.stage_version == 3
    assert state.input_hash == compute_content_hash(payload)
    assert state.artifact_key == "projects/p1/pages/0000/stages/threshold/output.png"
    assert state.last_run_at is not None

    got = await db.get_page_stage("p1", "0000", "threshold")
    assert got is not None
    assert got.status is PageStageStatus.clean
    assert got.input_hash == state.input_hash


@pytest.mark.asyncio
async def test_commit_stage_artifact_overwrite_replaces_prior(tmp_path: Path, db: SqliteDatabase) -> None:
    """A second commit with new bytes replaces the prior file + row."""
    await commit_stage_artifact(
        data_root=tmp_path,
        database=db,
        project_id="p1",
        page_id="0000",
        stage_id="threshold",
        artifact_bytes=b"version-1",
    )
    await commit_stage_artifact(
        data_root=tmp_path,
        database=db,
        project_id="p1",
        page_id="0000",
        stage_id="threshold",
        artifact_bytes=b"version-2",
    )
    expected = stage_artifact_path(tmp_path, "p1", "0000", "threshold")
    assert expected.read_bytes() == b"version-2"
    # No leftover prior-snapshot or tmp files.
    leftovers = [p for p in expected.parent.iterdir() if ".tmp-" in p.name]
    assert leftovers == [], f"unexpected leftover tmp files: {leftovers}"

    got = await db.get_page_stage("p1", "0000", "threshold")
    assert got is not None
    assert got.input_hash == compute_content_hash(b"version-2")


# ─── commit_stage_artifact failure paths ───────────────────────────────────


@pytest.mark.asyncio
async def test_commit_stage_artifact_db_failure_rolls_back_file(
    tmp_path: Path, db: SqliteDatabase, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Q9: when DB upsert fails after the file is in place, the file is rolled back."""

    async def _explode(*_a: object, **_k: object) -> None:
        raise RuntimeError("simulated DB failure")

    monkeypatch.setattr(db, "put_page_stage", _explode)

    with pytest.raises(StageArtifactWriteError):
        await commit_stage_artifact(
            data_root=tmp_path,
            database=db,
            project_id="p1",
            page_id="0000",
            stage_id="threshold",
            artifact_bytes=b"content",
        )

    # File must NOT exist (rolled back since there was no prior).
    expected = stage_artifact_path(tmp_path, "p1", "0000", "threshold")
    assert not expected.exists(), "file should have been rolled back on DB failure"
    # No tmp files left.
    if expected.parent.exists():
        leftovers = list(expected.parent.iterdir())
        assert leftovers == [], f"unexpected leftover files: {leftovers}"


@pytest.mark.asyncio
async def test_commit_stage_artifact_db_failure_restores_prior_file(
    tmp_path: Path, db: SqliteDatabase, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When a prior file exists, DB failure must restore it (not delete it)."""
    # First commit succeeds.
    await commit_stage_artifact(
        data_root=tmp_path,
        database=db,
        project_id="p1",
        page_id="0000",
        stage_id="threshold",
        artifact_bytes=b"prior-version",
    )

    # Second commit's DB upsert fails.
    async def _explode(*_a: object, **_k: object) -> None:
        raise RuntimeError("simulated DB failure")

    monkeypatch.setattr(db, "put_page_stage", _explode)

    with pytest.raises(StageArtifactWriteError):
        await commit_stage_artifact(
            data_root=tmp_path,
            database=db,
            project_id="p1",
            page_id="0000",
            stage_id="threshold",
            artifact_bytes=b"new-version",
        )

    expected = stage_artifact_path(tmp_path, "p1", "0000", "threshold")
    assert expected.read_bytes() == b"prior-version", "prior file must be restored"
    # No tmp/snapshot files left.
    leftovers = [p for p in expected.parent.iterdir() if ".tmp-" in p.name]
    assert leftovers == []


@pytest.mark.asyncio
async def test_commit_stage_artifact_fsync_failure_fails_loudly(
    tmp_path: Path, db: SqliteDatabase, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Q9: fsync failure → StageArtifactWriteError, no DB row, no leftover tmp."""
    import os

    real_fsync = os.fsync

    def _broken_fsync(fd: int) -> None:
        # Trigger only for our writer's fsync (not unrelated fsync calls).
        raise OSError("simulated fsync failure")

    monkeypatch.setattr(os, "fsync", _broken_fsync)

    with pytest.raises(StageArtifactWriteError):
        await commit_stage_artifact(
            data_root=tmp_path,
            database=db,
            project_id="p1",
            page_id="0000",
            stage_id="threshold",
            artifact_bytes=b"content",
        )

    # restore for safety (monkeypatch already does this on teardown)
    monkeypatch.setattr(os, "fsync", real_fsync)

    # No DB row written.
    assert await db.get_page_stage("p1", "0000", "threshold") is None
    # No leftover tmp file.
    expected_dir = tmp_path / "projects" / "p1" / "pages" / "0000" / "stages" / "threshold"
    if expected_dir.exists():
        assert list(expected_dir.iterdir()) == []


# ─── reconcile_page ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_reconcile_page_clean_after_commit(tmp_path: Path, db: SqliteDatabase) -> None:
    await commit_stage_artifact(
        data_root=tmp_path,
        database=db,
        project_id="p1",
        page_id="0000",
        stage_id="threshold",
        artifact_bytes=b"hello",
    )
    report = await reconcile_page(data_root=tmp_path, database=db, project_id="p1", page_id="0000")
    assert report.is_clean, (
        f"expected clean, got orphans={report.orphan_files} "
        f"missing={report.missing_files} mismatches={report.hash_mismatches}"
    )


@pytest.mark.asyncio
async def test_reconcile_page_detects_missing_file(tmp_path: Path, db: SqliteDatabase) -> None:
    """Row says clean, file is gone -> MissingFile reported."""
    await commit_stage_artifact(
        data_root=tmp_path,
        database=db,
        project_id="p1",
        page_id="0000",
        stage_id="threshold",
        artifact_bytes=b"hello",
    )
    expected = stage_artifact_path(tmp_path, "p1", "0000", "threshold")
    expected.unlink()

    report = await reconcile_page(data_root=tmp_path, database=db, project_id="p1", page_id="0000")
    assert len(report.missing_files) == 1
    assert isinstance(report.missing_files[0], MissingFile)
    assert report.missing_files[0].stage_id == "threshold"
    assert report.orphan_files == ()
    assert report.hash_mismatches == ()


@pytest.mark.asyncio
async def test_reconcile_page_detects_orphan_file(tmp_path: Path, db: SqliteDatabase) -> None:
    """File on disk under a known stage with no row -> OrphanFile."""
    bogus = (
        tmp_path
        / "projects"
        / "p1"
        / "pages"
        / "0000"
        / "stages"
        / "deskew"  # not a real stage_id, but for orphan-no-stage path
        / "output.png"
    )
    bogus.parent.mkdir(parents=True, exist_ok=True)
    bogus.write_bytes(b"junk")

    report = await reconcile_page(data_root=tmp_path, database=db, project_id="p1", page_id="0000")
    assert len(report.orphan_files) == 1
    assert isinstance(report.orphan_files[0], OrphanFile)
    assert report.orphan_files[0].stage_id == "deskew"


@pytest.mark.asyncio
async def test_reconcile_page_detects_orphan_known_stage_no_row(tmp_path: Path, db: SqliteDatabase) -> None:
    """File at a known stage path but no DB row -> OrphanFile reason='no-row'."""
    bogus = stage_artifact_path(tmp_path, "p1", "0000", "threshold")
    bogus.parent.mkdir(parents=True, exist_ok=True)
    bogus.write_bytes(b"junk")

    report = await reconcile_page(data_root=tmp_path, database=db, project_id="p1", page_id="0000")
    assert len(report.orphan_files) == 1
    o = report.orphan_files[0]
    assert o.stage_id == "threshold"
    assert o.reason == "no-row"


@pytest.mark.asyncio
async def test_reconcile_page_detects_hash_mismatch(tmp_path: Path, db: SqliteDatabase) -> None:
    """Row says hash X, file is hash Y -> HashMismatch."""
    await commit_stage_artifact(
        data_root=tmp_path,
        database=db,
        project_id="p1",
        page_id="0000",
        stage_id="threshold",
        artifact_bytes=b"original",
    )
    # Tamper with the on-disk file behind the writer's back.
    expected = stage_artifact_path(tmp_path, "p1", "0000", "threshold")
    expected.write_bytes(b"tampered")

    report = await reconcile_page(data_root=tmp_path, database=db, project_id="p1", page_id="0000")
    assert len(report.hash_mismatches) == 1
    m = report.hash_mismatches[0]
    assert isinstance(m, HashMismatch)
    assert m.stage_id == "threshold"
    assert m.db_hash == compute_content_hash(b"original")
    assert m.file_hash == compute_content_hash(b"tampered")


@pytest.mark.asyncio
async def test_reconcile_page_does_not_mutate(tmp_path: Path, db: SqliteDatabase) -> None:
    """reconcile_page is a pure detector — DB and disk unchanged after call."""
    await commit_stage_artifact(
        data_root=tmp_path,
        database=db,
        project_id="p1",
        page_id="0000",
        stage_id="threshold",
        artifact_bytes=b"hello",
    )
    expected = stage_artifact_path(tmp_path, "p1", "0000", "threshold")
    expected.write_bytes(b"tampered")

    pre_row = await db.get_page_stage("p1", "0000", "threshold")
    pre_bytes = expected.read_bytes()

    await reconcile_page(data_root=tmp_path, database=db, project_id="p1", page_id="0000")

    post_row = await db.get_page_stage("p1", "0000", "threshold")
    post_bytes = expected.read_bytes()
    # Row unchanged.
    assert pre_row is not None
    assert post_row is not None
    assert pre_row.input_hash == post_row.input_hash
    assert pre_row.status == post_row.status
    # File unchanged.
    assert pre_bytes == post_bytes


@pytest.mark.asyncio
async def test_reconcile_page_skips_tmp_files(tmp_path: Path, db: SqliteDatabase) -> None:
    """Mid-write tmp files (`output.png.tmp-<uuid>`) must NOT be reported."""
    await commit_stage_artifact(
        data_root=tmp_path,
        database=db,
        project_id="p1",
        page_id="0000",
        stage_id="threshold",
        artifact_bytes=b"hello",
    )
    # Drop a leftover tmp file as if a prior run was interrupted.
    expected = stage_artifact_path(tmp_path, "p1", "0000", "threshold")
    leftover_tmp = expected.with_name(expected.name + ".tmp-deadbeef")
    leftover_tmp.write_bytes(b"junk")

    report = await reconcile_page(data_root=tmp_path, database=db, project_id="p1", page_id="0000")
    # The good file is reconciled cleanly; the tmp file is not flagged
    # (it's a transient — the runner / reindex cleans it up out-of-band).
    assert report.is_clean, f"tmp file should be ignored, got orphans={report.orphan_files}"


@pytest.mark.asyncio
async def test_reconcile_page_empty_project_clean(tmp_path: Path, db: SqliteDatabase) -> None:
    """A page with no rows + no files is trivially clean."""
    report = await reconcile_page(data_root=tmp_path, database=db, project_id="p1", page_id="0000")
    assert report.is_clean


@pytest.mark.asyncio
async def test_reconcile_page_ignores_non_clean_rows_for_missing(tmp_path: Path, db: SqliteDatabase) -> None:
    """A `not-run` or `failed` row with no file is fine; only `clean` rows are checked."""
    await db.put_page_stage(
        PageStageState(
            project_id="p1",
            page_id="0000",
            stage_id="threshold",
            status=PageStageStatus.failed,
            stage_version=1,
        )
    )
    report = await reconcile_page(data_root=tmp_path, database=db, project_id="p1", page_id="0000")
    assert report.missing_files == ()


# ─── commit_stage_artifacts_multi ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_commit_stage_artifacts_multi_writes_all_files(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """Multi-artifact writer writes every file in the `files` dict to disk."""
    from pdomain_prep_for_pgdp.core.pipeline.page_stage_writer import commit_stage_artifacts_multi

    await db.init_page_stages_for_page("p1", "0000")
    files = {"words.json": b'[{"text":"hello"}]', "raw.txt": b"hello"}
    state = await commit_stage_artifacts_multi(
        data_root=tmp_path,
        database=db,
        project_id="p1",
        page_id="0000",
        stage_id="ocr",
        files=files,
        primary_filename="words.json",
    )

    stage_dir = tmp_path / "projects" / "p1" / "pages" / "0000" / "stages" / "ocr"
    assert (stage_dir / "words.json").exists()
    assert (stage_dir / "raw.txt").exists()
    assert (stage_dir / "words.json").read_bytes() == b'[{"text":"hello"}]'
    assert (stage_dir / "raw.txt").read_bytes() == b"hello"
    assert state.status.value == "clean"


@pytest.mark.asyncio
async def test_commit_stage_artifacts_multi_db_row_points_to_primary(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """DB `artifact_key` should point to the primary file."""
    from pdomain_prep_for_pgdp.core.pipeline.page_stage_writer import commit_stage_artifacts_multi

    await db.init_page_stages_for_page("p1", "0000")
    files = {"words.json": b"[]", "raw.txt": b""}
    state = await commit_stage_artifacts_multi(
        data_root=tmp_path,
        database=db,
        project_id="p1",
        page_id="0000",
        stage_id="ocr",
        files=files,
        primary_filename="words.json",
    )

    assert state.artifact_key is not None
    assert state.artifact_key.endswith("words.json"), (
        f"artifact_key should end with primary filename, got {state.artifact_key!r}"
    )


@pytest.mark.asyncio
async def test_commit_stage_artifacts_multi_replaces_prior_files(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """Re-running multi-artifact writer overwrites previous files."""
    from pdomain_prep_for_pgdp.core.pipeline.page_stage_writer import commit_stage_artifacts_multi

    await db.init_page_stages_for_page("p1", "0000")
    stage_dir = tmp_path / "projects" / "p1" / "pages" / "0000" / "stages" / "ocr"
    stage_dir.mkdir(parents=True)
    (stage_dir / "words.json").write_bytes(b"old")
    (stage_dir / "raw.txt").write_bytes(b"old-text")

    files = {"words.json": b'[{"text":"new"}]', "raw.txt": b"new"}
    await commit_stage_artifacts_multi(
        data_root=tmp_path,
        database=db,
        project_id="p1",
        page_id="0000",
        stage_id="ocr",
        files=files,
        primary_filename="words.json",
    )

    assert (stage_dir / "words.json").read_bytes() == b'[{"text":"new"}]'
    assert (stage_dir / "raw.txt").read_bytes() == b"new"


# ─── _safe_rollback logging behaviour ───────────────────────────────────────


@pytest.mark.asyncio
async def test_rollback_ioerror_is_logged_not_suppressed(
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """An OSError during rollback unlink must appear in ERROR logs, not be silently suppressed."""
    import logging

    # Arrange: make DB.put_page_stage fail to trigger the rollback path.
    # Use monkeypatch-style AsyncMock so the DB write succeeds on first
    # (snapshot) call but fails on the upsert that follows.
    from unittest.mock import AsyncMock

    mock_db = AsyncMock()
    mock_db.get_page_stage.return_value = None
    mock_db.put_page_stage.side_effect = RuntimeError("injected DB failure")

    # Patch Path.unlink to raise OSError on the first call (the rollback
    # unlink of the canonical target_path after DB failure when there is
    # no prior snapshot to restore).
    original_unlink = Path.unlink
    call_count = 0

    def flaky_unlink(self: Path, missing_ok: bool = False) -> None:  # type: ignore[override]
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise OSError("permission denied (injected)")
        return original_unlink(self, missing_ok=missing_ok)

    # Capture at WARNING level so ERROR records are included.
    with caplog.at_level(logging.WARNING), pytest.MonkeyPatch.context() as mp:
        mp.setattr(Path, "unlink", flaky_unlink)
        with pytest.raises(StageArtifactWriteError):
            await commit_stage_artifact(
                data_root=tmp_path,
                database=mock_db,
                project_id="p1",
                page_id="pg1",
                stage_id="decode_source",
                artifact_bytes=b"test",
                stage_version=1,
            )

    error_records = [r for r in caplog.records if r.levelno >= logging.ERROR]
    assert any("rollback" in r.message.lower() for r in error_records), (
        f"Expected rollback ERROR log entry, got: {[r.message for r in error_records]}"
    )
