"""M2 Slice 3 — `core.pipeline.stage_runner.run_stage`.

Spec: `docs/specs/pipeline-task-model.md` §"Per-page stage runner" /
§"Dirty propagation" (locked 2026-05-07).

The runner is the engine that ties the pieces together for one stage on
one page:

1. Validate the stage's `depends_on` rows are all `clean`. Else raise
   `StageDependenciesNotMet`.
2. Pick `device` (cpu by default; cuda when registered + available).
3. Mark `page_stages` row `running` (commit immediately so the GET
   endpoint sees the transition).
4. Load each parent's clean artifact off disk; decode to the runner's
   canonical in-memory type (numpy.ndarray for cpu).
5. Call `STAGE_IMPL[stage_id][device]` with that input.
6. Encode the output (ndarray → PNG bytes today) and dual-write via
   `commit_stage_artifact` — that takes the row to `clean`.
7. Cascade dirty to descendants currently `clean` or `failed`.
8. Return the new `PageStageState`.

Failures translate to `status=failed` + `error_message`; descendants
are NOT dirtied (the previous output, if any, is still consistent).
`StageNotImplemented` (registry placeholder) becomes a clear "not yet
implemented" message rather than the engine claiming a real bug.

Compound-output stages (`ocr`, `extract_illustrations`, `text_review`)
are out of scope at Slice 3 — they raise `StageOutputUnsupported` so
the runner doesn't try to dual-write them through the single-file
contract. Wire those when the multi-artifact writer lands (M3+).
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import pytest

from pd_prep_for_pgdp.adapters.database.sqlite import SqliteDatabase
from pd_prep_for_pgdp.core.models import (
    PageStageState,
    PageStageStatus,
)
from pd_prep_for_pgdp.core.pipeline.page_stage_writer import (
    commit_stage_artifact,
    stage_artifact_path,
)
from pd_prep_for_pgdp.core.pipeline.stage_runner import (
    StageDependenciesNotMet,
    StageOutputUnsupported,
    StageRunFailed,
    run_stage,
)

# ─── Fixtures ───────────────────────────────────────────────────────────────


@pytest.fixture
async def db(tmp_path: Path) -> SqliteDatabase:
    d = SqliteDatabase(f"sqlite:///{(tmp_path / 's.db').as_posix()}")
    await d.initialize()
    return d


def _checkerboard_bgr_png() -> bytes:
    """Build a small BGR PNG bytes payload for use as a `manual_deskew_pre`
    output (so `grayscale` has a parent to read)."""
    img = np.zeros((20, 20, 3), dtype=np.uint8)
    img[::2, ::2] = (200, 200, 200)
    img[1::2, 1::2] = (200, 200, 200)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


async def _seed_clean_parents(
    db: SqliteDatabase,
    data_root: Path,
    project_id: str,
    page_id: str,
    parent_stages: list[str],
    payload: bytes,
) -> None:
    """Seed every `parent_stages` row as `clean` with `payload` on disk via
    the canonical writer.

    Uses `commit_stage_artifact` for each parent — this is exactly the path
    a previous stage's run would've taken, so disk + DB stay aligned.
    """
    await db.init_page_stages_for_page(project_id, page_id)
    for sid in parent_stages:
        await commit_stage_artifact(
            data_root=data_root,
            database=db,
            project_id=project_id,
            page_id=page_id,
            stage_id=sid,
            artifact_bytes=payload,
        )


# ─── Happy path: grayscale on a clean manual_deskew_pre ────────────────────


@pytest.mark.asyncio
async def test_run_stage_grayscale_happy_path(tmp_path: Path, db: SqliteDatabase) -> None:
    """`grayscale` runs end-to-end: row → running → clean, file lands on disk."""
    project_id, page_id = "p1", "0000"
    payload = _checkerboard_bgr_png()
    # grayscale's depends_on is `manual_deskew_pre`; seed that as clean.
    await _seed_clean_parents(
        db,
        tmp_path,
        project_id,
        page_id,
        parent_stages=["manual_deskew_pre"],
        payload=payload,
    )

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="grayscale",
    )

    assert state.status == PageStageStatus.clean
    assert state.input_hash is not None
    assert state.last_run_at is not None

    # File exists at the canonical path.
    artifact_path = stage_artifact_path(tmp_path, project_id, page_id, "grayscale")
    assert artifact_path.exists()
    assert artifact_path.stat().st_size > 0

    # The on-disk artifact decodes as a 2-D grayscale PNG.
    out_arr = cv2.imdecode(np.frombuffer(artifact_path.read_bytes(), np.uint8), cv2.IMREAD_UNCHANGED)
    assert out_arr.ndim == 2


# ─── Dependency check: parent not clean ─────────────────────────────────────


@pytest.mark.asyncio
async def test_run_stage_raises_when_dependencies_not_met(tmp_path: Path, db: SqliteDatabase) -> None:
    """`grayscale` requires `manual_deskew_pre` to be clean. Lazy-init creates
    rows as `not-run`, so a fresh page should fail dep-check."""
    project_id, page_id = "p1", "0000"
    await db.init_page_stages_for_page(project_id, page_id)

    with pytest.raises(StageDependenciesNotMet) as exc_info:
        await run_stage(
            data_root=tmp_path,
            database=db,
            project_id=project_id,
            page_id=page_id,
            stage_id="grayscale",
        )
    # The exception names the offending stage(s) so the caller can propose
    # auto-running them.
    assert "manual_deskew_pre" in str(exc_info.value)


# ─── Eager dirty cascade ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_run_stage_cascades_dirty_to_descendants(tmp_path: Path, db: SqliteDatabase) -> None:
    """Running `grayscale` after `threshold` is `clean` re-dirties `threshold`.

    Q2 (eager dirty cascade): when a stage's output changes, every
    descendant currently `clean` or `failed` flips to `dirty`. Descendants
    that are already `not-run` stay `not-run`.
    """
    project_id, page_id = "p1", "0000"
    payload = _checkerboard_bgr_png()
    # Seed grayscale's deps + grayscale + threshold all clean. (The runner
    # doesn't validate the chain on each ancestor — only the immediate
    # parents — so we use commit_stage_artifact directly to seed.)
    await _seed_clean_parents(
        db,
        tmp_path,
        project_id,
        page_id,
        parent_stages=["manual_deskew_pre", "grayscale", "threshold"],
        payload=payload,
    )

    # Sanity-check seed.
    threshold_row = await db.get_page_stage(project_id, page_id, "threshold")
    assert threshold_row is not None
    assert threshold_row.status == PageStageStatus.clean

    # Re-run grayscale — should cascade dirty to threshold (and any other
    # descendants).
    await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="grayscale",
    )

    # threshold is a direct descendant of grayscale, was clean → must be dirty.
    threshold_row_after = await db.get_page_stage(project_id, page_id, "threshold")
    assert threshold_row_after is not None
    assert threshold_row_after.status == PageStageStatus.dirty


@pytest.mark.asyncio
async def test_run_stage_cascade_does_not_redirty_not_run(tmp_path: Path, db: SqliteDatabase) -> None:
    """Descendants that are already `not-run` stay `not-run` (Q2)."""
    project_id, page_id = "p1", "0000"
    payload = _checkerboard_bgr_png()
    # Seed only the immediate parent of grayscale; everything else is `not-run`.
    await _seed_clean_parents(
        db,
        tmp_path,
        project_id,
        page_id,
        parent_stages=["manual_deskew_pre"],
        payload=payload,
    )

    await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="grayscale",
    )

    threshold_row = await db.get_page_stage(project_id, page_id, "threshold")
    assert threshold_row is not None
    assert threshold_row.status == PageStageStatus.not_run, (
        "threshold was never clean; cascade must not flip it to dirty"
    )


# ─── Failure path: registered stage raises ──────────────────────────────────


@pytest.mark.asyncio
async def test_run_stage_records_failure_when_impl_raises(
    tmp_path: Path,
    db: SqliteDatabase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An exception inside the registered impl marks the row `failed` with a
    captured error message and re-raises as `StageRunFailed`. Descendants are
    NOT cascaded dirty (the prior output, if any, is still consistent)."""
    project_id, page_id = "p1", "0000"
    payload = _checkerboard_bgr_png()
    await _seed_clean_parents(
        db,
        tmp_path,
        project_id,
        page_id,
        parent_stages=["manual_deskew_pre"],
        payload=payload,
    )

    # Patch the cpu impl for grayscale to raise.
    from pd_prep_for_pgdp.core.pipeline import stage_registry

    def _kaboom(_x):
        raise ValueError("synthetic stage failure for tests")

    monkeypatch.setitem(stage_registry.STAGE_IMPL["grayscale"], "cpu", _kaboom)

    with pytest.raises(StageRunFailed):
        await run_stage(
            data_root=tmp_path,
            database=db,
            project_id=project_id,
            page_id=page_id,
            stage_id="grayscale",
        )

    row = await db.get_page_stage(project_id, page_id, "grayscale")
    assert row is not None
    assert row.status == PageStageStatus.failed
    assert row.error_message is not None
    assert "synthetic stage failure" in row.error_message


@pytest.mark.asyncio
async def test_run_stage_handles_stage_not_implemented(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """A `StageNotImplemented` from the registry surfaces as a clear failure
    with a "not yet implemented in registry" message, not the generic engine
    error."""
    project_id, page_id = "p1", "0000"
    # `find_content_edges` is a registry placeholder at this iteration
    # (no real impl yet — still a closure-bound StageNotImplemented stub).
    # Seed its only dep (`invert`) clean so the parent-loader doesn't fail
    # before the registry is consulted.
    payload = _checkerboard_bgr_png()
    await _seed_clean_parents(
        db,
        tmp_path,
        project_id,
        page_id,
        parent_stages=["invert"],
        payload=payload,
    )

    with pytest.raises(StageRunFailed) as exc_info:
        await run_stage(
            data_root=tmp_path,
            database=db,
            project_id=project_id,
            page_id=page_id,
            stage_id="find_content_edges",
        )
    # Either the wrapper or the persisted error_message must surface the
    # registry's placeholder wording (substring match — exact phrase tracks
    # `_make_placeholder` in stage_registry.py) so the chip rail can explain.
    persisted = (await db.get_page_stage(project_id, page_id, "find_content_edges")).error_message
    assert "no implementation registered" in str(exc_info.value).lower() or (
        persisted is not None and "no implementation registered" in persisted.lower()
    )


# ─── Compound-output guard ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_run_stage_compound_output_raises_clear_error(tmp_path: Path, db: SqliteDatabase) -> None:
    """`ocr` (output_type='words+text') has no single-file writer support yet.

    The runner should raise `StageOutputUnsupported` with a clear message
    rather than the generic `StageArtifactWriteError` — that's the
    breadcrumb for the next slice that adds the multi-artifact writer.
    """
    project_id, page_id = "p1", "0000"
    payload = _checkerboard_bgr_png()
    await _seed_clean_parents(
        db,
        tmp_path,
        project_id,
        page_id,
        parent_stages=["ocr_crop"],
        payload=payload,
    )

    with pytest.raises(StageOutputUnsupported) as exc_info:
        await run_stage(
            data_root=tmp_path,
            database=db,
            project_id=project_id,
            page_id=page_id,
            stage_id="ocr",
        )
    assert "compound" in str(exc_info.value).lower() or "ocr" in str(exc_info.value).lower()


# ─── Return shape ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_run_stage_returns_page_stage_state(tmp_path: Path, db: SqliteDatabase) -> None:
    """The runner's return value is the freshly-committed PageStageState row."""
    project_id, page_id = "p1", "0000"
    payload = _checkerboard_bgr_png()
    await _seed_clean_parents(
        db,
        tmp_path,
        project_id,
        page_id,
        parent_stages=["manual_deskew_pre"],
        payload=payload,
    )

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="grayscale",
    )
    assert isinstance(state, PageStageState)
    assert state.stage_id == "grayscale"
    assert state.project_id == project_id
    assert state.page_id == page_id


# ─── ingest_source: root-stage with storage-sourced bytes ──────────────────


@pytest.mark.asyncio
async def test_run_stage_ingest_source_writes_canonical_artifact(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """`ingest_source` (root, depends_on=()) reads source bytes from
    `IStorage` at `page_source_key` and writes them to the canonical
    `pages/<page_id>/stages/ingest_source/output.png` path.

    This is the chain root: with this in place the user can click the
    rail's first chip and watch it turn green without manual SQLite
    seeding. Carving it out is the load-bearing "no SQLite seeding"
    change for M2.
    """
    from pd_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage

    project_id, page_id = "p1", "0000"
    storage = FilesystemStorage(tmp_path)

    # Stash a real PNG at the upload-side source key.
    payload = _checkerboard_bgr_png()
    source_key = f"projects/{project_id}/source/page0.jpg"
    await storage.put_bytes(source_key, payload, "image/jpeg")

    # No parents to seed — `ingest_source` has empty depends_on.
    await db.init_page_stages_for_page(project_id, page_id)

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="ingest_source",
        storage=storage,
        page_source_key=source_key,
    )

    assert state.status == PageStageStatus.clean
    assert state.input_hash is not None

    artifact_path = stage_artifact_path(tmp_path, project_id, page_id, "ingest_source")
    assert artifact_path.exists()
    assert artifact_path.read_bytes() == payload


@pytest.mark.asyncio
async def test_run_stage_ingest_source_missing_storage_fails_loud(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """Without `storage`/`page_source_key` the runner can't read source
    bytes and must fail loudly (Q9), not silently produce an empty file."""
    project_id, page_id = "p1", "0000"
    await db.init_page_stages_for_page(project_id, page_id)

    with pytest.raises(StageRunFailed):
        await run_stage(
            data_root=tmp_path,
            database=db,
            project_id=project_id,
            page_id=page_id,
            stage_id="ingest_source",
        )

    row = await db.get_page_stage(project_id, page_id, "ingest_source")
    assert row is not None
    assert row.status == PageStageStatus.failed


@pytest.mark.asyncio
async def test_run_stage_full_chain_to_invert_no_manual_seeding(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """End-to-end click-flow: starting from a fresh page (no rows seeded),
    running ingest_source → decode_source → initial_crop → manual_deskew_pre
    → grayscale → threshold → invert in order produces a clean artifact at
    every step.

    This is the M2 smoke-test pass criterion (no manual SQLite seeding).
    """
    from pd_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage

    project_id, page_id = "p1", "0000"
    storage = FilesystemStorage(tmp_path)

    payload = _checkerboard_bgr_png()
    source_key = f"projects/{project_id}/source/page0.png"
    await storage.put_bytes(source_key, payload, "image/png")
    await db.init_page_stages_for_page(project_id, page_id)

    chain = [
        "ingest_source",
        "decode_source",
        "initial_crop",
        "manual_deskew_pre",
        "grayscale",
        "threshold",
        "invert",
    ]
    for stage_id in chain:
        state = await run_stage(
            data_root=tmp_path,
            database=db,
            project_id=project_id,
            page_id=page_id,
            stage_id=stage_id,
            storage=storage,
            page_source_key=source_key,
        )
        assert state.status == PageStageStatus.clean, (
            f"stage {stage_id!r} did not reach clean; got {state.status!r} (error={state.error_message!r})"
        )
        artifact_path = stage_artifact_path(tmp_path, project_id, page_id, stage_id)
        assert artifact_path.exists(), f"stage {stage_id!r} produced no artifact on disk"
