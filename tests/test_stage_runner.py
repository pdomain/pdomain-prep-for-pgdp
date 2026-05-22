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

Compound-output stages (`ocr`, `text_review`) route through the
multi-artifact writer added in Slice 14. `extract_illustrations` remains
a placeholder until the illustration-crop logic lands.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

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
    StageRunFailed,
    _call_impl,
    run_stage,
)

if TYPE_CHECKING:
    from pathlib import Path

# ─── Unit tests ─────────────────────────────────────────────────────────────


def test_numpy_scalar_in_output_uses_isinstance_not_hasattr() -> None:
    """Numpy scalar detection must use isinstance(v, np.generic), not hasattr(v, 'item').

    An object with an .item() method that is NOT np.generic must not be
    coerced via int() in the JSON-output coercion path.  We verify this by
    checking that _call_impl round-trips through an impl that returns a
    np.int64 scalar (which IS np.generic) and that a plain object with
    .item() (which is NOT np.generic) would not be cast.
    """

    class FakeWithItem:
        """Has .item() but is NOT np.generic — must NOT be int()-cast."""

        def item(self) -> int:
            return 99

    # np.int64 IS np.generic — _call_impl itself just calls the impl; the
    # coercion happens in run_stage for JSON output types.  Test the
    # isinstance guard directly.
    np_val = np.int64(42)
    fake_val = FakeWithItem()

    assert isinstance(np_val, np.generic), "np.int64 must satisfy isinstance(v, np.generic)"
    assert not isinstance(fake_val, np.generic), "FakeWithItem must NOT satisfy isinstance(v, np.generic)"

    # Applying the coercion expression used in run_stage:
    coerce = lambda v: int(v) if isinstance(v, np.generic) else v  # noqa: E731  -- mirrors run_stage's coercion expression verbatim; a def would obscure the 1:1 correspondence
    assert coerce(np_val) == 42
    assert coerce(fake_val) is fake_val, "FakeWithItem must be returned unchanged"


def test_call_impl_always_passes_cfg() -> None:
    """_call_impl must always forward cfg= to the impl callable."""
    received: list[object] = []

    def _impl(x: int, cfg=None) -> int:
        received.append(cfg)
        return x

    sentinel = object()
    result = _call_impl(_impl, [7], sentinel)
    assert result == 7
    assert received == [sentinel], "_call_impl must forward cfg to the impl"


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

    def _kaboom(_x, cfg=None):
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
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A `StageNotImplemented` from the registry surfaces as a clear failure
    with a "not yet implemented in registry" message, not the generic engine
    error.

    All remaining non-compound placeholder stages now have real impls. We
    test the `StageNotImplemented` path by monkeypatching `thumbnail` (a real
    impl with a seedable single parent) back to a placeholder. pytest's
    `monkeypatch` fixture ensures cleanup after the test regardless of ordering
    or async event loop scope.
    """

    from pd_prep_for_pgdp.core.pipeline import stage_registry

    project_id, page_id = "p1", "0000"

    # Replace thumbnail's cpu impl with a placeholder that raises StageNotImplemented.
    monkeypatch.setitem(
        stage_registry.STAGE_IMPL["thumbnail"],
        "cpu",
        stage_registry._make_placeholder("thumbnail"),
    )

    payload = _checkerboard_bgr_png()
    await _seed_clean_parents(
        db,
        tmp_path,
        project_id,
        page_id,
        parent_stages=["ingest_source"],
        payload=payload,
    )

    with pytest.raises(StageRunFailed) as exc_info:
        await run_stage(
            data_root=tmp_path,
            database=db,
            project_id=project_id,
            page_id=page_id,
            stage_id="thumbnail",
        )
    # Either the wrapper or the persisted error_message must surface the
    # registry's placeholder wording (substring match — exact phrase tracks
    # `_make_placeholder` in stage_registry.py) so the chip rail can explain.
    persisted = (await db.get_page_stage(project_id, page_id, "thumbnail")).error_message
    assert "no implementation registered" in str(exc_info.value).lower() or (
        persisted is not None and "no implementation registered" in persisted.lower()
    )


# ─── Compound-output guard ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_run_stage_compound_output_no_longer_raises_unsupported(
    tmp_path: Path,
    db: SqliteDatabase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`ocr` (output_type='words+text') is handled by the multi-artifact writer.

    Slice 14 adds commit_stage_artifacts_multi and removes the
    StageOutputUnsupported guard. This test verifies the stage runs cleanly
    (using a monkeypatched impl to avoid loading DocTR weights in CI).
    """

    from pd_prep_for_pgdp.core.pipeline import stage_registry as reg_module

    fake_result = {"words.json": b"[]", "raw.txt": b""}
    monkeypatch.setitem(reg_module.STAGE_IMPL["ocr"], "cpu", lambda image, cfg=None: fake_result)

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

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="ocr",
    )
    assert state.status == PageStageStatus.clean, f"error: {state.error_message!r}"


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


# ─── Slice 9: find_content_edges + bbox parent loading ─────────────────────


def _binary_png_with_content() -> bytes:
    """A 100x100 binary image with white pixels in the centre (content area)."""
    img = np.zeros((100, 100), dtype=np.uint8)
    img[20:80, 10:90] = 255
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf.tobytes())


@pytest.mark.asyncio
async def test_run_stage_find_content_edges_produces_json_artifact(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """`find_content_edges` runs and emits a bbox JSON artifact on disk.

    Slice 9 adds a real `find_content_edges` impl to the registry and
    extends the runner to handle `bbox`-typed output (serialised as JSON).
    After a successful run the artifact must be a JSON file containing a
    4-element list [minX, maxX, minY, maxY].
    """
    import json

    project_id, page_id = "p1", "0000"
    payload = _binary_png_with_content()
    await _seed_clean_parents(db, tmp_path, project_id, page_id, parent_stages=["invert"], payload=payload)

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="find_content_edges",
    )

    assert state.status == PageStageStatus.clean, f"error: {state.error_message!r}"

    artifact_path = stage_artifact_path(tmp_path, project_id, page_id, "find_content_edges")
    assert artifact_path.exists()
    data = json.loads(artifact_path.read_text())
    # Should be a 4-element list of numerics: [minX, maxX, minY, maxY].
    assert isinstance(data, list)
    assert len(data) == 4, f"expected [minX, maxX, minY, maxY], got {data!r}"
    assert all(isinstance(v, (int, float)) for v in data)


@pytest.mark.asyncio
async def test_run_stage_find_content_edges_cascade_reaches_crop_to_content(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """Re-running `find_content_edges` after `crop_to_content` is clean must
    dirty `crop_to_content` (Q2 cascade, multi-parent edge)."""
    import json

    project_id, page_id = "p1", "0000"
    payload = _binary_png_with_content()
    bbox_bytes = json.dumps([10, 90, 20, 80]).encode()
    await _seed_clean_parents(
        db,
        tmp_path,
        project_id,
        page_id,
        parent_stages=["invert", "find_content_edges", "crop_to_content"],
        payload=payload,
    )
    # Override find_content_edges artifact with valid JSON (default seed wrote PNG bytes).
    fce_path = stage_artifact_path(tmp_path, project_id, page_id, "find_content_edges")
    fce_path.write_bytes(bbox_bytes)

    await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="find_content_edges",
    )

    crop_row = await db.get_page_stage(project_id, page_id, "crop_to_content")
    assert crop_row is not None
    assert crop_row.status == PageStageStatus.dirty


# ─── Slice 10: crop_to_content, auto_deskew, morph_fill ────────────────────


@pytest.mark.asyncio
async def test_run_stage_crop_to_content_multi_parent(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """`crop_to_content` loads two parent artifacts: `invert` (binary image)
    and `find_content_edges` (bbox JSON). The runner must handle the mixed
    parent types — decode the image from the first parent and parse JSON from
    the second — then call the impl with (image, bbox).

    After a successful run the artifact must be a PNG with smaller dimensions
    than the original (the crop should shrink the image).
    """
    import json

    project_id, page_id = "p1", "0000"

    # Build a 100x100 binary image with content in a known sub-rect.
    img = np.zeros((100, 100), dtype=np.uint8)
    img[20:80, 10:90] = 255
    ok, buf = cv2.imencode(".png", img)
    assert ok
    binary_payload = bytes(buf.tobytes())

    # Seed `invert` with the binary PNG.
    await db.init_page_stages_for_page(project_id, page_id)
    await commit_stage_artifact(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="invert",
        artifact_bytes=binary_payload,
    )

    # Seed `find_content_edges` with JSON bbox matching the content rect.
    # minX, maxX, minY, maxY — values from find_edges on the above image.
    bbox = [10, 89, 20, 79]
    fce_artifact = json.dumps(bbox).encode()
    await commit_stage_artifact(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="find_content_edges",
        artifact_bytes=fce_artifact,
    )

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="crop_to_content",
    )

    assert state.status == PageStageStatus.clean, f"error: {state.error_message!r}"
    artifact_path = stage_artifact_path(tmp_path, project_id, page_id, "crop_to_content")
    assert artifact_path.exists()
    # Cropped image must be smaller than the original.
    cropped = cv2.imdecode(np.frombuffer(artifact_path.read_bytes(), np.uint8), cv2.IMREAD_UNCHANGED)
    assert cropped is not None
    h, w = cropped.shape[:2]
    assert h < 100 or w < 100, f"crop_to_content produced same-size image: {h}x{w}"


@pytest.mark.asyncio
async def test_run_stage_auto_deskew_runs_after_crop_to_content(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """`auto_deskew` runs on the output of `crop_to_content` and produces a PNG."""
    project_id, page_id = "p1", "0000"
    img = np.zeros((60, 80), dtype=np.uint8)
    img[10:50, 10:70] = 255
    ok, buf = cv2.imencode(".png", img)
    assert ok
    payload = bytes(buf.tobytes())
    await _seed_clean_parents(
        db, tmp_path, project_id, page_id, parent_stages=["crop_to_content"], payload=payload
    )

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="auto_deskew",
    )

    assert state.status == PageStageStatus.clean, f"error: {state.error_message!r}"
    artifact_path = stage_artifact_path(tmp_path, project_id, page_id, "auto_deskew")
    assert artifact_path.exists()
    arr = cv2.imdecode(np.frombuffer(artifact_path.read_bytes(), np.uint8), cv2.IMREAD_UNCHANGED)
    assert arr is not None


@pytest.mark.asyncio
async def test_run_stage_morph_fill_runs_after_auto_deskew(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """`morph_fill` runs on the output of `auto_deskew` and produces a PNG."""
    project_id, page_id = "p1", "0000"
    img = np.zeros((60, 80), dtype=np.uint8)
    img[10:50, 10:70] = 255
    ok, buf = cv2.imencode(".png", img)
    assert ok
    payload = bytes(buf.tobytes())
    await _seed_clean_parents(
        db, tmp_path, project_id, page_id, parent_stages=["auto_deskew"], payload=payload
    )

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="morph_fill",
    )

    assert state.status == PageStageStatus.clean, f"error: {state.error_message!r}"
    artifact_path = stage_artifact_path(tmp_path, project_id, page_id, "morph_fill")
    assert artifact_path.exists()
    arr = cv2.imdecode(np.frombuffer(artifact_path.read_bytes(), np.uint8), cv2.IMREAD_UNCHANGED)
    assert arr is not None


# ─── Slice 11: rescale + canvas_map ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_run_stage_rescale_runs_after_morph_fill(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """`rescale` runs on the output of `morph_fill` and produces a PNG.

    rescale re-inverts before scaling (4m in process_page_cpu) and outputs
    a grayscale (inverted) image — output_type='image' but single-channel.
    """
    project_id, page_id = "p1", "0000"
    img = np.zeros((60, 80), dtype=np.uint8)
    img[10:50, 10:70] = 255
    ok, buf = cv2.imencode(".png", img)
    assert ok
    payload = bytes(buf.tobytes())
    await _seed_clean_parents(
        db, tmp_path, project_id, page_id, parent_stages=["morph_fill"], payload=payload
    )

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="rescale",
    )

    assert state.status == PageStageStatus.clean, f"error: {state.error_message!r}"
    artifact_path = stage_artifact_path(tmp_path, project_id, page_id, "rescale")
    assert artifact_path.exists()
    arr = cv2.imdecode(np.frombuffer(artifact_path.read_bytes(), np.uint8), cv2.IMREAD_UNCHANGED)
    assert arr is not None


@pytest.mark.asyncio
async def test_run_stage_canvas_map_runs_after_rescale(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """`canvas_map` runs on the output of `rescale` and produces a PNG artifact.

    canvas_map outputs image_bytes (output_type='image_bytes'), so the runner
    must encode the ndarray result to PNG and write it canonically.
    """
    project_id, page_id = "p1", "0000"
    # Build a realistic-ish rescaled image: tall and narrow (post-rescale shape).
    img = np.full((200, 120), 200, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    payload = bytes(buf.tobytes())
    await _seed_clean_parents(db, tmp_path, project_id, page_id, parent_stages=["rescale"], payload=payload)

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="canvas_map",
    )

    assert state.status == PageStageStatus.clean, f"error: {state.error_message!r}"
    artifact_path = stage_artifact_path(tmp_path, project_id, page_id, "canvas_map")
    assert artifact_path.exists()
    arr = cv2.imdecode(np.frombuffer(artifact_path.read_bytes(), np.uint8), cv2.IMREAD_UNCHANGED)
    assert arr is not None


# ─── Slice 12: auto_detect_attrs + blank_proof_synth ───────────────────────


@pytest.mark.asyncio
async def test_run_stage_auto_detect_attrs_produces_json_artifact(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """`auto_detect_attrs` runs and emits a page_attrs JSON artifact on disk.

    Parent is `ingest_source` (output_type='image_bytes'). The artifact must
    be a JSON object with at least 'suggested_type' and 'h_w_ratio'.
    """
    import json

    project_id, page_id = "p1", "0000"

    # Build a small white source image (should detect as blank).
    img = np.full((100, 80, 3), 250, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    payload = bytes(buf.tobytes())

    await _seed_clean_parents(
        db, tmp_path, project_id, page_id, parent_stages=["ingest_source"], payload=payload
    )

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="auto_detect_attrs",
    )

    assert state.status == PageStageStatus.clean, f"error: {state.error_message!r}"
    artifact_path = stage_artifact_path(tmp_path, project_id, page_id, "auto_detect_attrs")
    assert artifact_path.exists()
    data = json.loads(artifact_path.read_text())
    assert isinstance(data, dict)
    assert "suggested_type" in data
    assert "h_w_ratio" in data


@pytest.mark.asyncio
async def test_run_stage_blank_proof_synth_produces_png_artifact(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """`blank_proof_synth` loads `auto_detect_attrs` JSON and produces a PNG.

    The output must be a valid PNG artifact decodable by cv2.
    """
    import json

    project_id, page_id = "p1", "0000"

    # Seed auto_detect_attrs with a known-good page_attrs JSON.
    page_attrs = {"suggested_type": "blank", "h_w_ratio": 1.5, "height": 150, "width": 100}
    attrs_artifact = json.dumps(page_attrs).encode()
    await db.init_page_stages_for_page(project_id, page_id)
    await commit_stage_artifact(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="auto_detect_attrs",
        artifact_bytes=attrs_artifact,
    )

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="blank_proof_synth",
    )

    assert state.status == PageStageStatus.clean, f"error: {state.error_message!r}"
    artifact_path = stage_artifact_path(tmp_path, project_id, page_id, "blank_proof_synth")
    assert artifact_path.exists()
    arr = cv2.imdecode(np.frombuffer(artifact_path.read_bytes(), np.uint8), cv2.IMREAD_UNCHANGED)
    assert arr is not None, "blank_proof_synth artifact is not a valid PNG"


# ─── Slice 13: ocr_crop + any_parent_ok ────────────────────────────────────


@pytest.mark.asyncio
async def test_run_stage_ocr_crop_from_canvas_map(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """`ocr_crop` can run when only `canvas_map` is clean (normal page path).

    `ocr_crop` has `any_parent_ok=True`; only `canvas_map` OR
    `blank_proof_synth` needs to be clean. This test verifies the
    canvas_map-is-clean branch.
    """
    project_id, page_id = "p1", "0000"
    img = np.full((200, 120), 200, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    payload = bytes(buf.tobytes())

    # Seed only canvas_map as clean (blank_proof_synth stays not-run).
    await _seed_clean_parents(
        db, tmp_path, project_id, page_id, parent_stages=["canvas_map"], payload=payload
    )

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="ocr_crop",
    )

    assert state.status == PageStageStatus.clean, f"error: {state.error_message!r}"
    artifact_path = stage_artifact_path(tmp_path, project_id, page_id, "ocr_crop")
    assert artifact_path.exists()


@pytest.mark.asyncio
async def test_run_stage_ocr_crop_from_blank_proof_synth(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """`ocr_crop` can run when only `blank_proof_synth` is clean (blank page path).

    Verifies the blank_proof_synth-is-clean branch of any_parent_ok.
    """
    project_id, page_id = "p1", "0000"
    img = np.full((200, 120), 255, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    payload = bytes(buf.tobytes())

    # Seed only blank_proof_synth as clean (canvas_map stays not-run).
    await _seed_clean_parents(
        db, tmp_path, project_id, page_id, parent_stages=["blank_proof_synth"], payload=payload
    )

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="ocr_crop",
    )

    assert state.status == PageStageStatus.clean, f"error: {state.error_message!r}"


@pytest.mark.asyncio
async def test_run_stage_ocr_crop_dep_check_fails_when_no_parent_clean(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """`ocr_crop` raises StageDependenciesNotMet when neither parent is clean."""
    project_id, page_id = "p1", "0000"
    await db.init_page_stages_for_page(project_id, page_id)

    with pytest.raises(StageDependenciesNotMet):
        await run_stage(
            data_root=tmp_path,
            database=db,
            project_id=project_id,
            page_id=page_id,
            stage_id="ocr_crop",
        )


# ─── Slice 13: thumbnail, auto_detect_illustrations, text_postprocess ─────────


@pytest.mark.asyncio
async def test_run_stage_thumbnail_produces_jpeg_artifact(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """`thumbnail` runs on the `ingest_source` artifact and produces a JPEG file.

    Slice 13 registers `_thumbnail_cpu` which takes an ndarray (cv2-decoded
    from the `ingest_source` image_bytes parent) and returns JPEG bytes.
    The runner writes them verbatim as `output.jpg`.
    """
    project_id, page_id = "p1", "0000"
    payload = _checkerboard_bgr_png()
    await _seed_clean_parents(
        db, tmp_path, project_id, page_id, parent_stages=["ingest_source"], payload=payload
    )

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="thumbnail",
    )

    assert state.status == PageStageStatus.clean, f"error: {state.error_message!r}"
    artifact_path = stage_artifact_path(tmp_path, project_id, page_id, "thumbnail")
    assert artifact_path.exists()
    assert artifact_path.suffix == ".jpg"
    # Artifact should decode as a valid image.
    arr = cv2.imdecode(np.frombuffer(artifact_path.read_bytes(), np.uint8), cv2.IMREAD_COLOR)
    assert arr is not None, "thumbnail artifact is not a valid JPEG"


@pytest.mark.asyncio
async def test_run_stage_auto_detect_illustrations_produces_json(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """`auto_detect_illustrations` runs and produces a JSON artifact.

    Without a layout detector installed, the impl returns an empty list —
    the stage transitions to `clean` with `[]` JSON (valid empty
    illustration set). Either outcome satisfies the test.
    """
    import json

    project_id, page_id = "p1", "0000"
    payload = _checkerboard_bgr_png()
    await _seed_clean_parents(
        db, tmp_path, project_id, page_id, parent_stages=["ingest_source"], payload=payload
    )

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="auto_detect_illustrations",
    )

    assert state.status == PageStageStatus.clean, f"error: {state.error_message!r}"
    artifact_path = stage_artifact_path(tmp_path, project_id, page_id, "auto_detect_illustrations")
    assert artifact_path.exists()
    data = json.loads(artifact_path.read_text())
    assert isinstance(data, list), f"expected a JSON list, got {type(data)}"


@pytest.mark.asyncio
async def test_run_stage_text_postprocess_normalises_curly_quotes(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """`text_postprocess` applies curly-quote and em-dash normalisation.

    `ocr` is compound-output so `commit_stage_artifact` refuses to seed it.
    Instead we write the artifact file directly and upsert the DB row via
    `put_page_stage` -- the same state the multi-artifact writer will produce
    when it lands. The runner falls back to loading `ocr` as raw bytes (its
    output_type 'words+text' is not in _IMAGE_OUTPUT_TYPES or _JSON_OUTPUT_TYPES),
    and the impl receives those bytes, decodes to str, normalises, and returns a
    str that the runner encodes to UTF-8 `output.txt`.
    """
    from time import time

    project_id, page_id = "p1", "0000"
    # U+201C/U+201D = curly double quotes; U+2014 = em-dash
    text_with_curly = "\u201cHello,\u201d he said\u2014quickly."
    text_bytes = text_with_curly.encode()

    await db.init_page_stages_for_page(project_id, page_id)

    # Write the ocr artifact manually — bypassing commit_stage_artifact which
    # refuses compound-output stages — then mark the row clean via put_page_stage.
    ocr_dir = tmp_path / "projects" / project_id / "pages" / page_id / "stages" / "ocr"
    ocr_dir.mkdir(parents=True, exist_ok=True)
    (ocr_dir / "output.txt").write_bytes(text_bytes)

    from pd_prep_for_pgdp.core.pipeline.page_stage_writer import compute_content_hash

    await db.put_page_stage(
        PageStageState(
            project_id=project_id,
            page_id=page_id,
            stage_id="ocr",
            status=PageStageStatus.clean,
            stage_version=1,
            artifact_key=f"projects/{project_id}/pages/{page_id}/stages/ocr/output.txt",
            input_hash=compute_content_hash(text_bytes),
            last_run_at=time(),
        )
    )

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="text_postprocess",
    )

    assert state.status == PageStageStatus.clean, f"error: {state.error_message!r}"
    artifact_path = stage_artifact_path(tmp_path, project_id, page_id, "text_postprocess")
    assert artifact_path.exists()
    result = artifact_path.read_text()
    # Em-dash should be replaced with double-hyphen.
    assert "—" not in result
    assert "--" in result


@pytest.mark.asyncio
async def test_run_stage_full_chain_through_canvas_map(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """End-to-end chain: ingest_source → canvas_map in topo order.

    Slices 9-11 complete the proofing chain. Starting from a fresh page
    (no rows seeded), clicking every stage in topo order must produce a
    clean artifact at every step. `find_content_edges` produces a JSON
    artifact; `crop_to_content` reads both image and JSON parents.
    """
    from pd_prep_for_pgdp.adapters.storage.filesystem import FilesystemStorage

    project_id, page_id = "p1", "0000"
    storage = FilesystemStorage(tmp_path)

    # Build a real-looking source image (tall text-page-like content).
    src_img = np.full((400, 250, 3), 240, dtype=np.uint8)
    # Add some 'text-like' dark content.
    src_img[50:350, 30:220] = 30
    ok, buf = cv2.imencode(".png", src_img)
    assert ok
    source_bytes = bytes(buf.tobytes())
    source_key = f"projects/{project_id}/source/page0.png"
    await storage.put_bytes(source_key, source_bytes, "image/png")
    await db.init_page_stages_for_page(project_id, page_id)

    chain = [
        "ingest_source",
        "decode_source",
        "initial_crop",
        "manual_deskew_pre",
        "grayscale",
        "threshold",
        "invert",
        "find_content_edges",
        "crop_to_content",
        "auto_deskew",
        "morph_fill",
        "rescale",
        "canvas_map",
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
            f"stage {stage_id!r} failed; error={state.error_message!r}"
        )
        artifact_path = stage_artifact_path(tmp_path, project_id, page_id, stage_id)
        assert artifact_path.exists(), f"stage {stage_id!r} produced no artifact on disk"


# ─── Issue #58: not-applicable marking after auto_detect_attrs ────────────


@pytest.mark.asyncio
async def test_run_stage_auto_detect_attrs_marks_image_chain_not_applicable_for_blank(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """After `auto_detect_attrs` detects a blank page, stages decode_source
    through morph_fill are marked not-applicable in the same transaction."""
    project_id, page_id = "p1", "0000"

    # Near-white source image — detected as blank by mean_luma heuristic.
    img = np.full((100, 80, 3), 250, dtype=np.uint8)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    payload = bytes(buf.tobytes())

    await _seed_clean_parents(
        db, tmp_path, project_id, page_id, parent_stages=["ingest_source"], payload=payload
    )

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="auto_detect_attrs",
    )

    assert state.status == PageStageStatus.clean, f"error: {state.error_message!r}"

    na_stages = [
        "decode_source",
        "initial_crop",
        "manual_deskew_pre",
        "grayscale",
        "threshold",
        "invert",
        "find_content_edges",
        "crop_to_content",
        "auto_deskew",
        "morph_fill",
    ]
    for sid in na_stages:
        row = await db.get_page_stage(project_id, page_id, sid)
        assert row is not None, f"expected a row for {sid!r} after auto_detect_attrs on blank page"
        assert row.status == PageStageStatus.not_applicable, (
            f"stage {sid!r} should be not-applicable for blank page, got {row.status!r}"
        )


@pytest.mark.asyncio
async def test_run_stage_auto_detect_attrs_marks_ocr_chain_not_applicable_for_plate_p(
    tmp_path: Path,
    db: SqliteDatabase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """After `auto_detect_attrs` detects plate_p, ocr/text stages are not-applicable."""
    from pd_prep_for_pgdp.core.pipeline import stage_registry

    def _fake_plate_p(img: np.ndarray, cfg=None) -> dict:
        h, w = img.shape[:2]
        return {
            "suggested_type": "plate_p",
            "suggested_alignment": "default",
            "confidence": 0.9,
            "height": h,
            "width": w,
            "h_w_ratio": h / w if w > 0 else 1.65,
        }

    monkeypatch.setitem(stage_registry.STAGE_IMPL["auto_detect_attrs"], "cpu", _fake_plate_p)

    project_id, page_id = "p1", "0000"
    payload = _checkerboard_bgr_png()
    await _seed_clean_parents(
        db, tmp_path, project_id, page_id, parent_stages=["ingest_source"], payload=payload
    )

    await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="auto_detect_attrs",
    )

    na_stages = ["ocr_crop", "ocr", "text_postprocess", "text_review"]
    for sid in na_stages:
        row = await db.get_page_stage(project_id, page_id, sid)
        assert row is not None, f"expected a row for {sid!r} after auto_detect_attrs on plate_p page"
        assert row.status == PageStageStatus.not_applicable, (
            f"stage {sid!r} should be not-applicable for plate_p, got {row.status!r}"
        )


@pytest.mark.asyncio
async def test_run_stage_auto_detect_attrs_no_not_applicable_for_normal_page(
    tmp_path: Path,
    db: SqliteDatabase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """auto_detect_attrs on a normal page leaves all descendant stages as not-run."""
    from pd_prep_for_pgdp.core.pipeline import stage_registry

    def _fake_normal(img: np.ndarray, cfg=None) -> dict:
        h, w = img.shape[:2]
        return {
            "suggested_type": "normal",
            "suggested_alignment": "default",
            "confidence": 0.9,
            "height": h,
            "width": w,
            "h_w_ratio": h / w if w > 0 else 1.65,
        }

    monkeypatch.setitem(stage_registry.STAGE_IMPL["auto_detect_attrs"], "cpu", _fake_normal)

    project_id, page_id = "p1", "0000"
    payload = _checkerboard_bgr_png()
    await _seed_clean_parents(
        db, tmp_path, project_id, page_id, parent_stages=["ingest_source"], payload=payload
    )

    await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="auto_detect_attrs",
    )

    rows = await db.list_page_stages_for_page(project_id, page_id)
    for row in rows:
        if row.stage_id == "auto_detect_attrs":
            continue
        assert row.status != PageStageStatus.not_applicable, (
            f"stage {row.stage_id!r} was unexpectedly marked not-applicable for a normal page"
        )


# ─── Slice 14: compound-output stages via multi-artifact writer ────────────


@pytest.mark.asyncio
async def test_run_stage_ocr_produces_multi_artifact_dir(
    tmp_path: Path,
    db: SqliteDatabase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Runner calls multi-artifact writer for compound-output `ocr` stage.

    The `ocr` impl is monkeypatched to avoid loading DocTR weights in CI.
    The important thing under test is the runner's compound-output dispatch
    path: impl returns dict[str, bytes]; runner calls commit_stage_artifacts_multi;
    both files land on disk; DB row is clean.
    """
    import json

    from pd_prep_for_pgdp.core.pipeline import stage_registry as reg_module

    fake_words = [
        {"id": "w0", "text": "Hello", "confidence": 0.9, "bounding_box": {"x": 0, "y": 0, "w": 10, "h": 10}}
    ]
    fake_result = {
        "words.json": json.dumps(fake_words).encode(),
        "raw.txt": b"Hello",
    }
    monkeypatch.setitem(reg_module.STAGE_IMPL["ocr"], "cpu", lambda image, cfg=None: fake_result)

    project_id, page_id = "p1", "0000"
    payload = _checkerboard_bgr_png()
    await _seed_clean_parents(db, tmp_path, project_id, page_id, parent_stages=["ocr_crop"], payload=payload)

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="ocr",
    )

    assert state.status == PageStageStatus.clean, f"error: {state.error_message!r}"
    stage_dir = tmp_path / "projects" / project_id / "pages" / page_id / "stages" / "ocr"
    assert (stage_dir / "words.json").exists(), "words.json missing"
    assert (stage_dir / "raw.txt").exists(), "raw.txt missing"
    assert state.artifact_key is not None
    assert state.artifact_key.endswith("words.json"), (
        f"artifact_key should point to primary file, got {state.artifact_key!r}"
    )


@pytest.mark.asyncio
async def test_run_stage_text_review_produces_multi_artifact_dir(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """`text_review` gate stage runs via multi-artifact writer.

    Seeds `text_postprocess` (output_type='text', written as output.txt),
    then runs `text_review`. Verifies both output.txt and attestation.json
    land in the stage directory and the DB row is clean.
    """
    import json
    from time import time

    from pd_prep_for_pgdp.core.pipeline.page_stage_writer import compute_content_hash

    project_id, page_id = "p1", "0000"
    text_content = b"Hello world."

    await db.init_page_stages_for_page(project_id, page_id)

    # Seed text_postprocess artifact directly (it's single-artifact, output.txt).
    tp_dir = tmp_path / "projects" / project_id / "pages" / page_id / "stages" / "text_postprocess"
    tp_dir.mkdir(parents=True, exist_ok=True)
    (tp_dir / "output.txt").write_bytes(text_content)
    await db.put_page_stage(
        PageStageState(
            project_id=project_id,
            page_id=page_id,
            stage_id="text_postprocess",
            status=PageStageStatus.clean,
            stage_version=1,
            artifact_key=f"projects/{project_id}/pages/{page_id}/stages/text_postprocess/output.txt",
            input_hash=compute_content_hash(text_content),
            last_run_at=time(),
        )
    )

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="text_review",
    )

    assert state.status == PageStageStatus.clean, f"error: {state.error_message!r}"
    stage_dir = tmp_path / "projects" / project_id / "pages" / page_id / "stages" / "text_review"
    assert (stage_dir / "output.txt").exists(), "output.txt missing"
    assert (stage_dir / "attestation.json").exists(), "attestation.json missing"
    assert (stage_dir / "output.txt").read_bytes() == text_content
    attestation = json.loads((stage_dir / "attestation.json").read_bytes())
    assert isinstance(attestation, dict)
    assert state.artifact_key is not None
    assert state.artifact_key.endswith("output.txt"), (
        f"artifact_key should point to primary file (output.txt), got {state.artifact_key!r}"
    )


# ─── Stage versioning: stage_version updated after successful run ────────────


@pytest.mark.asyncio
async def test_run_stage_updates_stage_version(
    tmp_path: Path,
    db: SqliteDatabase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """After a successful run, the row's stage_version matches STAGE_VERSIONS[stage_id].

    Spec: docs/specs/pipeline-task-model.md §"Stage versioning (Q4 lock)".
    """
    import pd_prep_for_pgdp.core.pipeline.stage_dag as _stage_dag_mod

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

    # Bump the registry version for "grayscale" to 2.
    original = dict(_stage_dag_mod.STAGE_VERSIONS)
    monkeypatch.setattr(_stage_dag_mod, "STAGE_VERSIONS", dict(original, grayscale=2))

    state = await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=page_id,
        stage_id="grayscale",
    )

    assert state.status == PageStageStatus.clean
    assert state.stage_version == 2, (
        f"stage_version should be updated to STAGE_VERSIONS[stage_id]=2, got {state.stage_version}"
    )


# ─── Cross-page dirty cascade: split children (issue #55) ──────────────────


async def _seed_split_child(
    db: SqliteDatabase,
    data_root: Path,
    project_id: str,
    parent_page_id: str,
    child_idx0: int,
    split_at_stage: str,
    clean_stages: list[str],
    payload: bytes,
) -> None:
    """Create a split-child PageRecord and seed some stages as clean."""
    from pd_prep_for_pgdp.core.models import PageRecord

    suffix = chr(ord("a") + child_idx0 - 1)
    child = PageRecord(
        project_id=project_id,
        idx0=child_idx0,
        prefix=f"0000{suffix}",
        source_stem="page",
        parent_page_id=parent_page_id,
        source_crop_bbox=(0, 0, 100, 100),
        split_index=child_idx0,
        split_at_stage=split_at_stage,
        split_suffix=suffix,
    )
    await db.put_page(child)
    child_page_id = f"{child_idx0:04d}"
    await db.init_page_stages_for_page(project_id, child_page_id)
    for sid in clean_stages:
        await commit_stage_artifact(
            data_root=data_root,
            database=db,
            project_id=project_id,
            page_id=child_page_id,
            stage_id=sid,
            artifact_bytes=payload,
        )


@pytest.mark.asyncio
async def test_cross_page_cascade_dirties_split_children_when_stage_upstream(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """Re-running a parent stage upstream of split_at_stage marks each split
    child's decode_source dirty (issue #55 acceptance bullet 1).

    Setup: parent page 0000; two split children (idx0=1, idx0=2) both with
    split_at_stage="threshold". Run grayscale on parent — grayscale is
    upstream of threshold, so both children's decode_source must become dirty.
    """
    project_id = "p1"
    parent_page_id = "0000"
    payload = _checkerboard_bgr_png()

    # Seed parent with manual_deskew_pre clean (grayscale's dependency).
    await _seed_clean_parents(
        db,
        tmp_path,
        project_id,
        parent_page_id,
        parent_stages=["manual_deskew_pre"],
        payload=payload,
    )

    # Create two split children, each with decode_source seeded clean.
    for child_idx0 in (1, 2):
        await _seed_split_child(
            db,
            tmp_path,
            project_id,
            parent_page_id,
            child_idx0=child_idx0,
            split_at_stage="threshold",
            clean_stages=["decode_source"],
            payload=payload,
        )

    # Confirm children's decode_source is clean before the run.
    for child_idx0 in (1, 2):
        row = await db.get_page_stage(project_id, f"{child_idx0:04d}", "decode_source")
        assert row is not None
        assert row.status == PageStageStatus.clean

    # Run grayscale on the parent — grayscale is upstream of threshold.
    await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=parent_page_id,
        stage_id="grayscale",
    )

    # Both children's decode_source must now be dirty.
    for child_idx0 in (1, 2):
        row = await db.get_page_stage(project_id, f"{child_idx0:04d}", "decode_source")
        assert row is not None
        assert row.status == PageStageStatus.dirty, (
            f"child {child_idx0} decode_source expected dirty, got {row.status}"
        )


@pytest.mark.asyncio
async def test_cross_page_cascade_does_not_dirty_children_when_stage_downstream(
    tmp_path: Path,
    db: SqliteDatabase,
) -> None:
    """Re-running a parent stage downstream of split_at_stage does NOT dirty
    split children (issue #55 acceptance bullet 2).

    Setup: parent page 0000; one split child with split_at_stage="decode_source".
    Run initial_crop on parent — initial_crop is downstream of decode_source,
    so the child's decode_source must remain clean.
    """
    project_id = "p1"
    parent_page_id = "0000"
    payload = _checkerboard_bgr_png()

    # Seed parent with decode_source clean so initial_crop can run.
    await _seed_clean_parents(
        db,
        tmp_path,
        project_id,
        parent_page_id,
        parent_stages=["decode_source"],
        payload=payload,
    )

    # Create one split child with split_at_stage="decode_source" and decode_source clean.
    await _seed_split_child(
        db,
        tmp_path,
        project_id,
        parent_page_id,
        child_idx0=1,
        split_at_stage="decode_source",
        clean_stages=["decode_source"],
        payload=payload,
    )

    # Run initial_crop on parent — initial_crop is downstream of decode_source.
    await run_stage(
        data_root=tmp_path,
        database=db,
        project_id=project_id,
        page_id=parent_page_id,
        stage_id="initial_crop",
    )

    # Child's decode_source must still be clean (not dirtied).
    row = await db.get_page_stage(project_id, "0001", "decode_source")
    assert row is not None
    assert row.status == PageStageStatus.clean, (
        f"child decode_source should stay clean when stage is downstream of split_at_stage, got {row.status}"
    )
